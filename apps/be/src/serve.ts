import './seal'; // baker: seal all @bw/dto recipes once before any validate (A2A JSON-RPC ingress)
import { SQL } from 'bun';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { createRestApi } from './api/rest';
import { ensureSchema } from './infra/schema';
import { AgentStepExecutor } from './orchestrator/infra/agent-step-executor';
import { buildStepPrompt } from './harness/prompts';
import { stepAgentSystemPrompt } from './harness/step-agent-wiring';
import { ensureTriageReadModel } from './triage/db/views.sql';
import { TriageAgent } from './triage/triage-agent';
import { startGraphController } from './graph/controller';
import type { ReconcileJob } from './graph/reconcile';
import { makeWakeConsumer } from './graph/wake-consumer';
import type { QueryFn } from './orchestrator/infra/agent-step-executor';

const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const port = Number(process.env.API_PORT ?? 4500);

await ensureSchema(sql);
await ensureTriageReadModel(sql); // central triage read surface: curated views + read-only role + grants

// BW_REAL=1 → run real Claude Agent SDK agents (cwd = the dispatched job's own repo); else paced stub.
const real = process.env.BW_REAL === '1';
// BW_REPO is the fallback for a repo with no cwd configured yet (rest.ts's resolveRepoCwd reads
// '.' in that case) — kept here, not in rest.ts, so the API layer stays free of env-var policy.
const executorFor = real
  ? (cwd: string) =>
      new AgentStepExecutor({
        cwd: cwd === '.' ? (process.env.BW_REPO ?? '/tmp/blazewrit-projects/demo') : cwd,
        permissionMode: 'bypassPermissions',
        maxTurns: 40,
        promptFor: buildStepPrompt,
        // Step agents: one-line identity per step (step-taxonomy.md).
        systemPromptFor: stepAgentSystemPrompt,
      })
  : undefined;

// Central triage runs a real Claude Agent SDK call with a read-only DB tool — always available.
const triage = new TriageAgent({ sql });

// Flow assembler: the project agent composes the step chain per task (a cheap, tool-less, read-only
// SDK call). Gated by BW_REAL so paced/demo mode keeps the curated workflow (no API cost).
const assembler = real ? { queryFn: query as never } : undefined;

// F: captured via the onReconcileDispatch hook so the always-on controller (below) can reuse the
// exact same registry-aware dispatch dispatchTask's own inline reconcile call uses, without
// createRestApi returning anything but a bare Elysia app.
let reconcileDispatch: ((job: ReconcileJob) => Promise<void>) | undefined;

// Loopback only: the API is unauthenticated, so it must never be reachable from the network.
createRestApi(sql, {
  executorFor,
  triage,
  assembler,
  selfBaseUrl: `http://localhost:${port}`,
  onReconcileDispatch: (dispatch) => {
    reconcileDispatch = dispatch;
  },
}).listen({ hostname: '127.0.0.1', port });
console.log(`blazewrit REST API on 127.0.0.1:${port} (Postgres-backed, executor=${real ? 'agent-sdk' : 'paced'}, triage=agent-sdk, assembler=${real ? 'agent-sdk' : 'curated'})`);

// P4-2c: onWake wiring — a raised wake (dedup-filtered, spec E2) kicks off a runWakeSession
// (P4-2a) for the woken job's own repo, but ONLY once that REPO opts in (repos.autonomy, read
// fresh per wake by wake-consumer.ts itself — single 기록자 통합 Phase 3). Defaults to false
// (schema.ts), which makes wake-consumer.ts's handler a pure no-op for a repo that hasn't opted
// in — the human drawer inbox (raiseWake's decisions row) stays the ONLY consumer for it, same as
// before this round. The PATCH /api/repos/:id/autonomy route (api/rest.ts) is the P5 toggle UI's
// backend — flipping it takes effect on the very next wake, no restart needed. Task-level (no
// jobId) wakes + explicit wake-record lifecycle are still P5 (harness/job-graph.md:175-176 — P4 =
// 배선/이유전달, 자율모드 토글 UI = P5).
const wakeConsumer = makeWakeConsumer({
  sql,
  queryFn: query as QueryFn,
  newId: () => crypto.randomUUID(),
});

// F1: always-on reconcile controller (harness/job-graph.md P2) — restart recovery + periodic
// sweep + lease-expiry crash detection + rule 4/5 wake records. onReconcileDispatch runs
// synchronously during createRestApi's own setup above, so reconcileDispatch is always populated
// by this point.
startGraphController(sql, reconcileDispatch!, {
  tickMs: Number(process.env.BW_RECONCILE_TICK_MS ?? 60_000),
  stallThresholdMs: Number(process.env.BW_STALL_MS ?? 900_000),
  onWake: wakeConsumer,
});
