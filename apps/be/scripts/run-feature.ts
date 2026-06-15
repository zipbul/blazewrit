import { runFlow } from '../src/orchestrator/orchestrator';
import { InMemoryOrchestratorStore } from '../src/orchestrator/store';
import { AgentStepExecutor } from '../src/orchestrator/infra/agent-step-executor';
import { buildStepPrompt } from '../src/harness/prompts';
import type { StepExecutor } from '../src/orchestrator/types';

// Runs the full feature workflow against a real repo using the Claude Agent SDK.
const repo = process.env.REPO ?? '/tmp/bun-todo';
const request =
  process.env.REQUEST ?? 'todo 항목을 add / list / done / remove 하는 Bun + TypeScript CLI를 만들어줘';

const base = new AgentStepExecutor({
  cwd: repo,
  permissionMode: 'bypassPermissions',
  maxTurns: 40,
  promptFor: buildStepPrompt,
});

// Logging decorator so the long run is observable.
const executor: StepExecutor = {
  async produce(ctx) {
    console.log(`▶ ${ctx.step} produce (attempt ${ctx.attempt}) — ${new Date().toISOString()}`);
    const out = await base.produce(ctx);
    console.log(`  ✓ ${ctx.step} produced`);
    return out;
  },
  async review(ctx) {
    console.log(`▷ ${ctx.step} review`);
    const r = await base.review(ctx);
    console.log(`  ${r.verdict === 'pass' ? '✓' : '✗'} ${ctx.step} → ${r.verdict}`);
    return r;
  },
};

const store = new InMemoryOrchestratorStore();
let i = 0;
const newId = () => `flow-${i++}`;

console.log(`=== feature workflow on ${repo} ===`);
const result = await runFlow('feature', { store, executor, newId, request, maxAttempts: 3 });
console.log('FLOW RESULT:', JSON.stringify(result));
console.log('STEP RUNS:', (await store.stepRuns(result.flowId)).length);
