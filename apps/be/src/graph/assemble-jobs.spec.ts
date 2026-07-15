import { expect, test } from 'bun:test';
import { assembleJobs, validateAssembly, type AssembledGraph } from './assemble-jobs';
import type { CycleEdge, CycleJob } from './cycle';

test('assembleJobs returns exactly one job (id = workItemId) and no deps', () => {
  const result = assembleJobs({ taskId: 'T', repoId: 'R', workItemId: 'W', request: 'do the thing' });
  expect(result).toEqual({
    jobs: [{ id: 'W', taskId: 'T', repoId: 'R', title: 'do the thing' }],
    deps: [],
  });
});

test('validateAssembly rejects a graph with no jobs', () => {
  const g: AssembledGraph = { jobs: [], deps: [] };
  expect(validateAssembly([], [], g)).toEqual({ ok: false, reason: 'assembled graph has no jobs' });
});

test('validateAssembly rejects a dep whose waiter is not one of the assembled graph\'s own jobs', () => {
  const g: AssembledGraph = {
    jobs: [{ id: 'J1', taskId: 'T', repoId: 'R', title: 'x' }],
    deps: [{ waiterJobId: 'OUTSIDE', targetType: 'job', targetId: 'J1' }],
  };
  const result = validateAssembly([], [], g);
  expect(result.ok).toBe(false);
});

test('validateAssembly rejects a dep that would close a wait-cycle against the existing graph', () => {
  // Existing graph: job A (under task T) already waits on the job the new assembly is about to add.
  const existingJobs: CycleJob[] = [{ id: 'A', taskId: 'T' }];
  const existingEdges: CycleEdge[] = [{ waiterJobId: 'A', targetType: 'job', targetId: 'J1' }];
  // New assembly adds J1, which would wait back on A -> A -> J1 -> A cycle.
  const g: AssembledGraph = {
    jobs: [{ id: 'J1', taskId: 'T', repoId: 'R', title: 'x' }],
    deps: [{ waiterJobId: 'J1', targetType: 'job', targetId: 'A' }],
  };
  const result = validateAssembly(existingJobs, existingEdges, g);
  expect(result.ok).toBe(false);
});

/**
 * 3자 리뷰 수정 B2-3 (minor 묶음, judgment call — see handoff report): deps.ts's evaluateDep is
 * asymmetric on a memberless dep — predicate='all' with 0 members vacuously releases immediately
 * (members.every on []), predicate='any' with 0 members never releases (members.some on []).
 * AssembledDep has no grouping/predicate field today (each entry IS already exactly one edge —
 * assembleJobs never groups several targets under one dep+predicate), so this specific asymmetry
 * can't be reproduced at THIS layer yet. What IS reproducible here: an edge whose own targetId is
 * empty/missing — points at nothing, functionally the same "no real member" case — is rejected
 * before ever reaching a write.
 */
test('validateAssembly rejects a dep whose targetId is empty (no real member to wait on)', () => {
  const g: AssembledGraph = {
    jobs: [{ id: 'J1', taskId: 'T', repoId: 'R', title: 'x' }],
    deps: [{ waiterJobId: 'J1', targetType: 'job', targetId: '' }],
  };
  const result = validateAssembly([], [], g);
  expect(result).toEqual({ ok: false, reason: 'dep J1 -> job:(empty) has no target to wait on' });
});

test('validateAssembly accepts a graph whose deps introduce no cycle', () => {
  const g: AssembledGraph = {
    jobs: [
      { id: 'J1', taskId: 'T', repoId: 'R', title: 'x' },
      { id: 'J2', taskId: 'T', repoId: 'R', title: 'y' },
    ],
    deps: [{ waiterJobId: 'J2', targetType: 'job', targetId: 'J1' }],
  };
  expect(validateAssembly([], [], g)).toEqual({ ok: true });
});
