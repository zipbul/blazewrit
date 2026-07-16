import type { SQL } from 'bun';
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
 */
export interface NegotiationAsk {
  taskId: string;
  job?: { title: string; description?: string; repoId?: string };
  dep?: { waiterJobId: string; targetType: DepTargetType; targetId: string; predicate?: DepPredicate; acceptable?: DepOutcome[] };
  gate?: { kind: string; description?: string };
}

/** requestProposal / a2a_request reject: the ask's task isn't open (already terminal, or never existed). */
export class TaskNotOpenError extends Error {}

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
 * materializes (accept does, via materializeAsk). `on conflict do nothing` (A3): a retried write
 * of the SAME id is a safe no-op, matching rest.ts's existing idempotency note.
 */
export async function insertProposal(sql: SQL, input: NewProposalInput): Promise<void> {
  const taskRows = (await sql`select status from tasks where id = ${input.taskId}`) as Array<{ status: string }>;
  if (!taskRows[0] || taskRows[0].status !== 'open') {
    throw new TaskNotOpenError(`task ${input.taskId} is not open for negotiation`);
  }
  await sql`
    insert into a2a_proposals (id, task_id, from_repo, to_repo, kind, ask, status)
    values (${input.id}, ${input.taskId}, ${input.fromRepo}, ${input.toRepo}, ${input.kind}, ${input.ask}, 'proposed')
    on conflict (id) do nothing
  `;
}
