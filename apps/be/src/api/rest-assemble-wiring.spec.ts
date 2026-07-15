import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { SQL } from 'bun';
import { createRestApi } from './rest';
import { ensureSchema } from '../infra/schema';

/**
 * v1 wiring contract: a dispatched task's flow is now AGENT-ASSEMBLED (via assembleFlow), and the
 * assemble session id is persisted on the flow (re-askable for debugging). With no assembler
 * injected it degrades to the grammar skeleton — never rejects the task.
 */
const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const MARK = `asmwire-${Date.now()}`;
const PROJECT = `${MARK}-proj`;

const a2aSend = (app: ReturnType<typeof createRestApi>, text: string, metadata?: Record<string, unknown>) =>
  app.handle(new Request(`http://localhost/agents/${encodeURIComponent(PROJECT)}/a2a`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'message/send',
      params: { message: { kind: 'message', messageId: 'm', role: 'user', parts: [{ kind: 'text', text }], ...(metadata ? { metadata } : {}) } } }),
  }));

async function flowFor(title: string) {
  for (let i = 0; i < 40; i++) {
    const rows = (await sql`
      select f.id, f.flow_type, f.assemble_session_id from flows f join work_items w on w.id = f.work_item_id
      where w.title = ${title} order by f.created_at desc limit 1
    `) as Array<{ id: string; flow_type: string; assemble_session_id: string | null }>;
    if (rows[0]) return rows[0];
    await new Promise((r) => setTimeout(r, 50));
  }
  return undefined;
}

beforeAll(async () => {
  await ensureSchema(sql);
  await sql`insert into projects (id, name, status) values (${PROJECT}, ${PROJECT}, 'active') on conflict (id) do nothing`;
});

afterAll(async () => {
  // Both dispatches below use the default PacedStepExecutor (~2.4s per producer+reviewer step)
  // on a 'feature' workflow that includes a 'decide' HITL step nothing here ever answers — the
  // flow suspends there rather than completing, but only after 3 real steps' worth of delay. The
  // it()s only poll for the flows row (+ assemble_session_id) to appear, not for that settling, so
  // a still-active flow's late step_runs insert can land between this afterAll's two deletes and
  // violate the flows FK (an intermittent failure observed here and in rest-intent-custody.spec.ts).
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const active = (await sql`
      select 1 from flows f join work_items w on w.id = f.work_item_id where w.project_id = ${PROJECT} and f.status = 'active'
    `) as unknown[];
    if (active.length === 0) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  await sql`delete from step_runs where flow_id in (select f.id from flows f join work_items w on w.id = f.work_item_id where w.project_id = ${PROJECT})`;
  await sql`delete from flows where work_item_id in (select id from work_items where project_id = ${PROJECT})`;
  await sql`delete from work_items where project_id = ${PROJECT}`;
  await sql`delete from projects where id = ${PROJECT}`;
  await sql.end();
}, 20_000);

describe('v1 agent-assembled dispatch', () => {
  it('runs an assembled flow and completes (degrades to skeleton with no assembler)', async () => {
    const title = `${MARK} 로그인 추가`;
    const res = await a2aSend(app(), title, { flowType: 'feature' });
    expect(res.status).toBe(200);
    const flow = await flowFor(title);
    expect(flow).toBeDefined();
    expect(flow!.flow_type).toBe('feature');
    expect(flow!.assemble_session_id).toBeNull(); // degraded → no session, recorded truthfully
  });

  it('persists the assemble session id when an assembler is injected (re-askable)', async () => {
    const title = `${MARK} 검색 필터 추가`;
    const res = await a2aSend(appWithAssembler(), title, { flowType: 'feature' });
    expect(res.status).toBe(200);
    // Two-phase records the session AFTER ground composes the rest, so poll until it lands.
    let sess: string | null = null;
    for (let i = 0; i < 60; i++) {
      const flow = await flowFor(title);
      if (flow?.assemble_session_id) { sess = flow.assemble_session_id; break; }
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(sess).toBe('wire-sess-1');
  });
});

function app() {
  return createRestApi(sql, {}); // no assembler → assembleFlow degrades to the grammar skeleton
}

// An assembler that picks a minimal middle and stamps a known session id we can assert on.
function appWithAssembler() {
  const queryFn = async function* () {
    yield {
      type: 'result', subtype: 'success',
      structured_output: { steps: [{ name: 'implement', why: '변경' }] },
      session_id: 'wire-sess-1',
    } as never;
  };
  return createRestApi(sql, { assembler: { queryFn } });
}
