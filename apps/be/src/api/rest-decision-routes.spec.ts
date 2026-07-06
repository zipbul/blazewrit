import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { SQL } from 'bun';
import { createRestApi } from './rest';
import { ensureSchema } from '../infra/schema';

/**
 * Decision-answer safety contract: answering is idempotent — a decision can be answered
 * exactly ONCE; a replay (double-click, resent request, cross-origin script) must 409 and
 * must NOT re-fire side effects (A2A dispatch / registration / connection).
 */
const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const MARK = `decroute-${Date.now()}`;

const post = (app: ReturnType<typeof createRestApi>, path: string, body: unknown) =>
  app.handle(new Request(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));

beforeAll(async () => {
  await ensureSchema(sql);
});

afterAll(async () => {
  await sql`delete from decisions where id like ${MARK + '%'}`;
  await sql`delete from chat_messages where text like ${'%' + MARK + '%'}`;
  await sql.end();
});

describe('POST /api/decisions/:id/answer idempotency', () => {
  it('404s for an unknown decision', async () => {
    const app = createRestApi(sql, {});
    const res = await post(app, `/api/decisions/${MARK}-none/answer`, { answer: 'approved' });
    expect(res.status).toBe(404);
  });

  it('answers an open decision once, then 409s on replay (no side-effect re-fire)', async () => {
    const id = `${MARK}-d1`;
    await sql`insert into decisions (id, status, request_type, question, options) values (${id}, 'open', 'free_text', ${MARK + ' q'}, '[]')`;
    const app = createRestApi(sql, {});

    const first = await post(app, `/api/decisions/${id}/answer`, { answer: '첫 답' });
    expect(first.status).toBe(200);

    const replay = await post(app, `/api/decisions/${id}/answer`, { answer: '재전송 답' });
    expect(replay.status).toBe(409);

    const rows = (await sql`select answer from decisions where id = ${id}`) as Array<{ answer: string }>;
    expect(rows[0]!.answer).toBe('첫 답'); // the replay must not overwrite
  });
});
