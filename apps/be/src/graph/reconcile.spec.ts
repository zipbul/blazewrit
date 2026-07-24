import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { SQL } from 'bun';
import { ensureSchema } from '../infra/schema';
import { consumeJobEvents, reconcileTask, type ReconcileJob } from './reconcile';
import { insertDepTx } from './store';
import type { JobStatus } from './types';

// Integration test: exercises reconcile against a live Postgres (harness/job-graph.md migration step 8).
const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const PREFIX = `reconcile-${process.pid}-${Date.now()}`;
let n = 0;
const id = (label: string) => `${PREFIX}-${label}-${n++}`;

/** Builds a product → repo → open task chain, same minimum every graph fixture needs. */
async function makeChain() {
  const productId = id('product');
  const repoId = id('repo');
  const taskId = id('task');
  await sql`insert into products (id, name) values (${productId}, ${productId})`;
  await sql`insert into repos (id, product_id, name, cwd) values (${repoId}, ${productId}, ${repoId}, '/tmp')`;
  await sql`insert into tasks (id, title, status) values (${taskId}, ${taskId}, 'open')`;
  return { productId, repoId, taskId };
}

/** Raw fixture insert — bypasses graph/store.ts's insertJob so a fixture can start at any status. */
async function seedJob(taskId: string, repoId: string, status: JobStatus, title = 'x'): Promise<string> {
  const jobId = id('job');
  await sql`insert into jobs (id, task_id, repo_id, title, status) values (${jobId}, ${taskId}, ${repoId}, ${title}, ${status})`;
  return jobId;
}

async function jobStatus(jobId: string): Promise<string> {
  const rows = (await sql`select status from jobs where id = ${jobId}`) as Array<{ status: string }>;
  return rows[0]!.status;
}

async function jobLeaseExpiresAt(jobId: string): Promise<Date | null> {
  const rows = (await sql`select lease_expires_at from jobs where id = ${jobId}`) as Array<{ lease_expires_at: Date | null }>;
  return rows[0]!.lease_expires_at;
}

beforeAll(async () => {
  await ensureSchema(sql);
});

afterAll(async () => {
  // FK-reverse order.
  await sql`delete from job_events where job_id like ${PREFIX + '%'}`;
  await sql`delete from work_items where id like ${PREFIX + '%'}`;
  await sql`delete from dep_members where dep_id like ${PREFIX + '%'}`;
  await sql`delete from deps where id like ${PREFIX + '%'}`;
  await sql`delete from jobs where id like ${PREFIX + '%'}`;
  await sql`delete from tasks where id like ${PREFIX + '%'}`;
  await sql`delete from repos where id like ${PREFIX + '%'}`;
  await sql`delete from products where id like ${PREFIX + '%'}`;
  await sql.end();
});

