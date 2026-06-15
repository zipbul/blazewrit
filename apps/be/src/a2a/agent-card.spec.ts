import { test, expect } from 'bun:test';
import type { AgentSkill } from '@bw/dto';
import { buildAgentCard } from './agent-card';

const skills: AgentSkill[] = [{ id: 'feature', name: 'Feature', description: 'Add a feature', tags: ['code'] }];

function input() {
  return { name: 'proj', description: 'a project agent', url: 'http://h/agents/p1/a2a', version: '1.0', skills };
}

test('advertises streaming on and push notifications off (first cut)', () => {
  const card = buildAgentCard(input());
  expect(card.capabilities.streaming).toBe(true);
  expect(card.capabilities.pushNotifications).toBe(false);
});

test('passes the project skills through to the card', () => {
  expect(buildAgentCard(input()).skills).toEqual(skills);
});

test('carries the identity fields', () => {
  const card = buildAgentCard(input());
  expect(card.name).toBe('proj');
  expect(card.url).toBe('http://h/agents/p1/a2a');
  expect(card.version).toBe('1.0');
});
