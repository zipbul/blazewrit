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
      controller.stop();
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
      controller.stop();
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
      controller.stop();
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
      expect(concurrent).toEqual({ expired: [], reconciled: [] });

      await waitFor(async () => ((await jobStatus(jobId)) !== 'pending' ? true : undefined));
      expect(dispatch.mock.calls.some(([job]) => job.id === jobId)).toBe(true);
    } finally {
      controller.stop();
    }
  });

  test('B5: stop() halts the periodic timer', async () => {
    const { repoId, taskId } = await makeChain();
    const dispatch = mock(async (_job: ReconcileJob) => {});
    const controller = startGraphController(sql, dispatch, { tickMs: 30 });
    controller.stop(); // stop right away — only the auto-initial pass (B1) may still complete
    await new Promise((r) => setTimeout(r, 150));
    const jobId = await seedJob(taskId, repoId, 'pending');
    await new Promise((r) => setTimeout(r, 200)); // several tickMs multiples, had the timer survived
    expect(await jobStatus(jobId)).toBe('pending'); // never auto-reconciled after stop
  });
});

describe('startGraphController — lease-expiry scan (harness/job-graph.md P2 spec A3-A5)', () => {
  test('A3: a running job whose lease already expired is failed by the scan', async () => {
    const { repoId, taskId } = await makeChain();
    const jobId = await seedJob(taskId, repoId, 'running');
    await setLeaseExpiresAt(jobId, new Date(Date.now() - 60_000));
    const dispatch = mock(async (_job: ReconcileJob) => {});

    const controller = startGraphController(sql, dispatch, { tickMs: 999_999 });
    try {
      await waitFor(async () => ((await jobStatus(jobId)) === 'failed' ? true : undefined));
    } finally {
      controller.stop();
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
      controller.stop();
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
      controller.stop();
    }
  });
});
