import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { SQL } from 'bun';
import { ensureSchema } from '../infra/schema';
import { startGraphController } from './controller';
import type { ReconcileJob } from './reconcile';

// Integration test: exercises the always-on controller against a live Postgres (harness/
// job-graph.md P2 round 1: lease, restart/periodic reconcile — spec sections A and B).
//
// NOTE ON SCOPE: startGraphController's periodic/lease-expiry scans are deliberately GLOBAL
// (every open task, every running job) — not scoped to one task like reconcileTask. Since bun
// test shares one Postgres across every spec file, assertions here use `toContain`/targeted
// mock-call lookups by this test's own unique job id, never exact totals — another file's
// in-flight fixtures coexisting in the same scan must never make this file flaky.
const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const PREFIX = `controller-${process.pid}-${Date.now()}`;
let n = 0;
const id = (label: string) => `${PREFIX}-${label}-${n++}`;

async function makeChain() {
  const productId = id('product');
  const repoId = id('repo');
  const taskId = id('task');
  await sql`insert into products (id, name) values (${productId}, ${productId})`;
  await sql`insert into repos (id, product_id, name, cwd) values (${repoId}, ${productId}, ${repoId}, '/tmp')`;
  await sql`insert into tasks (id, title, status) values (${taskId}, ${taskId}, 'open')`;
  return { taskId, repoId };
}

async function seedJob(taskId: string, repoId: string, status: string): Promise<string> {
  const jobId = id('job');
  await sql`insert into jobs (id, task_id, repo_id, title, status) values (${jobId}, ${taskId}, ${repoId}, 'x', ${status})`;
  return jobId;
}

async function jobStatus(jobId: string): Promise<string> {
  const rows = (await sql`select status from jobs where id = ${jobId}`) as Array<{ status: string }>;
  return rows[0]!.status;
}

async function setLeaseExpiresAt(jobId: string, when: Date): Promise<void> {
  await sql`update jobs set lease_expires_at = ${when} where id = ${jobId}`;
}

/** A flow row tied to `jobId` via flows.job_id (the same column pg-store.ts's createFlow always sets). */
async function seedFlow(jobId: string, status: string): Promise<string> {
  const flowId = id('flow');
  await sql`
    insert into flows (id, job_id, flow_type, status, current_step)
    values (${flowId}, ${jobId}, 'chore', ${status}, 'implement')
  `;
  return flowId;
}

/** A decision row tied to `flowId` via decisions.flow_id — the HITL request/answer record
 * rest.ts's requestDecision creates and /api/decisions/:id/answer later flips to 'answered'. */
async function seedDecision(flowId: string, status: string): Promise<string> {
  const decisionId = id('decision');
  await sql`
    insert into decisions (id, flow_id, status, request_type, question)
    values (${decisionId}, ${flowId}, ${status}, 'single_choice', 'q?')
  `;
  return decisionId;
}

async function openWakeCount(kind: string, taskId: string): Promise<number> {
  const rows = (await sql`
    select id from decisions where request_type = 'agent_wake' and status = 'open' and meta->>'kind' = ${kind} and meta->>'taskId' = ${taskId}
  `) as unknown[];
  return rows.length;
}

