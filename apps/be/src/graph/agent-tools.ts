import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { SQL } from 'bun';
import { insertJob, insertDepTx, sealTaskSliceAndDerive, unsealTaskSlice, bumpJobGeneration, WriteAclError } from './store';
import { insertProposal, type NegotiationAsk } from './negotiation';
import { liveMemberOutcome } from './reconcile';
import type { DepTargetType } from './types';

/**
 * harness/job-graph.md "그래프 관리 배선" (2026-07-12 확정), decisions 1/2/3/4 — the ONLY way a
 * repo agent manages its own slice of the graph is through these MCP tools:
 *
 *   1. Every handler here IS the rule-1 write path — it reuses graph/store.ts (insertJob,
 *      insertDepTx, sealTaskSliceAndDerive, unsealTaskSlice, bumpJobGeneration) and
 *      graph/negotiation.ts (insertProposal), never touching the DB directly.
 *   2. `repoId`/`taskId` are NEVER a tool input — GraphToolContext binds them (the harness's job,
 *      not shown here: whichever repo's wake session this is). No input schema below has a repoId
 *      or taskId field, so an agent has no field to spoof even if it tried.
 *   3. No state-transition tool exists (no job_set_done/job_cancel/job_ready/…) — every WRITE tool
 *      here changes the graph's SHAPE only (add a job, declare/retract a dep, seal/unseal a slice,
 *      request from another repo), OR — job_rerun's own case — records a re-run REQUEST fact
 *      (job_events, via bumpJobGeneration) that a separate consumer applies later, never a status
 *      write of its own. done/failed only ever come from flow-execution results; ready only ever
 *      comes from reconcile; a job's pending/generation++ on re-run only ever comes from
 *      reconcile.ts's consumeOneEvent. graph_read (task#29, changes nothing) and job_rerun (only
 *      ever requests, never itself flips a status) are the two exceptions to "write tool" in that
 *      sentence — neither can violate decision 3 by construction.
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
export const JOB_RERUN_TOOL = 'job_rerun';
export const DEP_DECLARE_TOOL = 'dep_declare';
export const DEP_RETRACT_TOOL = 'dep_retract';
export const TASK_SEAL_TOOL = 'task_seal';
export const TASK_UNSEAL_TOOL = 'task_unseal';
export const A2A_REQUEST_TOOL = 'a2a_request';
export const GRAPH_READ_TOOL = 'graph_read';

/** Fully-qualified tool names an agent must be allow-listed for (mirrors triage/*.tool.ts's own *_FQN convention). */
export const JOB_ADD_TOOL_FQN = `mcp__${GRAPH_MCP_SERVER}__${JOB_ADD_TOOL}`;
export const JOB_RERUN_TOOL_FQN = `mcp__${GRAPH_MCP_SERVER}__${JOB_RERUN_TOOL}`;
export const DEP_DECLARE_TOOL_FQN = `mcp__${GRAPH_MCP_SERVER}__${DEP_DECLARE_TOOL}`;
export const DEP_RETRACT_TOOL_FQN = `mcp__${GRAPH_MCP_SERVER}__${DEP_RETRACT_TOOL}`;
export const TASK_SEAL_TOOL_FQN = `mcp__${GRAPH_MCP_SERVER}__${TASK_SEAL_TOOL}`;
export const TASK_UNSEAL_TOOL_FQN = `mcp__${GRAPH_MCP_SERVER}__${TASK_UNSEAL_TOOL}`;
export const A2A_REQUEST_TOOL_FQN = `mcp__${GRAPH_MCP_SERVER}__${A2A_REQUEST_TOOL}`;
export const GRAPH_READ_TOOL_FQN = `mcp__${GRAPH_MCP_SERVER}__${GRAPH_READ_TOOL}`;

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
 * job_rerun(jobId) — requests a same-job re-run: bumps generation on one of THIS session's OWN
 * terminal jobs (done/failed/cancelled) so it runs again from pending, instead of the agent
 * fabricating a brand-new job for the same work. Reuses bumpJobGeneration (graph/store.ts)
 * verbatim, ctx-bound exactly like every other tool here — `jobId` is the only input, `repo_id`
 * is never on the wire (decision 2), so ACL is enforced by bumpJobGeneration itself comparing
 * ctx.actorRepoId against the job's OWN repo_id, not by anything this handler asserts. Every guard
 * (WriteAclError, TerminalTaskError, NotRerunnableError, JobNotFoundError) already lives in that
 * one function; this is only the MCP wrapper, same shape as job_add above.
 *
 * Decision 3 ("no state-transition tool") is NOT violated despite the name reading like a
 * transition: bumpJobGeneration does not flip jobs.status at all (단일 기록자 통합 Phase 2 — see its
 * own docstring in store.ts) — it only inserts a `rerun_requested` job_events fact, a REQUEST, the
 * same shape as a job's own succeeded/failed facts from flow execution. The actual
 * terminal->pending, generation+1 write happens later and elsewhere, in graph/reconcile.ts's
 * consumeOneEvent, under its own rule-9 revalidation lock — the SAME single consumer every other
 * status-changing fact in this codebase already funnels through ("상태전이는 reconcile만" stays
 * true). So okResult below reports `requested: true`, never `rerunning`/`pending` — the request
 * was accepted, not yet applied.
 *
 * job-graph.md rule 4 hands a stalled/failed job's disposition TO the agent ("명시 취소/gen++/신규
 * 잡 중 택1") — job_add already covers "신규 잡"; this tool is the missing gen++ half. Before this
 * tool, that judgment had no way to reach the DB at all (0 production call sites), so a failed job
 * stayed failed forever.
 */
