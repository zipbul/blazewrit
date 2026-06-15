import { test, expect } from 'bun:test';
import { InMemoryRegistry } from './registry';
import type { AgentCardInput } from '../agent-card';

const input: AgentCardInput = {
  name: 'p1',
  description: 'project one',
  url: 'http://h/agents/p1/a2a',
  version: '1.0',
  skills: [{ id: 'feature', name: 'Feature', description: 'add feature', tags: ['code'] }],
};

test('builds the agent card for a known project', () => {
  const registry = new InMemoryRegistry(new Map([['p1', input]]));
  expect(registry.card('p1')?.name).toBe('p1');
});

test('returns undefined for an unknown project', () => {
  const registry = new InMemoryRegistry(new Map([['p1', input]]));
  expect(registry.card('zzz')).toBeUndefined();
});
