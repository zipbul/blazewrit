import { test, expect, mock } from 'bun:test';
import { JSON_RPC_ERRORS, type JsonRpcRequestDto, type MessageDto, type TaskDto } from '@bw/dto';
import { makeMessageSend, type TaskRunner } from './message-send';
import { JsonRpcError } from '../types';

const TASK: TaskDto = {
  kind: 'task',
  id: 't1',
  contextId: 'c1',
  status: { state: 'completed' },
};

function sendRequest(message: unknown): JsonRpcRequestDto {
  return { jsonrpc: '2.0', method: 'message/send', id: 1, params: { message } } as JsonRpcRequestDto;
}

const validMessage = {
  kind: 'message',
  messageId: 'm1',
  role: 'user',
  parts: [{ kind: 'text', text: 'add login' }],
};

async function thrownError(p: unknown): Promise<JsonRpcError> {
  const err = await Promise.resolve(p).catch((e) => e);
  expect(err).toBeInstanceOf(JsonRpcError);
  return err as JsonRpcError;
}

test('returns the task produced by the runner for a valid message', async () => {
  const handler = makeMessageSend({ run: mock(() => TASK) });
  await expect(handler(sendRequest(validMessage))).resolves.toBe(TASK);
});

test('hands the runner the message from params', async () => {
  const run = mock((_m: MessageDto) => TASK);
  const runner: TaskRunner = { run };
  await makeMessageSend(runner)(sendRequest(validMessage));
  expect(run).toHaveBeenCalledTimes(1);
});

test('rejects with INVALID_PARAMS when message is missing', async () => {
  const handler = makeMessageSend({ run: mock(() => TASK) });
  const err = await thrownError(handler({ jsonrpc: '2.0', method: 'message/send', id: 1, params: {} } as JsonRpcRequestDto));
  expect(err.code).toBe(JSON_RPC_ERRORS.INVALID_PARAMS);
});

test('rejects with INVALID_PARAMS for a part with an unknown kind', async () => {
  const handler = makeMessageSend({ run: mock(() => TASK) });
  const bad = { kind: 'message', messageId: 'm1', role: 'user', parts: [{ kind: 'bogus', text: 'x' }] };
  const err = await thrownError(handler(sendRequest(bad)));
  expect(err.code).toBe(JSON_RPC_ERRORS.INVALID_PARAMS);
});

test('rejects with INVALID_PARAMS when a text part is missing its text', async () => {
  const handler = makeMessageSend({ run: mock(() => TASK) });
  const bad = { kind: 'message', messageId: 'm1', role: 'user', parts: [{ kind: 'text' }] };
  const err = await thrownError(handler(sendRequest(bad)));
  expect(err.code).toBe(JSON_RPC_ERRORS.INVALID_PARAMS);
});
