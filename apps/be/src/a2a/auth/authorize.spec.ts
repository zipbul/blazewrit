import { test, expect } from 'bun:test';
import { makeRelationshipAuthorizer } from './authorize';

const graph = new Map<string, Set<string>>([['proj-a', new Set(['proj-b'])]]);
const authorize = makeRelationshipAuthorizer(graph);

test('allows a peer with a declared relationship edge', () => {
  expect(authorize({ id: 'proj-a', kind: 'peer' }, 'proj-b')).toBe(true);
});

test('denies a peer without a relationship edge', () => {
  expect(authorize({ id: 'proj-a', kind: 'peer' }, 'proj-c')).toBe(false);
});

test('allows a human user against any project', () => {
  expect(authorize({ id: 'human', kind: 'user' }, 'proj-c')).toBe(true);
});

test('allows a project to act on itself', () => {
  expect(authorize({ id: 'proj-a', kind: 'peer' }, 'proj-a')).toBe(true);
});
