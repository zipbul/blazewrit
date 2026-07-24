import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { SQL } from 'bun';
import { createRestApi } from './rest';
import { ensureSchema } from '../infra/schema';

/**
 * 단일 기록자 통합 Phase 3 (job-graph.md P4/P5): PATCH /api/repos/:id/autonomy — the P5 toggle UI's
 * backend. Flips `repos.autonomy`, which graph/wake-consumer.ts reads fresh on every wake (per
 * repo) — see wake-consumer.spec.ts for the consumer-side "takes effect on the very next wake, no
 * restart" contract this route's write is the other half of.
 */
const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const PREFIX = `repos-autonomy-${process.pid}-${Date.now()}`;
let n = 0;
const id = (label: string) => `${PREFIX}-${label}-${n++}`;

function patch(app: ReturnType<typeof createRestApi>, path: string, body: unknown): Promise<Response> {
  return app.handle(
    new Request(`http://localhost${path}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

async function makeRepo(autonomy = false): Promise<string> {
  const productId = id('product');
  const repoId = id('repo');
  await sql`insert into products (id, name) values (${productId}, ${productId})`;
  await sql`insert into repos (id, product_id, name, cwd, autonomy) values (${repoId}, ${productId}, ${repoId}, '/tmp', ${autonomy})`;
  return repoId;
}

async function autonomyOf(repoId: string): Promise<boolean | undefined> {
  const rows = (await sql`select autonomy from repos where id = ${repoId}`) as Array<{ autonomy: boolean }>;
  return rows[0]?.autonomy;
}

beforeAll(async () => {
  await ensureSchema(sql);
});

afterAll(async () => {
  await sql`delete from repos where id like ${PREFIX + '%'}`;
  await sql`delete from products where id like ${PREFIX + '%'}`;
  await sql.end();
});

describe('PATCH /api/repos/:id/autonomy', () => {
  it('flips a repo from the default false to true', async () => {
    const app = createRestApi(sql, {});
    const repoId = await makeRepo(false);

    const res = await patch(app, `/api/repos/${repoId}/autonomy`, { enabled: true });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: repoId, autonomy: true });
    expect(await autonomyOf(repoId)).toBe(true);
  });

  it('flips it back off again', async () => {
    const app = createRestApi(sql, {});
    const repoId = await makeRepo(true);

    const res = await patch(app, `/api/repos/${repoId}/autonomy`, { enabled: false });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: repoId, autonomy: false });
    expect(await autonomyOf(repoId)).toBe(false);
  });

  it('setting the SAME value again is an idempotent no-op', async () => {
    const app = createRestApi(sql, {});
    const repoId = await makeRepo(true);

    const res = await patch(app, `/api/repos/${repoId}/autonomy`, { enabled: true });

    expect(res.status).toBe(200);
    expect(await autonomyOf(repoId)).toBe(true);
  });

  it('rejects a non-boolean enabled with 400, and does not touch the row', async () => {
    const app = createRestApi(sql, {});
    const repoId = await makeRepo(false);

    const res = await patch(app, `/api/repos/${repoId}/autonomy`, { enabled: 'yes' });

    expect(res.status).toBe(400);
    expect(await autonomyOf(repoId)).toBe(false); // unchanged
  });

  it('rejects a missing enabled field with 400', async () => {
    const app = createRestApi(sql, {});
    const repoId = await makeRepo(false);

    const res = await patch(app, `/api/repos/${repoId}/autonomy`, {});

    expect(res.status).toBe(400);
  });

  it('404s for a repo id that does not exist', async () => {
    const app = createRestApi(sql, {});

    const res = await patch(app, `/api/repos/${id('missing')}/autonomy`, { enabled: true });

    expect(res.status).toBe(404);
  });
});
