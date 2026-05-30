import type { FlowType, StepRunDto } from '@bw/dto';

/**
 * Canonical ordered step list per flow type (mirrors the agent flow definitions).
 * The UI metro/lanes/flowrow render against this so "status = mirror of flow" (DECISIONS §9b).
 */
export const FLOW_STEPS: Record<FlowType, readonly string[]> = {
  feature: ['ground', 'investigate', 'decide', 'spec', 'test', 'implement', 'verify', 'reflect'],
  bugfix: ['ground', 'investigate', 'decide', 'test', 'implement', 'verify', 'reflect'],
  refactor: ['ground', 'investigate', 'decide', 'test', 'implement', 'verify', 'reflect'],
  migration: ['ground', 'investigate', 'decide', 'spec', 'test', 'implement', 'verify', 'reflect'],
  research: ['ground', 'investigate', 'decide', 'report', 'reflect'],
  audit: ['ground', 'investigate', 'report', 'reflect'],
  chore: ['ground', 'implement', 'verify', 'reflect'],
};

export type StepState = 'done' | 'active' | 'pending';

export interface MetroStep {
  readonly name: string;
  readonly state: StepState;
}

export interface FlowMetro {
  readonly steps: readonly MetroStep[];
  /** Producer attempts for the active step (≥1 once started). */
  readonly attempts: number;
  /** A reviewer rejected the active step at least once. */
  readonly reviewerFailed: boolean;
  readonly activeStep: string;
}

/**
 * Derive the per-step state of a flow from its current step, optionally refined by
 * step-runs (for attempt count + reviewer-failure on the active step).
 */
export function deriveMetro(
  flowType: FlowType,
  currentStep: string,
  stepRuns: readonly StepRunDto[] = [],
): FlowMetro {
  const steps = FLOW_STEPS[flowType] ?? [];
  const currentIndex = steps.indexOf(currentStep);

  const metroSteps: MetroStep[] = steps.map((name, i) => ({
    name,
    state: currentIndex < 0 || i > currentIndex ? 'pending' : i === currentIndex ? 'active' : 'done',
  }));

  const activeRuns = stepRuns.filter((r) => r.stepName === currentStep);
  const attempts = activeRuns
    .filter((r) => r.role === 'producer')
    .reduce((max, r) => Math.max(max, r.attemptNo), 0);
  const reviewerFailed = activeRuns.some((r) => r.role === 'reviewer' && r.reviewVerdict === 'fail');

  return { steps: metroSteps, attempts, reviewerFailed, activeStep: currentStep };
}
