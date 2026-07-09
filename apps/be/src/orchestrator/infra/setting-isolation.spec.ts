import { describe, expect, it } from 'bun:test';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { AgentStepExecutor, type QueryFn } from './agent-step-executor';
import { buildStepPrompt } from '../../harness/prompts';
import { assembleChain } from '../../harness/assemble-chain';
import type { StepContext } from '../types';

/**
 * Config isolation contract (observed live: a step agent read the operator's ~/.claude/RTK.md —
 * the SDK loads user+project+local when settingSources is omitted):
 * - step agents: 'project' only — the repo's own CLAUDE.md applies, the operator's does not
 * - platform calls (assemble): no filesystem config at all
 */
function capturing(captured: Options[]): QueryFn {
  return async function* ({ options }) {
    captured.push(options!);
    yield { type: 'result', subtype: 'success', result: 'ok', session_id: 's', structured_output: { steps: [] } } as never;
  };
}

describe('settingSources isolation', () => {
  it('step agents load project config only (no operator ~/.claude)', async () => {
    const captured: Options[] = [];
    const ex = new AgentStepExecutor({ cwd: '/tmp', promptFor: buildStepPrompt, queryFn: capturing(captured) });
    const ctx: StepContext = { flowId: 'f', flowType: 'feature', step: 'ground', attempt: 1, request: 'r', priorOutputs: [] };
    await ex.produce(ctx);
    expect(captured[0]!.settingSources).toEqual(['project']);
  });

  it('assembleChain loads no filesystem config', async () => {
    const captured: Options[] = [];
    await assembleChain({ seed: 'feature', facts: {} }, { queryFn: capturing(captured) });
    expect(captured[0]!.settingSources).toEqual([]);
  });
});
