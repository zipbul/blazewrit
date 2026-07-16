import type { SQL } from 'bun';
import { computeReady, evaluateDep, isStaleMember, jobTargetOutcome, taskTargetOutcome, type DepMemberEval } from './deps';
import { canTransitionJob } from './transitions';
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
    const runningRows = (await sql.begin(async (tx) => {
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
      await sql`update jobs set status = 'failed', status_changed_at = now(), lease_expires_at = null where id = ${job.id} and status = 'running'`.catch(
        () => undefined,
      );
    }
  }

  return { claimed };
}
