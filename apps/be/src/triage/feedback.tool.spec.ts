import { describe, expect, it } from 'bun:test';
import { recordFeedbackTool, RECORD_FEEDBACK_TOOL_FQN, type AgentFeedback } from './feedback.tool';

describe('recordFeedbackTool', () => {
  it('captures the feedback via the callback and confirms to the agent', async () => {
    const seen: AgentFeedback[] = [];
    const t = recordFeedbackTool((f) => seen.push(f));
    const res = await t.handler({ category: 'ui', content: '표를 렌더할 화면이 없음' }, {});
    expect(seen).toEqual([{ category: 'ui', content: '표를 렌더할 화면이 없음' }]);
    expect(res.isError).toBeUndefined();
    expect(res.content?.[0]).toMatchObject({ type: 'text' });
  });

  it('accepts every category the contract defines', async () => {
    const seen: AgentFeedback[] = [];
    const t = recordFeedbackTool((f) => seen.push(f));
    for (const category of ['ui', 'feature', 'unmet'] as const) {
      await t.handler({ category, content: 'x' }, {});
    }
    expect(seen.map((f) => f.category)).toEqual(['ui', 'feature', 'unmet']);
  });

  it('exposes the FQN the agent must be allow-listed for', () => {
    expect(RECORD_FEEDBACK_TOOL_FQN).toBe('mcp__bw_triage__record_feedback');
  });
});
