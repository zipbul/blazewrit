import type { DepOutcome, DepPredicate, DepStatus, DepTargetType, JobStatus, TaskStatus } from './types';

/** A dep_member reduced to what evaluateDep needs — staleness precomputed via isStaleMember. */
export interface DepMemberEval {
  outcome: DepOutcome;
  acceptable: DepOutcome[];
  stale: boolean;
}

/** Rule: a job-target dep_member's outcome is 1:1 with the target job's status. Non-terminal → 'pending'. */
export function jobTargetOutcome(status: JobStatus): DepOutcome {
  if (status === 'done') return 'satisfied';
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  return 'pending';
}

/** Rule 6: a task-target dep_member's outcome is 1:1 with the target task's status (no per-job inspection). */
export function taskTargetOutcome(status: TaskStatus): DepOutcome {
  if (status === 'open') return 'pending';
  if (status === 'done') return 'satisfied';
  if (status === 'failed') return 'failed';
  return 'cancelled';
}

/**
 * Rule 5: whether a job-target member's declared generation no longer matches the job's actual
 * generation. Only job targets can go stale — task/external targets ignore `actualGen`.
 */
export function isStaleMember(member: { targetType: DepTargetType; expectedGen?: number }, actualGen?: number): boolean {
  if (member.targetType !== 'job') return false;
  if (member.expectedGen === undefined) return false;
  return member.expectedGen !== actualGen;
}

/** Whether one dep_member counts as met: its outcome isn't 'pending' and is in its own acceptable set. */
export function memberSatisfied(member: { outcome: DepOutcome; acceptable: DepOutcome[] }): boolean {
  return member.outcome !== 'pending' && member.acceptable.includes(member.outcome);
}

/**
 * Recomputes one dep's status from its members + predicate (AND/OR across members of the SAME
 * dep row). Rule 11 (latch): once a dep is 'released' it never reverts, no matter what its
 * members do afterward (e.g. a job target regenerating back to 'pending' after gen++ must not
 * un-release the dep).
 */
export function evaluateDep(dep: { predicate: DepPredicate; status: DepStatus }, members: DepMemberEval[]): DepStatus {
  if (dep.status === 'released') return 'released'; // rule 11 latch — never revert once released

  const released = dep.predicate === 'all' ? members.every(memberSatisfied) : members.some(memberSatisfied);
  if (released) return 'released';

  if (members.some((m) => m.stale)) return 'stale';
  return 'active';
}

/** Whether a pending/blocked job is ready: every one of ITS OWN deps is released (AND across deps). No deps = ready. */
export function computeReady(deps: Array<{ status: DepStatus }>): boolean {
  return deps.every((d) => d.status === 'released');
}
