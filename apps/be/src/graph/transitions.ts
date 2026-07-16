import type { JobStatus } from './types';

/** Whether a job status is terminal (done/failed/cancelled) — no transition exists out of it. */
export function isTerminalJobStatus(status: JobStatus): boolean {
  return status === 'done' || status === 'failed' || status === 'cancelled';
}

const WHITELIST: Record<JobStatus, JobStatus[]> = {
  pending: ['ready', 'blocked', 'cancelled'],
  blocked: ['ready', 'cancelled'],
  ready: ['running', 'cancelled'],
  running: ['done', 'failed', 'cancelled'],
  done: [],
  failed: [],
  cancelled: [],
};

/**
 * Job status-machine whitelist: pending→ready|blocked|cancelled, blocked→ready|cancelled,
 * ready→running|cancelled, running→done|failed|cancelled, terminal→(none).
 *
 * running→pending is DELIBERATELY absent. Historical note (3자 리뷰 수정 B2-3, minor 묶음):
 * rest.ts's runRegisteredJob used to do exactly this transition, raw, to revert an orphaned claim
 * (a job the always-on controller claimed but no execution closure was ever registered for in
 * THIS process) — that write is GONE (P4-2b): a registry miss now reconstructs the job's flow
 * straight from its jobs row and actually runs it to a terminal state instead of rewinding it, so
 * nothing in this codebase performs a running→pending write anymore. Still kept off the
 * whitelist, not just left absent by omission: adding it would make running→pending look like
 * something ANY caller may do mid-flow through the normal transition machinery, which was never
 * true and still isn't (a job legitimately running its own flow must never be silently rewound to
 * pending under it) — the whitelist should stay a description of what's actually reachable, not
 * grow a hole for a write pattern this codebase no longer has any use for.
 */
export function canTransitionJob(from: JobStatus, to: JobStatus): boolean {
  return WHITELIST[from].includes(to);
}

export interface JobGeneration {
  status: JobStatus;
  generation: number;
}

export type BumpGenerationResult = { ok: true; job: JobGeneration } | { ok: false; reason: string };

/**
 * Re-run = same row, generation+1, status→pending (rule 9's gen++, never a new row). Only valid
 * from a terminal job status — a non-terminal job is still in flight, nothing to rewind.
 */
export function bumpGeneration(job: JobGeneration): BumpGenerationResult {
  if (!isTerminalJobStatus(job.status)) {
    return { ok: false, reason: `job is not terminal (status: ${job.status}) — nothing to rewind` };
  }
  return { ok: true, job: { status: 'pending', generation: job.generation + 1 } };
}
