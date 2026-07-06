import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { SQL } from 'bun';
import { ensureSchema } from '../../infra/schema';
import { ensureTriageReadModel } from './views.sql';
import { runReadOnly } from './read-only-query';

const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const PID = `triage-spec-${Date.now()}`;

beforeAll(async () => {
  await ensureSchema(sql);
  await ensureTriageReadModel(sql);
  await sql`insert into projects (id, name, status) values (${PID}, ${PID}, 'active')`;
});

afterAll(async () => {
  await sql`delete from projects where id = ${PID}`;
  await sql.end();
});

describe('runReadOnly (role + read-only enforcement)', () => {
  it('reads the curated view', async () => {
    const { rows } = await runReadOnly(sql, `select id, status from bw_v_projects where id = '${PID}'`);
    expect(rows).toHaveLength(1);
    expect((rows[0] as { id: string }).id).toBe(PID);
  });

  it('cannot read a base table (role lacks the grant)', async () => {
    await expect(runReadOnly(sql, `select * from projects where id = '${PID}'`)).rejects.toThrow();
  });

  it('rejects a write via the static guard', async () => {
    await expect(runReadOnly(sql, `delete from projects where id = '${PID}'`)).rejects.toThrow();
    // confirm nothing was deleted
    const { rows } = await runReadOnly(sql, `select id from bw_v_projects where id = '${PID}'`);
    expect(rows).toHaveLength(1);
  });

  it('caps rows', async () => {
    const { rows, truncated } = await runReadOnly(sql, `select generate_series(1, 5000) as n`);
    expect(rows.length).toBeLessThanOrEqual(200);
    expect(truncated).toBe(true);
  });
});
