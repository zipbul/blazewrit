import { afterAll, beforeAll, describe, expect, mock, spyOn, test } from 'bun:test';
import { SQL } from 'bun';
import { ensureSchema } from '../infra/schema';
import { makeWakeConsumer } from './wake-consumer';
import type { WakeSessionCtx } from './wake-session';
import type { QueryFn } from '../orchestrator/infra/agent-step-executor';

/**
 * P4-2c: makeWakeConsumer is the controller.ts `onWake` wiring — a raised wake (already
 * dedup-filtered by raiseWake, spec E2) either does nothing (gate OFF, the default) or kicks off a
 * runWakeSession (P4-2a) for the woken job's own repo. serve.ts is a process entry and can't be
 * unit-tested directly, so this file exercises the factory itself against a live Postgres (the
 * repo_id lookup is a real query) with a fake `runWake`/`resolveCwd` capturing what would have run.
 */
const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const PREFIX = `wake-consumer-${process.pid}-${Date.now()}`;
let n = 0;
const id = (label: string) => `${PREFIX}-${label}-${n++}`;

const noopQueryFn: QueryFn = async function* () {};

async function makeChain() {
  const productId = id('product');
  const repoId = id('repo');
  const taskId = id('task');
  await sql`insert into products (id, name) values (${productId}, ${productId})`;
  await sql`insert into repos (id, product_id, name, cwd) values (${repoId}, ${productId}, ${repoId}, '/tmp')`;
  await sql`insert into tasks (id, title, status) values (${taskId}, ${taskId}, 'open')`;
  return { taskId, repoId };
}

async function seedJob(taskId: string, repoId: string): Promise<string> {
  const jobId = id('job');
  await sql`insert into jobs (id, task_id, repo_id, title, status) values (${jobId}, ${taskId}, ${repoId}, 'x', 'pending')`;
  return jobId;
}

