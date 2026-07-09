import { describe, expect, it } from 'bun:test';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { AgentStepExecutor, type QueryFn } from './agent-step-executor';
import { buildStepPrompt } from '../../harness/prompts';
import { stepAgentSystemPrompt } from '../../harness/step-agent-wiring';
import type { StepContext } from '../types';

/**
 * The executor must send each step's AGENT identity (one-line system prompt) to the SDK —
 * this is what turns a role-tagged prompt string into a real agent.
 */
function ctx(step: string): StepContext {
  return { flowId: 'f', flowType: 'feature', step, attempt: 1, request: 'r', priorOutputs: [] };
}

function capturing(captured: Options[]): QueryFn {
  return async function* ({ options }) {
    captured.push(options!);
    yield { type: 'result', subtype: 'success', result: 'ok', structured_output: { verdict: 'pass' } } as never;
  };
}

describe('step agent wiring', () => {
  it('producer runs under the step identity and its ring (implement: can write)', async () => {
    const captured: Options[] = [];
    const ex = new AgentStepExecutor({
      cwd: '/tmp', promptFor: buildStepPrompt,
      systemPromptFor: stepAgentSystemPrompt,
      queryFn: capturing(captured),
    });
    await ex.produce(ctx('implement'));
    expect(String(captured[0]!.systemPrompt)).toContain('You are the builder');
  });

  it('reviewer always runs as the generic read-only judge, whatever the step', async () => {
    const captured: Options[] = [];
    const ex = new AgentStepExecutor({
      cwd: '/tmp', promptFor: buildStepPrompt,
      systemPromptFor: stepAgentSystemPrompt,
      queryFn: capturing(captured),
    });
    await ex.review({ ...ctx('implement'), producerOutput: 'diff' });
    expect(String(captured[0]!.systemPrompt)).toContain('You are the reviewer');
  });

  it('unknown steps fall back to no identity/grant (executor stays generic)', async () => {
    const captured: Options[] = [];
    const ex = new AgentStepExecutor({
      cwd: '/tmp', promptFor: buildStepPrompt,
      systemPromptFor: stepAgentSystemPrompt,
      queryFn: capturing(captured),
    });
    await ex.produce(ctx('mystery'));
    expect(captured[0]!.systemPrompt).toBeUndefined();
  });
});
