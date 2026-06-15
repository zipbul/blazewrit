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

test('returns undefined for a flow type without a definition', () => {
  expect(getWorkflow('research')).toBeUndefined();
});
