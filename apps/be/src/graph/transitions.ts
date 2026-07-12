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
