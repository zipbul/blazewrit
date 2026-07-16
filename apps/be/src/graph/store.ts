import type { SQL } from 'bun';
import { deriveTaskStatus } from './derive';
import { bumpGeneration } from './transitions';
import { wouldCreateCycle, type CycleEdge } from './cycle';
import { loadTaskGraph } from './load-task-graph';
import type { DepOutcome, DepPredicate, DepTargetType, JobStatus, TaskStatus } from './types';

/** Rule 1: actorRepoId doesn't own the job/seal row being written. */
export class WriteAclError extends Error {}

/** Rule 2: the acting repo has already sealed this task — its own INSERT is frozen. */
export class SliceSealedError extends Error {}

/** Rule 9: the task is terminal (done/failed/cancelled) — no further graph writes are allowed. */
export class TerminalTaskError extends Error {}

/** Rule 7: a proposed dep edge would close a wait cycle (cycle.ts's wouldCreateCycle said yes). */
export class DepCycleError extends Error {}

/** bumpJobGeneration target: no job row exists with the given id. */
export class JobNotFoundError extends Error {}

/**
 * bumpJobGeneration target: the job isn't terminal, so there's nothing to rewind (F-group
 * transition guard — mirrors transitions.bumpGeneration's rejection at the write boundary).
 */
export class NotRerunnableError extends Error {}

export interface NewJobInput {
  id: string;
  taskId: string;
  repoId: string;
  title: string;
  description?: string;
}

/** Identifies one repo's slice of one task (a task_seals row). */
export interface SealTarget {
  taskId: string;
  repoId: string;
}

/**
 * Rule 1 (write ACL) + rule 2 (slice insert-freeze) + rule 9 (terminal task immutable):
 * insert a job row. `actorRepoId` is the write-ACL subject — it must equal `job.repoId`
 * (a repo can only write its own jobs, else WriteAclError). Rejected with TerminalTaskError if
 * the task is terminal, or SliceSealedError if `job.repoId` has already sealed this task.
 *
 * Always inserts as status='pending', generation=1 — NewJobInput carries no status/generation
 * input on purpose. Per the graph-management wiring decision (job-graph.md, rule 3 of that
 * section), done/failed only ever come from flow-execution results and ready only from
 * reconcile; letting an insert dictate a status would smuggle a state transition through the
 * shape-only write path.
 */
export async function insertJob(sql: SQL, actorRepoId: string, job: NewJobInput): Promise<void> {
  await sql.begin((tx) => insertJobTx(tx, actorRepoId, job));
}

/**
 * insertJob's transactional core, split out (P3 migration 10/11) so a caller that already holds
 * an open transaction can reuse the SAME ACL/rule-9/seal checks without nesting `.begin()` — bun's
 * SQL rejects that outright ("cannot call begin inside a transaction use savepoint() instead").
 * The negotiation accept handler (rest.ts) is exactly that caller: job/dep/gate materialize +
 * the proposal's status flip all need to land in ONE transaction, and this is the piece of that
 * transaction insertJob itself can't be called into directly. `tx` must already be an open
 * transaction/savepoint context — this does NOT call `.begin()` itself.
 */
export async function insertJobTx(tx: SQL, actorRepoId: string, job: NewJobInput): Promise<void> {
  if (actorRepoId !== job.repoId) {
    throw new WriteAclError(`actor ${actorRepoId} cannot write jobs into repo ${job.repoId}`);
  }
  const taskRows = (await tx`select status from tasks where id = ${job.taskId} for update`) as Array<{ status: TaskStatus }>;
  const task = taskRows[0];
  if (task && task.status !== 'open') {
    throw new TerminalTaskError(`task ${job.taskId} is terminal (${task.status})`);
  }

  const sealRows = (await tx`select 1 from task_seals where task_id = ${job.taskId} and repo_id = ${job.repoId}`) as unknown[];
  if (sealRows.length > 0) {
    throw new SliceSealedError(`repo ${job.repoId} has already sealed its slice of task ${job.taskId}`);
  }

  await tx`
    insert into jobs (id, task_id, repo_id, title, description, status, generation)
    values (${job.id}, ${job.taskId}, ${job.repoId}, ${job.title}, ${job.description ?? null}, 'pending', 1)
  `;
}

export interface NewDepInput {
  id: string;
  waiterJobId: string;
  targetType: DepTargetType;
  targetId: string;
  predicate?: DepPredicate;
  acceptable?: DepOutcome[];
}

