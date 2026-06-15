import { validateSync } from '@zipbul/baker';
import { JSON_RPC_ERRORS, A2A_ERRORS, TaskIdParamsDto } from '@bw/dto';
import { JsonRpcError } from '../types';
import type { MethodHandler } from '../dispatch';
import type { TaskStore } from '../infra/task-store';

/** `tasks/get` (spec §7.3): look up a Task by id, or TASK_NOT_FOUND. */
export function makeTasksGet(store: TaskStore): MethodHandler {
  return (request) => {
    if (validateSync(TaskIdParamsDto, request.params) !== true) {
      throw new JsonRpcError(JSON_RPC_ERRORS.INVALID_PARAMS, 'Invalid params');
    }
    const { id } = request.params as { id: string };
    const task = store.get(id);
    if (!task) {
      throw new JsonRpcError(A2A_ERRORS.TASK_NOT_FOUND, 'Task not found');
    }
    return task;
  };
}
