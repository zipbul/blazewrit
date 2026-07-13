import type { SQL } from 'bun';

export type WakeKind = 'stalled' | 'unresolvable_task' | 'stale_dep' | 'lease_expired' | 'orphaned_ready';

export interface WakeInput {
  kind: WakeKind;
  taskId: string;
  jobId?: string;
  depId?: string;
  /** One human-readable line — the drawer inbox question text (Korean, matching this UI's language). */
  reason: string;
}

/**
 * Raises a wake record for a human to see in the drawer inbox (harness/job-graph.md P2: "wake
 * 레코드 = decisions 재사용" — no new table; P4 이전 소비자 = 인간, 질문함 노출). NOT a blocking
 * HITL gate — nothing is suspended waiting for an answer, unlike a real decide-step decision;
 * `/api/decisions`'s existing blocking/META_TYPES mapping doesn't yet know that (see handoff
 * report — a P2 follow-up, not this function's job).
 *
 * Dedup (spec E2): the target key is jobId if present, else depId, else taskId — an open agent_wake
 * already covering the SAME (kind, target) suppresses a repeat (no per-tick spam). A job-scoped
 * wake and a task-scoped wake for the same task are different targets on purpose (e.g. an
 * unresolvable_task wake for a task never suppresses a stalled wake for one of its own jobs).
 */
export async function raiseWake(
  sql: SQL,
  wake: WakeInput,
  newId: () => string = () => crypto.randomUUID(),
): Promise<{ raised: boolean; id?: string }> {
  const targetKey = wake.jobId ?? wake.depId ?? wake.taskId;
  const existing = (await sql`
    select 1 from decisions
    where request_type = 'agent_wake' and status = 'open' and meta->>'kind' = ${wake.kind}
      and coalesce(meta->>'jobId', meta->>'depId', meta->>'taskId') = ${targetKey}
    limit 1
  `) as unknown[];
  if (existing.length > 0) return { raised: false };

  const id = newId();
  // Passed as a plain object, NOT JSON.stringify'd: bun's SQL driver binds a string parameter
  // into a jsonb column as a jsonb STRING SCALAR (double-encoded — meta->>'key' then reads as
  // NULL against it, breaking the dedup query above), but binds a plain object correctly as a
  // genuine jsonb object. meta/proposals.ts's own inserts predate this discovery — parseJson()
  // in rest.ts's GET /api/decisions already defensively handles both shapes on the read side.
  const meta = { kind: wake.kind, taskId: wake.taskId, jobId: wake.jobId, depId: wake.depId };
  await sql`insert into decisions (id, status, request_type, question, options, meta) values (${id}, ${'open'}, ${'agent_wake'}, ${wake.reason}, ${'[]'}, ${meta})`;
  return { raised: true, id };
}
