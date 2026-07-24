import type { SQL } from 'bun';
import { computeReady, evaluateDep, isStaleMember, jobTargetOutcome, taskTargetOutcome, type DepMemberEval } from './deps';
import { canTransitionJob, isTerminalJobStatus } from './transitions';
import { DEFAULT_LEASE_TTL_MS } from './lease';
import type { DepOutcome, DepPredicate, DepStatus, DepTargetType, JobStatus, TaskStatus } from './types';

export interface ReconcileOpts {
  /** Lease TTL granted at claim (ready→running) — same window a step-transition heartbeat
   * (lease.ts's withLeaseHeartbeat) renews by. Defaults to lease.ts's DEFAULT_LEASE_TTL_MS. */
  leaseTtlMs?: number;
}

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
 *
 * Exported (3자 리뷰 메타리뷰 N2) — dep_members.outcome is never UPDATEd anywhere in src (only this
 * function's live computation + deps.status get persisted, rule 11's latch lives on deps.status, not
 * here), so it reads as permanently 'pending' from the DB. agent-tools.ts's graph_read reuses THIS
 * function instead of returning that dead column, so a released dep never shows a self-contradictory
 * 'pending' member next to it. Parameter narrowed to just the two fields this actually reads (not the
 * full DepMemberRow) so a caller building its own row shape from a different query doesn't need to
 * fake expected_gen/acceptable just to call this.
 */
export async function liveMemberOutcome(
  sql: SQL,
  member: Pick<DepMemberRow, 'target_type' | 'target_id'>,
): Promise<{ outcome: DepOutcome; actualGen?: number }> {
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
      // E-round task #8 (Grok F-A2) / rule 11's latch: `dep.status` is this loop iteration's own
      // SELECT snapshot, not the row's live status — evaluateDep's `stale`/`active` never fires once
      // ITS OWN read already sees 'released' (evaluateDep's own latch check), but a DIFFERENT,
      // concurrently-running reconcile pass (dispatchTask's inline call and this always-on
      // controller's tick are NOT mutually exclusive) could release this SAME dep in the gap between
      // this pass's SELECT and this UPDATE. An unconditional write here would then clobber that
      // newer 'released' back to 'stale'/'active' — a real regression of rule 11 (once released,
      // never reverts). `and status <> 'released'` makes the write a no-op once that's happened,
      // same CAS shape as every other write path's own status guard.
      await sql`update deps set status = ${newStatus} where id = ${dep.id} and status <> 'released'`;
    }
    depStatuses.push(newStatus);
  }
  return computeReady(depStatuses.map((status) => ({ status })));
}

interface JobEventRow {
  job_id: string;
  generation: number;
  kind: 'succeeded' | 'failed' | 'rerun_requested';
}

/**
 * F2 (3자 리뷰 수정 라운드): claims AND applies exactly ONE job_events row inside a single
 * transaction — the claim (`processed_at is null` -> `now()`) and the jobs/work_items application
 * are now one atomicity unit, closing two holes the earlier 3-separate-statements shape had:
 *
 *  - Non-atomic apply-then-mark: a crash (or any thrown error) between "applied the jobs CAS" and
 *    "marked processed_at" used to leave the event LOOKING unprocessed on a retry, but the retry's
 *    OWN jobs CAS would then find the row already at its target status (0 rows affected) and skip
 *    deriving work_items — permanently stranding the mirror at 'in_flow' under an already-terminal
 *    job. Now: either this whole transaction commits (claim + apply + mirror, all together) or it
 *    rolls back IN FULL (claim included) — there is no reachable "applied but not marked" state to
 *    retry into.
 *  - Concurrent consumption: two callers processing the SAME event (reconcileTask's inline call and
 *    controller.ts's periodic sweep are NOT mutually exclusive) both used to attempt the jobs CAS
 *    and the mark independently. Now the claim UPDATE's own `processed_at is null` guard is the
 *    single point of serialization: Postgres blocks the second transaction on the row lock until
 *    the first resolves, then re-evaluates the guard against the now-committed (or rolled-back) row
 *    — a genuine single winner per event, not a best-effort race that happens to converge.
 *
 * Reinforcement (still F2): work_items is derived from the job's CURRENT status/generation, not
 * from whether THIS transaction's own jobs CAS affected a row — a retry of an event whose jobs CAS
 * already applied on an earlier pass (the crash-recovery case above, or simply a second consumer
 * that lost the claim race) still finds the job already at the matching terminal status and derives
 * the mirror anyway. No path is left where jobs reaches its terminal status while work_items stays
 * permanently stuck at 'in_flow'.
 */
