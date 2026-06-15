import { JSON_RPC_ERRORS, type JsonRpcRequestDto } from '@bw/dto';
import { errorResponse, JsonRpcError, type JsonRpcResponse } from './types';

/** A single JSON-RPC method handler. Returns the `result` payload or throws `JsonRpcError`. */
export type MethodHandler = (request: JsonRpcRequestDto) => unknown | Promise<unknown>;

/**
 * Route a validated request to its method handler (A2A transport, protocol-only).
 * Unknown method -> METHOD_NOT_FOUND. A handler's JsonRpcError maps to its code;
 * any other throw becomes INTERNAL_ERROR. Authorization/workflow live behind the handlers.
 */
export async function dispatch(
  request: JsonRpcRequestDto,
  handlers: Map<string, MethodHandler>,
): Promise<JsonRpcResponse> {
  const id = request.id ?? null;
  const handler = handlers.get(request.method);
  if (!handler) {
    return errorResponse(id, JSON_RPC_ERRORS.METHOD_NOT_FOUND, 'Method not found');
  }

  try {
    const result = await handler(request);
    return { jsonrpc: '2.0', id, result };
  } catch (err) {
    if (err instanceof JsonRpcError) {
      return errorResponse(id, err.code, err.message, err.data);
    }
    return errorResponse(id, JSON_RPC_ERRORS.INTERNAL_ERROR, 'Internal error');
  }
}
