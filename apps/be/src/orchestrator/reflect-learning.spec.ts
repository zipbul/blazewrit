import { describe, expect, it } from 'bun:test';
import { runFlow } from './orchestrator';
import { InMemoryOrchestratorStore } from './store';
import type { StepExecutor } from './types';

/**
 * The learning persisted at reflect must be the reflect agent's ACTUAL output — not a hardcoded
 * placeholder. (Observed live: the agent wrote real lessons and the DB stored boilerplate.)
 */
describe('reflect learning persistence', () => {
  it('persists the reflect step output as the learning text', async () => {
    const executor: StepExecutor = {
      produce: async (ctx) => ({
        output: ctx.step === 'reflect' ? '이 repo는 bun test 컨벤션. RED→GREEN 1회에 성공.' : `did:${ctx.step}`,
      }),
      review: async () => ({ verdict: 'pass' }),
    };
    const learned: string[] = [];
    await runFlow(
      { flowType: 'feature', steps: [{ name: 'ground', reviewer: true }, { name: 'reflect', reviewer: false }] },
      {
        store: new InMemoryOrchestratorStore(), executor,
        newId: (() => { let n = 0; return () => `l-${n++}`; })(), request: 'r',
        onLearning: (l) => { learned.push(l.text); },
      },
    );
    expect(learned).toEqual(['이 repo는 bun test 컨벤션. RED→GREEN 1회에 성공.']);
  });

  it('non-string reflect output is serialized, not replaced by boilerplate', async () => {
    const executor: StepExecutor = {
      produce: async (ctx) => ({ output: ctx.step === 'reflect' ? { lesson: 'x' } : 'ok' }),
      review: async () => ({ verdict: 'pass' }),
    };
    const learned: string[] = [];
    await runFlow(
      { flowType: 'feature', steps: [{ name: 'reflect', reviewer: false }] },
      {
        store: new InMemoryOrchestratorStore(), executor,
        newId: (() => { let n = 0; return () => `m-${n++}`; })(), request: 'r',
        onLearning: (l) => { learned.push(l.text); },
      },
    );
    expect(learned).toEqual(['{"lesson":"x"}']);
  });
});
