import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { SQL } from 'bun';
import { createRestApi, insertJobEventWithRetry } from './rest';
import { ensureSchema } from '../infra/schema';
import { consumeJobEvents } from '../graph/reconcile';
import type { StepExecutor } from '../orchestrator/types';

/**
 * F1 (3자 리뷰 수정 라운드, Codex+Grok 수렴): before this fix, recordJobOutcome's job_events INSERT
 * was wrapped in `.catch(() => undefined)` — a failure there was the ONLY durable record this
 * generation's outcome would ever get (the completion-write CAS/generation guards are gone; there
 * is nothing else to fall back on), so swallowing it meant the fact was gone FOREVER, with not even
 * a log line to say so. This file proves the fix two ways: insertJobEventWithRetry's own retry/
 * error-surfacing contract in isolation (module-level, unit-testable with a bare fake `sql`, same
 * pattern as resolveRepoCwd — no live Postgres needed for these), and the real end-to-end wiring
 * (recordJobOutcome inside a live createRestApi instance) actually publishing a flow-error over
 * `/api/stream` when every retry is exhausted.
 */
describe('insertJobEventWithRetry — retry + error-surfacing contract (F1, no live Postgres)', () => {
  it('succeeds immediately, no retry, when the first attempt works', async () => {
    let calls = 0;
    const fakeSql = (async () => {
      calls++;
      return [];
    }) as unknown as SQL;

    const result = await insertJobEventWithRetry(fakeSql, 'job-1', 1, 'succeeded', [10, 10]);

    expect(result).toEqual({ ok: true });
    expect(calls).toBe(1);
  });

  it('recovers within the retry budget after transient failures', async () => {
    let calls = 0;
    const fakeSql = (async () => {
      calls++;
      if (calls <= 2) throw new Error(`transient failure #${calls}`);
      return [];
    }) as unknown as SQL;

    const result = await insertJobEventWithRetry(fakeSql, 'job-2', 1, 'succeeded', [1, 1]);

    expect(result).toEqual({ ok: true });
    expect(calls).toBe(3); // 1 initial attempt + 2 retries, the second of which finally succeeds
  });

  it('returns the last error once every retry is exhausted — never silently swallowed', async () => {
    let calls = 0;
    const fakeSql = (async () => {
      calls++;
      throw new Error(`persistent failure #${calls}`);
    }) as unknown as SQL;

    const result = await insertJobEventWithRetry(fakeSql, 'job-3', 1, 'failed', [1, 1]);

    expect(result.ok).toBe(false);
    expect(calls).toBe(3); // 1 initial attempt + 2 retries, all failing
    expect((result as { ok: false; error: unknown }).error).toBeInstanceOf(Error);
    expect(((result as { ok: false; error: Error }).error).message).toBe('persistent failure #3'); // the LAST attempt's error, not the first
  });

  it('an empty retry budget still makes exactly one attempt', async () => {
    let calls = 0;
    const fakeSql = (async () => {
      calls++;
      throw new Error('boom');
    }) as unknown as SQL;

    const result = await insertJobEventWithRetry(fakeSql, 'job-4', 1, 'failed', []);

    expect(result.ok).toBe(false);
    expect(calls).toBe(1);
  });
});

// ---- Integration: the real wiring actually surfaces a flow-error over /api/stream -------------

const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const MARK = `recordoutcome-${process.pid}-${Date.now()}`;
const projectId = `${MARK}-proj`;
let idSeq = 0;
const newId = () => `${MARK}-${idSeq++}`;
let rpcSeq = 0;

function sendA2A(app: ReturnType<typeof createRestApi>, targetProjectId: string, text: string): Promise<Response> {
  const id = `${MARK}-rpc-${rpcSeq++}`;
  return app.handle(
    new Request(`http://localhost/agents/${encodeURIComponent(targetProjectId)}/a2a`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        method: 'message/send',
        params: {
          message: { kind: 'message', messageId: `${id}-msg`, role: 'user', parts: [{ kind: 'text', text }], metadata: { flowType: 'chore' } },
        },
      }),
    }),
  );
}

