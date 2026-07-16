import type { SQL } from 'bun';
import type { OrchestratorStore } from '../orchestrator/types';

/** Reconcile claim lease TTL (harness/job-graph.md P2 spec A1) — shared by reconcile.ts's claim
 * step and this module's heartbeat renewal, so a step transition always extends the lease by the
 * same window the claim originally granted it. */
export const DEFAULT_LEASE_TTL_MS = 10 * 60 * 1000;

/**
 * Extends `jobId`'s lease by `ttlMs` from now — only while it's still 'running' AND still on the
 * SAME `generation` the caller is renewing on behalf of. The status guard alone matters (a job
 * that already went terminal, or got reverted to pending as an orphan, must not have its lease
 * silently resurrected by a late-arriving renewal from a step that no longer matters) — but status
 * alone isn't enough: a lease-expiry scan can fail a job, bumpJobGeneration (graph/store.ts) can
 * gen++ it back to pending, and a re-claim can put it BACK to 'running' at the new generation,
 * all before a stale heartbeat from the SUPERSEDED run finally lands. Without the generation
 * guard, that stale heartbeat would still match `status = 'running'` and keep renewing a lease
 * that belongs to a completely different run — exactly the escape hatch the caller's own
 * generation-guarded terminal writes (rest.ts's executeJobFlow) are trying to close (3자 리뷰 수정
 * E1, Fable M1: renewLease was the other half of that same hole — the terminal writes could lose
 * the race, but a stray renewal could still keep the stale run's lease alive long enough to matter).
 */
export async function renewLease(sql: SQL, jobId: string, ttlMs: number, generation: number): Promise<void> {
  await sql`
    update jobs set lease_expires_at = now() + (${ttlMs} * interval '1 millisecond')
    where id = ${jobId} and status = 'running' and generation = ${generation}
  `;
}

/**
 * Wraps an OrchestratorStore so every step transition also renews the job's lease (harness/
 * job-graph.md P2 spec: "heartbeat = 스텝 전이" — no separate timer; a flow that's actually
 * making progress calls setCurrentStep at the start of every step, and a stalled/crashed one
 * simply stops calling it, so its lease lapses on its own). orchestrator.ts stays entirely
 * graph-ignorant — this wraps the store ONE layer outside the existing `publishing()` SSE
 * wrapper, at the dispatch call site (rest.ts), not inside runFlow itself.
 *
 * Also intercepts setStatus (3자 리뷰 수정 A라운드 A2): a HITL pause (`'suspended'`) is a job
 * waiting on a HUMAN, not a crashed worker — a lease exists to detect the latter, so it's cleared
 * on suspend (the controller's lease-expiry scan already skips a null lease) rather than left to
 * silently lapse and get the job wrongly marked failed mid-decision. Resuming (`'active'`)
 * reloads it exactly as claim/heartbeat do. Every other status (`'completed'`/`'abandoned'`)
 * passes through untouched — executeJobFlow's own completion dual-write already clears the lease
 * for those.
 *
 * `generation` (3자 리뷰 수정 E1, Fable M1): the generation THIS wrapped store's caller is running
 * on behalf of — captured once by rest.ts's executeJobFlow at dispatch time, not re-read live, so
 * a stale wrapper instance from a superseded run can never renew (or suspend-clear/resume-reload)
 * a lease that now belongs to a different generation's claim. Threaded into every write below,
 * including the suspend-clear: an unguarded clear would otherwise null out a CURRENT generation's
 * live lease in response to a stale HITL signal from a run that no longer owns this job.
 */
export function withLeaseHeartbeat(store: OrchestratorStore, sql: SQL, jobId: string, ttlMs: number, generation: number): OrchestratorStore {
  return {
    ...store,
    setCurrentStep: async (flowId, step) => {
      await store.setCurrentStep(flowId, step);
      await renewLease(sql, jobId, ttlMs, generation);
    },
    setStatus: async (flowId, status) => {
      await store.setStatus(flowId, status);
      if (status === 'suspended') {
        await sql`update jobs set lease_expires_at = null where id = ${jobId} and status = 'running' and generation = ${generation}`;
      } else if (status === 'active') {
        await renewLease(sql, jobId, ttlMs, generation);
      }
    },
  };
}
