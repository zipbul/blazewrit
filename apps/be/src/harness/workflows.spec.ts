import { test, expect } from 'bun:test';
import { getWorkflow } from './workflows';

test('feature workflow has the confirmed step sequence', () => {
  const steps = getWorkflow('feature')?.steps.map((s) => s.name);
  expect(steps).toEqual(['ground', 'investigate', 'decide', 'spec', 'test', 'implement', 'verify', 'reflect']);
});

test('verify and reflect have no reviewer', () => {
  const byName = new Map(getWorkflow('feature')?.steps.map((s) => [s.name, s.reviewer]));
  expect(byName.get('verify')).toBe(false);
  expect(byName.get('reflect')).toBe(false);
});

test('ground..implement steps carry a reviewer', () => {
  const steps = getWorkflow('feature')!.steps.filter((s) => s.reviewer).map((s) => s.name);
  expect(steps).toEqual(['ground', 'investigate', 'decide', 'spec', 'test', 'implement']);
});

test('every flow type has a workflow definition (all 7 specialized)', () => {
  for (const ft of ['feature', 'bugfix', 'refactor', 'migration', 'research', 'audit', 'chore'] as const) {
    expect(getWorkflow(ft)?.flowType).toBe(ft);
  }
});

test('research runs ground→investigate→decide→report→reflect', () => {
  const steps = getWorkflow('research')?.steps.map((s) => s.name);
  expect(steps).toEqual(['ground', 'investigate', 'decide', 'report', 'reflect']);
});

test('audit skips decide and produces a report', () => {
  const steps = getWorkflow('audit')?.steps.map((s) => s.name);
  expect(steps).toEqual(['ground', 'investigate', 'report', 'reflect']);
});
