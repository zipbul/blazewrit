import type { StepContext } from '../orchestrator/types';
import { REVIEWER_PROMPT, REVIEWER_TOOLS, STEP_AGENTS } from './step-agents';

/**
 * Bridge STEP_AGENTS into the executor hooks: producer runs under the step's identity + ring;
 * every reviewer runs as the one generic read-only judge. Unknown steps get no identity/grant
 * (the executor stays generic — the grammar, not this file, decides what steps exist).
 */
export function stepAgentSystemPrompt(ctx: StepContext, role: 'producer' | 'reviewer'): string | undefined {
  if (role === 'reviewer') return REVIEWER_PROMPT;
  return STEP_AGENTS[ctx.step]?.prompt;
}

export function stepAgentTools(ctx: StepContext, role: 'producer' | 'reviewer'): string[] | undefined {
  if (role === 'reviewer') return REVIEWER_TOOLS;
  return STEP_AGENTS[ctx.step]?.tools;
}
