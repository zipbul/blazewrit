import { describe, expect, it } from 'bun:test';
import { KNOWN_STEPS } from './build-workflow';
import { REVIEWER_PROMPT, REVIEWER_TOOLS, STEP_AGENTS } from './step-agents';

/**
 * Step agents v1: one-line identity + tool scoping (the ring is enforced by TOOLS, not prose —
 * step-taxonomy.md). Prompts stay deliberately thin until reflect data justifies detail.
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

  it('read-only steps cannot write (ring R0/R1: no Edit/Write)', () => {
    for (const name of ['ground', 'investigate', 'ideate', 'decide', 'spec', 'verify', 'report', 'reflect']) {
      const tools = STEP_AGENTS[name]!.tools;
      expect(tools, name).not.toContain('Edit');
      expect(tools, name).not.toContain('Write');
    }
  });

  it('investigate reads files in full — no Grep (정독 강제는 도구경계로)', () => {
    expect(STEP_AGENTS.investigate!.tools).not.toContain('Grep');
    expect(STEP_AGENTS.investigate!.tools).toContain('Read');
  });

  it('mutating steps write (R2); verify/ship execute but never edit', () => {
    for (const name of ['test', 'implement']) {
      expect(STEP_AGENTS[name]!.tools, name).toContain('Edit');
      expect(STEP_AGENTS[name]!.tools, name).toContain('Write');
    }
    for (const name of ['verify', 'ship']) {
      expect(STEP_AGENTS[name]!.tools, name).toContain('Bash');
      expect(STEP_AGENTS[name]!.tools, name).not.toContain('Edit');
    }
    // decide judges options already in context — it reads, nothing else.
    expect(STEP_AGENTS.decide!.tools).toEqual(['Read']);
  });

  it('the reviewer is one generic judge: read-only, never redoes the work', () => {
    expect(REVIEWER_PROMPT.includes('\n')).toBe(false);
    expect(REVIEWER_TOOLS).not.toContain('Edit');
    expect(REVIEWER_TOOLS).not.toContain('Write');
    expect(REVIEWER_TOOLS).not.toContain('Bash');
  });
});
