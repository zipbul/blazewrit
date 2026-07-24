import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { SQL } from 'bun';
import { createRestApi } from './rest';
import { ensureSchema } from '../infra/schema';
import type { StepContext, StepExecutor } from '../orchestrator/types';

/**
 * 3자 리뷰 수정 C2 (Grok F4): the lease heartbeat only ever renewed at STEP BOUNDARIES
 * (withLeaseHeartbeat's setCurrentStep wrapper) — a single step that runs longer than leaseTtlMs
 * (default 10 minutes; a real `implement` step against the Claude Agent SDK plausibly does) gets
 * its lease flagged expired and the job failed by graph/controller.ts's A3 scan, even though the
 * worker is still alive and actively emitting agent events the whole time. The lease's own design
 * intent is "detect a CRASHED worker", not "detect a slow step" — so a live agent event stream
 * (onAgentEvent, fired for every tool_use/thinking/assistant chunk mid-step) must ALSO renew it.
 */
const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const MARK = `heartbeat-${process.pid}-${Date.now()}`;
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

async function jobLeaseExpiresAt(jobId: string): Promise<Date | null> {
  const rows = (await sql`select lease_expires_at from jobs where id = ${jobId}`) as Array<{ lease_expires_at: Date | null }>;
  return rows[0]?.lease_expires_at ?? null;
}

beforeAll(async () => {
  await ensureSchema(sql);
  await sql`insert into projects (id, name, status) values (${projectId}, ${projectId}, 'active')`;
});

afterAll(async () => {
  await sql`delete from decisions where meta->>'taskId' like ${MARK + '%'}`;
  await sql`delete from job_events where job_id like ${MARK + '%'}`;

  await sql`delete from jobs where id like ${MARK + '%'}`;
  await sql`delete from tasks where id like ${MARK + '%'}`;
  await sql`delete from repos where id like ${MARK + '%'}`;
  await sql`delete from step_runs where flow_id like ${MARK + '%'}`;
  await sql`delete from flows where id like ${MARK + '%'}`;
  await sql`delete from work_items where id like ${MARK + '%'}`;
  await sql`delete from projects where id like ${MARK + '%'}`;
  await sql.end();
});

describe('onAgentEvent — lease heartbeat (harness/job-graph.md P2 spec A2, 3자 리뷰 수정 C2)', () => {
  it("renews the job's lease when a live agent event fires mid-step, not just at the step boundary", async () => {
    const leaseTtlMs = 300; // short enough that ONLY the step-boundary renewal would lapse quickly
    let sawLeaseBeforeEmit: Date | null = null;
    let sawLeaseAfterEmit: Date | null = null;

    const probeExecutor: StepExecutor = {
      produce: async (ctx: StepContext) => {
        const flowRows = (await sql`select job_id from flows where id = ${ctx.flowId}`) as Array<{ job_id: string }>;
        const jobId = flowRows[0]!.job_id;
        sawLeaseBeforeEmit = await jobLeaseExpiresAt(jobId);

        ctx.emit?.({ type: 'thinking', payload: {} });

        // The renewal (if wired) is a fire-and-forget DB write from a synchronous void callback —
        // give it a moment to actually land before reading it back. A short bound: if it hasn't
        // renewed within a few hundred ms it isn't going to (RED case) — no need for a long wait.
        await waitFor(
          async () => {
            const after = await jobLeaseExpiresAt(jobId);
            return after && sawLeaseBeforeEmit && after.getTime() > sawLeaseBeforeEmit.getTime() ? after : undefined;
          },
          800,
          20,
        ).catch(() => undefined); // timing out just means "never renewed" -- fall through with sawLeaseAfterEmit unchanged
        sawLeaseAfterEmit = await jobLeaseExpiresAt(jobId);

        return { output: 'out' };
      },
      review: async () => ({ verdict: 'pass' }),
    };

    const app = createRestApi(sql, { executor: probeExecutor, newId, leaseTtlMs });

    const text = `${MARK} case1 chore`;
    const res = await sendA2A(app, projectId, text);
    const { id: workItemId } = ((await res.json()) as { result: { id: string } }).result;

    await waitFor(async () => {
      const rows = (await sql`select state from work_items where id = ${workItemId}`) as Array<{ state: string }>;
      return rows[0]?.state === 'done' ? rows[0] : undefined;
    });

    expect(sawLeaseBeforeEmit).not.toBeNull();
    expect(sawLeaseAfterEmit).not.toBeNull();
    // The event-triggered renewal must push the expiry to a LATER moment than whatever the
    // step-boundary (setCurrentStep) renewal alone had already set it to.
    expect(sawLeaseAfterEmit!.getTime()).toBeGreaterThan(sawLeaseBeforeEmit!.getTime());
  }, 15000);
});
