import { test, expect, mock } from 'bun:test';
import { JSON_RPC_ERRORS, A2A_ERRORS, type JsonRpcRequestDto } from '@bw/dto';
import { dispatch, type MethodHandler } from './dispatch';
import { JsonRpcError } from './types';

function request(method: string, id: string | number | null = 1): JsonRpcRequestDto {
  return { jsonrpc: '2.0', method, id } as JsonRpcRequestDto;
}

test('routes to the handler and wraps its result with the request id', async () => {
  const handlers = new Map<string, MethodHandler>([['tasks/get', mock(() => ({ kind: 'task' }))]]);
  const response = await dispatch(request('tasks/get', 9), handlers);
  expect(response).toEqual({ jsonrpc: '2.0', id: 9, result: { kind: 'task' } });
});

test('awaits an async handler result', async () => {
  const handlers = new Map<string, MethodHandler>([['message/send', mock(async () => 'done')]]);
  const response = await dispatch(request('message/send'), handlers);
  expect(response).toEqual({ jsonrpc: '2.0', id: 1, result: 'done' });
});

test('returns METHOD_NOT_FOUND for an unregistered method and echoes the id', async () => {
  const response = await dispatch(request('unknown/method', 4), new Map());
  expect(response).toEqual({
    jsonrpc: '2.0',
    id: 4,
    error: { code: JSON_RPC_ERRORS.METHOD_NOT_FOUND, message: 'Method not found' },
  });
});

test('maps a handler JsonRpcError onto its code', async () => {
  const handlers = new Map<string, MethodHandler>([
    ['tasks/cancel', mock(() => { throw new JsonRpcError(A2A_ERRORS.TASK_NOT_FOUND, 'Task not found'); })],
  ]);
  const response = await dispatch(request('tasks/cancel'), handlers);
  expect(response).toMatchObject({ error: { code: A2A_ERRORS.TASK_NOT_FOUND } });
});

test('maps an unexpected handler throw onto INTERNAL_ERROR', async () => {
  const handlers = new Map<string, MethodHandler>([
    ['message/send', mock(() => { throw new Error('boom'); })],
  ]);
  const response = await dispatch(request('message/send'), handlers);
  expect(response).toMatchObject({ error: { code: JSON_RPC_ERRORS.INTERNAL_ERROR } });
});

test('uses null id when the request omits it', async () => {
  const handlers = new Map<string, MethodHandler>([['ping', mock(() => 'ok')]]);
  const response = await dispatch(request('ping', null), handlers);
  expect(response.id).toBeNull();
});
