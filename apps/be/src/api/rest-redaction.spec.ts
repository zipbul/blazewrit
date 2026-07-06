import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { SQL } from 'bun';
import { createRestApi } from './rest';
import { ensureSchema } from '../infra/schema';
import { recordTurn, recentWindow } from '../triage/chat/turns';
import { runReadOnly } from '../triage/db/read-only-query';

/**
 * Redaction contract: redacted_at finally gets a WRITER. Tombstoning a turn removes it from
 * every read path — the agent view (bw_v_chat), the prompt window, and FE hydration — giving
 * the user a kill-switch for pasted secrets. Text is also overwritten so the secret does not
 * survive in the row.
 */
const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const MARK = `redact-${Date.now()}`;
const SCOPE = `${MARK}-wi`;

const del = (app: ReturnType<typeof createRestApi>, path: string) =>
  app.handle(new Request(`http://localhost${path}`, { method: 'POST' }));
const get = (app: ReturnType<typeof createRestApi>, path: string) => app.handle(new Request(`http://localhost${path}`));

beforeAll(async () => {
  await ensureSchema(sql);
  await sql`insert into work_items (id, project_id, type, state, title) values (${SCOPE}, ${MARK}, 'task', 'in_flow', ${MARK})`;
});

afterAll(async () => {
  await sql`delete from chat_messages where scope = ${SCOPE}`;
  await sql`delete from work_items where id = ${SCOPE}`;
  await sql.end();
});

describe('POST /api/chat/:scope/:seq/redact', () => {
  it('tombstones the turn: gone from hydration, the window, and the agent view; text scrubbed', async () => {
    const app = createRestApi(sql, {});
    const secret = await recordTurn(sql, { scope: SCOPE, role: 'user', text: `${MARK} 비밀토큰=abc123` });
    await recordTurn(sql, { scope: SCOPE, role: 'user', text: `${MARK} 평범한 말` });

    const res = await del(app, `/api/chat/${encodeURIComponent(SCOPE)}/${secret.seq}/redact`);
    expect(res.status).toBe(200);

    // hydration
    const hyd = (await (await get(app, `/api/chat/${encodeURIComponent(SCOPE)}?limit=50`)).json()) as Array<{ text: string }>;
    expect(hyd.some((m) => m.text.includes('abc123'))).toBe(false);
    // prompt window
    const win = await recentWindow(sql, SCOPE, { maxTurns: 10 });
    expect(win.some((m) => m.text.includes('abc123'))).toBe(false);
    // agent view
    const { rows } = await runReadOnly(sql, `select * from bw_v_chat where scope = '${SCOPE}'`);
    expect((rows as Array<{ text: string }>).some((m) => m.text.includes('abc123'))).toBe(false);
    // the secret text itself is scrubbed from the row, not just filtered
    const raw = (await sql`select text from chat_messages where seq = ${secret.seq}`) as Array<{ text: string }>;
    expect(raw[0]!.text).not.toContain('abc123');
  });

  it('404s for a seq outside the scope (no cross-scope redaction)', async () => {
    const app = createRestApi(sql, {});
    const other = await recordTurn(sql, { scope: 'central', role: 'user', text: `${MARK} central행` });
    const res = await del(app, `/api/chat/${encodeURIComponent(SCOPE)}/${other.seq}/redact`);
    expect(res.status).toBe(404);
    await sql`delete from chat_messages where seq = ${other.seq}`;
  });
});
