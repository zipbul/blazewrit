import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { ensureSchema } from '../infra/schema';
import {
  JobNotFoundError,
  JobTaskMismatchError,
  NotRerunnableError,
  SliceSealedError,
  TerminalTaskError,
  WriteAclError,
  bumpJobGeneration,
  insertJob,
  sealTaskSlice,
  sealTaskSliceAndDerive,
  unsealTaskSlice,
} from './store';
import { consumeJobEvents } from './reconcile';
import type { JobStatus, TaskStatus } from './types';

// Integration test: exercises the graph write path (harness/job-graph.md rules 1/2/3/9) against a live Postgres.
const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const PREFIX = `graph-store-${process.pid}-${Date.now()}`;
let n = 0;
const id = (label: string) => `${PREFIX}-${label}-${n++}`;

/** product → two repos (P, Q) → one open task. Every C/E/D7 fixture starts from this shape. */
async function makeTwoRepoTask() {
  const productId = id('product');
  const taskId = id('task');
  const repoP = id('repo-p');
  const repoQ = id('repo-q');
  await sql`insert into products (id, name) values (${productId}, ${productId})`;
  await sql`insert into repos (id, product_id, name, cwd) values (${repoP}, ${productId}, ${repoP}, '/tmp')`;
  await sql`insert into repos (id, product_id, name, cwd) values (${repoQ}, ${productId}, ${repoQ}, '/tmp')`;
  await sql`insert into tasks (id, title, status) values (${taskId}, ${taskId}, 'open')`;
  return { productId, taskId, repoP, repoQ };
}

/** Raw fixture insert — bypasses the (all-stub, during RED) store layer so arrange steps never throw. */
async function seedJob(taskId: string, repoId: string, status: JobStatus, generation = 1): Promise<string> {
  const jobId = id('job');
  await sql`insert into jobs (id, task_id, repo_id, title, status, generation)
    values (${jobId}, ${taskId}, ${repoId}, 'x', ${status}, ${generation})`;
  return jobId;
}

async function sealDirect(taskId: string, repoId: string): Promise<void> {
  await sql`insert into task_seals (task_id, repo_id) values (${taskId}, ${repoId})`;
}

async function setTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
  await sql`update tasks set status = ${status} where id = ${taskId}`;
}

beforeAll(async () => {
  await ensureSchema(sql);
});

afterAll(async () => {
  // FK-reverse order.
  await sql`delete from dep_members where dep_id like ${PREFIX + '%'}`;
  await sql`delete from deps where id like ${PREFIX + '%'}`;
  await sql`delete from job_events where job_id like ${PREFIX + '%'}`;

  await sql`delete from jobs where id like ${PREFIX + '%'}`;
  await sql`delete from task_seals where task_id like ${PREFIX + '%'}`;
  await sql`delete from tasks where id like ${PREFIX + '%'}`;
  await sql`delete from repos where id like ${PREFIX + '%'}`;
  await sql`delete from products where id like ${PREFIX + '%'}`;
  await sql.end();
});

