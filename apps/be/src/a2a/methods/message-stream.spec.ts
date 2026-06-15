import { test, expect } from 'bun:test';
import {
  JSON_RPC_ERRORS,
  type JsonRpcRequestDto,
  type A2AStreamEvent,
} from '@bw/dto';
import { makeMessageStream, type StreamRunner } from './message-stream';
import { JsonRpcError } from '../types';

const validMessage = {
  kind: 'message',
  messageId: 'm1',
  role: 'user',
  parts: [{ kind: 'text', text: 'hi' }],
};

function streamRequest(message: unknown): JsonRpcRequestDto {
  return { jsonrpc: '2.0', method: 'message/stream', id: 5, params: { message } } as JsonRpcRequestDto;
}

function runnerOf(events: A2AStreamEvent[]): StreamRunner {
  return {
    async *stream() {
      for (const event of events) yield event;
    },
  };
}

const working: A2AStreamEvent = {
  kind: 'status-update',
  taskId: 't1',
  contextId: 'c1',
  status: { state: 'working' },
  final: false,
};
const completed: A2AStreamEvent = {
  kind: 'status-update',
  taskId: 't1',
  contextId: 'c1',
  status: { state: 'completed' },
  final: true,
};

test('wraps each runner event in a JSON-RPC frame in order, echoing the id', async () => {
  const handler = makeMessageStream(runnerOf([working, completed]));
  const frames = [];
  for await (const frame of handler(streamRequest(validMessage))) frames.push(frame);
  expect(frames).toEqual([
    { jsonrpc: '2.0', id: 5, result: working },
    { jsonrpc: '2.0', id: 5, result: completed },
  ]);
});

test('marks the terminal frame final', async () => {
  const handler = makeMessageStream(runnerOf([working, completed]));
  const frames = [];
  for await (const frame of handler(streamRequest(validMessage))) frames.push(frame);
  expect((frames.at(-1)?.result as A2AStreamEvent & { final: boolean }).final).toBe(true);
});

test('throws INVALID_PARAMS when consuming a stream for an invalid message', async () => {
  const handler = makeMessageStream(runnerOf([working]));
  const gen = handler(streamRequest({ kind: 'message', messageId: 'm1', role: 'user', parts: [{ kind: 'bad' }] }));
  const err = await gen.next().catch((e) => e);
  expect(err).toBeInstanceOf(JsonRpcError);
  expect((err as JsonRpcError).code).toBe(JSON_RPC_ERRORS.INVALID_PARAMS);
});