describe('reconcileTask (harness/job-graph.md migration step 8)', () => {
  test('a pending job with no deps is claimed (running) and handed to dispatch', async () => {
    const { repoId, taskId } = await makeChain();
    const jobId = await seedJob(taskId, repoId, 'pending');
    const dispatch = mock(async (_job: ReconcileJob) => {});

    const result = await reconcileTask(sql, taskId, dispatch);

    expect(result.claimed).toEqual([jobId]);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ id: jobId, repoId, taskId, title: 'x' });
    expect(await jobStatus(jobId)).toBe('running');
  });

  test('a job with an unmet dep is not dispatched and transitions to blocked', async () => {
    const { repoId, taskId } = await makeChain();
    // The dep's target job is deliberately NOT pending/blocked (so this same reconcile pass
    // never independently claims it too) and not done — its outcome reads as 'pending', so the
    // dep stays unmet.
    const targetJobId = await seedJob(taskId, repoId, 'running');
    const waiterJobId = await seedJob(taskId, repoId, 'pending');
    const depId = id('dep');
    await sql`insert into deps (id, waiter_job) values (${depId}, ${waiterJobId})`;
    await sql`insert into dep_members (dep_id, target_type, target_id) values (${depId}, 'job', ${targetJobId})`;
    const dispatch = mock(async (_job: ReconcileJob) => {});

    const result = await reconcileTask(sql, taskId, dispatch);

    expect(result.claimed).not.toContain(waiterJobId);
    expect(dispatch).not.toHaveBeenCalled();
    expect(await jobStatus(waiterJobId)).toBe('blocked');
  });

  test('an already-running job is left alone on a repeat pass (atomic claim is idempotent)', async () => {
    const { repoId, taskId } = await makeChain();
    const jobId = await seedJob(taskId, repoId, 'running');
    const dispatch = mock(async (_job: ReconcileJob) => {});

    const result = await reconcileTask(sql, taskId, dispatch);

    expect(result.claimed).toEqual([]);
    expect(dispatch).not.toHaveBeenCalled();
    expect(await jobStatus(jobId)).toBe('running');
  });

  test('a dispatch that throws fails only that job; the rest of the pass still runs', async () => {
    const { repoId, taskId } = await makeChain();
    const failingJobId = await seedJob(taskId, repoId, 'pending');
    const okJobId = await seedJob(taskId, repoId, 'pending');
    const dispatch = mock(async (job: ReconcileJob) => {
      if (job.id === failingJobId) throw new Error('boom');
    });

    const result = await reconcileTask(sql, taskId, dispatch);

    expect(result.claimed.slice().sort()).toEqual([failingJobId, okJobId].sort());
    expect(await jobStatus(failingJobId)).toBe('failed');
    expect(await jobStatus(okJobId)).toBe('running');
  });
});