/** Reads Server-Sent Event `data:` lines off an `/api/stream` Response until `predicate` matches
 * one, or `timeoutMs` elapses. The stream is NOT buffered by FlowHub — a subscriber only ever sees
 * events published AFTER it subscribes, so callers must open the stream BEFORE triggering whatever
 * they're waiting to observe. */
async function waitForFlowEvent(res: Response, predicate: (e: Record<string, unknown>) => boolean, timeoutMs = 8000): Promise<Record<string, unknown>> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const readLoop = async (): Promise<Record<string, unknown>> => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error('stream closed before a matching event arrived');
      if (value) {
        // app.handle()'s in-process ReadableStream preserves the exact chunk type FlowHub's own
        // `controller.enqueue(line)` (rest.ts's /api/stream handler) enqueued — a plain string, not
        // encoded bytes, since there is no real HTTP wire crossing here. A genuine network response
        // would arrive as bytes, hence still handling that shape too.
        buffer += typeof value === 'string' ? value : decoder.decode(value as Uint8Array, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const m = raw.match(/^data: (.*)$/m);
          if (!m) continue;
          let evt: Record<string, unknown>;
          try {
            evt = JSON.parse(m[1]!);
          } catch {
            continue;
          }
          if (predicate(evt)) return evt;
        }
      }
    }
  };

  try {
    // Race the WHOLE read loop against one timeout (not per-read) — reader.read() must never be
    // called again while a previous call is still outstanding, which racing per-iteration risked.
    return await Promise.race([
      readLoop(),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error(`waitForFlowEvent timed out after ${timeoutMs}ms`)), timeoutMs)),
    ]);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/**
 * Wraps a REAL `sql` connection in a Proxy whose tagged-template calls fail (reject) the first
 * `failTimes` times a query's text matches `textIncludes`, then pass through to the real
 * implementation. `.begin(fn)` is specially handled: the transaction-scoped `tx` object bun's SQL
 * driver hands to `fn` is a DIFFERENT object from `sql` itself, so it's recursively wrapped the
 * SAME way — a targeted failure inside a `sql.begin(async (tx) => ...)` callback (consumeOneEvent's
 * shape) is caught here too, not just top-level `sql\`...\`` calls. Scoped to the ONE `SQL`
 * reference passed into a single `createRestApi(...)` call (or a direct consumeJobEvents(...) call)
 * for this test only; no other concurrently-running test file's own connection is affected.
 */
function withFailingQuery(real: SQL, textIncludes: string, failTimes: number): SQL {
  let hits = 0;
  const wrap = (target: object): unknown =>
    new Proxy(target, {
      apply(t, _thisArg, args) {
        const strings = args[0] as unknown;
        const text = Array.isArray(strings) ? (strings as string[]).join('?') : String(strings);
        if (text.includes(textIncludes) && hits < failTimes) {
          hits++;
          return Promise.reject(new Error(`injected failure #${hits} for query matching "${textIncludes}"`));
        }
        return Reflect.apply(t as unknown as (...a: unknown[]) => unknown, t, args);
      },
      get(t, prop, receiver) {
        if (prop === 'begin') {
          return (fn: (tx: unknown) => unknown) => (t as unknown as SQL).begin((tx: unknown) => fn(wrap(tx as object)));
        }
        const val = Reflect.get(t, prop, receiver);
        return typeof val === 'function' ? (val as (...a: unknown[]) => unknown).bind(t) : val;
      },
    });
  return wrap(real) as unknown as SQL;
}

const fastExecutor: StepExecutor = {
  produce: async () => ({ output: 'out' }),
  review: async () => ({ verdict: 'pass' }),
};

