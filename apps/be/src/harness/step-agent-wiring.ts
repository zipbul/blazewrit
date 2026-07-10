import type { StepContext } from '../orchestrator/types';
import { withMindset } from './mindset';
import { REVIEWER_PROMPT, STEP_AGENTS } from './step-agents';

/**
 * Bridge STEP_AGENTS into the executor hook: every agent gets the platform constitution
 * (mindset) + its identity — producer under the step's identity, every reviewer as the one
 * generic judge. Unknown steps get no identity (the executor stays generic — the grammar,
 * not this file, decides what steps exist).
 */
export function stepAgentSystemPrompt(ctx: StepContext, role: 'producer' | 'reviewer'): string | undefined {
  if (role === 'reviewer') return withMindset(REVIEWER_PROMPT);
  const identity = STEP_AGENTS[ctx.step]?.prompt;
  return identity ? withMindset(identity) : undefined;
}
