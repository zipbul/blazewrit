import { test, expect, beforeEach } from 'bun:test';
import { InMemoryOrchestratorStore } from './store';

let store: InMemoryOrchestratorStore;
beforeEach(() => {
  store = new InMemoryOrchestratorStore();
});

test('creates and reads back a flow', async () => {
  await store.createFlow({ id: 'f1', flowType: 'feature', status: 'active', currentStep: 'ground' });
  expect(await store.getFlow('f1')).toMatchObject({ id: 'f1', status: 'active', currentStep: 'ground' });
});

test('advances the current step', async () => {
  await store.createFlow({ id: 'f1', flowType: 'feature', status: 'active', currentStep: 'ground' });
  await store.setCurrentStep('f1', 'investigate');
  expect((await store.getFlow('f1'))?.currentStep).toBe('investigate');
});

test('updates flow status', async () => {
  await store.createFlow({ id: 'f1', flowType: 'feature', status: 'active', currentStep: 'ground' });
  await store.setStatus('f1', 'completed');
  expect((await store.getFlow('f1'))?.status).toBe('completed');
});

test('appends and filters step runs by flow', async () => {
  await store.startStepRun({ id: 's1', flowId: 'f1', step: 'ground', role: 'producer', attempt: 1 });
  await store.startStepRun({ id: 's2', flowId: 'f2', step: 'ground', role: 'producer', attempt: 1 });
  expect(await store.stepRuns('f1')).toHaveLength(1);
});

test('a started step run is running, then finished with a verdict', async () => {
  await store.startStepRun({ id: 's1', flowId: 'f1', step: 'ground', role: 'reviewer', attempt: 1 });
  expect((await store.stepRuns('f1'))[0]?.status).toBe('running');
  await store.finishStepRun('s1', 'done', 'pass');
  const run = (await store.stepRuns('f1'))[0];
  expect(run?.status).toBe('done');
  expect(run?.verdict).toBe('pass');
});
