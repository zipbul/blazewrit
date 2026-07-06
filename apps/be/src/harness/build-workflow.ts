import type { FlowType } from '@bw/dto';
import type { StepDef, WorkflowDef } from './workflows';

/** The closed step vocabulary. The agent may only compose names from this set. */
export const KNOWN_STEPS = [
  'ground',
  'investigate',
  'decide',
  'spec',
  'test',
  'implement',
  'verify',
  'report',
  'reflect',
] as const;

/** Terminal/self-verifying steps carry no producer⇄reviewer gate (mirrors the legacy table). */
const NO_REVIEWER = new Set(['verify', 'reflect']);
const MAX_STEPS = 10;

/**
 * The safety wall between an AGENT's proposed step order and execution. The agent emits an
 * ordered list of step names (its judgment); this pure function forces the fixed grammar
 * MECHANICALLY (no parser): vocabulary ⊂ KNOWN_STEPS, first = ground, mutation spine
 * (implement ⇒ …verify,reflect) else …reflect, gates derived (never agent-chosen), length cap,
 * and a conditional skeleton when the picks are degenerate. It is idempotent — feeding its own
 * output back yields the same chain.
 */
export function buildWorkflow(flowType: FlowType, picks: readonly string[]): WorkflowDef {
  // 1. keep only known steps, dedup preserving order, drop the spine terminals (re-added below)
  const spineTerminals = new Set(['ground', 'verify', 'reflect']);
  const seen = new Set<string>();
  const middle: string[] = [];
  for (const name of picks) {
    if (!(KNOWN_STEPS as readonly string[]).includes(name)) continue; // vocabulary wall
    if (spineTerminals.has(name)) continue; // spine is builder-owned, not picked
    if (seen.has(name)) continue; // dedup
    seen.add(name);
    middle.push(name);
  }

  const mutating = seen.has('implement');

  // 2. degenerate picks → conditional skeleton, never a single universal one
  let ordered: string[];
  if (middle.length === 0) {
    ordered = mutating || isMutatingSeed(flowType)
      ? ['ground', 'implement', 'verify', 'reflect']
      : ['ground', 'reflect'];
  } else {
    // 3. force the spine around the agent's middle
    ordered = ['ground', ...middle];
    if (mutating) ordered.push('verify', 'reflect');
    else ordered.push('reflect');
  }

  // 4. cap length (keep the head + the forced tail so the spine survives truncation)
  if (ordered.length > MAX_STEPS) {
    const tail = mutating ? ['verify', 'reflect'] : ['reflect'];
    ordered = [...ordered.slice(0, MAX_STEPS - tail.length), ...tail];
  }

  const steps: StepDef[] = ordered.map((name) => ({ name, reviewer: !NO_REVIEWER.has(name) }));
  return { flowType, steps };
}

/** A seed that implies a mutation even when the agent's picks came back empty. */
function isMutatingSeed(flowType: FlowType): boolean {
  return flowType === 'feature' || flowType === 'bugfix' || flowType === 'refactor' || flowType === 'migration' || flowType === 'chore';
}
