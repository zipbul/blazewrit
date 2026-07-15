import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { SQL } from 'bun';
import { ensureSchema } from '../infra/schema';
import { startGraphController, type GraphController } from './controller';
import { insertJob, bumpJobGeneration, sealTaskSliceAndDerive, TerminalTaskError } from './store';
import { canTransitionJob } from './transitions';
import { validateAssembly } from './assemble-jobs';
import { loadTaskGraph } from './load-task-graph';
import type { ReconcileJob } from './reconcile';
import type { JobStatus } from './types';

/**
 * Graph orchestration integration suite (harness/job-graph.md migration 9 acceptance criteria,
 * scenarios S1-S12): proves the ENGINE actually drives execution order across a multi-job/dep
 * graph — not just that its parts (reconcile, deps, cycle, controller) work in isolation.
 *
 * Construction: jobs via the REAL insertJob write path; deps/dep_members via raw SQL fixtures
 * (there is no declarative dep-write path before P4 — this is the expected, honest state of
 * things, not a shortcut). The always-on controller's tick() is driven by hand, never a timer.
 *
 * Mock dispatch = "completion simulator": it only RECORDS that a job was handed off. The test
 * itself marks a job done/failed via a separate, explicit completeJob() step, using the exact SQL
 * shape rest.ts's own flow-completion dual-write uses. This mirrors production, where dispatch
 * starts a flow that finishes asynchronously later — never synchronously inside the dispatch call
 * — so a chain's downstream jobs never cascade into readiness within the SAME pass that started
 * their upstream; each scenario's tick-by-tick narrative is reproduced literally.
 *
 * IMPORTANT — controller.tick() timing: startGraphController fires its own auto-initial tick
 * immediately, and every tick's C1/C2/D1 scans are deliberately GLOBAL (every currently-open task
 * in the whole shared dev Postgres, not just this test's own — see controller.ts). This shared DB
 * has accumulated hundreds of historical open tasks (unrelated to this file), so one real tick()
 * pass measurably takes on the order of 100ms+ — long enough that this test's own, much-faster
 * synchronous-ish code can call tick() again before a previous pass finished, hitting the
 * single-flight guard and getting an empty no-op back. `drainUntil` below retries tick() calls
 * until the desired state is observed, so it never matters which specific call did the work.
 * Assertions therefore check the dispatch call log / DB state, never a single tick()'s raw
 * return value.
 *
 * Cross-file isolation: for the same reason, assertions filter the dispatch-call log down to
 * this test's own known job ids (myIds) rather than asserting on raw totals, so another
 * concurrently-running file's fixtures can never make this file flaky.
 */
const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const PREFIX = `orch-${process.pid}-${Date.now()}`;
let n = 0;
const id = (label: string) => `${PREFIX}-${label}-${n++}`;

async function makeProduct(): Promise<string> {
  const productId = id('product');
  await sql`insert into products (id, name) values (${productId}, ${productId})`;
  return productId;
}

async function makeRepo(productId: string, label = 'repo'): Promise<string> {
  const repoId = id(label);
  await sql`insert into repos (id, product_id, name, cwd) values (${repoId}, ${productId}, ${repoId}, '/tmp')`;
  return repoId;
}

async function makeTask(label = 'task'): Promise<string> {
  const taskId = id(label);
  await sql`insert into tasks (id, title, status) values (${taskId}, ${taskId}, 'open')`;
  return taskId;
}

/** Constructs a job via the REAL insertJob write path — always lands 'pending', generation 1. */
async function makeJob(taskId: string, repoId: string, title: string): Promise<string> {
  const jobId = id('job');
  await insertJob(sql, repoId, { id: jobId, taskId, repoId, title });
  return jobId;
}

async function jobStatus(jobId: string): Promise<string> {
  const rows = (await sql`select status from jobs where id = ${jobId}`) as Array<{ status: string }>;
  return rows[0]!.status;
}

async function depStatus(depId: string): Promise<string> {
  const rows = (await sql`select status from deps where id = ${depId}`) as Array<{ status: string }>;
  return rows[0]!.status;
}

/** The "completion" half of the mock dispatch — same SQL shape as rest.ts's flow-completion dual-write. */
async function completeJob(jobId: string, outcome: 'done' | 'failed' = 'done'): Promise<void> {
  await sql`update jobs set status = ${outcome}, status_changed_at = now(), lease_expires_at = null where id = ${jobId}`;
}

