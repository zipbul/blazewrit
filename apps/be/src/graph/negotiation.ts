import type { SQL } from 'bun';
import { insertJobTx, insertDepTx, TerminalTaskError } from './store';
import type { DepOutcome, DepPredicate, DepTargetType } from './types';

/**
 * Wire shape of a negotiation `ask` (harness/job-graph.md P3 migration 11, rule 8's frozen shape).
 * Lives here (not rest.ts) so both the negotiation A2A path (rest.ts's request/accept/counter
 * handlers) and P4's a2a_request agent tool (graph/agent-tools.ts) share the identical type
 * instead of two copies drifting apart — moved out of rest.ts's local `interface NegotiationAsk`
 * verbatim (P4-1 extraction).
 *
 * job.repoId is OPTIONAL and defaults to the accepting provider's own repo when omitted (judgment
 * call carried over from rest.ts's own note: the doc's shown shape omits it, but the "accept의
 * job.repoId ≠ provider → ACL 거절" case only makes sense if the ask can carry a repoId for
 * insertJobTx's ACL check to actually catch).
 *
 * dep.expectedGen (D-round task #21 / Fable M2-d): optional stale-detection anchor, forwarded
 * verbatim to dep_members.expected_gen — lets a negotiated dep on a job target participate in
 * rule 5 staleness just like a same-repo dep_declare one can.
 */
export interface NegotiationAsk {
  taskId: string;
  job?: { title: string; description?: string; repoId?: string };
  dep?: {
    waiterJobId: string;
    targetType: DepTargetType;
    targetId: string;
    predicate?: DepPredicate;
    acceptable?: DepOutcome[];
    expectedGen?: number;
  };
  gate?: { kind: string; description?: string };
}

/** requestProposal / a2a_request reject: the ask's task isn't open (already terminal, or never existed). */
export class TaskNotOpenError extends Error {}

/** accept's materialize (D-round task #19 / Fable m3): the ask has none of job/dep/gate — nothing to materialize. */
export class EmptyAskError extends Error {}

/**
 * D-round task #12c (Codex major rest.ts:491): insertProposal's `id` already names a DIFFERENT
 * proposal (different task/repos/kind/ask) than the one being inserted — a genuine id collision,
 * not a safe idempotent replay of the SAME proposal.
 */
export class ProposalIdConflictError extends Error {}

export interface NewProposalInput {
  id: string;
  taskId: string;
  fromRepo: string;
  toRepo: string;
  kind: 'request' | 'counter';
  ask: NegotiationAsk;
}

/**
 * requestProposal's DB-writing core, extracted (P4-1) out of rest.ts's createRestApi closure so
 * it's callable without the JSON-RPC request/response shaping rest.ts's handleNegotiation wraps it
 * in — the a2a_request agent tool calls this directly (an internal "issue a proposal", not a real
 * network round-trip through our own /a2a endpoint). Records the ask as 'proposed'; never
 * materializes (accept does, via materializeAskTx).
 *
 * D-round task #12c (D5): `on conflict (id) do nothing` alone was silent about a genuine id
 * collision — a caller-supplied/reused id landing on a DIFFERENT existing proposal used to just
 * vanish into the no-op. Now: on conflict, the existing row is re-read and compared field-by-field
 * against this call's own input; identical (a true retried replay — A3's own idempotency note)
 * stays a safe no-op, anything else throws ProposalIdConflictError instead of silently discarding
 * the caller's actual request.
 */
