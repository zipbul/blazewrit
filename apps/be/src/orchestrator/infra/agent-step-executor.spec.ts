import { test, expect, mock } from 'bun:test';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { AgentStepExecutor, type QueryFn } from './agent-step-executor';
import type { StepContext } from '../types';

const ctx: StepContext = { flowId: 'f1', flowType: 'feature', step: 'ground', attempt: 1, request: 'add login', priorOutputs: [] };

function resultMessage(over: Partial<Record<string, unknown>> = {}): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'done',
    ...over,
  } as unknown as SDKMessage;
}

function fakeQuery(messages: SDKMessage[]): { fn: QueryFn; calls: Array<{ prompt: string; cwd?: string; hasOutputFormat: boolean }> } {
  const calls: Array<{ prompt: string; cwd?: string; hasOutputFormat: boolean }> = [];
  const fn: QueryFn = ({ prompt, options }) => {
    calls.push({ prompt, cwd: options?.cwd, hasOutputFormat: options?.outputFormat !== undefined });
    return (async function* () {
      for (const m of messages) yield m;
    })();
  };
  return { fn, calls };
}

function executor(fn: QueryFn, promptFor = mock(() => 'PROMPT')) {
  return new AgentStepExecutor({ cwd: '/repo/p1', promptFor, queryFn: fn });
}

test('produce binds the project cwd and returns the agent result', async () => {
  const q = fakeQuery([resultMessage({ result: 'ground facts' })]);
  const outcome = await executor(q.fn).produce(ctx);
  expect(outcome.output).toBe('ground facts');
  expect(q.calls[0]?.cwd).toBe('/repo/p1');
});

test('produce prefers structured_output when present', async () => {
  const q = fakeQuery([resultMessage({ structured_output: { facts: [] } })]);
  const outcome = await executor(q.fn).produce(ctx);
  expect(outcome.output).toEqual({ facts: [] });
});

test('review returns pass for an explicit pass verdict', async () => {
  const q = fakeQuery([resultMessage({ structured_output: { verdict: 'pass' } })]);
  expect(await executor(q.fn).review(ctx)).toEqual({ verdict: 'pass' });
});

test('review defaults to fail when the verdict is not an explicit pass', async () => {
  const q = fakeQuery([resultMessage({ structured_output: { verdict: 'fail' } })]);
  expect(await executor(q.fn).review(ctx)).toEqual({ verdict: 'fail' });
});

test('review requests a json_schema output format', async () => {
  const q = fakeQuery([resultMessage({ structured_output: { verdict: 'pass' } })]);
  await executor(q.fn).review(ctx);
  expect(q.calls[0]?.hasOutputFormat).toBe(true);
});

test('sets allowDangerouslySkipPermissions when bypassing permissions', async () => {
  let captured: { permissionMode?: string; allow?: boolean } = {};
  const fn: QueryFn = ({ options }) => {
    captured = { permissionMode: options?.permissionMode, allow: options?.allowDangerouslySkipPermissions };
    return (async function* () {
      yield resultMessage();
    })();
  };
  await new AgentStepExecutor({ cwd: '/repo/p1', permissionMode: 'bypassPermissions', promptFor: () => 'P', queryFn: fn }).produce(ctx);
  expect(captured).toEqual({ permissionMode: 'bypassPermissions', allow: true });
});

test('throws when the agent run errors', async () => {
  const q = fakeQuery([{ type: 'result', subtype: 'error_during_execution' } as unknown as SDKMessage]);
  await expect(executor(q.fn).produce(ctx)).rejects.toThrow();
});

test('throws when no result message is produced', async () => {
  const q = fakeQuery([]);
  await expect(executor(q.fn).produce(ctx)).rejects.toThrow();
});
