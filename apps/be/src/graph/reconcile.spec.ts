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

async function jobLeaseExpiresAt(jobId: string): Promise<Date | null> {
  const rows = (await sql`select lease_expires_at from jobs where id = ${jobId}`) as Array<{ lease_expires_at: Date | null }>;
  return rows[0]!.lease_expires_at;
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

describe('reconcileTask — lease (harness/job-graph.md P2 spec A1)', () => {
  test('claiming a job (ready→running) sets lease_expires_at to roughly now + the configured TTL', async () => {
    const { repoId, taskId } = await makeChain();
    const jobId = await seedJob(taskId, repoId, 'pending');
    const dispatch = mock(async (_job: ReconcileJob) => {});
    const leaseTtlMs = 60_000;
    const before = Date.now();

    await reconcileTask(sql, taskId, dispatch, { leaseTtlMs });

    const leaseExpiresAt = await jobLeaseExpiresAt(jobId);
    expect(leaseExpiresAt).not.toBeNull();
    const deltaMs = leaseExpiresAt!.getTime() - before;
    // Generous window around the TTL — this only guards against gross wiring mistakes (e.g. the
    // wrong unit or no TTL applied at all), not clock precision.
    expect(deltaMs).toBeGreaterThan(leaseTtlMs - 5_000);
    expect(deltaMs).toBeLessThan(leaseTtlMs + 5_000);
  });

  test('reconcileTask defaults the lease TTL when opts is omitted', async () => {
    const { repoId, taskId } = await makeChain();
    const jobId = await seedJob(taskId, repoId, 'pending');
    const dispatch = mock(async (_job: ReconcileJob) => {});

    await reconcileTask(sql, taskId, dispatch);

    const leaseExpiresAt = await jobLeaseExpiresAt(jobId);
    expect(leaseExpiresAt).not.toBeNull();
    expect(leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('reconcileTask — not-ready blocked-write CAS (3자 리뷰 수정 C1, Grok F1)', () => {
  /**
   * F1: the not-ready branch's write (`update jobs set status = 'blocked' ...`) carried no status
   * condition — it used the LOOP's initial snapshot (`job.status`) to decide WHETHER to write, but
   * the WRITE itself was unconditional. If the row moved on (claimed 'running' by a concurrent
   * reconcile pass — dispatchTask's own inline call and the always-on controller's tick are NOT
   * mutually exclusive) between this pass's initial SELECT and this write, the write clobbered
   * that newer state back to 'blocked' — breaking the done/running monotonicity the rest of the
   * system depends on.
   *
   * Constructed deterministically (no timing luck): a `SELECT ... FOR UPDATE` held open on the
   * waiter job's own row forces reconcileTask's not-ready write to genuinely BLOCK on that lock
   * (a real Postgres wait, not a race) once it gets there. While it's blocked, the same holding
   * transaction claims the job 'running' and commits — releasing the lock right as reconcileTask's
   * write was waiting for it. The guarded write's WHERE clause then has to match a 'running' row.
   */
  test('a not-ready blocked-write does not clobber a job already claimed running by a concurrent pass', async () => {
    const { repoId, taskId } = await makeChain();
    const targetJobId = await seedJob(taskId, repoId, 'pending'); // dep target — stays unmet
    const jobId = await seedJob(taskId, repoId, 'pending');
    const depId = id('dep');
    await sql`insert into deps (id, waiter_job) values (${depId}, ${jobId})`;
    await sql`insert into dep_members (dep_id, target_type, target_id) values (${depId}, 'job', ${targetJobId})`;
    const dispatch = mock(async (_job: ReconcileJob) => {});

    let releaseLock!: () => void;
    const continueSignal = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const lockTxDone = sql.begin(async (tx) => {
      await tx`select id from jobs where id = ${jobId} for update`;
      await continueSignal; // hold the lock open while reconcileTask runs and blocks on it
      // The "concurrent pass" claim, issued from the SAME transaction that already holds the
      // lock (a write from a DIFFERENT connection would itself block on this same lock).
      await tx`update jobs set status = 'running', lease_expires_at = now() + interval '10 minutes' where id = ${jobId}`;
      // Committing here (transaction end) releases the lock — reconcileTask's own blocked write,
      // waiting on it, proceeds right after.
    });

    await new Promise((r) => setTimeout(r, 50)); // let the lock actually acquire first

    const p = reconcileTask(sql, taskId, dispatch);
    await new Promise((r) => setTimeout(r, 100)); // let reconcileTask reach (and block on) its write

    releaseLock();
    await lockTxDone;
    await p;

    const rows = (await sql`select status from jobs where id = ${jobId}`) as Array<{ status: string }>;
    expect(rows[0]!.status).toBe('running'); // must NOT be clobbered back to 'blocked'
  });
});
