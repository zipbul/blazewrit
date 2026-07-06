import { test, expect } from 'bun:test';
import { buildStepPrompt } from './prompts';
import type { StepContext } from '../orchestrator/types';

const ctx = (step: string, extra: Partial<StepContext> = {}): StepContext => ({
  flowId: 'f1',
  flowType: 'feature',
  step,
  attempt: 1,
  request: '로그인 기능 추가해줘',
  priorOutputs: [],
  ...extra,
});

test('threads the user request into the producer prompt', () => {
  expect(buildStepPrompt(ctx('ground'), 'producer')).toContain('로그인 기능 추가해줘');
});

test('names the step and the flow type', () => {
  const prompt = buildStepPrompt(ctx('implement'), 'producer');
  expect(prompt).toContain('"implement"');
  expect(prompt).toContain('"feature"');
});

test('ground producer prompt is read-only', () => {
  expect(buildStepPrompt(ctx('ground'), 'producer').toLowerCase()).toContain('read-only');
});

test('reviewer prompt asks for a pass/fail verdict', () => {
  const prompt = buildStepPrompt(ctx('spec'), 'reviewer');
  expect(prompt).toContain('verdict');
  expect(prompt).toContain('pass');
  expect(prompt).toContain('fail');
});

test('falls back to a generic instruction for an unknown step', () => {
  expect(buildStepPrompt(ctx('mystery'), 'producer')).toContain('"mystery"');
});

test('includes prior step outputs in the producer prompt (data flow)', () => {
  const prompt = buildStepPrompt(ctx('investigate', { priorOutputs: [{ step: 'ground', output: 'FACT: no auth module' }] }), 'producer');
  expect(prompt).toContain('ground');
  expect(prompt).toContain('FACT: no auth module');
});

test('includes the produced output in the reviewer prompt', () => {
  const prompt = buildStepPrompt(ctx('spec', { producerOutput: 'AC-1: user can log in' }), 'reviewer');
  expect(prompt).toContain('AC-1: user can log in');
});
