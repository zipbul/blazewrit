import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { SQL } from 'bun';
import { ensureSchema } from '../../infra/schema';
import { ensureTriageReadModel } from '../db/views.sql';
import { recordTurn, isValidScope, recentWindow, threadIndexCard, markFailed } from './turns';

const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const MARK = `turns-${Date.now()}`;
const SCOPE = `${MARK}-wi`;

beforeAll(async () => {
  await ensureSchema(sql);
  await ensureTriageReadModel(sql);
  await sql`insert into work_items (id, project_id, type, state, title) values (${SCOPE}, ${MARK}, 'task', 'in_flow', ${MARK + ' 작업'})`;
});

afterAll(async () => {
  await sql`delete from chat_messages where scope = ${SCOPE} or text like ${MARK + '%'}`;
  await sql`delete from work_items where id = ${SCOPE}`;
  await sql.end();
});

describe('recordTurn', () => {
  it('persists and returns the row seq', async () => {
    const r = await recordTurn(sql, { scope: SCOPE, role: 'user', text: `${MARK} 안녕` });
    expect(r.seq).toBeGreaterThan(0);
    expect(r.duplicate).toBe(false);
  });

  it('is idempotent on (scope, clientMsgId): retry returns the SAME seq, no second row', async () => {
    const a = await recordTurn(sql, { scope: SCOPE, role: 'user', text: `${MARK} 재시도`, clientMsgId: 'c1' });
    const b = await recordTurn(sql, { scope: SCOPE, role: 'user', text: `${MARK} 재시도`, clientMsgId: 'c1' });
    expect(b.seq).toBe(a.seq);
    expect(b.duplicate).toBe(true);
    const rows = (await sql`select count(*)::int as n from chat_messages where scope = ${SCOPE} and client_msg_id = 'c1'`) as Array<{ n: number }>;
    expect(rows[0]!.n).toBe(1);
  });

  it('stores payload jsonb when given', async () => {
    const r = await recordTurn(sql, { scope: SCOPE, role: 'agent', text: `${MARK} 표`, payload: { view: { title: 't' } } });
    const rows = (await sql`select payload from chat_messages where seq = ${r.seq}`) as Array<{ payload: unknown }>;
    const p = rows[0]!.payload;
    expect(typeof p === 'string' ? JSON.parse(p) : p).toEqual({ view: { title: 't' } });
  });
});

describe('isValidScope', () => {
  it("accepts 'central' and an existing work item id; rejects garbage", async () => {
    expect(await isValidScope(sql, 'central')).toBe(true);
    expect(await isValidScope(sql, SCOPE)).toBe(true);
    expect(await isValidScope(sql, `${MARK}-nope`)).toBe(false);
  });
});

describe('recentWindow', () => {
  it('returns the last N answered turns in seq order, excluding failed/redacted', async () => {
    const s = `${MARK}-win`;
    await sql`insert into work_items (id, project_id, type, state, title) values (${s}, ${MARK}, 'task', 'in_flow', 'w')`;
    for (let i = 1; i <= 5; i++) await recordTurn(sql, { scope: s, role: 'user', text: `${MARK} m${i}` });
    const bad = await recordTurn(sql, { scope: s, role: 'user', text: `${MARK} 실패` });
    await markFailed(sql, bad.seq);
    await sql`update chat_messages set redacted_at = now() where scope = ${s} and text = ${MARK + ' m1'}`;

    const win = await recentWindow(sql, s, { maxTurns: 3 });
    expect(win.map((w) => w.text)).toEqual([`${MARK} m3`, `${MARK} m4`, `${MARK} m5`]);
    await sql`delete from chat_messages where scope = ${s}`;
    await sql`delete from work_items where id = ${s}`;
  });

  it('truncates oversized messages with a bw_v_chat pointer', async () => {
    const s = `${MARK}-big`;
    await sql`insert into work_items (id, project_id, type, state, title) values (${s}, ${MARK}, 'task', 'in_flow', 'w')`;
    const big = await recordTurn(sql, { scope: s, role: 'user', text: 'x'.repeat(5000) });
    const win = await recentWindow(sql, s, { maxTurns: 5 });
    expect(win[0]!.text.length).toBeLessThan(2500);
    expect(win[0]!.text).toContain(`[전문은 bw_v_chat id=${big.seq}]`);
    await sql`delete from chat_messages where scope = ${s}`;
    await sql`delete from work_items where id = ${s}`;
  });
});

describe('threadIndexCard', () => {
  it('digests every scope with title, count, last activity — the map beyond the window', async () => {
    await recordTurn(sql, { scope: 'central', role: 'user', text: `${MARK} 중앙쪽` });
    const card = await threadIndexCard(sql);
    const mine = card.find((c) => c.scope === SCOPE);
    expect(mine).toBeDefined();
    expect(mine!.title).toBe(`${MARK} 작업`);
    expect(mine!.count).toBeGreaterThan(0);
    expect(card.find((c) => c.scope === 'central')).toBeDefined();
  });
});
