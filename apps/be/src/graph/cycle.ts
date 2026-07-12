import type { DepTargetType } from './types';

export interface CycleJob {
  id: string;
  taskId: string;
}

/** One waiter→target wait-edge, existing or proposed (rule 7 scope: job→job + job→task). */
export interface CycleEdge {
  waiterJobId: string;
  targetType: DepTargetType;
  targetId: string;
}

/**
 * Rule 7 pure cycle check: would adding `candidate` to `existingEdges` create a wait cycle?
 * `existingEdges` is assumed already acyclic — this validates ONE new edge at a time, matching
 * how dep_members rows are inserted one at a time (A8).
 *
 * job→task edges expand to "waiter waits for every job currently under that task" (`jobs`).
 * job→external edges can never close a cycle — external_gates can't be a dep waiter
 * (deps.waiter_job only references jobs) — so `candidate.targetType === 'external'` is always
 * accepted (A7), regardless of what `targetId` happens to equal.
 */
export function wouldCreateCycle(jobs: CycleJob[], existingEdges: CycleEdge[], candidate: CycleEdge): boolean {
  if (candidate.targetType === 'external') return false;

  const jobsUnderTask = (taskId: string): string[] => jobs.filter((j) => j.taskId === taskId).map((j) => j.id);

  const expandTargets = (edge: CycleEdge): string[] => {
    if (edge.targetType === 'job') return [edge.targetId];
    if (edge.targetType === 'task') return jobsUnderTask(edge.targetId);
    return [];
  };

  const adjacency = new Map<string, Set<string>>();
  for (const edge of existingEdges) {
    const targets = expandTargets(edge);
    if (targets.length === 0) continue;
    const set = adjacency.get(edge.waiterJobId) ?? new Set<string>();
    for (const t of targets) set.add(t);
    adjacency.set(edge.waiterJobId, set);
  }

  const startNodes = expandTargets(candidate);
  if (startNodes.length === 0) return false;

  // Reachability from the candidate's (expanded) targets, via existing wait-edges: if that
  // reaches the candidate's own waiter, the new edge would close a cycle.
  const visited = new Set<string>();
  const stack = [...startNodes];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (visited.has(node)) continue;
    visited.add(node);
    const next = adjacency.get(node);
    if (next) for (const n of next) if (!visited.has(n)) stack.push(n);
  }

  return visited.has(candidate.waiterJobId);
}
