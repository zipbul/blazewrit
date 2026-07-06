import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { SQL } from 'bun';
import { ensureSchema } from '../../infra/schema';
import { ensureTriageReadModel } from './views.sql';
import { runReadOnly } from './read-only-query';

/**
 * Step-1 contract: chat_messages storage + bw_v_chat read surface (똘이 conversation memory).
 * Written FIRST (TDD) — defines the schema/view behavior the implementation must satisfy.
 */
const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const MARK = `chatspec-${Date.now()}`;
const SCOPE = `${MARK}-wi`;

beforeAll(async () => {
  await ensureSchema(sql);
  await ensureTriageReadModel(sql);
  // a work item the scope can join to (scope_title comes from work_items.title)
  await sql`insert into work_items (id, project_id, type, state, title) values (${SCOPE}, ${MARK}, 'task', 'in_flow', ${MARK + ' 제목'})`;
});

afterAll(async () => {
  await sql`delete from chat_messages where scope like ${MARK + '%'} or scope = 'central' and text like ${MARK + '%'}`;
  await sql`delete from chat_messages where text like ${MARK + '%'}`;
  await sql`delete from work_items where id = ${SCOPE}`;
  await sql.end();
});

describe('chat_messages storage contract', () => {
  it('persists a turn with seq ordering even at identical timestamps', async () => {
    const ts = '2026-07-03T00:00:00Z';
    await sql`insert into chat_messages (scope, role, text, created_at) values (${SCOPE}, 'user', ${MARK + ' 첫째'}, ${ts})`;
    await sql`insert into chat_messages (scope, role, text, created_at) values (${SCOPE}, 'agent', ${MARK + ' 둘째'}, ${ts})`;
    const rows = (await sql`select text from chat_messages where scope = ${SCOPE} order by seq`) as Array<{ text: string }>;
    expect(rows.map((r) => r.text)).toEqual([`${MARK} 첫째`, `${MARK} 둘째`]);
  });

  it('rejects a duplicate (scope, client_msg_id) — idempotent retry anchor', async () => {
    await sql`insert into chat_messages (scope, role, text, client_msg_id) values (${SCOPE}, 'user', ${MARK + ' cm'}, 'cm-1')`;
    let dup = false;
    try {
      await sql`insert into chat_messages (scope, role, text, client_msg_id) values (${SCOPE}, 'user', ${MARK + ' cm2'}, 'cm-1')`;
    } catch {
      dup = true;
    }
    expect(dup).toBe(true);
  });

  it("admits role='summary' (future compaction rows)", async () => {
    await sql`insert into chat_messages (scope, role, text) values (${SCOPE}, 'summary', ${MARK + ' 요약'})`;
    const rows = (await sql`select role from chat_messages where text = ${MARK + ' 요약'}`) as Array<{ role: string }>;
    expect(rows[0]!.role).toBe('summary');
  });
});

describe('bw_v_chat read surface (agent-visible)', () => {
  it('exposes id/scope/scope_title/role/text/created_at — and joins the work-item title', async () => {
    const { rows } = await runReadOnly(sql, `select * from bw_v_chat where scope = '${SCOPE}' order by id limit 1`);
    const r = rows[0] as Record<string, unknown>;
    expect(r).toBeDefined();
    expect(Object.keys(r).sort()).toEqual(['created_at', 'id', 'role', 'scope', 'scope_title', 'text']);
    expect(r.scope_title).toBe(`${MARK} 제목`);
  });

  it("labels the central scope '중앙' without a join", async () => {
    await sql`insert into chat_messages (scope, role, text) values ('central', 'user', ${MARK + ' 중앙발화'})`;
    const { rows } = await runReadOnly(sql, `select scope_title from bw_v_chat where text = '${MARK} 중앙발화'`);
    expect((rows[0] as { scope_title: string }).scope_title).toBe('중앙');
  });

  it('filters redacted rows (secret kill-switch)', async () => {
    await sql`insert into chat_messages (scope, role, text, redacted_at) values (${SCOPE}, 'user', ${MARK + ' 비밀'}, now())`;
    const { rows } = await runReadOnly(sql, `select * from bw_v_chat where text = '${MARK} 비밀'`);
    expect(rows).toHaveLength(0);
  });

  it('does NOT expose payload/status/client_msg_id (text-only view)', async () => {
    await expect(runReadOnly(sql, `select payload from bw_v_chat limit 1`)).rejects.toThrow();
    await expect(runReadOnly(sql, `select status from bw_v_chat limit 1`)).rejects.toThrow();
  });

  it('excludes failed turns from the surface', async () => {
    await sql`insert into chat_messages (scope, role, text, status) values (${SCOPE}, 'user', ${MARK + ' 실패턴'}, 'failed')`;
    const { rows } = await runReadOnly(sql, `select * from bw_v_chat where text = '${MARK} 실패턴'`);
    expect(rows).toHaveLength(0);
  });
});

describe('bw_v_decisions Q→A reconstruction', () => {
  it('exposes answer + answered_at so structured-first recall can rebuild exchanges', async () => {
    const id = `${MARK}-dec`;
    await sql`insert into decisions (id, status, request_type, question, options, answer, answered_at) values (${id}, 'answered', 'free_text', ${MARK + ' 질문?'}, '[]', ${MARK + ' 답'}, now())`;
    const { rows } = await runReadOnly(sql, `select question, answer from bw_v_decisions where id = '${id}'`);
    expect((rows[0] as { answer: string }).answer).toBe(`${MARK} 답`);
    await sql`delete from decisions where id = ${id}`;
  });
});