async function consumeOneEvent(sql: SQL, ev: JobEventRow): Promise<void> {
  await sql.begin(async (tx) => {
    const claimed = (await tx`
      update job_events set processed_at = now()
      where job_id = ${ev.job_id} and generation = ${ev.generation} and kind = ${ev.kind} and processed_at is null
      returning job_id
    `) as unknown[];
    if (claimed.length === 0) return; // already consumed by a concurrently-committed pass — nothing left to do

    if (ev.kind === 'succeeded' || ev.kind === 'failed') {
      const newStatus = ev.kind === 'succeeded' ? 'done' : 'failed';
      await tx`
        update jobs set status = ${newStatus}, status_changed_at = now(), lease_expires_at = null
        where id = ${ev.job_id} and status = 'running' and generation = ${ev.generation}
      `;
      const jobRows = (await tx`select status, generation from jobs where id = ${ev.job_id}`) as Array<{ status: JobStatus; generation: number }>;
      const job = jobRows[0];
      if (job && job.generation === ev.generation && job.status === newStatus) {
        // work_items mirror (jobId === workItemId, dispatchTask's own 1:1 convention) — only
        // derived here now (formerly makeJobFlow's own dual-write); still best-effort/soft, same
        // as every other work_items mirror write in this codebase.
        await tx`
          update work_items set state = ${newStatus === 'done' ? 'done' : 'blocked'} where id = ${ev.job_id} and state = 'in_flow'
        `;
      }
    } else {
      // rerun_requested (Phase 2's own producer isn't wired yet — store.bumpJobGeneration still
      // writes directly — but the consumer is ready for it): gen++ only if still terminal at
      // exactly this event's generation. `for update` locks the row for the rest of this
      // transaction — harmless (nothing else in this same transaction touches it again) and
      // consistent with this function's other branch reading un-locked (the claim UPDATE above
      // already serializes concurrent consumers of THIS event; a different event racing THIS job
      // is store.ts's own bumpJobGeneration concern, unchanged this round).
      const rows = (await tx`select status, generation from jobs where id = ${ev.job_id} for update`) as Array<{ status: JobStatus; generation: number }>;
      const job = rows[0];
      if (job && job.generation === ev.generation && isTerminalJobStatus(job.status)) {
        await tx`update jobs set status = 'pending', generation = generation + 1 where id = ${ev.job_id} and generation = ${ev.generation}`;
      }
    }
  });
}

/**
 * 단일 기록자 통합 Phase 1 (job-graph.md C1): the ONLY place a job_events row ever turns into a
 * jobs.status write. Execution (api/rest.ts's makeJobFlow) no longer writes jobs/work_items status
 * at all — it just inserts an append-only fact ("this generation ended succeeded/failed/wants a
 * rerun"); this is the state-machine side of that split. Each event is claimed and applied in its
 * OWN transaction (consumeOneEvent, see its own doc comment for the atomicity/concurrency story).
 *
 * `taskId` given: scopes to job_events whose job belongs to that task — this is reconcileTask's own
 * inline call, for immediacy (don't make a job's completion wait for the next periodic controller
 * tick). `taskId` omitted: every unprocessed event, any task — this is controller.ts's tick(), the
 * crash/restart net for an event whose inline consumer never got to run (e.g. the process died
 * before its own reconcileTask call).
 *
 * Per event: 'succeeded'/'failed' apply done/failed ONLY if the job is still 'running' at exactly
 * that event's generation — a stale gen-1 event arriving after a gen-2 re-claim (or after some
 * other path already failed the job) finds its precondition already false and is consumed as a
 * no-op, never clobbering whatever the row moved on to. 'rerun_requested' gen++'s a job that's
 * still terminal at that event's generation (the same precondition bumpJobGeneration itself
 * enforces) — a no-op once the job has already moved on (re-run via a different path, or a second
 * rerun_requested event for the same generation already consumed). Every event is marked
 * `processed_at` regardless of whether it applied — the event's OWN fact was still successfully
 * consumed either way; "did nothing because it no longer applies" is a valid, final outcome, not a
 * reason to leave it to be re-read forever.
 *
 * One event's transaction failing (deadlock, transient connection error) does not stop the rest of
 * this pass — F2's own atomicity guarantee means it simply stays unprocessed (its transaction rolled
 * back in full, `processed_at` still null) and is retried whole-cloth by the next consumeJobEvents
 * call, same as any other transient failure elsewhere in this codebase's reconcile paths. Logged,
 * not silently dropped — this is durable state, not a fire-and-forget notification.
 */
