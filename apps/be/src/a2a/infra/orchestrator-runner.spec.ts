import { test, expect, beforeEach } from 'bun:test';
import type { MessageDto } from '@bw/dto';
import { OrchestratorRunner } from './orchestrator-runner';
import { InMemoryOrchestratorStore } from '../../orchestrator/store';
import { AutoPassStepExecutor } from '../../orchestrator/stub-executor';
import { StubFlowClassifier } from '../../triage/triage';
import { InMemoryTaskStore } from './task-store';

function message(text: string): MessageDto {
  return { kind: 'message', messageId: 'm1', role: 'user', parts: [{ kind: 'text', text }] } as MessageDto;
}

let ids: number;
const newId = () => `id-${ids++}`;

function runner() {
  return new OrchestratorRunner({
    triage: new StubFlowClassifier(),
    store: new InMemoryOrchestratorStore(),
    executor: new AutoPassStepExecutor(),
    newId,
    taskStore: new InMemoryTaskStore(),
  });
}

beforeEach(() => {
  ids = 1;
});

test('runs the feature workflow to a completed task', async () => {
  const task = await runner().run(message('로그인 기능 추가해줘'));
  expect(task.status.state).toBe('completed');
});

test('uses the flow id as the task id', async () => {
  const task = await runner().run(message('로그인 기능 추가해줘'));
  expect(task.id).toBe('id-1');
});

test('reuses an incoming contextId', async () => {
  const task = await runner().run({ ...message('기능 추가'), contextId: 'ctx-given' });
  expect(task.contextId).toBe('ctx-given');
});

test('runs a non-feature flow (refactor) to completion', async () => {
  // "리팩터" -> refactor, which now has its own workflow definition
  const task = await runner().run(message('이 코드 리팩터해줘'));
  expect(task.status.state).toBe('completed');
});
