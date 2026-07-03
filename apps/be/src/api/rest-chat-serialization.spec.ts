import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { SQL } from 'bun';
import { createRestApi } from './rest';
import { ensureSchema } from '../infra/schema';
import type { TriageAgent, ChatArgs, TurnResult } from '../triage/triage-agent';

/**
 * Seam contract: per-scope serialization must hold THROUGH the /api/triage route — two rapid
 * concurrent sends to one scope may never interleave as user1,user2,agent1,agent2. This spec
 * exists so moving recordTurn outside the queue (a refactor that passes every unit test)
 * still fails here.
 */
const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const MARK = `serial-${Date.now()}`;
const SCOPE = `${MARK}-wi`;

/** Agent whose first call hangs until released — lets us force overlap at the route level. */
function slowThenFast(): TriageAgent & { release: () => void } {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let first = true;
  return {
    release: () => release(),
    chat: async (args: ChatArgs): Promise<TurnResult> => {
      if (first) {
        first = false;
        await gate; // 1st turn parks here while the 2nd arrives
      }
      return { reply: `답(${args.request})`, intent: null, feedback: null, view: null };
    },
  } as unknown as TriageAgent & { release: () => void };
}

const post = (app: ReturnType<typeof createRestApi>, body: unknown) =>
  app.handle(new Request('http://localhost/api/triage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));

beforeAll(async () => {
  await ensureSchema(sql);
  await sql`insert into work_items (id, project_id, type, state, title) values (${SCOPE}, ${MARK}, 'task', 'in_flow', ${MARK})`;
});

afterAll(async () => {
  await sql`delete from chat_messages where scope = ${SCOPE}`;
  await sql`delete from work_items where id = ${SCOPE}`;
  await sql.end();
});

describe('per-scope serialization through the route', () => {
  it('two rapid sends land as user1,agent1,user2,agent2 — never interleaved', async () => {
    const agent = slowThenFast();
    const app = createRestApi(sql, { triage: agent });

    const p1 = post(app, { request: `${MARK} 첫째`, scope: SCOPE });
    // give p1 time to enter the queue and park inside the agent
    await new Promise((r) => setTimeout(r, 50));
    const p2 = post(app, { request: `${MARK} 둘째`, scope: SCOPE });
    await new Promise((r) => setTimeout(r, 50));
    agent.release();
    await Promise.all([p1, p2]);

    const rows = (await sql`select role, text from chat_messages where scope = ${SCOPE} order by seq`) as Array<{ role: string; text: string }>;
    expect(rows.map((r) => `${r.role}:${r.text}`)).toEqual([
      `user:${MARK} 첫째`,
      `agent:답(${MARK} 첫째)`,
      `user:${MARK} 둘째`,
      `agent:답(${MARK} 둘째)`,
    ]);
  });
});
