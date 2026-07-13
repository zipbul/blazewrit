import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { SQL } from 'bun';
import { ensureSchema } from '../infra/schema';
import { reconcileTask, type ReconcileJob } from './reconcile';
import type { JobStatus } from './types';

// Integration test: exercises reconcile against a live Postgres (harness/job-graph.md migration step 8).
const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const PREFIX = `reconcile-${process.pid}-${Date.now()}`;
let n = 0;
const id = (label: string) => `${PREFIX}-${label}-${n++}`;

/** Builds a product → repo → open task chain, same minimum every graph fixture needs. */
async function makeChain() {
  const productId = id('product');
  const repoId = id('repo');
  const taskId = id('task');
  await sql`insert into products (id, name) values (${productId}, ${productId})`;
  await sql`insert into repos (id, product_id, name, cwd) values (${repoId}, ${productId}, ${repoId}, '/tmp')`;
  await sql`insert into tasks (id, title, status) values (${taskId}, ${taskId}, 'open')`;
  return { productId, repoId, taskId };
}

/** Raw fixture insert — bypasses graph/store.ts's insertJob so a fixture can start at any status. */
async function seedJob(taskId: string, repoId: string, status: JobStatus, title = 'x'): Promise<string> {
  const jobId = id('job');
  await sql`insert into jobs (id, task_id, repo_id, title, status) values (${jobId}, ${taskId}, ${repoId}, ${title}, ${status})`;
  return jobId;
}

async function jobStatus(jobId: string): Promise<string> {
  const rows = (await sql`select status from jobs where id = ${jobId}`) as Array<{ status: string }>;
  return rows[0]!.status;
}

beforeAll(async () => {
  await ensureSchema(sql);
});

afterAll(async () => {
  // FK-reverse order.
  await sql`delete from dep_members where dep_id like ${PREFIX + '%'}`;
  await sql`delete from deps where id like ${PREFIX + '%'}`;
  await sql`delete from jobs where id like ${PREFIX + '%'}`;
  await sql`delete from tasks where id like ${PREFIX + '%'}`;
  await sql`delete from repos where id like ${PREFIX + '%'}`;
  await sql`delete from products where id like ${PREFIX + '%'}`;
  await sql.end();
});

describe('reconcileTask (harness/job-graph.md migration step 8)', () => {
  test('a pending job with no deps is claimed (running) and handed to dispatch', async () => {
    const { repoId, taskId } = await makeChain();
    const jobId = await seedJob(taskId, repoId, 'pending');
    const dispatch = mock(async (_job: ReconcileJob) => {});

    const result = await reconcileTask(sql, taskId, dispatch);

    expect(result.claimed).toEqual([jobId]);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ id: jobId, repoId, taskId, title: 'x' });
    expect(await jobStatus(jobId)).toBe('running');
  });

  test('a job with an unmet dep is not dispatched and transitions to blocked', async () => {
    const { repoId, taskId } = await makeChain();
    // The dep's target job is deliberately NOT pending/blocked (so this same reconcile pass
    // never independently claims it too) and not done — its outcome reads as 'pending', so the
    // dep stays unmet.
    const targetJobId = await seedJob(taskId, repoId, 'running');
    const waiterJobId = await seedJob(taskId, repoId, 'pending');
    const depId = id('dep');
    await sql`insert into deps (id, waiter_job) values (${depId}, ${waiterJobId})`;
    await sql`insert into dep_members (dep_id, target_type, target_id) values (${depId}, 'job', ${targetJobId})`;
    const dispatch = mock(async (_job: ReconcileJob) => {});

    const result = await reconcileTask(sql, taskId, dispatch);

    expect(result.claimed).not.toContain(waiterJobId);
    expect(dispatch).not.toHaveBeenCalled();
    expect(await jobStatus(waiterJobId)).toBe('blocked');
  });

  test('an already-running job is left alone on a repeat pass (atomic claim is idempotent)', async () => {
    const { repoId, taskId } = await makeChain();
    const jobId = await seedJob(taskId, repoId, 'running');
    const dispatch = mock(async (_job: ReconcileJob) => {});

    const result = await reconcileTask(sql, taskId, dispatch);

    expect(result.claimed).toEqual([]);
    expect(dispatch).not.toHaveBeenCalled();
    expect(await jobStatus(jobId)).toBe('running');
  });

  test('a dispatch that throws fails only that job; the rest of the pass still runs', async () => {
    const { repoId, taskId } = await makeChain();
    const failingJobId = await seedJob(taskId, repoId, 'pending');
    const okJobId = await seedJob(taskId, repoId, 'pending');
    const dispatch = mock(async (job: ReconcileJob) => {
      if (job.id === failingJobId) throw new Error('boom');
    });

    const result = await reconcileTask(sql, taskId, dispatch);

    expect(result.claimed.slice().sort()).toEqual([failingJobId, okJobId].sort());
    expect(await jobStatus(failingJobId)).toBe('failed');
    expect(await jobStatus(okJobId)).toBe('running');
  });
});
