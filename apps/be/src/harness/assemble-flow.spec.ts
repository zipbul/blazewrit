import { describe, expect, it } from 'bun:test';
import { assembleFlow } from './assemble-flow';
import type { QueryFn } from '../orchestrator/infra/agent-step-executor';

/**
 * assembleFlow ties the ONE agent judgment call (assembleChain) to the mechanical safety wall
 * (buildWorkflow): seed + ground facts → a validated WorkflowDef + the assemble session id.
 * If the agent call fails, it degrades to buildWorkflow's conditional skeleton rather than
 * abandoning the task (the tail is bounded by SHAPE, never rejected).
 */
function fakeQuery(steps: Array<{ name: string; why: string }>, sessionId = 's1'): QueryFn {
  return async function* () {
    yield { type: 'result', subtype: 'success', structured_output: { steps }, session_id: sessionId } as never;
  };
}

describe('assembleFlow', () => {
  it('turns agent picks into a grammar-valid WorkflowDef and carries the session id', async () => {
    const q = fakeQuery(
      [
        { name: 'investigate', why: '비자명' },
        { name: 'test', why: '테스트 있음' },
        { name: 'implement', why: '변경' },
      ],
      'asm-77',
    );
    const out = await assembleFlow(
      { seed: 'feature', facts: { mutation: true } },
      { queryFn: q },
    );
    expect(out.workflow.steps.map((s) => s.name)).toEqual([
      'ground', 'investigate', 'test', 'implement', 'verify', 'reflect',
    ]);
    expect(out.sessionId).toBe('asm-77');
  });

  it('degrades to the conditional skeleton when the agent call fails (never rejects the task)', async () => {
    const failing: QueryFn = async function* () {
      yield { type: 'result', subtype: 'error_max_turns', session_id: 'x' } as never;
    };
    const out = await assembleFlow({ seed: 'bugfix', facts: { mutation: true } }, { queryFn: failing });
    expect(out.workflow.steps.map((s) => s.name)).toEqual(['ground', 'implement', 'verify', 'reflect']);
    expect(out.sessionId).toBe(''); // no session — degraded, and that's recorded truthfully
  });
});
