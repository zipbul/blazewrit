import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { ensureSchema } from '../infra/schema';
import { raiseWake } from './wake';

// Integration test: exercises wake-record raising against a live Postgres (harness/job-graph.md
// P2 round 2 spec E: raiseWake shape + dedup).
const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const PREFIX = `wake-${process.pid}-${Date.now()}`;
let n = 0;
const id = (label: string) => `${PREFIX}-${label}-${n++}`;
const newId = () => id('wake');

async function countOpenWakes(kind: string, taskId: string): Promise<number> {
  const rows = (await sql`
    select id from decisions
    where request_type = 'agent_wake' and status = 'open' and meta->>'kind' = ${kind} and meta->>'taskId' = ${taskId}
  `) as unknown[];
  return rows.length;
}

beforeAll(async () => {
  await ensureSchema(sql);
});

afterAll(async () => {
  // Every wake this round always carries a taskId, so this alone is enough to find them all.
  await sql`delete from decisions where request_type = 'agent_wake' and meta->>'taskId' like ${PREFIX + '%'}`;
  await sql.end();
});

describe('raiseWake (harness/job-graph.md P2 round 2 spec E)', () => {
  test('E1: inserts an open agent_wake decision with the expected shape', async () => {
    const taskId = id('task');
    const jobId = id('job');
    const result = await raiseWake(sql, { kind: 'stalled', taskId, jobId, reason: '테스트 정체 사유' }, newId);

    expect(result.raised).toBe(true);
    expect(result.id).toBeDefined();
    const rows = (await sql`select * from decisions where id = ${result.id}`) as Array<Record<string, unknown>>;
    expect(rows[0]!.status).toBe('open');
    expect(rows[0]!.request_type).toBe('agent_wake');
    expect(rows[0]!.question).toBe('테스트 정체 사유');
    expect(rows[0]!.flow_id).toBeNull();
    const meta = typeof rows[0]!.meta === 'string' ? JSON.parse(rows[0]!.meta as string) : rows[0]!.meta;
    expect(meta).toEqual({ kind: 'stalled', taskId, jobId });
  });

  test('E2: a second call for the same (kind, target) is suppressed — only one open row exists', async () => {
    const taskId = id('task');
    const jobId = id('job');

    const first = await raiseWake(sql, { kind: 'stalled', taskId, jobId, reason: '첫 번째' }, newId);
    const second = await raiseWake(sql, { kind: 'stalled', taskId, jobId, reason: '두 번째(억제되어야 함)' }, newId);

    expect(first.raised).toBe(true);
    expect(second.raised).toBe(false);
    expect(second.id).toBeUndefined();
    expect(await countOpenWakes('stalled', taskId)).toBe(1);
  });

  test('E2: a different kind for the same target is NOT suppressed', async () => {
    const taskId = id('task');
    const jobId = id('job');

    await raiseWake(sql, { kind: 'stalled', taskId, jobId, reason: 'stalled' }, newId);
    const other = await raiseWake(sql, { kind: 'lease_expired', taskId, jobId, reason: 'lease_expired' }, newId);

    expect(other.raised).toBe(true);
    expect(await countOpenWakes('stalled', taskId)).toBe(1);
    expect(await countOpenWakes('lease_expired', taskId)).toBe(1);
  });

  test('E2: a task-scoped wake and a job-scoped wake for the same task are different targets', async () => {
    const taskId = id('task');
    const jobId = id('job');

    // unresolvable_task targets the task itself (no jobId); stalled targets one of its jobs.
    const taskWake = await raiseWake(sql, { kind: 'unresolvable_task', taskId, reason: '태스크 미해소' }, newId);
    const jobWake = await raiseWake(sql, { kind: 'stalled', taskId, jobId, reason: '잡 정체' }, newId);

    expect(taskWake.raised).toBe(true);
    expect(jobWake.raised).toBe(true);
  });
});
