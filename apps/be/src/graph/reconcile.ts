import type { SQL } from 'bun';
import { computeReady, evaluateDep, isStaleMember, jobTargetOutcome, taskTargetOutcome, type DepMemberEval } from './deps';
import { canTransitionJob } from './transitions';
import type { DepOutcome, DepPredicate, DepStatus, DepTargetType, JobStatus, TaskStatus } from './types';

/** The shape `dispatch` needs to actually run the job — everything reconcile itself already has. */
export interface ReconcileJob {
  id: string;
  repoId: string;
  taskId: string;
  title: string;
}

export interface ReconcileResult {
  /** Job ids handed off to `dispatch` this pass — regardless of whether that call itself threw. */
  claimed: string[];
}

interface JobRow {
  id: string;
  repo_id: string;
  title: string;
  status: JobStatus;
}

interface DepRow {
  id: string;
  predicate: DepPredicate;
  status: DepStatus;
}

interface DepMemberRow {
  target_type: DepTargetType;
  target_id: string;
  expected_gen: number | null;
  acceptable: string[];
}

/**
 * dep_members rows don't self-update, so this is where rule 5/6's outcome derivation actually
 * happens against live data (deps.ts's jobTargetOutcome/taskTargetOutcome are the pure rule this
 * reads through). A target row that no longer exists reads as 'pending' — same as "nothing has
 * happened yet" — rather than throwing.
 *
 * external_gates evaluation is out of scope (harness/job-graph.md P3): no write path creates an
 * 'external' dep_member yet, so it conservatively reads its provider status directly (never
 * satisfied until fired) instead of inventing gate-specific logic here.
 */
async function liveMemberOutcome(sql: SQL, member: DepMemberRow): Promise<{ outcome: DepOutcome; actualGen?: number }> {
  if (member.target_type === 'job') {
    const rows = (await sql`select status, generation from jobs where id = ${member.target_id}`) as Array<{ status: JobStatus; generation: number }>;
    const target = rows[0];
    return { outcome: target ? jobTargetOutcome(target.status) : 'pending', actualGen: target?.generation };
  }
  if (member.target_type === 'task') {
    const rows = (await sql`select status from tasks where id = ${member.target_id}`) as Array<{ status: TaskStatus }>;
    return { outcome: rows[0] ? taskTargetOutcome(rows[0].status) : 'pending' };
  }
  const rows = (await sql`select status from external_gates where id = ${member.target_id}`) as Array<{ status: string }>;
  return { outcome: rows[0]?.status === 'fired' ? 'satisfied' : 'pending' };
}

/**
 * Rule 4/5's per-job readiness check: loads `jobId`'s own deps + members, refreshes each dep's
 * status against live target facts (persisting only on change — rule 11's latch lives in
 * evaluateDep itself, this just stores whatever it returns), then computeReady's AND-across-deps.
 * No deps at all (today's only reachable case — assembleJobs never emits one yet) means ready.
 */
async function jobIsReady(sql: SQL, jobId: string): Promise<boolean> {
  const deps = (await sql`select id, predicate, status from deps where waiter_job = ${jobId}`) as DepRow[];
  const depStatuses: DepStatus[] = [];
  for (const dep of deps) {
    const members = (await sql`
      select target_type, target_id, expected_gen, acceptable from dep_members where dep_id = ${dep.id}
    `) as DepMemberRow[];
    const evalMembers: DepMemberEval[] = [];
    for (const member of members) {
      const { outcome, actualGen } = await liveMemberOutcome(sql, member);
      const stale = isStaleMember({ targetType: member.target_type, expectedGen: member.expected_gen ?? undefined }, actualGen);
      evalMembers.push({ outcome, acceptable: member.acceptable as DepOutcome[], stale });
    }
    const newStatus = evaluateDep({ predicate: dep.predicate, status: dep.status }, evalMembers);
    if (newStatus !== dep.status) {
      await sql`update deps set status = ${newStatus} where id = ${dep.id}`;
    }
    depStatuses.push(newStatus);
  }
  return computeReady(depStatuses.map((status) => ({ status })));
}

/**
 * Reconcile controller (harness/job-graph.md migration step 8): finds every ready pending/blocked
 * job under `taskId` and hands it to `dispatch`. This is the ONLY place ready→running happens —
 * dispatchTask no longer decides that inline, it just calls this once right after its graph write.
 *
 * Per job: not pending/blocked → skip untouched (already in flight or terminal, not this pass's
 * concern). Not ready → transition to blocked if that's an actual change (canTransitionJob-guarded;
 * a job already blocked is left alone). Ready → atomic claim (pending|blocked → ready → running,
 * one transaction) then `dispatch`; an empty `returning` on the claim means another reconcile pass
 * already took it, so this pass skips it — the concurrent-dispatch guard the harness doc's
 * "물리" section calls for. `dispatch` throwing fails just that job (status='failed') and never
 * stops the rest of the pass — P2's lease/retry machinery is future work, not this commit's job.
 */
export async function reconcileTask(sql: SQL, taskId: string, dispatch: (job: ReconcileJob) => Promise<void>): Promise<ReconcileResult> {
  const claimed: string[] = [];
  const jobs = (await sql`select id, repo_id, title, status from jobs where task_id = ${taskId} order by created_at`) as JobRow[];

  for (const job of jobs) {
    if (job.status !== 'pending' && job.status !== 'blocked') continue;

    const ready = await jobIsReady(sql, job.id);
    if (!ready) {
      if (job.status !== 'blocked' && canTransitionJob(job.status, 'blocked')) {
        await sql`update jobs set status = 'blocked' where id = ${job.id}`;
      }
      continue;
    }

    const runningRows = (await sql.begin(async (tx) => {
      const toReady = (await tx`update jobs set status = 'ready' where id = ${job.id} and status in ('pending', 'blocked') returning id`) as Array<{
        id: string;
      }>;
      if (toReady.length === 0) return [] as Array<{ id: string }>;
      return (await tx`update jobs set status = 'running' where id = ${job.id} and status = 'ready' returning id`) as Array<{ id: string }>;
    })) as Array<{ id: string }>;
    if (runningRows.length === 0) continue; // lost the claim race to another reconcile pass

    claimed.push(job.id);
    try {
      await dispatch({ id: job.id, repoId: job.repo_id, taskId, title: job.title });
    } catch {
      await sql`update jobs set status = 'failed' where id = ${job.id}`.catch(() => undefined);
    }
  }

  return { claimed };
}
