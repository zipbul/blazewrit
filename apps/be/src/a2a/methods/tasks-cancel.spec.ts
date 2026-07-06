import { test, expect, beforeEach } from 'bun:test';
import { JSON_RPC_ERRORS, A2A_ERRORS, type JsonRpcRequestDto, type TaskDto } from '@bw/dto';
import { makeTasksCancel } from './tasks-cancel';
import { InMemoryTaskStore } from '../infra/task-store';
import { JsonRpcError } from '../types';

function task(id: string, state: TaskDto['status']['state']): TaskDto {
  return { kind: 'task', id, contextId: 'c1', status: { state } };
}

function cancelRequest(params: unknown): JsonRpcRequestDto {
  return { jsonrpc: '2.0', method: 'tasks/cancel', id: 1, params } as JsonRpcRequestDto;
}

async function thrownError(fn: () => unknown): Promise<JsonRpcError> {
  let err: unknown;
  try {
    await fn();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(JsonRpcError);
  return err as JsonRpcError;
}

let store: InMemoryTaskStore;
beforeEach(() => {
  store = new InMemoryTaskStore();
});

test('cancels a non-terminal task and persists the canceled state', async () => {
  store.save(task('t1', 'working'));
  const result = (await makeTasksCancel(store)(cancelRequest({ id: 't1' }))) as TaskDto;
  expect(result.status.state).toBe('canceled');
  expect(store.get('t1')?.status.state).toBe('canceled');
});

test('rejects with TASK_NOT_CANCELABLE for a completed task', async () => {
  store.save(task('t1', 'completed'));
  const err = await thrownError(() => makeTasksCancel(store)(cancelRequest({ id: 't1' })));
  expect(err.code).toBe(A2A_ERRORS.TASK_NOT_CANCELABLE);
});

test('rejects with TASK_NOT_FOUND for an unknown id', async () => {
  const err = await thrownError(() => makeTasksCancel(store)(cancelRequest({ id: 'missing' })));
  expect(err.code).toBe(A2A_ERRORS.TASK_NOT_FOUND);
});

test('rejects with INVALID_PARAMS when id is missing', async () => {
  const err = await thrownError(() => makeTasksCancel(store)(cancelRequest({})));
  expect(err.code).toBe(JSON_RPC_ERRORS.INVALID_PARAMS);
});
