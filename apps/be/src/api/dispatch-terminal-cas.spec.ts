import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { SQL } from 'bun';
import { createRestApi } from './rest';
import { ensureSchema } from '../infra/schema';
import { bumpJobGeneration } from '../graph/store';
import type { StepExecutor } from '../orchestrator/types';

/**
 * Reproduces the 3자 리뷰 수정 A라운드 A1 finding (Fable#2 = Codex#1): every raw `update jobs
 * set status = ...` / `update work_items set state = ...` write that marks a job/work_item
 * terminal was UNGUARDED — a late write (arriving after the row already moved on to a different
 * terminal/regenerated state, e.g. because the controller's own lease-expiry scan or a gen++ beat
 * it there) could clobber that newer, more authoritative state. Each test here drives dispatchTask
 * through a REAL A2A dispatch with a "gated" executor whose first step blocks on a promise this
 * test controls — that gives the test a window to simulate an intervening write (lease-expiry
 * scan marking the job failed, or a gen++ rewind) BEFORE releasing the gate and letting the
 * original flow's own completion/catch write finally fire. Every test here is expected to be
 * GREEN against the fixed code; run before the fix, they reproduce the bug (RED).
 */
const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const MARK = `termcas-${process.pid}-${Date.now()}`;
const projectId = `${MARK}-proj`;

let idSeq = 0;
const newId = () => `${MARK}-${idSeq++}`;

let rpcSeq = 0;
function sendA2A(
  target: ReturnType<typeof createRestApi>,
  targetProjectId: string,
  text: string,
  opts: { metadata?: Record<string, unknown> } = {},
): Promise<Response> {
  const id = `${MARK}-rpc-${rpcSeq++}`;
  const envelope = {
    jsonrpc: '2.0',
    id,
    method: 'message/send',
    params: {
      message: {
        kind: 'message',
        messageId: `${id}-msg`,
        role: 'user',
        parts: [{ kind: 'text', text }],
        ...(opts.metadata ? { metadata: opts.metadata } : {}),
      },
    },
  };
  return target.handle(
    new Request(`http://localhost/agents/${encodeURIComponent(targetProjectId)}/a2a`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
    }),
  );
}

