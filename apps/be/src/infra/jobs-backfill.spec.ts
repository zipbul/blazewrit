import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { ensureSchema } from './schema';

// Integration test: exercises the work_items → tasks/jobs mirror (harness/job-graph.md
// migration step 3) against a live Postgres. Read-verification only — /api/work-items keeps
// reading work_items directly; nothing consumes this mirror yet.
const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const PREFIX = `jobs-backfill-${process.pid}-${Date.now()}`;
let n = 0;
const id = (label: string) => `${PREFIX}-${label}-${n++}`;

beforeAll(async () => {
  await ensureSchema(sql);
});

afterAll(async () => {
  // FK-reverse order. 'legacy' product is shared state (other suites/boots rely on it) — never delete it.
  await sql`delete from job_events where job_id like ${PREFIX + '%'}`;

  await sql`delete from jobs where id like ${PREFIX + '%'}`;
  await sql`delete from tasks where id like ${PREFIX + '%'}`;
  await sql`delete from repos where id like ${PREFIX + '%'}`;
  await sql`delete from projects where id like ${PREFIX + '%'}`;
  await sql`delete from work_items where id like ${PREFIX + '%'}`;
  await sql.end();
});

/** Inserts a project directly so the migration-step-2 repos mirror exists by the time
 * ensureSchema runs the step-3 tasks/jobs mirror (which needs jobs.repo_id → repos(id)). */
async function makeProject(projectId: string) {
  await sql`insert into projects (id, name, status) values (${projectId}, ${projectId}, 'active')`;
}

