import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { ensureSchema } from '../infra/schema';
import { runWakeSession, buildWakePrompt, type WakeSessionCtx } from './wake-session';
import {
  buildGraphTools,
  GRAPH_MCP_SERVER,
  JOB_ADD_TOOL,
  DEP_DECLARE_TOOL,
  DEP_RETRACT_TOOL,
  TASK_SEAL_TOOL,
  TASK_UNSEAL_TOOL,
  A2A_REQUEST_TOOL,
  GRAPH_READ_TOOL,
  JOB_ADD_TOOL_FQN,
  DEP_DECLARE_TOOL_FQN,
  DEP_RETRACT_TOOL_FQN,
  TASK_SEAL_TOOL_FQN,
  TASK_UNSEAL_TOOL_FQN,
  A2A_REQUEST_TOOL_FQN,
  GRAPH_READ_TOOL_FQN,
} from './agent-tools';
import type { QueryFn } from '../orchestrator/infra/agent-step-executor';

/**
 * P4-2a: runWakeSession is the THIN SDK wiring for a graph-management session — P4-1's
 * buildGraphTools handlers, injected into a live query() call. No trigger wiring, no human↔agent
 * consumer switch (that's P4-2c) — this file only characterizes the executor function itself, via
 * a fake queryFn (setting-isolation.spec.ts's own capturing pattern), never a live SDK call.
 */
const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const PREFIX = `wake-session-${process.pid}-${Date.now()}`;
let n = 0;
const id = (label: string) => `${PREFIX}-${label}-${n++}`;

function baseCtx(overrides: Partial<WakeSessionCtx> = {}): WakeSessionCtx {
  return {
    sql,
    actorRepoId: `${PREFIX}-repo`,
    taskId: `${PREFIX}-task`,
    reason: '태스크가 15분 넘게 정체되어 있습니다',
    cwd: '/tmp',
    newId: () => id('gen'),
    ...overrides,
  };
}

/** Captures every call's {prompt, options}, then yields a successful result — mirrors
 * setting-isolation.spec.ts's own `capturing` helper, generalized to also record the prompt. */
function capturingSuccess(captured: Array<{ prompt: string; options?: Options }>): QueryFn {
  return async function* (params) {
    captured.push(params);
    yield { type: 'result', subtype: 'success', result: 'ok', session_id: 's' } as never;
  };
}

/** A queryFn whose result stream ends in a non-success subtype (agent-step-executor.spec.ts's own
 * failure fixture shape). */
const failingQueryFn: QueryFn = async function* () {
  yield { type: 'result', subtype: 'error_during_execution', session_id: 's' } as never;
};

/** A queryFn that throws before ever yielding — a real transport/process crash mid-call.
 * `async function*` is an async generator by syntax alone, so no yield is needed for it to
 * satisfy QueryFn's AsyncIterable return type; it just throws on first iteration. */
const throwingQueryFn: QueryFn = async function* () {
  throw new Error('sdk transport exploded');
};

beforeAll(async () => {
  await ensureSchema(sql);
});

afterAll(async () => {
  await sql.end();
});

