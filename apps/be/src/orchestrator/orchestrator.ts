import type { WorkflowDef } from '../harness/workflows';
import type { AgentEvent, OrchestratorStore, StepExecutor, StepOutput } from './types';

export interface RunFlowDeps {
  store: OrchestratorStore;
  executor: StepExecutor;
  newId: () => string;
  /** The originating user request, threaded into each step context. */
  request: string;
  /** Link the created flow to its work item at creation time (for live UI rendering). */
  workItemId?: string;
  /** Sink for live agent-output events, keyed by step-run id (wired to per-step SSE). */
  onAgentEvent?: (stepRunId: string, event: AgentEvent) => void;
  /** When true, pause after Decide for a human approval (HITL). */
  hitl?: boolean;
  /** Raise a human decision and resolve with the answer (flow is suspended while awaiting). */
  requestDecision?: (d: { flowId: string; step: string; question: string; options: string[] }) => Promise<string>;
  /** Persist a learning extracted at Reflect. */
  onLearning?: (l: { flowId: string; text: string }) => void | Promise<void>;
  /** Max producer⇄reviewer attempts per step before abandoning (default 3). */
  maxAttempts?: number;
}

export interface FlowResult {
  flowId: string;
  status: 'completed' | 'abandoned';
}

/**
 * Drive an assembled step sequence (WorkflowDef): each step runs producer (+ reviewer gate),
 * retrying on reviewer FAIL up to maxAttempts; a step that never passes abandons the flow.
 * The workflow is composed upstream (agent picks → buildWorkflow) — the orchestrator is a dumb
 * executor of StepDef[]. All transitions persist through the store; agent execution behind the
 * executor (SRP).
 */
export async function runFlow(workflow: WorkflowDef, deps: RunFlowDeps): Promise<FlowResult> {
  const maxAttempts = deps.maxAttempts ?? 3;
  const flowId = deps.newId();
  await deps.store.createFlow({
    id: flowId,
    flowType: workflow.flowType,
    status: 'active',
    currentStep: workflow.steps[0]!.name,
    workItemId: deps.workItemId,
  });

  const priorOutputs: StepOutput[] = [];

  for (const step of workflow.steps) {
    await deps.store.setCurrentStep(flowId, step.name);

    let passed = false;
    let output: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const base = { flowId, flowType: workflow.flowType, step: step.name, attempt, request: deps.request, priorOutputs };

      const producerId = deps.newId();
      await deps.store.startStepRun({ id: producerId, flowId, step: step.name, role: 'producer', attempt });
      ({ output } = await deps.executor.produce({
        ...base,
        emit: (e) => deps.onAgentEvent?.(producerId, e),
      }));
      await deps.store.finishStepRun(producerId, 'done');

      if (!step.reviewer) {
        passed = true;
        break;
      }

      const reviewerId = deps.newId();
      await deps.store.startStepRun({ id: reviewerId, flowId, step: step.name, role: 'reviewer', attempt });
      const review = await deps.executor.review({
        ...base,
        producerOutput: output,
        emit: (e) => deps.onAgentEvent?.(reviewerId, e),
      });
      await deps.store.finishStepRun(reviewerId, review.verdict === 'pass' ? 'done' : 'rejected', review.verdict);
      if (review.verdict === 'pass') {
        passed = true;
        break;
      }
    }

    if (!passed) {
      await deps.store.setStatus(flowId, 'abandoned');
      return { flowId, status: 'abandoned' };
    }
    priorOutputs.push({ step: step.name, output });

    // HITL gate: blazewrit's model is "the human makes the decisions" — pause at Decide
    // and surface the choice to the inbox (agent-initiated, not a user-toggled option).
    if (step.name === 'decide' && deps.requestDecision) {
      await deps.store.setStatus(flowId, 'suspended');
      const answer = await deps.requestDecision({
        flowId,
        step: step.name,
        question: `"${deps.request}" — 이 방향으로 진행할까요?`,
        options: ['approve', 'reject'],
      });
      await deps.store.setStatus(flowId, 'active');
      if (answer === 'reject') {
        await deps.store.setStatus(flowId, 'abandoned');
        return { flowId, status: 'abandoned' };
      }
    }

    // Reflect: persist a learning.
    if (step.name === 'reflect') {
      await deps.onLearning?.({ flowId, text: `Learned from "${deps.request}" (${workflow.flowType}).` });
    }
  }

  await deps.store.setStatus(flowId, 'completed');
  return { flowId, status: 'completed' };
}
