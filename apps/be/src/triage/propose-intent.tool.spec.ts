import { describe, expect, it } from 'bun:test';
import { proposeIntentTool, PROPOSE_INTENT_TOOL_FQN } from './propose-intent.tool';
import type { Intent } from './intent';

const INTENT: Intent = {
  summary: '위시리스트 기능 추가',
  flowType: 'feature',
  targetProject: '장바구니',
  isNewProject: false,
  suggestedProjectName: null,
  relatedProjects: [],
  needsClarification: false,
  clarifyingQuestion: null,
  clarifyOptions: [],
  confidence: 0.9,
  rationale: '장바구니 단독 도메인',
};

describe('proposeIntentTool', () => {
  it('captures the structured intent via the callback', async () => {
    const seen: Intent[] = [];
    const t = proposeIntentTool((i) => seen.push(i));
    const res = await t.handler(INTENT as never, {});
    expect(seen).toEqual([INTENT]);
    expect(res.isError).toBeUndefined();
  });

  it('rejects a flowType outside the enum at the schema layer', () => {
    const t = proposeIntentTool(() => {});
    expect(t.inputSchema.flowType.safeParse('nonsense').success).toBe(false);
    expect(t.inputSchema.flowType.safeParse('feature').success).toBe(true);
  });

  it('exposes the FQN the agent must be allow-listed for', () => {
    expect(PROPOSE_INTENT_TOOL_FQN).toBe('mcp__bw_triage__propose_intent');
  });
});
