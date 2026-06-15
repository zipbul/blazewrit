import { test, expect } from 'bun:test';
import { JSON_RPC_ERRORS, A2A_ERRORS, type TaskDto } from '@bw/dto';
import { createA2AApp, type A2ADeps } from './app';
import { buildAgentCard } from './agent-card';
import { pushConfigSet } from './methods/push-config';
import { makeMessageStream } from './methods/message-stream';
import type { MethodHandler } from './dispatch';

const TASK: TaskDto = { kind: 'task', id: 't1', contextId: 'c1', status: { state: 'completed' } };

function deps(): A2ADeps {
  const handlers = new Map<string, MethodHandler>([
    ['message/send', () => TASK],
    ['tasks/pushNotificationConfig/set', pushConfigSet],
  ]);
  return {
    card: (projectId) =>
      projectId === 'p1'
        ? buildAgentCard({ name: 'p1', description: 'd', url: 'http://h/agents/p1/a2a', version: '1.0', skills: [] })
        : undefined,
    handlers,
    stream: makeMessageStream({
      async *stream() {
        yield { kind: 'status-update', taskId: 't1', contextId: 'c1', status: { state: 'completed' }, final: true };
      },
    }),
  };
}

function post(app: ReturnType<typeof createA2AApp>, raw: string) {
  return app.handle(
    new Request('http://localhost/agents/p1/a2a', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw,
    }),
  );
}

const sendBody = JSON.stringify({
  jsonrpc: '2.0',
  method: 'message/send',
  id: 1,
  params: { message: { kind: 'message', messageId: 'm1', role: 'user', parts: [{ kind: 'text', text: 'hi' }] } },
});

test('serves the agent card at the well-known path', async () => {
  const res = await createA2AApp(deps()).handle(new Request('http://localhost/agents/p1/.well-known/agent.json'));
  expect(res.status).toBe(200);
  const card = (await res.json()) as { capabilities: { pushNotifications: boolean } };
  expect(card.capabilities.pushNotifications).toBe(false);
});

test('returns 404 for an unknown project card', async () => {
  const res = await createA2AApp(deps()).handle(new Request('http://localhost/agents/zzz/.well-known/agent.json'));
  expect(res.status).toBe(404);
});

test('dispatches message/send and returns the task result', async () => {
  const res = await post(createA2AApp(deps()), sendBody);
  expect(await res.json()).toEqual({ jsonrpc: '2.0', id: 1, result: TASK });
});

test('returns METHOD_NOT_FOUND for an unknown method', async () => {
  const res = await post(createA2AApp(deps()), JSON.stringify({ jsonrpc: '2.0', method: 'nope', id: 2 }));
  const body = (await res.json()) as { error: { code: number } };
  expect(body.error.code).toBe(JSON_RPC_ERRORS.METHOD_NOT_FOUND);
});

test('returns PARSE_ERROR for a malformed body', async () => {
  const res = await post(createA2AApp(deps()), '{not json');
  const body = (await res.json()) as { error: { code: number } };
  expect(body.error.code).toBe(JSON_RPC_ERRORS.PARSE_ERROR);
});

test('returns PUSH_NOTIFICATION_NOT_SUPPORTED for push config set', async () => {
  const res = await post(
    createA2AApp(deps()),
    JSON.stringify({ jsonrpc: '2.0', method: 'tasks/pushNotificationConfig/set', id: 3, params: {} }),
  );
  const body = (await res.json()) as { error: { code: number } };
  expect(body.error.code).toBe(A2A_ERRORS.PUSH_NOTIFICATION_NOT_SUPPORTED);
});

test('streams message/stream as server-sent events', async () => {
  const res = await post(
    createA2AApp(deps()),
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'message/stream',
      id: 4,
      params: { message: { kind: 'message', messageId: 'm1', role: 'user', parts: [{ kind: 'text', text: 'hi' }] } },
    }),
  );
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  expect(await res.text()).toContain('data:');
});
