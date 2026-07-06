import { describe, expect, it } from 'bun:test';
import { assembleChain } from './assemble-chain';
import type { QueryFn } from '../orchestrator/infra/agent-step-executor';

/**
 * assembleChain: the ONE agent call that turns ground facts into an ordered step selection with
 * fact-linked rationales. Returns the raw picks + the SDK session_id (recorded for debugging —
 * every agent decision must be re-askable). buildWorkflow (tested separately) is the safety wall
 * that consumes these picks; assembleChain only captures the agent's judgment + the session.
 */
function fakeQuery(structured: unknown, sessionId = 'sess-1'): QueryFn {
  return async function* () {
    yield { type: 'system', subtype: 'init', session_id: sessionId } as never;
    yield { type: 'result', subtype: 'success', structured_output: structured, session_id: sessionId } as never;
  };
}

const facts = { hasTests: true, mutation: true, scope: 'add login', crossProjectDep: false };

describe('assembleChain', () => {
  it('returns the agent-selected steps with rationales and the session id', async () => {
    const picks = [
      { name: 'ground', why: '사실 확인' },
      { name: 'test', why: '테스트 있음 → 재현 먼저' },
      { name: 'implement', why: '기능 추가' },
    ];
    const out = await assembleChain(
      { seed: 'feature', facts },
      { queryFn: fakeQuery({ steps: picks }) },
    );
    expect(out.picks).toEqual(picks.map((p) => p.name));
    expect(out.rationales).toEqual(picks);
    expect(out.sessionId).toBe('sess-1');
  });

  it('captures the session id even when the agent returns an empty selection', async () => {
    const out = await assembleChain({ seed: 'chore', facts }, { queryFn: fakeQuery({ steps: [] }, 'sess-x') });
    expect(out.picks).toEqual([]);
    expect(out.sessionId).toBe('sess-x');
  });

  it('throws when the run fails (no silent empty plan)', async () => {
    const failing: QueryFn = async function* () {
      yield { type: 'result', subtype: 'error_max_turns', session_id: 's' } as never;
    };
    await expect(assembleChain({ seed: 'feature', facts }, { queryFn: failing })).rejects.toThrow(/assemble/i);
  });
});
