import { tmpdir } from 'node:os';
import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { QueryFn } from '../orchestrator/infra/agent-step-executor';

export interface ReAskResult {
  /** The agent's plain-text answer to the follow-up. */
  answer: string;
  /** The (possibly new) session id — resuming may fork, so callers can chain. */
  sessionId: string;
}

export interface ReAskDeps {
  queryFn?: QueryFn;
  model?: string;
}

/**
 * Re-ask a recorded agent session. Resumes the SDK session (options.resume) so the follow-up
 * lands with the full original context — "why did you pick these steps?" put to the very agent
 * that composed the flow. This is the debugging path the stored session ids exist for; a session
 * that can't be resumed throws rather than returning a misleading empty answer.
 */
export async function reAskSession(sessionId: string, question: string, deps: ReAskDeps = {}): Promise<ReAskResult> {
  const options: Options = { cwd: tmpdir(), resume: sessionId, maxTurns: 2, allowedTools: [], settingSources: [] };
  if (deps.model) options.model = deps.model;

  const run = deps.queryFn ?? (query as QueryFn);
  for await (const message of run({ prompt: question, options }) as AsyncIterable<SDKMessage>) {
    if (message.type !== 'result') continue;
    if (message.subtype === 'success') {
      return {
        answer: (message as { result?: string }).result ?? '',
        sessionId: (message as { session_id?: string }).session_id ?? sessionId,
      };
    }
    throw new Error(`reAskSession failed: ${message.subtype}`);
  }
  throw new Error('reAskSession produced no result');
}
