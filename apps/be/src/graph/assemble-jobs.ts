import type { NewJobInput } from './store';
import { wouldCreateCycle, type CycleEdge, type CycleJob } from './cycle';
import type { DepTargetType } from './types';

/** One dep edge the assembler wants to declare alongside its jobs (rule 7 scope: job→job/task). */
export interface AssembledDep {
  waiterJobId: string;
  targetType: DepTargetType;
  targetId: string;
}

export interface AssembledGraph {
  jobs: NewJobInput[];
  deps: AssembledDep[];
}

/**
 * Decomposes one dispatched request into the job(s) + dep(s) to write under a task (harness/
 * job-graph.md migration step 7). Pure function — no DB access, no side effects.
 *
 * N=1 FIXED: this is migration step 7's feature-flag state — always returns exactly one job
 * (id = workItemId, matching the pre-existing job:work_item 1:1 convention) and no deps, so
 * dispatchTask's observable behavior is unchanged from before this migration step. Real N>1
 * decomposition (multiple jobs, cross-job/cross-task deps) opens in migration step 9.
 */
export function assembleJobs(input: { taskId: string; repoId: string; workItemId: string; request: string }): AssembledGraph {
  return {
    jobs: [{ id: input.workItemId, taskId: input.taskId, repoId: input.repoId, title: input.request }],
    deps: [],
  };
}

/**
 * Grammar validation for an assembled graph, before any of it is written (rule 7 cycle scope,
 * reusing cycle.ts's pure check). Pure function — no DB access.
 *
 * Rejects when:
 *  (a) the graph has no jobs at all — an assembler must always produce at least one job.
 *  (b) a dep's waiter isn't one of the graph's own jobs — a dep can only originate from a job
 *      this same assembly is introducing, not from some other pre-existing job.
 *  (c) a dep edge would close a wait-cycle, checked against `existingJobs`/`existingEdges` (the
 *      task's current graph) plus the new jobs, one edge at a time — each accepted edge joins
 *      the pool the next candidate is checked against, matching how dep_members rows are
 *      inserted one at a time in practice (cycle.ts's own doc comment).
 */
export function validateAssembly(
  existingJobs: CycleJob[],
  existingEdges: CycleEdge[],
  g: AssembledGraph,
): { ok: true } | { ok: false; reason: string } {
  if (g.jobs.length === 0) {
    return { ok: false, reason: 'assembled graph has no jobs' };
  }

  const ownJobIds = new Set(g.jobs.map((j) => j.id));
  for (const dep of g.deps) {
    if (!ownJobIds.has(dep.waiterJobId)) {
      return { ok: false, reason: `dep waiter ${dep.waiterJobId} is not among the assembled graph's own jobs` };
    }
    // Rejects an edge with no real target (3자 리뷰 수정 B2-3): deps.ts's evaluateDep is asymmetric
    // on a memberless dep (predicate='all' vacuously releases immediately, 'any' never releases) —
    // an edge whose own targetId is empty/missing is the same "nothing to actually wait on" case at
    // this layer (AssembledDep doesn't group several targets under one predicate yet, so a dep row
    // with SOME members but zero of them isn't expressible here — see handoff report).
    if (!dep.targetId) {
      return { ok: false, reason: `dep ${dep.waiterJobId} -> ${dep.targetType}:(empty) has no target to wait on` };
    }
  }

  const allJobs: CycleJob[] = [...existingJobs, ...g.jobs.map((j) => ({ id: j.id, taskId: j.taskId }))];
  const edges: CycleEdge[] = [...existingEdges];
  for (const dep of g.deps) {
    if (wouldCreateCycle(allJobs, edges, dep)) {
      return { ok: false, reason: `dep ${dep.waiterJobId} -> ${dep.targetType}:${dep.targetId} would create a cycle` };
    }
    edges.push(dep);
  }

  return { ok: true };
}
