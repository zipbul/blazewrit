import { describe, expect, it } from 'bun:test';
import { KNOWN_STEPS } from './build-workflow';
import { REVIEWER_PROMPT, STEP_AGENTS } from './step-agents';

/**
 * Step agents v1: one-line identity per step. Deliberately thin until reflect data justifies
 * detail. (Tool grants were removed: allowedTools does not bind under bypassPermissions —
 * a boundary that doesn't bind is false safety.)
 */
describe('STEP_AGENTS', () => {
  it('covers every grammar step (and the v2 vocabulary ideate/ship ahead of wiring)', () => {
    for (const step of KNOWN_STEPS) expect(STEP_AGENTS[step], step).toBeDefined();
    expect(STEP_AGENTS.ideate).toBeDefined();
    expect(STEP_AGENTS.ship).toBeDefined();
  });

  it('every prompt is a single line stating the role', () => {
    for (const [name, def] of Object.entries(STEP_AGENTS)) {
      expect(def.prompt.includes('\n'), name).toBe(false);
      expect(def.prompt.startsWith('You are the '), name).toBe(true);
    }
  });

  it('the reviewer is one generic judge', () => {
    expect(REVIEWER_PROMPT.includes('\n')).toBe(false);
    expect(REVIEWER_PROMPT).toContain('never redo the work');
  });
});
