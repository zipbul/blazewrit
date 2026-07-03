import './seal'; // baker: seal all @bw/dto recipes once before any validate (A2A JSON-RPC ingress)
import { SQL } from 'bun';
import { createRestApi } from './api/rest';
import { ensureSchema } from './infra/schema';
import { AgentStepExecutor } from './orchestrator/infra/agent-step-executor';
import { buildStepPrompt } from './harness/prompts';
import { ensureTriageReadModel } from './triage/db/views.sql';
import { TriageAgent } from './triage/triage-agent';

const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const port = Number(process.env.API_PORT ?? 4500);

await ensureSchema(sql);
await ensureTriageReadModel(sql); // central triage read surface: curated views + read-only role + grants

// BW_REAL=1 → run real Claude Agent SDK agents (cwd = project repo); else paced stub.
const real = process.env.BW_REAL === '1';
const executor = real
  ? new AgentStepExecutor({
      cwd: process.env.BW_REPO ?? '/tmp/blazewrit-projects/demo',
      permissionMode: 'bypassPermissions',
      maxTurns: 40,
      promptFor: buildStepPrompt,
    })
  : undefined;

// Central triage runs a real Claude Agent SDK call with a read-only DB tool — always available.
const triage = new TriageAgent({ sql });

// Loopback only: the API is unauthenticated, so it must never be reachable from the network.
createRestApi(sql, { executor, triage, selfBaseUrl: `http://localhost:${port}` }).listen({ hostname: '127.0.0.1', port });
console.log(`blazewrit REST API on 127.0.0.1:${port} (Postgres-backed, executor=${real ? 'agent-sdk' : 'paced'}, triage=agent-sdk)`);
