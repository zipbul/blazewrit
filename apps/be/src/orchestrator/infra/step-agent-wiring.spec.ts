import { describe, expect, it } from 'bun:test';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { AgentStepExecutor, type QueryFn } from './agent-step-executor';
import { buildStepPrompt } from '../../harness/prompts';
import { stepAgentSystemPrompt, stepAgentTools } from '../../harness/step-agent-wiring';
import type { StepContext } from '../types';

/**
 * The executor must send each step's AGENT identity (one-line system prompt) and its tool grant
 * (the ring) to the SDK — this is what turns a role-tagged prompt string into a real agent.
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
      systemPromptFor: stepAgentSystemPrompt, allowedToolsFor: stepAgentTools,
      queryFn: capturing(captured),
    });
    await ex.produce(ctx('implement'));
    expect(String(captured[0]!.systemPrompt)).toContain('You are the builder');
    expect(captured[0]!.allowedTools).toContain('Edit');
  });

  it('investigate producer cannot Grep (정독은 도구경계가 강제)', async () => {
    const captured: Options[] = [];
    const ex = new AgentStepExecutor({
      cwd: '/tmp', promptFor: buildStepPrompt,
      systemPromptFor: stepAgentSystemPrompt, allowedToolsFor: stepAgentTools,
      queryFn: capturing(captured),
    });
    await ex.produce(ctx('investigate'));
    expect(captured[0]!.allowedTools).not.toContain('Grep');
  });

  it('reviewer always runs as the generic read-only judge, whatever the step', async () => {
    const captured: Options[] = [];
    const ex = new AgentStepExecutor({
      cwd: '/tmp', promptFor: buildStepPrompt,
      systemPromptFor: stepAgentSystemPrompt, allowedToolsFor: stepAgentTools,
      queryFn: capturing(captured),
    });
    await ex.review({ ...ctx('implement'), producerOutput: 'diff' });
    expect(String(captured[0]!.systemPrompt)).toContain('You are the reviewer');
    expect(captured[0]!.allowedTools).not.toContain('Edit');
    expect(captured[0]!.allowedTools).not.toContain('Bash');
  });

  it('unknown steps fall back to no identity/grant (executor stays generic)', async () => {
    const captured: Options[] = [];
    const ex = new AgentStepExecutor({
      cwd: '/tmp', promptFor: buildStepPrompt,
      systemPromptFor: stepAgentSystemPrompt, allowedToolsFor: stepAgentTools,
      queryFn: capturing(captured),
    });
    await ex.produce(ctx('mystery'));
    expect(captured[0]!.systemPrompt).toBeUndefined();
    expect(captured[0]!.allowedTools).toBeUndefined();
  });
});
