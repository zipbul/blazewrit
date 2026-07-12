import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { SQL } from 'bun';
import { A2A_ERRORS } from '@bw/dto';
import { createRestApi } from './rest';
import { ensureSchema } from '../infra/schema';
import type { StepExecutor } from '../orchestrator/types';

/**
 * CHARACTERIZATION TEST — pins the CURRENT behavior of the "intent 1 -> work_item 1 -> runFlow 1"
 * path (message/send -> dispatchTask -> runFlow -> /api/decisions/:id/answer). All assertions
 * describe what the system does today; every test here is expected to be GREEN. No production
 * code is touched by this file.
 */

const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const MARK = `char-${process.pid}-${Date.now()}`;
const projectId = `${MARK}-proj`;

// Every id minted during these tests (work items, flows, step runs, decisions, learnings) is
// prefixed with MARK so afterAll can find and delete it all with a single LIKE per table.
let idSeq = 0;
const newId = () => `${MARK}-${idSeq++}`;

const passingExecutor: StepExecutor = {
  produce: async () => ({ output: 'out' }),
  review: async () => ({ verdict: 'pass' }),
};

const failingReviewerExecutor: StepExecutor = {
  produce: async () => ({ output: 'out' }),
  review: async () => ({ verdict: 'fail' }),
};

const app = createRestApi(sql, { executor: passingExecutor, newId });
const failingApp = createRestApi(sql, { executor: failingReviewerExecutor, newId });

/** JSON RPC ids are not persisted anywhere; a simple counter is enough to make them unique. */
let rpcSeq = 0;

