import { test, expect, beforeEach } from 'bun:test';
import type { MessageDto, A2AStreamEvent } from '@bw/dto';
import { StubTaskRunner } from './stub-runner';
import { InMemoryTaskStore } from './task-store';

const message = {
  kind: 'message',
  messageId: 'm1',
  role: 'user',
  parts: [{ kind: 'text', text: 'hi' }],
} as MessageDto;

function seqIds(...ids: string[]): () => string {
  let i = 0;
  return () => ids[i++] ?? 'extra';
}

let store: InMemoryTaskStore;
beforeEach(() => {
  store = new InMemoryTaskStore();
});

test('run produces a completed task using the injected ids', () => {
  const runner = new StubTaskRunner(store, seqIds('task-1', 'ctx-1'));
  const task = runner.run(message);
  expect(task).toMatchObject({ kind: 'task', id: 'task-1', contextId: 'ctx-1', status: { state: 'completed' } });
});

test('run persists the completed task to the store', () => {
  const runner = new StubTaskRunner(store, seqIds('task-1', 'ctx-1'));
  runner.run(message);
  expect(store.get('task-1')?.status.state).toBe('completed');
});

test('run reuses an incoming contextId instead of generating one', () => {
  const runner = new StubTaskRunner(store, seqIds('task-1', 'ctx-unused'));
  const task = runner.run({ ...message, contextId: 'given-ctx' });
  expect(task.contextId).toBe('given-ctx');
});

test('stream emits working then completed(final) updates', async () => {
  const runner = new StubTaskRunner(store, seqIds('task-1', 'ctx-1'));
  const events: A2AStreamEvent[] = [];
  for await (const event of runner.stream(message)) events.push(event);
  expect(events.map((e) => (e as Extract<A2AStreamEvent, { status: unknown }>).status.state)).toEqual([
    'working',
    'completed',
  ]);
  expect((events.at(-1) as { final: boolean }).final).toBe(true);
});
