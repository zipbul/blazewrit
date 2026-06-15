import type { FlowType } from '@bw/dto';

/** One step in a workflow. `reviewer` = a producer⇄reviewer gate runs for this step. */
export interface StepDef {
  name: string;
  reviewer: boolean;
}

export interface WorkflowDef {
  flowType: FlowType;
  steps: StepDef[];
}

/** Terminal/learning steps verify their own work — no producer⇄reviewer gate. */
const NO_REVIEWER = new Set(['verify', 'reflect']);
const buildSteps = (names: readonly string[]): StepDef[] =>
  names.map((name) => ({ name, reviewer: !NO_REVIEWER.has(name) }));

/**
 * Workflow definitions = the confirmed step sequence per flow type (mirrors the FE
 * FLOW_STEPS). Each flow is specialized by which steps it runs and their order.
 */
const STEP_SEQUENCES: Record<FlowType, readonly string[]> = {
  feature: ['ground', 'investigate', 'decide', 'spec', 'test', 'implement', 'verify', 'reflect'],
  bugfix: ['ground', 'investigate', 'decide', 'test', 'implement', 'verify', 'reflect'],
  refactor: ['ground', 'investigate', 'decide', 'test', 'implement', 'verify', 'reflect'],
  migration: ['ground', 'investigate', 'decide', 'spec', 'test', 'implement', 'verify', 'reflect'],
  research: ['ground', 'investigate', 'decide', 'report', 'reflect'],
  audit: ['ground', 'investigate', 'report', 'reflect'],
  chore: ['ground', 'implement', 'verify', 'reflect'],
};

export const WORKFLOWS: Record<FlowType, WorkflowDef> = Object.fromEntries(
  (Object.entries(STEP_SEQUENCES) as Array<[FlowType, readonly string[]]>).map(([flowType, names]) => [
    flowType,
    { flowType, steps: buildSteps(names) },
  ]),
) as Record<FlowType, WorkflowDef>;

export function getWorkflow(flowType: FlowType): WorkflowDef | undefined {
  return WORKFLOWS[flowType];
}
