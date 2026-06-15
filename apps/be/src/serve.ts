import { SQL } from 'bun';
import { createRestApi } from './api/rest';
import { ensureSchema } from './infra/schema';
import { AgentStepExecutor } from './orchestrator/infra/agent-step-executor';
import { buildStepPrompt } from './harness/prompts';

const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const port = Number(process.env.API_PORT ?? 4500);

await ensureSchema(sql);

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

createRestApi(sql, { executor }).listen(port);
console.log(`blazewrit REST API on :${port} (Postgres-backed, executor=${real ? 'agent-sdk' : 'paced'})`);
