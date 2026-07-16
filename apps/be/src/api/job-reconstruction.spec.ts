import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { createRestApi } from './rest';
import { ensureSchema } from '../infra/schema';
import { bumpJobGeneration } from '../graph/store';
import { startGraphController } from '../graph/controller';
import type { ReconcileJob } from '../graph/reconcile';
import type { StepExecutor } from '../orchestrator/types';

/**
 * P4-2b: runRegisteredJob's registry-miss branch (rest.ts) no longer reverts an unrecognized
 * claimed job to pending (3자 리뷰 수정 B1-2a/B2, superseded) — it reconstructs a runnable flow
 * straight from the jobs row and actually runs it to a terminal state. Covers
 * round-P4-2b-spec.md's own test list: the core reconstruct-and-complete path, generation capture
 * (closing 3자 리뷰 수정 E1's `jobGeneration = 1` approximation), a reconstruction-not-possible
 * no-op, dispatchTask's own registered-closure path staying unaffected, and an
 * immediate-failure reconstruction not conflicting with the zombie/lease-expiry scans.
 *
 * A registry-miss job with no stored flow_type (jobs.flow_type is null — every fixture below
 * except test 6, which is the whole point of test 6) falls back to StubFlowClassifier, whose
 * every possible output (bugfix/refactor/migration/feature) includes a 'decide' step — the flow
 * genuinely suspends on a HITL question partway through, same as any classify()-only dispatchTask
 * run would. `answerOpenDecision` plays the human's part so those tests can observe a run all the
 * way to 'done'. Test 6 (P4-2b 후속) is the one case that does NOT need it — a stored 'chore'
 * flow_type has no 'decide' step at all.
 */
const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const MARK = `job-recon-${process.pid}-${Date.now()}`;
let idSeq = 0;
const newId = () => `${MARK}-${idSeq++}`;

const fastExecutor = (onProduce?: () => void): StepExecutor => ({
  produce: async () => {
    onProduce?.();
    return { output: 'out' };
  },
  review: async () => ({ verdict: 'pass' }),
});

const throwingExecutor: StepExecutor = {
  produce: async () => {
    throw new Error('boom-immediate');
  },
  review: async () => ({ verdict: 'pass' }),
};

async function makeChain(label: string): Promise<{ repoId: string; taskId: string }> {
  const productId = `${MARK}-product-${label}`;
  const repoId = `${MARK}-repo-${label}`;
  const taskId = `${MARK}-task-${label}`;
  await sql`insert into products (id, name) values (${productId}, ${productId}) on conflict (id) do nothing`;
  await sql`insert into repos (id, product_id, name, cwd) values (${repoId}, ${productId}, ${repoId}, '/tmp')`;
  await sql`insert into tasks (id, title, status) values (${taskId}, ${taskId}, 'open')`;
  return { repoId, taskId };
}

async function jobRow(jobId: string): Promise<{ status: string; generation: number } | undefined> {
  const rows = (await sql`select status, generation from jobs where id = ${jobId}`) as Array<{ status: string; generation: number }>;
  return rows[0];
}

async function waitFor<T>(fn: () => Promise<T | undefined | null | false>, timeoutMs = 10000, interval = 30): Promise<T> {
  const start = Date.now();
  let last: T | undefined | null | false;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (last) return last as T;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms; last value: ${JSON.stringify(last)}`);
}

/** Plays the human's part at the reconstructed flow's 'decide' step: waits for its flow to open a
 * decision, then approves it — the same `/api/decisions/:id/answer` route a real user hits. */
async function answerOpenDecision(app: ReturnType<typeof createRestApi>, jobId: string): Promise<void> {
  const decision = await waitFor(async () => {
    const rows = (await sql`
      select d.id from decisions d join flows f on f.id = d.flow_id where f.job_id = ${jobId} and d.status = 'open'
    `) as Array<{ id: string }>;
    return rows[0];
  });
  await app.handle(
    new Request(`http://localhost/api/decisions/${decision.id}/answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answer: 'approve' }),
    }),
  );
}

async function openWakeCount(kind: string, jobId: string): Promise<number> {
  const rows = (await sql`
    select id from decisions where request_type = 'agent_wake' and status = 'open' and meta->>'kind' = ${kind} and meta->>'jobId' = ${jobId}
  `) as unknown[];
  return rows.length;
}

beforeAll(async () => {
  await ensureSchema(sql);
});

