import { describe, expect, it } from 'bun:test';
import { reAskSession } from './reask-session';
import type { QueryFn } from '../orchestrator/infra/agent-step-executor';

/**
 * The recorded assemble session is only useful if it can be RE-ASKED. reAskSession resumes the
 * SDK session (options.resume = the stored session id) and puts a follow-up question to the same
 * agent that composed the flow — the concrete debugging path the session ids exist for.
 */
describe('reAskSession', () => {
  it('resumes the stored session and returns the agent answer', async () => {
    let seenResume: string | undefined;
    let seenPrompt: string | undefined;
    const q: QueryFn = async function* ({ prompt, options }) {
      seenPrompt = prompt;
      seenResume = options?.resume;
      yield { type: 'result', subtype: 'success', result: 'test가 있어서 test-first로 골랐다.', session_id: 'sess-1' } as never;
    };
    const out = await reAskSession('sess-1', '왜 test를 골랐냐?', { queryFn: q });
    expect(seenResume).toBe('sess-1'); // resumed the SAME session, not a fresh one
    expect(seenPrompt).toBe('왜 test를 골랐냐?');
    expect(out.answer).toBe('test가 있어서 test-first로 골랐다.');
  });

  it('throws when the session cannot be resumed (surfaced, not silently empty)', async () => {
    const failing: QueryFn = async function* () {
      yield { type: 'result', subtype: 'error_during_execution', session_id: 'x' } as never;
    };
    await expect(reAskSession('gone', '왜?', { queryFn: failing })).rejects.toThrow();
  });
});
