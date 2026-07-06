import { validateSync } from '@zipbul/baker';
import { JSON_RPC_ERRORS, MessageSendParamsDto, type MessageDto, type A2AStreamEvent } from '@bw/dto';
import { JsonRpcError, type JsonRpcSuccessResponse } from '../types';
import type { JsonRpcRequestDto } from '@bw/dto';

/** Streams A2A events for a message. Real impl is the orchestrator; stubbed for now (SRP). */
export interface StreamRunner {
  stream(message: MessageDto): AsyncIterable<A2AStreamEvent>;
}

export type StreamHandler = (request: JsonRpcRequestDto) => AsyncGenerator<JsonRpcSuccessResponse>;

/**
 * `message/stream` (spec §7.2): validate params, then wrap each runner event in a
 * JSON-RPC success frame (the HTTP layer serializes these as SSE).
 */
export function makeMessageStream(runner: StreamRunner): StreamHandler {
  return async function* (request) {
    if (validateSync(MessageSendParamsDto, request.params) !== true) {
      throw new JsonRpcError(JSON_RPC_ERRORS.INVALID_PARAMS, 'Invalid params');
    }
    const { message } = request.params as { message: MessageDto };
    const id = request.id ?? null;
    for await (const event of runner.stream(message)) {
      yield { jsonrpc: '2.0', id, result: event };
    }
  };
}
