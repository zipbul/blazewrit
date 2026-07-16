import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';
import { SQL } from 'bun';
import { createRestApi } from './rest';
import { ensureSchema } from '../infra/schema';
import { reconcileTask, type ReconcileJob } from '../graph/reconcile';

/**
 * P3 migration 10 / rule 8 (harness/job-graph.md), spec D: POST /api/gates/:id/fire — the one
 * write path that flips an external_gates row pending -> fired (webhook/human/cron all land
 * here). Gate CREATION is out of scope this round (negotiation-driven creation is P3 round 2,
 * spec B5) — every gate here is a direct test fixture insert. reconcile.ts's own read of an
 * external target's outcome (fired -> satisfied, else pending; graph/reconcile.ts's
 * liveMemberOutcome) already existed before this round and is NOT changed here — these tests only
 * verify that existing read against a real fired/pending gate via the new fire endpoint.
 */
const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const PREFIX = `gatefire-${process.pid}-${Date.now()}`;
let n = 0;
const id = (label: string) => `${PREFIX}-${label}-${n++}`;

const post = (app: ReturnType<typeof createRestApi>, path: string) => app.handle(new Request(`http://localhost${path}`, { method: 'POST' }));

/** Builds a product -> repo -> open task chain, same minimum every graph fixture needs. */
async function makeChain() {
  const productId = id('product');
  const repoId = id('repo');
  const taskId = id('task');
  await sql`insert into products (id, name) values (${productId}, ${productId})`;
  await sql`insert into repos (id, product_id, name, cwd) values (${repoId}, ${productId}, ${repoId}, '/tmp')`;
  await sql`insert into tasks (id, title, status) values (${taskId}, ${taskId}, 'open')`;
  return { productId, repoId, taskId };
}

async function seedGate(taskId: string, status: 'pending' | 'fired' = 'pending'): Promise<string> {
  const gateId = id('gate');
  await sql`insert into external_gates (id, task_id, kind, status) values (${gateId}, ${taskId}, 'manual', ${status})`;
  return gateId;
}

async function seedJob(taskId: string, repoId: string, status = 'pending', title = 'waiter'): Promise<string> {
  const jobId = id('job');
  await sql`insert into jobs (id, task_id, repo_id, title, status) values (${jobId}, ${taskId}, ${repoId}, ${title}, ${status})`;
  return jobId;
}

async function gateStatus(gateId: string): Promise<string | undefined> {
  const rows = (await sql`select status from external_gates where id = ${gateId}`) as Array<{ status: string }>;
  return rows[0]?.status;
}

async function jobStatus(jobId: string): Promise<string> {
  const rows = (await sql`select status from jobs where id = ${jobId}`) as Array<{ status: string }>;
  return rows[0]!.status;
}

beforeAll(async () => {
  await ensureSchema(sql);
});

afterAll(async () => {
  // FK-reverse order.
  await sql`delete from dep_members where dep_id like ${PREFIX + '%'}`;
  await sql`delete from deps where id like ${PREFIX + '%'}`;
  await sql`delete from external_gates where id like ${PREFIX + '%'}`;
  await sql`delete from jobs where id like ${PREFIX + '%'}`;
  await sql`delete from tasks where id like ${PREFIX + '%'}`;
  await sql`delete from repos where id like ${PREFIX + '%'}`;
  await sql`delete from products where id like ${PREFIX + '%'}`;
  await sql.end();
});

describe('POST /api/gates/:id/fire', () => {
  it('D2: fires a pending gate, and re-firing it is an idempotent no-op', async () => {
    const app = createRestApi(sql, {});
    const { taskId } = await makeChain();
    const gateId = await seedGate(taskId, 'pending');

    const res1 = await post(app, `/api/gates/${gateId}/fire`);
    expect(res1.status).toBe(200);
    expect(await gateStatus(gateId)).toBe('fired');

    const res2 = await post(app, `/api/gates/${gateId}/fire`); // already fired
    expect(res2.status).toBe(200); // no-op, not an error
    expect(await gateStatus(gateId)).toBe('fired');
  });

  it('D5: firing a gate that does not exist 404s', async () => {
    const app = createRestApi(sql, {});
    const res = await post(app, `/api/gates/${id('missing')}/fire`);
    expect(res.status).toBe(404);
  });

  it('D6: firing writes only the gate row, never the waiting job\'s status', async () => {
    const app = createRestApi(sql, {});
    const { repoId, taskId } = await makeChain();
    const waiterJobId = await seedJob(taskId, repoId, 'pending');
    const gateId = await seedGate(taskId, 'pending');
    const depId = id('dep');
    await sql`insert into deps (id, waiter_job) values (${depId}, ${waiterJobId})`;
    await sql`insert into dep_members (dep_id, target_type, target_id) values (${depId}, 'external', ${gateId})`;

    await post(app, `/api/gates/${gateId}/fire`);

    expect(await jobStatus(waiterJobId)).toBe('pending'); // unchanged — only reconcile derives readiness
  });
});

describe('external gate -> reconcile wiring', () => {
  it('D4: a pending gate leaves the waiting job blocked after a reconcile pass', async () => {
    const { repoId, taskId } = await makeChain();
    const waiterJobId = await seedJob(taskId, repoId, 'pending');
    const gateId = await seedGate(taskId, 'pending');
    const depId = id('dep');
    await sql`insert into deps (id, waiter_job) values (${depId}, ${waiterJobId})`;
    await sql`insert into dep_members (dep_id, target_type, target_id) values (${depId}, 'external', ${gateId})`;

    const dispatch = mock(async (_job: ReconcileJob) => {});
    const result = await reconcileTask(sql, taskId, dispatch);

    expect(result.claimed).not.toContain(waiterJobId);
    expect(dispatch).not.toHaveBeenCalled();
    expect(await jobStatus(waiterJobId)).toBe('blocked');
  });

  it('D3: firing the gate releases the dep and reconcile dispatches the waiting job', async () => {
    const app = createRestApi(sql, {});
    const { repoId, taskId } = await makeChain();
    const waiterJobId = await seedJob(taskId, repoId, 'pending');
    const gateId = await seedGate(taskId, 'pending');
    const depId = id('dep');
    await sql`insert into deps (id, waiter_job) values (${depId}, ${waiterJobId})`;
    await sql`insert into dep_members (dep_id, target_type, target_id) values (${depId}, 'external', ${gateId})`;

    const fireRes = await post(app, `/api/gates/${gateId}/fire`);
    expect(fireRes.status).toBe(200);

    const dispatch = mock(async (_job: ReconcileJob) => {});
    const result = await reconcileTask(sql, taskId, dispatch);

    expect(result.claimed).toEqual([waiterJobId]);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ id: waiterJobId, repoId, taskId, title: 'waiter' });
    expect(await jobStatus(waiterJobId)).toBe('running');
  });
});
