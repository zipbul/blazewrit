import { expect, test } from 'bun:test';
import { wouldCreateCycle, type CycleEdge, type CycleJob } from './cycle';

test('A1: mutual job dep is rejected', () => {
  const jobs: CycleJob[] = [
    { id: 'A', taskId: 'T' },
    { id: 'B', taskId: 'T' },
  ];
  const existing: CycleEdge[] = [{ waiterJobId: 'A', targetType: 'job', targetId: 'B' }];
  const candidate: CycleEdge = { waiterJobId: 'B', targetType: 'job', targetId: 'A' };
  expect(wouldCreateCycle(jobs, existing, candidate)).toBe(true);
});

test('A2: self-dep is rejected', () => {
  const jobs: CycleJob[] = [{ id: 'A', taskId: 'T' }];
  const candidate: CycleEdge = { waiterJobId: 'A', targetType: 'job', targetId: 'A' };
  expect(wouldCreateCycle(jobs, [], candidate)).toBe(true);
});

test('A3: a 3-job chain back to its start is rejected', () => {
  const jobs: CycleJob[] = [
    { id: 'A', taskId: 'T' },
    { id: 'B', taskId: 'T' },
    { id: 'C', taskId: 'T' },
  ];
  const existing: CycleEdge[] = [
    { waiterJobId: 'A', targetType: 'job', targetId: 'B' },
    { waiterJobId: 'B', targetType: 'job', targetId: 'C' },
  ];
  const candidate: CycleEdge = { waiterJobId: 'C', targetType: 'job', targetId: 'A' };
  expect(wouldCreateCycle(jobs, existing, candidate)).toBe(true);
});

test('A4: an acyclic DAG (with a diamond) accepts a further non-cyclic edge', () => {
  const jobs: CycleJob[] = [
    { id: 'A', taskId: 'T' },
    { id: 'B', taskId: 'T' },
    { id: 'C', taskId: 'T' },
    { id: 'D', taskId: 'T' },
    { id: 'E', taskId: 'T' },
  ];
  // Diamond: D waits on B and C; both B and C wait on A.
  const existing: CycleEdge[] = [
    { waiterJobId: 'D', targetType: 'job', targetId: 'B' },
    { waiterJobId: 'D', targetType: 'job', targetId: 'C' },
    { waiterJobId: 'B', targetType: 'job', targetId: 'A' },
    { waiterJobId: 'C', targetType: 'job', targetId: 'A' },
  ];
  const candidate: CycleEdge = { waiterJobId: 'E', targetType: 'job', targetId: 'D' };
  expect(wouldCreateCycle(jobs, existing, candidate)).toBe(false);
});

test('A5: waiting on a task whose job (indirectly) waits on the waiter is rejected', () => {
  // W wants to wait on task T. T's job J1 already (transitively, via X) waits on W.
  const jobs: CycleJob[] = [
    { id: 'W', taskId: 'TW' },
    { id: 'J1', taskId: 'T' },
    { id: 'X', taskId: 'T' },
  ];
  const existing: CycleEdge[] = [
    { waiterJobId: 'J1', targetType: 'job', targetId: 'X' },
    { waiterJobId: 'X', targetType: 'job', targetId: 'W' },
  ];
  const candidate: CycleEdge = { waiterJobId: 'W', targetType: 'task', targetId: 'T' };
  expect(wouldCreateCycle(jobs, existing, candidate)).toBe(true);
});

test('A6: waiting on a task whose jobs have no path to the waiter is accepted', () => {
  const jobs: CycleJob[] = [
    { id: 'W', taskId: 'TW' },
    { id: 'J1', taskId: 'T' },
    { id: 'J2', taskId: 'T' },
  ];
  const existing: CycleEdge[] = [{ waiterJobId: 'J1', targetType: 'job', targetId: 'J2' }];
  const candidate: CycleEdge = { waiterJobId: 'W', targetType: 'task', targetId: 'T' };
  expect(wouldCreateCycle(jobs, existing, candidate)).toBe(false);
});

test('A7: an external target is never a cycle, even sharing an id with a job in a would-be cycle', () => {
  const jobs: CycleJob[] = [
    { id: 'A', taskId: 'T' },
    { id: 'B', taskId: 'T' },
  ];
  const existing: CycleEdge[] = [{ waiterJobId: 'A', targetType: 'job', targetId: 'B' }];
  // If 'A' were treated as a job node here, B -> external('A') would look like it closes A->B->A.
  const candidate: CycleEdge = { waiterJobId: 'B', targetType: 'external', targetId: 'A' };
  expect(wouldCreateCycle(jobs, existing, candidate)).toBe(false);
});

test('A8: of two candidate edges on the same acyclic graph, only the cycle-closing one is rejected', () => {
  const jobs: CycleJob[] = [
    { id: 'A', taskId: 'T' },
    { id: 'B', taskId: 'T' },
    { id: 'C', taskId: 'T' },
    { id: 'D', taskId: 'T' },
  ];
  const existing: CycleEdge[] = [
    { waiterJobId: 'A', targetType: 'job', targetId: 'B' },
    { waiterJobId: 'B', targetType: 'job', targetId: 'C' },
  ];
  const closesCycle: CycleEdge = { waiterJobId: 'C', targetType: 'job', targetId: 'A' };
  const staysAcyclic: CycleEdge = { waiterJobId: 'D', targetType: 'job', targetId: 'C' };
  expect(wouldCreateCycle(jobs, existing, closesCycle)).toBe(true);
  expect(wouldCreateCycle(jobs, existing, staysAcyclic)).toBe(false);
});
