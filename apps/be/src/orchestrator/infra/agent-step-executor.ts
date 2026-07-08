import { query, type Options, type PermissionMode, type SDKMessage, type SDKResultSuccess } from '@anthropic-ai/claude-agent-sdk';
import type { ProducerOutcome, ReviewOutcome, StepContext, StepExecutor } from '../types';

/** Map a streamed SDK message to live agent events for the UI (tool_use / thinking / assistant text). */
function emitAgentMessage(ctx: StepContext, message: SDKMessage): void {
  if (!ctx.emit || message.type !== 'assistant') return;
  const content = (message as { message?: { content?: unknown } }).message?.content;
  if (!Array.isArray(content)) return;
  for (const block of content as Array<Record<string, unknown>>) {
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      ctx.emit({ type: 'assistant', payload: { text: block.text } });
    } else if (block.type === 'tool_use') {
      ctx.emit({ type: 'tool_use', payload: { name: String(block.name ?? 'tool'), input: block.input ?? {} } });
    } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
      ctx.emit({ type: 'thinking', payload: { text: block.thinking } });
    }
  }
}

/** Injectable query fn (the SDK's `query`) so the executor is testable without live calls. */
export type QueryFn = (params: { prompt: string; options?: Options }) => AsyncIterable<SDKMessage>;

const VERDICT_SCHEMA = {
  type: 'json_schema' as const,
  schema: {
    type: 'object',
    properties: { verdict: { type: 'string', enum: ['pass', 'fail'] } },
    required: ['verdict'],
  },
};

export interface AgentExecutorDeps {
  /** Project repo the agent operates in (cwd binding). */
  cwd: string;
  model?: string;
  permissionMode?: PermissionMode;
  maxTurns?: number;
  /** Builds the user prompt for a step+role (the harness owns prompt content). */
  promptFor: (ctx: StepContext, role: 'producer' | 'reviewer') => string;
  /** Optional per-step system prompt. */
  systemPromptFor?: (ctx: StepContext, role: 'producer' | 'reviewer') => string | undefined;
  /** Optional per-step tool grant — the permission ring, enforced by the SDK. */
  allowedToolsFor?: (ctx: StepContext, role: 'producer' | 'reviewer') => string[] | undefined;
  /** Defaults to the real SDK `query`. */
  queryFn?: QueryFn;
}

/**
 * Runs a step by invoking the Claude Agent SDK in the project repo (cwd).
 * Producer returns the agent's output; reviewer returns a grammar-enforced pass/fail.
 */
export class AgentStepExecutor implements StepExecutor {
  constructor(private readonly deps: AgentExecutorDeps) {}

  async produce(ctx: StepContext): Promise<ProducerOutcome> {
    const result = await this.run(ctx, 'producer');
    return { output: result.structured_output ?? result.result };
  }

  async review(ctx: StepContext): Promise<ReviewOutcome> {
    const result = await this.run(ctx, 'review', VERDICT_SCHEMA);
    const verdict = (result.structured_output as { verdict?: string } | undefined)?.verdict;
    // Conservative: only an explicit "pass" passes the gate.
    return { verdict: verdict === 'pass' ? 'pass' : 'fail' };
  }

  private async run(
    ctx: StepContext,
    role: 'producer' | 'review',
    outputFormat?: typeof VERDICT_SCHEMA,
  ): Promise<SDKResultSuccess> {
    const callRole = role === 'review' ? 'reviewer' : 'producer';
    const options: Options = { cwd: this.deps.cwd };
    if (this.deps.model) options.model = this.deps.model;
    if (this.deps.permissionMode) {
      options.permissionMode = this.deps.permissionMode;
      if (this.deps.permissionMode === 'bypassPermissions') options.allowDangerouslySkipPermissions = true;
    }
    if (this.deps.maxTurns !== undefined) options.maxTurns = this.deps.maxTurns;
    const systemPrompt = this.deps.systemPromptFor?.(ctx, callRole);
    if (systemPrompt) options.systemPrompt = systemPrompt;
    const allowedTools = this.deps.allowedToolsFor?.(ctx, callRole);
    if (allowedTools) options.allowedTools = allowedTools;
    if (outputFormat) options.outputFormat = outputFormat;

    const run = this.deps.queryFn ?? (query as QueryFn);
    for await (const message of run({ prompt: this.deps.promptFor(ctx, callRole), options })) {
      emitAgentMessage(ctx, message);
      if (message.type === 'result') {
        if (message.subtype === 'success') return message;
        throw new Error(`Agent run failed for ${ctx.step}/${callRole}: ${message.subtype}`);
      }
    }
    throw new Error(`Agent run produced no result for ${ctx.step}/${callRole}`);
  }
}
