import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { SQL } from 'bun';
import { createRestApi } from './rest';
import { ensureSchema } from '../infra/schema';
import { bumpJobGeneration } from '../graph/store';
import type { StepExecutor } from '../orchestrator/types';

/**
 * 단일 기록자 통합 Phase 1 (job-graph.md C1) rewrite of the original 3자 리뷰 수정 A라운드 A1
 * (Fable#2 = Codex#1) reproduction. Execution (api/rest.ts's makeJobFlow) no longer writes
 * jobs/work_items status directly at all — a "late completion" is now just an append-only
 * `job_events` insert (recordJobOutcome), and graph/reconcile.ts's consumeJobEvents is the only
 * thing that ever turns that fact into a jobs.status write. The ORIGINAL bug (an unconditional
 * completion WRITE clobbering newer state) can no longer even be expressed the old way — there is
 * no unconditional write left to race. What replaces it: consumeJobEvents' own precondition check
 * (`status = 'running' and generation = <the event's own generation>`) must correctly find a STALE
 * event's precondition already false and consume it as a no-op, never clobbering whatever the row
 * moved on to. Every test here still drives dispatchTask through a REAL A2A dispatch with a
 * "gated" executor whose first step blocks on a promise this test controls — same technique as
 * before, same race window — but now asserts against the event's `processed_at` marker (the
 * definitive "reconcile looked at this fact and decided" signal) instead of a raw status write.
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

/** Waits until the SPECIFIC (job, generation, kind) event has been consumed (processed_at set) —
 * the definitive "reconcile looked at this fact and decided" signal, whether it applied or no-op'd. */
async function waitForEventProcessed(jobId: string, generation: number, kind: string): Promise<void> {
  await waitFor(async () => {
    const rows = (await sql`
      select 1 from job_events where job_id = ${jobId} and generation = ${generation} and kind = ${kind} and processed_at is not null
    `) as unknown[];
    return rows.length > 0 ? true : undefined;
  });
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

/** Same gate, but the flow errors out once released (for exercising the CATCH-path event). */
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
  await sql`delete from job_events where job_id like ${MARK + '%'}`;
  await sql`delete from jobs where id like ${MARK + '%'}`;
  await sql`delete from tasks where id like ${MARK + '%'}`;
  await sql`delete from repos where id like ${MARK + '%'}`;
  await sql`delete from step_runs where flow_id like ${MARK + '%'}`;
  await sql`delete from flows where id like ${MARK + '%'}`;
  await sql`delete from work_items where id like ${MARK + '%'}`;
  await sql`delete from projects where id like ${MARK + '%'}`;
  await sql.end();
});

