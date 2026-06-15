import { test, expect } from 'bun:test';
import type { TaskDto } from '@bw/dto';
import { createA2AApp, type A2ADeps } from './app';
import { buildAgentCard } from './agent-card';
import { makeBearerAuthenticator } from './auth/authenticate';
import { makeRelationshipAuthorizer } from './auth/authorize';
import type { MethodHandler } from './dispatch';
import type { Principal } from './auth/principal';

const TASK: TaskDto = { kind: 'task', id: 't1', contextId: 'c1', status: { state: 'completed' } };

function guardedDeps(): A2ADeps {
  const tokens = new Map<string, Principal>([
    ['user-tok', { id: 'human', kind: 'user' }],
    ['peer-a', { id: 'proj-a', kind: 'peer' }],
  ]);
  const graph = new Map<string, Set<string>>([['proj-a', new Set(['p1'])]]);
  return {
    card: (id) =>
      id === 'p1'
        ? buildAgentCard({ name: 'p1', description: 'd', url: 'http://h/agents/p1/a2a', version: '1.0', skills: [] })
        : undefined,
    handlers: new Map<string, MethodHandler>([['message/send', () => TASK]]),
    authenticate: makeBearerAuthenticator(tokens),
    authorize: makeRelationshipAuthorizer(graph),
  };
}

const sendBody = JSON.stringify({
  jsonrpc: '2.0',
  method: 'message/send',
  id: 1,
  params: { message: { kind: 'message', messageId: 'm1', role: 'user', parts: [{ kind: 'text', text: 'hi' }] } },
});

function post(headers: Record<string, string>) {
  return createA2AApp(guardedDeps()).handle(
    new Request('http://localhost/agents/p1/a2a', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: sendBody,
    }),
  );
}

test('returns 401 when no bearer token is supplied', async () => {
  const res = await post({});
  expect(res.status).toBe(401);
});

test('returns 403 when the peer has no relationship to the project', async () => {
  // peer-a is related to p1, so use a token whose principal lacks the edge: reuse user? no — craft an unrelated peer
  const res = await createA2AApp({
    ...guardedDeps(),
    authenticate: makeBearerAuthenticator(new Map([['peer-x', { id: 'proj-x', kind: 'peer' }]])),
  }).handle(
    new Request('http://localhost/agents/p1/a2a', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer peer-x' },
      body: sendBody,
    }),
  );
  expect(res.status).toBe(403);
});

test('dispatches when an authorized peer calls', async () => {
  const res = await post({ authorization: 'Bearer peer-a' });
  expect(await res.json()).toEqual({ jsonrpc: '2.0', id: 1, result: TASK });
});

test('dispatches for a human user against any project', async () => {
  const res = await post({ authorization: 'Bearer user-tok' });
  expect(await res.json()).toEqual({ jsonrpc: '2.0', id: 1, result: TASK });
});

test('agent card discovery stays public (no auth required)', async () => {
  const res = await createA2AApp(guardedDeps()).handle(
    new Request('http://localhost/agents/p1/.well-known/agent.json'),
  );
  expect(res.status).toBe(200);
});
