import type { StepContext } from '../orchestrator/types';

/** Per-step producer instruction = the confirmed identity of each step (concise harness contract). */
const STEP_INSTRUCTIONS: Record<string, string> = {
  ground:
    'Gather only factual, current state of the codebase relevant to the request. READ-ONLY: do not modify anything. Report sourced facts and explicit unknowns. No interpretation or decisions.',
  investigate:
    'Interpret the facts into a problem definition: impact, constraints, risks, feasibility, alternatives. Do not choose a direction or design.',
  decide:
    'Choose one direction for the request and state the rationale. Commit to a single approach. Do not produce code structure or acceptance criteria.',
  spec:
    'Turn the chosen direction into testable acceptance criteria, a concrete code structure, and an ordered task breakdown. Do not re-decide.',
  test: 'Write failing (RED) behaviour tests that capture the acceptance criteria. Do not write production code.',
  implement: 'Write the minimal production code to make the failing tests pass (GREEN). Make atomic commits.',
  verify:
    'Confirm the whole flow achieved the request: typecheck, build, and the full test suite must pass. Report pass/fail with evidence.',
  reflect: 'Extract durable learnings and recurring patterns from this flow.',
};

/**
 * Build the prompt for a step+role (harness owns prompt content; the executor only runs it).
 * The originating request is threaded into every step.
 */
function render(output: unknown): string {
  if (output === undefined || output === null) return '(none)';
  const text = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
  if (typeof text !== 'string') return String(output);
  return text.length > 4000 ? `${text.slice(0, 4000)}\n…(truncated)` : text;
}

function priorContext(ctx: StepContext): string {
  if (ctx.priorOutputs.length === 0) return '';
  const blocks = ctx.priorOutputs.map((p) => `### ${p.step}\n${render(p.output)}`).join('\n\n');
  return `\n\nOutputs from prior steps (your context):\n${blocks}`;
}

export function buildStepPrompt(ctx: StepContext, role: 'producer' | 'reviewer'): string {
  const instruction = STEP_INSTRUCTIONS[ctx.step] ?? `Perform the "${ctx.step}" step.`;
  const header = `You are the "${ctx.step}" step of a "${ctx.flowType}" workflow.\nUser request: ${ctx.request}`;

  if (role === 'producer') {
    return `${header}${priorContext(ctx)}\n\nTask: ${instruction}`;
  }
  return `${header}${priorContext(ctx)}\n\nThe "${ctx.step}" step produced this output:\n${render(ctx.producerOutput)}\n\nJudge whether it correctly and completely did: ${instruction}\nReturn a verdict of exactly "pass" or "fail". Only fail for a concrete, named defect.`;
}
