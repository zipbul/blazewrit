import type { SQL } from 'bun';
import { reconcileTask, type ReconcileJob } from './reconcile';
import { DEFAULT_LEASE_TTL_MS } from './lease';
import { raiseWake, type WakeInput } from './wake';
import { deriveTaskStatus } from './derive';
import { rederiveTask } from './store';
import { isTerminalJobStatus } from './transitions';
import type { JobStatus } from './types';

export interface GraphControllerOpts {
  /** How often the periodic sweep runs. Conservative default — a live dispatch's own inline
   * reconcile (migration step 8) already handles the common case; this is the restart/crash net. */
  tickMs?: number;
  /** Passed through to every reconcileTask call this pass makes. */
  leaseTtlMs?: number;
  /** How long a job may sit 'blocked' before it's considered stalled (rule 4, spec C1). */
  stallThresholdMs?: number;
  /** Fired for every wake this pass actually raised (not suppressed by dedup, spec E2). */
  onWake?: (w: WakeInput) => void;
  /** Id source for raised wake records. */
  newId?: () => string;
}

export interface TickResult {
  /** Job ids failed by this pass because their running lease had already lapsed. */
  expired: string[];
  /** Job ids claimed and handed to `dispatch` by this pass's reconcileTask calls. */
  reconciled: string[];
  /** Wake records actually raised this pass (dedup-suppressed repeats are not included). */
  wakes: WakeInput[];
}

export interface GraphController {
  /** Runs one full pass immediately (bypasses the timer) — tests drive this directly. */
  tick(): Promise<TickResult>;
  /** Stops the periodic timer. Does not affect an in-flight tick() or disable future manual calls. */
  stop(): void;
}

const DEFAULT_TICK_MS = 60_000;
const DEFAULT_STALL_THRESHOLD_MS = 15 * 60 * 1000;

/**
 * Always-on reconcile controller (harness/job-graph.md P2: "reconcile 컨트롤러 (ready·lease·
 * 원자claim·재시작 reconcile·규칙 4·5)" — ready/claim landed in migration step 8, lease/restart in
 * round 1; this round adds rules 4/5's wake records — C/D/E). Each pass, in order:
 *  1. Fails any 'running' job whose lease has already lapsed (A3) + raises a lease_expired wake.
 *  2. Re-runs reconcileTask for every OPEN task that still has a pending/blocked job (B1/B3) — this
 *     is what makes dep-released readiness AND restart recovery self-heal, and is what can newly
 *     mark a dep 'stale' (evaluateDep, rule 5) for step 5 below to find.
 *  3. Rule 4 (C1): a 'blocked' job whose status_changed_at is older than stallThresholdMs raises a
 *     stalled wake. No auto-release (C3) — this step only reads deps/dep_members, never writes them.
 *  4. Rule 4 (C2): an open task whose participating repos are all sealed and all its jobs are
 *     terminal, but deriveTaskStatus still says 'open' (a done/cancelled mix with no failure —
 *     ccbdd9b's decision), raises an unresolvable_task wake.
 *  5. Rule 5 (D1): every dep left 'stale' after step 2's reconcile passes raises a stale_dep wake.
 *     No auto-resolution (D2) — the dep's status is never touched here.
 *
 * Single-flight (B4): a tick already in progress makes a concurrent call a no-op — one process,
 * no distributed lock needed. `dispatch` is supplied by the caller (rest.ts wires it to the same
 * registry-aware callback dispatchTask's own inline reconcile call uses), so this module has zero
 * knowledge of jobExecutors/orphans — it only knows "hand a ready job to whatever dispatch does".
 */
