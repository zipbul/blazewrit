import type { SQL } from 'bun';

/** One persisted conversation turn (agent-visible subset lives in bw_v_chat). */
export interface TurnInput {
  /** 'central' | work item id. Validate with isValidScope at the route boundary. */
  scope: string;
  role: 'user' | 'agent' | 'summary';
  text: string;
  /** Structured extras for FE hydration (intent card, table view) — never exposed to the agent view. */
  payload?: unknown;
  /** FE-generated id anchoring idempotent retry: unique per (scope, clientMsgId). */
  clientMsgId?: string;
}

export interface TurnRow {
  seq: number;
  /** True when (scope, clientMsgId) already existed — the retry returned the original row. */
  duplicate: boolean;
}

export interface WindowMsg {
  seq: number;
  role: string;
  text: string;
}

export interface ThreadDigest {
  scope: string;
  title: string;
  count: number;
  lastAt: string;
}

/** A single message injected verbatim may not exceed this — beyond it we truncate with a pointer. */
const MAX_INLINE_CHARS = 2000;

/**
 * The SINGLE write path for conversation turns. Every turn-producing surface (triage chat,
 * dispatch/clarify confirmations, decision answers) must go through here — no turn may bypass
 * chat_messages, or 똘이's memory silently forks from what the user saw.
 */
export async function recordTurn(sql: SQL, t: TurnInput): Promise<TurnRow> {
  const payload = t.payload === undefined ? null : JSON.stringify(t.payload);
  if (t.clientMsgId) {
    const rows = (await sql`
      insert into chat_messages (scope, role, text, payload, client_msg_id)
      values (${t.scope}, ${t.role}, ${t.text}, ${payload}, ${t.clientMsgId})
      on conflict (scope, client_msg_id) do nothing
      returning seq
    `) as Array<{ seq: number }>;
    if (rows.length > 0) return { seq: Number(rows[0]!.seq), duplicate: false };
    const existing = (await sql`
      select seq from chat_messages where scope = ${t.scope} and client_msg_id = ${t.clientMsgId}
    `) as Array<{ seq: number }>;
    return { seq: Number(existing[0]!.seq), duplicate: true };
  }
  const rows = (await sql`
    insert into chat_messages (scope, role, text, payload) values (${t.scope}, ${t.role}, ${t.text}, ${payload}) returning seq
  `) as Array<{ seq: number }>;
  return { seq: Number(rows[0]!.seq), duplicate: false };
}

/** Scope must be 'central' or an existing work item — anything else forks a garbage thread. */
export async function isValidScope(sql: SQL, scope: string): Promise<boolean> {
  if (scope === 'central') return true;
  const rows = (await sql`select 1 from work_items where id = ${scope}`) as Array<unknown>;
  return rows.length > 0;
}

/** Mark a turn failed (agent error) — excluded from the window and from bw_v_chat. */
export async function markFailed(sql: SQL, seq: number): Promise<void> {
  await sql`update chat_messages set status = 'failed' where seq = ${seq}`;
}

/**
 * The last N usable turns of a scope, oldest-first, oversized messages truncated with a
 * '[전문은 bw_v_chat id=…]' pointer so one pasted log cannot flood every subsequent prompt.
 */
export async function recentWindow(sql: SQL, scope: string, opts: { maxTurns: number }): Promise<WindowMsg[]> {
  const rows = (await sql`
    select seq, role, text from chat_messages
    where scope = ${scope} and status <> 'failed' and redacted_at is null
    order by seq desc limit ${opts.maxTurns}
  `) as Array<{ seq: number; role: string; text: string }>;
  return rows.reverse().map((r) => ({
    seq: Number(r.seq),
    role: r.role,
    text:
      r.text.length > MAX_INLINE_CHARS
        ? `${r.text.slice(0, MAX_INLINE_CHARS)}… [전문은 bw_v_chat id=${r.seq}]`
        : r.text,
  }));
}

/**
 * The thread index card: one digest row per scope (title, message count, last activity).
 * Injected every turn — it is the map that tells 똘이 history EXISTS beyond the window,
 * so it queries bw_v_chat instead of confidently answering from partial memory.
 */
export async function threadIndexCard(sql: SQL): Promise<ThreadDigest[]> {
  const rows = (await sql`
    select m.scope,
           coalesce(w.title, case when m.scope = 'central' then '중앙' else m.scope end) as title,
           count(*)::int as count,
           max(m.created_at) as last_at
    from chat_messages m
    left join work_items w on w.id = m.scope
    where m.redacted_at is null and m.status <> 'failed'
    group by m.scope, w.title
    order by max(m.created_at) desc
  `) as Array<{ scope: string; title: string; count: number; last_at: string }>;
  return rows.map((r) => ({ scope: r.scope, title: r.title, count: r.count, lastAt: String(r.last_at) }));
}