describe('runWakeSession (P4-2a)', () => {
  test('wires cwd, isolation-mode settingSources, the graph MCP server, and a prompt naming the repo+reason', async () => {
    const captured: Array<{ prompt: string; options?: Options }> = [];
    const ctx = baseCtx({ queryFn: capturingSuccess(captured), cwd: '/repo/checkout' });

    await runWakeSession(ctx);

    expect(captured).toHaveLength(1);
    const { prompt, options } = captured[0]!;
    expect(options?.cwd).toBe('/repo/checkout');
    // [] = SDK isolation mode: no repo .claude/settings.json (its hooks run shell independent of
    // tools/dontAsk — 3자 리뷰 P4-2a/Codex), no CLAUDE.md — a platform agent, not repo-work (triage parity).
    expect(options?.settingSources).toEqual([]);
    expect(options?.mcpServers?.[GRAPH_MCP_SERVER]).toBeDefined();
    expect(prompt).toContain(ctx.actorRepoId);
    expect(prompt).toContain(ctx.reason);
    expect(options?.maxTurns).toBe(30); // reasonable default (spec's own suggestion)
  });

  test('buildWakePrompt is the thin-nuance template — repo, freeform mandate, and the reason verbatim, no 9-way classification spelled out', () => {
    const prompt = buildWakePrompt({ actorRepoId: 'my-repo', reason: 'dep가 stale 상태입니다' });
    expect(prompt).toContain('레포 `my-repo` 에이전트');
    expect(prompt).toContain('이번에 깨운 이유: dep가 stale 상태입니다');
    // Not a classification dump — none of the wake KIND literals (graph/wake.ts) are enumerated here.
    for (const kind of ['stalled', 'unresolvable_task', 'stale_dep', 'lease_expired', 'orphaned_ready']) {
      expect(prompt).not.toContain(kind);
    }
  });

  test('the toolset has no state-transition tool (P4-1 decision 3, mirrored) — only shape-changing graph tools plus the read tool', () => {
    // Confirms the session's OWN toolset is exactly buildGraphTools' output, not a hand-rolled
    // alternative — agent-tools.spec.ts is the authority on decision 2/3's guarantees themselves.
    const tools = buildGraphTools({ sql, actorRepoId: 'irrelevant-repo', taskId: 'irrelevant-task', newId: () => id('gen') });
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [A2A_REQUEST_TOOL, DEP_DECLARE_TOOL, DEP_RETRACT_TOOL, GRAPH_READ_TOOL, JOB_ADD_TOOL, TASK_SEAL_TOOL, TASK_UNSEAL_TOOL].sort(),
    );
    for (const forbidden of ['job_set_done', 'job_set_failed', 'job_cancel', 'job_ready', 'task_set_done', 'task_cancel']) {
      expect(names).not.toContain(forbidden);
    }
  });

  test('restricts to graph MCP tools only — no built-in tools offered, allowedTools scoped to exactly the seven FQNs', async () => {
    const captured: Array<{ prompt: string; options?: Options }> = [];
    await runWakeSession(baseCtx({ queryFn: capturingSuccess(captured) }));

    const { options } = captured[0]!;
    expect(options?.tools).toEqual([]); // no built-in tool (Bash/Read/Write/Edit/Grep/Glob/...) offered at all
    expect((options?.allowedTools ?? []).slice().sort()).toEqual(
      [
        JOB_ADD_TOOL_FQN,
        DEP_DECLARE_TOOL_FQN,
        DEP_RETRACT_TOOL_FQN,
        TASK_SEAL_TOOL_FQN,
        TASK_UNSEAL_TOOL_FQN,
        A2A_REQUEST_TOOL_FQN,
        GRAPH_READ_TOOL_FQN,
      ].sort(),
    );
    for (const fqn of options!.allowedTools!) {
      expect(fqn.startsWith(`mcp__${GRAPH_MCP_SERVER}__`)).toBe(true); // every allowed name is graph-namespaced, none built-in
    }
  });

  test("defaults permissionMode to 'dontAsk', not 'bypassPermissions' — allowedTools does not bind under bypass (step-agents.ts's own observed lesson)", async () => {
    const captured: Array<{ prompt: string; options?: Options }> = [];
    await runWakeSession(baseCtx({ queryFn: capturingSuccess(captured) }));
    expect(captured[0]!.options?.permissionMode).toBe('dontAsk');
  });

  test('honors an explicit permissionMode override', async () => {
    const captured: Array<{ prompt: string; options?: Options }> = [];
    await runWakeSession(baseCtx({ queryFn: capturingSuccess(captured), permissionMode: 'plan' }));
    expect(captured[0]!.options?.permissionMode).toBe('plan');
  });

  test('a non-success result subtype does not throw — the caller can fire-and-forget', async () => {
    expect(await runWakeSession(baseCtx({ queryFn: failingQueryFn }))).toBeUndefined();
  });

  test('a thrown error from the query stream itself does not throw — same self-contained contract', async () => {
    expect(await runWakeSession(baseCtx({ queryFn: throwingQueryFn }))).toBeUndefined();
  });
});
