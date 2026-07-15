import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { createRestApi } from './rest';
import { ensureSchema } from '../infra/schema';
import type { ReconcileJob } from '../graph/reconcile';

/**
 * Characterizes RestDeps.onReconcileDispatch — the hook serve.ts uses to wire graph/controller.ts's
 * startGraphController to createRestApi's own registry-aware dispatch (harness/job-graph.md P2
 * round 1's "F" wiring, never directly exercised by a test until now) — and specifically the
 * orphan-recovery branch that P2 round 2 added: a claimed job with no registered execution
 * closure gets reverted to pending AND raises an 'orphaned_ready' wake (spec B2).
 */
const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const MARK = `reconcile-dispatch-${process.pid}-${Date.now()}`;
let idSeq = 0;
const newId = () => `${MARK}-${idSeq++}`;

async function jobStatus(jobId: string): Promise<string> {
  const rows = (await sql`select status from jobs where id = ${jobId}`) as Array<{ status: string }>;
  return rows[0]!.status;
}

async function openWakeCount(kind: string, jobId: string): Promise<number> {
  const rows = (await sql`
    select id from decisions where request_type = 'agent_wake' and status = 'open' and meta->>'kind' = ${kind} and meta->>'jobId' = ${jobId}
  `) as unknown[];
  return rows.length;
}

beforeAll(async () => {
  await ensureSchema(sql);
});

afterAll(async () => {
  await sql`delete from decisions where request_type = 'agent_wake' and meta->>'jobId' like ${MARK + '%'}`;
  await sql`delete from jobs where id like ${MARK + '%'}`;
  await sql`delete from tasks where id like ${MARK + '%'}`;
  await sql`delete from repos where id like ${MARK + '%'}`;
  await sql`delete from products where id like ${MARK + '%'}`;
  await sql.end();
});

describe('RestDeps.onReconcileDispatch', () => {
  test('is called synchronously during setup with the registry-aware dispatch function', () => {
    let captured: unknown;
    createRestApi(sql, { newId, onReconcileDispatch: (dispatch) => { captured = dispatch; } });
    expect(typeof captured).toBe('function');
  });

  test('an orphaned job (no registered executor) is reverted to pending and raises an orphaned_ready wake', async () => {
    let dispatch: ((job: ReconcileJob) => Promise<void>) | undefined;
    createRestApi(sql, { newId, onReconcileDispatch: (fn) => { dispatch = fn; } });

    const productId = `${MARK}-product`;
    const repoId = `${MARK}-repo`;
    const taskId = `${MARK}-task`;
    const jobId = `${MARK}-job`;
    await sql`insert into products (id, name) values (${productId}, ${productId}) on conflict (id) do nothing`;
    await sql`insert into repos (id, product_id, name, cwd) values (${repoId}, ${productId}, ${repoId}, '/tmp')`;
    await sql`insert into tasks (id, title, status) values (${taskId}, ${taskId}, 'open')`;
    // Inserted directly at 'running' — never dispatched through THIS app instance, so its
    // execution closure was never registered (simulates a restart or a foreign claim).
    await sql`insert into jobs (id, task_id, repo_id, title, status) values (${jobId}, ${taskId}, ${repoId}, 'x', 'running')`;

    await dispatch!({ id: jobId, repoId, taskId, title: 'x' });

    expect(await jobStatus(jobId)).toBe('pending');
    expect(await openWakeCount('orphaned_ready', jobId)).toBe(1);
  });

  /**
   * 3자 리뷰 수정 B1-2a (Fable#4+#7): before this fix, EVERY orphan claim of the same job reverted
   * it back to 'pending' unconditionally — a job that keeps getting re-claimed (because reverting
   * to pending makes it immediately eligible again) and re-orphaned (because nothing ever
   * re-registers its executor) ping-pongs pending<->running forever, one revert write per tick,
   * with no way out except a process restart. This reproduces a SECOND orphan claim of the SAME
   * job id and asserts the revert write does NOT repeat — the job is left 'running' instead (to be
   * resolved by the lease-expiry scan once its lease lapses, same as any other stuck job).
   */
  test('a second orphan claim of the SAME job does not repeat the revert write (no ping-pong)', async () => {
    let dispatch: ((job: ReconcileJob) => Promise<void>) | undefined;
    createRestApi(sql, { newId, onReconcileDispatch: (fn) => { dispatch = fn; } });

    const productId = `${MARK}-product2`;
    const repoId = `${MARK}-repo2`;
    const taskId = `${MARK}-task2`;
    const jobId = `${MARK}-job2`;
    await sql`insert into products (id, name) values (${productId}, ${productId}) on conflict (id) do nothing`;
    await sql`insert into repos (id, product_id, name, cwd) values (${repoId}, ${productId}, ${repoId}, '/tmp')`;
    await sql`insert into tasks (id, title, status) values (${taskId}, ${taskId}, 'open')`;
    await sql`insert into jobs (id, task_id, repo_id, title, status) values (${jobId}, ${taskId}, ${repoId}, 'x', 'running')`;

    await dispatch!({ id: jobId, repoId, taskId, title: 'x' }); // first orphan claim -> reverted
    expect(await jobStatus(jobId)).toBe('pending');
    expect(await openWakeCount('orphaned_ready', jobId)).toBe(1);

    // Simulate a second reconcile pass re-claiming the SAME job (pending -> running again).
    await sql`update jobs set status = 'running' where id = ${jobId}`;
    await dispatch!({ id: jobId, repoId, taskId, title: 'x' }); // second orphan claim, same job id

    // No repeated ping-pong: the job is left 'running' (NOT reverted a second time), and the wake
    // dedup already means the count stays 1 either way — the real proof is the status.
    expect(await jobStatus(jobId)).toBe('running');
    expect(await openWakeCount('orphaned_ready', jobId)).toBe(1);
  });
});
