import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { ensureSchema } from './schema';

// Integration test: exercises the projects → repos/products backfill (harness/job-graph.md
// migration step 2) against a live Postgres. Read-verification only — the legacy write
// path (projects) is exercised via direct insert here, not via any application code path.
const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const PREFIX = `backfill-${process.pid}-${Date.now()}`;
let n = 0;
const id = (label: string) => `${PREFIX}-${label}-${n++}`;

beforeAll(async () => {
  await ensureSchema(sql);
});

afterAll(async () => {
  // FK-reverse order. 'legacy' is shared state (other suites/boots rely on it) — never delete it.
  await sql`delete from repos where id like ${PREFIX + '%'}`;
  await sql`delete from projects where id like ${PREFIX + '%'}`;
  await sql.end();
});

describe('schema backfill: projects → repos/products (harness/job-graph.md step 2)', () => {
  test('mirrors an existing project into repos on the next ensureSchema run, under the legacy product', async () => {
    const projectId = id('project');
    await sql`insert into projects (id, name, repo_path, status) values (${projectId}, ${projectId}, '/some/path', 'active')`;
    await ensureSchema(sql);
    const rows =
      (await sql`select id, product_id from repos where id = ${projectId}`) as Array<{ id: string; product_id: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.product_id).toBe('legacy');
    const products = (await sql`select id from products where id = 'legacy'`) as Array<{ id: string }>;
    expect(products).toHaveLength(1);
  });

  test('mirrors cwd as "." when the project has no repo_path', async () => {
    const projectId = id('project');
    await sql`insert into projects (id, name, status) values (${projectId}, ${projectId}, 'active')`;
    await ensureSchema(sql);
    const rows = (await sql`select cwd from repos where id = ${projectId}`) as Array<{ cwd: string }>;
    expect(rows[0]!.cwd).toBe('.');
  });

  test('mirrors cwd as the project repo_path when it is set', async () => {
    const projectId = id('project');
    await sql`insert into projects (id, name, repo_path, status) values (${projectId}, ${projectId}, '/custom/cwd', 'active')`;
    await ensureSchema(sql);
    const rows = (await sql`select cwd from repos where id = ${projectId}`) as Array<{ cwd: string }>;
    expect(rows[0]!.cwd).toBe('/custom/cwd');
  });

  test('does not duplicate the repos mirror across repeated ensureSchema runs', async () => {
    const projectId = id('project');
    await sql`insert into projects (id, name, status) values (${projectId}, ${projectId}, 'active')`;
    await ensureSchema(sql);
    await ensureSchema(sql);
    const rows = (await sql`select id from repos where id = ${projectId}`) as Array<{ id: string }>;
    expect(rows).toHaveLength(1);
  });

  test('does not overwrite an already-existing repos row (e.g. a manually set cwd)', async () => {
    const projectId = id('project');
    await sql`insert into projects (id, name, repo_path, status) values (${projectId}, ${projectId}, '/from/project', 'active')`;
    await sql`insert into repos (id, product_id, name, cwd) values (${projectId}, 'legacy', ${projectId}, '/manually/set')`;
    await ensureSchema(sql);
    const rows = (await sql`select cwd from repos where id = ${projectId}`) as Array<{ cwd: string }>;
    expect(rows[0]!.cwd).toBe('/manually/set');
  });

  /**
   * 3자 리뷰 수정 C4 (Grok F14): the repos INSERT is `on conflict (id) do nothing` — a project
   * registered before its repo_path was ever set gets mirrored with cwd='.' on the FIRST boot,
   * and setting projects.repo_path afterward never reaches the mirror again (the insert is a
   * no-op the second time). resolveRepoCwd then keeps running that repo's jobs against '.'
   * (the wrong checkout) forever, even though the intended cwd is now known.
   */
  test('self-heals repos.cwd once projects.repo_path is set AFTER the repo was already mirrored as "."', async () => {
    const projectId = id('project');
    await sql`insert into projects (id, name, status) values (${projectId}, ${projectId}, 'active')`; // no repo_path yet
    await ensureSchema(sql); // first boot: mirrors cwd = '.'
    const firstPass = (await sql`select cwd from repos where id = ${projectId}`) as Array<{ cwd: string }>;
    expect(firstPass[0]!.cwd).toBe('.');

    await sql`update projects set repo_path = '/now/known/cwd' where id = ${projectId}`;
    await ensureSchema(sql); // second boot: self-heal should catch up

    const secondPass = (await sql`select cwd from repos where id = ${projectId}`) as Array<{ cwd: string }>;
    expect(secondPass[0]!.cwd).toBe('/now/known/cwd');
  });

  test('does not touch a manually-set (non-".") cwd even if projects.repo_path later changes', async () => {
    const projectId = id('project');
    await sql`insert into projects (id, name, repo_path, status) values (${projectId}, ${projectId}, '/original', 'active')`;
    await sql`insert into repos (id, product_id, name, cwd) values (${projectId}, 'legacy', ${projectId}, '/manually/set')`;
    await sql`update projects set repo_path = '/different/path' where id = ${projectId}`;
    await ensureSchema(sql);

    const rows = (await sql`select cwd from repos where id = ${projectId}`) as Array<{ cwd: string }>;
    expect(rows[0]!.cwd).toBe('/manually/set'); // self-heal only fires when cwd is still '.'
  });
});