/** Cancels a job via the transition-guard, matching reconcile.ts's own guarded-write convention. */
async function cancelJob(jobId: string, fromStatus: JobStatus): Promise<void> {
  if (!canTransitionJob(fromStatus, 'cancelled')) throw new Error(`cannot cancel from ${fromStatus}`);
  await sql`update jobs set status = 'cancelled', status_changed_at = now() where id = ${jobId} and status = ${fromStatus}`;
}

interface DepOpts {
  predicate?: 'all' | 'any';
  expectedGen?: number;
  acceptable?: string[];
}

async function insertDep(waiterJobId: string, predicate: 'all' | 'any' = 'all'): Promise<string> {
  const depId = id('dep');
  await sql`insert into deps (id, waiter_job, predicate) values (${depId}, ${waiterJobId}, ${predicate})`;
  return depId;
}

async function insertDepMember(depId: string, targetType: 'job' | 'task' | 'external', targetId: string, opts: DepOpts = {}): Promise<void> {
  // Postgres array-literal syntax, explicitly cast — passing a plain JS array (or bun's sql.array())
  // double-quotes each element and corrupts the stored value; this is the form that round-trips clean.
  const acceptableLiteral = `{${(opts.acceptable ?? ['satisfied']).join(',')}}`;
  await sql`
    insert into dep_members (dep_id, target_type, target_id, expected_gen, acceptable)
    values (${depId}, ${targetType}, ${targetId}, ${opts.expectedGen ?? null}, ${acceptableLiteral}::text[])
  `;
}

/** The common case: one dep row, one job-target member, predicate='all'. */
async function waitsOnJob(waiterJobId: string, targetJobId: string, opts: DepOpts = {}): Promise<string> {
  const depId = await insertDep(waiterJobId, opts.predicate ?? 'all');
  await insertDepMember(depId, 'job', targetJobId, opts);
  return depId;
}

async function waitsOnTask(waiterJobId: string, targetTaskId: string): Promise<string> {
  const depId = await insertDep(waiterJobId, 'all');
  await insertDepMember(depId, 'task', targetTaskId);
  return depId;
}

/** Records every dispatched job, in call order. Never completes anything on its own. */
function makeDispatch(calls: ReconcileJob[]) {
  return mock(async (job: ReconcileJob): Promise<void> => {
    calls.push(job);
  });
}

const callIds = (calls: ReconcileJob[]): string[] => calls.map((c) => c.id);

/**
 * Repeatedly calls controller.tick() until `predicate` holds. See the file-level comment for why
 * this is necessary (a real pass can take 100ms+ against this shared DB's accumulated open-task
 * count, so a single explicit tick() call very often lands mid-flight of an earlier pass and
 * short-circuits). Never asserts on any one call's own TickResult — only on the accumulated
 * dispatch log / DB state, which is correct regardless of which specific call did the work.
 */
async function drainUntil(controller: GraphController, predicate: () => Promise<boolean>, timeoutMs = 15000, interval = 30): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await controller.tick();
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`drainUntil timed out after ${timeoutMs}ms`);
}

/** Forces a handful of tick() attempts (for negative assertions — "did NOT open" checks — which
 * have no natural success predicate to drain toward) without asserting anything about them. */
async function forceTicks(controller: GraphController, attempts = 5, interval = 30): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    await controller.tick();
    await new Promise((r) => setTimeout(r, interval));
  }
}

/**
 * Per-test cleanup (called from each test's own `finally`, not just the file's afterAll) — basic
 * hygiene so this file's own 12+ scenarios don't compound the shared DB's already-large open-task
 * backlog any further while the suite runs.
 */
async function cleanupGraph(taskIds: string[], repoIds: string[], productIds: string[]): Promise<void> {
  for (const taskId of taskIds) {
    await sql`delete from decisions where request_type = 'agent_wake' and meta->>'taskId' = ${taskId}`;
    await sql`delete from dep_members where dep_id in (select id from deps where waiter_job in (select id from jobs where task_id = ${taskId}))`;
    await sql`delete from deps where waiter_job in (select id from jobs where task_id = ${taskId})`;
    await sql`delete from task_seals where task_id = ${taskId}`;
    await sql`delete from jobs where task_id = ${taskId}`;
    await sql`delete from tasks where id = ${taskId}`;
  }
  for (const repoId of repoIds) {
    await sql`delete from repos where id = ${repoId}`;
  }
  for (const productId of productIds) {
    await sql`delete from products where id = ${productId}`;
  }
}

