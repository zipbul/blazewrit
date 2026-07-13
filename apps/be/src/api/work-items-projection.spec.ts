import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { SQL } from 'bun';
import { createRestApi } from './rest';
import { ensureSchema } from '../infra/schema';
import type { StepExecutor } from '../orchestrator/types';

/**
 * CHARACTERIZATION TEST for GET /api/work-items — pins the WorkItemDto contract (harness/
 * job-graph.md migration step 5: swapping the query from reading `work_items` directly to
 * projecting `jobs`+`tasks`+`flows`). Run once against the CURRENT (work_items-reading)
 * implementation to establish the green baseline, then again — unmodified — after the
 * projection swap: both runs must be green with no changes to this file. Helpers below are
 * deliberately duplicated from dispatch-task.characterization.spec.ts rather than imported —
 * that file is a separate frozen baseline and must not be touched by this work.
 */

const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const MARK = `wiproj-${process.pid}-${Date.now()}`;
const projectId = `${MARK}-proj`;

let idSeq = 0;
const newId = () => `${MARK}-${idSeq++}`;

const passingExecutor: StepExecutor = {
  produce: async () => ({ output: 'out' }),
  review: async () => ({ verdict: 'pass' }),
};

const app = createRestApi(sql, { executor: passingExecutor, newId });

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

async function getWorkItemsResponse(target: ReturnType<typeof createRestApi>): Promise<Array<Record<string, unknown>>> {
  const res = await target.handle(new Request('http://localhost/api/work-items'));
  return (await res.json()) as Array<Record<string, unknown>>;
}

async function findWorkItem(target: ReturnType<typeof createRestApi>, id: string): Promise<Record<string, unknown> | undefined> {
  const rows = await getWorkItemsResponse(target);
  return rows.find((r) => r.id === id);
}

/** Field assertions common to every row, regardless of scenario. */
function expectCommonShape(item: Record<string, unknown>, expected: { id: string; projectId: string; title: string }): void {
  expect(item.id).toBe(expected.id);
  expect(item.projectId).toBe(expected.projectId);
  expect(item.title).toBe(expected.title);
  expect(item.description).toBe('');
  expect(item.labels).toEqual([]);
  expect(item.priority).toBe(0);
  expect(item.source).toBe('user');
  expect(typeof item.createdAt).toBe('string');
  expect(new Date(item.createdAt as string).toISOString()).toBe(item.createdAt as string);
  expect(typeof item.updatedAt).toBe('string');
  expect(typeof item.activeFlowId).toBe('string');
}

beforeAll(async () => {
  await ensureSchema(sql);
  await sql`insert into projects (id, name, status) values (${projectId}, ${projectId}, ${'active'})`;
});

afterAll(async () => {
  await sql`delete from jobs where id like ${MARK + '%'}`;
  await sql`delete from tasks where id like ${MARK + '%'}`;
  await sql`delete from repos where id like ${MARK + '%'}`;
  await sql`delete from step_runs where flow_id like ${MARK + '%'}`;
  await sql`delete from flows where id like ${MARK + '%'}`;
  await sql`delete from decisions where id like ${MARK + '%'}`;
  await sql`delete from chat_messages where scope like ${MARK + '%'}`;
  await sql`delete from work_items where id like ${MARK + '%'}`;
  await sql`delete from projects where id like ${MARK + '%'}`;
  await sql.end();
});

describe('GET /api/work-items — DTO projection contract (harness/job-graph.md migration step 5)', () => {
  it('a completed chore dispatch (explicit contextId) projects a done row with completedAt', async () => {
    const text = `${MARK} case1 chore done`;
    const ctx = `${MARK}-ctx-a`;
    const res = await sendA2A(app, projectId, text, { metadata: { flowType: 'chore' }, contextId: ctx });
    const { id: workItemId } = ((await res.json()) as { result: { id: string } }).result;

    const item = await waitFor(async () => {
      const found = await findWorkItem(app, workItemId);
      return found?.state === 'done' ? found : undefined;
    });

    expectCommonShape(item, { id: workItemId, projectId, title: text });
    expect(item.type).toBe('task'); // chore -> workItemType fallback 'task'
    expect(item.state).toBe('done');
    expect(item.contextId).toBe(ctx);
    expect(typeof item.completedAt).toBe('string');
    expect(new Date(item.completedAt as string).toISOString()).toBe(item.completedAt as string);
  });

  it('a feature dispatch suspended at the decide gate projects an in_flow row with no completedAt', async () => {
    const text = `${MARK} case2 feature pending`;
    const res = await sendA2A(app, projectId, text, { metadata: { flowType: 'feature' } });
    const { id: workItemId } = ((await res.json()) as { result: { id: string } }).result;

    const item = await waitFor(async () => {
      const found = await findWorkItem(app, workItemId);
      return found?.activeFlowId ? found : undefined;
    });

    expectCommonShape(item, { id: workItemId, projectId, title: text });
    expect(item.type).toBe('feature');
    expect(item.state).toBe('in_flow');
    // No contextId was carried -> defaults to the work item's own id.
    expect(item.contextId).toBe(workItemId);
    expect(item.completedAt).toBeUndefined();
  });

  it('a feature dispatch rejected at the decide gate projects a blocked row with no completedAt', async () => {
    const text = `${MARK} case3 feature reject`;
    const res = await sendA2A(app, projectId, text, { metadata: { flowType: 'feature' } });
    const { id: workItemId } = ((await res.json()) as { result: { id: string } }).result;

    const flowId = await waitFor(async () => {
      const found = await findWorkItem(app, workItemId);
      return found?.activeFlowId as string | undefined;
    });
    const decision = await waitFor(async () => {
      const rows = (await sql`select * from decisions where flow_id = ${flowId} and status = 'open'`) as Array<Record<string, unknown>>;
      return rows[0];
    });
    await post(app, `/api/decisions/${decision.id as string}/answer`, { answer: 'reject' });

    const item = await waitFor(async () => {
      const found = await findWorkItem(app, workItemId);
      return found?.state === 'blocked' ? found : undefined;
    });

    expectCommonShape(item, { id: workItemId, projectId, title: text });
    expect(item.type).toBe('feature');
    expect(item.state).toBe('blocked');
    expect(item.completedAt).toBeUndefined();
  });
});
