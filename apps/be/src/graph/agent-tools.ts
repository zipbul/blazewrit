import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { SQL } from 'bun';
import { insertJob, insertDepTx, sealTaskSliceAndDerive, unsealTaskSlice, JobNotFoundError, WriteAclError } from './store';
import { insertProposal, type NegotiationAsk } from './negotiation';

/**
 * harness/job-graph.md "그래프 관리 배선" (2026-07-12 확정), decisions 1/2/3/4 — the ONLY way a
 * repo agent manages its own slice of the graph is through these MCP tools:
 *
 *   1. Every handler here IS the rule-1 write path — it reuses graph/store.ts (insertJob,
 *      insertDepTx, sealTaskSliceAndDerive, unsealTaskSlice) and graph/negotiation.ts
 *      (insertProposal), never touching the DB directly.
 *   2. `repoId`/`taskId` are NEVER a tool input — GraphToolContext binds them (the harness's job,
 *      not shown here: whichever repo's wake session this is). No input schema below has a repoId
 *      or taskId field, so an agent has no field to spoof even if it tried.
 *   3. No state-transition tool exists (no job_set_done/job_cancel/job_ready/…) — every tool here
 *      changes the graph's SHAPE only (add a job, declare/retract a dep, seal/unseal a slice,
 *      request from another repo). done/failed only ever come from flow-execution results;
 *      ready only ever comes from reconcile.
 *   4. (Not this module's concern — wiring these into a live wake session's `options.mcpServers`
 *      is P4-2.)
 */
export interface GraphToolContext {
  sql: SQL;
  actorRepoId: string;
  taskId: string;
  newId: () => string;
}

/**
 * NOTE deliberately an `interface extends`, not `type GraphToolDef = SdkMcpToolDefinition<any>` —
 * empirically, the plain type-alias form makes tsc reject every concrete `SdkMcpToolDefinition<
 * SomeShape>` as "not assignable" to it (a real quirk of how this SDK's `InferShape<Schema>`
 * mapped type resolves when `Schema` is spelled through an alias vs. referenced live at the
 * generic's own definition site) — the interface form doesn't hit it. Verified with a scratch
 * repro before landing this; see agent-tools.spec.ts for the tools this actually has to type-check
 * against.
 */
export interface GraphToolDef extends SdkMcpToolDefinition<any> {}

export const GRAPH_MCP_SERVER = 'bw_graph';

export const JOB_ADD_TOOL = 'job_add';
export const DEP_DECLARE_TOOL = 'dep_declare';
export const DEP_RETRACT_TOOL = 'dep_retract';
export const TASK_SEAL_TOOL = 'task_seal';
export const TASK_UNSEAL_TOOL = 'task_unseal';
export const A2A_REQUEST_TOOL = 'a2a_request';

/** Fully-qualified tool names an agent must be allow-listed for (mirrors triage/*.tool.ts's own *_FQN convention). */
export const JOB_ADD_TOOL_FQN = `mcp__${GRAPH_MCP_SERVER}__${JOB_ADD_TOOL}`;
export const DEP_DECLARE_TOOL_FQN = `mcp__${GRAPH_MCP_SERVER}__${DEP_DECLARE_TOOL}`;
export const DEP_RETRACT_TOOL_FQN = `mcp__${GRAPH_MCP_SERVER}__${DEP_RETRACT_TOOL}`;
export const TASK_SEAL_TOOL_FQN = `mcp__${GRAPH_MCP_SERVER}__${TASK_SEAL_TOOL}`;
export const TASK_UNSEAL_TOOL_FQN = `mcp__${GRAPH_MCP_SERVER}__${TASK_UNSEAL_TOOL}`;
export const A2A_REQUEST_TOOL_FQN = `mcp__${GRAPH_MCP_SERVER}__${A2A_REQUEST_TOOL}`;

const DEP_TARGET_TYPES = ['job', 'task', 'external'] as const;
const DEP_PREDICATES = ['all', 'any'] as const;
const DEP_OUTCOMES = ['pending', 'satisfied', 'failed', 'cancelled'] as const;

function okResult(payload: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
}

/** Every handler below funnels its catch through this — the agent needs the rejection reason (which rule fired), not a crash. */
function errorResult(err: unknown) {
  const message = err instanceof Error ? `${err.constructor.name}: ${err.message}` : String(err);
  return { content: [{ type: 'text' as const, text: message }], isError: true as const };
}

/**
 * job_add(title, description?) — adds a job under THIS session's task/repo (ctx.taskId,
 * ctx.actorRepoId). Reuses insertJob (graph/store.ts), which itself enforces rule 1 (write ACL —
 * moot here since repoId is always ctx.actorRepoId, never agent input), rule 2 (slice
 * insert-freeze) and rule 9 (terminal task immutable).
 *
 * Exported (unlike the other five builders below) with its return type left to inference rather
 * than widened to GraphToolDef — agent-tools.spec.ts calls it directly so TS still sees the EXACT
 * `{ title, description }` handler-arg shape, and an object literal with an extra `repoId` field
 * passed to `.handler(...)` is then a genuine excess-property compile error (decision 2's "타입으로
 * 확인" — see that test's `@ts-expect-error`).
 */
