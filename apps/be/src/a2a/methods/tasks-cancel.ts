import { validateSync } from '@zipbul/baker';
import { JSON_RPC_ERRORS, A2A_ERRORS, TaskIdParamsDto, type TaskDto, type TaskState } from '@bw/dto';
import { JsonRpcError } from '../types';
import type { MethodHandler } from '../dispatch';
import type { TaskStore } from '../infra/task-store';

const TERMINAL_STATES = new Set<TaskState>(['completed', 'canceled', 'failed', 'rejected']);

/** `tasks/cancel` (spec §7.4): cancel a non-terminal Task; TASK_NOT_FOUND / TASK_NOT_CANCELABLE otherwise. */
export function makeTasksCancel(store: TaskStore): MethodHandler {
  return (request) => {
    if (validateSync(TaskIdParamsDto, request.params) !== true) {
      throw new JsonRpcError(JSON_RPC_ERRORS.INVALID_PARAMS, 'Invalid params');
    }
    const { id } = request.params as { id: string };
    const task = store.get(id);
    if (!task) {
      throw new JsonRpcError(A2A_ERRORS.TASK_NOT_FOUND, 'Task not found');
    }
    if (TERMINAL_STATES.has(task.status.state)) {
      throw new JsonRpcError(A2A_ERRORS.TASK_NOT_CANCELABLE, 'Task cannot be canceled');
    }
    const canceled: TaskDto = { ...task, status: { state: 'canceled' } };
    store.save(canceled);
    return canceled;
  };
}