/**
 * Rule 7 (cycle check) + the deps/dep_members insert that materializes one wait-edge. Extracted
 * (P4-1) out of rest.ts's materializeAsk so the negotiation accept path and dep_declare (P4 agent
 * tool, graph/agent-tools.ts) share ONE cycle-check-then-insert body instead of two copies
 * drifting apart. Loads the REAL current graph via loadTaskGraph(tx) — same transaction, so it
 * sees whatever a concurrently-committing write already landed — and rejects with DepCycleError
 * if `dep` would close a wait cycle.
 *
 * Deliberately does NOT check that `dep.waiterJobId` belongs to any particular repo —
 * materializeAsk never enforced that (accepting a negotiation ask writes whatever dep the ask
 * named, the provider's own consent to accept is the gate), so adding it here would be a behavior
 * change for that caller. dep_declare enforces its own waiter-ownership ACL itself, before ever
 * calling this (P4-1 judgment call — see agent-tools.ts).
 *
 * `tx` must already be an open transaction/savepoint context (mirrors insertJobTx's own contract)
 * — this does NOT call `.begin()` itself.
 */
export async function insertDepTx(tx: SQL, dep: NewDepInput): Promise<void> {
  const { jobs, edges } = await loadTaskGraph(tx);
  const candidate: CycleEdge = { waiterJobId: dep.waiterJobId, targetType: dep.targetType, targetId: dep.targetId };
  if (wouldCreateCycle(jobs, edges, candidate)) {
    throw new DepCycleError(`dep ${candidate.waiterJobId} -> ${candidate.targetType}:${candidate.targetId} would create a cycle`);
  }
  await tx`insert into deps (id, waiter_job, predicate, status) values (${dep.id}, ${dep.waiterJobId}, ${dep.predicate ?? 'all'}, 'active')`;
  await tx`
    insert into dep_members (dep_id, target_type, target_id, acceptable)
    values (${dep.id}, ${dep.targetType}, ${dep.targetId}, ${tx.array(dep.acceptable ?? ['satisfied'], 'text')})
  `;
}

/** insertDepTx wrapped in its own transaction, for a caller that doesn't already hold one open (dep_declare's shape — see agent-tools.ts). */
export async function insertDep(sql: SQL, dep: NewDepInput): Promise<void> {
  await sql.begin((tx) => insertDepTx(tx, dep));
}

/**
 * Rule 9 (terminal task immutable) + the F-group transition guard, enforced again at the write
 * boundary: gen++ an existing terminal job in place (same row, generation+1, status→pending).
 * `actorRepoId` must equal the job's repo_id (rule 1, else WriteAclError) — sealing the task does
 * NOT block this (rule 2: re-run is not an insert). Rejected with TerminalTaskError once the
 * job's task is terminal.
 */
export async function bumpJobGeneration(sql: SQL, actorRepoId: string, jobId: string): Promise<void> {
  await sql.begin(async (tx) => {
    const jobRows = (await tx`select status, generation, repo_id, task_id from jobs where id = ${jobId} for update`) as Array<{
      status: JobStatus;
      generation: number;
      repo_id: string;
      task_id: string;
    }>;
    const job = jobRows[0];
    if (!job) throw new JobNotFoundError(`job ${jobId} not found`);
    if (actorRepoId !== job.repo_id) {
      throw new WriteAclError(`actor ${actorRepoId} cannot write job ${jobId} owned by repo ${job.repo_id}`);
    }

    const taskRows = (await tx`select status from tasks where id = ${job.task_id} for update`) as Array<{ status: TaskStatus }>;
    const task = taskRows[0];
    if (task && task.status !== 'open') {
      throw new TerminalTaskError(`task ${job.task_id} is terminal (${task.status})`);
    }

    const result = bumpGeneration({ status: job.status, generation: job.generation });
    if (!result.ok) throw new NotRerunnableError(result.reason);

    await tx`update jobs set status = ${result.job.status}, generation = ${result.job.generation} where id = ${jobId}`;
  });
}

/**
 * Rule 2: a repo freezes its own slice of a task (inserts its task_seals row). `actorRepoId`
 * must equal `target.repoId` (else WriteAclError) — a repo may only seal itself. Rejected with
 * TerminalTaskError once the task is terminal (rule 9).
 */
export async function sealTaskSlice(sql: SQL, actorRepoId: string, target: SealTarget): Promise<void> {
  if (actorRepoId !== target.repoId) {
    throw new WriteAclError(`actor ${actorRepoId} cannot seal repo ${target.repoId}'s slice`);
  }
  await sql.begin(async (tx) => {
    const taskRows = (await tx`select status from tasks where id = ${target.taskId} for update`) as Array<{ status: TaskStatus }>;
    const task = taskRows[0];
    if (task && task.status !== 'open') {
      throw new TerminalTaskError(`task ${target.taskId} is terminal (${task.status})`);
    }

    await tx`
      insert into task_seals (task_id, repo_id) values (${target.taskId}, ${target.repoId})
      on conflict (task_id, repo_id) do nothing
    `;
  });
}

