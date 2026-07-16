import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { SQL } from 'bun';
import { createRestApi } from './rest';
import { ensureSchema } from '../infra/schema';

/**
 * P3 migration 10/11 (harness/job-graph.md), rule 8's negotiation half (spec B/C/E): request ->
 * (accept | counter), at most one round-trip, no FSM. Routed via message/send's
 * metadata.negotiation instead of dispatchTask (F2) — the intent path (F1) is untouched, proven
 * separately by dispatch-task.characterization.spec.ts staying green unmodified.
 *
 * repoA = requester, repoB = provider for most cases; C-series flips them via counter.
 */
const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const MARK = `a2aneg-${process.pid}-${Date.now()}`;
const repoA = `${MARK}-repoA`;
const repoB = `${MARK}-repoB`;

let idSeq = 0;
const id = (label: string) => `${MARK}-${label}-${idSeq++}`;
const newId = () => id('gen');

function sendNegotiation(
  app: ReturnType<typeof createRestApi>,
  projectId: string,
  rpcId: string,
  messageId: string,
  negotiation: Record<string, unknown>,
): Promise<Response> {
  const envelope = {
    jsonrpc: '2.0',
    id: rpcId,
    method: 'message/send',
    params: {
      message: {
        kind: 'message',
        messageId,
        role: 'user',
        parts: [{ kind: 'text', text: 'negotiation' }],
        metadata: { negotiation },
      },
    },
  };
  return app.handle(
    new Request(`http://localhost/agents/${encodeURIComponent(projectId)}/a2a`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
    }),
  );
}

async function makeTask(status: 'open' | 'done' | 'failed' | 'cancelled' = 'open'): Promise<string> {
  const taskId = id('task');
  await sql`insert into tasks (id, title, status) values (${taskId}, ${taskId}, ${status})`;
  return taskId;
}

async function seedJob(taskId: string, repoId: string, status = 'pending', title = 'x'): Promise<string> {
  const jobId = id('job');
  await sql`insert into jobs (id, task_id, repo_id, title, status) values (${jobId}, ${taskId}, ${repoId}, ${title}, ${status})`;
  return jobId;
}

async function proposalRow(proposalId: string): Promise<Record<string, unknown> | undefined> {
  const rows = (await sql`select * from a2a_proposals where id = ${proposalId}`) as Array<Record<string, unknown>>;
  return rows[0];
}

beforeAll(async () => {
  await ensureSchema(sql);
  await sql`insert into products (id, name) values (${MARK}, ${MARK})`;
  await sql`insert into repos (id, product_id, name, cwd) values (${repoA}, ${MARK}, ${repoA}, '/tmp')`;
  await sql`insert into repos (id, product_id, name, cwd) values (${repoB}, ${MARK}, ${repoB}, '/tmp')`;
  await sql`insert into projects (id, name, status) values (${repoA}, ${repoA}, 'active')`;
  await sql`insert into projects (id, name, status) values (${repoB}, ${repoB}, 'active')`;
});

afterAll(async () => {
  await sql`delete from a2a_inbox where message_id like ${MARK + '%'}`;
  await sql`delete from a2a_proposals where id like ${MARK + '%'}`;
  await sql`delete from dep_members where dep_id like ${MARK + '%'}`;
  await sql`delete from deps where id like ${MARK + '%'}`;
  await sql`delete from external_gates where id like ${MARK + '%'}`;
  await sql`delete from jobs where id like ${MARK + '%'}`;
  await sql`delete from tasks where id like ${MARK + '%'}`;
  await sql`delete from repos where id like ${MARK + '%'}`;
  await sql`delete from products where id = ${MARK}`;
  await sql`delete from work_items where project_id like ${MARK + '%'}`;
  await sql`delete from projects where id like ${MARK + '%'}`;
  await sql.end();
});

