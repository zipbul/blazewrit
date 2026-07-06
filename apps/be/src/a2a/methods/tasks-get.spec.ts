import { test, expect, beforeEach } from 'bun:test';
import { JSON_RPC_ERRORS, A2A_ERRORS, type JsonRpcRequestDto, type TaskDto } from '@bw/dto';
import { makeTasksGet } from './tasks-get';
import { InMemoryTaskStore } from '../infra/task-store';
import { JsonRpcError } from '../types';

const TASK: TaskDto = { kind: 'task', id: 't1', contextId: 'c1', status: { state: 'working' } };

function getRequest(params: unknown): JsonRpcRequestDto {
  return { jsonrpc: '2.0', method: 'tasks/get', id: 1, params } as JsonRpcRequestDto;
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

test('returns the stored task by id', async () => {
  store.save(TASK);
  expect(makeTasksGet(store)(getRequest({ id: 't1' }))).toBe(TASK);
});

test('rejects with TASK_NOT_FOUND for an unknown id', async () => {
  const err = await thrownError(() => makeTasksGet(store)(getRequest({ id: 'missing' })));
  expect(err.code).toBe(A2A_ERRORS.TASK_NOT_FOUND);
});

test('rejects with INVALID_PARAMS when id is missing', async () => {
  const err = await thrownError(() => makeTasksGet(store)(getRequest({})));
  expect(err.code).toBe(JSON_RPC_ERRORS.INVALID_PARAMS);
});