beforeAll(async () => {
  await ensureSchema(sql);
});

afterAll(async () => {
  // A controller's auto-initial tick can still be mid-flight when a test's stop() returns (stop()
  // only clears the FUTURE timer) — give any straggler a moment to settle before the connection closes.
  await new Promise((r) => setTimeout(r, 800));
  await sql`delete from decisions where request_type = 'agent_wake' and meta->>'taskId' like ${PREFIX + '%'}`;
  await sql`delete from dep_members where dep_id like ${PREFIX + '%'}`;
  await sql`delete from deps where id like ${PREFIX + '%'}`;
  await sql`delete from task_seals where task_id like ${PREFIX + '%'}`;
  await sql`delete from jobs where id like ${PREFIX + '%'}`;
  await sql`delete from tasks where id like ${PREFIX + '%'}`;
  await sql`delete from repos where id like ${PREFIX + '%'}`;
  await sql`delete from products where id like ${PREFIX + '%'}`;
  await sql.end();
});

describe('S1-S5: ordering, parallelism, join, OR, cross-repo', () => {
  test('S1: serial chain enforces order — A only, then B only, then C only', async () => {
    const productId = await makeProduct();
    const repoId = await makeRepo(productId);
    const taskId = await makeTask();
    const a = await makeJob(taskId, repoId, 'A');
    const b = await makeJob(taskId, repoId, 'B');
    const c = await makeJob(taskId, repoId, 'C');
    await waitsOnJob(b, a);
    await waitsOnJob(c, b);
    const myIds = new Set([a, b, c]);

    const calls: ReconcileJob[] = [];
    const dispatch = makeDispatch(calls);
    const controller = startGraphController(sql, dispatch, { tickMs: 999_999 });
    try {
      // The predicate also waits for B/C to settle out of their initial 'pending' seed — the SAME
      // reconcile pass that dispatches A may not yet have reached evaluating B/C when A first
      // appears in `calls` (see file-level comment on tick() timing / drainUntil's contract).
      await drainUntil(
        controller,
        async () => callIds(calls).includes(a) && (await jobStatus(b)) !== 'pending' && (await jobStatus(c)) !== 'pending',
      );
      expect(callIds(calls).filter((x) => myIds.has(x))).toEqual([a]); // B/C must not cascade
      expect(await jobStatus(a)).toBe('running');
      expect(await jobStatus(b)).toBe('blocked');
      expect(await jobStatus(c)).toBe('blocked');

      await completeJob(a);
      await drainUntil(controller, async () => callIds(calls).includes(b) && (await jobStatus(c)) !== 'pending');
      expect(callIds(calls).filter((x) => myIds.has(x))).toEqual([a, b]);
      expect(await jobStatus(b)).toBe('running');
      expect(await jobStatus(c)).toBe('blocked');

      await completeJob(b);
      await drainUntil(controller, async () => callIds(calls).includes(c));
      expect(callIds(calls).filter((x) => myIds.has(x))).toEqual([a, b, c]);
      expect(await jobStatus(c)).toBe('running');
    } finally {
      controller.stop();
      await cleanupGraph([taskId], [repoId], [productId]);
    }
  });

  test('S2: independent jobs open in parallel — both claimed together', async () => {
    const productId = await makeProduct();
    const repoId = await makeRepo(productId);
    const taskId = await makeTask();
    const a = await makeJob(taskId, repoId, 'A');
    const b = await makeJob(taskId, repoId, 'B');
    const myIds = new Set([a, b]);

    const calls: ReconcileJob[] = [];
    const dispatch = makeDispatch(calls);
    const controller = startGraphController(sql, dispatch, { tickMs: 999_999 });
    try {
      await drainUntil(controller, async () => callIds(calls).filter((x) => myIds.has(x)).length === 2);
      expect(new Set(callIds(calls).filter((x) => myIds.has(x)))).toEqual(new Set([a, b]));
      expect(await jobStatus(a)).toBe('running');
      expect(await jobStatus(b)).toBe('running');
    } finally {
      controller.stop();
      await cleanupGraph([taskId], [repoId], [productId]);
    }
  });

  test('S3: diamond join opens only after BOTH branches complete', async () => {
    const productId = await makeProduct();
    const repoId = await makeRepo(productId);
    const taskId = await makeTask();
    const a = await makeJob(taskId, repoId, 'A');
    const b = await makeJob(taskId, repoId, 'B');
    const c = await makeJob(taskId, repoId, 'C');
    const d = await makeJob(taskId, repoId, 'D');
    await waitsOnJob(b, a);
    await waitsOnJob(c, a);
    await waitsOnJob(d, b); // D's two deps are separate dep ROWS -- AND across dep rows
    await waitsOnJob(d, c);
    const myIds = new Set([a, b, c, d]);

    const calls: ReconcileJob[] = [];
    const dispatch = makeDispatch(calls);
    const controller = startGraphController(sql, dispatch, { tickMs: 999_999 });
    try {
      await drainUntil(controller, async () => callIds(calls).includes(a));
      expect(callIds(calls).filter((x) => myIds.has(x))).toEqual([a]);

      await completeJob(a);
      // Also waits for D to settle out of 'pending' -- the same pass that dispatches B/C may not
      // yet have reached D's own evaluation (file-level comment on tick() timing).
      await drainUntil(
        controller,
        async () => callIds(calls).filter((x) => x === b || x === c).length === 2 && (await jobStatus(d)) !== 'pending',
      );
      expect(new Set(callIds(calls).filter((x) => myIds.has(x)))).toEqual(new Set([a, b, c]));
      expect(await jobStatus(d)).toBe('blocked');

      await completeJob(b); // only ONE branch done
      await forceTicks(controller); // give the engine a fair chance to (wrongly) open D anyway
      expect(callIds(calls).filter((x) => x === d)).toEqual([]); // one branch alone must not open D
      expect(await jobStatus(d)).toBe('blocked');

      await completeJob(c);
      await drainUntil(controller, async () => callIds(calls).includes(d));
      expect(await jobStatus(d)).toBe('running');
    } finally {
      controller.stop();
      await cleanupGraph([taskId], [repoId], [productId]);
    }
  });

  test('S4: any-predicate releases as soon as ONE member completes, regardless of the other', async () => {
    const productId = await makeProduct();
    const repoId = await makeRepo(productId);
    const taskId = await makeTask();
    const b = await makeJob(taskId, repoId, 'B');
    const c = await makeJob(taskId, repoId, 'C');
    const d = await makeJob(taskId, repoId, 'D');
    const depId = await insertDep(d, 'any');
    await insertDepMember(depId, 'job', b);
    await insertDepMember(depId, 'job', c);
    const myIds = new Set([b, c, d]);

    const calls: ReconcileJob[] = [];
    const dispatch = makeDispatch(calls);
    const controller = startGraphController(sql, dispatch, { tickMs: 999_999 });
    try {
      // B and C (no deps of their own) both get claimed; D stays blocked (neither done yet). Also
      // waits for D to settle out of 'pending' -- see file-level comment on tick() timing.
      await drainUntil(
        controller,
        async () => callIds(calls).filter((x) => x === b || x === c).length === 2 && (await jobStatus(d)) !== 'pending',
      );
      expect(await jobStatus(d)).toBe('blocked');

      await completeJob(b); // only B finishes; C is left running
      await drainUntil(controller, async () => callIds(calls).includes(d));
      expect(callIds(calls).filter((x) => myIds.has(x) && x !== b && x !== c)).toEqual([d]); // released by B alone
      expect(await jobStatus(d)).toBe('running');
      expect(await jobStatus(c)).toBe('running'); // untouched, still not done
    } finally {
      controller.stop();
      await cleanupGraph([taskId], [repoId], [productId]);
    }
  });

  test('S5: a cross-repo dep enforces order across repos', async () => {
    const productId = await makeProduct();
    const repo1 = await makeRepo(productId, 'repo1');
    const repo2 = await makeRepo(productId, 'repo2');
    const taskId = await makeTask();
    const a = await makeJob(taskId, repo1, 'A');
    const b = await makeJob(taskId, repo2, 'B');
    await waitsOnJob(b, a);
    const myIds = new Set([a, b]);

    const calls: ReconcileJob[] = [];
    const dispatch = makeDispatch(calls);
    const controller = startGraphController(sql, dispatch, { tickMs: 999_999 });
    try {
      // Also waits for B to settle out of 'pending' -- see file-level comment on tick() timing.
      await drainUntil(controller, async () => callIds(calls).includes(a) && (await jobStatus(b)) !== 'pending');
      const aCall = calls.find((c) => c.id === a)!;
      expect(aCall.repoId).toBe(repo1);
      expect(await jobStatus(b)).toBe('blocked');

      await completeJob(a);
      await drainUntil(controller, async () => callIds(calls).includes(b));
      expect(callIds(calls).filter((x) => myIds.has(x))).toEqual([a, b]);
      const bCall = calls.find((c) => c.id === b)!;
      expect(bCall.repoId).toBe(repo2);
      expect(await jobStatus(b)).toBe('running');
    } finally {
      controller.stop();
      await cleanupGraph([taskId], [repo1, repo2], [productId]);
    }
  });
});