describe('B: request -> accept -> materialize', () => {
  it('B1: request(job ask) creates a proposed proposal and inserts no job', async () => {
    const app = createRestApi(sql, { newId });
    const taskId = await makeTask();
    const proposalId = id('proposal');

    const res = await sendNegotiation(app, repoB, id('rpc'), id('msg'), {
      kind: 'request',
      proposalId,
      fromRepo: repoA,
      ask: { taskId, job: { title: 'do the thing' } },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: unknown };
    expect(body.result).toEqual({ kind: 'negotiation', proposalId, status: 'proposed' });

    const row = await proposalRow(proposalId);
    expect(row).toMatchObject({ status: 'proposed', from_repo: repoA, to_repo: repoB, kind: 'request' });

    const jobRows = (await sql`select 1 from jobs where task_id = ${taskId}`) as unknown[];
    expect(jobRows).toHaveLength(0);
  });

  it('B2: accept(job ask) materializes a pending job in one transaction', async () => {
    const app = createRestApi(sql, { newId });
    const taskId = await makeTask();
    const proposalId = id('proposal');
    await sendNegotiation(app, repoB, id('rpc'), id('msg'), {
      kind: 'request',
      proposalId,
      fromRepo: repoA,
      ask: { taskId, job: { title: 'ship it', description: 'desc' } },
    });

    const res = await sendNegotiation(app, repoB, id('rpc'), id('msg'), { kind: 'accept', proposalId });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { status: string; jobId: string } };
    expect(body.result.status).toBe('accepted');
    const jobId = body.result.jobId;
    expect(jobId).toBeTruthy();

    const jobRows = (await sql`select status, repo_id, task_id, title, description from jobs where id = ${jobId}`) as Array<Record<string, unknown>>;
    expect(jobRows[0]).toMatchObject({ status: 'pending', repo_id: repoB, task_id: taskId, title: 'ship it', description: 'desc' });

    const row = await proposalRow(proposalId);
    expect(row?.status).toBe('accepted');
  });

  it('B3: accept rejects a job ask whose repoId is not the provider (ACL)', async () => {
    const app = createRestApi(sql, { newId });
    const taskId = await makeTask();
    const proposalId = id('proposal');
    const someoneElse = id('not-the-provider');
    await sendNegotiation(app, repoB, id('rpc'), id('msg'), {
      kind: 'request',
      proposalId,
      fromRepo: repoA,
      ask: { taskId, job: { title: 'sneaky', repoId: someoneElse } },
    });

    const res = await sendNegotiation(app, repoB, id('rpc'), id('msg'), { kind: 'accept', proposalId });
    expect(res.status).toBe(200); // JSON-RPC error, not an HTTP failure
    const body = (await res.json()) as { error?: { message: string }; result?: unknown };
    expect(body.result).toBeUndefined();
    expect(body.error).toBeDefined();

    const row = await proposalRow(proposalId);
    expect(row?.status).toBe('rejected');
    const jobRows = (await sql`select 1 from jobs where task_id = ${taskId}`) as unknown[];
    expect(jobRows).toHaveLength(0); // materialize rolled back, nothing landed
  });

  it('B4: accept(dep ask) creates deps + dep_members', async () => {
    const app = createRestApi(sql, { newId });
    const taskId = await makeTask();
    const waiterJobId = await seedJob(taskId, repoA, 'pending');
    const targetJobId = await seedJob(taskId, repoB, 'pending');
    const proposalId = id('proposal');
    await sendNegotiation(app, repoB, id('rpc'), id('msg'), {
      kind: 'request',
      proposalId,
      fromRepo: repoA,
      ask: { taskId, dep: { waiterJobId, targetType: 'job', targetId: targetJobId } },
    });

    const res = await sendNegotiation(app, repoB, id('rpc'), id('msg'), { kind: 'accept', proposalId });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { depId: string } };
    const depId = body.result.depId;
    expect(depId).toBeTruthy();

    const depRows = (await sql`select waiter_job, predicate, status from deps where id = ${depId}`) as Array<Record<string, unknown>>;
    expect(depRows[0]).toMatchObject({ waiter_job: waiterJobId, predicate: 'all', status: 'active' });
    const memberRows = (await sql`select target_type, target_id, acceptable from dep_members where dep_id = ${depId}`) as Array<Record<string, unknown>>;
    expect(memberRows[0]).toMatchObject({ target_type: 'job', target_id: targetJobId, acceptable: ['satisfied'] });
  });

  it('B5: accept(gate ask) creates a pending external_gate', async () => {
    const app = createRestApi(sql, { newId });
    const taskId = await makeTask();
    const proposalId = id('proposal');
    await sendNegotiation(app, repoB, id('rpc'), id('msg'), {
      kind: 'request',
      proposalId,
      fromRepo: repoA,
      ask: { taskId, gate: { kind: 'manual-review', description: 'needs a human' } },
    });

    const res = await sendNegotiation(app, repoB, id('rpc'), id('msg'), { kind: 'accept', proposalId });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { gateId: string } };
    const gateId = body.result.gateId;
    expect(gateId).toBeTruthy();

    const gateRows = (await sql`select task_id, kind, description, status from external_gates where id = ${gateId}`) as Array<Record<string, unknown>>;
    expect(gateRows[0]).toMatchObject({ task_id: taskId, kind: 'manual-review', description: 'needs a human', status: 'pending' });
  });

  it('B6: accept rolls back and rejects the proposal when the dep would create a cycle', async () => {
    const app = createRestApi(sql, { newId });
    const taskId = await makeTask();
    const jobX = await seedJob(taskId, repoB, 'pending');
    const jobY = await seedJob(taskId, repoB, 'pending');
    // Existing edge: X waits on Y.
    const existingDepId = id('dep');
    await sql`insert into deps (id, waiter_job) values (${existingDepId}, ${jobX})`;
    await sql`insert into dep_members (dep_id, target_type, target_id) values (${existingDepId}, 'job', ${jobY})`;

    // Proposed edge: Y waits on X — would close the cycle.
    const proposalId = id('proposal');
    await sendNegotiation(app, repoB, id('rpc'), id('msg'), {
      kind: 'request',
      proposalId,
      fromRepo: repoA,
      ask: { taskId, dep: { waiterJobId: jobY, targetType: 'job', targetId: jobX } },
    });

    const res = await sendNegotiation(app, repoB, id('rpc'), id('msg'), { kind: 'accept', proposalId });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { error?: unknown; result?: unknown };
    expect(body.result).toBeUndefined();
    expect(body.error).toBeDefined();

    const row = await proposalRow(proposalId);
    expect(row?.status).toBe('rejected');
    const depRows = (await sql`select 1 from deps where waiter_job = ${jobY}`) as unknown[];
    expect(depRows).toHaveLength(0); // rolled back — the new edge never landed
  });

  it('B7: accepting an already-accepted proposal is idempotent (no second job)', async () => {
    const app = createRestApi(sql, { newId });
    const taskId = await makeTask();
    const proposalId = id('proposal');
    await sendNegotiation(app, repoB, id('rpc'), id('msg'), {
      kind: 'request',
      proposalId,
      fromRepo: repoA,
      ask: { taskId, job: { title: 'once only' } },
    });
    const res1 = await sendNegotiation(app, repoB, id('rpc'), id('msg'), { kind: 'accept', proposalId });
    const body1 = (await res1.json()) as { result: { jobId: string } };

    // A DIFFERENT messageId re-accepting the SAME proposalId — a2a_inbox never sees this one,
    // so it's the accept HANDLER's own idempotency (B7), not the outer messageId dedup.
    const res2 = await sendNegotiation(app, repoB, id('rpc'), id('msg'), { kind: 'accept', proposalId });
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { result: { alreadyAccepted: boolean } };
    expect(body2.result.alreadyAccepted).toBe(true);

    const jobRows = (await sql`select 1 from jobs where task_id = ${taskId}`) as unknown[];
    expect(jobRows).toHaveLength(1); // still exactly the one job from the first accept
    expect(body1.result.jobId).toBeTruthy();
  });

  it('B8a: request into a terminal task is rejected, no proposal recorded', async () => {
    const app = createRestApi(sql, { newId });
    const taskId = await makeTask('done');
    const proposalId = id('proposal');

    const res = await sendNegotiation(app, repoB, id('rpc'), id('msg'), {
      kind: 'request',
      proposalId,
      fromRepo: repoA,
      ask: { taskId, job: { title: 'too late' } },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { error?: unknown; result?: unknown };
    expect(body.result).toBeUndefined();
    expect(body.error).toBeDefined();
    expect(await proposalRow(proposalId)).toBeUndefined();
  });

  it('B8b: accept into a task that turned terminal after the request is rejected (rule 9)', async () => {
    const app = createRestApi(sql, { newId });
    const taskId = await makeTask('open');
    const proposalId = id('proposal');
    await sendNegotiation(app, repoB, id('rpc'), id('msg'), {
      kind: 'request',
      proposalId,
      fromRepo: repoA,
      ask: { taskId, job: { title: 'doomed' } },
    });
    await sql`update tasks set status = 'done' where id = ${taskId}`; // sealed elsewhere, between request and accept

    const res = await sendNegotiation(app, repoB, id('rpc'), id('msg'), { kind: 'accept', proposalId });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { error?: unknown; result?: unknown };
    expect(body.result).toBeUndefined();
    expect(body.error).toBeDefined();
    expect((await proposalRow(proposalId))?.status).toBe('rejected');
  });
});