/**
 * Recursively key-sorted JSON.stringify — jsonb (unlike json) does NOT preserve the original key
 * insertion order, so a plain `JSON.stringify` comparison between an ask that was just built in JS
 * and the SAME ask read back from a jsonb column can mismatch on key order alone even when every
 * value is identical. Only used for insertProposal's own replay-vs-conflict comparison below.
 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export async function insertProposal(sql: SQL, input: NewProposalInput): Promise<void> {
  const taskRows = (await sql`select status from tasks where id = ${input.taskId}`) as Array<{ status: string }>;
  if (!taskRows[0] || taskRows[0].status !== 'open') {
    throw new TaskNotOpenError(`task ${input.taskId} is not open for negotiation`);
  }
  const inserted = (await sql`
    insert into a2a_proposals (id, task_id, from_repo, to_repo, kind, ask, status)
    values (${input.id}, ${input.taskId}, ${input.fromRepo}, ${input.toRepo}, ${input.kind}, ${input.ask}, 'proposed')
    on conflict (id) do nothing
    returning id
  `) as unknown[];
  if (inserted.length > 0) return; // won the insert — nothing further to check

  const existingRows = (await sql`
    select task_id, from_repo, to_repo, kind, ask from a2a_proposals where id = ${input.id}
  `) as Array<{ task_id: string; from_repo: string; to_repo: string; kind: string; ask: unknown }>;
  const existing = existingRows[0];
  const same =
    !!existing &&
    existing.task_id === input.taskId &&
    existing.from_repo === input.fromRepo &&
    existing.to_repo === input.toRepo &&
    existing.kind === input.kind &&
    stableStringify(existing.ask) === stableStringify(input.ask);
  if (!same) {
    throw new ProposalIdConflictError(`proposal ${input.id} already exists with a different task/repos/kind/ask`);
  }
  // Identical replay (A3): the existing row already IS this request's outcome — safe no-op.
}

export interface MaterializeResult {
  jobId?: string;
  depId?: string;
  gateId?: string;
}

/**
 * accept's materialize (P3 migration 11, rule 8): writes ask.job/dep/gate, all in ONE transaction
 * (spec's "원자 materialize"). D-round task #7 (Codex critical + Grok F-B1/B2/B3): this is now a
 * tx-RECEIVING function (insertJobTx's own pattern) instead of owning its own `sql.begin` — the
 * caller (rest.ts's acceptProposal) holds ONE transaction across the proposal's FOR UPDATE lock,
 * this materialize, and the status CAS, so "원자" now literally means no separate statement, not
 * just "this part alone is a transaction."
 *
 * `actorRepoId` is the provider (accepting party) — insertJobTx's own ACL check (actorRepoId ===
 * job.repoId) is what actually rejects a job ask aimed at someone else's repo (via
 * ask.job.repoId); this function doesn't duplicate that check, it just supplies actorRepoId as the
 * acting party and lets ask.job.repoId (or actorRepoId itself, by default) be the job's own repoId.
 *
 * D-round task #19 / Fable m3 (EmptyAskError): an ask with none of job/dep/gate is rejected outright
 * — it must not silently "succeed" as accepted while materializing nothing.
 * D-round task #19 / Fable m4 (repos self-heal): before the job insert, ensures a repos row exists
 * for the job's own repoId — mirrors dispatchTask's own `insert into repos ... on conflict do
 * nothing` (rest.ts:349) so a provider repo that registered after boot (no backfill yet) doesn't
 * 500 on the jobs.repo_id FK instead of getting a clean materialize.
 * D-round task #21 / Fable M2-a: the dep ask's waiter must belong to THIS negotiation's own task
 * (`expectWaiterTaskId: ask.taskId`, enforced inside insertDepTx) — closes the "ask names some
 * unrelated task's job as the waiter" hole; task #21's other guards (target existence, waiter
 * pending/blocked, expectedGen) are insertDepTx's own, shared with dep_declare.
 */
export async function materializeAskTx(tx: SQL, actorRepoId: string, ask: NegotiationAsk, newId: () => string): Promise<MaterializeResult> {
  if (!ask.job && !ask.dep && !ask.gate) {
    throw new EmptyAskError('ask must include at least one of job, dep, or gate');
  }
  const taskRows = (await tx`select status from tasks where id = ${ask.taskId} for update`) as Array<{ status: string }>;
  if (taskRows[0] && taskRows[0].status !== 'open') {
    throw new TerminalTaskError(`task ${ask.taskId} is terminal (${taskRows[0].status})`);
  }
  const out: MaterializeResult = {};
  if (ask.job) {
    const jobId = newId();
    const jobRepoId = ask.job.repoId ?? actorRepoId;
    await tx`insert into repos (id, product_id, name, cwd) values (${jobRepoId}, 'legacy', ${jobRepoId}, '.') on conflict (id) do nothing`;
    await insertJobTx(tx, actorRepoId, { id: jobId, taskId: ask.taskId, repoId: jobRepoId, title: ask.job.title, description: ask.job.description });
    out.jobId = jobId;
  }
  if (ask.dep) {
    const depId = newId();
    await insertDepTx(tx, {
      id: depId,
      waiterJobId: ask.dep.waiterJobId,
      targetType: ask.dep.targetType,
      targetId: ask.dep.targetId,
      predicate: ask.dep.predicate,
      acceptable: ask.dep.acceptable,
      expectedGen: ask.dep.expectedGen,
      expectWaiterTaskId: ask.taskId,
    });
    out.depId = depId;
  }
  if (ask.gate) {
    const gateId = newId();
    await tx`insert into external_gates (id, task_id, kind, description, status) values (${gateId}, ${ask.taskId}, ${ask.gate.kind}, ${ask.gate.description ?? null}, 'pending')`;
    out.gateId = gateId;
  }
  return out;
}