async function waitFor<T>(fn: () => Promise<T | undefined | null | false>, timeoutMs = 10000, interval = 50): Promise<T> {
  const start = Date.now();
  let last: T | undefined | null | false;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (last) return last as T;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms; last value: ${JSON.stringify(last)}`);
}

beforeAll(async () => {
  await ensureSchema(sql);
});

afterAll(async () => {
  // F4: every test above awaits controller.stop() (directly or in a finally), and stop() now
  // itself awaits the in-flight tick before resolving — so by the time this runs, no tick from
  // this file's own controllers can still be touching the DB. No settle delay needed.
  await sql`delete from decisions where request_type = 'agent_wake' and meta->>'taskId' like ${PREFIX + '%'}`;
  await sql`delete from decisions where id like ${PREFIX + '%'}`; // F-round: seedDecision's HITL rows
  await sql`delete from flows where id like ${PREFIX + '%'}`;
  // FK-reverse order (dep_members/deps reference jobs; jobs/task_seals reference tasks/repos).
  await sql`delete from dep_members where dep_id like ${PREFIX + '%'}`;
  await sql`delete from deps where id like ${PREFIX + '%'}`;
  await sql`delete from task_seals where task_id like ${PREFIX + '%'}`;
  await sql`delete from job_events where job_id like ${PREFIX + '%'}`;

  await sql`delete from jobs where id like ${PREFIX + '%'}`;
  await sql`delete from tasks where id like ${PREFIX + '%'}`;
  await sql`delete from repos where id like ${PREFIX + '%'}`;
  await sql`delete from products where id like ${PREFIX + '%'}`;
  await sql.end();
});

describe('startGraphController — restart + periodic reconcile (harness/job-graph.md P2 spec B)', () => {
  test('B1: starting the controller runs one full pass immediately (restart reconcile)', async () => {
    const { repoId, taskId } = await makeChain();
    const jobId = await seedJob(taskId, repoId, 'pending');
    const dispatch = mock(async (_job: ReconcileJob) => {});

    const controller = startGraphController(sql, dispatch, { tickMs: 999_999 });
    try {
      await waitFor(async () => ((await jobStatus(jobId)) === 'running' ? true : undefined));
      expect(dispatch.mock.calls.some(([job]) => job.id === jobId)).toBe(true);
    } finally {
      await controller.stop();
    }
  });

  test('B2: a dispatch that reverts an orphaned claim back to pending is handled cleanly (no job left stuck running)', async () => {
    const { repoId, taskId } = await makeChain();
    const jobId = await seedJob(taskId, repoId, 'pending');
    // Emulates rest.ts's registry-aware dispatch when no execution closure is registered for this
    // job (e.g. after a process restart) — reverting the claim rather than stranding it at
    // 'running' forever. The registry lookup itself lives in rest.ts (tested separately); this
    // proves the controller tolerates a dispatch that does this without hanging or double-claiming.
    const dispatch = mock(async (job: ReconcileJob) => {
      await sql`update jobs set status = 'pending', status_changed_at = now(), lease_expires_at = null where id = ${job.id} and status = 'running'`;
    });

    const controller = startGraphController(sql, dispatch, { tickMs: 999_999 });
    try {
      await waitFor(async () => (dispatch.mock.calls.some(([job]) => job.id === jobId) ? true : undefined));
      expect(await jobStatus(jobId)).toBe('pending');
    } finally {
      await controller.stop();
    }
  });

  test('B3: the periodic tick repeats on its own, not just the initial pass', async () => {
    const { repoId, taskId } = await makeChain();
    const dispatch = mock(async (_job: ReconcileJob) => {});
    const controller = startGraphController(sql, dispatch, { tickMs: 40 });
    try {
      // Let the initial pass (nothing to do yet) settle, then add a job only AFTER start — if a
      // LATER periodic tick (not the initial one) picks it up, the interval is genuinely repeating.
      await new Promise((r) => setTimeout(r, 60));
      const jobId = await seedJob(taskId, repoId, 'pending');
      await waitFor(async () => ((await jobStatus(jobId)) !== 'pending' ? true : undefined));
      expect(dispatch.mock.calls.some(([job]) => job.id === jobId)).toBe(true);
    } finally {
      await controller.stop();
    }
  });

  test('B4: a tick already in flight makes a concurrent tick() call a no-op', async () => {
    const { repoId, taskId } = await makeChain();
    const jobId = await seedJob(taskId, repoId, 'pending');
    const dispatch = mock(async (job: ReconcileJob) => {
      if (job.id === jobId) await new Promise((r) => setTimeout(r, 150));
    });

    const controller = startGraphController(sql, dispatch, { tickMs: 999_999 });
    try {
      // startGraphController fires its own initial tick synchronously (up to that tick's first
      // await) before returning — inFlight is already true the instant control comes back here,
      // so this call is guaranteed to short-circuit regardless of DB state or scheduling.
      const concurrent = await controller.tick();
      expect(concurrent).toEqual({ expired: [], reconciled: [], wakes: [] });

      // Observe the dispatch through the MOCK, not a DB status poll (same pattern as B2). reconcileTask
      // commits status='running' BEFORE calling dispatch, so a separate-connection jobStatus poll can
      // see 'running' in the window before the dispatch call lands in mock.calls — waiting on the mock
      // itself closes that race (this was the actual source of B4's shared-DB flakiness, not the no-op
      // assertion above, which is deterministic via run-to-completion).
      await waitFor(async () => (dispatch.mock.calls.some(([job]) => job.id === jobId) ? true : undefined));
      expect(dispatch.mock.calls.some(([job]) => job.id === jobId)).toBe(true);
    } finally {
      await controller.stop();
    }
  });

  test('B5: stop() halts the periodic timer', async () => {
    const { repoId, taskId } = await makeChain();
    const dispatch = mock(async (_job: ReconcileJob) => {});
    const controller = startGraphController(sql, dispatch, { tickMs: 30 });
    // F4 (3자 리뷰 수정 라운드): stop() now itself awaits the auto-initial pass (B1) to fully
    // finish before resolving — the settle-then-check shape below no longer needs to guess at
    // that timing, but it's kept regardless as a margin against the periodic timer specifically
    // (this test's actual subject).
    await controller.stop();
    await new Promise((r) => setTimeout(r, 150));
    const jobId = await seedJob(taskId, repoId, 'pending');
    await new Promise((r) => setTimeout(r, 200)); // several tickMs multiples, had the timer survived
    expect(await jobStatus(jobId)).toBe('pending'); // never auto-reconciled after stop
  });

  /**
   * F4 (3자 리뷰 수정 라운드, Codex+Grok 수렴): reproduces graph-chaos.sim.spec.ts's own cross-seed
   * contamination root cause directly — before this fix, stop() only cleared the FUTURE timer, so
   * a caller who called stop() while a tick was still mid-flight (gated dispatch below) got back
   * a resolved promise while that tick kept running in the background; since tick()'s own task-
   * scan is GLOBAL (every open task, not scoped to this controller's own creator), that still-
   * running pass could go on to claim and dispatch a job under a task created AFTER stop() was
   * called — through THIS controller's own (by-then-stale) dispatch callback.
   */
  test('F4: stop() awaits the in-flight tick before resolving — no stray claim of a task created after stop() returns', async () => {
    const { repoId, taskId: taskA } = await makeChain();
    const jobA = await seedJob(taskA, repoId, 'pending');
    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const dispatchA = mock(async (job: ReconcileJob) => {
      if (job.id === jobA) await gateA;
    });

    const controllerA = startGraphController(sql, dispatchA, { tickMs: 999_999 });
    // The auto-initial tick claims jobA -> running and calls dispatchA(jobA), which is now
    // blocked on gateA — that tick is genuinely still in flight.
    await waitFor(async () => (dispatchA.mock.calls.some(([job]) => job.id === jobA) ? true : undefined));

    const stopPromise = controllerA.stop();
    let stopSettled = false;
    void stopPromise.then(() => {
      stopSettled = true;
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(stopSettled).toBe(false); // must NOT resolve while the tick it's draining is still blocked

    // A new task appears WHILE controllerA's stop() is still waiting on its stuck tick — exactly
    // the "next seed's fresh task" shape from the sim's own contamination scenario.
    const { repoId: repoB, taskId: taskB } = await makeChain();
    const jobB = await seedJob(taskB, repoB, 'pending');

    releaseA(); // let the stuck dispatch (and therefore the stuck tick) finish
    await stopPromise; // now resolves

    // controllerA's own dispatch must never have touched jobB — its task-scan ran before taskB
    // existed, and stop() draining the tick (rather than abandoning it) is what makes "before
    // taskB existed" a guarantee instead of a race.
    expect(dispatchA.mock.calls.some(([job]) => job.id === jobB)).toBe(false);

    // A brand-new, independent controller reconciles jobB normally — no lingering contention.
    const dispatchB = mock(async (_job: ReconcileJob) => {});
    const controllerB = startGraphController(sql, dispatchB, { tickMs: 999_999 });
    try {
      await waitFor(async () => (dispatchB.mock.calls.some(([job]) => job.id === jobB) ? true : undefined));
      expect(dispatchB.mock.calls.some(([job]) => job.id === jobB)).toBe(true);
    } finally {
      await controllerB.stop();
    }
  });
});

describe('startGraphController — lease-expiry scan (harness/job-graph.md P2 spec A3-A5)', () => {
  test('A3: a running job whose lease already expired is failed by the scan and raises a lease_expired wake', async () => {
    const { repoId, taskId } = await makeChain();
    const jobId = await seedJob(taskId, repoId, 'running');
    await setLeaseExpiresAt(jobId, new Date(Date.now() - 60_000));
    const dispatch = mock(async (_job: ReconcileJob) => {});

    const controller = startGraphController(sql, dispatch, { tickMs: 999_999 });
    try {
      await waitFor(async () => ((await jobStatus(jobId)) === 'failed' ? true : undefined));
      // 3자 리뷰 수정 B2-4 (#30): the wake() insert is the NEXT statement after the status UPDATE
      // in the SAME tick(), but it's a SEPARATE Postgres round-trip from this test's own status
      // poll — under shared-DB load the two can be observed out of order (status flips to
      // 'failed' before the wake row's own insert has actually landed). Wait for the wake to
      // exist too, THEN assert its count, instead of asserting immediately on the status flip.
      await waitFor(async () => ((await openWakeCount('lease_expired', taskId)) > 0 ? true : undefined));
      expect(await openWakeCount('lease_expired', taskId)).toBe(1);
    } finally {
      await controller.stop();
    }
  });

  test('A4: a running job with a still-valid lease is left untouched by the scan', async () => {
    const { repoId, taskId } = await makeChain();
    const jobId = await seedJob(taskId, repoId, 'running');
    await setLeaseExpiresAt(jobId, new Date(Date.now() + 60_000));
    const dispatch = mock(async (_job: ReconcileJob) => {});

    const controller = startGraphController(sql, dispatch, { tickMs: 999_999 });
    try {
      await new Promise((r) => setTimeout(r, 100)); // let the auto-initial pass settle
      expect(await jobStatus(jobId)).toBe('running');
    } finally {
      await controller.stop();
    }
  });

  test('A5: a terminal job with a stale lease value is excluded from the scan', async () => {
    const { repoId, taskId } = await makeChain();
    const jobId = await seedJob(taskId, repoId, 'done');
    await setLeaseExpiresAt(jobId, new Date(Date.now() - 60_000));
    const dispatch = mock(async (_job: ReconcileJob) => {});

    const controller = startGraphController(sql, dispatch, { tickMs: 999_999 });
    try {
      await new Promise((r) => setTimeout(r, 100));
      expect(await jobStatus(jobId)).toBe('done');
    } finally {
      await controller.stop();
    }
  });

  /**
   * A6 (3자 리뷰 수정 C3, Grok F12): a 'running' job with lease_expires_at NULL is ALWAYS abnormal
   * — the only way a job legitimately becomes 'running' is reconcileTask's own claim transaction,
   * which grants a lease in the SAME transaction as the status write (rule A1), so there is no
   * window in which a genuinely-claimed job is ever observed 'running' with no lease. A crashed
   * process's boot backfill (schema.ts's in_flow -> 'running' mirror, no lease column set) or any
   * other stray write can still produce this shape, and NONE of the other scans catch it: A3
   * requires lease_expires_at NOT NULL, reconcile only touches pending/blocked, the B2-2 self-heal
   * only fires once the SOURCE reaches done/blocked, and the stall backstop (C1) only scans
   * 'blocked'. Left unresolved forever otherwise.
   */
  test('A6: a running job with a NULL lease past the stall threshold raises an orphaned_ready wake (never auto-failed)', async () => {
    const { repoId, taskId } = await makeChain();
    const jobId = await seedJob(taskId, repoId, 'running');
    await sql`update jobs set status_changed_at = ${new Date(Date.now() - 60_000)} where id = ${jobId}`;
    const dispatch = mock(async (_job: ReconcileJob) => {});

    const controller = startGraphController(sql, dispatch, { tickMs: 999_999, stallThresholdMs: 1_000 });
    try {
      await waitFor(async () => ((await openWakeCount('orphaned_ready', taskId)) > 0 ? true : undefined));
      expect(await jobStatus(jobId)).toBe('running'); // never auto-failed -- a human decides (rule 4 spirit)
    } finally {
      await controller.stop();
    }
  });

  test('A6: a running job with a NULL lease that has NOT yet crossed the stall threshold is left alone', async () => {
    const { repoId, taskId } = await makeChain();
    const jobId = await seedJob(taskId, repoId, 'running'); // status_changed_at defaults to now()
    const dispatch = mock(async (_job: ReconcileJob) => {});

    const controller = startGraphController(sql, dispatch, { tickMs: 999_999, stallThresholdMs: 60_000 });
    try {
      await new Promise((r) => setTimeout(r, 150));
      expect(await jobStatus(jobId)).toBe('running');
      expect(await openWakeCount('orphaned_ready', taskId)).toBe(0);
    } finally {
      await controller.stop();
    }
  });

  /**
   * E-round task #9 (Grok F-A4 = Fable M6): the zombie scan's own A6 shape (running + NULL lease
   * past the stall threshold) is EXACTLY what lease.ts's withLeaseHeartbeat deliberately produces
   * on a HITL suspend (`setStatus('suspended')`, 3자 리뷰 수정 A라운드 A2) — a job legitimately
   * waiting on a human decision, not a crashed worker. Before this fix, A6's scan had no way to
   * tell the two apart and raised the same "crashed or backfill-stranded" orphaned_ready wake for
   * both.
   *
   * F-round task #22 (Grok F-E3): narrowed since — "suspended flow" alone isn't enough, because a
   * suspended flow left behind by a CRASH (resolver lost on restart, see the test below) has the
   * exact same shape. The DB-visible tell is the decision itself: a live pause's decision is still
   * 'open' (nobody has answered it yet), so THAT'S what this test now seeds and asserts stays
   * excluded — the exclusion's real scope, not just "any suspended flow".
   */
  test('a job whose flow is suspended (HITL pause) with an OPEN decision is never flagged orphaned by the zombie scan, even past the stall threshold', async () => {
    const { repoId, taskId } = await makeChain();
    const jobId = await seedJob(taskId, repoId, 'running');
    await sql`update jobs set status_changed_at = ${new Date(Date.now() - 60_000)} where id = ${jobId}`;
    const flowId = await seedFlow(jobId, 'suspended');
    await seedDecision(flowId, 'open'); // still genuinely awaiting a human answer
    const dispatch = mock(async (_job: ReconcileJob) => {});

    const controller = startGraphController(sql, dispatch, { tickMs: 999_999, stallThresholdMs: 1_000 });
    try {
      // Give the scan several real passes a fair chance to (wrongly) flag this job.
      for (let i = 0; i < 5; i++) {
        await controller.tick();
        await new Promise((r) => setTimeout(r, 30));
      }
      expect(await openWakeCount('orphaned_ready', taskId)).toBe(0);
      expect(await jobStatus(jobId)).toBe('running'); // untouched either way
    } finally {
      await controller.stop();
    }
  });

  /**
   * F-round task #22 (Grok F-E3, the regression E-round's own exclusion introduced): a crash right
   * after HITL suspend loses rest.ts's in-memory pendingDecisions resolver — a human answering
   * `/api/decisions/:id/answer` afterward still flips the decision to 'answered', but nothing is
   * left registered to actually resume the flow, so it stays 'suspended' forever with the job stuck
   * 'running'+lease null. E-round's blanket "any suspended flow" exclusion hid this permanently (no
   * wake, ever). Narrowed exclusion no longer matches here (the decision is 'answered', not 'open')
   * — this case must wake, same as any other zombie.
   */
  test('a job whose flow is suspended but its decision was already ANSWERED (resolver lost after restart) still gets flagged as orphaned', async () => {
    const { repoId, taskId } = await makeChain();
    const jobId = await seedJob(taskId, repoId, 'running');
    await sql`update jobs set status_changed_at = ${new Date(Date.now() - 60_000)} where id = ${jobId}`;
    const flowId = await seedFlow(jobId, 'suspended');
    await seedDecision(flowId, 'answered'); // a human answered, but no resolver was left to resume it
    const dispatch = mock(async (_job: ReconcileJob) => {});

    const controller = startGraphController(sql, dispatch, { tickMs: 999_999, stallThresholdMs: 1_000 });
    try {
      await waitFor(async () => ((await openWakeCount('orphaned_ready', taskId)) > 0 ? true : undefined));
      expect(await jobStatus(jobId)).toBe('running'); // never auto-failed -- a human decides (rule 4 spirit)
    } finally {
      await controller.stop();
    }
  });

  test('a running job with a NULL lease and an ABANDONED (not suspended) flow still gets flagged — the exclusion is narrow', async () => {
    const { repoId, taskId } = await makeChain();
    const jobId = await seedJob(taskId, repoId, 'running');
    await sql`update jobs set status_changed_at = ${new Date(Date.now() - 60_000)} where id = ${jobId}`;
    await seedFlow(jobId, 'abandoned'); // a real crash mid-flow, not a HITL pause
    const dispatch = mock(async (_job: ReconcileJob) => {});

    const controller = startGraphController(sql, dispatch, { tickMs: 999_999, stallThresholdMs: 1_000 });
    try {
      await waitFor(async () => ((await openWakeCount('orphaned_ready', taskId)) > 0 ? true : undefined));
    } finally {
      await controller.stop();
    }
  });
});

describe('startGraphController — wake records (harness/job-graph.md P2 round 2 spec C/D)', () => {
  test('C1: a job blocked past the stall threshold raises a stalled wake, without releasing its dep or unblocking it (C3)', async () => {
    const { repoId, taskId } = await makeChain();
    // The dep target is deliberately not terminal (not done), so the dep stays unmet — same
    // fixture shape as reconcile.spec.ts's own "unmet dep" case.
    const targetJobId = await seedJob(taskId, repoId, 'running');
    const waiterJobId = await seedJob(taskId, repoId, 'blocked');
    await sql`update jobs set status_changed_at = ${new Date(Date.now() - 60_000)} where id = ${waiterJobId}`;
    const depId = id('dep');
    await sql`insert into deps (id, waiter_job, status) values (${depId}, ${waiterJobId}, 'active')`;
    await sql`insert into dep_members (dep_id, target_type, target_id) values (${depId}, 'job', ${targetJobId})`;
    const dispatch = mock(async (_job: ReconcileJob) => {});

    const controller = startGraphController(sql, dispatch, { tickMs: 999_999, stallThresholdMs: 1_000 });
    try {
      await waitFor(async () => ((await openWakeCount('stalled', taskId)) > 0 ? true : undefined));
      expect(await jobStatus(waiterJobId)).toBe('blocked'); // C3: never auto-unblocked
      const depRows = (await sql`select status from deps where id = ${depId}`) as Array<{ status: string }>;
      expect(depRows[0]!.status).toBe('active'); // C3: dep never auto-released

      // A second, later pass must not spam a duplicate wake (E2).
      await controller.tick();
      expect(await openWakeCount('stalled', taskId)).toBe(1);
    } finally {
      await controller.stop();
    }
  });

  test('C2: an open task with all jobs terminal and all repos sealed, but a done/cancelled mix, raises an unresolvable_task wake', async () => {
    const { repoId, taskId } = await makeChain();
    await seedJob(taskId, repoId, 'done');
    await seedJob(taskId, repoId, 'cancelled');
    await sql`insert into task_seals (task_id, repo_id) values (${taskId}, ${repoId})`;
    const dispatch = mock(async (_job: ReconcileJob) => {});

    const controller = startGraphController(sql, dispatch, { tickMs: 999_999 });
    try {
      await waitFor(async () => ((await openWakeCount('unresolvable_task', taskId)) > 0 ? true : undefined));
      const taskRows = (await sql`select status from tasks where id = ${taskId}`) as Array<{ status: string }>;
      expect(taskRows[0]!.status).toBe('open'); // never auto-resolved to done/failed/cancelled
    } finally {
      await controller.stop();
    }
  });

  test('C2-rederive: a task whose last non-terminal job goes terminal AFTER every participating repo already sealed is re-derived to done, not left permanently open (수정 B1-1)', async () => {
    const { repoId, taskId } = await makeChain();
    const jobId = await seedJob(taskId, repoId, 'running');
    // The repo seals its slice WHILE the job is still running (rule 2 permits this — seal only
    // freezes future inserts, it doesn't require every existing job to already be terminal).
    await sql`insert into task_seals (task_id, repo_id) values (${taskId}, ${repoId})`;
    // The job only reaches terminal AFTER the seal — sealTaskSliceAndDerive (the only OTHER derive
    // call site) never runs again for this task, so absent a rederive on this tick, the task would
    // stay 'open' forever even though every participating repo is sealed and every job is terminal.
    await sql`update jobs set status = 'done', status_changed_at = now() where id = ${jobId}`;
    const dispatch = mock(async (_job: ReconcileJob) => {});

    const controller = startGraphController(sql, dispatch, { tickMs: 999_999 });
    try {
      const taskRows = await waitFor(async () => {
        const rows = (await sql`select status from tasks where id = ${taskId}`) as Array<{ status: string }>;
        return rows[0]!.status === 'done' ? rows : undefined;
      });
      expect(taskRows[0]!.status).toBe('done');
      // No unresolvable_task wake either — this is a clean, unambiguous derivation (all done), not
      // the done/cancelled-mix case C2's OWN wake exists for.
      expect(await openWakeCount('unresolvable_task', taskId)).toBe(0);
    } finally {
      await controller.stop();
    }
  });

  test('C2-prefilter: an open task with all-terminal jobs but NO seal at all is never a C2 candidate (수정 B1-4)', async () => {
    const { repoId, taskId } = await makeChain();
    await seedJob(taskId, repoId, 'done'); // all jobs terminal, but nobody ever sealed
    const dispatch = mock(async (_job: ReconcileJob) => {});

    const controller = startGraphController(sql, dispatch, { tickMs: 999_999 });
    try {
      await controller.tick();
      await controller.tick();
      expect(await openWakeCount('unresolvable_task', taskId)).toBe(0);
      const taskRows = (await sql`select status from tasks where id = ${taskId}`) as Array<{ status: string }>;
      expect(taskRows[0]!.status).toBe('open'); // never rederived — no seal means no candidate
    } finally {
      await controller.stop();
    }
  });

  test('D1: a dep whose expected generation no longer matches the target job raises a stale_dep wake, and the dep stays stale (D2)', async () => {
    const { repoId, taskId } = await makeChain();
    const targetJobId = await seedJob(taskId, repoId, 'pending'); // generation defaults to 1
    await sql`update jobs set generation = 2 where id = ${targetJobId}`; // actual gen moved on; expected below stays 1
    const waiterJobId = await seedJob(taskId, repoId, 'pending');
    const depId = id('dep');
    await sql`insert into deps (id, waiter_job, status) values (${depId}, ${waiterJobId}, 'active')`;
    await sql`insert into dep_members (dep_id, target_type, target_id, expected_gen) values (${depId}, 'job', ${targetJobId}, 1)`;
    const dispatch = mock(async (_job: ReconcileJob) => {});

    const controller = startGraphController(sql, dispatch, { tickMs: 999_999 });
    try {
      await waitFor(async () => ((await openWakeCount('stale_dep', taskId)) > 0 ? true : undefined));
      const depRows = (await sql`select status from deps where id = ${depId}`) as Array<{ status: string }>;
      expect(depRows[0]!.status).toBe('stale'); // D2: no auto-resolution
    } finally {
      await controller.stop();
    }
  });
});
