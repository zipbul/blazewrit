import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';
import { SQL } from 'bun';
import { createRestApi, resolveRepoCwd } from './rest';
import { ensureSchema } from '../infra/schema';
import type { StepExecutor } from '../orchestrator/types';

/**
 * Characterizes dispatchTask's executor-cwd wiring — the one real-code gap harness/job-graph.md
 * calls out ("실행기 cwd가 현재 프로세스당 고정 → dispatch 시 repos.cwd로 레포별 cwd 해석 배선
 * 필요"). Live PG, same MARK/newId/sendA2A/waitFor conventions as dispatch-task.characterization
 * .spec.ts — duplicated rather than imported, since that file is a separate frozen baseline.
 */

const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const MARK = `execcwd-${process.pid}-${Date.now()}`;

let idSeq = 0;
const newId = () => `${MARK}-${idSeq++}`;

const passingExecutor: StepExecutor = {
  produce: async () => ({ output: 'out' }),
  review: async () => ({ verdict: 'pass' }),
};

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

async function getWorkItem(id: string): Promise<Record<string, unknown> | undefined> {
  const rows = (await sql`select * from work_items where id = ${id}`) as Array<Record<string, unknown>>;
  return rows[0];
}

beforeAll(async () => {
  await ensureSchema(sql);
});

afterAll(async () => {
  await sql`delete from jobs where id like ${MARK + '%'}`;
  await sql`delete from tasks where id like ${MARK + '%'}`;
  await sql`delete from repos where id like ${MARK + '%'}`;
  await sql`delete from step_runs where flow_id like ${MARK + '%'}`;
  await sql`delete from flows where id like ${MARK + '%'}`;
  await sql`delete from work_items where id like ${MARK + '%'}`;
  await sql`delete from projects where id like ${MARK + '%'}`;
  await sql.end();
});

describe('dispatchTask — executor cwd resolution (executorFor wins, bound to repos.cwd)', () => {
  it("resolves the executor with the project's own repos.cwd when executorFor is injected", async () => {
    const projectId = `${MARK}-custom-proj`;
    const customCwd = `/tmp/${MARK}-custom-cwd`;
    await sql`insert into projects (id, name, status) values (${projectId}, ${projectId}, 'active')`;
    // Pre-seeded so dispatchTask's own repos dual-write (on conflict do nothing) can't clobber it.
    await sql`insert into repos (id, product_id, name, cwd) values (${projectId}, 'legacy', ${projectId}, ${customCwd})`;

    const seenCwds: string[] = [];
    const executorFor = (cwd: string): StepExecutor => {
      seenCwds.push(cwd);
      return passingExecutor;
    };
    const app = createRestApi(sql, { executorFor, newId });

    const text = `${MARK} custom cwd chore`;
    const res = await sendA2A(app, projectId, text, { metadata: { flowType: 'chore' } });
    const { id: workItemId } = ((await res.json()) as { result: { id: string } }).result;

    await waitFor(async () => {
      const row = await getWorkItem(workItemId);
      return row?.state === 'done' ? row : undefined;
    });

    expect(seenCwds).toEqual([customCwd]);
  });

  it('falls back to deps.executor when executorFor is absent (priority order preserved)', async () => {
    const projectId = `${MARK}-plain-proj`;
    await sql`insert into projects (id, name, status) values (${projectId}, ${projectId}, 'active')`;

    const produce = mock(async () => ({ output: 'out' }));
    const review = mock(async () => ({ verdict: 'pass' as const }));
    const app = createRestApi(sql, { executor: { produce, review }, newId });

    const text = `${MARK} no executorFor chore`;
    const res = await sendA2A(app, projectId, text, { metadata: { flowType: 'chore' } });
    const { id: workItemId } = ((await res.json()) as { result: { id: string } }).result;

    await waitFor(async () => {
      const row = await getWorkItem(workItemId);
      return row?.state === 'done' ? row : undefined;
    });

    expect(produce).toHaveBeenCalled();
  });

  it('still resolves cwd through executorFor on the graph-write-failure fallback path (direct executeJobFlow call)', async () => {
    const projectId = `${MARK}-fallback-proj`;
    await sql`insert into projects (id, name, status) values (${projectId}, ${projectId}, 'active')`;
    const ctx = `${MARK}-fallback-ctx`;
    // Pre-seed the task as already terminal so insertJob's rule-9 check rejects this dispatch's
    // job insert — the same "graph mirror best-effort catch" scenario migration step 6's own
    // comment calls out ("a re-dispatch into an already-terminal task ctx").
    await sql`insert into tasks (id, title, status) values (${ctx}, ${ctx}, 'failed')`;

    const seenCwds: string[] = [];
    const executorFor = (cwd: string): StepExecutor => {
      seenCwds.push(cwd);
      return passingExecutor;
    };
    const app = createRestApi(sql, { executorFor, newId });

    const text = `${MARK} fallback path chore`;
    const res = await sendA2A(app, projectId, text, { metadata: { flowType: 'chore' }, contextId: ctx });
    const { id: workItemId } = ((await res.json()) as { result: { id: string } }).result;

    await waitFor(async () => {
      const row = await getWorkItem(workItemId);
      return row?.state === 'done' ? row : undefined;
    });

    // dispatchTask's own repos dual-write runs unconditionally, before the terminal-task
    // rejection — so by the time this dispatch falls back to executeJobFlow directly, a repos
    // row for `projectId` already exists (default cwd '.'). The fallback path's cwd resolution
    // reads that existing row, not a missing one — see the handoff report for why "no repos row
    // at all" isn't reachable via the live dispatch path.
    expect(seenCwds).toEqual(['.']);
  });
});

/**
 * 3자 리뷰 수정 B2-3 (minor 묶음): resolveRepoCwd used to catch EVERY error — including a genuine
 * SQL failure, not just "no repos row yet" — and silently fall back to '.'. That made a query
 * failure indistinguishable from an honest "not configured yet" signal, letting a job silently run
 * pinned to the wrong (process-default) directory instead of surfacing the failure. Only "no row"
 * is a real '.' signal now; a thrown query error propagates. No live Postgres needed here — a
 * trivial fake `sql` is enough to exercise resolveRepoCwd's own error-handling contract in isolation.
 */
describe('resolveRepoCwd — error handling (수정 B2-3)', () => {
  it('returns "." when no repos row exists for the id (real "not configured yet" signal)', async () => {
    const fakeSql = (async () => []) as unknown as SQL;
    const cwd = await resolveRepoCwd(fakeSql, 'some-repo');
    expect(cwd).toBe('.');
  });

  it('propagates a genuine SQL query failure instead of silently returning "."', async () => {
    const fakeSql = (async () => {
      throw new Error('connection reset');
    }) as unknown as SQL;
    await expect(resolveRepoCwd(fakeSql, 'some-repo')).rejects.toThrow('connection reset');
  });
});
