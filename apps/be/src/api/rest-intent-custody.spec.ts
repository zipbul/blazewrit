import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { SQL } from 'bun';
import { createRestApi } from './rest';
import { ensureSchema } from '../infra/schema';

/**
 * Intent custody contract: the flowType the user APPROVED on the intent card must survive the
 * A2A boundary. /api/dispatch carries it in message.metadata (A2A's sanctioned slot) and the
 * project-side handler prefers it over the keyword StubFlowClassifier fallback — otherwise the
 * approved card is decorative (approve 'refactor', regex runs 'feature').
 */
const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const MARK = `custody-${Date.now()}`;
const PROJECT = `${MARK}-proj`;

const post = (app: ReturnType<typeof createRestApi>, path: string, body: unknown) =>
  app.handle(new Request(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));

/** Drive the A2A endpoint directly (loopback self-fetch is not available inside app.handle tests). */
const a2aSend = (app: ReturnType<typeof createRestApi>, projectId: string, text: string, metadata?: Record<string, unknown>) =>
  post(app, `/agents/${encodeURIComponent(projectId)}/a2a`, {
    jsonrpc: '2.0',
    id: 'r1',
    method: 'message/send',
    params: { message: { kind: 'message', messageId: 'm1', role: 'user', parts: [{ kind: 'text', text }], ...(metadata ? { metadata } : {}) } },
  });

beforeAll(async () => {
  await ensureSchema(sql);
  await sql`insert into projects (id, name, status) values (${PROJECT}, ${PROJECT}, 'active') on conflict (id) do nothing`;
});

afterAll(async () => {
  // Each it() below only waits for the flows row to APPEAR (flowTypeOf polls on that), not for
  // the dispatched flow to actually settle. These workflows all include a 'decide' HITL step that
  // nothing here ever answers, so the flow suspends there rather than completing — but with the
  // default PacedStepExecutor (paced-executor.ts, ~2.4s per producer+reviewer step) it can still
  // be mid-'investigate' when this file's LAST test returns, still inserting step_runs. A late
  // insert landing between this afterAll's two delete statements below can violate the flows FK
  // (an intermittent failure observed in this file) — wait for every flow to leave 'active'
  // (suspended/completed/abandoned all stop making further step_runs writes) first.
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const active = (await sql`
      select 1 from flows f join work_items w on w.id = f.work_item_id where w.project_id = ${PROJECT} and f.status = 'active'
    `) as unknown[];
    if (active.length === 0) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  await sql`delete from step_runs where flow_id in (select f.id from flows f join work_items w on w.id = f.work_item_id where w.project_id = ${PROJECT})`;
  await sql`delete from flows where work_item_id in (select id from work_items where project_id = ${PROJECT})`;
  await sql`delete from work_items where project_id = ${PROJECT}`;
  await sql`delete from projects where id = ${PROJECT}`;
  await sql.end();
}, 20_000);

async function flowTypeOf(title: string): Promise<string | undefined> {
  // dispatchTask runs the flow in a background IIFE — poll briefly for the insert.
  for (let i = 0; i < 40; i++) {
    const rows = (await sql`
      select f.flow_type from flows f join work_items w on w.id = f.work_item_id
      where w.title = ${title} order by f.created_at desc limit 1
    `) as Array<{ flow_type: string }>;
    if (rows[0]) return rows[0].flow_type;
    await new Promise((r) => setTimeout(r, 50));
  }
  return undefined;
}

describe('intent custody across A2A', () => {
  it('uses the carried flowType instead of the keyword classifier', async () => {
    const app = createRestApi(sql, {});
    // text says "고쳐" (classifier → bugfix); the approved intent says refactor. Intent must win.
    const title = `${MARK} 이 코드 좀 고쳐줘`;
    const res = await a2aSend(app, PROJECT, title, { flowType: 'refactor' });
    expect(res.status).toBe(200);
    expect(await flowTypeOf(title)).toBe('refactor');
  });

  it('falls back to the classifier when no metadata rides along (project-origin traffic)', async () => {
    const app = createRestApi(sql, {});
    const title = `${MARK} 버그 고쳐줘`;
    const res = await a2aSend(app, PROJECT, title);
    expect(res.status).toBe(200);
    expect(await flowTypeOf(title)).toBe('bugfix');
  });

  it('rejects a flowType outside the enum (trust-boundary validation, not silent fallback)', async () => {
    const app = createRestApi(sql, {});
    const title = `${MARK} 아무거나`;
    await a2aSend(app, PROJECT, title, { flowType: 'nonsense-type' });
    // invalid carried value must not crash the flow — classifier decides
    expect(await flowTypeOf(title)).toBe('feature');
  });
});
