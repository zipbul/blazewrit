import type { SQL } from 'bun';
import type { OrchestratorStore } from '../orchestrator/types';

/** Reconcile claim lease TTL (harness/job-graph.md P2 spec A1) — shared by reconcile.ts's claim
 * step and this module's heartbeat renewal, so a step transition always extends the lease by the
 * same window the claim originally granted it. */
export const DEFAULT_LEASE_TTL_MS = 10 * 60 * 1000;

/**
 * Extends `jobId`'s lease by `ttlMs` from now — only while it's still 'running'. The status guard
 * matters: a job that already went terminal (or got reverted to pending as an orphan) must not
 * have its lease silently resurrected by a late-arriving renewal from a step that no longer
 * matters.
 */
export async function renewLease(sql: SQL, jobId: string, ttlMs: number): Promise<void> {
  await sql`
    update jobs set lease_expires_at = now() + (${ttlMs} * interval '1 millisecond')
    where id = ${jobId} and status = 'running'
  `;
}

/**
 * Wraps an OrchestratorStore so every step transition also renews the job's lease (harness/
 * job-graph.md P2 spec: "heartbeat = 스텝 전이" — no separate timer; a flow that's actually
 * making progress calls setCurrentStep at the start of every step, and a stalled/crashed one
 * simply stops calling it, so its lease lapses on its own). orchestrator.ts stays entirely
 * graph-ignorant — this wraps the store ONE layer outside the existing `publishing()` SSE
 * wrapper, at the dispatch call site (rest.ts), not inside runFlow itself.
 */
export function withLeaseHeartbeat(store: OrchestratorStore, sql: SQL, jobId: string, ttlMs: number): OrchestratorStore {
  return {
    ...store,
    setCurrentStep: async (flowId, step) => {
      await store.setCurrentStep(flowId, step);
      await renewLease(sql, jobId, ttlMs);
    },
  };
}
