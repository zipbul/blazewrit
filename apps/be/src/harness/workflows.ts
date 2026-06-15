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

const withReviewer = (name: string): StepDef => ({ name, reviewer: true });
const noReviewer = (name: string): StepDef => ({ name, reviewer: false });

/**
 * Workflow definitions = the confirmed step sequence per flow type.
 * feature: Ground → Investigate → Decide → Spec → Test → Implement → Verify → Reflect
 * (Verify/Reflect have no reviewer.) Only feature is defined for now.
 */
export const WORKFLOWS: Partial<Record<FlowType, WorkflowDef>> = {
  feature: {
    flowType: 'feature',
    steps: [
      withReviewer('ground'),
      withReviewer('investigate'),
      withReviewer('decide'),
      withReviewer('spec'),
      withReviewer('test'),
      withReviewer('implement'),
      noReviewer('verify'),
      noReviewer('reflect'),
    ],
  },
};

export function getWorkflow(flowType: FlowType): WorkflowDef | undefined {
  return WORKFLOWS[flowType];
}