function buildJobRerunTool(ctx: GraphToolContext): GraphToolDef {
  return tool(
    JOB_RERUN_TOOL,
    '네 레포의 terminal 잡(done/failed/cancelled)을 제자리에서 재실행 요청한다(세대(generation) 증가). ' +
      '실패한 잡을 다시 시도하거나 완료된 잡을 새 접근으로 다시 돌리고 싶을 때 호출하라 — 새 잡을 만들지 ' +
      '말고 이걸 써라(재실행은 새 잡이 아니라 같은 잡의 다음 세대다). graph_read로 실제 잡 ID와 상태를 ' +
      '먼저 확인하라. 네 레포 소유 잡만 재실행할 수 있다.',
    { jobId: z.string() },
    async (args) => {
      try {
        await bumpJobGeneration(ctx.sql, ctx.actorRepoId, args.jobId);
        return okResult({ jobId: args.jobId, requested: true });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}

/**
 * dep_declare(waiterJobId, targetType, targetId, predicate?, acceptable?, expectedGen?) —
 * declares a wait-edge: `waiterJobId` waits on (job|task|external) `targetId`. All guards now live
 * in insertDepTx itself (D-round task #11/#21 — a single `for update` lock+validate instead of this
 * handler's own separate pre-check + insertDepTx's cycle check):
 *   - `waiterJobId` must be one of ctx.actorRepoId's OWN jobs (`expectWaiterRepoId`) — an agent may
 *     only make ITS OWN jobs wait on something, never someone else's. Target need not be its own.
 *   - the waiter must currently be pending/blocked (WaiterNotWaitingError otherwise — already
 *     claimed running by reconcile, or already terminal, means a dep now would never be evaluated).
 *   - a job target must actually exist (DepTargetNotFoundError otherwise).
 *   - the edge must not close a wait cycle (rule 7, DepCycleError otherwise).
 */
function buildDepDeclareTool(ctx: GraphToolContext): GraphToolDef {
  return tool(
    DEP_DECLARE_TOOL,
    '네 소유 잡 하나가 다른 잡/태스크/외부 게이트가 끝나기를 기다리게 만든다(대기 간선 선언). 대상은 ' +
      '네 것이 아니어도 되지만, 기다리는 쪽(waiterJobId)은 반드시 네 레포의 pending/blocked 잡이어야 ' +
      '한다(이미 실행 중이거나 끝난 잡엔 못 검). 순환이 생기면 거절된다.',
    {
      waiterJobId: z.string(),
      targetType: z.enum(DEP_TARGET_TYPES),
      targetId: z.string(),
      predicate: z.enum(DEP_PREDICATES).optional(),
      acceptable: z.array(z.enum(DEP_OUTCOMES)).optional(),
      expectedGen: z.number().int().optional(),
    },
    async (args) => {
      try {
        const depId = ctx.newId();
        await ctx.sql.begin((tx) =>
          insertDepTx(tx, {
            id: depId,
            waiterJobId: args.waiterJobId,
            targetType: args.targetType,
            targetId: args.targetId,
            predicate: args.predicate,
            acceptable: args.acceptable,
            expectedGen: args.expectedGen,
            expectWaiterRepoId: ctx.actorRepoId,
          }),
        );
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
 * graph_read() — the ONE read tool in this module (task#29, live discovery: a wake session's other
 * six tools are all writes, so an agent had no way to learn an existing job's real id and resorted
 * to brute-force guessing it before calling dep_declare/dep_retract). Scoped to ctx.taskId, same as
 * every write tool here, but NOT scoped to ctx.actorRepoId the way writes are — an agent needs to
 * see the WHOLE task's graph (every repo's jobs) to make a sound dep_declare/dep_retract call,
 * since a dep's target need not be its own repo's job (buildDepDeclareTool's own docstring: "대상은
 * 네 것이 아니어도 되지만"). Each returned job carries `mine` (repoId === ctx.actorRepoId) precisely
 * so the agent can tell which jobs it's allowed to act on (job_add/dep_declare's waiter) from which
 * it can only read.
 *
 * Read-only — decision 3 ("no state-transition tool") governs tools that change status; this
 * changes nothing at all, so it isn't a decision-3 violation by construction, not by exception.
 * deps are the ones whose waiter is one of THIS task's jobs (mirrors load-task-graph.ts's own
 * join, scoped down to one task instead of the whole graph), grouped with their dep_members.
 *
 * 3자 리뷰 메타리뷰 N2: each member's `outcome` is NOT read off dep_members.outcome — that column is
 * a dead persisted field (never UPDATEd anywhere in src; reconcile.ts only ever persists deps.status,
 * see reconcile.ts's liveMemberOutcome docstring), so a released dep would otherwise show its own
 * members as permanently 'pending' — self-contradictory to an agent reading it. Instead this reuses
 * reconcile.ts's own liveMemberOutcome per member (no second implementation of rule 5/6). The dead
 * column itself is left alone (out of scope) — this only stops trusting it.
 *
 * 3자 리뷰 메타리뷰 N7: also surfaces `taskStatus` (tasks.status) and `seals` (every task_seals row
 * for this task, task-wide like `jobs` — not just ctx.actorRepoId's own) so an agent can check
 * whether a slice (its own or another repo's) is already sealed BEFORE calling job_add/task_seal,
 * instead of only ever discovering a seal via that write's own rejection.
 */
function buildGraphReadTool(ctx: GraphToolContext): GraphToolDef {
  return tool(
    GRAPH_READ_TOOL,
    '이번 태스크의 현재 그래프(잡·의존)를 조회한다. dep를 걸거나 철회하기 전에 이걸로 실제 잡 ID와 ' +
      '상태를 확인하라. mine=true인 잡만 네가 바꿀 수 있다(다른 잡은 볼 수만). job_add/task_seal을 ' +
      '호출하기 전에 seals와 taskStatus로 네(또는 다른 레포의) 슬라이스가 이미 봉인됐는지부터 확인하라.',
    {},
    async () => {
      try {
        const jobRows = (await ctx.sql`
          select id, repo_id, title, status, generation from jobs where task_id = ${ctx.taskId} order by created_at
        `) as Array<{ id: string; repo_id: string; title: string; status: string; generation: number }>;
        const jobs = jobRows.map((j) => ({
          id: j.id,
          repoId: j.repo_id,
          title: j.title,
          status: j.status,
          generation: j.generation,
          mine: j.repo_id === ctx.actorRepoId,
        }));

        const depRows = (await ctx.sql`
          select d.id, d.waiter_job, d.predicate, d.status, dm.target_type, dm.target_id, dm.acceptable
          from deps d
          join dep_members dm on dm.dep_id = d.id
          where d.waiter_job in (select id from jobs where task_id = ${ctx.taskId})
          order by d.id
        `) as Array<{
          id: string;
          waiter_job: string;
          predicate: string;
          status: string;
          target_type: string;
          target_id: string;
          acceptable: string[];
        }>;

        const depsById = new Map<
          string,
          { id: string; waiterJobId: string; predicate: string; status: string; members: Array<{ targetType: string; targetId: string; outcome: string; acceptable: string[] }> }
        >();
        for (const row of depRows) {
          let dep = depsById.get(row.id);
          if (!dep) {
            dep = { id: row.id, waiterJobId: row.waiter_job, predicate: row.predicate, status: row.status, members: [] };
            depsById.set(row.id, dep);
          }
          const { outcome } = await liveMemberOutcome(ctx.sql, {
            target_type: row.target_type as DepTargetType,
            target_id: row.target_id,
          });
          dep.members.push({ targetType: row.target_type, targetId: row.target_id, outcome, acceptable: row.acceptable });
        }

        const taskRows = (await ctx.sql`select status from tasks where id = ${ctx.taskId}`) as Array<{ status: string }>;
        const taskStatus = taskRows[0]?.status ?? null;

        const sealRows = (await ctx.sql`
          select repo_id, sealed_at from task_seals where task_id = ${ctx.taskId} order by sealed_at
        `) as Array<{ repo_id: string; sealed_at: Date }>;
        const seals = sealRows.map((s) => ({ repoId: s.repo_id, sealedAt: s.sealed_at }));

        return okResult({ taskId: ctx.taskId, jobs, deps: [...depsById.values()], taskStatus, seals });
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
      expectedGen: z.number().int().optional(),
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
 * — repoId/taskId live in ctx, never in a tool's input schema). Deliberately eight tools, no more:
 * graph_read (the one read tool — task#29) plus job_add, job_rerun, dep_declare, dep_retract,
 * task_seal, task_unseal, a2a_request (the six shape-only writes, plus job_rerun's request-only
 * write — see its own docstring for why that doesn't reopen decision 3). NO state-transition tool
 * (decision 3) — grep this list for job_set_done/job_cancel/job_ready and you will not find them.
 * graph_read is listed first so an agent's tool-choice reasoning sees "look before you leap" as
 * the natural order.
 */
export function buildGraphTools(ctx: GraphToolContext): GraphToolDef[] {
  return [
    buildGraphReadTool(ctx),
    buildJobAddTool(ctx),
    buildJobRerunTool(ctx),
    buildDepDeclareTool(ctx),
    buildDepRetractTool(ctx),
    buildTaskSealTool(ctx),
    buildTaskUnsealTool(ctx),
    buildA2aRequestTool(ctx),
  ];
}
