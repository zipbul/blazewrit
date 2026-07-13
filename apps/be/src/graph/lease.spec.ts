import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { ensureSchema } from '../infra/schema';
import { renewLease, withLeaseHeartbeat } from './lease';
import type { OrchestratorStore } from '../orchestrator/types';

// Integration test: exercises lease renewal against a live Postgres (harness/job-graph.md P2 spec A2).
const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const PREFIX = `lease-${process.pid}-${Date.now()}`;
let n = 0;
const id = (label: string) => `${PREFIX}-${label}-${n++}`;

async function makeChain() {
  const productId = id('product');
  const repoId = id('repo');
  const taskId = id('task');
  await sql`insert into products (id, name) values (${productId}, ${productId})`;
  await sql`insert into repos (id, product_id, name, cwd) values (${repoId}, ${productId}, ${repoId}, '/tmp')`;
  await sql`insert into tasks (id, title, status) values (${taskId}, ${taskId}, 'open')`;
  return { taskId, repoId };
}

async function seedJob(taskId: string, repoId: string, status: string, leaseExpiresAt: Date | null): Promise<string> {
  const jobId = id('job');
  await sql`insert into jobs (id, task_id, repo_id, title, status, lease_expires_at) values (${jobId}, ${taskId}, ${repoId}, 'x', ${status}, ${leaseExpiresAt})`;
  return jobId;
}

async function jobLeaseExpiresAt(jobId: string): Promise<Date | null> {
  const rows = (await sql`select lease_expires_at from jobs where id = ${jobId}`) as Array<{ lease_expires_at: Date | null }>;
  return rows[0]!.lease_expires_at;
}

beforeAll(async () => {
  await ensureSchema(sql);
});

afterAll(async () => {
  await sql`delete from jobs where id like ${PREFIX + '%'}`;
  await sql`delete from tasks where id like ${PREFIX + '%'}`;
  await sql`delete from repos where id like ${PREFIX + '%'}`;
  await sql`delete from products where id like ${PREFIX + '%'}`;
  await sql.end();
});

describe('renewLease', () => {
  test('pushes a running job\'s lease_expires_at into the future', async () => {
    const { taskId, repoId } = await makeChain();
    const past = new Date(Date.now() - 60_000);
    const jobId = await seedJob(taskId, repoId, 'running', past);

    await renewLease(sql, jobId, 30_000);

    const leaseExpiresAt = await jobLeaseExpiresAt(jobId);
    expect(leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  test('does not renew a lease for a job that is not running (already terminal/reverted)', async () => {
    const { taskId, repoId } = await makeChain();
    const jobId = await seedJob(taskId, repoId, 'pending', null);

    await renewLease(sql, jobId, 30_000);

    expect(await jobLeaseExpiresAt(jobId)).toBeNull();
  });
});

describe('withLeaseHeartbeat (harness/job-graph.md P2 spec A2 — heartbeat = step transition)', () => {
  const fakeStore: OrchestratorStore = {
    createFlow: async () => {},
    setCurrentStep: async () => {},
    setAssembleSession: async () => {},
    setStatus: async () => {},
    startStepRun: async () => {},
    finishStepRun: async () => {},
    getFlow: async () => undefined,
    stepRuns: async () => [],
  };

  test('a step transition (setCurrentStep) renews the job\'s lease', async () => {
    const { taskId, repoId } = await makeChain();
    const past = new Date(Date.now() - 60_000);
    const jobId = await seedJob(taskId, repoId, 'running', past);
    const wrapped = withLeaseHeartbeat(fakeStore, sql, jobId, 30_000);

    await wrapped.setCurrentStep('some-flow-id', 'implement');

    const leaseExpiresAt = await jobLeaseExpiresAt(jobId);
    expect(leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  test('still delegates to the underlying store\'s setCurrentStep', async () => {
    const { taskId, repoId } = await makeChain();
    const jobId = await seedJob(taskId, repoId, 'running', null);
    let delegatedTo: { flowId: string; step: string } | undefined;
    const spyStore: OrchestratorStore = {
      ...fakeStore,
      setCurrentStep: async (flowId, step) => {
        delegatedTo = { flowId, step };
      },
    };
    const wrapped = withLeaseHeartbeat(spyStore, sql, jobId, 30_000);

    await wrapped.setCurrentStep('flow-x', 'verify');

    expect(delegatedTo).toEqual({ flowId: 'flow-x', step: 'verify' });
  });
});
