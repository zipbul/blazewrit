import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { SQL } from 'bun';
import { createRestApi } from './rest';
import { ensureSchema } from '../infra/schema';
import type { StepExecutor } from '../orchestrator/types';

/**
 * P3 migration 10 / rule 8 (harness/job-graph.md), spec A: A2A message.messageId idempotency at
 * the /agents/:projectId/a2a message/send handler. A replayed messageId (network retry,
 * at-least-once redelivery) must re-run nothing — the stored response from the first successful
 * processing is returned verbatim, and no second work_item/job is ever created (A1/A4). Only a
 * SUCCESSFUL response is ever stored — a request that throws mid-processing leaves no a2a_inbox
 * row, so a retry after a transient failure still gets to actually process (A5). messageId is
 * also now a required field (F3): every real caller in this codebase already sends one.
 */
const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const MARK = `a2aidem-${process.pid}-${Date.now()}`;
const projectId = `${MARK}-proj`;

const passingExecutor: StepExecutor = {
  produce: async () => ({ output: 'out' }),
  review: async () => ({ verdict: 'pass' }),
};

let idSeq = 0;
const newId = () => `${MARK}-${idSeq++}`;

function sendA2A(app: ReturnType<typeof createRestApi>, text: string, messageId?: string, rpcId = `${MARK}-rpc`): Promise<Response> {
  const envelope = {
    jsonrpc: '2.0',
    id: rpcId,
    method: 'message/send',
    params: {
      message: {
        kind: 'message',
        role: 'user',
        parts: [{ kind: 'text', text }],
        metadata: { flowType: 'chore' },
        ...(messageId !== undefined ? { messageId } : {}),
      },
    },
  };
  return app.handle(
    new Request(`http://localhost/agents/${encodeURIComponent(projectId)}/a2a`, {
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

async function jobCountByTitle(title: string): Promise<number> {
  const rows = (await sql`select count(*)::int as n from jobs where title = ${title}`) as Array<{ n: number }>;
  return rows[0]!.n;
}

async function inboxRow(messageId: string): Promise<unknown> {
  const rows = (await sql`select response from a2a_inbox where message_id = ${messageId}`) as Array<{ response: unknown }>;
  return rows[0];
}

beforeAll(async () => {
  await ensureSchema(sql);
  await sql`insert into projects (id, name, status) values (${projectId}, ${projectId}, 'active') on conflict (id) do nothing`;
});

afterAll(async () => {
  await sql`delete from a2a_inbox where message_id like ${MARK + '%'}`;
  await sql`delete from job_events where job_id like ${MARK + '%'}`;

  await sql`delete from jobs where id like ${MARK + '%'}`;
  await sql`delete from tasks where id like ${MARK + '%'}`;
  await sql`delete from repos where id like ${MARK + '%'}`;
  await sql`delete from step_runs where flow_id like ${MARK + '%'}`;
  await sql`delete from learnings where flow_id like ${MARK + '%'}`;
  await sql`delete from flows where id like ${MARK + '%'}`;
  await sql`delete from work_items where project_id = ${projectId}`;
  await sql`delete from projects where id = ${projectId}`;
  await sql.end();
});

describe('A2A messageId idempotency (P3 migration 10, rule 8)', () => {
  it('rejects message/send with no messageId (F3: required field)', async () => {
    const app = createRestApi(sql, { executor: passingExecutor, newId });
    const res = await sendA2A(app, `${MARK} no message id`, undefined);
    expect(res.status).toBe(400);
  });

  it('A1+A4: a replayed messageId dispatches only once and returns the stored response verbatim', async () => {
    const app = createRestApi(sql, { executor: passingExecutor, newId });
    const messageId = `${MARK}-msg-a1`;
    const firstTitle = `${MARK} a1 first intent`;
    const secondTitle = `${MARK} a1 second intent must never dispatch`;

    const res1 = await sendA2A(app, firstTitle, messageId);
    expect(res1.status).toBe(200);
    const body1 = await res1.json();

    // Same messageId, DIFFERENT text: if idempotency actually short-circuits before dispatchTask,
    // this second text can never appear as a job — that's the proof, not just a status check.
    const res2 = await sendA2A(app, secondTitle, messageId);
    expect(res2.status).toBe(200);
    const body2 = await res2.json();

    expect(body2).toEqual(body1); // A4: identical stored response, not a freshly computed one

    await waitFor(async () => ((await jobCountByTitle(firstTitle)) === 1 ? true : undefined));
    expect(await jobCountByTitle(secondTitle)).toBe(0); // A1: the replay never re-dispatched
  });

  it('A5: a throw during processing leaves no inbox record, so a retry actually processes', async () => {
    let calls = 0;
    const throwOnceId = () => {
      calls += 1;
      if (calls === 1) throw new Error('boom-mid-processing');
      return `${MARK}-a5-${calls}`;
    };
    const app = createRestApi(sql, { executor: passingExecutor, newId: throwOnceId });
    const messageId = `${MARK}-msg-a5`;
    const title = `${MARK} a5 retry intent`;

    const res1 = await sendA2A(app, title, messageId);
    expect(res1.status).toBe(500); // the injected throw fails this attempt before any response is built
    expect(await inboxRow(messageId)).toBeUndefined(); // nothing recorded — the throw never reached the insert

    const res2 = await sendA2A(app, title, messageId); // retry with the same messageId — newId now succeeds
    expect(res2.status).toBe(200);

    await waitFor(async () => ((await jobCountByTitle(title)) === 1 ? true : undefined)); // the retry actually ran
  });

  it('regression: a2a_inbox.response is stored as a genuine jsonb object, not double-encoded', async () => {
    // A jsonb column bound from a JSON.stringify'd string double-encodes it as a jsonb STRING
    // SCALAR (graph/wake.ts's raiseWake has the full story) — a -> path operator only sees
    // through a REAL jsonb object; against a double-encoded scalar it reads back SQL NULL.
    const app = createRestApi(sql, { executor: passingExecutor, newId });
    const messageId = `${MARK}-msg-jsonb`;
    const title = `${MARK} jsonb regression intent`;

    const res = await sendA2A(app, title, messageId);
    expect(res.status).toBe(200);
    await waitFor(async () => ((await jobCountByTitle(title)) === 1 ? true : undefined)); // let the background graph-write settle before cleanup

    const rows = (await sql`select response -> 'result' ->> 'kind' as kind from a2a_inbox where message_id = ${messageId}`) as Array<{
      kind: string | null;
    }>;
    expect(rows[0]?.kind).toBe('task');
  });

  it('replay returns the CURRENT request\'s JSON-RPC envelope id, not the one from the first call', async () => {
    // message.messageId (idempotency key) and the JSON-RPC envelope id (transport correlation)
    // are different fields — a retry may legitimately carry a fresh envelope id even for the
    // exact same messageId, and the caller expects ITS id echoed back, not a stale one.
    const app = createRestApi(sql, { executor: passingExecutor, newId });
    const messageId = `${MARK}-msg-rpcid`;
    const title = `${MARK} rpc id override intent`;

    const res1 = await sendA2A(app, title, messageId, `${MARK}-rpc-first`);
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as { id: string };
    expect(body1.id).toBe(`${MARK}-rpc-first`);
    await waitFor(async () => ((await jobCountByTitle(title)) === 1 ? true : undefined)); // let the background graph-write settle before cleanup

    const res2 = await sendA2A(app, title, messageId, `${MARK}-rpc-second`); // replay, different envelope id
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { id: string };
    expect(body2.id).toBe(`${MARK}-rpc-second`);
  });

  /**
   * D-round task #10 (Codex critical rest.ts:718 + Grok F-C1): the OLD shape was check-then-act —
   * SELECT for a stored response, then run the side effect, then INSERT `on conflict do nothing`.
   * Two concurrent requests for the SAME messageId could both pass the SELECT (nothing stored yet)
   * and both run dispatchTask; the conflict-do-nothing insert only ever suppressed the SECOND
   * insert's WRITE, never the second RUN's side effect. Reproduced deterministically (no timing
   * luck): seed the pending claim sentinel directly, exactly as if a real concurrent request had
   * already won the insert-first claim and simply hadn't finished processing yet.
   */
  it('D3: a request whose messageId is already claimed (still processing) never re-runs the side effect', async () => {
    const app = createRestApi(sql, { executor: passingExecutor, newId });
    const messageId = `${MARK}-msg-d3`;
    const title = `${MARK} d3 concurrent intent`;

    await sql`insert into a2a_inbox (message_id, response) values (${messageId}, ${{ pending: true }})`;

    const res = await sendA2A(app, title, messageId);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error?: { message: string } };
    expect(body.error?.message).toContain('already being processed');

    expect(await jobCountByTitle(title)).toBe(0); // the loser never ran dispatchTask
    expect(await inboxRow(messageId)).toEqual({ response: { pending: true } }); // winner's claim untouched
  });

  it('D3: once the winner finishes (real response stored), a later request for the SAME messageId replays it — not "still processing"', async () => {
    const app = createRestApi(sql, { executor: passingExecutor, newId });
    const messageId = `${MARK}-msg-d3-done`;
    const title = `${MARK} d3 done intent`;
    const realResponse = { jsonrpc: '2.0', id: 'whatever', result: { kind: 'task', id: 'x', status: { state: 'working' } } };
    await sql`insert into a2a_inbox (message_id, response) values (${messageId}, ${realResponse})`;

    const res = await sendA2A(app, title, messageId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result?: unknown };
    expect(body.result).toEqual(realResponse.result);
    expect(await jobCountByTitle(title)).toBe(0); // replay, never actually dispatched
  });
});