function sendA2A(
  target: ReturnType<typeof createRestApi>,
  targetProjectId: string,
  text: string,
  opts: { metadata?: Record<string, unknown>; contextId?: string } = {},
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
        ...(opts.contextId ? { contextId: opts.contextId } : {}),
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

const post = (target: ReturnType<typeof createRestApi>, path: string, body: unknown) =>
  target.handle(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

/** Polls fn until it returns a truthy value, or throws with the last observed value. */
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

async function getWorkItem(id: string): Promise<Record<string, unknown> | undefined> {
  const rows = (await sql`select * from work_items where id = ${id}`) as Array<Record<string, unknown>>;
  return rows[0];
}

async function getFlowByWorkItem(workItemId: string): Promise<Record<string, unknown> | undefined> {
  const rows = (await sql`select * from flows where work_item_id = ${workItemId}`) as Array<Record<string, unknown>>;
  return rows[0];
}

beforeAll(async () => {
  await ensureSchema(sql);
  await sql`insert into projects (id, name, status) values (${projectId}, ${projectId}, ${'active'})`;
});

afterAll(async () => {
  await sql`delete from step_runs where flow_id like ${MARK + '%'}`;
  await sql`delete from flows where id like ${MARK + '%'}`;
  await sql`delete from learnings where id like ${MARK + '%'} or flow_id like ${MARK + '%'}`;
  await sql`delete from decisions where id like ${MARK + '%'}`;
  await sql`delete from chat_messages where scope like ${MARK + '%'}`;
  await sql`delete from work_items where id like ${MARK + '%'}`;
  await sql`delete from projects where id like ${MARK + '%'}`;
  await sql.end();
});

describe('dispatchTask via A2A message/send — response contract', () => {
  it('returns the A2A task envelope and creates a matching work_items row', async () => {
    const text = `${MARK} case1 plain request`;
    const res = await sendA2A(app, projectId, text);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.jsonrpc).toBe('2.0');
    const result = body.result as { kind: string; id: string; status: { state: string } };
    expect(result.kind).toBe('task');
    expect(result.status).toEqual({ state: 'working' });

    const workItemId = result.id;
    const row = await waitFor(() => getWorkItem(workItemId));
    expect(row.project_id).toBe(projectId);
    expect(row.title).toBe(text);
  });
});

describe('dispatchTask — chore flow (no decide gate)', () => {
  it('runs ground -> implement -> verify -> reflect to completion and marks the work item done', async () => {
    const text = `${MARK} case2 chore request`;
    const res = await sendA2A(app, projectId, text, { metadata: { flowType: 'chore' } });
    const { id: workItemId } = ((await res.json()) as { result: { id: string } }).result;

    const wi = await waitFor(async () => {
      const row = await getWorkItem(workItemId);
      return row?.state === 'done' ? row : undefined;
    });
    expect(wi.state).toBe('done');

    const flow = await getFlowByWorkItem(workItemId);
    expect(flow).toBeDefined();
    expect(flow!.status).toBe('completed');
    expect(flow!.flow_type).toBe('chore');
    expect(flow!.current_step).toBe('reflect');
  });

  it('records the producer step_runs in the fixed order ground, implement, verify, reflect', async () => {
    const text = `${MARK} case3 chore steps`;
    const res = await sendA2A(app, projectId, text, { metadata: { flowType: 'chore' } });
    const { id: workItemId } = ((await res.json()) as { result: { id: string } }).result;

    await waitFor(async () => {
      const row = await getWorkItem(workItemId);
      return row?.state === 'done' ? row : undefined;
    });
    const flow = await getFlowByWorkItem(workItemId);
    const rows = (await sql`
      select step_name from step_runs where flow_id = ${flow!.id as string} and role = 'producer' order by started_at, id
    `) as Array<{ step_name: string }>;
    expect(rows.map((r) => r.step_name)).toEqual(['ground', 'implement', 'verify', 'reflect']);
  });

  it('persists a learning row linked to the flow after reflect', async () => {
    const text = `${MARK} case4 chore learning`;
    const res = await sendA2A(app, projectId, text, { metadata: { flowType: 'chore' } });
    const { id: workItemId } = ((await res.json()) as { result: { id: string } }).result;

    await waitFor(async () => {
      const row = await getWorkItem(workItemId);
      return row?.state === 'done' ? row : undefined;
    });
    const flow = await getFlowByWorkItem(workItemId);
    const learnings = await waitFor(async () => {
      const rows = (await sql`select * from learnings where flow_id = ${flow!.id as string}`) as Array<Record<string, unknown>>;
      return rows.length ? rows : undefined;
    });
    expect(learnings).toHaveLength(1);
    expect(learnings[0]!.project_id).toBe(projectId);
  });
});

describe('dispatchTask — keyword flow classification (fallback)', () => {
  it('classifies a plain-text request with no metadata as feature by keyword fallback', async () => {
    const text = `${MARK} 그냥 새 기능 요청`;
    const res = await sendA2A(app, projectId, text);
    const { id: workItemId } = ((await res.json()) as { result: { id: string } }).result;
    const wi = await waitFor(() => getWorkItem(workItemId));
    expect(wi.type).toBe('feature');
  });

  it('classifies a request containing 버그 as type bug', async () => {
    const text = `${MARK} 버그 있어요 고쳐주세요`;
    const res = await sendA2A(app, projectId, text);
    const { id: workItemId } = ((await res.json()) as { result: { id: string } }).result;
    const wi = await waitFor(() => getWorkItem(workItemId));
    expect(wi.type).toBe('bug');
  });

  it('honors a carried metadata.flowType over the keyword classifier (research -> task)', async () => {
    // Contains 버그 (would classify bugfix by keyword) but the carried flowType wins (intent custody).
    const text = `${MARK} 버그 관련 조사`;
    const res = await sendA2A(app, projectId, text, { metadata: { flowType: 'research' } });
    const { id: workItemId } = ((await res.json()) as { result: { id: string } }).result;
    const wi = await waitFor(() => getWorkItem(workItemId));
    expect(wi.type).toBe('task');
  });

  it('ignores a non-enum metadata.flowType and falls back to keyword classification (feature)', async () => {
    const text = `${MARK} case15 평문 요청`;
    const res = await sendA2A(app, projectId, text, { metadata: { flowType: 'bogus' } });
    const { id: workItemId } = ((await res.json()) as { result: { id: string } }).result;
    const wi = await waitFor(() => getWorkItem(workItemId));
    expect(wi.type).toBe('feature');
  });
});

describe('dispatchTask — contextId correlation', () => {
  it('propagates an explicit message.contextId onto the work item', async () => {
    const text = `${MARK} case11 context passthrough`;
    const ctx = `${MARK}-ctx-external`;
    const res = await sendA2A(app, projectId, text, { metadata: { flowType: 'chore' }, contextId: ctx });
    const { id: workItemId } = ((await res.json()) as { result: { id: string } }).result;
    const wi = await waitFor(() => getWorkItem(workItemId));
    expect(wi.context_id).toBe(ctx);
  });

  it('defaults context_id to the work item\'s own id when contextId is absent', async () => {
    const text = `${MARK} case12 no context`;
    const res = await sendA2A(app, projectId, text, { metadata: { flowType: 'chore' } });
    const { id: workItemId } = ((await res.json()) as { result: { id: string } }).result;
    const wi = await waitFor(() => getWorkItem(workItemId));
    expect(wi.context_id).toBe(workItemId);
  });
});

describe('dispatchTask — decide HITL gate (feature flow)', () => {
  it('suspends the flow and opens a single_choice decision at the decide step', async () => {
    const text = `${MARK} case6 feature decide`;
    const res = await sendA2A(app, projectId, text, { metadata: { flowType: 'feature' } });
    const { id: workItemId } = ((await res.json()) as { result: { id: string } }).result;

    const flow = await waitFor(() => getFlowByWorkItem(workItemId));
    const decision = await waitFor(async () => {
      const rows = (await sql`
        select * from decisions where flow_id = ${flow.id as string} and status = 'open'
      `) as Array<Record<string, unknown>>;
      return rows[0];
    });
    expect(decision.request_type).toBe('single_choice');

    const flowRow = await waitFor(async () => {
      const rows = (await sql`select * from flows where id = ${flow.id as string}`) as Array<Record<string, unknown>>;
      return rows[0]?.status === 'suspended' ? rows[0] : undefined;
    });
    expect(flowRow.status).toBe('suspended');

    const wi = await getWorkItem(workItemId);
    expect(wi!.state).toBe('in_flow');
  });

  it('records the HITL question as an agent chat turn scoped to the work item', async () => {
    const text = `${MARK} case7 feature decide chat`;
    const res = await sendA2A(app, projectId, text, { metadata: { flowType: 'feature' } });
    const { id: workItemId } = ((await res.json()) as { result: { id: string } }).result;

    const flow = await waitFor(() => getFlowByWorkItem(workItemId));
    await waitFor(async () => {
      const rows = (await sql`
        select * from decisions where flow_id = ${flow.id as string} and status = 'open'
      `) as Array<Record<string, unknown>>;
      return rows[0];
    });
    const turn = await waitFor(async () => {
      const rows = (await sql`
        select * from chat_messages where scope = ${workItemId} and role = 'agent'
      `) as Array<Record<string, unknown>>;
      return rows[0];
    });
    expect(turn.text as string).toContain('질문함에서 답해주세요');
  });

  it('resumes and completes the flow when the open decision is answered approve', async () => {
    const text = `${MARK} case8 feature approve`;
    const res = await sendA2A(app, projectId, text, { metadata: { flowType: 'feature' } });
    const { id: workItemId } = ((await res.json()) as { result: { id: string } }).result;

    const flow = await waitFor(() => getFlowByWorkItem(workItemId));
    const decision = await waitFor(async () => {
      const rows = (await sql`
        select * from decisions where flow_id = ${flow.id as string} and status = 'open'
      `) as Array<Record<string, unknown>>;
      return rows[0];
    });

    const answerRes = await post(app, `/api/decisions/${decision.id as string}/answer`, { answer: 'approve' });
    expect(answerRes.status).toBe(200);

    const wi = await waitFor(async () => {
      const row = await getWorkItem(workItemId);
      return row?.state === 'done' ? row : undefined;
    });
    expect(wi.state).toBe('done');

    const flowRow = ((await sql`select * from flows where id = ${flow.id as string}`) as Array<Record<string, unknown>>)[0]!;
    expect(flowRow.status).toBe('completed');
  });

  it('abandons the flow and blocks the work item when the open decision is answered reject', async () => {
    const text = `${MARK} case9 feature reject`;
    const res = await sendA2A(app, projectId, text, { metadata: { flowType: 'feature' } });
    const { id: workItemId } = ((await res.json()) as { result: { id: string } }).result;

    const flow = await waitFor(() => getFlowByWorkItem(workItemId));
    const decision = await waitFor(async () => {
      const rows = (await sql`
        select * from decisions where flow_id = ${flow.id as string} and status = 'open'
      `) as Array<Record<string, unknown>>;
      return rows[0];
    });

    await post(app, `/api/decisions/${decision.id as string}/answer`, { answer: 'reject' });

    const wi = await waitFor(async () => {
      const row = await getWorkItem(workItemId);
      return row?.state === 'blocked' ? row : undefined;
    });
    expect(wi.state).toBe('blocked');

    const flowRow = ((await sql`select * from flows where id = ${flow.id as string}`) as Array<Record<string, unknown>>)[0]!;
    expect(flowRow.status).toBe('abandoned');
  });
});

describe('dispatchTask — reviewer never passes', () => {
  it('abandons the flow and blocks the work item when the reviewer always fails (chore)', async () => {
    const text = `${MARK} case10 chore failing reviewer`;
    const res = await sendA2A(failingApp, projectId, text, { metadata: { flowType: 'chore' } });
    const { id: workItemId } = ((await res.json()) as { result: { id: string } }).result;

    const wi = await waitFor(async () => {
      const row = await getWorkItem(workItemId);
      return row?.state === 'blocked' ? row : undefined;
    });
    expect(wi.state).toBe('blocked');

    const flow = await getFlowByWorkItem(workItemId);
    expect(flow!.status).toBe('abandoned');
  });
});

describe('dispatchTask — unregistered project', () => {
  it('404s with a JSON-RPC TASK_NOT_FOUND error', async () => {
    const res = await sendA2A(app, `${MARK}-no-such-project`, `${MARK} case16`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { jsonrpc: string; error: { code: number; message: string } };
    expect(body.jsonrpc).toBe('2.0');
    expect(body.error.code).toBe(A2A_ERRORS.TASK_NOT_FOUND);
    expect(body.error.message).toBe('unknown project');
  });
});
