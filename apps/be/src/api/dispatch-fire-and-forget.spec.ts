import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { SQL } from 'bun';
import { createRestApi } from './rest';
import { ensureSchema } from '../infra/schema';
import type { StepExecutor } from '../orchestrator/types';

/**
 * 3자 리뷰 수정 B1-2b (Fable#4+#7): before this fix, runRegisteredJob's "found a registered
 * executor" branch did `await exec()` — meaning reconcileTask's own `await dispatch(job)` (and, in
 * turn, whatever called reconcileTask) blocked until that job's ENTIRE flow finished. Reached
 * through graph/controller.ts's always-on tick(), which single-flights (one tick() in progress
 * makes a concurrent call a no-op) and processes every open task's ready jobs in one sequential
 * pass, a single hours-long flow could stall the WHOLE periodic scan (lease-expiry checks, C1/C2/D1
 * wake scans, every other task's own reconcile) for as long as that one flow took to finish.
 *
 * dispatchTask registers a job's execution closure into rest.ts's private jobExecutors map
 * SYNCHRONOUSLY, before any `await` — so by the time this test's own `sendA2A(...)` call returns
 * (which requires the response body to round-trip through several in-memory microtasks only), the
 * registry entry is already present, while dispatchTask's OWN background reconcile still has
 * several REAL Postgres round-trips left before it would reach its own dispatch(job) call. Calling
 * the captured `dispatch` (the exact function graph/controller.ts's tick() would call) directly,
 * right here, exercises the SAME "found a registered executor" branch this fix changes, and lets
 * this test measure whether IT returns without waiting for the (deliberately gated) flow to finish.
 */
const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const MARK = `ff-${process.pid}-${Date.now()}`;
const projectId = `${MARK}-proj`;

let idSeq = 0;
const newId = () => `${MARK}-${idSeq++}`;

let rpcSeq = 0;
function sendA2A(target: ReturnType<typeof createRestApi>, targetProjectId: string, text: string): Promise<Response> {
  const id = `${MARK}-rpc-${rpcSeq++}`;
  const envelope = {
    jsonrpc: '2.0',
    id,
    method: 'message/send',
    params: {
      message: { kind: 'message', messageId: `${id}-msg`, role: 'user', parts: [{ kind: 'text', text }], metadata: { flowType: 'chore' } },
    },
  };
  return target.handle(
    new Request(`http://localhost/agents/${encodeURIComponent(targetProjectId)}/a2a`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
    }),
  );
}

/** A step executor whose produce() blocks on `gate` — the "hours-long flow" stand-in. */
function makeGatedExecutor(gate: Promise<void>): StepExecutor {
  return {
    produce: async () => {
      await gate;
      return { output: 'out' };
    },
    review: async () => ({ verdict: 'pass' }),
  };
}

async function waitFor<T>(fn: () => Promise<T | undefined | null | false>, timeoutMs = 10000, interval = 50): Promise<T> {
  const start = Date.now();
  let last: T | undefined | null | false;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (last) return last as T;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms; last value: ${JSON.stringify(last)}`);
}

beforeAll(async () => {
  await ensureSchema(sql);
  await sql`insert into projects (id, name, status) values (${projectId}, ${projectId}, 'active')`;
});

afterAll(async () => {
  await sql`delete from decisions where meta->>'taskId' like ${MARK + '%'}`;
  await sql`delete from jobs where id like ${MARK + '%'}`;
  await sql`delete from tasks where id like ${MARK + '%'}`;
  await sql`delete from repos where id like ${MARK + '%'}`;
  await sql`delete from step_runs where flow_id like ${MARK + '%'}`;
  await sql`delete from flows where id like ${MARK + '%'}`;
  await sql`delete from work_items where id like ${MARK + '%'}`;
  await sql`delete from projects where id like ${MARK + '%'}`;
  await sql.end();
});

describe('runRegisteredJob — fire-and-forget (harness/job-graph.md P2 spec, 3자 리뷰 수정 B1-2b)', () => {
  it('returns without waiting for a slow registered flow to finish', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let dispatch: ((job: { id: string; repoId: string; taskId: string; title: string }) => Promise<void>) | undefined;
    const app = createRestApi(sql, {
      newId,
      executor: makeGatedExecutor(gate),
      onReconcileDispatch: (fn) => {
        dispatch = fn;
      },
    });

    const text = `${MARK} case1 chore`;
    const res = await sendA2A(app, projectId, text);
    const { id: workItemId } = ((await res.json()) as { result: { id: string } }).result;

    // See the file-level comment: at this point jobExecutors[workItemId] is present (registered
    // synchronously by dispatchTask) but dispatchTask's OWN background reconcile call — several
    // real Postgres round-trips behind — has not reached its own dispatch(job) call yet.
    let settled = false;
    const p = dispatch!({ id: workItemId, repoId: projectId, taskId: workItemId, title: text }).then(() => {
      settled = true;
    });

    await new Promise((r) => setTimeout(r, 200));
    expect(settled).toBe(true); // returned WITHOUT waiting for the gated flow

    release(); // let the flow (and dispatchTask's own later, now-orphaned re-claim) settle
    await p;

    // Cleanup-safety, not part of the assertion above: the gated flow keeps writing
    // step_runs/flows/work_items in the background after `release()` (all steps resolve quickly
    // once the shared gate is open, but each still does real async DB I/O) — wait for it to
    // actually finish before this test returns, so afterAll's deletes don't race a still-in-flight
    // insert (FK violation on flows/step_runs).
    await waitFor(async () => {
      const rows = (await sql`select state from work_items where id = ${workItemId}`) as Array<{ state: string }>;
      return rows[0] && rows[0].state !== 'in_flow' ? rows[0] : undefined;
    });
  });
});
