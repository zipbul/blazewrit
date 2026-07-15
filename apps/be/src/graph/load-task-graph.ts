import type { SQL } from 'bun';
import type { CycleEdge, CycleJob } from './cycle';
import type { DepTargetType } from './types';

/**
 * Loads the ENTIRE graph's CURRENT job/dep edges in the shape validateAssembly needs (harness/
 * job-graph.md migration step 9's replacement for dispatchTask's `[], []` stand-in — a new
 * assembly is now checked against the REAL jobs/edges instead of an empty placeholder). Read-only,
 * no side effects.
 *
 * GLOBAL by design — 3자 리뷰 수정 B1-3 (Fable#6): rule 7's cycle-check scope is "job->job +
 * job->task expansion (태스크를 소속 잡으로 펼침)", and that expansion crosses task boundaries on
 * purpose (a task-target edge means "wait for ALL of that task's jobs", which can include jobs
 * under OTHER tasks entirely). A load scoped to just the task being assembled into can only ever
 * see edges whose WAITER already lives under that task — an existing edge declared BY some OTHER
 * task that merely TARGETS this one (e.g. task A's job waits on task B) is invisible from B's own
 * scoped load, so a new job assembled under B that waits back on task A sails through
 * validateAssembly even though it closes a cross-task cycle. Loading everything, every time, is
 * the only way validateAssembly's cycle check can see edges from BOTH sides of a task-target dep
 * regardless of which task the new assembly lands in. Deliberately NOT filtered down to (e.g.)
 * non-terminal jobs/tasks — that's a scan-cost optimization (harness backlog #28), and doing it
 * here would risk silently hiding a real edge from the cycle check; correctness first.
 */
export async function loadTaskGraph(sql: SQL): Promise<{ jobs: CycleJob[]; edges: CycleEdge[] }> {
  const jobRows = (await sql`select id, task_id from jobs order by created_at`) as Array<{ id: string; task_id: string }>;
  const jobs: CycleJob[] = jobRows.map((j) => ({ id: j.id, taskId: j.task_id }));

  const edgeRows = (await sql`
    select d.waiter_job, dm.target_type, dm.target_id
    from deps d
    join dep_members dm on dm.dep_id = d.id
    order by d.id, dm.target_type, dm.target_id
  `) as Array<{ waiter_job: string; target_type: DepTargetType; target_id: string }>;
  const edges: CycleEdge[] = edgeRows.map((e) => ({ waiterJobId: e.waiter_job, targetType: e.target_type, targetId: e.target_id }));

  return { jobs, edges };
}
