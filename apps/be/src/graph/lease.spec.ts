import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { SQL } from 'bun';
import { ensureSchema } from '../infra/schema';
import { renewLease, withLeaseHeartbeat } from './lease';
import { startGraphController } from './controller';
import type { OrchestratorStore } from '../orchestrator/types';
import type { ReconcileJob } from './reconcile';

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

async function seedJob(taskId: string, repoId: string, status: string, leaseExpiresAt: Date | null, generation = 1): Promise<string> {
  const jobId = id('job');
  await sql`insert into jobs (id, task_id, repo_id, title, status, generation, lease_expires_at) values (${jobId}, ${taskId}, ${repoId}, 'x', ${status}, ${generation}, ${leaseExpiresAt})`;
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
  // The integration test below starts a controller — its own auto-initial tick can still be
  // mid-flight when stop() returns (stop() only clears the FUTURE timer); give it a moment to
  // settle before closing the connection out from under it (same fix as controller.spec.ts).
  await new Promise((r) => setTimeout(r, 500));
  await sql`delete from job_events where job_id like ${PREFIX + '%'}`;

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

    await renewLease(sql, jobId, 30_000, 1);

    const leaseExpiresAt = await jobLeaseExpiresAt(jobId);
    expect(leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  test('does not renew a lease for a job that is not running (already terminal/reverted)', async () => {
    const { taskId, repoId } = await makeChain();
    const jobId = await seedJob(taskId, repoId, 'pending', null);

    await renewLease(sql, jobId, 30_000, 1);

    expect(await jobLeaseExpiresAt(jobId)).toBeNull();
  });

  /**
   * 3자 리뷰 수정 E1 (Fable M1): a heartbeat carries the generation the CALLER captured when its
   * flow started — a stale renewal from a superseded run (gen 1) arriving AFTER a lease-expiry
   * scan failed the job, bumpJobGeneration moved it to gen 2, and a re-claim put it BACK to
   * 'running' must not renew the NEW generation's lease. Without the guard, `status = 'running'`
   * alone would still match and let a dead run's heartbeat keep a live claim's lease alive.
   */
  test("does not renew a lease for a job whose generation has moved on (stale heartbeat from a superseded run)", async () => {
    const { taskId, repoId } = await makeChain();
    const original = new Date(Date.now() + 60_000);
    const jobId = await seedJob(taskId, repoId, 'running', original, 2); // already re-claimed at gen 2

    await renewLease(sql, jobId, 30_000, 1); // a stale gen-1 heartbeat, arriving late

    const leaseExpiresAt = await jobLeaseExpiresAt(jobId);
    expect(leaseExpiresAt!.getTime()).toBe(original.getTime()); // untouched
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
    const wrapped = withLeaseHeartbeat(fakeStore, sql, jobId, 30_000, 1);

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
    const wrapped = withLeaseHeartbeat(spyStore, sql, jobId, 30_000, 1);

    await wrapped.setCurrentStep('flow-x', 'verify');

    expect(delegatedTo).toEqual({ flowId: 'flow-x', step: 'verify' });
  });
});

describe('withLeaseHeartbeat — setStatus (3자 리뷰 수정 A라운드 A2: HITL 정지 = lease 해제)', () => {
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

  test("setStatus('suspended') clears the lease — a HITL pause is not a crash", async () => {
    const { taskId, repoId } = await makeChain();
    const jobId = await seedJob(taskId, repoId, 'running', new Date(Date.now() + 60_000));
    const wrapped = withLeaseHeartbeat(fakeStore, sql, jobId, 30_000, 1);

    await wrapped.setStatus('some-flow-id', 'suspended');

    expect(await jobLeaseExpiresAt(jobId)).toBeNull();
  });

  test("setStatus('active') (resumed after HITL) reloads the lease", async () => {
    const { taskId, repoId } = await makeChain();
    // No lease -- as if a prior 'suspended' call already cleared it.
    const jobId = await seedJob(taskId, repoId, 'running', null);
    const wrapped = withLeaseHeartbeat(fakeStore, sql, jobId, 30_000, 1);

    await wrapped.setStatus('some-flow-id', 'active');

    const leaseExpiresAt = await jobLeaseExpiresAt(jobId);
    expect(leaseExpiresAt).not.toBeNull();
    expect(leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  test('other statuses (completed/abandoned) do not touch the lease', async () => {
    const { taskId, repoId } = await makeChain();
    const original = new Date(Date.now() + 60_000);
    const jobId = await seedJob(taskId, repoId, 'running', original);
    const wrapped = withLeaseHeartbeat(fakeStore, sql, jobId, 30_000, 1);

    await wrapped.setStatus('some-flow-id', 'completed');

    const leaseExpiresAt = await jobLeaseExpiresAt(jobId);
    expect(leaseExpiresAt?.getTime()).toBe(original.getTime());
  });

  test("still delegates to the underlying store's setStatus", async () => {
    const { taskId, repoId } = await makeChain();
    const jobId = await seedJob(taskId, repoId, 'running', null);
    let delegated: { flowId: string; status: string } | undefined;
    const spyStore: OrchestratorStore = {
      ...fakeStore,
      setStatus: async (flowId, status) => {
        delegated = { flowId, status };
      },
    };
    const wrapped = withLeaseHeartbeat(spyStore, sql, jobId, 30_000, 1);

    await wrapped.setStatus('flow-y', 'suspended');

    expect(delegated).toEqual({ flowId: 'flow-y', status: 'suspended' });
  });

  test('integration: a suspended job is never flagged expired by the controller scan (no wake, stays running)', async () => {
    const { taskId, repoId } = await makeChain();
    const jobId = await seedJob(taskId, repoId, 'running', new Date(Date.now() + 60_000));
    const wrapped = withLeaseHeartbeat(fakeStore, sql, jobId, 30_000, 1);

    await wrapped.setStatus('some-flow-id', 'suspended'); // lease cleared -- scan's own `is not null` excludes it

    const dispatch = mock(async (_job: ReconcileJob) => {});
    const controller = startGraphController(sql, dispatch, { tickMs: 999_999 });
    try {
      // Give the scan several real passes a fair chance to (wrongly) flag this job expired.
      for (let i = 0; i < 5; i++) {
        await controller.tick();
        await new Promise((r) => setTimeout(r, 30));
      }
      const rows = (await sql`select status from jobs where id = ${jobId}`) as Array<{ status: string }>;
      expect(rows[0]!.status).toBe('running');
      const wakeRows = (await sql`
        select 1 from decisions where request_type = 'agent_wake' and status = 'open' and meta->>'kind' = 'lease_expired' and meta->>'jobId' = ${jobId}
      `) as unknown[];
      expect(wakeRows.length).toBe(0);
    } finally {
      await controller.stop();
      await sql`delete from decisions where request_type = 'agent_wake' and meta->>'jobId' = ${jobId}`;
    }
  });
});
