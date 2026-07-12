import { expect, test } from 'bun:test';
import { bumpGeneration, canTransitionJob } from './transitions';

test('F1: transitions outside the whitelist are rejected, whitelisted ones pass', () => {
  expect(canTransitionJob('pending', 'done')).toBe(false);
  expect(canTransitionJob('done', 'running')).toBe(false);
  expect(canTransitionJob('cancelled', 'ready')).toBe(false);
  expect(canTransitionJob('pending', 'ready')).toBe(true);
  expect(canTransitionJob('ready', 'running')).toBe(true);
  expect(canTransitionJob('running', 'done')).toBe(true);
});

test('F2: gen++ keeps the same row, bumps generation, and resets status to pending', () => {
  const result = bumpGeneration({ status: 'done', generation: 1 });
  expect(result).toEqual({ ok: true, job: { status: 'pending', generation: 2 } });
});

test('F3: gen++ on a non-terminal job is rejected', () => {
  const result = bumpGeneration({ status: 'pending', generation: 1 });
  expect(result.ok).toBe(false);
});

test('F4: cancel is allowed from every non-terminal status', () => {
  expect(canTransitionJob('pending', 'cancelled')).toBe(true);
  expect(canTransitionJob('blocked', 'cancelled')).toBe(true);
  expect(canTransitionJob('ready', 'cancelled')).toBe(true);
  expect(canTransitionJob('running', 'cancelled')).toBe(true);
});