describe('S6-S8: task-target dep, acceptable extension, failure + stall', () => {
  test('S6: a task-target dep waits for the ENTIRE target task to resolve, not just its own jobs', async () => {
    const productId = await makeProduct();
    const repo1 = await makeRepo(productId, 'repo1');
    const repo2 = await makeRepo(productId, 'repo2');
    const t1 = await makeTask('t1');
    const t2 = await makeTask('t2');
    const x = await makeJob(t1, repo1, 'X');
    const e = await makeJob(t2, repo1, 'E');
    const f = await makeJob(t2, repo2, 'F');
    await waitsOnTask(x, t2);

    const calls: ReconcileJob[] = [];
    const dispatch = makeDispatch(calls);
    const controller = startGraphController(sql, dispatch, { tickMs: 999_999 });
    try {
      // Also waits for X (a DIFFERENT task, t1) to settle out of 'pending' -- a single tick pass
      // iterates every candidate task, so X's own evaluation may lag E/F's (file-level comment).
      await drainUntil(
        controller,
        async () => callIds(calls).filter((v) => v === e || v === f).length === 2 && (await jobStatus(x)) !== 'pending',
      );
      expect(await jobStatus(x)).toBe('blocked'); // T2 not resolved yet

      await completeJob(e);
      await completeJob(f);
      await forceTicks(controller); // T2's jobs are done, but neither repo has sealed -- must stay blocked
      expect(callIds(calls).filter((v) => v === x)).toEqual([]);
      expect(await jobStatus(x)).toBe('blocked');

      const derived1 = await sealTaskSliceAndDerive(sql, repo1, { taskId: t2, repoId: repo1 });
      expect(derived1).toBe('open'); // repo2 hasn't sealed its own slice yet
      await forceTicks(controller); // still only one repo sealed -- X must stay blocked
      expect(callIds(calls).filter((v) => v === x)).toEqual([]);
      expect(await jobStatus(x)).toBe('blocked');

      const derived2 = await sealTaskSliceAndDerive(sql, repo2, { taskId: t2, repoId: repo2 });
      expect(derived2).toBe('done'); // both repos sealed now -> T2 resolves done

      await drainUntil(controller, async () => callIds(calls).includes(x));
      expect(await jobStatus(x)).toBe('running');
    } finally {
      controller.stop();
      await cleanupGraph([t1, t2], [repo1, repo2], [productId]);
    }
  });

  test("S7: acceptable={satisfied,cancelled} lets a cancelled upstream release the dep; default acceptable does not", async () => {
    const productId = await makeProduct();
    const repoId = await makeRepo(productId);
    const taskId = await makeTask();
    const a = await makeJob(taskId, repoId, 'A');
    const b = await makeJob(taskId, repoId, 'B');
    const bPrime = await makeJob(taskId, repoId, "B'");
    await waitsOnJob(b, a, { acceptable: ['satisfied', 'cancelled'] });
    await waitsOnJob(bPrime, a); // default acceptable = ['satisfied']

    await cancelJob(a, 'pending'); // transition-guard-gated update (reconcile.ts's own convention)

    const calls: ReconcileJob[] = [];
    const dispatch = makeDispatch(calls);
    const controller = startGraphController(sql, dispatch, { tickMs: 999_999 });
    try {
      // Also waits for bPrime to settle out of 'pending' -- see file-level comment on tick() timing.
      await drainUntil(controller, async () => callIds(calls).includes(b) && (await jobStatus(bPrime)) !== 'pending');
      expect(await jobStatus(b)).toBe('running'); // cancelled accepted -> released
      expect(await jobStatus(bPrime)).toBe('blocked'); // default acceptable rejects 'cancelled'
      expect(callIds(calls).filter((x) => x === bPrime)).toEqual([]);
    } finally {
      controller.stop();
      await cleanupGraph([taskId], [repoId], [productId]);
    }
  });

  test('S8: a failed upstream permanently blocks its waiter (default acceptable); a stalled-enough block raises a wake', async () => {
    const productId = await makeProduct();
    const repoId = await makeRepo(productId);
    const taskId = await makeTask();
    const a = await makeJob(taskId, repoId, 'A');
    const b = await makeJob(taskId, repoId, 'B');
    await waitsOnJob(b, a);

    const calls: ReconcileJob[] = [];
    const dispatch = makeDispatch(calls);
    const controller = startGraphController(sql, dispatch, { tickMs: 999_999, stallThresholdMs: 1_000 });
    try {
      await drainUntil(controller, async () => callIds(calls).includes(a));
      await completeJob(a, 'failed');

      await forceTicks(controller);
      expect(callIds(calls).filter((x) => x === b)).toEqual([]);
      expect(await jobStatus(b)).toBe('blocked'); // 'failed' doesn't satisfy the default acceptable

      await sql`update jobs set status_changed_at = ${new Date(Date.now() - 5_000)} where id = ${b}`;
      await drainUntil(controller, async () => {
        const rows = (await sql`
          select 1 from decisions where request_type = 'agent_wake' and status = 'open' and meta->>'kind' = 'stalled' and meta->>'jobId' = ${b}
        `) as unknown[];
        return rows.length > 0;
      });
      expect(await jobStatus(b)).toBe('blocked'); // no auto-resolution (rule 4 / C3)
    } finally {
      controller.stop();
      await cleanupGraph([taskId], [repoId], [productId]);
    }
  });
});

