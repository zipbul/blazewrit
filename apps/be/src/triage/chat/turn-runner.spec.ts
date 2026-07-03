import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { SQL } from 'bun';
import { ensureSchema } from '../../infra/schema';
import { recordTurn } from './turns';
import { runTriageTurn, assembleHistory } from './turn-runner';
import type { TriageAgent, ChatArgs, TurnResult } from '../triage-agent';

/**
 * Step-4 contract (TDD): ONE turn-runner used by every conversational surface
 * (/api/triage AND the decision-answer clarification branch) — no divergent policy forks.
 */
const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const MARK = `runner-${Date.now()}`;
const SCOPE = `${MARK}-wi`;

function fakeAgent(turn: Partial<TurnResult>, opts?: { fail?: boolean }): TriageAgent & { calls: ChatArgs[] } {
  const calls: ChatArgs[] = [];
  return {
    calls,
    chat: async (args: ChatArgs) => {
      calls.push(args);
      if (opts?.fail) throw new Error('boom');
      return { reply: '응답', intent: null, feedback: null, view: null, ...turn } as TurnResult;
    },
  } as unknown as TriageAgent & { calls: ChatArgs[] };
}

const rows = async () =>
  (await sql`select role, text, status, payload from chat_messages where scope = ${SCOPE} order by seq`) as Array<Record<string, unknown>>;

beforeAll(async () => {
  await ensureSchema(sql);
  await sql`insert into work_items (id, project_id, type, state, title) values (${SCOPE}, ${MARK}, 'task', 'in_flow', ${MARK + ' 작업'})`;
});

afterAll(async () => {
  await sql`delete from chat_messages where scope = ${SCOPE}`;
  await sql`delete from agent_feedback where content like ${MARK + '%'}`;
  await sql`delete from work_items where id = ${SCOPE}`;
  await sql.end();
});

describe('assembleHistory', () => {
  it('returns window + card, and injects the latest summary ABOVE the window', async () => {
    await recordTurn(sql, { scope: SCOPE, role: 'user', text: `${MARK} 발화` });
    await recordTurn(sql, { scope: SCOPE, role: 'summary', text: `${MARK} 요약`, payload: { upTo: 1 } });
    const h = await assembleHistory(sql, SCOPE);
    expect(h.window[0]!.role).toBe('summary');
    expect(h.window[0]!.text).toBe(`${MARK} 요약`);
    expect(h.window.slice(1).every((w) => w.role !== 'summary')).toBe(true);
    expect(h.card.find((c) => c.scope === SCOPE)).toBeDefined();
  });
});

describe('runTriageTurn (the ONE conversational loop)', () => {
  it('records user+agent turns, persists intent/view payload, returns the TurnResult', async () => {
    const view = { title: `${MARK}표`, columns: ['a'], rows: [['1']] };
    const agent = fakeAgent({ reply: `${MARK} 답`, view });
    const out = await runTriageTurn(sql, agent, { scope: SCOPE, request: `${MARK} 질문` });
    expect(out.reply).toBe(`${MARK} 답`);
    const r = await rows();
    expect(r.some((x) => x.role === 'user' && x.text === `${MARK} 질문`)).toBe(true);
    const agentRow = r.find((x) => x.text === `${MARK} 답`)!;
    const p = typeof agentRow.payload === 'string' ? JSON.parse(agentRow.payload as string) : agentRow.payload;
    expect((p as { view: unknown }).view).toEqual(view);
  });

  it('persists agent feedback to the board (no surface may drop it)', async () => {
    const feedback = { category: 'ui' as const, content: `${MARK} 결핍` };
    const agent = fakeAgent({ feedback });
    await runTriageTurn(sql, agent, { scope: SCOPE, request: `${MARK} 요청2` });
    const fb = (await sql`select * from agent_feedback where content = ${feedback.content}`) as Array<unknown>;
    expect(fb).toHaveLength(1);
  });

  it('marks the user turn failed when the agent throws (and rethrows)', async () => {
    const agent = fakeAgent({}, { fail: true });
    await expect(runTriageTurn(sql, agent, { scope: SCOPE, request: `${MARK} 터짐` })).rejects.toThrow('boom');
    const r = await rows();
    expect(r.find((x) => x.text === `${MARK} 터짐`)!.status).toBe('failed');
  });

  it('short-circuits a clientMsgId duplicate WITHOUT re-running the agent', async () => {
    const agent = fakeAgent({ reply: `${MARK} 원답` });
    await runTriageTurn(sql, agent, { scope: SCOPE, request: `${MARK} 멱등`, clientMsgId: 'dup1' });
    const again = fakeAgent({ reply: `${MARK} 재답` });
    const out = await runTriageTurn(sql, again, { scope: SCOPE, request: `${MARK} 멱등`, clientMsgId: 'dup1' });
    expect(again.calls).toHaveLength(0); // no double LLM run
    expect(out.duplicate).toBe(true);
    const r = await rows();
    expect(r.filter((x) => x.text === `${MARK} 멱등`)).toHaveLength(1);
    expect(r.some((x) => x.text === `${MARK} 재답`)).toBe(false);
  });
});
