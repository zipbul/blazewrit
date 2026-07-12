import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { ensureSchema } from './schema';

// Integration test: exercises the job-graph tables (harness/job-graph.md) against a live Postgres.
const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const PREFIX = `graph-${process.pid}-${Date.now()}`;
let n = 0;
const id = (label: string) => `${PREFIX}-${label}-${n++}`;

/** Builds a product → repo → task chain (the minimum every jobs/deps fixture needs). */
async function makeChain() {
  const productId = id('product');
  const repoId = id('repo');
  const taskId = id('task');
  await sql`insert into products (id, name) values (${productId}, ${productId})`;
  await sql`insert into repos (id, product_id, name, cwd) values (${repoId}, ${productId}, ${repoId}, '/tmp')`;
  await sql`insert into tasks (id, title, status) values (${taskId}, ${taskId}, 'open')`;
  return { productId, repoId, taskId };
}

beforeAll(async () => {
  await ensureSchema(sql);
});

afterAll(async () => {
  // FK-reverse order.
  await sql`delete from dep_members where dep_id like ${PREFIX + '%'}`;
  await sql`delete from external_gates where task_id like ${PREFIX + '%'}`;
  await sql`delete from deps where id like ${PREFIX + '%'}`;
  await sql`delete from jobs where id like ${PREFIX + '%'}`;
  await sql`delete from task_seals where task_id like ${PREFIX + '%'}`;
  await sql`delete from tasks where id like ${PREFIX + '%'}`;
  await sql`delete from repos where id like ${PREFIX + '%'}`;
  await sql`delete from products where id like ${PREFIX + '%'}`;
  await sql.end();
});

describe('job-graph schema (harness/job-graph.md)', () => {
  test('all 8 job-graph tables exist', async () => {
    const rows = (await sql`
      select table_name from information_schema.tables
      where table_schema = 'public'
        and table_name in (${'products'}, ${'repos'}, ${'tasks'}, ${'task_seals'}, ${'jobs'}, ${'deps'}, ${'dep_members'}, ${'external_gates'})
    `) as Array<{ table_name: string }>;
    expect(rows.map((r) => r.table_name).sort()).toEqual(
      ['deps', 'dep_members', 'external_gates', 'jobs', 'products', 'repos', 'task_seals', 'tasks'].sort(),
    );
  });

  test('jobs.status rejects a value outside the enum', async () => {
    const { repoId, taskId } = await makeChain();
    const insertBogusStatus = async () => {
      await sql`insert into jobs (id, task_id, repo_id, title, status) values (${id('job')}, ${taskId}, ${repoId}, 'x', 'bogus')`;
    };
    await expect(insertBogusStatus()).rejects.toThrow();
  });

  test('task_seals rejects a duplicate (task_id, repo_id)', async () => {
    const { repoId, taskId } = await makeChain();
    await sql`insert into task_seals (task_id, repo_id) values (${taskId}, ${repoId})`;
    const insertDuplicate = async () => {
      await sql`insert into task_seals (task_id, repo_id) values (${taskId}, ${repoId})`;
    };
    await expect(insertDuplicate()).rejects.toThrow();
  });

  test('dep_members rejects a duplicate (dep_id, target_type, target_id)', async () => {
    const { repoId, taskId } = await makeChain();
    const jobId = id('job');
    await sql`insert into jobs (id, task_id, repo_id, title, status) values (${jobId}, ${taskId}, ${repoId}, 'x', 'pending')`;
    const depId = id('dep');
    await sql`insert into deps (id, waiter_job) values (${depId}, ${jobId})`;
    await sql`insert into dep_members (dep_id, target_type, target_id) values (${depId}, 'task', ${taskId})`;
    const insertDuplicate = async () => {
      await sql`insert into dep_members (dep_id, target_type, target_id) values (${depId}, 'task', ${taskId})`;
    };
    await expect(insertDuplicate()).rejects.toThrow();
  });

  test('jobs rejects a repo_id that does not exist', async () => {
    const { taskId } = await makeChain();
    const insertMissingRepo = async () => {
      await sql`insert into jobs (id, task_id, repo_id, title, status) values (${id('job')}, ${taskId}, ${id('repo-missing')}, 'x', 'pending')`;
    };
    await expect(insertMissingRepo()).rejects.toThrow();
  });

  test('dep_members.acceptable defaults to {satisfied}', async () => {
    const { repoId, taskId } = await makeChain();
    const jobId = id('job');
    await sql`insert into jobs (id, task_id, repo_id, title, status) values (${jobId}, ${taskId}, ${repoId}, 'x', 'pending')`;
    const depId = id('dep');
    await sql`insert into deps (id, waiter_job) values (${depId}, ${jobId})`;
    await sql`insert into dep_members (dep_id, target_type, target_id) values (${depId}, 'task', ${taskId})`;
    const rows = (await sql`
      select acceptable from dep_members where dep_id = ${depId} and target_type = 'task' and target_id = ${taskId}
    `) as Array<{ acceptable: string[] }>;
    expect(rows[0]!.acceptable).toEqual(['satisfied']);
  });

  test('jobs.generation defaults to 1', async () => {
    const { repoId, taskId } = await makeChain();
    const jobId = id('job');
    await sql`insert into jobs (id, task_id, repo_id, title, status) values (${jobId}, ${taskId}, ${repoId}, 'x', 'pending')`;
    const rows = (await sql`select generation from jobs where id = ${jobId}`) as Array<{ generation: number }>;
    expect(rows[0]!.generation).toBe(1);
  });
});
