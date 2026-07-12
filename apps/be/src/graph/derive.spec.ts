import { expect, test } from 'bun:test';
import { cancelTask, deriveTaskStatus, type DeriveTaskStatusInput } from './derive';

test('D1: all participating repos sealed and every job done derives done', () => {
  const input: DeriveTaskStatusInput = { participatingRepoIds: ['r1', 'r2'], sealedRepoIds: ['r1', 'r2'], jobStatuses: ['done', 'done'] };
  expect(deriveTaskStatus(input)).toBe('done');
});

test('D2: all sealed, all jobs terminal, at least one failed derives failed', () => {
  const input: DeriveTaskStatusInput = { participatingRepoIds: ['r1', 'r2'], sealedRepoIds: ['r1', 'r2'], jobStatuses: ['done', 'failed'] };
  expect(deriveTaskStatus(input)).toBe('failed');
});

test('D3: a non-terminal job keeps the task open even when every repo has sealed', () => {
  const input: DeriveTaskStatusInput = { participatingRepoIds: ['r1'], sealedRepoIds: ['r1'], jobStatuses: ['done', 'running'] };
  expect(deriveTaskStatus(input)).toBe('open');
});

test('D4: one unsealed participating repo keeps the task open even when every job is terminal', () => {
  const input: DeriveTaskStatusInput = { participatingRepoIds: ['r1', 'r2'], sealedRepoIds: ['r1'], jobStatuses: ['done', 'done'] };
  expect(deriveTaskStatus(input)).toBe('open');
});

test('D5: a seal from a repo with no jobs under the task has no effect', () => {
  const input: DeriveTaskStatusInput = { participatingRepoIds: ['r1'], sealedRepoIds: ['r1', 'r3'], jobStatuses: ['done'] };
  expect(deriveTaskStatus(input)).toBe('done');
});

test('D6: cancellation is an explicit command, not a derivation from graph facts', () => {
  expect(cancelTask()).toBe('cancelled');
});
