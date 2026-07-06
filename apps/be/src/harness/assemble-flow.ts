import type { WorkflowDef } from './workflows';
import { buildWorkflow } from './build-workflow';
import { assembleChain, type AssembleInput, type AssembleDeps } from './assemble-chain';

export interface AssembledFlow {
  workflow: WorkflowDef;
  /** SDK session of the assemble decision, '' when it degraded (recorded truthfully). */
  sessionId: string;
}

/**
 * Compose a flow: the agent judges which steps the task needs (assembleChain), then the
 * mechanical safety wall (buildWorkflow) forces the grammar. If the agent call fails, degrade
 * to buildWorkflow's conditional skeleton on empty picks — the unbounded tail is bounded by
 * SHAPE, so a task is never rejected for "no plan".
 */
export async function assembleFlow(input: AssembleInput, deps: AssembleDeps = {}): Promise<AssembledFlow> {
  try {
    const { picks, sessionId } = await assembleChain(input, deps);
    return { workflow: buildWorkflow(input.seed, picks), sessionId };
  } catch {
    return { workflow: buildWorkflow(input.seed, []), sessionId: '' };
  }
}
