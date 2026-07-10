import { describe, expect, it } from 'bun:test';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { MINDSET } from './mindset';
import { stepAgentSystemPrompt } from './step-agent-wiring';
import { assembleChain } from './assemble-chain';
import type { QueryFn } from '../orchestrator/infra/agent-step-executor';
import type { StepContext } from '../orchestrator/types';

/**
 * The platform constitution reaches EVERY platform agent's system prompt — step producers,
 * reviewers, and the assembler. (Resumed sessions keep their original context by design.)
 */
const ctx = (step: string): StepContext =>
  ({ flowId: 'f', flowType: 'feature', step, attempt: 1, request: 'r', priorOutputs: [] });

describe('mindset injection', () => {
  it('has the five confirmed principles, numbered', () => {
    for (const n of ['1.', '2.', '3.', '4.', '5.']) expect(MINDSET).toContain(n);
    expect(MINDSET).toContain('되돌릴 수 있는가');
    expect(MINDSET).toContain('항복');
    expect(MINDSET).toContain('땜질');
    expect(MINDSET).toContain('섞지 마라');
    expect(MINDSET).toContain('기록하고 제안하라');
  });

  it('every step producer and reviewer carries the constitution + its identity', () => {
    const producer = stepAgentSystemPrompt(ctx('implement'), 'producer')!;
    expect(producer.startsWith(MINDSET)).toBe(true);
    expect(producer).toContain('You are the builder');
    const reviewer = stepAgentSystemPrompt(ctx('implement'), 'reviewer')!;
    expect(reviewer.startsWith(MINDSET)).toBe(true);
    expect(reviewer).toContain('You are the reviewer');
  });

  it('unknown steps still get no identity (generic executor preserved)', () => {
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