export function startGraphController(sql: SQL, dispatch: (job: ReconcileJob) => Promise<void>, opts: GraphControllerOpts = {}): GraphController {
  const tickMs = opts.tickMs ?? DEFAULT_TICK_MS;
  const leaseTtlMs = opts.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
  const stallThresholdMs = opts.stallThresholdMs ?? DEFAULT_STALL_THRESHOLD_MS;
  const newId = opts.newId ?? (() => crypto.randomUUID());
  let inFlight = false;

  const tick = async (): Promise<TickResult> => {
    if (inFlight) return { expired: [], reconciled: [], wakes: [] }; // B4
    inFlight = true;
    try {
      const wakes: WakeInput[] = [];
      const wake = async (w: WakeInput): Promise<void> => {
        const result = await raiseWake(sql, w, newId);
        if (result.raised) {
          wakes.push(w);
          opts.onWake?.(w);
        }
      };

      // A3: conditional UPDATE (status = 'running' still in the WHERE) so a job that legitimately
      // finished between this SELECT and the UPDATE below is never clobbered.
      const candidates = (await sql`
        select id, task_id from jobs where status = 'running' and lease_expires_at is not null and lease_expires_at < now()
      `) as Array<{ id: string; task_id: string }>;
      const expired: string[] = [];
      for (const { id: jobId, task_id: taskId } of candidates) {
        const rows = (await sql`
          update jobs set status = 'failed', status_changed_at = now(), lease_expires_at = null
          where id = ${jobId} and status = 'running' and lease_expires_at < now()
          returning id
        `) as Array<{ id: string }>;
        if (rows[0]) {
          expired.push(rows[0].id);
          await wake({ kind: 'lease_expired', taskId, jobId, reason: `잡 실행 lease가 만료되어 실패 처리했습니다 (jobId=${jobId}).` });
        }
      }

      // A6 (3자 리뷰 수정 C3, Grok F12): a 'running' job with lease_expires_at NULL is ALWAYS
      // abnormal — a legitimate claim (reconcileTask's ready→running transaction) grants a lease
      // in the SAME transaction as the status write, so there is no window in which a genuinely
      // claimed job is ever observed running with no lease. A crashed process's boot backfill
      // (schema.ts's in_flow -> 'running' mirror, no lease set) is the known source. None of the
      // other scans catch this shape (A3 requires lease NOT NULL; reconcile only touches
      // pending/blocked; the stall backstop only scans 'blocked') — left unresolved forever
      // otherwise. No auto-failure (rule 4 spirit, same as C1/C2 below): a human decides whether
      // this is a genuine crash or a backfill artifact still worth re-registering.
      const zombieRunning = (await sql`
        select id, task_id, title from jobs
        where status = 'running' and lease_expires_at is null
          and status_changed_at < now() - (${stallThresholdMs} * interval '1 millisecond')
      `) as Array<{ id: string; task_id: string; title: string }>;
      for (const job of zombieRunning) {
        await wake({
          kind: 'orphaned_ready',
          taskId: job.task_id,
          jobId: job.id,
          reason: `잡 "${job.title}"이(가) lease 없이 running 상태로 정체되어 있습니다 — 크래시 또는 백필 잔류로 보입니다.`,
        });
      }

      // B1/B3: every open task with a pending/blocked job gets a fresh pass.
      const taskRows = (await sql`
        select distinct j.task_id as id from jobs j join tasks t on t.id = j.task_id
        where t.status = 'open' and j.status in ('pending', 'blocked')
      `) as Array<{ id: string }>;
      const reconciled: string[] = [];
      for (const { id: taskId } of taskRows) {
        const result = await reconcileTask(sql, taskId, dispatch, { leaseTtlMs });
        reconciled.push(...result.claimed);
      }

      // C1: blocked jobs stalled past the threshold — reason describes what it's still waiting on.
      const stalledJobs = (await sql`
        select id, task_id, title from jobs
        where status = 'blocked' and status_changed_at < now() - (${stallThresholdMs} * interval '1 millisecond')
      `) as Array<{ id: string; task_id: string; title: string }>;
      for (const job of stalledJobs) {
        const depRows = (await sql`
          select dm.target_type, dm.target_id from deps d
          join dep_members dm on dm.dep_id = d.id
          where d.waiter_job = ${job.id} and d.status <> 'released'
        `) as Array<{ target_type: string; target_id: string }>;
        const depDesc = depRows.length ? depRows.map((d) => `${d.target_type}:${d.target_id}`).join(', ') : '(등록된 dep 없음)';
        await wake({
          kind: 'stalled',
          taskId: job.task_id,
          jobId: job.id,
          reason: `잡 "${job.title}"이(가) ${Math.round(stallThresholdMs / 60_000)}분 넘게 정체되어 있습니다 — 대기 중: ${depDesc}`,
        });
      }

      // C2: open tasks where every participating repo has sealed and every job is terminal, but
      // deriveTaskStatus still reads 'open' — a done/cancelled mix with no failure (ccbdd9b).
      // 3자 리뷰 수정 B1-4 (실측 #28): pre-filtered in SQL instead of loading every open task and
      // running a per-task jobs query against each one — with 344 open tasks in the shared dev DB
      // this scan alone measured ~100-130ms/tick. A candidate must have at least one seal AND at
      // least one job AND no non-terminal job; this narrows to the SAME set the old app-level
      // `jobRows.length === 0 || !jobRows.every(isTerminalJobStatus)` skip already limited itself
      // to — no behavior change, just doing it in one query instead of N+1. The "every
      // PARTICIPATING repo sealed" check (not just "some repo sealed") still happens below, same
      // as before — this pre-filter only needs to rule out tasks with NO seal at all.
      const openTasks = (await sql`
        select id, title from tasks
        where status = 'open'
          and exists (select 1 from task_seals ts where ts.task_id = tasks.id)
          and exists (select 1 from jobs j where j.task_id = tasks.id)
          and not exists (select 1 from jobs j where j.task_id = tasks.id and j.status not in ('done', 'failed', 'cancelled'))
      `) as Array<{ id: string; title: string }>;
      for (const task of openTasks) {
        const jobRows = (await sql`select status, repo_id from jobs where task_id = ${task.id}`) as Array<{ status: JobStatus; repo_id: string }>;
        if (jobRows.length === 0 || !jobRows.every((j) => isTerminalJobStatus(j.status))) continue;
        const participatingRepoIds = [...new Set(jobRows.map((j) => j.repo_id))];
        const sealedRows = (await sql`select repo_id from task_seals where task_id = ${task.id}`) as Array<{ repo_id: string }>;
        const sealedRepoIds = sealedRows.map((r) => r.repo_id);
        if (!participatingRepoIds.every((r) => sealedRepoIds.includes(r))) continue;
        const derived = deriveTaskStatus({ participatingRepoIds, sealedRepoIds, jobStatuses: jobRows.map((j) => j.status) });
        if (derived === 'open') {
          await wake({
            kind: 'unresolvable_task',
            taskId: task.id,
            reason: `태스크 "${task.title}"이(가) done/cancelled가 섞인 채 해소되지 않았습니다 — 사람 판단이 필요합니다.`,
          });
        } else {
          // 3자 리뷰 수정 B1-1 (Fable#3): derived is done/failed but sealTaskSliceAndDerive (the
          // only OTHER write path) already ran at seal time, before this job reached terminal — so
          // nothing has re-derived since. Without this, a task whose participating repos all sealed
          // BEFORE its last job finished would stay 'open' forever. rederiveTask re-checks under its
          // own lock (not this candidate scan's already-stale read) and writes only open->done|failed.
          await rederiveTask(sql, task.id);
        }
      }

      // D1: deps left 'stale' by this pass's reconcile calls (rule 5) — no auto-resolution (D2).
      const staleDeps = (await sql`select id, waiter_job from deps where status = 'stale'`) as Array<{ id: string; waiter_job: string }>;
      for (const dep of staleDeps) {
        const waiterRows = (await sql`select task_id from jobs where id = ${dep.waiter_job}`) as Array<{ task_id: string }>;
        const taskId = waiterRows[0]?.task_id;
        if (!taskId) continue;
        const memberRows = (await sql`
          select dm.target_type, dm.target_id, dm.expected_gen, j.generation as actual_gen
          from dep_members dm left join jobs j on j.id = dm.target_id and dm.target_type = 'job'
          where dm.dep_id = ${dep.id}
        `) as Array<{ target_type: string; target_id: string; expected_gen: number | null; actual_gen: number | null }>;
        const memberDesc = memberRows
          .map((m) => `${m.target_type}:${m.target_id}(기대 gen=${m.expected_gen ?? '-'}, 실제 gen=${m.actual_gen ?? '-'})`)
          .join(', ');
        await wake({
          kind: 'stale_dep',
          taskId,
          depId: dep.id,
          reason: `잡(${dep.waiter_job})의 dep가 stale 상태입니다 — ${memberDesc || '대상 정보 없음'}`,
        });
      }

      return { expired, reconciled, wakes };
    } finally {
      inFlight = false;
    }
  };

  void tick(); // B1: restart reconcile — one full pass immediately, don't wait for the first interval
  const timer = setInterval(() => void tick(), tickMs); // B3

  return {
    tick,
    stop: () => clearInterval(timer), // B5
  };
}
