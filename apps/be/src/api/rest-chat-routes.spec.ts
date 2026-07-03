import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { SQL } from 'bun';
import { createRestApi } from './rest';
import { ensureSchema } from '../infra/schema';
import { ensureTriageReadModel } from '../triage/db/views.sql';
import type { TriageAgent, ChatArgs, TurnResult } from '../triage/triage-agent';

/**
 * Step-4 contract (TDD): every turn-producing surface persists through chat_messages;
 * /api/triage speaks {request, scope, clientMsgId} and hands the agent assembled history.
 */
const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const MARK = `chatroute-${Date.now()}`;
const SCOPE = `${MARK}-wi`;

function fakeTriage(turn: Partial<TurnResult>): TriageAgent & { calls: ChatArgs[] } {
  const calls: ChatArgs[] = [];
  return {
    calls,
    chat: async (args: ChatArgs) => {
      calls.push(args);
      return { reply: '응답', intent: null, feedback: null, view: null, ...turn } as TurnResult;
    },
  } as unknown as TriageAgent & { calls: ChatArgs[] };
}

const post = (app: ReturnType<typeof createRestApi>, path: string, body: unknown) =>
  app.handle(new Request(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const get = (app: ReturnType<typeof createRestApi>, path: string) => app.handle(new Request(`http://localhost${path}`));

const turns = async (scope: string) =>
  (await sql`select role, text, status, payload from chat_messages where scope = ${scope} order by seq`) as Array<Record<string, unknown>>;

beforeAll(async () => {
  await ensureSchema(sql);
  await ensureTriageReadModel(sql);
  await sql`insert into work_items (id, project_id, type, state, title) values (${SCOPE}, ${MARK}, 'task', 'in_flow', ${MARK + ' 작업'})`;
});

afterAll(async () => {
  await sql`delete from chat_messages where scope = ${SCOPE} or text like ${MARK + '%'}`;
  await sql`delete from decisions where question like ${MARK + '%'}`;
  await sql`delete from work_items where id = ${SCOPE}`;
  await sql.end();
});

describe('POST /api/triage (scoped, persisting)', () => {
  it('400s on an unknown scope (garbage scopes must not fork threads)', async () => {
    const app = createRestApi(sql, { triage: fakeTriage({}) });
    const res = await post(app, '/api/triage', { request: '안녕', scope: `${MARK}-garbage` });
    expect(res.status).toBe(400);
  });

  it('persists the user turn and the agent reply under the scope', async () => {
    const app = createRestApi(sql, { triage: fakeTriage({ reply: `${MARK} 답변` }) });
    const res = await post(app, '/api/triage', { request: `${MARK} 질문`, scope: SCOPE });
    expect(res.status).toBe(200);
    const rows = await turns(SCOPE);
    const texts = rows.map((r) => `${r.role}:${r.text}`);
    expect(texts).toContain(`user:${MARK} 질문`);
    expect(texts).toContain(`agent:${MARK} 답변`);
  });

  it('hands the agent {request, scope, history(window+card)} — not a raw string', async () => {
    const triage = fakeTriage({});
    const app = createRestApi(sql, { triage });
    await post(app, '/api/triage', { request: `${MARK} 두번째`, scope: SCOPE });
    const call = triage.calls.at(-1)!;
    expect(call.scope).toBe(SCOPE);
    expect(call.request).toBe(`${MARK} 두번째`);
    // window contains the just-persisted user turn and earlier turns of this scope
    expect(call.history.window.map((w) => w.text)).toContain(`${MARK} 두번째`);
    expect(call.history.card.find((c) => c.scope === SCOPE)).toBeDefined();
  });

  it('marks the user turn failed when the agent errors (excluded from future windows)', async () => {
    const boom = { chat: async () => { throw new Error('boom'); } } as unknown as TriageAgent;
    const app = createRestApi(sql, { triage: boom });
    const res = await post(app, '/api/triage', { request: `${MARK} 터짐`, scope: SCOPE });
    expect(res.status).toBe(500);
    const rows = await turns(SCOPE);
    const failed = rows.find((r) => r.text === `${MARK} 터짐`);
    expect(failed!.status).toBe('failed');
  });

  it('is idempotent on clientMsgId retry (no duplicate user turn)', async () => {
    const app = createRestApi(sql, { triage: fakeTriage({}) });
    await post(app, '/api/triage', { request: `${MARK} 멱등`, scope: SCOPE, clientMsgId: 'k1' });
    await post(app, '/api/triage', { request: `${MARK} 멱등`, scope: SCOPE, clientMsgId: 'k1' });
    const rows = (await sql`select count(*)::int as n from chat_messages where scope = ${SCOPE} and text = ${MARK + ' 멱등'}`) as Array<{ n: number }>;
    expect(rows[0]!.n).toBe(1);
  });

  it('persists intent/view into the agent turn payload (FE hydration source)', async () => {
    const view = { title: `${MARK}표`, columns: ['a'], rows: [['1']] };
    const app = createRestApi(sql, { triage: fakeTriage({ reply: `${MARK} 표답`, view }) });
    await post(app, '/api/triage', { request: `${MARK} 표요청`, scope: SCOPE });
    const rows = await turns(SCOPE);
    const agentRow = rows.find((r) => r.text === `${MARK} 표답`)!;
    const p = typeof agentRow.payload === 'string' ? JSON.parse(agentRow.payload as string) : agentRow.payload;
    expect((p as { view: unknown }).view).toEqual(view);
  });
});

describe('confirmation turns are server-side (no FE-fabricated bubbles)', () => {
  it('/api/dispatch records the ✓ confirmation turn in its scope', async () => {
    await sql`update projects set status = 'active' where id = ${MARK}` ;
    await sql`insert into projects (id, name, status) values (${MARK}, ${MARK}, 'active') on conflict (id) do nothing`;
    const app = createRestApi(sql, { selfBaseUrl: 'http://localhost:1' }); // A2A will fail — we only check the turn on success path? use newProjectName path instead
    const res = await post(app, '/api/dispatch', { request: `${MARK} 새프젝`, newProjectName: `${MARK}-np`, scope: SCOPE });
    expect(res.status).toBe(200);
    const rows = await turns(SCOPE);
    expect(rows.some((r) => r.role === 'agent' && String(r.text).includes('등록'))).toBe(true);
    await sql`delete from projects where id in (${MARK}, ${MARK + '-np'})`;
  });

  it('/api/clarify records the question turn and carries scope in meta', async () => {
    const app = createRestApi(sql, {});
    const res = await post(app, '/api/clarify', { request: `${MARK} 모호`, question: `${MARK} 어느쪽?`, options: [], scope: SCOPE });
    expect(res.status).toBe(200);
    const { decisionId } = (await res.json()) as { decisionId: string };
    const dec = (await sql`select meta from decisions where id = ${decisionId}`) as Array<{ meta: string }>;
    expect((JSON.parse(dec[0]!.meta) as { scope: string }).scope).toBe(SCOPE);
    const rows = await turns(SCOPE);
    expect(rows.some((r) => r.role === 'agent' && String(r.text).includes(`${MARK} 어느쪽?`))).toBe(true);
  });
});

describe('GET /api/chat/:scope (hydration)', () => {
  it('returns turns oldest-first with payload, supports before-cursor pagination', async () => {
    const app = createRestApi(sql, {});
    const res = await get(app, `/api/chat/${encodeURIComponent(SCOPE)}?limit=3`);
    expect(res.status).toBe(200);
    const list = (await res.json()) as Array<{ seq: number; role: string; text: string }>;
    expect(list.length).toBeGreaterThan(0);
    expect(list.length).toBeLessThanOrEqual(3);
    // oldest-first within the page
    const seqs = list.map((m) => m.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    // cursor: everything strictly before the first seq
    const res2 = await get(app, `/api/chat/${encodeURIComponent(SCOPE)}?limit=3&before=${seqs[0]}`);
    const list2 = (await res2.json()) as Array<{ seq: number }>;
    for (const m of list2) expect(m.seq).toBeLessThan(seqs[0]!);
  });

  it('excludes failed and redacted turns', async () => {
    const app = createRestApi(sql, {});
    const res = await get(app, `/api/chat/${encodeURIComponent(SCOPE)}?limit=100`);
    const list = (await res.json()) as Array<{ text: string }>;
    expect(list.every((m) => m.text !== `${MARK} 터짐`)).toBe(true);
  });

  it('excludes internal summary rows from hydration (the dock never shows them)', async () => {
    await sql`insert into chat_messages (scope, role, text) values (${SCOPE}, 'summary', ${MARK + ' 내부요약'})`;
    const app = createRestApi(sql, {});
    const res = await get(app, `/api/chat/${encodeURIComponent(SCOPE)}?limit=100`);
    const list = (await res.json()) as Array<{ text: string }>;
    expect(list.every((m) => m.text !== `${MARK} 내부요약`)).toBe(true);
  });
});