/**
 * Rule 2: a repo reopens its own slice by deleting its task_seals row. Same ACL (`actorRepoId`
 * must equal `target.repoId`, else WriteAclError) and terminal-task guard (TerminalTaskError,
 * rule 9) as sealTaskSlice.
 */
export async function unsealTaskSlice(sql: SQL, actorRepoId: string, target: SealTarget): Promise<void> {
  if (actorRepoId !== target.repoId) {
    throw new WriteAclError(`actor ${actorRepoId} cannot unseal repo ${target.repoId}'s slice`);
  }
  await sql.begin(async (tx) => {
    const taskRows = (await tx`select status from tasks where id = ${target.taskId} for update`) as Array<{ status: TaskStatus }>;
    const task = taskRows[0];
    if (task && task.status !== 'open') {
      throw new TerminalTaskError(`task ${target.taskId} is terminal (${task.status})`);
    }

    await tx`delete from task_seals where task_id = ${target.taskId} and repo_id = ${target.repoId}`;
  });
}

/**
 * Rule 3's actual derivation body, shared by every write path that can flip a task's status:
 * loads the current participating-repo/seal/job facts for `taskId` and runs them through
 * deriveTaskStatus. Callers own the surrounding transaction/locking and the decision of whether
 * (and when) to write the result — this only reads.
 */
async function loadAndDeriveTaskStatus(tx: SQL, taskId: string): Promise<TaskStatus> {
  const participatingRows = (await tx`select distinct repo_id from jobs where task_id = ${taskId}`) as Array<{ repo_id: string }>;
  const sealedRows = (await tx`select repo_id from task_seals where task_id = ${taskId}`) as Array<{ repo_id: string }>;
  const jobRows = (await tx`select status from jobs where task_id = ${taskId}`) as Array<{ status: JobStatus }>;

  return deriveTaskStatus({
    participatingRepoIds: participatingRows.map((r) => r.repo_id),
    sealedRepoIds: sealedRows.map((r) => r.repo_id),
    jobStatuses: jobRows.map((r) => r.status),
  });
}

/**
 * Rule 3 (done atomicity): seal `target`'s slice AND recompute task.status from the current
 * participating-repo/seal/job facts in the same transaction, returning the resulting status.
 * This is the only path that can flip a task to done/failed AT SEAL TIME — its atomicity is what
 * D7 verifies (interleaving a job insert around this call must never leave "done" with an open
 * job attached). It is NOT the only path overall — see rederiveTask below for the other one.
 */
export async function sealTaskSliceAndDerive(sql: SQL, actorRepoId: string, target: SealTarget): Promise<TaskStatus> {
  if (actorRepoId !== target.repoId) {
    throw new WriteAclError(`actor ${actorRepoId} cannot seal repo ${target.repoId}'s slice`);
  }
  return sql.begin(async (tx) => {
    const taskRows = (await tx`select status from tasks where id = ${target.taskId} for update`) as Array<{ status: TaskStatus }>;
    const task = taskRows[0];
    if (task && task.status !== 'open') {
      throw new TerminalTaskError(`task ${target.taskId} is terminal (${task.status})`);
    }

    await tx`
      insert into task_seals (task_id, repo_id) values (${target.taskId}, ${target.repoId})
      on conflict (task_id, repo_id) do nothing
    `;

    const derived = await loadAndDeriveTaskStatus(tx, target.taskId);
    await tx`update tasks set status = ${derived} where id = ${target.taskId}`;
    return derived;
  });
}

/**
 * 3자 리뷰 수정 B1-1 (Fable#3): sealTaskSliceAndDerive is the only place a task's status was ever
 * recomputed — a task whose LAST job goes terminal AFTER every participating repo had already
 * sealed (no seal call left to trigger a re-derive) stayed 'open' forever, even though
 * deriveTaskStatus would now say done/failed. This is graph/controller.ts's C2 scan's OTHER exit:
 * where deriveTaskStatus reads done/failed (not open — that case still raises the unresolvable_task
 * wake, unchanged), re-derive AND write it, under the same for-update lock sealTaskSliceAndDerive
 * uses. Guarded to only ever move 'open' -> done|failed (never touches an already-terminal task,
 * and a derivation that's still 'open' is a no-op write) — this is a READ-driven re-derivation, not
 * a new way to flip a task, so it must never race ahead of what the graph facts actually say.
 */
export async function rederiveTask(sql: SQL, taskId: string): Promise<TaskStatus> {
  return sql.begin(async (tx) => {
    const taskRows = (await tx`select status from tasks where id = ${taskId} for update`) as Array<{ status: TaskStatus }>;
    const task = taskRows[0];
    if (!task || task.status !== 'open') return task?.status ?? 'open';

    const derived = await loadAndDeriveTaskStatus(tx, taskId);
    if (derived !== 'open') {
      await tx`update tasks set status = ${derived} where id = ${taskId}`;
    }
    return derived;
  });
}
