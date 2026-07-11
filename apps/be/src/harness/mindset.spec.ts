import { describe, expect, it } from 'bun:test';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { MINDSET, REVIEWER_GUARD } from './mindset';
import { stepAgentSystemPrompt } from './step-agent-wiring';
import { assembleChain } from './assemble-chain';
import type { QueryFn } from '../orchestrator/infra/agent-step-executor';
import type { StepContext } from '../orchestrator/types';

/**
 * Constitution v2 contract: six positive-framed stance principles, XML-sectioned, reaching
 * every WORKING agent (producers, reviewers, assembler); reviewers additionally carry the
 * anti-contrarian guard. (Resumed sessions keep their original context by design.)
 */
const ctx = (step: string): StepContext =>
  ({ flowId: 'f', flowType: 'feature', step, attempt: 1, request: 'r', priorOutputs: [] });

describe('mindset v2 injection', () => {
  it('is XML-sectioned and carries the six confirmed principles', () => {
    expect(MINDSET.startsWith('<mindset>')).toBe(true);
    expect(MINDSET.endsWith('</mindset>')).toBe(true);
    expect(MINDSET).toContain('되돌릴 수 있는가로 정하라');
    expect(MINDSET).toContain('가정이 틀렸다는 신호로 대하라');
    expect(MINDSET).toContain('원인을 제거한 것만 해결이라 불러라');
    expect(MINDSET).toContain('구분해서 말하라');
    expect(MINDSET).toContain('완료와 최선을 구분하라');
    expect(MINDSET).toContain('사실 위에서만 판단하라');
  });

  it('producer carries constitution + step identity', () => {
    const p = stepAgentSystemPrompt(ctx('implement'), 'producer')!;
    expect(p.startsWith(MINDSET)).toBe(true);
    expect(p).toContain('You are the builder');
  });

  it('reviewer additionally carries the anti-contrarian guard', () => {
    const r = stepAgentSystemPrompt(ctx('implement'), 'reviewer')!;
    expect(r.startsWith(MINDSET)).toBe(true);
    expect(r).toContain(REVIEWER_GUARD);
  });

  it('unknown steps get no identity (generic executor preserved)', () => {
    expect(stepAgentSystemPrompt(ctx('mystery'), 'producer')).toBeUndefined();
  });

  it('the assembler carries the constitution', async () => {
    const captured: Options[] = [];
    const q: QueryFn = async function* ({ options }) {
      captured.push(options!);
      yield { type: 'result', subtype: 'success', structured_output: { steps: [] }, session_id: 's' } as never;
    };
    await assembleChain({ seed: 'feature', facts: {} }, { queryFn: q });
    expect(String(captured[0]!.systemPrompt).startsWith(MINDSET)).toBe(true);
  });
});