describe('reconcileTask — lease (harness/job-graph.md P2 spec A1)', () => {
  test('claiming a job (ready→running) sets lease_expires_at to roughly now + the configured TTL', async () => {
    const { repoId, taskId } = await makeChain();
    const jobId = await seedJob(taskId, repoId, 'pending');
    const dispatch = mock(async (_job: ReconcileJob) => {});
    const leaseTtlMs = 60_000;
    const before = Date.now();

    await reconcileTask(sql, taskId, dispatch, { leaseTtlMs });

    const leaseExpiresAt = await jobLeaseExpiresAt(jobId);
    expect(leaseExpiresAt).not.toBeNull();
    const deltaMs = leaseExpiresAt!.getTime() - before;
    // Generous window around the TTL — this only guards against gross wiring mistakes (e.g. the
    // wrong unit or no TTL applied at all), not clock precision.
    expect(deltaMs).toBeGreaterThan(leaseTtlMs - 5_000);
    expect(deltaMs).toBeLessThan(leaseTtlMs + 5_000);
  });

  test('reconcileTask defaults the lease TTL when opts is omitted', async () => {
    const { repoId, taskId } = await makeChain();
    const jobId = await seedJob(taskId, repoId, 'pending');
    const dispatch = mock(async (_job: ReconcileJob) => {});

    await reconcileTask(sql, taskId, dispatch);

    const leaseExpiresAt = await jobLeaseExpiresAt(jobId);
    expect(leaseExpiresAt).not.toBeNull();
    expect(leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('reconcileTask — dep status write latch CAS (E-round task #8, Grok F-A2)', () => {
  /**
   * F-A2: jobIsReady's dep status write (`update deps set status = ${newStatus} where id =
   * ${dep.id}`) carried no status condition — `dep.status` (the SELECT snapshot this pass's own
   * evaluateDep call ran against) could be stale by the time the WRITE lands if a DIFFERENT,
   * concurrently-committing reconcile pass already released this SAME dep in between (dispatchTask's
   * inline call and this always-on controller's tick are NOT mutually exclusive, same as C1's own
   * rationale). An unconditional write then clobbers 'released' back to 'stale'/'active' — a real
   * regression of rule 11's latch (once released, never reverts).
   *
   * Constructed deterministically (no timing luck, same technique as the C1 test below): a
   * `for update` lock is taken on the dep row in a SEPARATE transaction, which ALSO writes
   * status='released' (but doesn't commit yet) — reconcileTask's own conditional UPDATE, once it
   * gets there, genuinely BLOCKS on that same row (a real Postgres write-write conflict, not a
   * race) until the lock is released.
   */
  test('a released dep is never clobbered by a concurrently-committing reconcile pass', async () => {
    const { repoId, taskId } = await makeChain();
    const targetJobId = await seedJob(taskId, repoId, 'pending'); // stays unmet — evaluateDep won't itself compute 'released'
    const waiterJobId = await seedJob(taskId, repoId, 'pending');
    const depId = id('dep');
    await sql`insert into deps (id, waiter_job, status) values (${depId}, ${waiterJobId}, 'active')`;
    // expected_gen=99 mismatches the target's real generation (1) — isStaleMember forces evaluateDep
    // to compute 'stale' (not 'active'), so this pass's own write actually fires (newStatus differs
    // from the 'active' snapshot it read) instead of being skipped by the `if (newStatus !==
    // dep.status)` no-op guard.
    await sql`insert into dep_members (dep_id, target_type, target_id, expected_gen) values (${depId}, 'job', ${targetJobId}, 99)`;
    const dispatch = mock(async (_job: ReconcileJob) => {});

    let releaseLock!: () => void;
    const continueSignal = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const lockTxDone = sql.begin(async (tx) => {
      await tx`select id from deps where id = ${depId} for update`;
      // The "concurrent pass" release, from the SAME transaction that already holds the lock (a
      // write from a DIFFERENT connection would itself block on this same lock).
      await tx`update deps set status = 'released' where id = ${depId}`;
      await continueSignal; // hold it open — don't commit yet
    });
    await new Promise((r) => setTimeout(r, 50)); // let the lock actually acquire + release-write land first

    const p = reconcileTask(sql, taskId, dispatch);
    await new Promise((r) => setTimeout(r, 100)); // let reconcileTask read the PRE-release snapshot and reach its own blocked write

    releaseLock();
    await lockTxDone; // commits status='released'
    await p; // reconcileTask's blocked write resumes now — CAS-guarded, no-ops against the now-'released' row

    const rows = (await sql`select status from deps where id = ${depId}`) as Array<{ status: string }>;
    expect(rows[0]!.status).toBe('released'); // must NOT be clobbered back to 'stale'
  });
});

describe('reconcileTask — not-ready blocked-write CAS (3자 리뷰 수정 C1, Grok F1)', () => {
  /**
   * F1: the not-ready branch's write (`update jobs set status = 'blocked' ...`) carried no status
   * condition — it used the LOOP's initial snapshot (`job.status`) to decide WHETHER to write, but
   * the WRITE itself was unconditional. If the row moved on (claimed 'running' by a concurrent
   * reconcile pass — dispatchTask's own inline call and the always-on controller's tick are NOT
   * mutually exclusive) between this pass's initial SELECT and this write, the write clobbered
   * that newer state back to 'blocked' — breaking the done/running monotonicity the rest of the
   * system depends on.
   *
   * Constructed deterministically (no timing luck): a `SELECT ... FOR UPDATE` held open on the
   * waiter job's own row forces reconcileTask's not-ready write to genuinely BLOCK on that lock
   * (a real Postgres wait, not a race) once it gets there. While it's blocked, the same holding
   * transaction claims the job 'running' and commits — releasing the lock right as reconcileTask's
   * write was waiting for it. The guarded write's WHERE clause then has to match a 'running' row.
   */
  test('a not-ready blocked-write does not clobber a job already claimed running by a concurrent pass', async () => {
    const { repoId, taskId } = await makeChain();
    const targetJobId = await seedJob(taskId, repoId, 'pending'); // dep target — stays unmet
    const jobId = await seedJob(taskId, repoId, 'pending');
    const depId = id('dep');
    await sql`insert into deps (id, waiter_job) values (${depId}, ${jobId})`;
    await sql`insert into dep_members (dep_id, target_type, target_id) values (${depId}, 'job', ${targetJobId})`;
    const dispatch = mock(async (_job: ReconcileJob) => {});

    let releaseLock!: () => void;
    const continueSignal = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const lockTxDone = sql.begin(async (tx) => {
      await tx`select id from jobs where id = ${jobId} for update`;
      await continueSignal; // hold the lock open while reconcileTask runs and blocks on it
      // The "concurrent pass" claim, issued from the SAME transaction that already holds the
      // lock (a write from a DIFFERENT connection would itself block on this same lock).
      await tx`update jobs set status = 'running', lease_expires_at = now() + interval '10 minutes' where id = ${jobId}`;
      // Committing here (transaction end) releases the lock — reconcileTask's own blocked write,
      // waiting on it, proceeds right after.
    });

    await new Promise((r) => setTimeout(r, 50)); // let the lock actually acquire first

    const p = reconcileTask(sql, taskId, dispatch);
    await new Promise((r) => setTimeout(r, 100)); // let reconcileTask reach (and block on) its write

    releaseLock();
    await lockTxDone;
    await p;

    const rows = (await sql`select status from jobs where id = ${jobId}`) as Array<{ status: string }>;
    expect(rows[0]!.status).toBe('running'); // must NOT be clobbered back to 'blocked'
  });
});

describe('reconcileTask — claim vs. concurrent dep_declare TOCTOU (harness handoff round-simv2-takeover.md W3)', () => {
  /**
   * Deterministic reproduction of the race the claim transaction's `for update` + re-check block
   * (reconcile.ts's own long comment right above `sql.begin`) exists to close: jobIsReady's own
   * "no unmet dep" read is a separate, non-locking SELECT — a dep_declare landing in the gap
   * between that read and the claim used to still let the claim through unconditionally (the
   * original claim UPDATE only ever checked `jobs.status`), permanently stranding the newly
   * attached dep on a job that had already left the pending/blocked set this function scans.
   *
   * Constructed the SAME way as the C1/F-A2 races above (real lock, not timing luck): insertDepTx
   * itself takes `for update` on the waiter row as its OWN first statement (store.ts) — the exact
   * same row reconcile's claim also locks. Held open here (via a real insertDepTx call inside
   * `sql.begin`, commit deferred until a signal) so reconcileTask's claim genuinely BLOCKS on it,
   * then resumes AFTER the dep has committed — proving the claim's post-lock re-check actually
   * observes it, not just that the two happen to interleave in the right order by chance.
   */
  test('a dep_declare landing between jobIsReady and claim makes the claim lose the race (job stays pending, dep untouched)', async () => {
    const { repoId, taskId } = await makeChain();
    // Deliberately NOT pending/blocked (same reasoning as the "unmet dep" test above): a 'pending'
    // target would itself be independently claimed and dispatched by this SAME reconcileTask call
    // (it has no deps of its own) — 'running' keeps it out of that scan entirely, so the only
    // dispatch this test could possibly see is for `jobId` itself.
    const targetJobId = await seedJob(taskId, repoId, 'running');
    const jobId = await seedJob(taskId, repoId, 'pending'); // no deps YET — jobIsReady reads it as ready until the race lands
    const depId = id('dep');
    const dispatch = mock(async (_job: ReconcileJob) => {});

    let releaseLock!: () => void;
    const continueSignal = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const insertTxDone = sql.begin(async (tx) => {
      await insertDepTx(tx, { id: depId, waiterJobId: jobId, targetType: 'job', targetId: targetJobId });
      await continueSignal; // hold insertDepTx's own `for update` lock on the waiter row open — don't commit yet
    });
    await new Promise((r) => setTimeout(r, 50)); // let insertDepTx actually acquire that lock first

    const p = reconcileTask(sql, taskId, dispatch);
    // jobIsReady's own SELECT runs here and sees ZERO deps (insertDepTx hasn't committed yet) —
    // ready=true — so the claim proceeds into its own `for update` on the SAME row and blocks.
    await new Promise((r) => setTimeout(r, 100)); // let reconcileTask reach (and block on) that lock

    releaseLock();
    await insertTxDone; // commits the dep — now visible to any NEW statement issued after this
    await p; // reconcileTask's claim resumes, re-checks deps under its own fresh lock, sees it, backs off

    expect(dispatch).not.toHaveBeenCalled();
    expect(await jobStatus(jobId)).toBe('pending'); // never claimed — the claim UPDATE matched 0 rows
    const depRows = (await sql`select status from deps where id = ${depId}`) as Array<{ status: string }>;
    expect(depRows[0]!.status).toBe('active'); // the dep itself is untouched — nothing raced it either
  });
});

/**
 * 단일 기록자 통합 Phase 1 (job-graph.md C1): consumeJobEvents is the ONLY thing that ever turns a
 * job_events row into a jobs.status write — execution (api/rest.ts) just records the fact.
 * api/dispatch-terminal-cas.spec.ts covers the full integration (real A2A dispatch racing a
 * stale/duplicate event through the real wiring); these tests exercise the consumer directly
 * against fixture rows, including the one path nothing in this codebase produces yet
 * (rerun_requested — store.bumpJobGeneration still writes directly; Phase 2 wires its producer).
 */
describe('consumeJobEvents (single-writer round, job-graph.md C1)', () => {
  async function jobGenStatus(jobId: string): Promise<{ status: string; generation: number }> {
    const rows = (await sql`select status, generation from jobs where id = ${jobId}`) as Array<{ status: string; generation: number }>;
    return rows[0]!;
  }

  async function eventProcessedAt(jobId: string, generation: number, kind: string): Promise<Date | null> {
    const rows = (await sql`
      select processed_at from job_events where job_id = ${jobId} and generation = ${generation} and kind = ${kind}
    `) as Array<{ processed_at: Date | null }>;
    return rows[0]?.processed_at ?? null;
  }

  test("a 'succeeded' event for a job still running at that generation applies done + marks processed", async () => {
    const { repoId, taskId } = await makeChain();
    const jobId = await seedJob(taskId, repoId, 'running');
    await sql`insert into work_items (id, project_id, type, state, title) values (${jobId}, ${repoId}, 'task', 'in_flow', 'x')`;
    await sql`insert into job_events (job_id, generation, kind) values (${jobId}, 1, 'succeeded')`;

    await consumeJobEvents(sql, taskId);

    expect(await jobGenStatus(jobId)).toEqual({ status: 'done', generation: 1 });
    const wiRows = (await sql`select state from work_items where id = ${jobId}`) as Array<{ state: string }>;
    expect(wiRows[0]!.state).toBe('done');
    expect(await eventProcessedAt(jobId, 1, 'succeeded')).not.toBeNull();
  });

  test("a 'failed' event for a job still running at that generation applies failed + blocks the work_items mirror", async () => {
    const { repoId, taskId } = await makeChain();
    const jobId = await seedJob(taskId, repoId, 'running');
    await sql`insert into work_items (id, project_id, type, state, title) values (${jobId}, ${repoId}, 'task', 'in_flow', 'x')`;
    await sql`insert into job_events (job_id, generation, kind) values (${jobId}, 1, 'failed')`;

    await consumeJobEvents(sql, taskId);

    expect(await jobGenStatus(jobId)).toEqual({ status: 'failed', generation: 1 });
    const wiRows = (await sql`select state from work_items where id = ${jobId}`) as Array<{ state: string }>;
    expect(wiRows[0]!.state).toBe('blocked');
  });

  test("a stale event whose generation no longer matches the running row is a no-op consumption", async () => {
    const { repoId, taskId } = await makeChain();
    const jobId = await seedJob(taskId, repoId, 'running');
    await sql`update jobs set generation = 2 where id = ${jobId}`;
    // A gen-1 event arrives for a job that's since moved on to generation 2 (re-claimed after a
    // gen++) — the event's own generation no longer matches the live row.
    await sql`insert into job_events (job_id, generation, kind) values (${jobId}, 1, 'succeeded')`;

    await consumeJobEvents(sql, taskId);

    expect(await jobGenStatus(jobId)).toEqual({ status: 'running', generation: 2 }); // untouched
    expect(await eventProcessedAt(jobId, 1, 'succeeded')).not.toBeNull(); // still consumed, just a no-op
  });

  test("an event for a job that is no longer 'running' at all (already terminal via another path) is a no-op consumption", async () => {
    const { repoId, taskId } = await makeChain();
    const jobId = await seedJob(taskId, repoId, 'failed'); // some other path already terminated it
    await sql`insert into job_events (job_id, generation, kind) values (${jobId}, 1, 'succeeded')`;

    await consumeJobEvents(sql, taskId);

    expect(await jobGenStatus(jobId)).toEqual({ status: 'failed', generation: 1 }); // must NOT be clobbered to 'done'
    expect(await eventProcessedAt(jobId, 1, 'succeeded')).not.toBeNull();
  });

  test("'rerun_requested' gen++s a job that is still terminal at that event's generation (Phase 2's consumer, wired ahead of its producer)", async () => {
    const { repoId, taskId } = await makeChain();
    const jobId = await seedJob(taskId, repoId, 'failed');
    await sql`insert into job_events (job_id, generation, kind) values (${jobId}, 1, 'rerun_requested')`;

    await consumeJobEvents(sql, taskId);

    expect(await jobGenStatus(jobId)).toEqual({ status: 'pending', generation: 2 });
  });

  test("'rerun_requested' is a no-op once the job has already moved on from that event's generation", async () => {
    const { repoId, taskId } = await makeChain();
    const jobId = await seedJob(taskId, repoId, 'failed');
    await sql`update jobs set generation = 2 where id = ${jobId}`; // already rewound past generation 1
    await sql`insert into job_events (job_id, generation, kind) values (${jobId}, 1, 'rerun_requested')`;

    await consumeJobEvents(sql, taskId);

    expect(await jobGenStatus(jobId)).toEqual({ status: 'failed', generation: 2 }); // untouched
  });

  /**
   * 3자 리뷰 수정 라운드 (Codex+Grok 수렴, 규칙9): store.bumpJobGeneration's own up-front terminal-
   * task check is only a REQUEST-TIME fact (Phase 2's bump/consume split made it a plain, unlocked
   * SELECT) — the task can legitimately go terminal in the real gap between that request and this
   * consumption (sealed+derived, or another repo's own path). Without re-validating task-open HERE,
   * under lock, this job would gen++ to pending under an already-terminal task — rule 9 (terminal
   * task immutable) and done-atomicity both broken at once. RED (before the fix): removing the
   * task-open re-check made this assert fail (generation moved to 2, status 'pending').
   */
  test("'rerun_requested' is absorbed as a no-op when the task went terminal AFTER the request but BEFORE consumption (rule 9)", async () => {
    const { repoId, taskId } = await makeChain();
    const jobId = await seedJob(taskId, repoId, 'failed');
    await sql`insert into job_events (job_id, generation, kind) values (${jobId}, 1, 'rerun_requested')`;

    // Simulates the real gap Phase 2's non-atomic bump/consume split opened up: the task became
    // terminal (e.g. sealed+derived, or a sibling repo's own path) strictly AFTER the rerun request
    // was recorded, strictly BEFORE it's consumed here.
    await sql`update tasks set status = 'done' where id = ${taskId}`;

    await consumeJobEvents(sql, taskId);

    // The job must NOT have been resurrected to pending under a task that's already done — rule 9
    // and done-atomicity both intact.
    expect(await jobGenStatus(jobId)).toEqual({ status: 'failed', generation: 1 });
    // The event is still consumed (not left to be retried forever) — a stale request, absorbed.
    expect(await eventProcessedAt(jobId, 1, 'rerun_requested')).not.toBeNull();
    // The task itself is untouched by this consumption (reconcile only reads tasks.status here).
    const taskRows = (await sql`select status from tasks where id = ${taskId}`) as Array<{ status: string }>;
    expect(taskRows[0]!.status).toBe('done');
  });

  test('an already-processed event is never re-applied on a second consumeJobEvents pass', async () => {
    const { repoId, taskId } = await makeChain();
    const jobId = await seedJob(taskId, repoId, 'running');
    await sql`insert into job_events (job_id, generation, kind) values (${jobId}, 1, 'succeeded')`;
    await consumeJobEvents(sql, taskId);
    expect(await jobGenStatus(jobId)).toEqual({ status: 'done', generation: 1 });

    // Something else re-runs this exact job under a NEW generation — a second pass over the SAME
    // (now already-processed) event row must never touch it again.
    await sql`update jobs set status = 'running', generation = 2 where id = ${jobId}`;
    await consumeJobEvents(sql, taskId);

    expect(await jobGenStatus(jobId)).toEqual({ status: 'running', generation: 2 }); // untouched by the stale event's second pass
  });

  test('omitting taskId consumes every unprocessed event across every task (the controller-tick crash net)', async () => {
    const chainA = await makeChain();
    const chainB = await makeChain();
    const jobA = await seedJob(chainA.taskId, chainA.repoId, 'running');
    const jobB = await seedJob(chainB.taskId, chainB.repoId, 'running');
    await sql`insert into job_events (job_id, generation, kind) values (${jobA}, 1, 'succeeded'), (${jobB}, 1, 'failed')`;

    await consumeJobEvents(sql); // no taskId — global sweep

    expect((await jobGenStatus(jobA)).status).toBe('done');
    expect((await jobGenStatus(jobB)).status).toBe('failed');
  });

  test('scoping to one taskId leaves an unprocessed event under a DIFFERENT task untouched', async () => {
    const chainA = await makeChain();
    const chainB = await makeChain();
    const jobA = await seedJob(chainA.taskId, chainA.repoId, 'running');
    const jobB = await seedJob(chainB.taskId, chainB.repoId, 'running');
    await sql`insert into job_events (job_id, generation, kind) values (${jobA}, 1, 'succeeded'), (${jobB}, 1, 'succeeded')`;

    await consumeJobEvents(sql, chainA.taskId);

    expect((await jobGenStatus(jobA)).status).toBe('done');
    expect((await jobGenStatus(jobB)).status).toBe('running'); // out of scope for this call — left for a later pass
    expect(await eventProcessedAt(jobB, 1, 'succeeded')).toBeNull();
  });

  /**
   * F2 (3자 리뷰 수정 라운드, Codex+Grok 수렴): the earlier (pre-fix) shape applied the jobs CAS and
   * marked processed_at as two SEPARATE statements, then derived work_items ONLY `if (applied.length
   * > 0)` — a crash between "applied" and "marked" left the event looking unprocessed, but a RETRY's
   * own CAS would then find the job already at its target status (0 rows) and skip the work_items
   * derive, permanently stranding it at 'in_flow'. This reproduces exactly that intermediate state
   * by hand (jobs already done, work_items still in_flow, event still unprocessed — precisely what a
   * crash between those two old statements would have left behind) and proves the FIXED consumer
   * converges it correctly: work_items derivation now reads the job's CURRENT status, not whether
   * THIS call's own CAS affected a row.
   */
  test('F2 reinforcement: work_items still derives even when jobs is ALREADY at the target status (crash-recovery convergence)', async () => {
    const { repoId, taskId } = await makeChain();
    const jobId = await seedJob(taskId, repoId, 'done'); // as if an earlier (interrupted) pass already applied the CAS
    await sql`insert into work_items (id, project_id, type, state, title) values (${jobId}, ${repoId}, 'task', 'in_flow', 'x')`; // but never got to mirror it
    await sql`insert into job_events (job_id, generation, kind) values (${jobId}, 1, 'succeeded')`; // and never got to mark it processed either

    await consumeJobEvents(sql, taskId);

    const wiRows = (await sql`select state from work_items where id = ${jobId}`) as Array<{ state: string }>;
    expect(wiRows[0]!.state).toBe('done'); // no longer permanently stranded at 'in_flow'
    expect(await eventProcessedAt(jobId, 1, 'succeeded')).not.toBeNull();
  });

  /**
   * F2: proves the ATOMICITY claim itself, not just the reinforcement — a genuine failure partway
   * through the claim+apply transaction must roll back IN FULL (the claim included), leaving
   * NOTHING for a subsequent pass to trip over. Constructed with Postgres's own real rollback
   * semantics (the same guarantee consumeOneEvent's `sql.begin` relies on): a transaction that
   * claims the event, applies the jobs CAS, then deliberately throws before committing.
   */
  test('F2 atomicity: a mid-transaction failure rolls back the claim AND the jobs CAS together, and a later pass still converges cleanly', async () => {
    const { repoId, taskId } = await makeChain();
    const jobId = await seedJob(taskId, repoId, 'running');
    await sql`insert into job_events (job_id, generation, kind) values (${jobId}, 1, 'succeeded')`;

    // Simulates a crash partway through consumeOneEvent's own transaction shape (claim -> apply ->
    // [crash before the mirror/commit]) using the SAME statements it would run, then a forced abort.
    await expect(
      sql.begin(async (tx) => {
        await tx`
          update job_events set processed_at = now()
          where job_id = ${jobId} and generation = 1 and kind = 'succeeded' and processed_at is null
        `;
        await tx`update jobs set status = 'done', status_changed_at = now(), lease_expires_at = null where id = ${jobId} and status = 'running'`;
        throw new Error('simulated crash before commit');
      }),
    ).rejects.toThrow('simulated crash before commit');

    // Rolled back IN FULL — nothing partial persisted. This is the class of bug F2 closes: the OLD
    // 3-separate-statement shape could not express this guarantee at all.
    expect((await jobGenStatus(jobId)).status).toBe('running');
    expect(await eventProcessedAt(jobId, 1, 'succeeded')).toBeNull();

    // A later, unobstructed pass still converges cleanly through the REAL consumer.
    await consumeJobEvents(sql, taskId);
    expect((await jobGenStatus(jobId)).status).toBe('done');
    expect(await eventProcessedAt(jobId, 1, 'succeeded')).not.toBeNull();
  });

  /**
   * F2: two consumers racing the SAME event (reconcileTask's inline call and controller.ts's
   * periodic sweep are NOT mutually exclusive) must serialize on the claim, not both apply it —
   * proven by running two consumeJobEvents passes truly concurrently (Promise.all, not sequential
   * awaits) against ONE unprocessed event and asserting a single, deterministic outcome with no
   * thrown errors from either side.
   */
  test('F2 concurrency: two concurrent consumeJobEvents passes racing the SAME event converge to exactly one applied outcome', async () => {
    const { repoId, taskId } = await makeChain();
    const jobId = await seedJob(taskId, repoId, 'running');
    await sql`insert into work_items (id, project_id, type, state, title) values (${jobId}, ${repoId}, 'task', 'in_flow', 'x')`;
    await sql`insert into job_events (job_id, generation, kind) values (${jobId}, 1, 'succeeded')`;

    await Promise.all([consumeJobEvents(sql, taskId), consumeJobEvents(sql, taskId)]);

    expect(await jobGenStatus(jobId)).toEqual({ status: 'done', generation: 1 }); // applied exactly once, not double-toggled
    const wiRows = (await sql`select state from work_items where id = ${jobId}`) as Array<{ state: string }>;
    expect(wiRows[0]!.state).toBe('done');
    expect(await eventProcessedAt(jobId, 1, 'succeeded')).not.toBeNull();
  });
});
