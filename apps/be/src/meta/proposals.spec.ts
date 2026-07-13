import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { SQL } from 'bun';
import { ensureSchema } from '../infra/schema';
import { createProposals } from './proposals';

/**
 * Regression guard for the jsonb double-encoding bug (see graph/wake.ts's raiseWake): bun's SQL
 * driver stores a JSON.stringify'd string param into a jsonb column as a jsonb STRING SCALAR, not
 * a genuine object, so `meta->>'key'` reads as NULL against it. Each test here queries `meta` (or
 * `options`) directly via SQL rather than through the app's own defensive parseJson() reader —
 * if any of the three insert sites regresses back to JSON.stringify, these fail.
 */
const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const MARK = `proposals-${process.pid}-${Date.now()}`;
let n = 0;
const newId = () => `${MARK}-${n++}`;
const noopPublish = () => {};

beforeAll(async () => {
  await ensureSchema(sql);
});

afterAll(async () => {
  await sql`delete from decisions where id like ${MARK + '%'}`;
  await sql`delete from chat_messages where scope like ${MARK + '%'}`;
  await sql`delete from relationships where from_project like ${MARK + '%'}`;
  await sql`delete from projects where id like ${MARK + '%'}`;
  await sql.end();
});

describe('createProposals — decisions.meta/options are stored as genuine jsonb (not double-encoded)', () => {
  it('proposeNewProject: meta->>\'projectId\' is directly queryable in SQL', async () => {
    const { proposeNewProject } = createProposals({ sql, newId, publish: noopPublish });
    const projectId = `${MARK}-proj`;

    await proposeNewProject(projectId, `${MARK} 요청`);

    const rows = (await sql`
      select id from decisions where request_type = 'project_registration' and meta->>'projectId' = ${projectId}
    `) as unknown[];
    expect(rows.length).toBe(1);
  });

  it('proposeConnection: meta->>\'relationshipId\' is directly queryable in SQL', async () => {
    const { proposeConnection } = createProposals({ sql, newId, publish: noopPublish });
    const siblingId = `${MARK}-sibling`;
    const newProjectId = `${MARK}-newproj`;
    await sql`insert into projects (id, name, status) values (${siblingId}, ${siblingId}, 'active')`;
    await sql`insert into projects (id, name, status) values (${newProjectId}, ${newProjectId}, 'active')`;

    await proposeConnection(newProjectId);

    const rows = (await sql`
      select meta->>'relationshipId' as rel_id from decisions where request_type = 'connection' and meta->>'from' = ${newProjectId}
    `) as Array<{ rel_id: string | null }>;
    expect(rows.length).toBe(1);
    expect(rows[0]!.rel_id).not.toBeNull();
  });

  it('openClarification: meta->>\'scope\' and the stored options array are directly queryable in SQL', async () => {
    const { openClarification } = createProposals({ sql, newId, publish: noopPublish });
    const scope = `${MARK}-scope`;

    const decId = await openClarification(`${MARK} 원 요청`, `${MARK} 질문?`, ['옵션A', '옵션B'], scope);

    const rows = (await sql`select options, meta->>'scope' as scope from decisions where id = ${decId}`) as Array<{
      options: unknown;
      scope: string | null;
    }>;
    expect(rows[0]!.scope).toBe(scope);
    const opts = typeof rows[0]!.options === 'string' ? JSON.parse(rows[0]!.options as string) : rows[0]!.options;
    expect(opts).toEqual(['옵션A', '옵션B']);
  });
});
