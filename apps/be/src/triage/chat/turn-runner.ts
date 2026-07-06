import type { SQL } from 'bun';
import type { TriageAgent, TurnResult, ChatHistory } from '../triage-agent';
import { recordTurn, recentWindow, threadIndexCard, markFailed } from './turns';
import { latestSummary } from './summarize';

/** How many recent turns ride verbatim in the prompt (older content = summary + agentic search). */
const WINDOW_TURNS = 12;

/**
 * The ONE history assembler: latest summary (compacted past) above the recent window + the
 * thread index card. Production routes AND the eval gate must both use this — a parallel
 * implementation would let the behavioral gate measure a different assembler than prod.
 */
export async function assembleHistory(sql: SQL, scope: string): Promise<ChatHistory> {
  const s = await latestSummary(sql, scope);
  const window = await recentWindow(sql, scope, { maxTurns: WINDOW_TURNS });
  return {
    window: s ? [{ seq: s.seq, role: 'summary', text: s.text }, ...window] : window,
    card: await threadIndexCard(sql),
  };
}

export interface TurnRunInput {
  scope: string;
  request: string;
  clientMsgId?: string;
  /** Rendered before the user text in the persisted turn (e.g. '(질문함 답변) '). */
  textPrefix?: string;
}

export type TurnRunResult = TurnResult & { duplicate: boolean };

/**
 * The ONE conversational loop — every surface that runs 똘이 (dock sends, clarification
 * answers) goes through here so policy cannot fork: persist user turn → assemble history →
 * run agent → persist agent turn (intent/view payload) → persist feedback → markFailed+rethrow
 * on error. A clientMsgId duplicate short-circuits WITHOUT re-running the agent (no double
 * LLM bill, no second reply row).
 */
export async function runTriageTurn(sql: SQL, agent: TriageAgent, input: TurnRunInput): Promise<TurnRunResult> {
  const userTurn = await recordTurn(sql, {
    scope: input.scope,
    role: 'user',
    text: `${input.textPrefix ?? ''}${input.request}`,
    clientMsgId: input.clientMsgId,
  });
  if (userTurn.duplicate) {
    // Retry of an already-processed send: return the recorded outcome instead of re-running.
    const prior = (await sql`
      select text, payload from chat_messages
      where scope = ${input.scope} and role = 'agent' and seq > ${userTurn.seq} and status <> 'failed'
      order by seq asc limit 1
    `) as Array<{ text: string; payload: unknown }>;
    const p = prior[0]
      ? ((typeof prior[0].payload === 'string' ? JSON.parse(prior[0].payload) : prior[0].payload) as {
          intent?: TurnResult['intent'];
          view?: TurnResult['view'];
        } | null)
      : null;
    return {
      reply: prior[0]?.text ?? '',
      intent: p?.intent ?? null,
      feedback: null,
      view: p?.view ?? null,
      duplicate: true,
    };
  }

  try {
    const turn = await agent.chat({ request: input.request, scope: input.scope, history: await assembleHistory(sql, input.scope) });
    await recordTurn(sql, {
      scope: input.scope,
      role: 'agent',
      text: turn.reply,
      payload: turn.intent || turn.view ? { intent: turn.intent, view: turn.view } : undefined,
    });
    if (turn.feedback) {
      await sql`insert into agent_feedback (id, category, content, request) values (${crypto.randomUUID()}, ${turn.feedback.category}, ${turn.feedback.content}, ${input.request})`;
    }
    return { ...turn, duplicate: false };
  } catch (err) {
    await markFailed(sql, userTurn.seq); // exclude the orphaned user turn from future windows
    throw err;
  }
}
