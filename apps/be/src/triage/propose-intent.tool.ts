import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { FLOW_TYPES } from '@bw/dto';
import { TRIAGE_MCP_SERVER } from './db/db-read.tool';
import type { Intent } from './intent';

export const PROPOSE_INTENT_TOOL = 'propose_intent';
/** Fully-qualified tool name the agent must be allow-listed for. */
export const PROPOSE_INTENT_TOOL_FQN = `mcp__${TRIAGE_MCP_SERVER}__${PROPOSE_INTENT_TOOL}`;

const intentShape = {
  summary: z.string(),
  flowType: z.enum(FLOW_TYPES as unknown as [string, ...string[]]),
  targetProject: z.string().nullable(),
  isNewProject: z.boolean(),
  suggestedProjectName: z.string().nullable(),
  relatedProjects: z.array(z.string()),
  needsClarification: z.boolean(),
  clarifyingQuestion: z.string().nullable(),
  clarifyOptions: z.array(z.string()),
  confidence: z.number(),
  rationale: z.string(),
};

/**
 * The agent calls this ONLY when the user's message is an actionable work request, handing over
 * the structured intent. The handler captures it via `onIntent` (the conversation reply is the
 * agent's separate text). For plain chat/questions the agent never calls this.
 */
export function proposeIntentTool(onIntent: (intent: Intent) => void) {
  return tool(
    PROPOSE_INTENT_TOOL,
    'Call this ONLY when the user message is an actionable work request (something to build, fix, ' +
      'change, investigate, etc.). Pass the structured intent grounded in current DB state. For ' +
      'general questions or chat, do NOT call this — just reply in text.',
    intentShape,
    async (args) => {
      onIntent(args as unknown as Intent);
      return { content: [{ type: 'text' as const, text: 'intent recorded' }] };
    },
  );
}
