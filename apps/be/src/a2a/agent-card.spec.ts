import { test, expect } from 'bun:test';
import type { AgentSkill } from '@bw/dto';
import { buildAgentCard, seedProjectCard } from './agent-card';

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

// --- common base (spec-conformant fields generated uniformly) ---

test('advertises the common base: protocolVersion, provider, transport', () => {
  const card = buildAgentCard(input());
  expect(card.protocolVersion).toBeTruthy();
  expect(card.provider?.organization).toBe('blazewrit');
  expect(card.preferredTransport).toBe('JSONRPC');
});

test('advertises stateTransitionHistory and json output mode', () => {
  const card = buildAgentCard(input());
  expect(card.capabilities.stateTransitionHistory).toBe(true);
  expect(card.defaultInputModes).toContain('text/plain');
  expect(card.defaultOutputModes).toContain('application/json');
});

// --- seedProjectCard: common base + a domain skill from the intent ---

test('seedProjectCard merges the common base for a new project', () => {
  const card = seedProjectCard({ projectId: 'cart', name: '장바구니', intent: '장바구니 담기 기능' });
  expect(card.provider?.organization).toBe('blazewrit');
  expect(card.capabilities.streaming).toBe(true);
  expect(card.capabilities.stateTransitionHistory).toBe(true);
  expect(card.url).toContain('cart');
});

test('seedProjectCard seeds one domain skill from the intent', () => {
  const card = seedProjectCard({ projectId: 'cart', name: '장바구니', intent: '장바구니 담기 기능' });
  expect(card.name).toBe('장바구니');
  expect(card.skills).toHaveLength(1);
  const [skill] = card.skills;
  expect(skill?.description).toBe('장바구니 담기 기능');
  expect(skill?.id).toBe('cart');
});
