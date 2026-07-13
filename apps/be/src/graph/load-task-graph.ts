import type { SQL } from 'bun';
import type { CycleEdge, CycleJob } from './cycle';
import type { DepTargetType } from './types';

/**
 * Loads a task's CURRENT job/dep graph in the shape validateAssembly needs (harness/job-graph.md
 * migration step 9's replacement for dispatchTask's `[], []` stand-in — a new assembly is now
 * checked against the task's REAL jobs/edges instead of an empty placeholder). Read-only, no
 * side effects.
 *
 * Edges are one row per dep_member (cycle.ts's own granularity — a dep with 2 members is 2 edges,
 * not 1), regardless of the dep's/member's current status — a released or stale dep still
 * structurally represents a declared wait, which is what cycle detection cares about.
 */
export async function loadTaskGraph(sql: SQL, taskId: string): Promise<{ jobs: CycleJob[]; edges: CycleEdge[] }> {
  const jobRows = (await sql`select id, task_id from jobs where task_id = ${taskId} order by created_at`) as Array<{ id: string; task_id: string }>;
  const jobs: CycleJob[] = jobRows.map((j) => ({ id: j.id, taskId: j.task_id }));

  const edgeRows = (await sql`
    select d.waiter_job, dm.target_type, dm.target_id
    from deps d
    join dep_members dm on dm.dep_id = d.id
    where d.waiter_job in (select id from jobs where task_id = ${taskId})
    order by d.id, dm.target_type, dm.target_id
  `) as Array<{ waiter_job: string; target_type: DepTargetType; target_id: string }>;
  const edges: CycleEdge[] = edgeRows.map((e) => ({ waiterJobId: e.waiter_job, targetType: e.target_type, targetId: e.target_id }));

  return { jobs, edges };
}
