import type { MessageDto, TaskDto, TaskState } from '@bw/dto';
import type { TaskRunner } from '../methods/message-send';
import type { FlowClassifier } from '../../triage/triage';
import { runFlow } from '../../orchestrator/orchestrator';
import { WORKFLOWS } from '../../harness/workflows';
import { buildWorkflow } from '../../harness/build-workflow';
import type { OrchestratorStore, StepExecutor } from '../../orchestrator/types';
import type { TaskStore } from './task-store';

export interface OrchestratorRunnerDeps {
  triage: FlowClassifier;
  store: OrchestratorStore;
  executor: StepExecutor;
  newId: () => string;
  /** A2A-facing task store so the produced Task is retrievable via tasks/get. */
  taskStore: TaskStore;
}

function firstText(message: MessageDto): string {
  for (const part of message.parts) {
    if (part.kind === 'text') return part.text;
  }
  return '';
}

/**
 * Bridges A2A message/send to Triage → workflow execution. The flow id becomes the Task id;
 * flow status maps to Task state. Replaces the StubTaskRunner.
 */
export class OrchestratorRunner implements TaskRunner {
  constructor(private readonly deps: OrchestratorRunnerDeps) {}

  async run(message: MessageDto): Promise<TaskDto> {
    const request = firstText(message);
    const flowType = this.deps.triage.classify(request);

    if (!WORKFLOWS[flowType]) {
      const id = this.deps.newId();
      const rejected: TaskDto = {
        kind: 'task',
        id,
        contextId: message.contextId ?? this.deps.newId(),
        status: { state: 'rejected' },
      };
      this.deps.taskStore.save(rejected);
      return rejected;
    }

    const workflow = buildWorkflow(flowType, WORKFLOWS[flowType].steps.map((s) => s.name));
    const result = await runFlow(workflow, {
      store: this.deps.store,
      executor: this.deps.executor,
      newId: this.deps.newId,
      request,
    });

    const state: TaskState = result.status === 'completed' ? 'completed' : 'failed';
    const task: TaskDto = {
      kind: 'task',
      id: result.flowId,
      contextId: message.contextId ?? this.deps.newId(),
      status: { state },
    };
    this.deps.taskStore.save(task);
    return task;
  }
}
