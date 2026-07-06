import { createA2AApp } from './app';
import type { MethodHandler } from './dispatch';
import { makeMessageSend } from './methods/message-send';
import { makeMessageStream } from './methods/message-stream';
import { makeTasksGet } from './methods/tasks-get';
import { makeTasksCancel } from './methods/tasks-cancel';
import { pushConfigSet } from './methods/push-config';
import { InMemoryTaskStore } from './infra/task-store';
import { StubTaskRunner, type IdGen } from './infra/stub-runner';
import { OrchestratorRunner } from './infra/orchestrator-runner';
import { InMemoryRegistry } from './infra/registry';
import { InMemoryOrchestratorStore } from '../orchestrator/store';
import { AutoPassStepExecutor } from '../orchestrator/stub-executor';
import type { StepExecutor } from '../orchestrator/types';
import { StubFlowClassifier } from '../triage/triage';
import { makeBearerAuthenticator } from './auth/authenticate';
import { makeRelationshipAuthorizer } from './auth/authorize';
import type { Principal } from './auth/principal';
import type { AgentCardInput } from './agent-card';

export interface ComposeOptions {
  projects?: Map<string, AgentCardInput>;
  newId?: IdGen;
  /** Bearer token -> principal. When given, the A2A POST endpoint requires auth. */
  tokens?: Map<string, Principal>;
  /** Caller id -> reachable project ids (relationship graph). */
  relationships?: Map<string, Set<string>>;
  /** Step executor; defaults to the auto-pass stub (no LLM). Pass AgentStepExecutor for real runs. */
  executor?: StepExecutor;
}

/** Wire the A2A transport with temporary in-memory infra + stub runner (no real workflow yet). */
export function composeA2A(opts: ComposeOptions = {}) {
  const newId: IdGen = opts.newId ?? (() => crypto.randomUUID());
  const store = new InMemoryTaskStore();
  const streamRunner = new StubTaskRunner(store, newId);
  const registry = new InMemoryRegistry(opts.projects ?? new Map());

  // message/send drives the real workflow engine (Triage -> orchestrator) with a
  // temporary auto-pass executor (Claude Agent SDK executor replaces it later).
  const orchestratorRunner = new OrchestratorRunner({
    triage: new StubFlowClassifier(),
    store: new InMemoryOrchestratorStore(),
    executor: opts.executor ?? new AutoPassStepExecutor(),
    newId,
    taskStore: store,
  });

  const handlers = new Map<string, MethodHandler>([
    ['message/send', makeMessageSend(orchestratorRunner)],
    ['tasks/get', makeTasksGet(store)],
    ['tasks/cancel', makeTasksCancel(store)],
    ['tasks/pushNotificationConfig/set', pushConfigSet],
  ]);

  return createA2AApp({
    card: (projectId) => registry.card(projectId),
    handlers,
    stream: makeMessageStream(streamRunner),
    authenticate: opts.tokens ? makeBearerAuthenticator(opts.tokens) : undefined,
    authorize: opts.relationships ? makeRelationshipAuthorizer(opts.relationships) : undefined,
  });
}
