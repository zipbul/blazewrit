import { validateSync } from '@zipbul/baker';
import { JSON_RPC_ERRORS, JsonRpcRequestDto } from '@bw/dto';
import { errorResponse, type JsonRpcErrorResponse } from './types';

export type ParseResult =
  | { ok: true; request: JsonRpcRequestDto }
  | { ok: false; response: JsonRpcErrorResponse };

/** Recover the request id from an unvalidated payload so error responses can echo it. */
function pickId(value: unknown): string | number | null {
  if (typeof value === 'object' && value !== null && 'id' in value) {
    const id = (value as { id: unknown }).id;
    if (typeof id === 'string' || typeof id === 'number') return id;
  }
  return null;
}

/**
 * Parse + validate a raw JSON-RPC 2.0 request body (A2A transport ingress).
 * Transport-only: it does not know any method or workflow semantics.
 */
export function parseJsonRpc(raw: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, response: errorResponse(null, JSON_RPC_ERRORS.PARSE_ERROR, 'Parse error') };
  }

  if (validateSync(JsonRpcRequestDto, parsed) !== true) {
    return { ok: false, response: errorResponse(pickId(parsed), JSON_RPC_ERRORS.INVALID_REQUEST, 'Invalid Request') };
  }

  return { ok: true, request: parsed as JsonRpcRequestDto };
}
