import { test, expect } from 'bun:test';
import { A2A_ERRORS, type JsonRpcRequestDto } from '@bw/dto';
import { pushConfigSet } from './push-config';
import { JsonRpcError } from '../types';

test('rejects with PUSH_NOTIFICATION_NOT_SUPPORTED', async () => {
  const request = {
    jsonrpc: '2.0',
    method: 'tasks/pushNotificationConfig/set',
    id: 1,
    params: {},
  } as JsonRpcRequestDto;
  let err: unknown;
  try {
    pushConfigSet(request);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(JsonRpcError);
  expect((err as JsonRpcError).code).toBe(A2A_ERRORS.PUSH_NOTIFICATION_NOT_SUPPORTED);
});
