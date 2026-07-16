import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { createRestApi } from './rest';
import { ensureSchema } from '../infra/schema';
import type { ReconcileJob } from '../graph/reconcile';
import type { StepExecutor } from '../orchestrator/types';

/**
 * Characterizes RestDeps.onReconcileDispatch — the hook serve.ts uses to wire graph/controller.ts's
 * startGraphController to createRestApi's own registry-aware dispatch (harness/job-graph.md P2
 * round 1's "F" wiring) — and specifically the registry-miss branch: a claimed job with no
 * registered execution closure (an A2A-accept/agent job_add job, or a dispatchTask job whose
 * closure was lost to a restart) is now RECONSTRUCTED from the jobs row and actually run to
 * completion (P4-2b), superseding the earlier revert-to-pending-and-wake behavior (3자 리뷰 수정
 * B1-2a/B2). Deeper reconstruction scenarios (generation capture, no-op cases, non-regression) live
 * in job-reconstruction.spec.ts — this file stays focused on the wiring hook itself.
 *
 * A reconstructed job never carries a flowType (the graph doesn't store one — see rest.ts's own
 * comment), so it always classifies via StubFlowClassifier, whose every possible output
 * (bugfix/refactor/migration/feature) includes a 'decide' step — the flow genuinely suspends
 * waiting on a HITL answer partway through, same as any classify()-only dispatchTask run would.
 * `answerOpenDecision` below plays the human's part so these tests can observe the run all the
 * way to 'done'.
 */
const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const MARK = `reconcile-dispatch-${process.pid}-${Date.now()}`;
let idSeq = 0;
const newId = () => `${MARK}-${idSeq++}`;

/** Instant pass/pass — keeps everything but the HITL pause itself near-instant. */
const fastExecutor: StepExecutor = {
  produce: async () => ({ output: 'out' }),
  review: async () => ({ verdict: 'pass' }),
};

async function jobStatus(jobId: string): Promise<string> {
  const rows = (await sql`select status from jobs where id = ${jobId}`) as Array<{ status: string }>;
  return rows[0]!.status;
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
  const res = await app.handle(
    new Request(`http://localhost/api/decisions/${decision.id}/answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answer: 'approve' }),
    }),
  );
  expect(res.status).toBe(200);
}

beforeAll(async () => {
  await ensureSchema(sql);
});

afterAll(async () => {
  await sql`delete from decisions where request_type = 'agent_wake' and meta->>'jobId' like ${MARK + '%'}`;
  await sql`delete from decisions where id like ${MARK + '%'}`;
  await sql`delete from step_runs where flow_id like ${MARK + '%'}`;
  await sql`delete from flows where id like ${MARK + '%'}`;
  await sql`delete from jobs where id like ${MARK + '%'}`;
  await sql`delete from tasks where id like ${MARK + '%'}`;
  await sql`delete from repos where id like ${MARK + '%'}`;
  await sql`delete from products where id like ${MARK + '%'}`;
  await sql.end();
});

describe('RestDeps.onReconcileDispatch', () => {
  test('is called synchronously during setup with the registry-aware dispatch function', () => {
    let captured: unknown;
    createRestApi(sql, { newId, onReconcileDispatch: (dispatch) => { captured = dispatch; } });
    expect(typeof captured).toBe('function');
  });

  test('a claimed job with no registered execution closure is reconstructed from the DB and run to completion (P4-2b)', async () => {
    let dispatch: ((job: ReconcileJob) => Promise<void>) | undefined;
    const app = createRestApi(sql, { newId, executor: fastExecutor, onReconcileDispatch: (fn) => { dispatch = fn; } });

    const productId = `${MARK}-product`;
    const repoId = `${MARK}-repo`;
    const taskId = `${MARK}-task`;
    const jobId = `${MARK}-job`;
    await sql`insert into products (id, name) values (${productId}, ${productId}) on conflict (id) do nothing`;
    await sql`insert into repos (id, product_id, name, cwd) values (${repoId}, ${productId}, ${repoId}, '/tmp')`;
    await sql`insert into tasks (id, title, status) values (${taskId}, ${taskId}, 'open')`;
    // Inserted directly at 'running' — never dispatched through THIS app instance (or ANY, in
    // the A2A-accept/agent job_add sense), so no execution closure was ever registered for it.
    await sql`insert into jobs (id, task_id, repo_id, title, status) values (${jobId}, ${taskId}, ${repoId}, 'x', 'running')`;

    await dispatch!({ id: jobId, repoId, taskId, title: 'x' });
    await answerOpenDecision(app, jobId);

    await waitFor(async () => ((await jobStatus(jobId)) === 'done' ? true : undefined));
  }, 15000);

  test('a second dispatch of the SAME (already-completed) job id is a safe no-op', async () => {
    let dispatch: ((job: ReconcileJob) => Promise<void>) | undefined;
    const app = createRestApi(sql, { newId, executor: fastExecutor, onReconcileDispatch: (fn) => { dispatch = fn; } });

    const productId = `${MARK}-product2`;
    const repoId = `${MARK}-repo2`;
    const taskId = `${MARK}-task2`;
    const jobId = `${MARK}-job2`;
    await sql`insert into products (id, name) values (${productId}, ${productId}) on conflict (id) do nothing`;
    await sql`insert into repos (id, product_id, name, cwd) values (${repoId}, ${productId}, ${repoId}, '/tmp')`;
    await sql`insert into tasks (id, title, status) values (${taskId}, ${taskId}, 'open')`;
    await sql`insert into jobs (id, task_id, repo_id, title, status) values (${jobId}, ${taskId}, ${repoId}, 'x', 'running')`;

    await dispatch!({ id: jobId, repoId, taskId, title: 'x' }); // reconstructed and run to completion
    await answerOpenDecision(app, jobId);
    await waitFor(async () => ((await jobStatus(jobId)) === 'done' ? true : undefined));

    // A second claim callback for the same job id (e.g. a stale/duplicate reconcile pass) no
    // longer finds it 'running' — the reconstruction SELECT's own `status = 'running'` guard
    // makes this silently do nothing, not re-run or clobber the already-terminal row.
    await dispatch!({ id: jobId, repoId, taskId, title: 'x' });
    await new Promise((r) => setTimeout(r, 200));
    expect(await jobStatus(jobId)).toBe('done');
  }, 15000);
});
