import { describe, expect, it } from 'bun:test';
import type { SQL } from 'bun';
import type { QueryFn } from '../orchestrator/infra/agent-step-executor';
import { TriageAgent } from './triage-agent';

const fakeSql = {} as SQL; // never touched: the fake queryFn doesn't run the real tools

function fakeQuery(result: string): QueryFn {
  return async function* () {
    yield { type: 'assistant', message: { content: [{ type: 'text', text: 'thinking…' }] } } as never;
    yield { type: 'result', subtype: 'success', result } as never;
  };
}

describe('TriageAgent.chat', () => {
  it('returns the agent reply (intent null when propose_intent was not called)', async () => {
    const agent = new TriageAgent({ sql: fakeSql, queryFn: fakeQuery('안녕하세요, 무엇을 도와드릴까요?') });
    const turn = await agent.chat('안녕');
    expect(turn.reply).toBe('안녕하세요, 무엇을 도와드릴까요?');
    expect(turn.intent).toBeNull();
  });

  it('throws when the run errors', async () => {
    const agent = new TriageAgent({
      sql: fakeSql,
      queryFn: async function* () {
        yield { type: 'result', subtype: 'error_max_turns' } as never;
      },
    });
    await expect(agent.chat('x')).rejects.toThrow(/central agent failed/);
  });
});
