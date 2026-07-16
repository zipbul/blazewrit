import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { ensureSchema } from '../infra/schema';
import {
  buildGraphTools,
  buildJobAddTool,
  JOB_ADD_TOOL,
  DEP_DECLARE_TOOL,
  DEP_RETRACT_TOOL,
  TASK_SEAL_TOOL,
  TASK_UNSEAL_TOOL,
  A2A_REQUEST_TOOL,
  type GraphToolContext,
  type GraphToolDef,
} from './agent-tools';

/**
 * P4-1 (harness/job-graph.md "그래프 관리 배선", decisions 1-4): pure module test of the agent
 * tool HANDLERS — no live Agent SDK session (P4-2's job). Handlers are called directly with a raw
 * args object + a dummy `extra`, exactly the way triage's own *.tool.spec.ts files drive their
 * tools (show-table.tool.spec.ts: `await t.handler(view, {})`).
 */
const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const PREFIX = `agent-tools-${process.pid}-${Date.now()}`;
let n = 0;
const id = (label: string) => `${PREFIX}-${label}-${n++}`;

/** product → two repos (P, Q) → one open task — same minimum shape graph/store.spec.ts's own fixture uses. */
async function makeTwoRepoTask() {
  const productId = id('product');
  const taskId = id('task');
  const repoP = id('repo-p');
  const repoQ = id('repo-q');
  await sql`insert into products (id, name) values (${productId}, ${productId})`;
  await sql`insert into repos (id, product_id, name, cwd) values (${repoP}, ${productId}, ${repoP}, '/tmp')`;
  await sql`insert into repos (id, product_id, name, cwd) values (${repoQ}, ${productId}, ${repoQ}, '/tmp')`;
  await sql`insert into tasks (id, title, status) values (${taskId}, ${taskId}, 'open')`;
  return { productId, taskId, repoP, repoQ };
}

function ctxFor(taskId: string, actorRepoId: string): GraphToolContext {
  return { sql, actorRepoId, taskId, newId: () => id('gen') };
}

function toolByName(tools: GraphToolDef[], name: string): GraphToolDef {
  const found = tools.find((t) => t.name === name);
  if (!found) throw new Error(`tool ${name} not found in buildGraphTools() output`);
  return found;
}

/** Every handler in this module only ever returns a single text content block (agent-tools.ts's own okResult/errorResult) — narrowed here for the test's own convenience, not part of the SDK's general CallToolResult shape. */
interface ToolResult {
  content: [{ type: 'text'; text: string }];
  isError?: boolean;
}

/** Calls a tool by name with a raw args object, casting the SDK's general CallToolResult down to ToolResult. */
async function call(tools: GraphToolDef[], name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const res = await toolByName(tools, name).handler(args, {});
  return res as unknown as ToolResult;
}

function payload(res: ToolResult): Record<string, unknown> {
  return JSON.parse(res.content[0].text);
}

async function jobRepoId(jobId: string): Promise<string> {
  const rows = (await sql`select repo_id from jobs where id = ${jobId}`) as Array<{ repo_id: string }>;
  return rows[0]!.repo_id;
}

beforeAll(async () => {
  await ensureSchema(sql);
});

afterAll(async () => {
  // FK-reverse order.
  await sql`delete from a2a_proposals where task_id like ${PREFIX + '%'}`;
  await sql`delete from dep_members where dep_id like ${PREFIX + '%'}`;
  await sql`delete from deps where id like ${PREFIX + '%'}`;
  await sql`delete from jobs where task_id like ${PREFIX + '%'}`;
  await sql`delete from task_seals where task_id like ${PREFIX + '%'}`;
  await sql`delete from tasks where id like ${PREFIX + '%'}`;
  await sql`delete from repos where id like ${PREFIX + '%'}`;
  await sql`delete from products where id like ${PREFIX + '%'}`;
  await sql.end();
});

