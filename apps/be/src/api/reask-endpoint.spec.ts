import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { SQL } from 'bun';
import { createRestApi } from './rest';
import { ensureSchema } from '../infra/schema';

/**
 * Debugging path over HTTP: POST a follow-up to a flow's recorded assemble session and get the
 * agent's answer. Resolves the flow's assemble_session_id and re-asks it (reAskSession). A flow
 * with no recorded session (curated/degraded) is a 409 — nothing to re-ask.
 */
const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const MARK = `reask-${Date.now()}`;

const ask = (app: ReturnType<typeof createRestApi>, flowId: string, question: string) =>
  app.handle(new Request(`http://localhost/api/flows/${flowId}/assemble/ask`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question }),
  }));

function appWithReask() {
  const queryFn = async function* ({ options }: { options?: { resume?: string } }) {
    yield { type: 'result', subtype: 'success',
      result: `resume=${options?.resume} 이므로 test-first로 골랐다.`, session_id: options?.resume } as never;
  };
  return createRestApi(sql, { assembler: { queryFn: queryFn as never } });
}

beforeAll(async () => {
  await ensureSchema(sql);
  await sql`insert into flows (id, work_item_id, flow_type, status, current_step, assemble_session_id)
    values (${MARK}, ${MARK}, 'feature', 'active', 'ground', ${'sess-42'})`;
  await sql`insert into flows (id, work_item_id, flow_type, status, current_step, assemble_session_id)
    values (${MARK + '-none'}, ${MARK}, 'feature', 'active', 'ground', ${null})`;
});

afterAll(async () => {
  await sql`delete from flows where work_item_id = ${MARK}`;
  await sql.end();
});

describe('POST /api/flows/:id/assemble/ask', () => {
  it('re-asks the recorded session and returns the answer', async () => {
    const res = await ask(appWithReask(), MARK, '왜 test를 골랐냐?');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { answer: string; sessionId: string };
    expect(body.answer).toContain('resume=sess-42'); // proves the stored session was resumed
  });

  it('409 when the flow has no recorded assemble session (nothing to re-ask)', async () => {
    const res = await ask(appWithReask(), `${MARK}-none`, '왜?');
    expect(res.status).toBe(409);
  });

  it('404 for an unknown flow', async () => {
    const res = await ask(appWithReask(), 'nope', '왜?');
    expect(res.status).toBe(404);
  });
});
