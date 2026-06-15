import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
import { SQL } from 'bun';
import { PgOrchestratorStore } from './pg-store';

// Integration test: runs only when BW_PG_URL points at a live Postgres with the blazewrit schema.
const url = process.env.BW_PG_URL;
const suite = url ? describe : describe.skip;

suite('PgOrchestratorStore (live Postgres)', () => {
  let sql: SQL;
  let store: PgOrchestratorStore;
  let n = 0;
  const flowId = () => `test-${process.pid}-${n++}`;

  beforeAll(() => {
    sql = new SQL(url!);
    store = new PgOrchestratorStore(sql);
  });

  afterAll(async () => {
    await sql`delete from step_runs where flow_id like ${'test-' + process.pid + '-%'}`;
    await sql`delete from flows where id like ${'test-' + process.pid + '-%'}`;
    await sql.end();
  });

  test('creates a flow and reads it back', async () => {
    const id = flowId();
    await store.createFlow({ id, flowType: 'feature', status: 'active', currentStep: 'ground' });
    expect(await store.getFlow(id)).toMatchObject({ id, flowType: 'feature', status: 'active', currentStep: 'ground' });
  });

  test('advances current step and status', async () => {
    const id = flowId();
    await store.createFlow({ id, flowType: 'feature', status: 'active', currentStep: 'ground' });
    await store.setCurrentStep(id, 'implement');
    await store.setStatus(id, 'completed');
    const flow = await store.getFlow(id);
    expect(flow).toMatchObject({ currentStep: 'implement', status: 'completed' });
  });

  test('starts + finishes step runs and reads them in order', async () => {
    const id = flowId();
    await store.createFlow({ id, flowType: 'feature', status: 'active', currentStep: 'ground' });
    const p = `${id}-p`;
    const r = `${id}-r`;
    await store.startStepRun({ id: p, flowId: id, step: 'ground', role: 'producer', attempt: 1 });
    await store.finishStepRun(p, 'done');
    await store.startStepRun({ id: r, flowId: id, step: 'ground', role: 'reviewer', attempt: 1 });
    await store.finishStepRun(r, 'done', 'pass');
    const runs = await store.stepRuns(id);
    expect(runs.map((x) => `${x.role}:${x.status}:${x.verdict ?? '-'}`)).toEqual([
      'producer:done:-',
      'reviewer:done:pass',
    ]);
  });

  test('returns undefined for an unknown flow', async () => {
    expect(await store.getFlow('nope-' + flowId())).toBeUndefined();
  });
});
