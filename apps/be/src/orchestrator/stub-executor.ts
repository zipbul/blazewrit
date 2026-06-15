import type { ProducerOutcome, ReviewOutcome, StepExecutor } from './types';

/**
 * TEMPORARY executor: every producer is a no-op and every reviewer passes.
 * Lets the orchestrator + A2A run end-to-end before the Claude Agent SDK executor exists.
 */
export class AutoPassStepExecutor implements StepExecutor {
  async produce(): Promise<ProducerOutcome> {
    return { output: null };
  }

  async review(): Promise<ReviewOutcome> {
    return { verdict: 'pass' };
  }
}