afterAll(async () => {
  // Test 5 starts a graph controller — its own auto-initial tick can still be mid-flight when
  // stop() returns (stop() only clears the FUTURE timer, same documented gotcha as lease.spec.ts/
  // controller.spec.ts) — give it a moment to settle before closing the connection out from
  // under it.
  await new Promise((r) => setTimeout(r, 500));
  await sql`delete from decisions where request_type = 'agent_wake' and meta->>'jobId' like ${MARK + '%'}`;
  await sql`delete from decisions where id like ${MARK + '%'}`;
  await sql`delete from step_runs where flow_id like ${MARK + '%'}`;
  await sql`delete from flows where id like ${MARK + '%'}`;
  await sql`delete from jobs where id like ${MARK + '%'}`;
  await sql`delete from tasks where id like ${MARK + '%'}`;
  await sql`delete from work_items where id like ${MARK + '%'}`;
  await sql`delete from repos where id like ${MARK + '%'}`;
  await sql`delete from products where id like ${MARK + '%'}`;
  await sql`delete from projects where id like ${MARK + '%'}`;
  await sql.end();
});

describe('runRegisteredJob registry-miss -> DB reconstruction (P4-2b)', () => {
  test('1. a registry-miss running job is reconstructed and run to completion (F-E1 core)', async () => {
    let produceCalls = 0;
    let dispatch: ((job: ReconcileJob) => Promise<void>) | undefined;
    const app = createRestApi(sql, {
      newId,
      executor: fastExecutor(() => {
        produceCalls++;
      }),
      onReconcileDispatch: (fn) => {
        dispatch = fn;
      },
    });

    const { repoId, taskId } = await makeChain('core');
    const jobId = `${MARK}-job-core`;
    // Inserted directly at 'running' — never dispatched through THIS app instance (or ANY, in
    // the A2A-accept/agent job_add sense), so no execution closure was ever registered for it.
    await sql`insert into jobs (id, task_id, repo_id, title, status) values (${jobId}, ${taskId}, ${repoId}, 'x', 'running')`;

    await dispatch!({ id: jobId, repoId, taskId, title: 'x' });
    await answerOpenDecision(app, jobId);
    await waitFor(async () => ((await jobRow(jobId))?.status === 'done' ? true : undefined));

    expect(produceCalls).toBeGreaterThan(0); // proves the executor actually ran, not a coincidental status match
  }, 15000);

  test("2. reconstruction captures the row's REAL generation, not a hardcoded 1", async () => {
    let dispatch: ((job: ReconcileJob) => Promise<void>) | undefined;
    const app = createRestApi(sql, { newId, executor: fastExecutor(), onReconcileDispatch: (fn) => { dispatch = fn; } });

    const { repoId, taskId } = await makeChain('gen2');
    const jobId = `${MARK}-job-gen2`;
    // Simulates a re-run slot: gen++'d past 1 (bumpJobGeneration only fires on a terminal job),
    // then re-claimed to running at the new generation — exactly what a reclaimed A2A/job_add job
    // looks like after one failed attempt.
    await sql`insert into jobs (id, task_id, repo_id, title, status) values (${jobId}, ${taskId}, ${repoId}, 'x', 'failed')`;
    await bumpJobGeneration(sql, repoId, jobId); // gen 1 -> 2, status -> pending
    await sql`update jobs set status = 'running' where id = ${jobId} and status = 'pending'`;

    await dispatch!({ id: jobId, repoId, taskId, title: 'x' });
    await answerOpenDecision(app, jobId);
    await waitFor(async () => ((await jobRow(jobId))?.status === 'done' ? true : undefined));

    // If reconstruction had hardcoded jobGeneration=1 (E1's old constant) instead of the row's
    // real value, the completion write's `and generation = 1` would never match this gen-2 row —
    // it would stay stuck 'running' forever and the waitFor above would have timed out.
    expect((await jobRow(jobId))?.generation).toBe(2);
  }, 15000);

  test('3. a job whose claim already flipped by the time reconstruction runs is a silent no-op', async () => {
    let dispatch: ((job: ReconcileJob) => Promise<void>) | undefined;
    createRestApi(sql, { newId, executor: fastExecutor(), onReconcileDispatch: (fn) => { dispatch = fn; } });

    const { repoId, taskId } = await makeChain('flipped');
    const jobId = `${MARK}-job-flipped`;
    await sql`insert into jobs (id, task_id, repo_id, title, status) values (${jobId}, ${taskId}, ${repoId}, 'x', 'running')`;
    // Something else (a concurrent revert, a completion via a different path) already moved this
    // row on to 'pending' by the time this reconcile pass's dispatch callback actually runs.
    await sql`update jobs set status = 'pending' where id = ${jobId}`;

    await dispatch!({ id: jobId, repoId, taskId, title: 'x' }); // must not throw
    await new Promise((r) => setTimeout(r, 300));

    expect((await jobRow(jobId))?.status).toBe('pending'); // untouched
    const flows = (await sql`select 1 from flows where job_id = ${jobId}`) as unknown[];
    expect(flows).toHaveLength(0); // no reconstruction attempt ever ran
  });

  test('4. a dispatchTask-created job still runs through its OWN registered closure, not reconstruction (no regression)', async () => {
    const app = createRestApi(sql, { newId, executor: fastExecutor() });
    const projectId = `${MARK}-project-registered`;
    await sql`insert into projects (id, name, status) values (${projectId}, ${projectId}, 'active')`;

    const envelope = {
      jsonrpc: '2.0',
      id: `${MARK}-rpc-registered`,
      method: 'message/send',
      params: {
        message: {
          kind: 'message',
          messageId: `${MARK}-msg-registered`,
          role: 'user',
          parts: [{ kind: 'text', text: `${MARK} registered-path chore` }],
          metadata: { flowType: 'chore' }, // carried -> no classify(), no 'decide' step -> no HITL wait
        },
      },
    };
    const res = await app.handle(
      new Request(`http://localhost/agents/${encodeURIComponent(projectId)}/a2a`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(envelope),
      }),
    );
    const { id: workItemId } = ((await res.json()) as { result: { id: string } }).result;

    await waitFor(async () => ((await jobRow(workItemId))?.status === 'done' ? true : undefined));
  }, 15000);

  test('5. an immediate reconstruction failure terminals the job — no conflict with the zombie/lease-expiry scans', async () => {
    let dispatch: ((job: ReconcileJob) => Promise<void>) | undefined;
    createRestApi(sql, { newId, executor: throwingExecutor, onReconcileDispatch: (fn) => { dispatch = fn; } });

    const { repoId, taskId } = await makeChain('failfast');
    const jobId = `${MARK}-job-failfast`;
    await sql`insert into jobs (id, task_id, repo_id, title, status) values (${jobId}, ${taskId}, ${repoId}, 'x', 'running')`;

    await dispatch!({ id: jobId, repoId, taskId, title: 'x' });
    await waitFor(async () => ((await jobRow(jobId))?.status === 'failed' ? true : undefined));

    // Terminal already — nothing left 'running' for either scan to (correctly or wrongly) flag.
    const controller = startGraphController(sql, async () => {}, { tickMs: 999_999, stallThresholdMs: 0 });
    try {
      await controller.tick();
      expect(await openWakeCount('orphaned_ready', jobId)).toBe(0);
      expect(await openWakeCount('lease_expired', jobId)).toBe(0);
      expect((await jobRow(jobId))?.status).toBe('failed'); // never resurrected by either scan
    } finally {
      controller.stop();
    }
  }, 15000);

  /**
   * P4-2b 후속 (Fable+Codex 3자 리뷰, flowType 발산): a carriedFlowType (human-approved, A2A
   * metadata) job that crashes after insertJob but before claim used to have no durable record of
   * that approval — reconstruction fell back to classify(title), which can genuinely disagree
   * (a different step sequence, an unwanted/missing HITL pause). jobs.flow_type closes that gap;
   * this proves reconstruction reads and honors it over re-classifying.
   */
  test("6. reconstruction honors a STORED flow_type over re-classifying the title", async () => {
    let produceCalls = 0;
    let dispatch: ((job: ReconcileJob) => Promise<void>) | undefined;
    createRestApi(sql, {
      newId,
      executor: fastExecutor(() => {
        produceCalls++;
      }),
      onReconcileDispatch: (fn) => {
        dispatch = fn;
      },
    });

    const { repoId, taskId } = await makeChain('flowtype');
    const jobId = `${MARK}-job-flowtype`;
    const title = 'fix the bug in reconstruction'; // classify(title) alone -> 'bugfix' (HAS a 'decide' step)
    // Stored flow_type is 'chore' (ground->implement->verify->reflect, NO 'decide') — the
    // flowType actually approved when this job was created. Reconstruction must honor it, not
    // re-derive a different one from the title.
    await sql`insert into jobs (id, task_id, repo_id, title, status, flow_type) values (${jobId}, ${taskId}, ${repoId}, ${title}, 'running', 'chore')`;

    await dispatch!({ id: jobId, repoId, taskId, title });

    // No answerOpenDecision call here on purpose: a 'chore' run never opens a decision. If
    // reconstruction ignored the stored flow_type and re-classified the title instead, this would
    // suspend at 'decide' and the waitFor below would time out (the RED this test guards against).
    await waitFor(async () => ((await jobRow(jobId))?.status === 'done' ? true : undefined));
    expect(produceCalls).toBeGreaterThan(0); // proves the executor actually ran the chore workflow
  }, 15000);
});