async function waitFor<T>(fn: () => Promise<T | undefined | null | false>, timeoutMs = 10000, interval = 50): Promise<T> {
  const start = Date.now();
  let last: T | undefined | null | false;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (last) return last as T;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms; last value: ${JSON.stringify(last)}`);
}

async function jobRow(id: string): Promise<{ status: string; generation: number } | undefined> {
  const rows = (await sql`select status, generation from jobs where id = ${id}`) as Array<{ status: string; generation: number }>;
  return rows[0];
}

async function workItemState(id: string): Promise<string | undefined> {
  const rows = (await sql`select state from work_items where id = ${id}`) as Array<{ state: string }>;
  return rows[0]?.state;
}

/** A step executor whose produce() blocks on `gate` — lets the test inject a race window before
 * the flow proceeds to completion. */
function makeGatedExecutor(gate: Promise<void>): StepExecutor {
  return {
    produce: async () => {
      await gate;
      return { output: 'out' };
    },
    review: async () => ({ verdict: 'pass' }),
  };
}

/** Same gate, but the flow errors out once released (for exercising the CATCH-path writes). */
function makeGatedThrowingExecutor(gate: Promise<void>): StepExecutor {
  return {
    produce: async () => {
      await gate;
      throw new Error('boom-late');
    },
    review: async () => ({ verdict: 'pass' }),
  };
}

beforeAll(async () => {
  await ensureSchema(sql);
  await sql`insert into projects (id, name, status) values (${projectId}, ${projectId}, 'active')`;
});

afterAll(async () => {
  await sql`delete from decisions where meta->>'taskId' like ${MARK + '%'}`;
  await sql`delete from jobs where id like ${MARK + '%'}`;
  await sql`delete from tasks where id like ${MARK + '%'}`;
  await sql`delete from repos where id like ${MARK + '%'}`;
  await sql`delete from step_runs where flow_id like ${MARK + '%'}`;
  await sql`delete from flows where id like ${MARK + '%'}`;
  await sql`delete from work_items where id like ${MARK + '%'}`;
  await sql`delete from projects where id like ${MARK + '%'}`;
  await sql.end();
});

describe('A1: terminal job/work_item writes are CAS-guarded against a stale in-flight completion', () => {
  it("① a late success completion must not resurrect a job the lease-expiry scan already marked failed", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const app = createRestApi(sql, { executor: makeGatedExecutor(gate), newId });

    const text = `${MARK} case1 chore`;
    const res = await sendA2A(app, projectId, text, { metadata: { flowType: 'chore' } });
    const { id: workItemId } = ((await res.json()) as { result: { id: string } }).result;

    await waitFor(async () => (await jobRow(workItemId))?.status === 'running');

    // Simulate the controller's own lease-expiry scan (graph/controller.ts A3) firing WHILE this
    // flow is still (slowly) executing.
    await sql`update jobs set status = 'failed', status_changed_at = now(), lease_expires_at = null where id = ${workItemId}`;

    release(); // let the (unaware) original flow finish normally, well after the fact

    await waitFor(async () => (await workItemState(workItemId)) !== 'in_flow');

    expect((await jobRow(workItemId))?.status).toBe('failed'); // must NOT be clobbered back to 'done'
  });

  it('② a late success completion must not phantom-done a job already gen++\'d back to pending', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const app = createRestApi(sql, { executor: makeGatedExecutor(gate), newId });

    const text = `${MARK} case2 chore`;
    const res = await sendA2A(app, projectId, text, { metadata: { flowType: 'chore' } });
    const { id: workItemId } = ((await res.json()) as { result: { id: string } }).result;

    await waitFor(async () => (await jobRow(workItemId))?.status === 'running');

    await sql`update jobs set status = 'failed', status_changed_at = now(), lease_expires_at = null where id = ${workItemId}`;
    await bumpJobGeneration(sql, projectId, workItemId); // gen 1 -> 2, status -> pending: a fresh re-run slot

    release(); // the STALE run's completion write finally arrives

    // No natural "it's done now" signal to wait on here (we're asserting it stays pending) -- give
    // the stale write a moment to land, then check it didn't.
    await new Promise((r) => setTimeout(r, 300));

    const row = await jobRow(workItemId);
    expect(row?.status).toBe('pending'); // must NOT be phantom-marked done for a generation that never ran
    expect(row?.generation).toBe(2);
  });

  it('③ a late catch-path failure must not un-terminal a work_item/job that already reached done via another path', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const app = createRestApi(sql, { executor: makeGatedThrowingExecutor(gate), newId });

    const text = `${MARK} case3 chore`;
    const res = await sendA2A(app, projectId, text, { metadata: { flowType: 'chore' } });
    const { id: workItemId } = ((await res.json()) as { result: { id: string } }).result;

    await waitFor(async () => (await jobRow(workItemId))?.status === 'running');

    // Simulate this work item having already reached a terminal 'done' via some other path.
    await sql`update work_items set state = 'done' where id = ${workItemId}`;
    await sql`update jobs set status = 'done', status_changed_at = now(), lease_expires_at = null where id = ${workItemId}`;

    release(); // the (unaware) original flow now errors out -> executeJobFlow's catch fires

    // No natural "the catch ran" signal that doesn't ALSO describe the bug -- give it a moment.
    await new Promise((r) => setTimeout(r, 300));

    expect(await workItemState(workItemId)).toBe('done'); // must NOT be clobbered back to 'blocked'
    expect((await jobRow(workItemId))?.status).toBe('done'); // must NOT be clobbered back to 'failed'
  });
});
