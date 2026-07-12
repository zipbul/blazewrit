import { isTerminalJobStatus } from './transitions';
import type { JobStatus } from './types';

export interface DeriveTaskStatusInput {
  /** distinct repo_id from jobs where task_id = T. A repo with zero jobs under T is never a member (D5). */
  participatingRepoIds: string[];
  /** repo_ids that currently hold a task_seals row for T (may include repos outside participatingRepoIds — ignored). */
  sealedRepoIds: string[];
  /** every job's status under T, across all participating repos, order irrelevant. */
  jobStatuses: JobStatus[];
}

/**
 * Rule 3 (done atomicity) + rule 6: pure derivation of task.status from the current graph facts.
 * Never returns 'cancelled' — cancellation is an explicit command (see cancelTask, rule 9 / D6),
 * not something derived from job/seal state, and the return type enforces that at compile time.
 */
export function deriveTaskStatus(input: DeriveTaskStatusInput): 'open' | 'done' | 'failed' {
  // No participating repo yet (no jobs ever inserted under this task) — nothing has actually
  // happened, so don't vacuously derive 'done'. Untested by spec; see handoff report.
  if (input.participatingRepoIds.length === 0) return 'open';

  const allSealed = input.participatingRepoIds.every((r) => input.sealedRepoIds.includes(r));
  if (!allSealed) return 'open';

  const allTerminal = input.jobStatuses.every(isTerminalJobStatus);
  if (!allTerminal) return 'open';

  const allDone = input.jobStatuses.every((s) => s === 'done');
  if (allDone) return 'done';

  const anyFailed = input.jobStatuses.some((s) => s === 'failed');
  if (anyFailed) return 'failed';

  // All sealed, all terminal, none failed, but not all done (e.g. a mix of 'done'/'cancelled').
  // Not pinned by any test — team-lead direction: "그 외 open" (see handoff report).
  return 'open';
}

/**
 * Rule 9: explicit cancel. Takes no graph facts — the signature itself is the proof that
 * cancellation is a command, never a derivation from jobs/seals (that's deriveTaskStatus's job,
 * and its return type can't produce 'cancelled').
 */
export function cancelTask(): 'cancelled' {
  return 'cancelled';
}