describe('single-writer round: a late job_events report is consumed as a no-op against newer state', () => {
  it("① a late 'succeeded' event must not resurrect a job the lease-expiry scan already marked failed", async () => {
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

    release(); // let the (unaware) original flow finish normally, well after the fact — it records
    // a 'succeeded' job_events fact for generation 1, not a raw write.

    await waitForEventProcessed(workItemId, 1, 'succeeded');

    expect((await jobRow(workItemId))?.status).toBe('failed'); // must NOT be clobbered back to 'done'
  });

  it("② a late 'succeeded' event must not phantom-done a job already gen++'d back to pending", async () => {
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

    release(); // the STALE run's 'succeeded' event (generation 1) finally gets recorded

    await waitForEventProcessed(workItemId, 1, 'succeeded');

    // Note: recordJobOutcome fires reconcileTask once after EVERY event (including this no-op
    // one) for immediacy — that same pass also opportunistically claims any other ready
    // pending/blocked job under the task, which this freshly gen-bumped (no deps) job now is. So
    // 'running' here is a legitimate, unrelated claim of the fresh gen-2 slot, not a regression —
    // the only thing this test actually guards is that it was never 'done' at generation 1.
    const row = await jobRow(workItemId);
    expect(row?.status).not.toBe('done'); // must NOT be phantom-marked done for a generation that never ran
    expect(row?.generation).toBe(2);
  });

  it("③ a late 'failed' event must not un-terminal a work_item/job that already reached done via another path", async () => {
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

    release(); // the (unaware) original flow now errors out -> its catch records a 'failed' event

    await waitForEventProcessed(workItemId, 1, 'failed');

    expect(await workItemState(workItemId)).toBe('done'); // must NOT be clobbered back to 'blocked'
    expect((await jobRow(workItemId))?.status).toBe('done'); // must NOT be clobbered back to 'failed'
  });

  /**
   * 3자 리뷰 수정 E1 (Fable M1) 's sharper case, carried forward: a stale gen-1 event arriving
   * after the row was RE-CLAIMED to 'running' at a NEW generation. `status = 'running'` alone
   * would wrongly match; consumeJobEvents' generation-scoped precondition is what closes this.
   */
  it("④ a late 'succeeded' event (stale gen 1) must not phantom-done a job re-claimed to gen-2 running", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const app = createRestApi(sql, { executor: makeGatedExecutor(gate), newId });

    const text = `${MARK} case4 chore`;
    const res = await sendA2A(app, projectId, text, { metadata: { flowType: 'chore' } });
    const { id: workItemId } = ((await res.json()) as { result: { id: string } }).result;

    await waitFor(async () => (await jobRow(workItemId))?.status === 'running');

    // Simulate: lease expiry -> failed -> gen++ -> re-claimed to running, a fresh gen-2 attempt
    // now genuinely in flight (this test doesn't need to actually drive that second run — only
    // that the row is 'running' again at generation 2 by the time the STALE gen-1 event arrives).
    await sql`update jobs set status = 'failed', status_changed_at = now(), lease_expires_at = null where id = ${workItemId}`;
    await bumpJobGeneration(sql, projectId, workItemId); // gen 1 -> 2, status -> pending
    await sql`update jobs set status = 'running', lease_expires_at = now() + interval '10 minutes' where id = ${workItemId} and status = 'pending'`;

    release(); // the STALE gen-1 flow's 'succeeded' event finally gets recorded

    await waitForEventProcessed(workItemId, 1, 'succeeded');

    const row = await jobRow(workItemId);
    expect(row?.status).toBe('running'); // must NOT be phantom-done by the stale gen-1 event
    expect(row?.generation).toBe(2);
  });

  /**
   * job_events' PK (job_id, generation, kind) is the idempotency story replacing the old
   * completion-write CAS: a duplicate report of the SAME fact (a retried publish, a crash-replay)
   * must be a safe no-op, never a duplicate-row error and never a double-applied transition.
   */
  it('a duplicate report of the SAME (job, generation, kind) fact is idempotent — one row, one transition', async () => {
    const app = createRestApi(sql, { executor: { produce: async () => ({ output: 'out' }), review: async () => ({ verdict: 'pass' }) }, newId });

    const text = `${MARK} case5 chore`;
    const res = await sendA2A(app, projectId, text, { metadata: { flowType: 'chore' } });
    const { id: workItemId } = ((await res.json()) as { result: { id: string } }).result;

    await waitFor(async () => (await jobRow(workItemId))?.status === 'done');
    await waitForEventProcessed(workItemId, 1, 'succeeded');

    // A duplicate report of the exact same fact — e.g. a retried publish after a transient
    // network error that actually landed the first time.
    await sql`insert into job_events (job_id, generation, kind) values (${workItemId}, 1, 'succeeded') on conflict do nothing`;

    const eventRows = (await sql`select 1 from job_events where job_id = ${workItemId} and generation = 1 and kind = 'succeeded'`) as unknown[];
    expect(eventRows).toHaveLength(1); // on conflict do nothing -- never a second row

    expect((await jobRow(workItemId))?.status).toBe('done'); // still exactly done, not re-derived twice
  }, 15000);
});
