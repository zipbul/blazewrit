import { query, createSdkMcpServer, type Options, type PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import type { SQL } from 'bun';
import type { QueryFn } from '../orchestrator/infra/agent-step-executor'; // reused, not redefined
import { withMindset } from '../harness/mindset';
import {
  buildGraphTools,
  GRAPH_MCP_SERVER,
  JOB_ADD_TOOL_FQN,
  JOB_RERUN_TOOL_FQN,
  DEP_DECLARE_TOOL_FQN,
  DEP_RETRACT_TOOL_FQN,
  TASK_SEAL_TOOL_FQN,
  TASK_UNSEAL_TOOL_FQN,
  A2A_REQUEST_TOOL_FQN,
  GRAPH_READ_TOOL_FQN,
} from './agent-tools';

/** The full graph MCP toolset's fully-qualified names — the ONLY tools a wake session may call.
 * Includes JOB_RERUN_TOOL_FQN (재실행 트리거 배선, 티어1): job_rerun only ever records a re-run
 * REQUEST fact (job_events via bumpJobGeneration) — reconcile.ts's consumeOneEvent is still the
 * only place a job's status/generation actually changes, so allow-listing it here does not hand
 * this session any new state-transition power (decision 3 stays intact). Omitting an FQN here
 * would silently deny that tool under 'dontAsk' below even though buildGraphTools still builds it
 * (graph_read's own history — a tool exists but is unreachable from a live session without this). */
const GRAPH_TOOL_FQNS = [
  JOB_ADD_TOOL_FQN,
  JOB_RERUN_TOOL_FQN,
  DEP_DECLARE_TOOL_FQN,
  DEP_RETRACT_TOOL_FQN,
  TASK_SEAL_TOOL_FQN,
  TASK_UNSEAL_TOOL_FQN,
  A2A_REQUEST_TOOL_FQN,
  GRAPH_READ_TOOL_FQN,
];

/** WORKING-agent identity (harness/mindset.ts's constitution applies — a wake session reshapes
 * the graph exactly as consequentially as a step producer reshapes code, so it gets the same
 * six-principle system prompt, not a bare instruction). */
const IDENTITY =
  '너는 이 레포의 그래프 관리자다: 이번 태스크에서 네 레포 슬라이스의 잡/의존 모양만 관리한다 ' +
  '(잡 추가/분할/병합, 의존 선언/철회, 다른 레포에 요청) — 잡의 완료/실패/취소 같은 상태 전이는 ' +
  '절대 네가 정하지 않는다, 그건 하네스가 실행 결과로만 판단한다.';

export interface WakeSessionCtx {
  sql: SQL;
  /** Session-bound identity (harness/job-graph.md P4-2 배선 결정 2) — never agent input, mirrors
   * GraphToolContext.actorRepoId one-to-one (this session's own tools are bound to the same repo). */
  actorRepoId: string;
  /** The task this wake is about — this session's whole world is its OWN slice of this one task. */
  taskId: string;
  /** One-line reason this session was woken (stalled / stale dep / A2A inbound / etc.) — surfaced
   * verbatim in the prompt, never expanded into a 9-way classification (job-graph.md's own "얇은
   * 뉘앙스" spirit: the agent reasons about the reason, the harness doesn't pre-digest it). */
  reason: string;
  /** repos.cwd resolved value — the repo checkout this session's tools (and any file access the
   * model attempts, all of which is disallowed below) would run against. */
  cwd: string;
  newId: () => string;
  /** Defaults to the real SDK `query`; tests inject a fake (agent-step-executor.ts's own QueryFn). */
  queryFn?: QueryFn;
  permissionMode?: PermissionMode;
  maxTurns?: number;
}

/** The exact wake prompt (job-graph.md "에이전트 wake" spirit — thin nuance + the one-line reason,
 * never a 9-way classification spelled out here). Exported for spec assertions. */
export function buildWakePrompt(ctx: Pick<WakeSessionCtx, 'actorRepoId' | 'reason'>): string {
  return (
    `너는 레포 \`${ctx.actorRepoId}\` 에이전트다. 지금 이 태스크에서 네 슬라이스 그래프를 최고효율로 ` +
    `유연하게 관리하라 — 필요하면 잡을 추가/분할/병합/재정렬하고, 의존을 선언/철회하고, 다른 레포에 ` +
    `작업을 요청하라. 상태 전이(완료/실패/취소)는 네 소관이 아니다(하네스가 결과로 판단). 이번에 깨운 ` +
    `이유: ${ctx.reason}`
  );
}

/**
 * Runs one wake session: a live Agent SDK conversation with ONLY the graph-management MCP tools
 * (P4-1's buildGraphTools) wired in — the agent reshapes its own slice of one task's job/dep graph,
 * never touches WORK execution (that's makeJobFlow, rest.ts, an entirely separate session). This is
 * the executor only; nothing in this module decides WHEN a repo wakes (P4-2c) or what happens to the
 * human↔agent consumer split (also P4-2c) — those are deliberately out of scope here.
 *
 * Tool restriction (job-graph.md 그래프 관리 배선 decision 3's spirit extended to the SESSION
 * layer, not just the tool list): a wake session must never run arbitrary Bash or touch files —
 * `tools: []` removes every BUILT-IN tool (Bash/Read/Write/Edit/Grep/Glob/...) from what the model
 * is even offered, and `allowedTools` is narrowed to exactly the eight graph MCP tool FQNs (seven
 * writes — including job_rerun, 재실행 트리거 배선 티어1: request-only, see GRAPH_TOOL_FQNS's own
 * comment — + graph_read, task#29 — without graph_read here, 'dontAsk' below would deny even that
 * READ call, leaving an agent no way to see real job ids and forcing it to brute-force-guess dep
 * targets) so nothing else gets auto-approved either. `permissionMode` deliberately does NOT default to
 * 'bypassPermissions' despite that reading as the "obvious" unattended-session choice — this
 * codebase already learned that lesson the hard way (harness/step-agents.ts's own comment:
 * "allowedTools does NOT bind under bypassPermissions — observed live: ground ran Bash despite an
 * R0 grant"). 'dontAsk' ("deny anything not pre-approved, never prompt") is the same combination
 * triage-agent.ts already runs unattended in production with (mcpServers + allowedTools FQNs +
 * permissionMode: 'dontAsk') — the one restriction pattern actually verified to hold in this SDK
 * version, not just documented as intent.
 *
 * `settingSources: []` (SDK isolation mode — sdk.d.ts: "Pass [] to disable filesystem settings"):
 * a wake session is a PLATFORM agent that only reshapes the graph via its six MCP tools — it does
 * NO repo work (that's makeJobFlow/agent-step-executor, an entirely separate session), so it has
 * no need for the repo's CLAUDE.md and mirrors triage-agent.ts's own platform-agent isolation
 * (settingSources: []), NOT agent-step-executor.ts's ['project']. This is the CRITICAL part of the
 * "never runs arbitrary shell" guarantee holding at EVERY layer, not just the model/tool layer
 * (3자 리뷰 P4-2a, Codex): `['project']` would load the repo checkout's own `.claude/settings.json`,
 * whose `hooks` (SessionStart/PreToolUse command hooks) run shell on a path ENTIRELY separate from
 * tools/allowedTools/permissionMode — so tools:[]+dontAsk alone would NOT stop a malicious repo's
 * hook. `[]` loads no filesystem settings at all (no CLAUDE.md, no project hooks, no auto .mcp.json),
 * which also makes the operator's ~/.claude leak (the one agent-step-executor.ts:71 describes) moot
 * here by construction. Graph-shape decisions need only the reason + live graph state (via tools),
 * never repo code conventions.
 *
 * Self-contained (mirrors makeJobFlow, rest.ts): every failure — a non-success result subtype, or
 * the query iteration itself throwing — is caught and logged, never rethrown. The eventual P4-2c
 * caller runs this fire-and-forget (same contract as rest.ts's own registered/reconstructed job
 * execution), so a session that dies here must not crash whatever woke it.
 */
export async function runWakeSession(ctx: WakeSessionCtx): Promise<void> {
  const label = `wake session (task=${ctx.taskId}, repo=${ctx.actorRepoId})`;
  try {
    const tools = buildGraphTools({ sql: ctx.sql, actorRepoId: ctx.actorRepoId, taskId: ctx.taskId, newId: ctx.newId });
    const server = createSdkMcpServer({ name: GRAPH_MCP_SERVER, version: '1', tools });

    const options: Options = {
      cwd: ctx.cwd,
      mcpServers: { [GRAPH_MCP_SERVER]: server },
      settingSources: [], // isolation mode: no repo .claude/settings.json (hooks), no CLAUDE.md — platform agent, graph-only (see docstring)
      tools: [], // no built-in tools at all — graph MCP tools only, wired in below
      allowedTools: GRAPH_TOOL_FQNS,
      permissionMode: ctx.permissionMode ?? 'dontAsk',
      systemPrompt: withMindset(IDENTITY),
      maxTurns: ctx.maxTurns ?? 30,
    };

    const run = ctx.queryFn ?? (query as QueryFn);
    for await (const message of run({ prompt: buildWakePrompt(ctx), options })) {
      if (message.type === 'result') {
        if (message.subtype !== 'success') {
          console.error(`${label} ended without success: ${message.subtype}`);
        }
        return;
      }
    }
    console.error(`${label} produced no result`);
  } catch (err) {
    console.error(`${label} errored: ${String(err)}`);
  }
}