describe('graph/store (rules 1, 2, 3, 9 — write ACL, slice seal freeze, terminal latch)', () => {
  test('C1: a repo that sealed the task cannot insert its own new job', async () => {
    const { taskId, repoP } = await makeTwoRepoTask();
    await sealDirect(taskId, repoP);
    const attempt = async () => {
      await insertJob(sql, repoP, { id: id('job'), taskId, repoId: repoP, title: 'x' });
    };
    await expect(attempt()).rejects.toThrow(SliceSealedError);
  });

  test('C2: a different (unsealed) repo can still insert a job after repo P sealed', async () => {
    const { taskId, repoP, repoQ } = await makeTwoRepoTask();
    await sealDirect(taskId, repoP);
    await insertJob(sql, repoQ, { id: id('job'), taskId, repoId: repoQ, title: 'x' });
    const rows = (await sql`select id from jobs where task_id = ${taskId} and repo_id = ${repoQ}`) as Array<{ id: string }>;
    expect(rows.length).toBe(1);
  });

  /**
   * 단일 기록자 통합 Phase 2: bumpJobGeneration itself only records a `rerun_requested` job_events
   * fact now — the actual gen++ happens later, in graph/reconcile.ts's consumeOneEvent (the same
   * consumer Phase 1 already built). Right after bumpJobGeneration returns, the row is STILL exactly
   * what it was before the call; only consuming the event flips it to pending at generation+1.
   */
  test('C3: repo P sealed can still gen++ its own terminal job (re-run is not an insert) — bump records the fact, consume applies it', async () => {
    const { taskId, repoP } = await makeTwoRepoTask();
    const jobId = await seedJob(taskId, repoP, 'done', 1);
    await sealDirect(taskId, repoP);

    await bumpJobGeneration(sql, repoP, jobId, taskId);
    const beforeConsume = (await sql`select status, generation from jobs where id = ${jobId}`) as Array<{ status: string; generation: number }>;
    expect(beforeConsume[0]).toMatchObject({ status: 'done', generation: 1 }); // NOT yet bumped — the fact is durable, not yet applied

    await consumeJobEvents(sql, taskId);
    const afterConsume = (await sql`select status, generation from jobs where id = ${jobId}`) as Array<{ status: string; generation: number }>;
    expect(afterConsume[0]).toMatchObject({ status: 'pending', generation: 2 });
  });

  test('F5: gen++ on a missing job id throws JobNotFoundError', async () => {
    const attempt = async () => {
      await bumpJobGeneration(sql, 'some-repo', id('missing-job'), id('some-task'));
    };
    await expect(attempt()).rejects.toThrow(JobNotFoundError);
  });

  test('F6: gen++ on a running job throws NotRerunnableError', async () => {
    const { taskId, repoP } = await makeTwoRepoTask();
    const jobId = await seedJob(taskId, repoP, 'running', 1);
    const attempt = async () => {
      await bumpJobGeneration(sql, repoP, jobId, taskId);
    };
    await expect(attempt()).rejects.toThrow(NotRerunnableError);
  });

  test('F7 (3자 리뷰 확정, job_rerun task-scope gap): gen++ on a job whose task_id does not match expectTaskId throws JobTaskMismatchError', async () => {
    const { taskId, repoP } = await makeTwoRepoTask();
    const { taskId: otherTaskId } = await makeTwoRepoTask();
    const jobId = await seedJob(taskId, repoP, 'failed', 1);
    const attempt = async () => {
      await bumpJobGeneration(sql, repoP, jobId, otherTaskId);
    };
    await expect(attempt()).rejects.toThrow(JobTaskMismatchError);
    // must not have recorded a rerun_requested fact — the mismatch rejects before any write.
    const events = (await sql`select 1 from job_events where job_id = ${jobId}`) as unknown[];
    expect(events.length).toBe(0);
  });

  test('C4: deleting its own seal reopens INSERT for that repo', async () => {
    const { taskId, repoP } = await makeTwoRepoTask();
    await sealDirect(taskId, repoP);
    await unsealTaskSlice(sql, repoP, { taskId, repoId: repoP });
    await insertJob(sql, repoP, { id: id('job'), taskId, repoId: repoP, title: 'x' });
    const rows = (await sql`select id from jobs where task_id = ${taskId} and repo_id = ${repoP}`) as Array<{ id: string }>;
    expect(rows.length).toBe(1);
  });

  test('C5: an actor cannot insert a job into a repo other than its own (rule 1)', async () => {
    const { taskId, repoQ } = await makeTwoRepoTask();
    const attempt = async () => {
      await insertJob(sql, 'some-other-actor', { id: id('job'), taskId, repoId: repoQ, title: 'x' });
    };
    await expect(attempt()).rejects.toThrow(WriteAclError);
  });

  test("C6: a repo cannot seal or unseal another repo's slice", async () => {
    const { taskId, repoP, repoQ } = await makeTwoRepoTask();
    const sealAttempt = async () => {
      await sealTaskSlice(sql, repoP, { taskId, repoId: repoQ });
    };
    await expect(sealAttempt()).rejects.toThrow(WriteAclError);

    await sealDirect(taskId, repoQ);
    const unsealAttempt = async () => {
      await unsealTaskSlice(sql, repoP, { taskId, repoId: repoQ });
    };
    await expect(unsealAttempt()).rejects.toThrow(WriteAclError);
  });

  test('C7: insertJob always creates the row as pending generation 1', async () => {
    const { taskId, repoP } = await makeTwoRepoTask();
    const jobId = id('job');
    await insertJob(sql, repoP, { id: jobId, taskId, repoId: repoP, title: 'x' });
    const rows = (await sql`select status, generation from jobs where id = ${jobId}`) as Array<{ status: string; generation: number }>;
    expect(rows[0]).toMatchObject({ status: 'pending', generation: 1 });
  });

  test('E1: once a task is done, no repo can insert a new job into it', async () => {
    const { taskId, repoQ } = await makeTwoRepoTask();
    await setTaskStatus(taskId, 'done');
    const attempt = async () => {
      await insertJob(sql, repoQ, { id: id('job'), taskId, repoId: repoQ, title: 'x' });
    };
    await expect(attempt()).rejects.toThrow(TerminalTaskError);
  });

  test('E2: once a task is done, its sealed repo cannot delete its own seal', async () => {
    const { taskId, repoP } = await makeTwoRepoTask();
    await sealDirect(taskId, repoP);
    await setTaskStatus(taskId, 'done');
    const attempt = async () => {
      await unsealTaskSlice(sql, repoP, { taskId, repoId: repoP });
    };
    await expect(attempt()).rejects.toThrow(TerminalTaskError);
  });

  test('E3: once a task is done, its jobs cannot gen++', async () => {
    const { taskId, repoP } = await makeTwoRepoTask();
    const jobId = await seedJob(taskId, repoP, 'done', 1);
    await setTaskStatus(taskId, 'done');
    const attempt = async () => {
      await bumpJobGeneration(sql, repoP, jobId, taskId);
    };
    await expect(attempt()).rejects.toThrow(TerminalTaskError);
  });

  test('E4: a failed or cancelled task enforces the same terminal latch (insert on failed, gen++ on cancelled)', async () => {
    const { taskId: failedTaskId, repoQ: repoOnFailed } = await makeTwoRepoTask();
    await setTaskStatus(failedTaskId, 'failed');
    const insertOnFailed = async () => {
      await insertJob(sql, repoOnFailed, { id: id('job'), taskId: failedTaskId, repoId: repoOnFailed, title: 'x' });
    };
    await expect(insertOnFailed()).rejects.toThrow(TerminalTaskError);

    const { taskId: cancelledTaskId, repoP: repoOnCancelled } = await makeTwoRepoTask();
    const jobId = await seedJob(cancelledTaskId, repoOnCancelled, 'done', 1);
    await setTaskStatus(cancelledTaskId, 'cancelled');
    const bumpOnCancelled = async () => {
      await bumpJobGeneration(sql, repoOnCancelled, jobId, cancelledTaskId);
    };
    await expect(bumpOnCancelled()).rejects.toThrow(TerminalTaskError);
  });

  test('D7: insert-then-seal never yields "done" while a non-terminal job exists', async () => {
    const { taskId, repoP } = await makeTwoRepoTask();
    await seedJob(taskId, repoP, 'done', 1);
    // Order 1: a second, still-pending job lands BEFORE the seal+derive runs.
    await insertJob(sql, repoP, { id: id('job'), taskId, repoId: repoP, title: 'y' });
    await sealTaskSliceAndDerive(sql, repoP, { taskId, repoId: repoP });
    const rows = (await sql`select status from tasks where id = ${taskId}`) as Array<{ status: string }>;
    expect(rows[0]!.status).toBe('open');
  });

  test('D7: seal-then-insert rejects the late insert instead of letting a job join a done task', async () => {
    const { taskId, repoP } = await makeTwoRepoTask();
    await seedJob(taskId, repoP, 'done', 1);
    // Order 2: seal+derive runs first — only the done job exists yet, so the task becomes done.
    await sealTaskSliceAndDerive(sql, repoP, { taskId, repoId: repoP });
    // A late insert attempt must be rejected, not silently accepted into an already-done task.
    const lateInsert = async () => {
      await insertJob(sql, repoP, { id: id('job'), taskId, repoId: repoP, title: 'y' });
    };
    await expect(lateInsert()).rejects.toThrow(TerminalTaskError);
    const rows = (await sql`select status from tasks where id = ${taskId}`) as Array<{ status: string }>;
    expect(rows[0]!.status).toBe('done');
  });
});