async function jobRow(id: string): Promise<{ status: string } | undefined> {
  const rows = (await sql`select status from jobs where id = ${id}`) as Array<{ status: string }>;
  return rows[0];
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

beforeAll(async () => {
  await ensureSchema(sql);
  await sql`insert into projects (id, name, status) values (${projectId}, ${projectId}, 'active')`;
});

afterAll(async () => {
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

describe('recordJobOutcome — durable-insert failure is surfaced, never swallowed (F1 integration)', () => {
  it('publishes a flow-error over /api/stream when every job_events insert attempt fails, and the job is never phantom-completed', async () => {
    const failingSql = withFailingQuery(sql, 'insert into job_events', 999); // fail every attempt
    const app = createRestApi(failingSql, { executor: fastExecutor, newId });

    // Subscribe BEFORE dispatching — FlowHub does not buffer, a late subscriber misses earlier events.
    const streamRes = await app.handle(new Request('http://localhost/api/stream'));

    const text = `${MARK} always-fails chore`;
    const res = await sendA2A(app, projectId, text);
    const { id: workItemId } = ((await res.json()) as { result: { id: string } }).result;

    const evt = await waitForFlowEvent(
      streamRes,
      (e) => e.type === 'flow-error' && e.workItemId === workItemId && typeof e.message === 'string' && (e.message as string).includes('job_events insert failed after retries'),
    );
    expect(evt.workItemId).toBe(workItemId);

    // Never durably recorded -- no job_events row for this job at all.
    const eventRows = (await sql`select 1 from job_events where job_id = ${workItemId}`) as unknown[];
    expect(eventRows).toHaveLength(0);

    // Never phantom-completed either -- recordJobOutcome returned false, so its caller never
    // published 'flow-finished', and the job's own status is untouched by this failed attempt
    // (still whatever reconcile's own claim left it at — 'running', since nothing else in this
    // test moved it on).
    expect((await jobRow(workItemId))?.status).toBe('running');
  }, 15000);

  it('recovers via retry when the job_events insert fails only transiently, still reaching done', async () => {
    const failingSql = withFailingQuery(sql, 'insert into job_events', 2); // fail twice, then succeed
    const app = createRestApi(failingSql, { executor: fastExecutor, newId });

    const text = `${MARK} recovers chore`;
    const res = await sendA2A(app, projectId, text);
    const { id: workItemId } = ((await res.json()) as { result: { id: string } }).result;

    await waitFor(async () => (await jobRow(workItemId))?.status === 'done');

    const eventRows = (await sql`select 1 from job_events where job_id = ${workItemId} and kind = 'succeeded'`) as unknown[];
    expect(eventRows).toHaveLength(1);
  }, 15000);
});

/**
 * R1 (3자 리뷰 수정 라운드, Codex 재검증): consumeJobEvents' own per-event try/catch (graph/
 * reconcile.ts) logs a failed claim/apply transaction and moves on WITHOUT rethrowing — so
 * `await reconcileTask(...)` resolving normally does NOT mean the event this call cared about was
 * actually applied. Before this fix, recordJobOutcome had no way to tell the difference and reported
 * success regardless, publishing 'flow-finished' while the job sat 'running' forever. Reproduced by
 * targeting the CLAIM statement INSIDE consumeOneEvent's own transaction (not the job_events INSERT,
 * which must still succeed durably) with withFailingQuery's tx-aware wrapping.
 */
describe('recordJobOutcome — a failure INSIDE consumeJobEvents is not reported as a false success (R1)', () => {
  it('publishes flow-error (not flow-finished) while the consume keeps failing, and a later unobstructed sweep still applies the state', async () => {
    // 1 attempt inside reconcileTask's own inline consumeJobEvents call + 2 explicit retries inside
    // recordJobOutcome = 3 total attempts at the claim statement; all 3 must fail to reach the
    // "still unprocessed after retries" branch this test is proving.
    const failingSql = withFailingQuery(sql, 'update job_events set processed_at', 3);
    const app = createRestApi(failingSql, { executor: fastExecutor, newId });

    const streamRes = await app.handle(new Request('http://localhost/api/stream'));

    const text = `${MARK} consume-fails chore`;
    const res = await sendA2A(app, projectId, text);
    const { id: workItemId } = ((await res.json()) as { result: { id: string } }).result;

    const evt = await waitForFlowEvent(
      streamRes,
      (e) =>
        e.type === 'flow-error' &&
        e.workItemId === workItemId &&
        typeof e.message === 'string' &&
        (e.message as string).includes('durably recorded but not yet applied'),
    );
    expect(evt.workItemId).toBe(workItemId);

    // The fact WAS durably recorded (unlike the insert-failure scenario above) — only its
    // application was delayed by the injected claim failures.
    const eventRows = (await sql`
      select processed_at from job_events where job_id = ${workItemId} and kind = 'succeeded'
    `) as Array<{ processed_at: Date | null }>;
    expect(eventRows).toHaveLength(1);
    expect(eventRows[0]!.processed_at).toBeNull(); // still unprocessed at the moment flow-error fired

    // Never phantom-completed — 'flow-finished' was never published, and the job is still 'running'.
    expect((await jobRow(workItemId))?.status).toBe('running');

    // A later, unobstructed sweep (the injected failures are already exhausted) still recovers it —
    // durable was never lost, only delayed. Uses the REAL sql, representing the periodic
    // controller's own next tick rather than this same failed attempt retrying itself.
    const taskRows = (await sql`select task_id from jobs where id = ${workItemId}`) as Array<{ task_id: string }>;
    await consumeJobEvents(sql, taskRows[0]!.task_id);
    expect((await jobRow(workItemId))?.status).toBe('done');
  }, 15000);
});

/**
 * R3 (3자 리뷰 수정 라운드, Codex 재검증): the legacy direct work_items write (recordJobOutcome's
 * "no jobs mirror at all" carve-out) used to be `.catch(() => undefined)` — for a job the graph
 * never knew about, this write is the ONLY record its outcome will ever get (no job_events fallback
 * to retry into), so swallowing its failure silently lost the fact exactly the way F1's original bug
 * did. Reproduced the same way work-items-projection.spec.ts's own "already-terminal ctx" test gets
 * a job with no jobs-graph mirror: dispatching into a ctx whose task is already terminal makes
 * insertJob reject with TerminalTaskError, so `graphWriteOk` stays false and this job's completion
 * has nowhere to go but the legacy path.
 */
describe('recordJobOutcome — a legacy work_items fallback failure is surfaced, never swallowed (R3)', () => {
  it('publishes flow-error (not flow-finished) when the legacy completion write fails, for a job the graph never mirrored', async () => {
    const failingSql = withFailingQuery(sql, 'update work_items set state', 1); // the one legacy write this test triggers
    const app = createRestApi(failingSql, { executor: fastExecutor, newId });

    const ctx = `${MARK}-terminal-ctx`;
    await sql`insert into tasks (id, title, status) values (${ctx}, ${ctx}, 'done')`;

    const streamRes = await app.handle(new Request('http://localhost/api/stream'));

    const text = `${MARK} legacy-fallback-fails chore`;
    const rpcId = `${MARK}-rpc-legacy`;
    const res = await app.handle(
      new Request(`http://localhost/agents/${encodeURIComponent(projectId)}/a2a`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: rpcId,
          method: 'message/send',
          params: {
            message: {
              kind: 'message',
              messageId: `${rpcId}-msg`,
              role: 'user',
              parts: [{ kind: 'text', text }],
              contextId: ctx,
              metadata: { flowType: 'chore' },
            },
          },
        }),
      }),
    );
    const { id: workItemId } = ((await res.json()) as { result: { id: string } }).result;

    const evt = await waitForFlowEvent(
      streamRes,
      (e) =>
        e.type === 'flow-error' &&
        e.workItemId === workItemId &&
        typeof e.message === 'string' &&
        (e.message as string).includes('legacy work_items completion write failed'),
    );
    expect(evt.workItemId).toBe(workItemId);

    // Confirms the precondition actually held — no jobs mirror was ever created for this id.
    const jobRows = (await sql`select 1 from jobs where id = ${workItemId}`) as unknown[];
    expect(jobRows).toHaveLength(0);

    // The failed write never landed — work_items is stuck at dispatchTask's own initial insert
    // ('in_flow'), never silently marked 'done'.
    const wiRows = (await sql`select state from work_items where id = ${workItemId}`) as Array<{ state: string }>;
    expect(wiRows[0]!.state).toBe('in_flow');
  }, 15000);
});
