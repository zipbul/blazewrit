import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { TRIAGE_MCP_SERVER } from './db/db-read.tool';

export const RECORD_FEEDBACK_TOOL = 'record_feedback';
/** Fully-qualified tool name the agent must be allow-listed for. */
export const RECORD_FEEDBACK_TOOL_FQN = `mcp__${TRIAGE_MCP_SERVER}__${RECORD_FEEDBACK_TOOL}`;

/** What the agent logs when it hits a platform limitation while serving the user. */
export interface AgentFeedback {
  /** 'ui' = no screen/surface to express the answer; 'feature' = blazewrit lacks the capability; 'unmet' = user's ask/satisfaction not fulfilled. */
  category: 'ui' | 'feature' | 'unmet';
  /** What was missing / what would have helped — concrete, buildable. */
  content: string;
}

const feedbackShape = {
  category: z.enum(['ui', 'feature', 'unmet']),
  content: z.string().describe('무엇이 부족했고, 어떤 수단이 있으면 좋았을지 — 구체적으로'),
};

/**
 * The agent calls this when it CANNOT properly serve the user with the platform's current
 * means — a missing screen/surface (ui), a missing blazewrit capability (feature), or an
 * unmet user need (unmet). These accumulate as the platform's self-improvement backlog.
 */
export function recordFeedbackTool(onFeedback: (fb: AgentFeedback) => void) {
  return tool(
    RECORD_FEEDBACK_TOOL,
    'blazewrit의 현재 수단으로 사용자를 제대로 응대하지 못했을 때 호출한다: 표현할 화면이 없거나(ui), ' +
      '플랫폼 기능이 없거나(feature), 사용자 요구/만족을 못 채웠을 때(unmet). 지어내는 대신 이걸 기록하라.',
    feedbackShape,
    async (args) => {
      onFeedback(args as AgentFeedback);
      return { content: [{ type: 'text' as const, text: 'feedback recorded' }] };
    },
  );
}
