import { test, expect, beforeEach, mock } from 'bun:test';
import type { ReviewVerdict } from '@bw/dto';
import { runFlow } from './orchestrator';
import { InMemoryOrchestratorStore } from './store';
import type { ProducerOutcome, ReviewOutcome, StepContext, StepExecutor } from './types';

let store: InMemoryOrchestratorStore;
let ids: number;
const newId = () => `flow-${ids++}`;

beforeEach(() => {
  store = new InMemoryOrchestratorStore();
  ids = 1;
});

/** Executor whose reviewer returns a scripted verdict sequence (default: always pass). */
function executor(verdicts: ReviewVerdict[] = []): StepExecutor {
  let i = 0;
  return {
    produce: mock(async () => ({ output: null })),
    review: mock(async () => ({ verdict: verdicts[i++] ?? 'pass' })),
  };
}

test('completes the feature flow when every step passes', async () => {
  const result = await runFlow('feature', { store, executor: executor(), newId, request: 'add login' });
  expect(result.status).toBe('completed');
  expect((await store.getFlow(result.flowId))?.status).toBe('completed');
});

test('ends at the reflect step', async () => {
  const result = await runFlow('feature', { store, executor: executor(), newId, request: 'add login' });
  expect((await store.getFlow(result.flowId))?.currentStep).toBe('reflect');
});

test('records a producer run for every step', async () => {
  const result = await runFlow('feature', { store, executor: executor(), newId, request: 'add login' });
  const producerSteps = (await store.stepRuns(result.flowId)).filter((r) => r.role === 'producer').map((r) => r.step);
  expect(producerSteps).toEqual(['ground', 'investigate', 'decide', 'spec', 'test', 'implement', 'verify', 'reflect']);
});

test('retries a step when the reviewer fails, then proceeds on pass', async () => {
  // ground: fail, pass; remaining steps pass
  const result = await runFlow('feature', { store, executor: executor(['fail', 'pass']), newId, request: 'add login' });
  expect(result.status).toBe('completed');
  const groundProducers = (await store.stepRuns(result.flowId)).filter((r) => r.step === 'ground' && r.role === 'producer');
  expect(groundProducers).toHaveLength(2);
});

test('abandons the flow when a reviewer never passes within maxAttempts', async () => {
  const result = await runFlow('feature', {
    store,
    executor: executor(['fail', 'fail', 'fail']),
    newId,
    request: 'add login',
    maxAttempts: 3,
  });
  expect(result.status).toBe('abandoned');
  expect((await store.getFlow(result.flowId))?.status).toBe('abandoned');
});

test('does not review no-reviewer steps', async () => {
  const exec = executor();
  const result = await runFlow('feature', { store, executor: exec, newId, request: 'add login' });
  const reviewerSteps = (await store.stepRuns(result.flowId)).filter((r) => r.role === 'reviewer').map((r) => r.step);
  expect(reviewerSteps).not.toContain('verify');
  expect(reviewerSteps).not.toContain('reflect');
});

test('threads a prior step output into a later step and into review', async () => {
  const seenByInvestigate: unknown[] = [];
  let groundOutputUnderReview: unknown;
  const exec: StepExecutor = {
    produce: mock(async (ctx: StepContext): Promise<ProducerOutcome> => {
      if (ctx.step === 'investigate') seenByInvestigate.push(...ctx.priorOutputs.map((p) => p.output));
      return { output: `${ctx.step}-output` };
    }),
    review: mock(async (ctx: StepContext): Promise<ReviewOutcome> => {
      if (ctx.step === 'ground') groundOutputUnderReview = ctx.producerOutput;
      return { verdict: 'pass' };
    }),
  };
  await runFlow('feature', { store, executor: exec, newId, request: 'add login' });
  expect(seenByInvestigate).toContain('ground-output');
  expect(groundOutputUnderReview).toBe('ground-output');
});

test('runs a non-feature flow (research) to completion using its own step sequence', async () => {
  const result = await runFlow('research', { store, executor: executor(), newId, request: 'compare auth libs' });
  expect(result.status).toBe('completed');
});
