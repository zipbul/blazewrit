import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { SQL } from 'bun';
import { createRestApi } from './rest';
import { ensureSchema } from '../infra/schema';
import type { StepExecutor } from '../orchestrator/types';

/**
 * CHARACTERIZATION TEST for GET /api/work-items — pins the WorkItemDto contract (harness/
 * job-graph.md migration step 5: swapping the query from reading `work_items` directly to
 * projecting `jobs`+`tasks`+`flows`). Run once against the CURRENT (work_items-reading)
 * implementation to establish the green baseline, then again — unmodified — after the
 * projection swap: both runs must be green with no changes to this file. Helpers below are
 * deliberately duplicated from dispatch-task.characterization.spec.ts rather than imported —
 * that file is a separate frozen baseline and must not be touched by this work.
 */

const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const MARK = `wiproj-${process.pid}-${Date.now()}`;
const projectId = `${MARK}-proj`;

let idSeq = 0;
const newId = () => `${MARK}-${idSeq++}`;

const passingExecutor: StepExecutor = {
  produce: async () => ({ output: 'out' }),
  review: async () => ({ verdict: 'pass' }),
};

const app = createRestApi(sql, { executor: passingExecutor, newId });

let rpcSeq = 0;

function sendA2A(
  target: ReturnType<typeof createRestApi>,
  targetProjectId: string,
  text: string,
  opts: { metadata?: Record<string, unknown>; contextId?: string } = {},
): Promise<Response> {
  const id = `${MARK}-rpc-${rpcSeq++}`;
  const envelope = {
    jsonrpc: '2.0',
    id,
    method: 'message/send',
    params: {
      message: {
        kind: 'message',
        messageId: `${id}-msg`,
        role: 'user',
        parts: [{ kind: 'text', text }],
        ...(opts.contextId ? { contextId: opts.contextId } : {}),
        ...(opts.metadata ? { metadata: opts.metadata } : {}),
      },
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

const post = (target: ReturnType<typeof createRestApi>, path: string, body: unknown) =>
  target.handle(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

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

async function getWorkItemsResponse(target: ReturnType<typeof createRestApi>): Promise<Array<Record<string, unknown>>> {
  const res = await target.handle(new Request('http://localhost/api/work-items'));
  return (await res.json()) as Array<Record<string, unknown>>;
}

async function findWorkItem(target: ReturnType<typeof createRestApi>, id: string): Promise<Record<string, unknown> | undefined> {
  const rows = await getWorkItemsResponse(target);
  return rows.find((r) => r.id === id);
}

/** Field assertions common to every row, regardless of scenario. */
function expectCommonShape(item: Record<string, unknown>, expected: { id: string; projectId: string; title: string }): void {
  expect(item.id).toBe(expected.id);
  expect(item.projectId).toBe(expected.projectId);
  expect(item.title).toBe(expected.title);
  expect(item.description).toBe('');
  expect(item.labels).toEqual([]);
  expect(item.priority).toBe(0);
  expect(item.source).toBe('user');
  expect(typeof item.createdAt).toBe('string');
  expect(new Date(item.createdAt as string).toISOString()).toBe(item.createdAt as string);
  expect(typeof item.updatedAt).toBe('string');
  expect(typeof item.activeFlowId).toBe('string');
}

beforeAll(async () => {
  await ensureSchema(sql);
  await sql`insert into projects (id, name, status) values (${projectId}, ${projectId}, ${'active'})`;
});

afterAll(async () => {
  await sql`delete from job_events where job_id like ${MARK + '%'}`;

  await sql`delete from jobs where id like ${MARK + '%'}`;
  await sql`delete from tasks where id like ${MARK + '%'}`;
  await sql`delete from repos where id like ${MARK + '%'}`;
  await sql`delete from step_runs where flow_id like ${MARK + '%'}`;
  await sql`delete from flows where id like ${MARK + '%'}`;
  await sql`delete from decisions where id like ${MARK + '%'}`;
  await sql`delete from chat_messages where scope like ${MARK + '%'}`;
  await sql`delete from work_items where id like ${MARK + '%'}`;
  await sql`delete from projects where id like ${MARK + '%'}`;
  await sql.end();
});

describe('GET /api/work-items — DTO projection contract (harness/job-graph.md migration step 5)', () => {
  it('a completed chore dispatch (explicit contextId) projects a done row with completedAt', async () => {
    const text = `${MARK} case1 chore done`;
    const ctx = `${MARK}-ctx-a`;
    const res = await sendA2A(app, projectId, text, { metadata: { flowType: 'chore' }, contextId: ctx });
    const { id: workItemId } = ((await res.json()) as { result: { id: string } }).result;

    const item = await waitFor(async () => {
      const found = await findWorkItem(app, workItemId);
      return found?.state === 'done' ? found : undefined;
    });

    expectCommonShape(item, { id: workItemId, projectId, title: text });
    expect(item.type).toBe('task'); // chore -> workItemType fallback 'task'
    expect(item.state).toBe('done');
    expect(item.contextId).toBe(ctx);
    expect(typeof item.completedAt).toBe('string');
    expect(new Date(item.completedAt as string).toISOString()).toBe(item.completedAt as string);
  });

  it('a feature dispatch suspended at the decide gate projects an in_flow row with no completedAt', async () => {
    const text = `${MARK} case2 feature pending`;
    const res = await sendA2A(app, projectId, text, { metadata: { flowType: 'feature' } });
    const { id: workItemId } = ((await res.json()) as { result: { id: string } }).result;

    const item = await waitFor(async () => {
      const found = await findWorkItem(app, workItemId);
      return found?.activeFlowId ? found : undefined;
    });

    expectCommonShape(item, { id: workItemId, projectId, title: text });
    expect(item.type).toBe('feature');
    expect(item.state).toBe('in_flow');
    // No contextId was carried -> defaults to the work item's own id.
    expect(item.contextId).toBe(workItemId);
    expect(item.completedAt).toBeUndefined();
  });

  it('a feature dispatch rejected at the decide gate projects a blocked row with no completedAt', async () => {
    const text = `${MARK} case3 feature reject`;
    const res = await sendA2A(app, projectId, text, { metadata: { flowType: 'feature' } });
    const { id: workItemId } = ((await res.json()) as { result: { id: string } }).result;

    const flowId = await waitFor(async () => {
      const found = await findWorkItem(app, workItemId);
      return found?.activeFlowId as string | undefined;
    });
    const decision = await waitFor(async () => {
      const rows = (await sql`select * from decisions where flow_id = ${flowId} and status = 'open'`) as Array<Record<string, unknown>>;
      return rows[0];
    });
    await post(app, `/api/decisions/${decision.id as string}/answer`, { answer: 'reject' });

    const item = await waitFor(async () => {
      const found = await findWorkItem(app, workItemId);
      return found?.state === 'blocked' ? found : undefined;
    });

    expectCommonShape(item, { id: workItemId, projectId, title: text });
    expect(item.type).toBe('feature');
    expect(item.state).toBe('blocked');
    expect(item.completedAt).toBeUndefined();
  });

  /**
   * 3자 리뷰 수정 B2-1 (Codex major #21): dispatchTask's graph-mirror insertJob call rejects when
   * the dispatch's contextId names an already-terminal task (rule 9 latch) — the fallback path
   * (`jobExecutors.delete(...); await executeJobFlow()`) still runs the flow and writes work_items
   * directly, but NEVER creates a jobs row for it (insertJob threw before ever reaching the write).
   * Since /api/work-items reads ONLY from jobs, this work item was invisible — the user's work
   * silently vanished from the FE despite actually running to completion.
   */
  it('a work_item whose graph-mirror insert was rejected by an already-terminal ctx (direct-run fallback) still appears', async () => {
    const ctx = `${MARK}-terminal-ctx`;
    await sql`insert into tasks (id, title, status) values (${ctx}, ${ctx}, 'done')`;

    const text = `${MARK} case-legacy-fallback chore`;
    const res = await sendA2A(app, projectId, text, { metadata: { flowType: 'chore' }, contextId: ctx });
    const { id: workItemId } = ((await res.json()) as { result: { id: string } }).result;

    const wi = await waitFor(async () => {
      const rows = (await sql`select state from work_items where id = ${workItemId}`) as Array<{ state: string }>;
      return rows[0]?.state === 'done' ? rows[0] : undefined;
    });
    expect(wi.state).toBe('done');
    // Sanity: confirms the bug's precondition actually held — no jobs mirror was ever created.
    const jobRows = (await sql`select 1 from jobs where id = ${workItemId} or legacy_work_item_id = ${workItemId}`) as unknown[];
    expect(jobRows.length).toBe(0);

    const item = await findWorkItem(app, workItemId);
    expect(item).toBeDefined();
    expectCommonShape(item!, { id: workItemId, projectId, title: text });
    expect(item!.type).toBe('task'); // chore -> workItemType fallback 'task', same mapping as the jobs path
    expect(item!.state).toBe('done');
    expect(item!.contextId).toBe(ctx);
    expect(typeof item!.completedAt).toBe('string');
  });

  /**
   * 3자 리뷰 수정 B2-3 (minor 묶음): the jobs↔flows join is `on (f.job_id = j.id or f.work_item_id
   * = j.id)` — a 1:N join if more than one flow row ever matches a job (e.g. a retry/duplicate
   * flow row). Each extra match duplicated the SAME job in the response array.
   */
  it('a job with two matching flow rows projects exactly one entry, not two', async () => {
    const text = `${MARK} case-dup-flow chore`;
    const res = await sendA2A(app, projectId, text, { metadata: { flowType: 'chore' } });
    const { id: workItemId } = ((await res.json()) as { result: { id: string } }).result;

    await waitFor(async () => {
      const found = await findWorkItem(app, workItemId);
      return found?.state === 'done' ? found : undefined;
    });

    // A second flow row ending up matched to the SAME job (retry, or any future re-run wiring).
    await sql`insert into flows (id, work_item_id, job_id, flow_type, status, current_step)
      values (${`${workItemId}-retry`}, ${workItemId}, ${workItemId}, 'chore', 'completed', 'reflect')`;

    const rows = await getWorkItemsResponse(app);
    const matches = rows.filter((r) => r.id === workItemId);
    expect(matches).toHaveLength(1);
  });

  /**
   * D-round task #13 (Codex+Grok major rest.ts:875): the jobs query and the legacyOnly query used
   * to run as two independent READ COMMITTED statements, each getting its OWN snapshot. A mirror
   * insert (dispatchTask's graph-mirror insertJob) landing in the gap BETWEEN them could make a
   * work item vanish from BOTH result sets: the jobs query's snapshot predates the insert (job not
   * visible yet), and the legacyOnly query's `not exists (select 1 from jobs ...)` filter runs
   * AFTER the insert, so it now correctly excludes the work_item too — the row falls through the
   * crack between the two queries' own definitions of "which side owns it".
   *
   * Reproduced directly against the fix's actual mechanism (wrapping both queries in one
   * REPEATABLE READ transaction) rather than racing the real HTTP endpoint's internal timing,
   * which is too narrow a window to hit deterministically without an injected delay hook: this
   * proves BOTH queries, run inside ONE such transaction, see the SAME snapshot even when a
   * concurrent insert (from a genuinely different connection, `sql` — not `tx`) lands between
   * them. Under plain sequential awaits (no transaction wrapper — the pre-fix shape), the second
   * read WOULD observe the concurrent insert instead.
   */
  it('D6: the jobs query and the legacyOnly query see the SAME snapshot inside one repeatable-read transaction', async () => {
    const workItemId = `${MARK}-snapshot-wi`;
    await sql`insert into work_items (id, project_id, type, state, title, context_id) values (${workItemId}, ${projectId}, 'task', 'in_flow', 'snapshot test', ${workItemId})`;

    try {
      const { jobsSnapshotCount, legacySnapshotCount } = await sql.begin('isolation level repeatable read read only', async (tx) => {
        const jobsBefore = (await tx`select count(*)::int as n from jobs where id = ${workItemId}`) as Array<{ n: number }>;
        // Concurrent mirror insert from a DIFFERENT connection (the outer `sql`, not `tx`) — exactly
        // what dispatchTask's graph-mirror dual-write does between the two queries in production.
        await sql`insert into tasks (id, title, status) values (${workItemId}, ${workItemId}, 'open') on conflict (id) do nothing`;
        await sql`insert into jobs (id, task_id, repo_id, title, status) values (${workItemId}, ${workItemId}, ${projectId}, 'snapshot test', 'pending')`;
        const legacyAfter = (await tx`
          select count(*)::int as n from work_items w where w.id = ${workItemId} and not exists (select 1 from jobs j where j.id = w.id)
        `) as Array<{ n: number }>;
        return { jobsSnapshotCount: jobsBefore[0]!.n, legacySnapshotCount: legacyAfter[0]!.n };
      });

      // Both reads inside the SAME transaction see the PRE-insert snapshot: the jobs query still
      // sees 0 (the concurrent insert isn't visible to this transaction), and the legacyOnly-style
      // query STILL counts the work item as legacy-only too — its own `not exists` check is frozen
      // to the same snapshot, so it doesn't see the just-inserted job either. Whichever way this
      // row is classified, both queries classify it the SAME way — nothing falls through a crack.
      expect(jobsSnapshotCount).toBe(0);
      expect(legacySnapshotCount).toBe(1);
    } finally {
      await sql`delete from jobs where id = ${workItemId}`;
    }
  });
});