describe('buildGraphTools (harness/job-graph.md 그래프 관리 배선 decisions 1-4)', () => {
  test('exposes exactly the six shape-only tools and no state-transition tool (decision 3)', () => {
    const tools = buildGraphTools(ctxFor('irrelevant-task', 'irrelevant-repo'));
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([A2A_REQUEST_TOOL, DEP_DECLARE_TOOL, DEP_RETRACT_TOOL, JOB_ADD_TOOL, TASK_SEAL_TOOL, TASK_UNSEAL_TOOL].sort());
    for (const forbidden of ['job_set_done', 'job_set_failed', 'job_cancel', 'job_ready', 'task_set_done', 'task_cancel']) {
      expect(names).not.toContain(forbidden);
    }
  });

  test('job_add creates the job under ctx.actorRepoId, ignoring a spoofed repoId on the wire (decision 2, 타입+런타임)', async () => {
    const { taskId, repoP, repoQ } = await makeTwoRepoTask();
    const jobAdd = buildJobAddTool(ctxFor(taskId, repoP));
    // @ts-expect-error — repoId isn't part of job_add's input shape (just { title, description? }):
    // an object literal carrying it is an excess-property error at compile time. Left as a raw JS
    // object (not a typed variable) so bun:test's own transpile still exercises the runtime call.
    const res = (await jobAdd.handler({ title: 'x', repoId: repoQ }, {})) as unknown as ToolResult;
    expect(res.isError).toBeUndefined();
    const { jobId } = payload(res) as { jobId: string };
    expect(await jobRepoId(jobId)).toBe(repoP); // NOT repoQ — the spoof attempt is silently ignored
  });

  test('job_add rejects once the acting repo has already sealed its own slice of the task', async () => {
    const { taskId, repoP } = await makeTwoRepoTask();
    const tools = buildGraphTools(ctxFor(taskId, repoP));
    const sealRes = await call(tools, TASK_SEAL_TOOL, {});
    expect(sealRes.isError).toBeUndefined();
    const lateRes = await call(tools, JOB_ADD_TOOL, { title: 'late' });
    expect(lateRes.isError).toBe(true);
    expect(lateRes.content[0].text).toContain('SliceSealedError');
  });

  test('dep_declare creates a harmless dep and dep_retract removes it, both under the owning repo', async () => {
    const { taskId, repoP } = await makeTwoRepoTask();
    const tools = buildGraphTools(ctxFor(taskId, repoP));
    const { jobId: waiterJobId } = payload(await call(tools, JOB_ADD_TOOL, { title: 'waiter' })) as { jobId: string };
    const { jobId: targetJobId } = payload(await call(tools, JOB_ADD_TOOL, { title: 'target' })) as { jobId: string };

    const declareRes = await call(tools, DEP_DECLARE_TOOL, { waiterJobId, targetType: 'job', targetId: targetJobId });
    expect(declareRes.isError).toBeUndefined();
    const { depId } = payload(declareRes) as { depId: string };
    const rows1 = (await sql`select id from deps where id = ${depId}`) as Array<{ id: string }>;
    expect(rows1.length).toBe(1);

    const retractRes = await call(tools, DEP_RETRACT_TOOL, { depId });
    expect(retractRes.isError).toBeUndefined();
    const rows2 = (await sql`select id from deps where id = ${depId}`) as Array<{ id: string }>;
    expect(rows2.length).toBe(0);
  });

  test('dep_declare rejects a dep that would close a wait cycle (rule 7)', async () => {
    const { taskId, repoP } = await makeTwoRepoTask();
    const tools = buildGraphTools(ctxFor(taskId, repoP));
    const { jobId: jobA } = payload(await call(tools, JOB_ADD_TOOL, { title: 'a' })) as { jobId: string };
    const { jobId: jobB } = payload(await call(tools, JOB_ADD_TOOL, { title: 'b' })) as { jobId: string };

    // A waits on B — fine, no cycle yet.
    const first = await call(tools, DEP_DECLARE_TOOL, { waiterJobId: jobA, targetType: 'job', targetId: jobB });
    expect(first.isError).toBeUndefined();

    // B waits on A would close the cycle A -> B -> A.
    const second = await call(tools, DEP_DECLARE_TOOL, { waiterJobId: jobB, targetType: 'job', targetId: jobA });
    expect(second.isError).toBe(true);
    expect(second.content[0].text).toContain('DepCycleError');
  });

  test('D-round #11/#21: dep_declare rejects a waiter that is not pending/blocked (already running)', async () => {
    const { taskId, repoP } = await makeTwoRepoTask();
    const tools = buildGraphTools(ctxFor(taskId, repoP));
    const { jobId: waiterJobId } = payload(await call(tools, JOB_ADD_TOOL, { title: 'waiter' })) as { jobId: string };
    const { jobId: targetJobId } = payload(await call(tools, JOB_ADD_TOOL, { title: 'target' })) as { jobId: string };
    await sql`update jobs set status = 'running' where id = ${waiterJobId}`; // e.g. already claimed by reconcile

    const res = await call(tools, DEP_DECLARE_TOOL, { waiterJobId, targetType: 'job', targetId: targetJobId });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('WaiterNotWaitingError');
    const rows = (await sql`select id from deps where waiter_job = ${waiterJobId}`) as Array<{ id: string }>;
    expect(rows.length).toBe(0);
  });

  test('D-round #21: dep_declare rejects a job target that does not exist', async () => {
    const { taskId, repoP } = await makeTwoRepoTask();
    const tools = buildGraphTools(ctxFor(taskId, repoP));
    const { jobId: waiterJobId } = payload(await call(tools, JOB_ADD_TOOL, { title: 'waiter' })) as { jobId: string };

    const res = await call(tools, DEP_DECLARE_TOOL, { waiterJobId, targetType: 'job', targetId: id('nonexistent-target') });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('DepTargetNotFoundError');
  });

  test('D-round #21: dep_declare writes expectedGen through to dep_members.expected_gen', async () => {
    const { taskId, repoP } = await makeTwoRepoTask();
    const tools = buildGraphTools(ctxFor(taskId, repoP));
    const { jobId: waiterJobId } = payload(await call(tools, JOB_ADD_TOOL, { title: 'waiter' })) as { jobId: string };
    const { jobId: targetJobId } = payload(await call(tools, JOB_ADD_TOOL, { title: 'target' })) as { jobId: string };

    const res = await call(tools, DEP_DECLARE_TOOL, { waiterJobId, targetType: 'job', targetId: targetJobId, expectedGen: 1 });
    expect(res.isError).toBeUndefined();
    const { depId } = payload(res) as { depId: string };
    const rows = (await sql`select expected_gen from dep_members where dep_id = ${depId}`) as Array<{ expected_gen: number | null }>;
    expect(rows[0]?.expected_gen).toBe(1);
  });

  test('dep_declare rejects declaring a dep whose waiter job belongs to another repo', async () => {
    const { taskId, repoP, repoQ } = await makeTwoRepoTask();
    const toolsQ = buildGraphTools(ctxFor(taskId, repoQ));
    const { jobId: repoQJobId } = payload(await call(toolsQ, JOB_ADD_TOOL, { title: 'q-job' })) as { jobId: string };

    const toolsP = buildGraphTools(ctxFor(taskId, repoP));
    const { jobId: repoPJobId } = payload(await call(toolsP, JOB_ADD_TOOL, { title: 'p-target' })) as { jobId: string };

    // toolsP is bound to repoP, but the waiter (repoQJobId) belongs to repoQ.
    const res = await call(toolsP, DEP_DECLARE_TOOL, { waiterJobId: repoQJobId, targetType: 'job', targetId: repoPJobId });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('WriteAclError');
  });

  test('dep_retract rejects retracting a dep whose waiter belongs to another repo', async () => {
    const { taskId, repoP, repoQ } = await makeTwoRepoTask();
    const toolsP = buildGraphTools(ctxFor(taskId, repoP));
    const { jobId: waiterJobId } = payload(await call(toolsP, JOB_ADD_TOOL, { title: 'waiter' })) as { jobId: string };
    const { jobId: targetJobId } = payload(await call(toolsP, JOB_ADD_TOOL, { title: 'target' })) as { jobId: string };
    const { depId } = payload(await call(toolsP, DEP_DECLARE_TOOL, { waiterJobId, targetType: 'job', targetId: targetJobId })) as {
      depId: string;
    };

    const toolsQ = buildGraphTools(ctxFor(taskId, repoQ));
    const retractRes = await call(toolsQ, DEP_RETRACT_TOOL, { depId });
    expect(retractRes.isError).toBe(true);
    expect(retractRes.content[0].text).toContain('WriteAclError');
    const rows = (await sql`select id from deps where id = ${depId}`) as Array<{ id: string }>;
    expect(rows.length).toBe(1); // still there — repoQ's attempt did not touch repoP's dep
  });

  test("task_seal seals the acting repo's own slice and derives task status in the same call", async () => {
    const { taskId, repoP } = await makeTwoRepoTask();
    const tools = buildGraphTools(ctxFor(taskId, repoP));
    const { jobId } = payload(await call(tools, JOB_ADD_TOOL, { title: 'x' })) as { jobId: string };
    await sql`update jobs set status = 'done' where id = ${jobId}`;

    const sealRes = await call(tools, TASK_SEAL_TOOL, {});
    expect(sealRes.isError).toBeUndefined();
    expect(payload(sealRes)).toEqual({ taskStatus: 'done' });
    const rows = (await sql`select status from tasks where id = ${taskId}`) as Array<{ status: string }>;
    expect(rows[0]!.status).toBe('done');
  });

  test("task_unseal only ever reopens the acting repo's own slice — it has no way to name another repo's", async () => {
    const { taskId, repoP, repoQ } = await makeTwoRepoTask();
    const toolsP = buildGraphTools(ctxFor(taskId, repoP));
    const toolsQ = buildGraphTools(ctxFor(taskId, repoQ));
    // Still-pending jobs keep the task 'open' through both seals, so nothing here trips rule 9's
    // terminal-task guard.
    await call(toolsP, JOB_ADD_TOOL, { title: 'p-pending' });
    await call(toolsQ, JOB_ADD_TOOL, { title: 'q-pending' });
    await call(toolsP, TASK_SEAL_TOOL, {});
    await call(toolsQ, TASK_SEAL_TOOL, {});
    const sealedBefore = (await sql`select repo_id from task_seals where task_id = ${taskId}`) as Array<{ repo_id: string }>;
    expect(sealedBefore.map((r) => r.repo_id).sort()).toEqual([repoP, repoQ].sort());

    // task_unseal takes no input at all (decision 2) — a call bound to repoQ can only ever delete
    // repoQ's own task_seals row; repoP's stays sealed, untouched.
    const unsealRes = await call(toolsQ, TASK_UNSEAL_TOOL, {});
    expect(unsealRes.isError).toBeUndefined();
    const sealedAfter = (await sql`select repo_id from task_seals where task_id = ${taskId}`) as Array<{ repo_id: string }>;
    expect(sealedAfter.map((r) => r.repo_id)).toEqual([repoP]);

    // repoQ's slice is reopened — a new job insert now succeeds again (would SliceSealedError if still sealed).
    const reopened = await call(toolsQ, JOB_ADD_TOOL, { title: 'after-unseal' });
    expect(reopened.isError).toBeUndefined();
  });

  test('a2a_request records a proposed a2a_proposals row with fromRepo bound to ctx.actorRepoId', async () => {
    const { taskId, repoP, repoQ } = await makeTwoRepoTask();
    const tools = buildGraphTools(ctxFor(taskId, repoP));
    const res = await call(tools, A2A_REQUEST_TOOL, { toRepo: repoQ, ask: { job: { title: 'help me' } } });
    expect(res.isError).toBeUndefined();
    const { proposalId } = payload(res) as { proposalId: string };
    const rows = (await sql`select task_id, from_repo, to_repo, kind, status from a2a_proposals where id = ${proposalId}`) as Array<{
      task_id: string;
      from_repo: string;
      to_repo: string;
      kind: string;
      status: string;
    }>;
    expect(rows[0]).toMatchObject({ task_id: taskId, from_repo: repoP, to_repo: repoQ, kind: 'request', status: 'proposed' });
  });

  test('a2a_request rejects once the task is no longer open', async () => {
    const { taskId, repoP, repoQ } = await makeTwoRepoTask();
    await sql`update tasks set status = 'done' where id = ${taskId}`;
    const tools = buildGraphTools(ctxFor(taskId, repoP));
    const res = await call(tools, A2A_REQUEST_TOOL, { toRepo: repoQ, ask: { job: { title: 'help me' } } });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('TaskNotOpenError');
  });
});
