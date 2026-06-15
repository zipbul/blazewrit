import { test, expect } from 'bun:test';
import type { TaskDto } from '@bw/dto';
import { composeA2A } from './compose';
import type { AgentCardInput } from './agent-card';

const projects = new Map<string, AgentCardInput>([
  ['p1', { name: 'p1', description: 'd', url: 'http://h/agents/p1/a2a', version: '1.0', skills: [] }],
]);

function sendBody() {
  return JSON.stringify({
    jsonrpc: '2.0',
    method: 'message/send',
    id: 1,
    params: { message: { kind: 'message', messageId: 'm1', role: 'user', parts: [{ kind: 'text', text: 'hi' }] } },
  });
}

function postRequest(body: string) {
  return new Request('http://localhost/agents/p1/a2a', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

test('message/send drives a task to completed through the composed stack', async () => {
  const app = composeA2A({ projects, newId: (() => { let i = 0; return () => `id-${i++}`; })() });
  const res = await app.handle(postRequest(sendBody()));
  const body = (await res.json()) as { result: TaskDto };
  expect(body.result.status.state).toBe('completed');
});

test('a sent task is afterwards retrievable via tasks/get', async () => {
  const app = composeA2A({ projects, newId: (() => { let i = 0; return () => `id-${i++}`; })() });
  const sent = (await (await app.handle(postRequest(sendBody()))).json()) as { result: TaskDto };
  const taskId = sent.result.id;

  const getRes = await app.handle(
    postRequest(JSON.stringify({ jsonrpc: '2.0', method: 'tasks/get', id: 2, params: { id: taskId } })),
  );
  const got = (await getRes.json()) as { result: TaskDto };
  expect(got.result.id).toBe(taskId);
  expect(got.result.status.state).toBe('completed');
});

test('serves the composed agent card', async () => {
  const app = composeA2A({ projects });
  const res = await app.handle(new Request('http://localhost/agents/p1/.well-known/agent.json'));
  expect(res.status).toBe(200);
});
