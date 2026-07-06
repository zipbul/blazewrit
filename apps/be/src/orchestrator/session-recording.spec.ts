import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { SQL } from 'bun';
import { ensureSchema } from '../infra/schema';
import { PgOrchestratorStore } from './infra/pg-store';

/**
 * Session recording contract: every agent session is re-askable for debugging. A step_run may
 * carry the SDK session_id of the agent call that produced it; a flow may carry the session_id
 * of its assemble call. Nullable — legacy/paced runs record none.
 */
const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const MARK = `sess-${Date.now()}`;

beforeAll(async () => {
  await ensureSchema(sql);
  await sql`insert into work_items (id, project_id, type, state, title) values (${MARK}, ${MARK}, 'task', 'in_flow', ${MARK})`;
});

afterAll(async () => {
  await sql`delete from step_runs where flow_id = ${MARK}`;
  await sql`delete from flows where id = ${MARK}`;
  await sql`delete from work_items where id = ${MARK}`;
  await sql.end();
});

describe('session recording', () => {
  it('flows.assemble_session_id stores the assemble decision session', async () => {
    const store = new PgOrchestratorStore(sql);
    await store.createFlow({ id: MARK, flowType: 'feature', status: 'active', currentStep: 'ground', workItemId: MARK, assembleSessionId: 'asm-1' });
    const rows = (await sql`select assemble_session_id from flows where id = ${MARK}`) as Array<{ assemble_session_id: string }>;
    expect(rows[0]!.assemble_session_id).toBe('asm-1');
  });

  it('step_runs.session_id stores the agent session that produced the step', async () => {
    const store = new PgOrchestratorStore(sql);
    await store.startStepRun({ id: `${MARK}-r1`, flowId: MARK, step: 'implement', role: 'producer', attempt: 1, sessionId: 'step-sess-9' });
    const rows = (await sql`select session_id from step_runs where id = ${MARK + '-r1'}`) as Array<{ session_id: string }>;
    expect(rows[0]!.session_id).toBe('step-sess-9');
  });

  it('records nothing when no session id is given (legacy/paced)', async () => {
    const store = new PgOrchestratorStore(sql);
    await store.startStepRun({ id: `${MARK}-r2`, flowId: MARK, step: 'ground', role: 'producer', attempt: 1 });
    const rows = (await sql`select session_id from step_runs where id = ${MARK + '-r2'}`) as Array<{ session_id: string | null }>;
    expect(rows[0]!.session_id).toBeNull();
  });
});
