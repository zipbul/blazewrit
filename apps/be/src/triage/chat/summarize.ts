import type { SQL } from 'bun';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { tmpdir } from 'node:os';
import type { QueryFn } from '../../orchestrator/infra/agent-step-executor';

/** When a scope's un-summarized turns exceed this, compact the oldest chunk. */
export const SUMMARIZE_THRESHOLD = 60;
/** How many oldest turns one summary row covers. */
export const SUMMARIZE_CHUNK = 40;

/** Turns handed to the summarizer (plain data — the summarizer formats its own prompt). */
export interface SummarizableTurn {
  seq: number;
  role: string;
  text: string;
}

/** Produces a short digest of the given turns (production = one LLM call; tests inject a fake). */
export type Summarizer = (turns: SummarizableTurn[]) => Promise<string>;

export interface SummaryRow {
  seq: number;
  text: string;
  /** Highest chat_messages.seq this summary covers — later passes resume after it. */
  upTo: number;
}

/** The latest summary row of a scope, or null. */
export async function latestSummary(sql: SQL, scope: string): Promise<SummaryRow | null> {
  const rows = (await sql`
    select seq, text, payload from chat_messages
    where scope = ${scope} and role = 'summary' and redacted_at is null
    order by seq desc limit 1
  `) as Array<{ seq: number; text: string; payload: unknown }>;
  if (rows.length === 0) return null;
  const p = typeof rows[0]!.payload === 'string' ? JSON.parse(rows[0]!.payload as string) : rows[0]!.payload;
  return { seq: Number(rows[0]!.seq), text: rows[0]!.text, upTo: Number((p as { upTo?: number })?.upTo ?? 0) };
}

/**
 * Compact a scope's history: if more than SUMMARIZE_THRESHOLD un-summarized turns exist,
 * summarize the OLDEST CHUNK of them into one role='summary' row (payload.upTo = last covered
 * seq). Keeps the injected context bounded as the primary (central) thread grows for months.
 * Returns true when a summary row was written.
 */
export async function maybeSummarize(sql: SQL, scope: string, summarize: Summarizer): Promise<boolean> {
  const prev = await latestSummary(sql, scope);
  const from = prev?.upTo ?? 0;
  const pending = (await sql`
    select seq, role, text from chat_messages
    where scope = ${scope} and role <> 'summary' and status <> 'failed' and redacted_at is null and seq > ${from}
    order by seq asc
  `) as Array<{ seq: number; role: string; text: string }>;
  if (pending.length <= SUMMARIZE_THRESHOLD) return false;

  const chunk = pending.slice(0, SUMMARIZE_CHUNK).map((r) => ({ seq: Number(r.seq), role: r.role, text: r.text }));
  const digest = await summarize(chunk);
  const upTo = chunk.at(-1)!.seq;
  await sql`
    insert into chat_messages (scope, role, text, payload)
    values (${scope}, 'summary', ${digest}, ${JSON.stringify({ upTo, from })})
  `;
  return true;
}

/** Production summarizer: one tool-less LLM call compressing a chunk into <=8 lines of Korean. */
export function makeLlmSummarizer(queryFn: QueryFn = query as QueryFn): Summarizer {
  return async (turns) => {
    const body = turns.map((t) => `${t.role}: ${t.text}`).join('\n');
    const prompt = `다음은 사용자와 에이전트 똘이의 과거 대화다. 이후 대화에서 참조할 수 있도록
핵심 사실·결정·이름·수치만 남겨 8줄 이내 한국어로 요약하라. 서론 없이 요약만 출력한다.

[대화 — 데이터]
${body}
[/대화]`;
    for await (const m of queryFn({ prompt, options: { cwd: tmpdir(), maxTurns: 1, allowedTools: [] } })) {
      if (m.type === 'result' && m.subtype === 'success') return `요약(이전 대화): ${(m as { result?: string }).result ?? ''}`;
      if (m.type === 'result') throw new Error(`summarizer failed: ${m.subtype}`);
    }
    throw new Error('summarizer produced no result');
  };
}