describe('schema backfill: work_items → tasks/jobs (harness/job-graph.md step 3)', () => {
  test('mirrors an in_flow work_item into a running job under an open task', async () => {
    const projectId = id('project');
    await makeProject(projectId);
    const contextId = id('context');
    const workItemId = id('wi');
    await sql`insert into work_items (id, project_id, type, state, title, context_id)
      values (${workItemId}, ${projectId}, 'flow', 'in_flow', 'do the thing', ${contextId})`;
    await ensureSchema(sql);

    const jobs = (await sql`
      select id, task_id, repo_id, status, generation, legacy_work_item_id from jobs where id = ${workItemId}
    `) as Array<{
      id: string;
      task_id: string;
      repo_id: string;
      status: string;
      generation: number;
      legacy_work_item_id: string;
    }>;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.task_id).toBe(contextId);
    expect(jobs[0]!.repo_id).toBe(projectId);
    expect(jobs[0]!.status).toBe('running');
    expect(jobs[0]!.generation).toBe(1);
    expect(jobs[0]!.legacy_work_item_id).toBe(workItemId);

    const tasks = (await sql`select id, status from tasks where id = ${contextId}`) as Array<{
      id: string;
      status: string;
    }>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.status).toBe('open');
  });

  test('mirrors a done work_item into a done job, and the task mirror still stays open', async () => {
    const projectId = id('project');
    await makeProject(projectId);
    const contextId = id('context');
    const workItemId = id('wi');
    await sql`insert into work_items (id, project_id, type, state, title, context_id)
      values (${workItemId}, ${projectId}, 'flow', 'done', 'finished thing', ${contextId})`;
    await ensureSchema(sql);

    const jobs = (await sql`select status from jobs where id = ${workItemId}`) as Array<{ status: string }>;
    expect(jobs[0]!.status).toBe('done');
    const tasks = (await sql`select status from tasks where id = ${contextId}`) as Array<{ status: string }>;
    expect(tasks[0]!.status).toBe('open');
  });

  test('mirrors a blocked work_item into a failed job', async () => {
    const projectId = id('project');
    await makeProject(projectId);
    const contextId = id('context');
    const workItemId = id('wi');
    await sql`insert into work_items (id, project_id, type, state, title, context_id)
      values (${workItemId}, ${projectId}, 'flow', 'blocked', 'stuck thing', ${contextId})`;
    await ensureSchema(sql);

    const jobs = (await sql`select status from jobs where id = ${workItemId}`) as Array<{ status: string }>;
    expect(jobs[0]!.status).toBe('failed');
  });

  test('collapses work_items sharing a context_id across two projects into one task with two jobs', async () => {
    const projectA = id('project');
    const projectB = id('project');
    await makeProject(projectA);
    await makeProject(projectB);
    const contextId = id('context');
    const workItemA = id('wi');
    const workItemB = id('wi');
    await sql`insert into work_items (id, project_id, type, state, title, context_id)
      values (${workItemA}, ${projectA}, 'flow', 'in_flow', 'side A', ${contextId})`;
    await sql`insert into work_items (id, project_id, type, state, title, context_id)
      values (${workItemB}, ${projectB}, 'flow', 'in_flow', 'side B', ${contextId})`;
    await ensureSchema(sql);

    const tasks = (await sql`select id from tasks where id = ${contextId}`) as Array<{ id: string }>;
    expect(tasks).toHaveLength(1);

    const jobs = (await sql`
      select id, repo_id from jobs where task_id = ${contextId} order by repo_id
    `) as Array<{ id: string; repo_id: string }>;
    expect(jobs).toHaveLength(2);
    expect(jobs.map((j) => j.repo_id).sort()).toEqual([projectA, projectB].sort());
  });

  /**
   * 3자 리뷰 수정 B2-2 (Codex major #22): the mirror insert is `on conflict (id) do nothing` — it
   * only ever WRITES a mirrored job on the boot that first sees the source work_item. If that
   * work_item was still 'in_flow' at that boot (mirrored as 'running') and only reaches done/
   * blocked AFTER this process started (a live dispatch's own completion dual-write doesn't touch
   * BACKFILLED rows — it only ever updates the row for the workItemId it itself is running), the
   * mirror is stuck 'running' forever, even though the source has long since finished.
   */
  test('self-heals a stale running mirror once the source work_item reaches done (rollout-window race)', async () => {
    const projectId = id('project');
    await makeProject(projectId);
    const contextId = id('context');
    const workItemId = id('wi');
    await sql`insert into work_items (id, project_id, type, state, title, context_id)
      values (${workItemId}, ${projectId}, 'flow', 'in_flow', 'do the thing', ${contextId})`;
    await ensureSchema(sql); // first boot: mirrors as 'running'

    const firstPass = (await sql`select status from jobs where id = ${workItemId}`) as Array<{ status: string }>;
    expect(firstPass[0]!.status).toBe('running');

    // The source finishes AFTER the mirror was created — nothing else ever revisits this row.
    await sql`update work_items set state = 'done' where id = ${workItemId}`;
    await ensureSchema(sql); // second boot: self-heal should catch up

    const secondPass = (await sql`select status from jobs where id = ${workItemId}`) as Array<{ status: string }>;
    expect(secondPass[0]!.status).toBe('done');
  });

  test('self-heals a stale running mirror to failed once the source work_item is blocked', async () => {
    const projectId = id('project');
    await makeProject(projectId);
    const contextId = id('context');
    const workItemId = id('wi');
    await sql`insert into work_items (id, project_id, type, state, title, context_id)
      values (${workItemId}, ${projectId}, 'flow', 'in_flow', 'do the thing', ${contextId})`;
    await ensureSchema(sql);

    await sql`update work_items set state = 'blocked' where id = ${workItemId}`;
    await ensureSchema(sql);

    const jobs = (await sql`select status from jobs where id = ${workItemId}`) as Array<{ status: string }>;
    expect(jobs[0]!.status).toBe('failed');
  });

  test('does not re-touch an already-terminal mirror on repeated ensureSchema runs (idempotent)', async () => {
    const projectId = id('project');
    await makeProject(projectId);
    const contextId = id('context');
    const workItemId = id('wi');
    await sql`insert into work_items (id, project_id, type, state, title, context_id)
      values (${workItemId}, ${projectId}, 'flow', 'done', 'finished thing', ${contextId})`;
    await ensureSchema(sql);
    const before = (await sql`select status_changed_at from jobs where id = ${workItemId}`) as Array<{ status_changed_at: Date }>;

    await ensureSchema(sql);
    const after = (await sql`select status, status_changed_at from jobs where id = ${workItemId}`) as Array<{
      status: string;
      status_changed_at: Date;
    }>;
    expect(after[0]!.status).toBe('done');
    expect(after[0]!.status_changed_at.getTime()).toBe(before[0]!.status_changed_at.getTime());
  });

  test('does not duplicate the tasks/jobs mirror across repeated ensureSchema runs', async () => {
    const projectId = id('project');
    await makeProject(projectId);
    const contextId = id('context');
    const workItemId = id('wi');
    await sql`insert into work_items (id, project_id, type, state, title, context_id)
      values (${workItemId}, ${projectId}, 'flow', 'in_flow', 'do the thing', ${contextId})`;
    await ensureSchema(sql);
    await ensureSchema(sql);

    const tasks = (await sql`select id from tasks where id = ${contextId}`) as Array<{ id: string }>;
    expect(tasks).toHaveLength(1);
    const jobs = (await sql`select id from jobs where id = ${workItemId}`) as Array<{ id: string }>;
    expect(jobs).toHaveLength(1);
  });

  /**
   * 3자 리뷰 수정 E4 (Fable M4): the mirror INSERT has no filter on the anchor task's status —
   * graph/store.ts's insertJob (the REAL job-creation write path) rejects an insert under a
   * terminal task with TerminalTaskError (rule 9), but this raw backfill INSERT bypasses that
   * check entirely and would resurrect a brand-new mirror job under a task that's already closed
   * to further writes (e.g. another repo already sealed and completed that task). Reproduced by
   * pre-seeding the anchor task as already-terminal before the work_item's own context_id ever
   * points at it — the tasks upsert above is `on conflict do nothing`, so this pre-existing status
   * survives into the jobs INSERT that follows it.
   */
  test('does not mirror a work_item under an anchor task that is already terminal (rule 9 boundary)', async () => {
    const projectId = id('project');
    await makeProject(projectId);
    const contextId = id('context');
    await sql`insert into tasks (id, title, status) values (${contextId}, ${contextId}, 'done')`;
    const workItemId = id('wi');
    await sql`insert into work_items (id, project_id, type, state, title, context_id)
      values (${workItemId}, ${projectId}, 'flow', 'in_flow', 'do the thing', ${contextId})`;
    await ensureSchema(sql);

    const jobs = (await sql`select id from jobs where id = ${workItemId}`) as Array<{ id: string }>;
    expect(jobs).toHaveLength(0);
  });

  /**
   * 3자 리뷰 수정 E5 (Fable M5): the self-heal above (B2-2) only ever checked the mirror's own
   * status ('running' -> done/failed once the source resolves) — it never checked GENERATION.
   * bumpJobGeneration (graph/store.ts) can gen++ a terminal mirror back to 'pending' at generation
   * 2 (a real re-run slot, independent of the untouched legacy work_item row) — without a
   * generation guard, the very next boot's self-heal reads the still-terminal work_item and slams
   * that fresh re-run slot straight back to done/failed, discarding it before it ever got claimed.
   */
  test('does not re-terminal a gen++\'d mirror job even once the source work_item reads done', async () => {
    const projectId = id('project');
    await makeProject(projectId);
    const contextId = id('context');
    const workItemId = id('wi');
    await sql`insert into work_items (id, project_id, type, state, title, context_id)
      values (${workItemId}, ${projectId}, 'flow', 'in_flow', 'do the thing', ${contextId})`;
    await ensureSchema(sql); // first boot: mirrors as 'running', generation 1

    // A real re-run cycle already moved this job on, independent of the legacy work_item row
    // (which nothing else in this rollout-window scenario ever revisits again).
    await sql`update jobs set status = 'pending', generation = 2 where id = ${workItemId}`;
    await sql`update work_items set state = 'done' where id = ${workItemId}`;
    await ensureSchema(sql); // second boot: self-heal must not touch a job past its original generation

    const jobs = (await sql`select status, generation from jobs where id = ${workItemId}`) as Array<{
      status: string;
      generation: number;
    }>;
    expect(jobs[0]!.status).toBe('pending');
    expect(jobs[0]!.generation).toBe(2);
  });
});
