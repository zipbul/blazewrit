import { describe, expect, it } from 'bun:test';
import { buildWorkflow, KNOWN_STEPS } from './build-workflow';

/**
 * The safety wall: the AGENT emits an ordered list of step names; buildWorkflow forces the fixed
 * grammar mechanically (no parser). 100% of the safety, 0% of the nondeterminism lives here.
 */
const names = (flowType: string, picks: string[]) => buildWorkflow(flowType, picks).steps.map((s) => s.name);
const gated = (flowType: string, picks: string[]) =>
  Object.fromEntries(buildWorkflow(flowType, picks).steps.map((s) => [s.name, s.reviewer]));

describe('buildWorkflow — fixed grammar over agent picks', () => {
  it('keeps a valid mutating chain and stamps reviewer gates from NO_REVIEWER', () => {
    const picks = ['ground', 'investigate', 'decide', 'spec', 'test', 'implement', 'verify', 'reflect'];
    const g = gated('feature', picks);
    expect(names('feature', picks)).toEqual(picks);
    // producing steps gated; verify/reflect self-verify (no gate)
    expect(g.implement).toBe(true);
    expect(g.verify).toBe(false);
    expect(g.reflect).toBe(false);
  });

  it('forces ground as the first step even if the agent omits or misplaces it', () => {
    expect(names('feature', ['investigate', 'implement'])[0]).toBe('ground');
    expect(names('feature', ['implement', 'ground'])[0]).toBe('ground');
  });

  it('forces the mutation spine: any chain containing implement must end verify → reflect', () => {
    const n = names('feature', ['ground', 'implement']);
    expect(n.slice(-2)).toEqual(['verify', 'reflect']);
  });

  it('a non-mutating chain ends with reflect (no verify)', () => {
    const n = names('research', ['ground', 'investigate', 'report']);
    expect(n.at(-1)).toBe('reflect');
    expect(n).not.toContain('verify');
  });

  it('drops any name outside the known vocabulary', () => {
    const n = names('feature', ['ground', 'deploy', 'implement', 'hack']);
    expect(n.every((s) => (KNOWN_STEPS as readonly string[]).includes(s))).toBe(true);
    expect(n).not.toContain('deploy');
    expect(n).not.toContain('hack');
  });

  it('the agent never controls gates — reviewer is derived, not taken from picks', () => {
    // even if a caller tried to force verify to be gated, the builder decides
    const g = gated('feature', ['ground', 'test', 'implement', 'verify', 'reflect']);
    expect(g.test).toBe(true);
    expect(g.verify).toBe(false);
  });

  it('caps the chain at 10 steps (no runaway plan)', () => {
    const huge = ['ground', ...Array(30).fill('investigate'), 'implement'];
    expect(buildWorkflow('feature', huge).steps.length).toBeLessThanOrEqual(10);
  });

  it('degrades an empty/degenerate mutating pick to [ground, implement, verify, reflect]', () => {
    expect(names('bugfix', [])).toEqual(['ground', 'implement', 'verify', 'reflect']);
    expect(names('chore', ['garbage'])).toEqual(['ground', 'implement', 'verify', 'reflect']);
  });

  it('degrades a non-mutating degenerate pick to [ground, reflect]', () => {
    expect(names('research', [])).toEqual(['ground', 'reflect']);
  });

  it('dedups repeated names while preserving order', () => {
    const n = names('feature', ['ground', 'investigate', 'investigate', 'implement']);
    expect(n.filter((s) => s === 'investigate').length).toBe(1);
  });

  it('never emits a chain that fails its own grammar (idempotent under rebuild)', () => {
    const once = names('feature', ['ground', 'spec', 'implement']);
    const twice = names('feature', once);
    expect(twice).toEqual(once);
  });
});
