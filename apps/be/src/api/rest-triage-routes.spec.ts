import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { SQL } from 'bun';
import { createRestApi } from './rest';
import { ensureSchema } from '../infra/schema';
import type { TriageAgent } from '../triage/triage-agent';
import type { TurnResult } from '../triage/triage-agent';

const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const MARK = `rest-spec-${Date.now()}`;

/** Fake central agent: returns a canned turn, records what it was asked. */
function fakeTriage(turn: TurnResult): TriageAgent & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    chat: async (args: { request: string }) => {
      asked.push(args.request);
      return turn;
    },
  } as unknown as TriageAgent & { asked: string[] };
}

const post = (app: ReturnType<typeof createRestApi>, path: string, body: unknown) =>
  app.handle(new Request(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const get = (app: ReturnType<typeof createRestApi>, path: string) => app.handle(new Request(`http://localhost${path}`));

beforeAll(async () => {
  await ensureSchema(sql);
});

afterAll(async () => {
  await sql`delete from chat_messages where text like ${'%' + MARK + '%'}`;
  await sql`delete from agent_feedback where content like ${MARK + '%'}`;
  await sql`delete from decisions where question like ${MARK + '%'}`;
  await sql.end();
});

describe('POST /api/triage', () => {
  it('400s on an empty request', async () => {
    const app = createRestApi(sql, { triage: fakeTriage({ reply: MARK, intent: null, feedback: null, view: null }) });
    const res = await post(app, '/api/triage', { request: '   ' });
    expect(res.status).toBe(400);
  });

  it('503s when no central agent is configured', async () => {
    const app = createRestApi(sql, {});
    const res = await post(app, '/api/triage', { request: `${MARK} 안녕` });
    expect(res.status).toBe(503);
  });

  it('passes reply/intent/view through verbatim', async () => {
    const view = { title: 't', columns: ['a'], rows: [['1']] };
    const app = createRestApi(sql, { triage: fakeTriage({ reply: `${MARK} 답`, intent: null, feedback: null, view }) });
    const res = await post(app, '/api/triage', { request: `${MARK} 보여줘` });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.reply).toBe(`${MARK} 답`);
    expect(body.view).toEqual(view);
    expect(body.intent).toBeNull();
  });

  it('persists agent feedback to the board when the turn carries one', async () => {
    const feedback = { category: 'ui' as const, content: `${MARK} 표 화면 없음` };
    const app = createRestApi(sql, { triage: fakeTriage({ reply: `${MARK} 못함`, intent: null, feedback, view: null }) });
    const res = await post(app, '/api/triage', { request: `${MARK} 요청` });
    expect(res.status).toBe(200);

    const rows = (await sql`select * from agent_feedback where content = ${feedback.content}`) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.category).toBe('ui');
    expect(rows[0]!.status).toBe('open');
    expect(rows[0]!.request).toBe(`${MARK} 요청`);
  });
});

describe('GET /api/feedback', () => {
  it('lists persisted feedback newest-first with the FE contract shape', async () => {
    const feedback = { category: 'feature' as const, content: `${MARK} 스케줄러 없음` };
    const app = createRestApi(sql, { triage: fakeTriage({ reply: `${MARK} x`, intent: null, feedback, view: null }) });
    await post(app, '/api/triage', { request: `${MARK} r2` });

    const res = await get(app, '/api/feedback');
    expect(res.status).toBe(200);
    const list = (await res.json()) as Array<Record<string, unknown>>;
    const mine = list.find((f) => f.content === feedback.content);
    expect(mine).toBeDefined();
    expect(mine).toMatchObject({ category: 'feature', status: 'open', request: `${MARK} r2` });
    expect(typeof mine?.createdAt).toBe('string');
  });
});

describe('POST /api/dispatch validation', () => {
  const app = createRestApi(sql, {});

  it('400s without a request', async () => {
    expect((await post(app, '/api/dispatch', { targetProject: 'x' })).status).toBe(400);
  });

  it('400s without a target or new-project name', async () => {
    expect((await post(app, '/api/dispatch', { request: 'r' })).status).toBe(400);
  });

  it('409s for a target project that is not active', async () => {
    expect((await post(app, '/api/dispatch', { request: 'r', targetProject: `${MARK}-none` })).status).toBe(409);
  });
});

describe('POST /api/clarify', () => {
  it('400s when request or question is missing', async () => {
    const app = createRestApi(sql, {});
    expect((await post(app, '/api/clarify', { request: 'r' })).status).toBe(400);
    expect((await post(app, '/api/clarify', { question: 'q' })).status).toBe(400);
  });

  it('opens a free_text clarification decision with the options attached', async () => {
    const app = createRestApi(sql, {});
    const res = await post(app, '/api/clarify', { request: `${MARK} 원요청`, question: `${MARK} 어느 쪽?`, options: ['a', 'b'] });
    expect(res.status).toBe(200);
    const { decisionId } = (await res.json()) as { decisionId: string };

    const rows = (await sql`select * from decisions where id = ${decisionId}`) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.request_type).toBe('free_text');
    // options/meta are stored as genuine jsonb (bun binds a plain array/object param correctly —
    // see meta/proposals.ts and graph/wake.ts's raiseWake for the jsonb-double-encoding story this
    // sidesteps), so the driver returns them already parsed; the string branch is defensive only.
    const options = typeof rows[0]!.options === 'string' ? JSON.parse(rows[0]!.options as string) : rows[0]!.options;
    expect(options).toEqual(['a', 'b']);
    const meta = (typeof rows[0]!.meta === 'string' ? JSON.parse(rows[0]!.meta as string) : rows[0]!.meta) as Record<string, unknown>;
    expect(meta.kind).toBe('clarification');
    expect(meta.request).toBe(`${MARK} 원요청`);
    expect(meta.scope).toBe('central'); // default scope when the caller omits it
  });
});
