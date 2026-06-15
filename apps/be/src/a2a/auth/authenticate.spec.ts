import { test, expect } from 'bun:test';
import { makeBearerAuthenticator } from './authenticate';
import type { Principal } from './principal';

const peer: Principal = { id: 'proj-b', kind: 'peer' };
const authenticator = makeBearerAuthenticator(new Map([['tok-b', peer]]));

test('resolves a valid bearer token to its principal', () => {
  expect(authenticator('Bearer tok-b')).toEqual(peer);
});

test('returns null when the Authorization header is absent', () => {
  expect(authenticator(undefined)).toBeNull();
});

test('returns null for a non-Bearer scheme', () => {
  expect(authenticator('Basic tok-b')).toBeNull();
});

test('returns null for an unknown token', () => {
  expect(authenticator('Bearer nope')).toBeNull();
});
