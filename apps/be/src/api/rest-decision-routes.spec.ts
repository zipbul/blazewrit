import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { SQL } from 'bun';
import { createRestApi } from './rest';
import { ensureSchema } from '../infra/schema';
import { raiseWake } from '../graph/wake';

/**
 * Decision-answer safety contract: answering is idempotent — a decision can be answered
 * exactly ONCE; a replay (double-click, resent request, cross-origin script) must 409 and
 * must NOT re-fire side effects (A2A dispatch / registration / connection).
 */
const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const MARK = `decroute-${Date.now()}`;

const post = (app: ReturnType<typeof createRestApi>, path: string, body: unknown) =>
  app.handle(new Request(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));

const get = (app: ReturnType<typeof createRestApi>, path: string) => app.handle(new Request(`http://localhost${path}`));

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

describe('GET /api/decisions — agent_wake rows are non-blocking (harness/job-graph.md P2)', () => {
  it('surfaces a wake record with blocking=false and requestingAgent=하네스', async () => {
    const taskId = `${MARK}-wake-task`;
    const wakeNewId = () => `${MARK}-wake-${Date.now()}`;
    const { id: wakeId } = await raiseWake(sql, { kind: 'stalled', taskId, reason: `${MARK} 테스트 사유` }, wakeNewId);

    const app = createRestApi(sql, {});
    const res = await get(app, '/api/decisions');
    const body = (await res.json()) as Array<Record<string, unknown>>;
    const row = body.find((d) => d.id === wakeId);

    expect(row).toBeDefined();
    expect(row!.blocking).toBe(false);
    expect(row!.requestingAgent).toBe('하네스');
    expect(row!.requestType).toBe('agent_wake');
  });
});