describe('C: counter-proposals', () => {
  it('C1: a counter marks the original countered and records a direction-reversed proposal, without materializing', async () => {
    const app = createRestApi(sql, { newId });
    const taskId = await makeTask();
    const proposalId = id('proposal');
    await sendNegotiation(app, repoB, id('rpc'), id('msg'), {
      kind: 'request',
      proposalId,
      fromRepo: repoA,
      ask: { taskId, job: { title: 'original ask' } },
    });

    // repoB doesn't want the original ask; counters with a different one. Per the protocol, roles
    // reverse — the counter is posted to the ORIGINAL REQUESTER's own endpoint (repoA).
    const res = await sendNegotiation(app, repoA, id('rpc'), id('msg'), {
      kind: 'counter',
      proposalId,
      ask: { taskId, job: { title: 'counter ask instead' } },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { status: string; counterProposalId: string } };
    expect(body.result.status).toBe('countered');
    const counterProposalId = body.result.counterProposalId;
    expect(counterProposalId).toBeTruthy();

    const original = await proposalRow(proposalId);
    expect(original?.status).toBe('countered');
    const counter = await proposalRow(counterProposalId);
    expect(counter).toMatchObject({ status: 'proposed', from_repo: repoB, to_repo: repoA, kind: 'counter' });

    const jobRows = (await sql`select 1 from jobs where task_id = ${taskId}`) as unknown[];
    expect(jobRows).toHaveLength(0); // neither ask ever materialized
  });

  it('C2: the original requester accepting the counter materializes it (direction-reversed accept)', async () => {
    const app = createRestApi(sql, { newId });
    const taskId = await makeTask();
    const proposalId = id('proposal');
    await sendNegotiation(app, repoB, id('rpc'), id('msg'), {
      kind: 'request',
      proposalId,
      fromRepo: repoA,
      ask: { taskId, job: { title: 'original ask' } },
    });
    const counterRes = await sendNegotiation(app, repoA, id('rpc'), id('msg'), {
      kind: 'counter',
      proposalId,
      ask: { taskId, job: { title: 'counter ask' } },
    });
    const { counterProposalId } = ((await counterRes.json()) as { result: { counterProposalId: string } }).result;

    // repoA is now the PROVIDER of the counter (from_repo=repoB, to_repo=repoA) — repoA accepts
    // via its own endpoint, materializing the counter's job into repoA's own repo.
    const res = await sendNegotiation(app, repoA, id('rpc'), id('msg'), { kind: 'accept', proposalId: counterProposalId });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { status: string; jobId: string } };
    expect(body.result.status).toBe('accepted');

    const jobRows = (await sql`select repo_id, title from jobs where id = ${body.result.jobId}`) as Array<Record<string, unknown>>;
    expect(jobRows[0]).toMatchObject({ repo_id: repoA, title: 'counter ask' });
  });

  it('C3: a counter to a counter is recorded without materializing either side', async () => {
    const app = createRestApi(sql, { newId });
    const taskId = await makeTask();
    const proposalId = id('proposal');
    await sendNegotiation(app, repoB, id('rpc'), id('msg'), {
      kind: 'request',
      proposalId,
      fromRepo: repoA,
      ask: { taskId, job: { title: 'ask 1' } },
    });
    const counter1Res = await sendNegotiation(app, repoA, id('rpc'), id('msg'), {
      kind: 'counter',
      proposalId,
      ask: { taskId, job: { title: 'ask 2' } },
    });
    const { counterProposalId: counter1Id } = ((await counter1Res.json()) as { result: { counterProposalId: string } }).result;

    // repoB counters BACK — roles reverse again, so this counter lands at repoB's own endpoint
    // (counter1's provider is repoA per C1's direction-reversal, so counter1's own counter reverses
    // back to repoB).
    const counter2Res = await sendNegotiation(app, repoB, id('rpc'), id('msg'), {
      kind: 'counter',
      proposalId: counter1Id,
      ask: { taskId, job: { title: 'ask 3' } },
    });
    expect(counter2Res.status).toBe(200);
    const body2 = (await counter2Res.json()) as { result: { status: string; counterProposalId: string } };
    expect(body2.result.status).toBe('countered');

    expect((await proposalRow(proposalId))?.status).toBe('countered');
    expect((await proposalRow(counter1Id))?.status).toBe('countered');
    const counter2 = await proposalRow(body2.result.counterProposalId);
    expect(counter2?.status).toBe('proposed');

    const jobRows = (await sql`select 1 from jobs where task_id = ${taskId}`) as unknown[];
    expect(jobRows).toHaveLength(0); // three asks on the table, none ever accepted
  });
});

