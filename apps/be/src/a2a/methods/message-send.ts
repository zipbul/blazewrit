import { validateSync } from '@zipbul/baker';
import { JSON_RPC_ERRORS, MessageSendParamsDto, type MessageDto, type TaskDto } from '@bw/dto';
import { JsonRpcError } from '../types';
import type { MethodHandler } from '../dispatch';

/**
 * Executes a message into a Task. The real implementation is Triage -> orchestrator;
 * the transport only knows this interface (SRP). Stubbed until those land.
 */
export interface TaskRunner {
  run(message: MessageDto): TaskDto | Promise<TaskDto>;
}

/**
 * `message/send` handler (spec §7.1): validate params, hand the message to the runner,
 * return the resulting Task. Workflow execution lives behind the injected runner.
 */
export function makeMessageSend(runner: TaskRunner): MethodHandler {
  return async (request) => {
    if (validateSync(MessageSendParamsDto, request.params) !== true) {
      throw new JsonRpcError(JSON_RPC_ERRORS.INVALID_PARAMS, 'Invalid params');
    }
    const { message } = request.params as { message: MessageDto };
    return await runner.run(message);
  };
}