export async function consumeJobEvents(sql: SQL, taskId?: string): Promise<void> {
  const events = (taskId
    ? await sql`
        select je.job_id, je.generation, je.kind from job_events je
        join jobs j on j.id = je.job_id
        where j.task_id = ${taskId} and je.processed_at is null
        order by je.created_at
      `
    : await sql`select job_id, generation, kind from job_events where processed_at is null order by created_at`) as JobEventRow[];

  for (const ev of events) {
    try {
      await consumeOneEvent(sql, ev);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[consumeJobEvents] failed to consume job_events (job=${ev.job_id} generation=${ev.generation} kind=${ev.kind}):`, err);
    }
  }
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
export async function reconcileTask(
  sql: SQL,
  taskId: string,
  dispatch: (job: ReconcileJob) => Promise<void>,
  opts: ReconcileOpts = {},
): Promise<ReconcileResult> {
  const leaseTtlMs = opts.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
  const claimed: string[] = [];
  // Single-writer round (job-graph.md C1): consume this task's own pending execution facts FIRST —
  // a job this pass is about to read as 'running' below may actually have just finished (its
  // job_events row inserted, but not yet applied), and a waiter's dep on it needs the live
  // post-consumption status, not a stale 'running' snapshot.
  await consumeJobEvents(sql, taskId);
  const jobs = (await sql`select id, repo_id, title, status from jobs where task_id = ${taskId} order by created_at`) as JobRow[];

  for (const job of jobs) {
    if (job.status !== 'pending' && job.status !== 'blocked') continue;

    const ready = await jobIsReady(sql, job.id);
    if (!ready) {
      // CAS-guarded (3자 리뷰 수정 C1, Grok F1): `job.status` is this pass's SELECT snapshot, not
      // the row's live status — jobIsReady's own DB round-trips are a real window for the row to
      // move on (claimed 'running' by a concurrent reconcile pass; dispatchTask's inline call and
      // the always-on controller's tick are NOT mutually exclusive). An unconditional write here
      // would clobber that newer state back to 'blocked', breaking done/running monotonicity.
      if (job.status !== 'blocked' && canTransitionJob(job.status, 'blocked')) {
        await sql`update jobs set status = 'blocked', status_changed_at = now() where id = ${job.id} and status in ('pending', 'blocked')`;
      }
      continue;
    }

    // A1: the claim's ready→running step is where a lease is first granted — same transaction as
    // the CAS itself, so a job can never observably be 'running' without one.
    //
    // graph-chaos.sim harness finding (v2): jobIsReady's own "no unmet dep" read above is a
    // SEPARATE, non-locking SELECT — a dep_declare call landing in the gap between that read and
    // this claim (both legitimate, unguarded against each other) used to still let the claim
    // through unconditionally, since the original claim UPDATE only ever checked `jobs.status`.
    // Once claimed, the job leaves the `pending`/`blocked` set this function scans, so nothing
    // would EVER re-evaluate that freshly-attached dep again — it would sit 'active' forever even
    // after the waiter reaches 'done'. A `not exists` subquery folded into the claim UPDATE's own
    // WHERE clause does NOT close this: Postgres read-committed re-evaluates a concurrently-locked
    // row via EvalPlanQual once the lock releases, but subqueries against OTHER tables (deps) still
    // read the UPDATE statement's ORIGINAL per-statement snapshot, not a fresh one — a dep
    // committed by the unblocking transaction stays invisible to that subquery regardless. Closing
    // it for real needs a genuinely NEW statement (own fresh snapshot) issued AFTER the row lock is
    // actually held: `for update` here serializes against insertDepTx's own `for update` lock on
    // this SAME waiter row (its first statement) — once acquired, insertDepTx has either already
    // committed (its dep now visible to the very next, separate SELECT below) or never started
    // (nothing to race). A dep landing in that gap now correctly loses this job's claim (0 rows
    // affected, same "lost the claim race" no-op path below) instead of the claim silently winning.
    const runningRows = (await sql.begin(async (tx) => {
      const lockedRows = (await tx`select status from jobs where id = ${job.id} for update`) as Array<{ status: JobStatus }>;
      const current = lockedRows[0];
      if (!current || (current.status !== 'pending' && current.status !== 'blocked')) return [] as Array<{ id: string }>;
      const unresolvedDeps = (await tx`select 1 from deps where waiter_job = ${job.id} and status <> 'released'`) as unknown[];
      if (unresolvedDeps.length > 0) return [] as Array<{ id: string }>;

      const toReady = (await tx`update jobs set status = 'ready' where id = ${job.id} and status in ('pending', 'blocked') returning id`) as Array<{
        id: string;
      }>;
      if (toReady.length === 0) return [] as Array<{ id: string }>;
      return (await tx`
        update jobs set status = 'running', status_changed_at = now(),
          lease_expires_at = now() + (${leaseTtlMs} * interval '1 millisecond')
        where id = ${job.id} and status = 'ready' returning id
      `) as Array<{ id: string }>;
    })) as Array<{ id: string }>;
    if (runningRows.length === 0) continue; // lost the claim race to another reconcile pass

    claimed.push(job.id);
    try {
      await dispatch({ id: job.id, repoId: job.repo_id, taskId, title: job.title });
    } catch {
      // CAS-guarded (3자 리뷰 수정 A라운드 A1): the job may have already moved on (lease-expiry
      // scan, gen++) by the time this catch runs — an unconditional write would clobber that.
      // Codex task#23 / P4-2b: no generation guard added here on purpose — this function is
      // generic over whatever `dispatch` callback the caller supplies (a test's own mock included),
      // it has no captured generation of its own to guard with. rest.ts's actual dispatch callback
      // (runRegisteredJob) is fire-and-forget internally (every branch — registered-closure and
      // reconstructed alike — wraps its own execution in `.catch(() => undefined)`), so it never
      // actually throws; this catch is unreachable through THAT caller and only exists for the
      // generic contract (a `dispatch` that legitimately throws, e.g. in this file's own tests).
      await sql`update jobs set status = 'failed', status_changed_at = now(), lease_expires_at = null where id = ${job.id} and status = 'running'`.catch(
        () => undefined,
      );
    }
  }

  return { claimed };
}