describe('S9-S10: generation bump + latch + stale, mid-flight graph edit', () => {
  test('S9: gen++ latches an already-released dep and stales a freshly-declared one', async () => {
    const productId = await makeProduct();
    const repoId = await makeRepo(productId);
    const taskId = await makeTask();
    const a = await makeJob(taskId, repoId, 'A');
    const b = await makeJob(taskId, repoId, 'B');
    const bDepId = await waitsOnJob(b, a, { expectedGen: 1 });

    const calls: ReconcileJob[] = [];
    const dispatch = makeDispatch(calls);
    const controller = startGraphController(sql, dispatch, { tickMs: 999_999 });
    try {
      await drainUntil(controller, async () => callIds(calls).includes(a));
      await completeJob(a); // A done at generation 1 -- matches B's expected_gen

      await drainUntil(controller, async () => callIds(calls).includes(b));
      await completeJob(b); // B releases and completes, well before A ever regenerates
      expect(await depStatus(bDepId)).toBe('released');

      await bumpJobGeneration(sql, repoId, a); // A: gen 1 -> 2, status -> pending

      // C is declared AFTER the bump, still (mistakenly) expecting generation 1 -- its very first
      // evaluation finds A has already moved on to generation 2.
      const c = await makeJob(taskId, repoId, 'C');
      const cDepId = await waitsOnJob(c, a, { expectedGen: 1 });

      await drainUntil(controller, async () => (await depStatus(cDepId)) === 'stale');
      // (a) B is done; its already-released dep must not revert just because A regressed (latch).
      expect(await jobStatus(b)).toBe('done');
      expect(await depStatus(bDepId)).toBe('released');
      // (b) C's dep is stale (expected gen 1, actual gen 2) -- not released, C not dispatched.
      expect(callIds(calls).filter((x) => x === c)).toEqual([]);
      expect(await jobStatus(c)).not.toBe('running');
      const wakeRows = (await sql`
        select 1 from decisions where request_type = 'agent_wake' and status = 'open' and meta->>'kind' = 'stale_dep' and meta->>'depId' = ${cDepId}
      `) as unknown[];
      expect(wakeRows.length).toBe(1);
    } finally {
      controller.stop();
      await cleanupGraph([taskId], [repoId], [productId]);
    }
  });

  test('S10: a job/dep declared mid-flight is honored once its target completes', async () => {
    const productId = await makeProduct();
    const repoId = await makeRepo(productId);
    const taskId = await makeTask();
    const a = await makeJob(taskId, repoId, 'A');

    const calls: ReconcileJob[] = [];
    const dispatch = makeDispatch(calls);
    const controller = startGraphController(sql, dispatch, { tickMs: 999_999 });
    try {
      await drainUntil(controller, async () => callIds(calls).includes(a));
      expect(await jobStatus(a)).toBe('running');

      // Mid-flight graph edit: a new job + its dep on the still-running A are added live.
      const c = await makeJob(taskId, repoId, 'C');
      await waitsOnJob(c, a);
      expect(await jobStatus(c)).toBe('pending');

      await completeJob(a);
      await drainUntil(controller, async () => callIds(calls).includes(c));
      expect(await jobStatus(c)).toBe('running');
    } finally {
      controller.stop();
      await cleanupGraph([taskId], [repoId], [productId]);
    }
  });
});

