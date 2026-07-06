import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { SQL } from 'bun';
import { ensureSchema } from '../infra/schema';
import { gatherFacts } from './gather-facts';

/**
 * gatherFacts sources what the DB already knows before assembly, so the agent composes on real
 * signals rather than the flow_type seed alone. DB-derived (no agent call): mutation from the
 * seed, crossProjectDep from a confirmed relationship edge.
 */
const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const MARK = `facts-${Date.now()}`;
const DEP = `${MARK}-dep`;
const SOLO = `${MARK}-solo`;

beforeAll(async () => {
  await ensureSchema(sql);
  await sql`insert into relationships (id, from_project, to_project, type, status)
    values (${MARK}, ${DEP}, 'other', 'depends', 'confirmed')`;
});

afterAll(async () => {
  await sql`delete from relationships where id = ${MARK}`;
  await sql.end();
});

describe('gatherFacts', () => {
  it('flags a confirmed cross-project dependency and mutation from the seed', async () => {
    const f = await gatherFacts(sql, DEP, 'feature', '아바타 업로드');
    expect(f.mutation).toBe(true);
    expect(f.crossProjectDep).toBe(true);
    expect(f.scope).toBe('아바타 업로드');
  });

  it('read-only seeds are non-mutating; no edge → no cross-project dep', async () => {
    const f = await gatherFacts(sql, SOLO, 'audit', '보안 점검');
    expect(f.mutation).toBe(false);
    expect(f.crossProjectDep).toBe(false);
  });
});
