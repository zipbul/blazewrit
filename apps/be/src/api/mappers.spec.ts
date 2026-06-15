import { test, expect } from 'bun:test';
import { toFlowDto, toStepRunDto, type FlowRow } from './mappers';

const flowRow: FlowRow = {
  id: 'f1',
  work_item_id: 'w1',
  flow_type: 'feature',
  status: 'completed',
  current_step: 'reflect',
  created_at: '2026-06-15T00:00:00.000Z',
};

test('maps a flow row to a FlowDto', () => {
  expect(toFlowDto(flowRow)).toEqual({
    id: 'f1',
    workItemId: 'w1',
    flowType: 'feature',
    attemptNo: 1,
    status: 'completed',
    currentStep: 'reflect',
    createdAt: '2026-06-15T00:00:00.000Z',
  });
});

test('defaults a null work_item_id to empty string', () => {
  expect(toFlowDto({ ...flowRow, work_item_id: null }).workItemId).toBe('');
});

test('running producer step run has no verdict and no endedAt', () => {
  const dto = toStepRunDto({ id: 'sr1', flow_id: 'f1', step_name: 'ground', role: 'producer', attempt_no: 1, status: 'running', verdict: null, started_at: '2026-06-15T00:00:00.000Z', ended_at: null });
  expect(dto.status).toBe('running');
  expect(dto.reviewVerdict).toBeUndefined();
  expect(dto.endedAt).toBeUndefined();
  expect(dto.id).toBe('sr1');
});

test('finished reviewer pass carries verdict, done status and endedAt', () => {
  const dto = toStepRunDto({ id: 'sr2', flow_id: 'f1', step_name: 'ground', role: 'reviewer', attempt_no: 1, status: 'done', verdict: 'pass', started_at: '2026-06-15T00:00:00.000Z', ended_at: '2026-06-15T00:01:00.000Z' });
  expect(dto.status).toBe('done');
  expect(dto.reviewVerdict).toBe('pass');
  expect(dto.endedAt).toBe('2026-06-15T00:01:00.000Z');
});

test('reviewer fail row maps to rejected status', () => {
  const dto = toStepRunDto({ id: 'sr3', flow_id: 'f1', step_name: 'ground', role: 'reviewer', attempt_no: 1, status: 'rejected', verdict: 'fail', started_at: '2026-06-15T00:00:00.000Z', ended_at: '2026-06-15T00:01:00.000Z' });
  expect(dto.status).toBe('rejected');
  expect(dto.reviewVerdict).toBe('fail');
});