describe('S11: terminal latch E2E', () => {
  test('S11: sealing a fully-done task latches it terminal — a later insertJob is rejected', async () => {
    const productId = await makeProduct();
    const repoId = await makeRepo(productId);
    const taskId = await makeTask();
    const a = await makeJob(taskId, repoId, 'A');

    const calls: ReconcileJob[] = [];
    const dispatch = makeDispatch(calls);
    const controller = startGraphController(sql, dispatch, { tickMs: 999_999 });
    try {
      await drainUntil(controller, async () => callIds(calls).includes(a));
      await completeJob(a);

      const derived = await sealTaskSliceAndDerive(sql, repoId, { taskId, repoId });
      expect(derived).toBe('done');
      const taskRows = (await sql`select status from tasks where id = ${taskId}`) as Array<{ status: string }>;
      expect(taskRows[0]!.status).toBe('done');

      await expect(insertJob(sql, repoId, { id: id('late-job'), taskId, repoId, title: 'late' })).rejects.toThrow(TerminalTaskError);
    } finally {
      controller.stop();
      await cleanupGraph([taskId], [repoId], [productId]);
    }
  });
});

describe('S12: real graph loading feeds validateAssembly (migration 9 wiring)', () => {
  test("loadTaskGraph returns the task's current jobs and dep-member edges", async () => {
    const productId = await makeProduct();
    const repoId = await makeRepo(productId);
    const taskId = await makeTask();
    const a = await makeJob(taskId, repoId, 'A');
    const b = await makeJob(taskId, repoId, 'B');
    await waitsOnJob(b, a);

    try {
      const loaded = await loadTaskGraph(sql, taskId);
      expect(new Set(loaded.jobs.map((j) => j.id))).toEqual(new Set([a, b]));
      expect(loaded.edges).toEqual([{ waiterJobId: b, targetType: 'job', targetId: a }]);
    } finally {
      await cleanupGraph([taskId], [repoId], [productId]);
    }
  });

  test('validateAssembly rejects a new edge that would close a cycle against the REAL loaded graph', async () => {
    const productId = await makeProduct();
    const repoId = await makeRepo(productId);
    const taskId = await makeTask();
    const a = await makeJob(taskId, repoId, 'A');
    const b = await makeJob(taskId, repoId, 'B');
    await waitsOnJob(b, a); // existing: B waits A

    try {
      const loaded = await loadTaskGraph(sql, taskId);
      // A new assembly re-declaring A as a job that now waits on B would close A<->B.
      const assembled = { jobs: [{ id: a, taskId, repoId, title: 'A' }], deps: [{ waiterJobId: a, targetType: 'job' as const, targetId: b }] };
      const result = validateAssembly(loaded.jobs, loaded.edges, assembled);
      expect(result.ok).toBe(false);
    } finally {
      await cleanupGraph([taskId], [repoId], [productId]);
    }
  });

  test('validateAssembly accepts a harmless new edge against the REAL loaded graph', async () => {
    const productId = await makeProduct();
    const repoId = await makeRepo(productId);
    const taskId = await makeTask();
    const a = await makeJob(taskId, repoId, 'A');
    const b = await makeJob(taskId, repoId, 'B');
    await waitsOnJob(b, a);

    try {
      const loaded = await loadTaskGraph(sql, taskId);
      const c = id('job-c-unwritten'); // a new job this assembly introduces (not yet inserted)
      const assembled = { jobs: [{ id: c, taskId, repoId, title: 'C' }], deps: [{ waiterJobId: c, targetType: 'job' as const, targetId: a }] };
      const result = validateAssembly(loaded.jobs, loaded.edges, assembled);
      expect(result.ok).toBe(true);
    } finally {
      await cleanupGraph([taskId], [repoId], [productId]);
    }
  });
});
