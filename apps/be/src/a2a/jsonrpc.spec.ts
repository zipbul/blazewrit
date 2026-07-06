import { test, expect } from 'bun:test';
import { JSON_RPC_ERRORS } from '@bw/dto';
import { parseJsonRpc } from './jsonrpc';

test('parses a valid JSON-RPC request and preserves the method', () => {
  const raw = JSON.stringify({ jsonrpc: '2.0', method: 'message/send', id: 1, params: {} });
  const result = parseJsonRpc(raw);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.request.method).toBe('message/send');
});

test('accepts a notification that omits the id', () => {
  const raw = JSON.stringify({ jsonrpc: '2.0', method: 'message/send' });
  expect(parseJsonRpc(raw).ok).toBe(true);
});

test('returns PARSE_ERROR with null id for malformed JSON', () => {
  const result = parseJsonRpc('{not json');
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.response.error.code).toBe(JSON_RPC_ERRORS.PARSE_ERROR);
    expect(result.response.id).toBeNull();
  }
});

test('returns INVALID_REQUEST when the jsonrpc field is missing', () => {
  const result = parseJsonRpc(JSON.stringify({ method: 'message/send', id: 1 }));
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.response.error.code).toBe(JSON_RPC_ERRORS.INVALID_REQUEST);
});

test('returns INVALID_REQUEST when the jsonrpc version is not 2.0', () => {
  const result = parseJsonRpc(JSON.stringify({ jsonrpc: '1.0', method: 'message/send', id: 1 }));
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.response.error.code).toBe(JSON_RPC_ERRORS.INVALID_REQUEST);
});

test('returns INVALID_REQUEST when the method is missing', () => {
  const result = parseJsonRpc(JSON.stringify({ jsonrpc: '2.0', id: 1 }));
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.response.error.code).toBe(JSON_RPC_ERRORS.INVALID_REQUEST);
});

test('echoes the request id on an invalid request', () => {
  const result = parseJsonRpc(JSON.stringify({ jsonrpc: '2.0', id: 7 }));
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.response.id).toBe(7);
});
