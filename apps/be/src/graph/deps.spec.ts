import { expect, test } from 'bun:test';
import { computeReady, evaluateDep, isStaleMember, jobTargetOutcome, memberSatisfied, taskTargetOutcome, type DepMemberEval } from './deps';

test('B1: a pending job with no deps is ready', () => {
  expect(computeReady([])).toBe(true);
});

test('B2: predicate=all releases once every member is satisfied', () => {
  const members: DepMemberEval[] = [
    { outcome: 'satisfied', acceptable: ['satisfied'], stale: false },
    { outcome: 'satisfied', acceptable: ['satisfied'], stale: false },
  ];
  expect(evaluateDep({ predicate: 'all', status: 'active' }, members)).toBe('released');
});

test('B3: predicate=all stays unreleased while one member is still pending', () => {
  const members: DepMemberEval[] = [
    { outcome: 'satisfied', acceptable: ['satisfied'], stale: false },
    { outcome: 'pending', acceptable: ['satisfied'], stale: false },
  ];
  expect(evaluateDep({ predicate: 'all', status: 'active' }, members)).toBe('active');
});

test('B4: predicate=any releases as soon as one member is satisfied', () => {
  const members: DepMemberEval[] = [
    { outcome: 'satisfied', acceptable: ['satisfied'], stale: false },
    { outcome: 'pending', acceptable: ['satisfied'], stale: false },
  ];
  expect(evaluateDep({ predicate: 'any', status: 'active' }, members)).toBe('released');
});

test('B5: a cancelled outcome counts as met when acceptable includes cancelled', () => {
  expect(memberSatisfied({ outcome: 'cancelled', acceptable: ['satisfied', 'cancelled'] })).toBe(true);
});

test('B6: the default acceptable set ({satisfied}) rejects both cancelled and failed', () => {
  expect(memberSatisfied({ outcome: 'cancelled', acceptable: ['satisfied'] })).toBe(false);
  expect(memberSatisfied({ outcome: 'failed', acceptable: ['satisfied'] })).toBe(false);
});

test('B7: a job with two deps is only ready once BOTH are released (AND across deps)', () => {
  expect(computeReady([{ status: 'released' }, { status: 'active' }])).toBe(false);
});

test('B8: a job-target outcome maps 1:1 to the job status', () => {
  expect(jobTargetOutcome('done')).toBe('satisfied');
  expect(jobTargetOutcome('failed')).toBe('failed');
  expect(jobTargetOutcome('cancelled')).toBe('cancelled');
  expect(jobTargetOutcome('pending')).toBe('pending');
  expect(jobTargetOutcome('running')).toBe('pending');
});

test('B9: a task-target outcome maps 1:1 to the task status (rule 6)', () => {
  expect(taskTargetOutcome('open')).toBe('pending');
  expect(taskTargetOutcome('done')).toBe('satisfied');
  expect(taskTargetOutcome('failed')).toBe('failed');
  expect(taskTargetOutcome('cancelled')).toBe('cancelled');
});

test('B10: a job target goes stale when its expected generation no longer matches', () => {
  expect(isStaleMember({ targetType: 'job', expectedGen: 1 }, 2)).toBe(true);
  expect(isStaleMember({ targetType: 'job', expectedGen: 2 }, 2)).toBe(false);
});

test('B10b: a job target without a declared expectedGen never goes stale', () => {
  expect(isStaleMember({ targetType: 'job' }, 2)).toBe(false);
  expect(isStaleMember({ targetType: 'job', expectedGen: undefined }, undefined)).toBe(false);
});

test('B11: a released dep latches — it does not un-release when a member regresses', () => {
  // Simulates a job target that gen++'d back to 'pending' after the dep already released.
  const members: DepMemberEval[] = [{ outcome: 'pending', acceptable: ['satisfied'], stale: false }];
  expect(evaluateDep({ predicate: 'all', status: 'released' }, members)).toBe('released');
});