async function waitFor<T>(fn: () => Promise<T | undefined | null | false>, timeoutMs = 10000, interval = 30): Promise<T> {
  const start = Date.now();
  let last: T | undefined | null | false;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (last) return last as T;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms; last value: ${JSON.stringify(last)}`);
}

beforeAll(async () => {
  await ensureSchema(sql);
});

afterAll(async () => {
  await sql`delete from jobs where id like ${PREFIX + '%'}`;
  await sql`delete from tasks where id like ${PREFIX + '%'}`;
  await sql`delete from repos where id like ${PREFIX + '%'}`;
  await sql`delete from products where id like ${PREFIX + '%'}`;
  await sql.end();
});

describe('makeWakeConsumer (P4-2c)', () => {
  test('gate OFF (the default): a job-level wake never invokes runWake — the human inbox stays the only consumer', async () => {
    const { taskId, repoId } = await makeChain();
    const jobId = await seedJob(taskId, repoId);
    const runWake = mock(async (_ctx: WakeSessionCtx) => {});
    const consumer = makeWakeConsumer({ sql, queryFn: noopQueryFn, newId: () => id('gen'), autonomyEnabled: () => false, runWake });

    consumer({ kind: 'stalled', taskId, jobId, reason: '정체' });
    await new Promise((r) => setTimeout(r, 200)); // give any (wrongly) fired async work a chance to land
    expect(runWake.mock.calls.length).toBe(0);
  });

  test('gate ON: a job-level wake resolves the job\'s own repo/cwd and invokes runWake with that context', async () => {
    const { taskId, repoId } = await makeChain();
    const jobId = await seedJob(taskId, repoId);
    const runWake = mock(async (_ctx: WakeSessionCtx) => {});
    const resolveCwd = mock(async (_s: SQL, rid: string) => `/checkout/${rid}`);
    const consumer = makeWakeConsumer({
      sql,
      queryFn: noopQueryFn,
      newId: () => id('gen'),
      autonomyEnabled: () => true,
      runWake,
      resolveCwd,
    });

    consumer({ kind: 'stalled', taskId, jobId, reason: '태스크가 정체되어 있습니다' });

    await waitFor(async () => (runWake.mock.calls.length > 0 ? true : undefined));
    const ctx = runWake.mock.calls[0]![0];
    expect(ctx.actorRepoId).toBe(repoId);
    expect(ctx.taskId).toBe(taskId);
    expect(ctx.reason).toBe('태스크가 정체되어 있습니다');
    expect(ctx.cwd).toBe(`/checkout/${repoId}`);
  });

  test('coalesce: a second wake for the same jobId while the first runWake is still in flight is suppressed, and a later wake after completion runs again', async () => {
    const { taskId, repoId } = await makeChain();
    const jobId = await seedJob(taskId, repoId);
    let releaseFirst: () => void = () => {};
    const gate = new Promise<void>((resolve) => (releaseFirst = resolve));
    const runWake = mock(async (_ctx: WakeSessionCtx) => {
      if (runWake.mock.calls.length === 1) await gate; // the FIRST call stays in-flight until released
    });
    const consumer = makeWakeConsumer({
      sql,
      queryFn: noopQueryFn,
      newId: () => id('gen'),
      autonomyEnabled: () => true,
      runWake,
      resolveCwd: async () => '/tmp',
    });

    consumer({ kind: 'stalled', taskId, jobId, reason: 'first' });
    await waitFor(async () => (runWake.mock.calls.length > 0 ? true : undefined)); // first call has started

    consumer({ kind: 'stalled', taskId, jobId, reason: 'second-while-in-flight' }); // same key — coalesced
    await new Promise((r) => setTimeout(r, 150));
    expect(runWake.mock.calls.length).toBe(1); // still just the first — no second invocation while in flight

    releaseFirst(); // let the first call finish, clearing the coalesce key
    await waitFor(async () => {
      consumer({ kind: 'stalled', taskId, jobId, reason: 'third-after-completion' }); // re-armed once cleared
      return runWake.mock.calls.length > 1 ? true : undefined;
    });
    expect(runWake.mock.calls.length).toBe(2);
  });

  test('task-level wake (no jobId, e.g. unresolvable_task) never invokes runWake — repo selection is ambiguous, carried to P5', async () => {
    const { taskId } = await makeChain();
    const runWake = mock(async (_ctx: WakeSessionCtx) => {});
    const consumer = makeWakeConsumer({ sql, queryFn: noopQueryFn, newId: () => id('gen'), autonomyEnabled: () => true, runWake });

    consumer({ kind: 'unresolvable_task', taskId, reason: '태스크가 해소되지 않았습니다' });
    await new Promise((r) => setTimeout(r, 150));
    expect(runWake.mock.calls.length).toBe(0);
  });

  test('a job id with no matching jobs row is a quiet no-op, not an error', async () => {
    const { taskId } = await makeChain();
    const missingJobId = id('missing-job'); // never inserted
    const runWake = mock(async (_ctx: WakeSessionCtx) => {});
    const consumer = makeWakeConsumer({ sql, queryFn: noopQueryFn, newId: () => id('gen'), autonomyEnabled: () => true, runWake });

    consumer({ kind: 'stalled', taskId, jobId: missingJobId, reason: '정체' });
    await new Promise((r) => setTimeout(r, 150));
    expect(runWake.mock.calls.length).toBe(0);
  });

  test('a sql lookup failure is caught and logged, never thrown back at the caller (controller tick safety)', async () => {
    const { taskId } = await makeChain();
    const jobId = id('job'); // arbitrary — the fake sql throws before this id is ever used
    const throwingSql = (() => {
      throw new Error('boom');
    }) as unknown as SQL;
    const runWake = mock(async (_ctx: WakeSessionCtx) => {});
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    const consumer = makeWakeConsumer({ sql: throwingSql, queryFn: noopQueryFn, newId: () => id('gen'), autonomyEnabled: () => true, runWake });

    expect(() => consumer({ kind: 'stalled', taskId, jobId, reason: '정체' })).not.toThrow();
    await new Promise((r) => setTimeout(r, 150));
    expect(runWake.mock.calls.length).toBe(0);
    errorSpy.mockRestore();
  });
});