describe('E: messageId idempotency x negotiation (retransmit safety)', () => {
  it('E1: a request retransmit interleaved with an accept processes both correctly', async () => {
    const app = createRestApi(sql, { newId });
    const taskId = await makeTask();
    const proposalId = id('proposal');
    const requestMsgId = id('msg');
    // Same rpc envelope id reused across both request calls: a genuine retry of the SAME message
    // resends the SAME envelope, and the replay's response echoes THAT id back (P3-1's rule) — so
    // asserting byte-identical replies requires holding this constant, same as a2a-idempotency.spec.ts.
    const requestRpcId = id('rpc');
    const requestRes1 = await sendNegotiation(app, repoB, requestRpcId, requestMsgId, {
      kind: 'request',
      proposalId,
      fromRepo: repoA,
      ask: { taskId, job: { title: 'e1 ask' } },
    });
    const body1 = await requestRes1.json();

    // An accept for the same proposal, in between.
    const acceptRes = await sendNegotiation(app, repoB, id('rpc'), id('msg'), { kind: 'accept', proposalId });
    expect(acceptRes.status).toBe(200);
    const acceptBody = (await acceptRes.json()) as { result: { status: string } };
    expect(acceptBody.result.status).toBe('accepted');

    // The retransmitted request (SAME messageId + envelope id) returns the stored 'proposed' response, unaffected.
    const requestRes2 = await sendNegotiation(app, repoB, requestRpcId, requestMsgId, {
      kind: 'request',
      proposalId,
      fromRepo: repoA,
      ask: { taskId, job: { title: 'e1 ask' } },
    });
    const body2 = await requestRes2.json();
    expect(body2).toEqual(body1);

    // Still exactly one accepted proposal, one job.
    expect((await proposalRow(proposalId))?.status).toBe('accepted');
    const jobRows = (await sql`select 1 from jobs where task_id = ${taskId}`) as unknown[];
    expect(jobRows).toHaveLength(1);
  });

  it('E2: an accept retransmit after materialize replays the stored response, no duplicate job', async () => {
    const app = createRestApi(sql, { newId });
    const taskId = await makeTask();
    const proposalId = id('proposal');
    await sendNegotiation(app, repoB, id('rpc'), id('msg'), {
      kind: 'request',
      proposalId,
      fromRepo: repoA,
      ask: { taskId, job: { title: 'e2 ask' } },
    });
    const acceptMsgId = id('msg');
    const acceptRpcId = id('rpc'); // held constant across both calls — see E1's comment on why
    const res1 = await sendNegotiation(app, repoB, acceptRpcId, acceptMsgId, { kind: 'accept', proposalId });
    const body1 = await res1.json();

    const res2 = await sendNegotiation(app, repoB, acceptRpcId, acceptMsgId, { kind: 'accept', proposalId }); // same messageId, retransmit
    const body2 = await res2.json();
    expect(body2).toEqual(body1);

    const jobRows = (await sql`select 1 from jobs where task_id = ${taskId}`) as unknown[];
    expect(jobRows).toHaveLength(1);
  });

  it('E3: three retries of the same accept materialize exactly once', async () => {
    const app = createRestApi(sql, { newId });
    const taskId = await makeTask();
    const proposalId = id('proposal');
    await sendNegotiation(app, repoB, id('rpc'), id('msg'), {
      kind: 'request',
      proposalId,
      fromRepo: repoA,
      ask: { taskId, job: { title: 'e3 ask' } },
    });
    const acceptMsgId = id('msg');
    for (let i = 0; i < 3; i++) {
      const res = await sendNegotiation(app, repoB, id('rpc'), acceptMsgId, { kind: 'accept', proposalId });
      expect(res.status).toBe(200);
    }

    const jobRows = (await sql`select 1 from jobs where task_id = ${taskId}`) as unknown[];
    expect(jobRows).toHaveLength(1); // a2a_inbox sealed it after the first
  });
});

describe('F: negotiation never touches the intent path', () => {
  it('F2: a negotiation message creates no work_items row', async () => {
    const app = createRestApi(sql, { newId });
    const taskId = await makeTask();
    const proposalId = id('proposal');

    await sendNegotiation(app, repoB, id('rpc'), id('msg'), {
      kind: 'request',
      proposalId,
      fromRepo: repoA,
      ask: { taskId, job: { title: 'f2 ask' } },
    });

    const workItemRows = (await sql`select 1 from work_items where project_id = ${repoB}`) as unknown[];
    expect(workItemRows).toHaveLength(0);
  });
});
