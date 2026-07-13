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

// Loopback only: the API is unauthenticated, so it must never be reachable from the network.
createRestApi(sql, { executorFor, triage, assembler, selfBaseUrl: `http://localhost:${port}` }).listen({ hostname: '127.0.0.1', port });
console.log(`blazewrit REST API on 127.0.0.1:${port} (Postgres-backed, executor=${real ? 'agent-sdk' : 'paced'}, triage=agent-sdk, assembler=${real ? 'agent-sdk' : 'curated'})`);