export function buildJobAddTool(ctx: GraphToolContext) {
  return tool(
    JOB_ADD_TOOL,
    '네 레포의 이번 태스크 슬라이스에 새 잡을 추가한다. 분해(하나의 일을 여러 잡으로 쪼갬)나 뒤늦게 ' +
      '발견한 후속 작업이 있을 때 호출하라. 잡은 항상 pending으로 생성된다 — 상태 전이는 이 툴의 몫이 아니다.',
    { title: z.string(), description: z.string().optional() },
    async (args) => {
      try {
        const jobId = ctx.newId();
        await insertJob(ctx.sql, ctx.actorRepoId, {
          id: jobId,
          taskId: ctx.taskId,
          repoId: ctx.actorRepoId,
          title: args.title,
          description: args.description,
        });
        return okResult({ jobId });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}

/**
 * dep_declare(waiterJobId, targetType, targetId, predicate?, acceptable?) — declares a wait-edge:
 * `waiterJobId` waits on (job|task|external) `targetId`. Two guards, in order:
 *   1. ACL (this handler's own, NOT insertDepTx's): `waiterJobId` must be one of ctx.actorRepoId's
 *      OWN jobs — an agent may only make ITS OWN jobs wait on something, never someone else's
 *      (locked `for update` in the same transaction as the insert, so the check and the write see
 *      the same row).
 *   2. Cycle check (rule 7, via insertDepTx -> loadTaskGraph + wouldCreateCycle): rejected with
 *      DepCycleError if the edge would close a wait cycle.
 */
function buildDepDeclareTool(ctx: GraphToolContext): GraphToolDef {
  return tool(
    DEP_DECLARE_TOOL,
    '네 소유 잡 하나가 다른 잡/태스크/외부 게이트가 끝나기를 기다리게 만든다(대기 간선 선언). 대상은 ' +
      '네 것이 아니어도 되지만, 기다리는 쪽(waiterJobId)은 반드시 네 레포의 잡이어야 한다. 순환이 생기면 거절된다.',
    {
      waiterJobId: z.string(),
      targetType: z.enum(DEP_TARGET_TYPES),
      targetId: z.string(),
      predicate: z.enum(DEP_PREDICATES).optional(),
      acceptable: z.array(z.enum(DEP_OUTCOMES)).optional(),
    },
    async (args) => {
      try {
        const depId = ctx.newId();
        await ctx.sql.begin(async (tx) => {
          const jobRows = (await tx`select repo_id from jobs where id = ${args.waiterJobId} for update`) as Array<{ repo_id: string }>;
          const job = jobRows[0];
          if (!job) throw new JobNotFoundError(`job ${args.waiterJobId} not found`);
          if (job.repo_id !== ctx.actorRepoId) {
            throw new WriteAclError(`actor ${ctx.actorRepoId} cannot declare a dep for job ${args.waiterJobId} owned by repo ${job.repo_id}`);
          }
          await insertDepTx(tx, {
            id: depId,
            waiterJobId: args.waiterJobId,
            targetType: args.targetType,
            targetId: args.targetId,
            predicate: args.predicate,
            acceptable: args.acceptable,
          });
        });
        return okResult({ depId });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}

/**
 * dep_retract(depId) — withdraws a previously declared dep (deletes deps + dep_members). ACL: only
 * the dep's OWN waiter's repo (ctx.actorRepoId) may retract it. Deletion, not a status flip, so
 * rule 11's release-latch is untouched (a released dep can still be retracted — its row is simply
 * gone, there's no "released" state left to un-latch). reconcile picks up the removal on its next
 * pass; no direct effect on job readiness is computed here.
 */
function buildDepRetractTool(ctx: GraphToolContext): GraphToolDef {
  return tool(
    DEP_RETRACT_TOOL,
    '네가 선언한 대기 간선을 철회한다(그 dep의 waiter가 네 레포의 잡일 때만). 더 이상 유효하지 않은 ' +
      '의존을 정리할 때 호출하라 — 준비 여부 재평가는 다음 reconcile 틱이 알아서 한다.',
    { depId: z.string() },
    async (args) => {
      try {
        await ctx.sql.begin(async (tx) => {
          const rows = (await tx`
            select j.repo_id from deps d join jobs j on j.id = d.waiter_job where d.id = ${args.depId} for update
          `) as Array<{ repo_id: string }>;
          const row = rows[0];
          if (!row || row.repo_id !== ctx.actorRepoId) {
            throw new WriteAclError(`actor ${ctx.actorRepoId} cannot retract dep ${args.depId}`);
          }
          await tx`delete from dep_members where dep_id = ${args.depId}`;
          await tx`delete from deps where id = ${args.depId}`;
        });
        return okResult({ retracted: true });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}

/**
 * task_seal() — seals THIS session's repo's own slice of THIS session's task (ctx.actorRepoId,
 * ctx.taskId — never anyone else's). Reuses sealTaskSliceAndDerive (graph/store.ts): inserts the
 * task_seals row AND recomputes task.status in the same transaction (rule 3's atomicity). Returns
 * the derived status so the agent can see immediately whether sealing just finished the task.
 */
function buildTaskSealTool(ctx: GraphToolContext): GraphToolDef {
  return tool(
    TASK_SEAL_TOOL,
    '이번 태스크에서 네 레포가 할 일이 끝났음을 선언한다(자기 슬라이스 seal). Seal한 뒤에는 네 레포가 ' +
      '이 태스크에 새 잡을 더 이상 추가할 수 없다 — 다시 열려면 task_unseal을 호출하라.',
    {},
    async () => {
      try {
        const taskStatus = await sealTaskSliceAndDerive(ctx.sql, ctx.actorRepoId, { taskId: ctx.taskId, repoId: ctx.actorRepoId });
        return okResult({ taskStatus });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}

/** task_unseal() — reopens THIS session's repo's own slice (deletes its own task_seals row). Reuses unsealTaskSlice (graph/store.ts). */
function buildTaskUnsealTool(ctx: GraphToolContext): GraphToolDef {
  return tool(
    TASK_UNSEAL_TOOL,
    '방금 seal한 네 슬라이스를 다시 연다(자기 것만) — seal이 너무 일렀거나 새 잡을 더 추가해야 할 때 호출하라.',
    {},
    async () => {
      try {
        await unsealTaskSlice(ctx.sql, ctx.actorRepoId, { taskId: ctx.taskId, repoId: ctx.actorRepoId });
        return okResult({ unsealed: true });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}

/**
 * a2a_request(toRepo, ask) — issues a P3 negotiation request to another repo, internally (a direct
 * DB write via insertProposal, graph/negotiation.ts — not a real network round-trip through our
 * own /a2a endpoint; that HTTP hop is what a genuinely cross-process repo would need, not what an
 * in-process wake session needs). `ask.taskId` is forced to ctx.taskId — the input schema has no
 * taskId field, so the agent can only ever request against ITS OWN wake session's task. fromRepo
 * is ctx.actorRepoId (bound, not asserted). Never materializes by itself — the OTHER repo's own
 * wake session must call the (not-yet-built, P4-2+) accept path.
 */
function buildA2aRequestTool(ctx: GraphToolContext): GraphToolDef {
  const askJobShape = z.object({ title: z.string(), description: z.string().optional(), repoId: z.string().optional() }).optional();
  const askDepShape = z
    .object({
      waiterJobId: z.string(),
      targetType: z.enum(DEP_TARGET_TYPES),
      targetId: z.string(),
      predicate: z.enum(DEP_PREDICATES).optional(),
      acceptable: z.array(z.enum(DEP_OUTCOMES)).optional(),
    })
    .optional();
  const askGateShape = z.object({ kind: z.string(), description: z.string().optional() }).optional();

  return tool(
    A2A_REQUEST_TOOL,
    '다른 레포에게 이번 태스크에 잡/dep/게이트를 추가해달라고 요청한다(협상 request). 상대가 accept해야 ' +
      '실제로 그래프에 반영된다 — 이 호출 자체는 아직 아무것도 만들지 않는다, 제안만 기록한다.',
    { toRepo: z.string(), ask: z.object({ job: askJobShape, dep: askDepShape, gate: askGateShape }) },
    async (args) => {
      try {
        const proposalId = ctx.newId();
        const ask: NegotiationAsk = { taskId: ctx.taskId, job: args.ask.job, dep: args.ask.dep, gate: args.ask.gate };
        await insertProposal(ctx.sql, { id: proposalId, taskId: ctx.taskId, fromRepo: ctx.actorRepoId, toRepo: args.toRepo, kind: 'request', ask });
        return okResult({ proposalId });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}

/**
 * The full P4 graph toolset for one wake session, bound to `ctx` (harness/job-graph.md decision 2
 * — repoId/taskId live in ctx, never in a tool's input schema). Deliberately six tools, no more:
 * job_add, dep_declare, dep_retract, task_seal, task_unseal, a2a_request. NO state-transition tool
 * (decision 3) — grep this list for job_set_done/job_cancel/job_ready and you will not find them.
 */
export function buildGraphTools(ctx: GraphToolContext): GraphToolDef[] {
  return [
    buildJobAddTool(ctx),
    buildDepDeclareTool(ctx),
    buildDepRetractTool(ctx),
    buildTaskSealTool(ctx),
    buildTaskUnsealTool(ctx),
    buildA2aRequestTool(ctx),
  ];
}
