import type { SQL } from 'bun';
import { reconcileTask, type ReconcileJob } from './reconcile';
import { DEFAULT_LEASE_TTL_MS } from './lease';

export interface GraphControllerOpts {
  /** How often the periodic sweep runs. Conservative default — a live dispatch's own inline
   * reconcile (migration step 8) already handles the common case; this is the restart/crash net. */
  tickMs?: number;
  /** Passed through to every reconcileTask call this pass makes. */
  leaseTtlMs?: number;
}

export interface TickResult {
  /** Job ids failed by this pass because their running lease had already lapsed. */
  expired: string[];
  /** Job ids claimed and handed to `dispatch` by this pass's reconcileTask calls. */
  reconciled: string[];
}

export interface GraphController {
  /** Runs one full pass immediately (bypasses the timer) — tests drive this directly. */
  tick(): Promise<TickResult>;
  /** Stops the periodic timer. Does not affect an in-flight tick() or disable future manual calls. */
  stop(): void;
}

const DEFAULT_TICK_MS = 60_000;

/**
 * Always-on reconcile controller (harness/job-graph.md P2: "reconcile 컨트롤러 (ready·lease·
 * 원자claim·재시작 reconcile·규칙 4·5)" — ready/claim landed in migration step 8; this is the
 * restart + periodic + lease-expiry half). Each pass:
 *  1. Fails any 'running' job whose lease has already lapsed (A3) — nothing has been renewing its
 *     heartbeat (lease.ts's withLeaseHeartbeat), so nothing is still executing it.
 *  2. Re-runs reconcileTask for every OPEN task that still has a pending/blocked job — this is
 *     what makes dep-released readiness AND restart recovery (B1) self-heal without waiting for
 *     the next dispatch to touch that specific task.
 *
 * Single-flight (B4): a tick already in progress makes a concurrent call a no-op — one process,
 * no distributed lock needed. `dispatch` is supplied by the caller (rest.ts wires it to the same
 * registry-aware callback dispatchTask's own inline reconcile call uses), so this module has zero
 * knowledge of jobExecutors/orphans — it only knows "hand a ready job to whatever dispatch does".
 */
export function startGraphController(sql: SQL, dispatch: (job: ReconcileJob) => Promise<void>, opts: GraphControllerOpts = {}): GraphController {
  const tickMs = opts.tickMs ?? DEFAULT_TICK_MS;
  const leaseTtlMs = opts.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
  let inFlight = false;

  const tick = async (): Promise<TickResult> => {
    if (inFlight) return { expired: [], reconciled: [] }; // B4
    inFlight = true;
    try {
      // A3: conditional UPDATE (status = 'running' still in the WHERE) so a job that legitimately
      // finished between this SELECT and the UPDATE below is never clobbered.
      const candidates = (await sql`
        select id from jobs where status = 'running' and lease_expires_at is not null and lease_expires_at < now()
      `) as Array<{ id: string }>;
      const expired: string[] = [];
      for (const { id: jobId } of candidates) {
        const rows = (await sql`
          update jobs set status = 'failed', status_changed_at = now(), lease_expires_at = null
          where id = ${jobId} and status = 'running' and lease_expires_at < now()
          returning id
        `) as Array<{ id: string }>;
        if (rows[0]) expired.push(rows[0].id);
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

      return { expired, reconciled };
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
