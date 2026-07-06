import { describe, expect, it } from 'bun:test';
import { runFlow } from './orchestrator';
import { InMemoryOrchestratorStore } from './store';
import type { StepExecutor } from './types';
import type { WorkflowDef } from '../harness/workflows';

/**
 * Two-phase composition: a flow seeded with ground-only runs ground first, then composeRest sees
 * ground's real output and composes the remaining chain, which the orchestrator appends and runs.
 * The late assemble session is recorded on the flow (stays re-askable).
 */
const okExecutor: StepExecutor = {
  produce: async (ctx) => ({ output: `did:${ctx.step}` }),
  review: async () => ({ verdict: 'pass' }),
};

const groundOnly: WorkflowDef = { flowType: 'feature', steps: [{ name: 'ground', reviewer: true }] };

describe('runFlow two-phase', () => {
  it('runs ground, then composes+appends the rest from ground output', async () => {
    const store = new InMemoryOrchestratorStore();
    let sawGroundOutput: unknown;
    const result = await runFlow(groundOnly, {
      store, executor: okExecutor, newId: (() => { let n = 0; return () => `id-${n++}`; })(), request: '로그인',
      composeRest: async ({ groundOutput }) => {
        sawGroundOutput = groundOutput;
        return {
          steps: [
            { name: 'ground', reviewer: true }, // full grammar chain; the run ground is dropped
            { name: 'implement', reviewer: true },
            { name: 'verify', reviewer: false },
            { name: 'reflect', reviewer: false },
          ],
          sessionId: 'late-sess',
        };
      },
    });
    expect(result.status).toBe('completed');
    expect(sawGroundOutput).toBe('did:ground'); // composeRest saw ground's real output
    const ran = (await store.stepRuns(result.flowId)).filter((r) => r.role === 'producer').map((r) => r.step);
    expect(ran).toEqual(['ground', 'implement', 'verify', 'reflect']); // ground once, then appended tail
    const flow = await store.getFlow(result.flowId);
    expect(flow!.assembleSessionId).toBe('late-sess'); // late session recorded
  });

  it('without composeRest the passed workflow runs verbatim (one-phase unchanged)', async () => {
    const store = new InMemoryOrchestratorStore();
    const wf: WorkflowDef = { flowType: 'feature', steps: [{ name: 'ground', reviewer: true }, { name: 'reflect', reviewer: false }] };
    const result = await runFlow(wf, { store, executor: okExecutor, newId: (() => { let n = 0; return () => `v-${n++}`; })(), request: 'x' });
    const ran = (await store.stepRuns(result.flowId)).filter((r) => r.role === 'producer').map((r) => r.step);
    expect(ran).toEqual(['ground', 'reflect']);
  });
});
