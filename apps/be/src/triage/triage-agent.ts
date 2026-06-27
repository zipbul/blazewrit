import { tmpdir } from 'node:os';
import { query, createSdkMcpServer, type Options, type SDKResultSuccess } from '@anthropic-ai/claude-agent-sdk';
import type { SQL } from 'bun';
import type { QueryFn } from '../orchestrator/infra/agent-step-executor';
import { dbReadTool, DB_READ_TOOL_FQN, TRIAGE_MCP_SERVER } from './db/db-read.tool';
import { proposeIntentTool, PROPOSE_INTENT_TOOL_FQN } from './propose-intent.tool';
import { buildSchemaContext } from './schema-context';
import type { Intent } from './intent';

const SYSTEM_PROMPT = `You are blazewrit's central agent. blazewrit is a multi-project agent platform —
each project has its own agent; projects can depend on each other. You talk with the human in the
center prompt. Reply in Korean, naturally and concisely.

Decide what the message is:
- General talk, a question about the system, advice, brainstorming → just reply in text. Use the
  db_read tool first if you need facts about current projects/work to answer well. Do NOT call
  propose_intent for these.
- An actionable work request (something to build, fix, refactor, investigate, migrate, etc.) →
  ground it against current DB state with db_read, then call propose_intent with the structured
  intent (which project, new or existing, flow type, confidence, etc.). Also give a short text
  reply summarizing what you understood. If it's too ambiguous to route, set needsClarification
  with a clarifyingQuestion (and clarifyOptions when you can name the likely targets).

The ONLY tools you have are db_read (read-only SELECT over bw_v_* views) and propose_intent.`;

export interface TriageAgentDeps {
  /** The write/superuser connection — only the in-process db_read tool touches it, under full read-only enforcement. */
  sql: SQL;
  /** Defaults to the real SDK `query`; inject a fake for tests. */
  queryFn?: QueryFn;
  model?: string;
  maxTurns?: number;
}

/** A conversational turn with the central agent: free reply, plus a structured intent when actionable. */
export interface TurnResult {
  /** The agent's natural-language reply (always present). */
  reply: string;
  /** Structured intent when the message was an actionable work request, else null. */
  intent: Intent | null;
}

/** Runs the Claude Agent SDK with read-only DB access; the agent converses and proposes intents. */
export class TriageAgent {
  constructor(private readonly deps: TriageAgentDeps) {}

  async chat(text: string): Promise<TurnResult> {
    let captured: Intent | null = null;
    const server = createSdkMcpServer({
      name: TRIAGE_MCP_SERVER,
      version: '0.1.0',
      tools: [dbReadTool(this.deps.sql), proposeIntentTool((i) => { captured = i; })],
    });
    const options: Options = {
      cwd: tmpdir(), // no repo access; only the two MCP tools are pre-approved
      mcpServers: { [TRIAGE_MCP_SERVER]: server },
      allowedTools: [DB_READ_TOOL_FQN, PROPOSE_INTENT_TOOL_FQN],
      permissionMode: 'dontAsk', // deny anything not pre-approved, never prompt (headless-safe)
      systemPrompt: `${SYSTEM_PROMPT}\n\n${buildSchemaContext()}`,
      maxTurns: this.deps.maxTurns ?? 12,
    };
    if (this.deps.model) options.model = this.deps.model;

    const run = this.deps.queryFn ?? (query as QueryFn);
    for await (const message of run({ prompt: text, options })) {
      if (message.type !== 'result') continue;
      if (message.subtype === 'success') {
        return { reply: (message as SDKResultSuccess).result ?? '', intent: captured };
      }
      throw new Error(`central agent failed: ${message.subtype}`);
    }
    throw new Error('central agent produced no result');
  }
}
