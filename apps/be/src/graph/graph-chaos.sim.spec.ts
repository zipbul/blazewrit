import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { ensureSchema } from '../infra/schema';
import { createRestApi } from '../api/rest';
import { startGraphController, type GraphController } from './controller';
import {
  insertJob,
  insertDep,
  bumpJobGeneration,
  sealTaskSliceAndDerive,
  rederiveTask,
  TerminalTaskError,
} from './store';
import {
  buildGraphTools,
  JOB_ADD_TOOL,
  DEP_DECLARE_TOOL,
  DEP_RETRACT_TOOL,
  TASK_SEAL_TOOL,
  TASK_UNSEAL_TOOL,
  GRAPH_READ_TOOL,
  type GraphToolContext,
  type GraphToolDef,
} from './agent-tools';
import { loadTaskGraph } from './load-task-graph';
import { wouldCreateCycle, type CycleEdge } from './cycle';
import { deriveTaskStatus } from './derive';
import { evaluateDep, jobTargetOutcome, taskTargetOutcome, isStaleMember } from './deps';
import type { DepOutcome, DepStatus, DepTargetType, JobStatus } from './types';
import { reconcileTask, type ReconcileJob } from './reconcile';
import type { StepContext, StepExecutor } from '../orchestrator/types';

/**
 * Harness v2 (round-simv2-spec.md): a committed, env-gated (`BW_SIM=1`) chaos/integration
 * simulation that closes the 5 defects a meta adversarial review (Codex+Grok) confirmed in the v1
 * harness:
 *  - A2 (500ms polling misses instantaneous regressions) -> a DB audit trigger records every
 *    jobs/deps/tasks/task_seals transition; every invariant below reads the FULL committed
 *    history from `bw_sim_audit`, not a sampled snapshot.
 *  - A2 (cycle check weaker than production) -> the end-of-run cycle check reuses the REAL
 *    `loadTaskGraph` + `wouldCreateCycle` (graph/cycle.ts), the exact production cycle-check path.
 *  - A2 (ACL checked by prefix, not exhaustively) -> `allJobWrites` records EVERY successful job
 *    write this file ever makes (seed + chaos + agent + the one real A2A dispatch) and the final
 *    assertion diffs it against the full `jobs` row set for this run's task — full population,
 *    not a sample.
 *  - A1 (rule 2/9/derive/outcome invariants never checked) -> seal-freeze windows, post-terminal
 *    writes, dep/task derivation are all checked against final DB facts + the audit history.
 *  - A3 (simulated dispatch != the real dispatch path) -> dispatch is
 *    `createRestApi(...).onReconcileDispatch`'s callback (`runRegisteredJob`), the SAME function
 *    serve.ts wires to startGraphController. Every job in this sim is created via insertJob/
 *    dep_declare-style graph writes (never dispatchTask), so EVERY one of them is a registry miss
 *    that must walk rest.ts's real reconstruction path (makeJobFlow, work_items dual-write,
 *    generation-CAS completion) — exactly the P4-2b code this suite exists to pressure-test.
 *  - A4 (chaos deps via raw SQL) -> all chaos dep writes go through `insertDep`/`insertDepTx`
 *    (graph/store.ts) or the `dep_declare` agent tool — never a raw INSERT into deps/dep_members.
 *  - A5 (unseeded, irreproducible chaos) -> a mulberry32 PRNG seeds every chaos/agent decision;
 *    SEEDS below is the full, fixed, reproducible sample (Math.random is never called here).
 *
 * Skipped entirely unless BW_SIM=1 (mirrors orchestrator/infra/pg-store.spec.ts's BW_PG_URL gate)
 * — `bun test` stays green/cheap by default; `BW_SIM=1 bun test graph-chaos` runs the real thing.
 */
const BW_SIM = process.env.BW_SIM === '1';
const suite = BW_SIM ? describe : describe.skip;

const SEEDS = [1, 42, 1337];

/** A job title carrying this substring deterministically fails at its very first produce() call
 * (see makeSimExecutor) — content-keyed, not call-order-keyed, so it stays deterministic even
 * though many flows run concurrently against the shared stub executor instance. */
const FAIL_MARKER = 'BW_SIM_CHAOS_FAIL_MARK';

/**
 * W2/N4 (harness handoff round-simv2-takeover.md): a job title carrying this substring fails its
 * FIRST produce() call and succeeds every call after — content-keyed like FAIL_MARKER, but scoped
 * per exact title via makeSimExecutor's own closure Set (safe: a single job's retries are strictly
 * sequential — reconcile's atomic claim never lets the SAME job run twice concurrently — so this
 * isn't the "call order across concurrent jobs" nondeterminism FAIL_MARKER's own doc warns against).
 * Exists so the rule-5 stale-dep path can be armed WITHOUT permanently blocking its waiter forever
 * (unlike FAIL_MARKER, which fails every generation): fail once (gen1) -> gen++ (real
 * bumpJobGeneration, real generation mismatch against a dep pinned to gen1) -> stale fires ->
 * succeed on retry (gen2) -> dep releases. See runStaleDepDemo.
 */
const FAIL_ONCE_MARKER = 'BW_SIM_CHAOS_FAIL_ONCE';

/** W2/N4: a job title carrying `${LEASE_DELAY_MARKER}_<ms>` sleeps `<ms>` inside produce() before
 * completing — the delay amount is baked into the title itself (not a shared counter) so it stays
 * content-keyed/reproducible per seed even under concurrent dispatch. Paired with a short
 * `leaseTtlMs` (see runSeed's controller/createRestApi wiring) so the lease genuinely lapses WHILE
 * this produce() call is still in flight — a real A3 (lease-expiry) firing, not a simulated one. */
const LEASE_DELAY_MARKER = 'BW_SIM_CHAOS_LEASE_DELAY';
const LEASE_DELAY_RE = new RegExp(`${LEASE_DELAY_MARKER}_(\\d+)`);

/** W2/N4: reconcile claim lease TTL + controller tick — short enough that a 3-4s produce() delay
 * (see LEASE_DELAY_MARKER) genuinely outlives it, forcing a real A3 lease-expiry scan hit instead
 * of merely a theoretical one. */
const SIM_LEASE_TTL_MS = 1500;
const SIM_STALL_THRESHOLD_MS = 4000;

// ---------------------------------------------------------------------------------------------
// Pure helpers (no DB access, no side effects at module load — safe to define unconditionally).
// ---------------------------------------------------------------------------------------------

/** mulberry32: a tiny, fast, seedable PRNG. Same seed -> same [0,1) draw sequence, forever. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function rng(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function tally(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

/** Every handler in agent-tools.ts's errorResult shape is `${ClassName}: ${message}` — the class
 * name alone is what chaos bookkeeping cares about (which rule fired), never the free-text reason. */
function errClass(text: string): string {
  return text.split(':')[0] ?? text;
}

function errName(err: unknown): string {
  return err instanceof Error ? err.constructor.name : 'Unknown';
}

async function waitFor<T>(fn: () => Promise<T | undefined | null | false>, timeoutMs = 20000, interval = 40): Promise<T> {
  const start = Date.now();
  let last: T | undefined | null | false;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (last) return last as T;
    await sleep(interval);
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms; last value: ${JSON.stringify(last)}`);
}

// ---------------------------------------------------------------------------------------------
// bw_sim_audit: the DB-side audit trigger set (A2's "polling misses instant regressions" fix).
// One generic table, four triggers (jobs INSERT/UPDATE, deps UPDATE, tasks INSERT/UPDATE,
// task_seals INSERT/DELETE) — every row records (entity, entity_id, task_id, repo_id, generation,
// old_status, new_status, ts=clock_timestamp()). Exported so a throwaway bug-injection script can
// reuse the exact same DDL/teardown without duplicating it (see the RED-proof report).
// ---------------------------------------------------------------------------------------------

export async function teardownAudit(sql: SQL): Promise<void> {
  await sql`drop trigger if exists sim_trg_jobs_iu on jobs`;
  await sql`drop trigger if exists sim_trg_deps_u on deps`;
  await sql`drop trigger if exists sim_trg_tasks_iu on tasks`;
  await sql`drop trigger if exists sim_trg_seals_id on task_seals`;
  await sql`drop function if exists bw_sim_audit_jobs() cascade`;
  await sql`drop function if exists bw_sim_audit_deps() cascade`;
  await sql`drop function if exists bw_sim_audit_tasks() cascade`;
  await sql`drop function if exists bw_sim_audit_seals() cascade`;
  await sql`drop table if exists bw_sim_audit`;
}

export async function setupAudit(sql: SQL): Promise<void> {
  await teardownAudit(sql); // idempotent — clears any leftover from a crashed prior run

  await sql`create table bw_sim_audit (
    id bigserial primary key,
    entity text not null,
    entity_id text not null,
    task_id text,
    repo_id text,
    generation int,
    old_status text,
    new_status text,
    ts timestamptz not null default clock_timestamp()
  )`;
  await sql`create index bw_sim_audit_lookup on bw_sim_audit (entity, task_id, ts)`;

  await sql`create or replace function bw_sim_audit_jobs() returns trigger as $$
    begin
      insert into bw_sim_audit(entity, entity_id, task_id, repo_id, generation, old_status, new_status)
      values ('job', NEW.id, NEW.task_id, NEW.repo_id, NEW.generation,
        case when TG_OP = 'INSERT' then null else OLD.status end, NEW.status);
      return NEW;
    end;
  $$ language plpgsql`;
  await sql`create trigger sim_trg_jobs_iu after insert or update on jobs for each row execute function bw_sim_audit_jobs()`;

  await sql`create or replace function bw_sim_audit_deps() returns trigger as $$
    declare v_task_id text; v_repo_id text;
    begin
      select j.task_id, j.repo_id into v_task_id, v_repo_id from jobs j where j.id = NEW.waiter_job;
      insert into bw_sim_audit(entity, entity_id, task_id, repo_id, generation, old_status, new_status)
      values ('dep', NEW.id, v_task_id, v_repo_id, null, OLD.status, NEW.status);
      return NEW;
    end;
  $$ language plpgsql`;
  await sql`create trigger sim_trg_deps_u after update on deps for each row execute function bw_sim_audit_deps()`;

  await sql`create or replace function bw_sim_audit_tasks() returns trigger as $$
    begin
      insert into bw_sim_audit(entity, entity_id, task_id, repo_id, generation, old_status, new_status)
      values ('task', NEW.id, NEW.id, null, null,
        case when TG_OP = 'INSERT' then null else OLD.status end, NEW.status);
      return NEW;
    end;
  $$ language plpgsql`;
  await sql`create trigger sim_trg_tasks_iu after insert or update on tasks for each row execute function bw_sim_audit_tasks()`;

  // task_seals has no history of its own (unseal DELETEs the row) — this trigger is the only
  // record of a seal WINDOW's end, which the rule-2 (seal-freeze) check needs.
  await sql`create or replace function bw_sim_audit_seals() returns trigger as $$
    begin
      if TG_OP = 'INSERT' then
        insert into bw_sim_audit(entity, entity_id, task_id, repo_id, generation, old_status, new_status)
        values ('seal', NEW.repo_id, NEW.task_id, NEW.repo_id, null, null, 'sealed');
        return NEW;
      else
        insert into bw_sim_audit(entity, entity_id, task_id, repo_id, generation, old_status, new_status)
        values ('seal', OLD.repo_id, OLD.task_id, OLD.repo_id, null, 'sealed', 'unsealed');
        return OLD;
      end if;
    end;
  $$ language plpgsql`;
  await sql`create trigger sim_trg_seals_id after insert or delete on task_seals for each row execute function bw_sim_audit_seals()`;
}

interface AuditRow {
  id: number;
  entity_id: string;
  task_id: string | null;
  repo_id: string | null;
  generation: number | null;
  old_status: string | null;
  new_status: string;
  ts: Date;
}

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const arr = out.get(k) ?? [];
    arr.push(row);
    out.set(k, arr);
  }
  return out;
}

const TERMINAL_JOB_STATUSES = new Set(['done', 'failed', 'cancelled']);

/**
 * A2's headline fix: does any job, WITHIN THE SAME generation, ever show a terminal status
 * followed by a non-terminal one? A gen++ (bumpJobGeneration) legitimately does terminal->pending
 * at a NEW generation — that's rewound-for-rerun, not a regression — so this only flags a
 * transition that regresses WITHOUT a generation bump underneath it. Full history (every audit
 * row), not a 500ms-interval poll — an instantaneous revert-and-recover between two polls would
 * have been invisible to v1; it cannot hide here.
 */
export async function findTerminalRegressions(sql: SQL, taskId: string): Promise<string[]> {
  const rows = (await sql`
    select id, entity_id, task_id, repo_id, generation, old_status, new_status, ts
    from bw_sim_audit where entity = 'job' and task_id = ${taskId}
    order by entity_id, id
  `) as AuditRow[];
  const violations: string[] = [];
  for (const [jobId, evs] of groupBy(rows, (r) => r.entity_id)) {
    let curGen: number | null = null;
    let terminalSeen = false;
    for (const e of evs) {
      if (e.generation !== curGen) {
        curGen = e.generation;
        terminalSeen = false;
      }
      const isTerminalNow = TERMINAL_JOB_STATUSES.has(e.new_status);
      if (terminalSeen && !isTerminalNow) {
        violations.push(`job ${jobId} gen ${curGen}: ${e.old_status} -> ${e.new_status} after already terminal (audit id=${e.id}, ts=${e.ts.toISOString()})`);
      }
      if (isTerminalNow) terminalSeen = true;
    }
  }
  return violations;
}

/** Rule 11 latch: once a dep is 'released', full history must never show a later row for that
 * SAME dep id whose new_status isn't 'released' again. */
export async function findDepLatchRegressions(sql: SQL, taskId: string): Promise<string[]> {
  const rows = (await sql`
    select id, entity_id, task_id, repo_id, generation, old_status, new_status, ts
    from bw_sim_audit where entity = 'dep' and task_id = ${taskId}
    order by entity_id, id
  `) as AuditRow[];
  const violations: string[] = [];
  for (const [depId, evs] of groupBy(rows, (r) => r.entity_id)) {
    let releasedSeen = false;
    for (const e of evs) {
      if (releasedSeen && e.new_status !== 'released') {
        violations.push(`dep ${depId}: reverted to ${e.new_status} after already released (audit id=${e.id}, ts=${e.ts.toISOString()})`);
      }
      if (e.new_status === 'released') releasedSeen = true;
    }
  }
  return violations;
}

/**
 * Rule 2 (seal-freeze): a repo's task_seals row freezes ITS OWN jobs INSERTs while sealed.
 * Reconstructs each repo's sealed windows from the seal-entity audit trail (a still-open window at
 * the end of the run has no closing 'unsealed' row — its window simply extends to "now", which is
 * still correct for catching any INSERT that landed inside it). Windows are compared using the
 * audit table's own bigserial `id` (guaranteed strictly-increasing true insertion order), NOT
 * `ts`/clock_timestamp() — under concurrent load `ts` is not guaranteed monotonic across separate
 * backend connections (observed directly on this environment: a later-inserted audit row can carry
 * an earlier wall-clock timestamp than one committed just before it), so any check that orders or
 * windows by `ts` alone is unsound. `ts` is kept only for human-readable violation messages.
 */
export async function findSealFreezeViolations(sql: SQL, taskId: string): Promise<string[]> {
  // id::int, NOT bare `id` (bigserial): bun's Postgres driver returns bigint/bigserial columns as
  // JS STRINGS (verified directly against this driver), so the JS-side `>=`/`<=` window
  // comparisons below would silently do LEXICOGRAPHIC string comparison instead of numeric
  // ("4" >= "35" is true as strings) — this row count never remotely approaches int overflow.
  const sealRows = (await sql`
    select id::int as id, entity_id as repo_id, new_status, ts from bw_sim_audit
    where entity = 'seal' and task_id = ${taskId} order by entity_id, id
  `) as Array<{ id: number; repo_id: string; new_status: string; ts: Date }>;
  const windowsByRepo = new Map<string, Array<[number, number | null, Date]>>();
  for (const r of sealRows) {
    const arr = windowsByRepo.get(r.repo_id) ?? [];
    windowsByRepo.set(r.repo_id, arr);
    if (r.new_status === 'sealed') {
      arr.push([r.id, null, r.ts]);
    } else {
      const last = arr[arr.length - 1];
      if (last && last[1] === null) last[1] = r.id;
    }
  }

  const jobInsertRows = (await sql`
    select id::int as id, entity_id as job_id, repo_id, ts from bw_sim_audit
    where entity = 'job' and task_id = ${taskId} and old_status is null order by id
  `) as Array<{ id: number; job_id: string; repo_id: string; ts: Date }>;

  const violations: string[] = [];
  for (const j of jobInsertRows) {
    const windows = windowsByRepo.get(j.repo_id) ?? [];
    for (const [start, end, startTs] of windows) {
      if (j.id >= start && (end === null || j.id <= end)) {
        violations.push(`job ${j.job_id} inserted (audit id=${j.id}, ts=${j.ts.toISOString()}) while repo ${j.repo_id} was sealed (since audit id=${start}, ts=${startTs.toISOString()})`);
      }
    }
  }
  return violations;
}

/** Rule 9 (terminal task immutable): once the task's audit trail shows open->terminal, full
 * history must show zero later job INSERTs and zero later generation bumps under this task.
 * Ordered by the audit table's own bigserial `id`, not `ts` (see findSealFreezeViolations's own
 * comment on why `ts` alone is unsound here). */
export async function findPostTerminalWrites(sql: SQL, taskId: string): Promise<string[]> {
  // id::int (see findSealFreezeViolations's own comment): bun returns bigint/bigserial as JS
  // strings, and this function compares `id` numerically in JS (the gen-bump loop below), not
  // just in SQL — a bare `id` would silently do wrong, lexicographic string comparisons there.
  const taskRows = (await sql`
    select id::int as id, old_status, new_status, ts from bw_sim_audit where entity = 'task' and entity_id = ${taskId} order by id
  `) as Array<{ id: number; old_status: string | null; new_status: string; ts: Date }>;
  const terminalRow = taskRows.find((r) => r.new_status === 'done' || r.new_status === 'failed' || r.new_status === 'cancelled');
  if (!terminalRow) return ['task never reached a terminal status — nothing to check (this itself is a setup problem, not a pass)'];
  const terminalAuditId = terminalRow.id;

  const violations: string[] = [];
  const insertsAfter = (await sql`
    select entity_id from bw_sim_audit where entity = 'job' and task_id = ${taskId} and old_status is null and id > ${terminalAuditId}
  `) as Array<{ entity_id: string }>;
  for (const r of insertsAfter) violations.push(`job ${r.entity_id} INSERTed after task went terminal (audit id=${terminalAuditId}, ts=${terminalRow.ts.toISOString()})`);

  const jobRows = (await sql`
    select id::int as id, entity_id, generation from bw_sim_audit where entity = 'job' and task_id = ${taskId} order by entity_id, id
  `) as Array<{ id: number; entity_id: string; generation: number | null }>;
  for (const [jobId, evs] of groupBy(jobRows, (r) => r.entity_id)) {
    let prevGen: number | null = null;
    for (const e of evs) {
      if (prevGen !== null && e.generation !== null && e.generation > prevGen && e.id > terminalAuditId) {
        violations.push(`job ${jobId} generation bumped ${prevGen} -> ${e.generation} after task went terminal (audit id=${terminalAuditId}, ts=${terminalRow.ts.toISOString()})`);
      }
      prevGen = e.generation;
    }
  }
  return violations;
}

/** Positive full-population check: every job-target dep_member under this task's own deps must
 * name a job that actually exists (insertDepTx enforces this at write time; jobs are never
 * deleted, so this can never regress later — asserted anyway as an end-state sanity check). */
export async function findDanglingJobTargets(sql: SQL, taskId: string): Promise<string[]> {
  const rows = (await sql`
    select dm.dep_id, dm.target_id from dep_members dm
    join deps d on d.id = dm.dep_id
    where d.waiter_job in (select id from jobs where task_id = ${taskId})
      and dm.target_type = 'job'
      and not exists (select 1 from jobs j where j.id = dm.target_id)
  `) as Array<{ dep_id: string; target_id: string }>;
  return rows.map((r) => `dep ${r.dep_id} targets nonexistent job ${r.target_id}`);
}

/**
 * A1's derive/outcome check, adapted to reality: dep_members.outcome is a LIVE-ONLY field
 * (reconcile.ts's own comment: "dep_members rows don't self-update") — nothing in this codebase
 * ever persists it, so reading the stored column back would just always see the 'pending' default
 * and falsely "fail" on every released dep. Recomputes what reconcile.ts's own liveMemberOutcome +
 * evaluateDep (graph/deps.ts, the SAME pure functions production uses) would produce from each
 * member's CURRENT live target status, and diffs that against the dep's actual stored `status` —
 * this is the real "did the engine reach the mathematically correct fixed point" check. Skips
 * already-'released' deps: rule 11's latch means a released dep's members are explicitly ALLOWED
 * to diverge from a fresh re-evaluation afterward (see findDepLatchRegressions for the check that
 * covers released deps: they may never revert, which is the actual invariant there).
 */
export async function findDepEvaluationMismatches(sql: SQL, taskId: string): Promise<string[]> {
  const depRows = (await sql`
    select d.id, d.predicate, d.status, d.waiter_job, j.status as waiter_status from deps d
    join jobs j on j.id = d.waiter_job
    where d.waiter_job in (select id from jobs where task_id = ${taskId})
  `) as Array<{ id: string; predicate: 'all' | 'any'; status: DepStatus; waiter_job: string; waiter_status: string }>;
  const violations: string[] = [];
  for (const dep of depRows) {
    if (dep.status === 'released') continue;
    const memberRows = (await sql`
      select target_type, target_id, expected_gen, acceptable from dep_members where dep_id = ${dep.id}
    `) as Array<{ target_type: DepTargetType; target_id: string; expected_gen: number | null; acceptable: string[] }>;
    const evalMembers = [];
    for (const m of memberRows) {
      let outcome: DepOutcome = 'pending';
      let actualGen: number | undefined;
      if (m.target_type === 'job') {
        const t = ((await sql`select status, generation from jobs where id = ${m.target_id}`) as Array<{ status: JobStatus; generation: number }>)[0];
        outcome = t ? jobTargetOutcome(t.status) : 'pending';
        actualGen = t?.generation;
      } else if (m.target_type === 'task') {
        const t = ((await sql`select status from tasks where id = ${m.target_id}`) as Array<{ status: 'open' | 'done' | 'failed' | 'cancelled' }>)[0];
        outcome = t ? taskTargetOutcome(t.status) : 'pending';
      }
      const stale = isStaleMember({ targetType: m.target_type, expectedGen: m.expected_gen ?? undefined }, actualGen);
      evalMembers.push({ outcome, acceptable: m.acceptable as DepOutcome[], stale });
    }
    const recomputed = evaluateDep({ predicate: dep.predicate, status: dep.status }, evalMembers);
    if (recomputed !== dep.status) {
      violations.push(
        `dep ${dep.id}: stored status=${dep.status}, recomputed=${recomputed}, waiter=${dep.waiter_job} waiterStatus=${dep.waiter_status}`,
      );
    }
  }
  return violations;
}

/** Rule 3/6 (task derivation): recomputes deriveTaskStatus from final graph facts and checks it
 * against tasks.status, then re-runs the REAL rederiveTask (graph/store.ts) and checks it agrees
 * (and, since the task should already be terminal by the time this runs, is a no-op). */
export async function checkTaskDerivation(sql: SQL, taskId: string): Promise<{ expected: string; actual: string; rederived: string }> {
  const participatingRows = (await sql`select distinct repo_id from jobs where task_id = ${taskId}`) as Array<{ repo_id: string }>;
  const sealedRows = (await sql`select repo_id from task_seals where task_id = ${taskId}`) as Array<{ repo_id: string }>;
  const jobRows = (await sql`select status from jobs where task_id = ${taskId}`) as Array<{ status: JobStatus }>;
  const expected = deriveTaskStatus({
    participatingRepoIds: participatingRows.map((r) => r.repo_id),
    sealedRepoIds: sealedRows.map((r) => r.repo_id),
    jobStatuses: jobRows.map((r) => r.status),
  });
  const actual = ((await sql`select status from tasks where id = ${taskId}`) as Array<{ status: string }>)[0]!.status;
  const rederived = await rederiveTask(sql, taskId);
  return { expected, actual, rederived };
}

/**
 * A2's cycle-check fix: reuses production's REAL loadTaskGraph + wouldCreateCycle (graph/cycle.ts)
 * — the exact function insertDepTx itself calls — instead of a weaker/active-only reimplementation.
 * Folds every edge into an incrementally-confirmed acyclic set: for any edge set that DOES contain
 * a cycle, processing in ANY fixed order eventually reaches the last-processed edge of that cycle
 * with all its other members already confirmed, so wouldCreateCycle correctly flags it at that
 * point — order-independent for cycle DETECTION even though it only means to check ONE new edge
 * at a time in production. Global scope (not task-scoped), same as loadTaskGraph's own contract.
 */
export async function findCycleViolation(sql: SQL): Promise<string | undefined> {
  const { jobs, edges } = await loadTaskGraph(sql);
  const confirmed: CycleEdge[] = [];
  for (const edge of edges) {
    if (wouldCreateCycle(jobs, confirmed, edge)) {
      return `edge ${edge.waiterJobId} -> ${edge.targetType}:${edge.targetId} closes a cycle against the real committed graph`;
    }
    confirmed.push(edge);
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Chaos executor: a scripted (non-live) stub. Deterministically fails a step based on the
// content of the job's own title/request (never on call order/counters), which stays correct
// even though many flows run concurrently through the SAME shared executor instance.
// ---------------------------------------------------------------------------------------------
function makeSimExecutor(): StepExecutor {
  // W2/N4: per-exact-title "already failed once" memory for FAIL_ONCE_MARKER — see that const's
  // own doc for why this is safe against the shared-instance concurrency FAIL_MARKER's design
  // note warns about (a single job's own retries are never concurrent with each other).
  const failedOnce = new Set<string>();
  return {
    produce: async (ctx: StepContext) => {
      if (ctx.request.includes(FAIL_MARKER)) throw new Error('chaos-injected-failure');
      if (ctx.request.includes(FAIL_ONCE_MARKER)) {
        if (!failedOnce.has(ctx.request)) {
          failedOnce.add(ctx.request);
          throw new Error('chaos-injected-failure-once');
        }
        return { output: 'ok' };
      }
      const delayMatch = ctx.request.match(LEASE_DELAY_RE);
      if (delayMatch) await sleep(Number(delayMatch[1]));
      return { output: 'ok' };
    },
    review: async () => ({ verdict: 'pass' }),
  };
}

// ---------------------------------------------------------------------------------------------
// Agent-tool call helpers (mirrors agent-tools.spec.ts's own local helpers — same SDK CallToolResult shape).
// ---------------------------------------------------------------------------------------------
interface ToolResult {
  content: [{ type: 'text'; text: string }];
  isError?: boolean;
}

function toolByName(tools: GraphToolDef[], name: string): GraphToolDef {
  const found = tools.find((t) => t.name === name);
  if (!found) throw new Error(`tool ${name} not found`);
  return found;
}

async function call(tools: GraphToolDef[], name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const res = await toolByName(tools, name).handler(args, {});
  return res as unknown as ToolResult;
}

function payload(res: ToolResult): Record<string, unknown> {
  return JSON.parse(res.content[0].text);
}

// ---------------------------------------------------------------------------------------------
// One seed's full run: seed graph -> real dispatch wiring -> chaos + scripted agents -> converge
// -> full seal -> full-history + end-state assertions -> cleanup.
// ---------------------------------------------------------------------------------------------
interface SeedStats {
  chaos: Record<string, number>;
  agent: Record<string, number>;
  illegal: { cycleRejected: boolean; sealedRejected: boolean; terminalWaiterRejected: boolean; unsealCycleOk: boolean };
  convergenceMs: number;
}

async function runSeed(sql: SQL, seed: number): Promise<SeedStats> {
  const rng = mulberry32(seed);
  const prefix = `sim-${seed}-${process.pid}-${Date.now()}`;
  let idSeq = 0;
  const newId = () => `${prefix}-id-${idSeq++}`;

  const stats: SeedStats = {
    chaos: {},
    agent: {},
    illegal: { cycleRejected: false, sealedRejected: false, terminalWaiterRejected: false, unsealCycleOk: false },
    convergenceMs: 0,
  };

  // ---- 1. Seed graph: v1's own shape — 1 product, 3 repos, 1 task, 6 jobs, 4 deps (all via
  // insertDepTx/insertDep, the production write path — A4's fix). Cross-repo chain with one
  // parallel branch (J4 has no deps of its own): J2->J1, J3->J1 (cross-repo), J5->J3 (cross-repo),
  // J6->J4 (cross-repo). All 6 seed jobs are explicitly flow_type='chore' (no decide step) so the
  // BASE shape's timing is simple/predictable — the decide/HITL path is exercised deliberately by
  // chaos/agent-inserted jobs instead (see below).
  const productId = `${prefix}-product`;
  await sql`insert into products (id, name) values (${productId}, ${productId})`;
  const repoIds = [`${prefix}-repo0`, `${prefix}-repo1`, `${prefix}-repo2`];
  for (const r of repoIds) await sql`insert into repos (id, product_id, name, cwd) values (${r}, ${productId}, ${r}, '/tmp')`;
  const taskId = `${prefix}-task`;
  await sql`insert into tasks (id, title, status) values (${taskId}, ${taskId}, 'open')`;

  const jobRepoOf = [repoIds[0]!, repoIds[0]!, repoIds[1]!, repoIds[1]!, repoIds[2]!, repoIds[2]!];
  const seedJobIds = ['J1', 'J2', 'J3', 'J4', 'J5', 'J6'].map((label) => `${prefix}-${label}`);
  for (let i = 0; i < 6; i++) {
    await insertJob(sql, jobRepoOf[i]!, { id: seedJobIds[i]!, taskId, repoId: jobRepoOf[i]!, title: seedJobIds[i]! });
    await sql`update jobs set flow_type = 'chore' where id = ${seedJobIds[i]}`;
  }
  const [j1, j2, j3, j4, j5, j6] = seedJobIds as [string, string, string, string, string, string];
  await insertDep(sql, { id: `${prefix}-d1`, waiterJobId: j2, targetType: 'job', targetId: j1 });
  await insertDep(sql, { id: `${prefix}-d2`, waiterJobId: j3, targetType: 'job', targetId: j1 });
  await insertDep(sql, { id: `${prefix}-d3`, waiterJobId: j5, targetType: 'job', targetId: j3 });
  await insertDep(sql, { id: `${prefix}-d4`, waiterJobId: j6, targetType: 'job', targetId: j4 });

  // Full-population write ledger (A2's "ACL checked by prefix" fix): every job this file ever
  // successfully creates, with the repo it was written under — diffed against the DB in full,
  // not sampled, at the very end.
  const allJobWrites: Array<{ id: string; repoId: string }> = seedJobIds.map((id, i) => ({ id, repoId: jobRepoOf[i]! }));
  const knownJobIds: string[] = [...seedJobIds];
  const failMarkedJobIds = new Set<string>();
  const createdDepsByRepo = new Map<string, string[]>(repoIds.map((r) => [r, [] as string[]]));

  // ---- 2. Real dispatch wiring (A3's fix): dispatch = createRestApi's own runRegisteredJob,
  // obtained via onReconcileDispatch exactly like serve.ts does. deps.executor is the sim's
  // immediate-completion stub — the REAL registry-miss reconstruction path (makeJobFlow,
  // work_items dual-write, generation-CAS completion) runs for real, just fast.
  let dispatch: ((job: ReconcileJob) => Promise<void>) | undefined;
  // W2/N4: leaseTtlMs threaded through BOTH createRestApi (dispatchTask's own inline reconcile +
  // every flow's lease-heartbeat renewal — makeJobFlow's withLeaseHeartbeat closes over THIS
  // instance's leaseTtlMs) and the controller's own reconcileTask calls, so a claim granted from
  // EITHER origin expires on the same short window LEASE_DELAY_MARKER is built to outlive.
  const app = createRestApi(sql, { newId, executor: makeSimExecutor(), onReconcileDispatch: (fn) => { dispatch = fn; }, leaseTtlMs: SIM_LEASE_TTL_MS });
  const controller: GraphController = startGraphController(sql, dispatch!, {
    tickMs: 250,
    leaseTtlMs: SIM_LEASE_TTL_MS,
    stallThresholdMs: SIM_STALL_THRESHOLD_MS, // opens the A6 zombie scan too (not itself asserted — A3 is the required firing)
    onWake: (w) => tally(stats.chaos, `wake:${w.kind}`),
  });

  // Auto-answer loop (HITL replay, job-reconstruction.spec.ts's answerOpenDecision pattern):
  // polls for any OPEN, flow-linked decision belonging to one of THIS task's own jobs and answers
  // 'approve' — agent_wake rows (decisions.flow_id IS NULL) never join `flows` and are correctly
  // left alone (they're the human drawer inbox, not a blocking gate).
  let answering = true;
  const answerLoop = (async () => {
    while (answering) {
      const rows = (await sql`
        select d.id from decisions d join flows f on f.id = d.flow_id
        where d.status = 'open' and f.job_id in (select id from jobs where task_id = ${taskId})
      `) as Array<{ id: string }>;
      for (const row of rows) {
        await app.handle(
          new Request(`http://localhost/api/decisions/${row.id}/answer`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ answer: 'approve' }),
          }),
        );
      }
      await sleep(120);
    }
  })();

  // ---- 3. One real A2A dispatch (work_items<->jobs mirror check needs at least one job that
  // actually went through dispatchTask's OWN dual-write, not the graph-native insertJob path this
  // whole file otherwise uses exclusively). Targets this run's OWN existing task via contextId, so
  // it lands as just another job under the same graph. Must run BEFORE repo0 gets sealed by the
  // illegal-attempts demo below, or insertJob's own SliceSealedError would make the graph write a
  // no-op (dispatchTask's documented "best-effort" fallback) and there'd be no jobs row to mirror.
  await sql`insert into projects (id, name, status) values (${repoIds[0]}, ${repoIds[0]}, 'active') on conflict (id) do nothing`;
  const dispatchRes = await app.handle(
    new Request(`http://localhost/agents/${encodeURIComponent(repoIds[0]!)}/a2a`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `${prefix}-a2a-rpc`,
        method: 'message/send',
        params: {
          message: {
            kind: 'message',
            messageId: `${prefix}-a2a-msg`,
            role: 'user',
            parts: [{ kind: 'text', text: `${prefix} real dispatch chore` }],
            contextId: taskId,
            metadata: { flowType: 'chore' },
          },
        },
      }),
    }),
  );
  const dispatchJobId = ((await dispatchRes.json()) as { result: { id: string } }).result.id;
  knownJobIds.push(dispatchJobId);
  allJobWrites.push({ id: dispatchJobId, repoId: repoIds[0]! });

  // ---- 4. Scripted fake agents (NOT live — deterministic tool-handler calls). Bound to ctx per
  // repo; graph_read is always called first (look-before-you-leap, matching the tool's own
  // ordering rationale) so every write targets a REAL current job id, never a guess.
  const agentTools: GraphToolDef[][] = repoIds.map((repoId) => {
    const ctx: GraphToolContext = { sql, actorRepoId: repoId, taskId, newId };
    return buildGraphTools(ctx);
  });

  // ---- 5. Illegal-attempts demo (once, on repo0): cycle rejection, sealed-slice rejection,
  // unseal->add->reseal, terminal-waiter rejection. Ends with repo0 PERMANENTLY sealed for the
  // rest of this run (by design — mirrors a real repo declaring its slice done mid-task).
  async function runIllegalAttemptsDemo(): Promise<void> {
    const tools = agentTools[0]!;
    const repoId = repoIds[0]!;

    const aRes = await call(tools, JOB_ADD_TOOL, { title: `${prefix}-illegal-a` });
    const bRes = await call(tools, JOB_ADD_TOOL, { title: `${prefix}-illegal-b` });
    expect(aRes.isError).toBeUndefined();
    expect(bRes.isError).toBeUndefined();
    const { jobId: a } = payload(aRes) as { jobId: string };
    const { jobId: b } = payload(bRes) as { jobId: string };
    await sql`update jobs set flow_type = 'chore' where id in (${a}, ${b})`;
    knownJobIds.push(a, b);
    allJobWrites.push({ id: a, repoId }, { id: b, repoId });

    const abRes = await call(tools, DEP_DECLARE_TOOL, { waiterJobId: a, targetType: 'job', targetId: b });
    expect(abRes.isError).toBeUndefined();
    createdDepsByRepo.get(repoId)!.push((payload(abRes) as { depId: string }).depId);

    // Illegal #1: B -> A would close the cycle A -> B -> A.
    const baRes = await call(tools, DEP_DECLARE_TOOL, { waiterJobId: b, targetType: 'job', targetId: a });
    expect(baRes.isError).toBe(true);
    expect(baRes.content[0].text).toContain('DepCycleError');
    stats.illegal.cycleRejected = true;

    // Illegal #2: job_add after sealing this repo's own slice.
    const sealRes = await call(tools, TASK_SEAL_TOOL, {});
    expect(sealRes.isError).toBeUndefined();
    const lateRes = await call(tools, JOB_ADD_TOOL, { title: `${prefix}-illegal-late` });
    expect(lateRes.isError).toBe(true);
    expect(lateRes.content[0].text).toContain('SliceSealedError');
    stats.illegal.sealedRejected = true;

    // unseal -> add (succeeds) -> reseal (repo0 stays sealed for the rest of the run).
    const unsealRes = await call(tools, TASK_UNSEAL_TOOL, {});
    expect(unsealRes.isError).toBeUndefined();
    const reopenedRes = await call(tools, JOB_ADD_TOOL, { title: `${prefix}-illegal-reopened` });
    expect(reopenedRes.isError).toBeUndefined();
    const { jobId: reopened } = payload(reopenedRes) as { jobId: string };
    await sql`update jobs set flow_type = 'chore' where id = ${reopened}`;
    knownJobIds.push(reopened);
    allJobWrites.push({ id: reopened, repoId });
    stats.illegal.unsealCycleOk = true;
    const resealRes = await call(tools, TASK_SEAL_TOOL, {});
    expect(resealRes.isError).toBeUndefined();

    // Illegal #3: dep_declare with an already-terminal waiter (J1 has no deps of its own -> done fast).
    const doneJobId = await waitFor(async () => {
      const rows = (await sql`select id from jobs where task_id = ${taskId} and repo_id = ${repoId} and status = 'done' limit 1`) as Array<{
        id: string;
      }>;
      return rows[0]?.id;
    });
    const terminalDepRes = await call(tools, DEP_DECLARE_TOOL, { waiterJobId: doneJobId, targetType: 'job', targetId: a });
    expect(terminalDepRes.isError).toBe(true);
    expect(terminalDepRes.content[0].text).toContain('WaiterNotWaitingError');
    stats.illegal.terminalWaiterRejected = true;
  }
  await runIllegalAttemptsDemo();

  // ---- 5b. W2/N4 dormant-path arming (harness handoff round-simv2-takeover.md): two one-shot,
  // deterministically-scheduled setups (same "guaranteed, PRNG-decided details" style as the
  // wind-down retry pass below) — left to a pure probability roll across only 30 beats risked a
  // seed where neither ever fires, which the takeover's own >0 assertions can't tolerate.

  // A3 (lease expiry): a job whose produce() call sleeps past the sim's own short leaseTtlMs
  // (SIM_LEASE_TTL_MS, wired into both createRestApi and the controller above) — the controller's
  // next A3 scan (well within the delay window; tickMs=250) genuinely fails it out from under the
  // still-running produce() call, exactly like a crashed worker would.
  async function scheduleLeaseDelayJob(): Promise<void> {
    // repo0 is excluded (matches chaosInfraSeal's own filter below): the illegal-attempts demo
    // just sealed it permanently, so a fresh insertJob under it would throw SliceSealedError.
    const targetRepo = pick(rng, repoIds.filter((r) => r !== repoIds[0]));
    const delayMs = 3000 + Math.floor(rng() * 1000); // 3000-4000ms, PRNG-decided — comfortably outlives SIM_LEASE_TTL_MS
    const jobId = `${prefix}-leasedelay`;
    const title = `${jobId} chaos lease-delay probe ${LEASE_DELAY_MARKER}_${delayMs}`;
    await insertJob(sql, targetRepo, { id: jobId, taskId, repoId: targetRepo, title });
    await sql`update jobs set flow_type = 'chore' where id = ${jobId}`;
    knownJobIds.push(jobId);
    allJobWrites.push({ id: jobId, repoId: targetRepo });
    tally(stats.chaos, 'leaseDelay:scheduled');
  }
  await scheduleLeaseDelayJob();

  // Rule 5 (stale dep): a REAL dep_declare (DEP_DECLARE_TOOL, A4) pinning expectedGen=1 against a
  // target that actually fails once and gets gen++'d for real (bumpJobGeneration, the SAME
  // production function chaosGenBumpFailed below reuses) — closes the loop deterministically:
  // active (gen matches, target still failed@gen1) -> stale (real reconcile eval sees
  // expectedGen=1 != actualGen=2 while the target's back to pending) -> released (FAIL_ONCE_MARKER
  // lets the target actually SUCCEED on its gen2 retry, so the waiter isn't left permanently
  // blocked — see FAIL_ONCE_MARKER's own doc for why that matters). repo0 is avoided for both
  // target and waiter (already permanently sealed by the illegal-attempts demo above — a fresh
  // insertJob under it would just throw SliceSealedError).
  async function runStaleDepDemo(): Promise<void> {
    const targetRepo = repoIds[1]!;
    const waiterAgentIdx = 2;
    const targetId = `${prefix}-staledep-target`;
    const targetTitle = `${targetId} stale-dep target ${FAIL_ONCE_MARKER}`;
    await insertJob(sql, targetRepo, { id: targetId, taskId, repoId: targetRepo, title: targetTitle });
    await sql`update jobs set flow_type = 'chore' where id = ${targetId}`;
    knownJobIds.push(targetId);
    allJobWrites.push({ id: targetId, repoId: targetRepo });

    const tools = agentTools[waiterAgentIdx]!;
    const waiterRepoId = repoIds[waiterAgentIdx]!;
    const waiterRes = await call(tools, JOB_ADD_TOOL, { title: `${prefix}-staledep-waiter` });
    expect(waiterRes.isError).toBeUndefined();
    const { jobId: waiterId } = payload(waiterRes) as { jobId: string };
    await sql`update jobs set flow_type = 'chore' where id = ${waiterId}`;
    knownJobIds.push(waiterId);
    allJobWrites.push({ id: waiterId, repoId: waiterRepoId });

    const depRes = await call(tools, DEP_DECLARE_TOOL, { waiterJobId: waiterId, targetType: 'job', targetId, expectedGen: 1 });
    expect(depRes.isError).toBeUndefined();
    // Deliberately NOT pushed into createdDepsByRepo: the random dep_retract chaos/agent action
    // below only ever picks from that per-repo list, so this dep stays protected from being
    // retracted out from under the demo before the stale transition it exists to prove has a
    // chance to land.
    tally(stats.chaos, 'staleDep:armed');

    await waitFor(async () => {
      const rows = (await sql`select status from jobs where id = ${targetId} and generation = 1`) as Array<{ status: string }>;
      return rows[0]?.status === 'failed' ? true : undefined;
    });
    try {
      await bumpJobGeneration(sql, targetRepo, targetId);
    } catch (err) {
      // Not reachable today (this runs strictly before the beat loop's own chaosGenBumpFailed
      // ever starts rolling), kept defensive/consistent with that function's own try/catch shape.
      tally(stats.chaos, `staleDep:bumpRace:${errName(err)}`);
    }
  }
  await runStaleDepDemo();

  // ---- 6. Chaos scheduler (insertJob incoming / insertDepTx dep / failed gen++ / one mid-run
  // infra seal) + 3 scripted agents (graph_read then job_add/dep_declare/dep_retract), interleaved
  // per beat and run CONCURRENTLY (Promise.all) for genuine race exercise against the real DB.
  let chaosJobSeq = 0;
  let agentJobSeq = 0;

  async function chaosInsertJob(): Promise<void> {
    const targetRepo = pick(rng, repoIds);
    const willFail = failMarkedJobIds.size < 4 && rng() < 0.18;
    const jobId = `${prefix}-chaos-job-${chaosJobSeq++}`;
    const title = `${jobId} chaos incoming` + (willFail ? ` ${FAIL_MARKER}` : '');
    try {
      await insertJob(sql, targetRepo, { id: jobId, taskId, repoId: targetRepo, title });
      knownJobIds.push(jobId);
      allJobWrites.push({ id: jobId, repoId: targetRepo });
      if (willFail) failMarkedJobIds.add(jobId);
      const flowType = rng() < 0.3 ? 'feature' : 'chore';
      await sql`update jobs set flow_type = ${flowType} where id = ${jobId}`;
      tally(stats.chaos, 'insertJob:ok');
    } catch (err) {
      tally(stats.chaos, `insertJob:${errName(err)}`);
    }
  }

  async function chaosInsertDep(): Promise<void> {
    const pendingRows = (await sql`select id from jobs where task_id = ${taskId} and status in ('pending', 'blocked')`) as Array<{ id: string }>;
    if (pendingRows.length === 0) {
      tally(stats.chaos, 'insertDep:noWaiterCandidate');
      return;
    }
    const waiterJobId = pick(rng, pendingRows).id;
    const candidates = knownJobIds.filter((id) => id !== waiterJobId && !failMarkedJobIds.has(id));
    if (candidates.length === 0) {
      tally(stats.chaos, 'insertDep:noTargetCandidate');
      return;
    }
    const targetId = pick(rng, candidates);
    try {
      await insertDep(sql, { id: newId(), waiterJobId, targetType: 'job', targetId });
      tally(stats.chaos, 'insertDep:ok');
    } catch (err) {
      tally(stats.chaos, `insertDep:${errName(err)}`);
    }
  }

  async function chaosGenBumpFailed(): Promise<void> {
    const rows = (await sql`select id, repo_id from jobs where task_id = ${taskId} and status = 'failed'`) as Array<{ id: string; repo_id: string }>;
    if (rows.length === 0) {
      tally(stats.chaos, 'genBump:noFailedJob');
      return;
    }
    const row = pick(rng, rows);
    try {
      await bumpJobGeneration(sql, row.repo_id, row.id);
      tally(stats.chaos, 'genBump:ok');
    } catch (err) {
      tally(stats.chaos, `genBump:${errName(err)}`);
    }
  }

  async function runChaosAction(): Promise<void> {
    const roll = rng();
    if (roll < 0.45) return chaosInsertJob();
    if (roll < 0.8) return chaosInsertDep();
    return chaosGenBumpFailed();
  }

  /**
   * W2/N4: a direct reconcileTask call, run IN PARALLEL with the always-on controller's own tick
   * (Promise.all in the beat loop below) — the exact concurrent-reconcile-pass shape reconcile.ts's
   * own doc comments describe throughout ("dispatchTask's inline call and this always-on
   * controller's tick are NOT mutually exclusive"). Every beat, unconditionally (not gated by the
   * PRNG roll) — the assertion only needs a call COUNT, and the controller's independent 250ms
   * timer already guarantees genuine overlap across the beat loop's ~2-4s wall time regardless.
   */
  async function chaosReconcileRace(): Promise<void> {
    tally(stats.chaos, 'reconcileRace:called');
    try {
      await reconcileTask(sql, taskId, dispatch!, { leaseTtlMs: SIM_LEASE_TTL_MS });
      tally(stats.chaos, 'reconcileRace:ok');
    } catch (err) {
      tally(stats.chaos, `reconcileRace:${errName(err)}`);
    }
  }

  let infraSealedRepo: string | undefined;
  async function chaosInfraSeal(): Promise<void> {
    const candidates = repoIds.filter((r) => r !== repoIds[0]); // repo0 already sealed by the illegal-attempts demo
    const target = pick(rng, candidates);
    try {
      const derived = await sealTaskSliceAndDerive(sql, target, { taskId, repoId: target });
      infraSealedRepo = target;
      tally(stats.chaos, `infraSeal:ok(${derived})`);
    } catch (err) {
      tally(stats.chaos, `infraSeal:${errName(err)}`);
    }
  }

  async function runAgentAction(agentIdx: number): Promise<void> {
    const tools = agentTools[agentIdx]!;
    const repoId = repoIds[agentIdx]!;
    const readRes = await call(tools, GRAPH_READ_TOOL, {});
    if (readRes.isError) {
      tally(stats.agent, 'graph_read:error');
      return;
    }
    const { jobs } = payload(readRes) as { jobs: Array<{ id: string; mine: boolean; status: string }> };
    const myWaitable = jobs.filter((j) => j.mine && (j.status === 'pending' || j.status === 'blocked'));
    const roll = rng();
    if (roll < 0.45) {
      const willFail = failMarkedJobIds.size < 4 && rng() < 0.1;
      const jobLabel = `${prefix}-agent${agentIdx}-job-${agentJobSeq++}`;
      const title = `${jobLabel} agent job` + (willFail ? ` ${FAIL_MARKER}` : '');
      const res = await call(tools, JOB_ADD_TOOL, { title });
      if (res.isError) {
        tally(stats.agent, `job_add:${errClass(res.content[0].text)}`);
        return;
      }
      const { jobId } = payload(res) as { jobId: string };
      knownJobIds.push(jobId);
      allJobWrites.push({ id: jobId, repoId });
      if (willFail) failMarkedJobIds.add(jobId);
      const flowType = rng() < 0.3 ? 'feature' : 'chore';
      await sql`update jobs set flow_type = ${flowType} where id = ${jobId}`;
      tally(stats.agent, 'job_add:ok');
    } else if (roll < 0.8) {
      if (myWaitable.length === 0) {
        tally(stats.agent, 'dep_declare:noWaiter');
        return;
      }
      const waiterJobId = pick(rng, myWaitable).id;
      const candidates = knownJobIds.filter((id) => id !== waiterJobId && !failMarkedJobIds.has(id));
      if (candidates.length === 0) {
        tally(stats.agent, 'dep_declare:noTarget');
        return;
      }
      const targetId = pick(rng, candidates);
      const res = await call(tools, DEP_DECLARE_TOOL, { waiterJobId, targetType: 'job', targetId });
      if (res.isError) {
        tally(stats.agent, `dep_declare:${errClass(res.content[0].text)}`);
        return;
      }
      createdDepsByRepo.get(repoId)!.push((payload(res) as { depId: string }).depId);
      tally(stats.agent, 'dep_declare:ok');
    } else {
      const owned = createdDepsByRepo.get(repoId)!;
      if (owned.length === 0) {
        tally(stats.agent, 'dep_retract:none');
        return;
      }
      const idx = Math.floor(rng() * owned.length);
      const depId = owned.splice(idx, 1)[0]!;
      const res = await call(tools, DEP_RETRACT_TOOL, { depId });
      tally(stats.agent, res.isError ? `dep_retract:${errClass(res.content[0].text)}` : 'dep_retract:ok');
    }
  }

  const BEATS = 30;
  const midpoint = Math.floor(BEATS / 2);
  for (let beat = 0; beat < BEATS; beat++) {
    const agentIdx = Math.floor(rng() * 3);
    await Promise.all([runChaosAction(), runAgentAction(agentIdx), chaosReconcileRace()]);
    if (beat === midpoint) await chaosInfraSeal();
    await sleep(60 + Math.floor(rng() * 90));
  }

  // ---- 7. Wind-down: one guaranteed (non-PRNG) retry pass over whatever's currently failed —
  // FAIL_MARKER jobs are deterministically excluded from ever being a dep TARGET (both in chaos
  // and agent dep_declare above), so no job can be permanently blocked waiting on one; this pass
  // just guarantees liveness for convergence regardless of how the PRNG happened to roll.
  const stillFailed = (await sql`select id, repo_id from jobs where task_id = ${taskId} and status = 'failed'`) as Array<{
    id: string;
    repo_id: string;
  }>;
  for (const j of stillFailed) {
    try {
      await bumpJobGeneration(sql, j.repo_id, j.id);
    } catch {
      // already retried or task raced terminal — harmless, wind-down is best-effort liveness only.
    }
  }

  const convergeStart = Date.now();
  await waitFor(async () => {
    const rows = (await sql`select 1 from jobs where task_id = ${taskId} and status in ('running', 'ready')`) as unknown[];
    return rows.length === 0 ? true : undefined;
  }, 30000);
  stats.convergenceMs = Date.now() - convergeStart;

  // ---- 8. Full seal to force task resolution (repo0 sealed by the illegal-attempts demo, one
  // other repo possibly already sealed by chaosInfraSeal — sealTaskSliceAndDerive's own
  // `on conflict do nothing` makes re-sealing an already-sealed repo a harmless no-op AT THE
  // INSERT LEVEL, but that insert is never reached if the task already went terminal from an
  // EARLIER iteration of THIS SAME loop: this loop's own iteration order is fixed (repoIds'
  // order), so whichever repo's seal happens to be the one that completes the "every participating
  // repo sealed" set flips the task non-open THAT iteration — a LATER iteration for a repo that was
  // already sealed (by chaosInfraSeal, mid-run) re-enters sealTaskSliceAndDerive only to hit its
  // own task-terminal guard first. Expected and harmless (that repo's seal already exists either
  // way) — caught by class, not swallowed blanket, so a genuine WriteAclError would still surface.
  for (const r of repoIds) {
    try {
      await sealTaskSliceAndDerive(sql, r, { taskId, repoId: r });
    } catch (err) {
      if (!(err instanceof TerminalTaskError)) throw err;
      tally(stats.chaos, 'fullSeal:alreadyTerminal');
    }
  }
  await waitFor(async () => {
    const rows = (await sql`select status from tasks where id = ${taskId}`) as Array<{ status: string }>;
    return rows[0]!.status !== 'open' ? true : undefined;
  });

  answering = false;
  await answerLoop;
  // F4 (3자 리뷰 수정 라운드): controller.stop() now itself awaits whatever tick is currently in
  // flight before resolving — the extra sleep(300) that used to paper over an in-flight tick still
  // running past stop() is no longer needed (and was the root cause of this file's own cross-seed
  // contamination: a straggler tick from THIS seed's controller reconciling into the NEXT seed's
  // freshly-created task via a GLOBAL, unscoped scan).
  await controller.stop();

  // ---- 9. Assertions -------------------------------------------------------------------------

  // A2: full-history terminal-status monotonicity + dep-release latch (never regress).
  expect(await findTerminalRegressions(sql, taskId)).toEqual([]);
  expect(await findDepLatchRegressions(sql, taskId)).toEqual([]);

  // A2 (cycle, production code path) — global scope, by design (loadTaskGraph's own contract).
  expect(await findCycleViolation(sql)).toBeUndefined();

  // A2 (ACL, full population — not a prefix sample): every job this file ever wrote successfully
  // lands under EXACTLY the repo it was written for, and nothing else exists beyond that ledger.
  const finalJobRows = (await sql`select id, repo_id from jobs where task_id = ${taskId}`) as Array<{ id: string; repo_id: string }>;
  const finalRepoById = new Map(finalJobRows.map((r) => [r.id, r.repo_id]));
  expect(finalJobRows.length).toBe(allJobWrites.length);
  for (const w of allJobWrites) {
    expect(finalRepoById.get(w.id)).toBe(w.repoId);
  }

  // A1: rule 2 (seal-freeze) + rule 9 (terminal task immutable) — both audit-based, full history.
  expect(await findSealFreezeViolations(sql, taskId)).toEqual([]);
  expect(await findPostTerminalWrites(sql, taskId)).toEqual([]);

  // A1: dangling dep_member targets (positive full-population sanity) + dep/predicate evaluation
  // consistency (recomputed via the SAME pure functions reconcile.ts itself uses).
  expect(await findDanglingJobTargets(sql, taskId)).toEqual([]);
  expect(await findDepEvaluationMismatches(sql, taskId)).toEqual([]);

  // A1: task derivation — recomputed via deriveTaskStatus AND re-confirmed via the real
  // rederiveTask (graph/store.ts), both agreeing with tasks.status.
  const derivation = await checkTaskDerivation(sql, taskId);
  expect(derivation.actual).toBe(derivation.expected);
  expect(derivation.rederived).toBe(derivation.actual);
  expect(['done', 'failed']).toContain(derivation.actual); // never left 'open' — full seal + all-terminal guarantees a resolution

  // A3: work_items<->jobs mirror, now checkable because dispatch is the real path (registered
  // closure branch, for the one dispatchTask-created job specifically).
  const workItemRow = ((await sql`select state from work_items where id = ${dispatchJobId}`) as Array<{ state: string }>)[0];
  const dispatchJobRow = ((await sql`select status from jobs where id = ${dispatchJobId}`) as Array<{ status: string }>)[0]!;
  expect(workItemRow).toBeDefined();
  expect(workItemRow!.state).toBe(dispatchJobRow.status === 'done' ? 'done' : 'blocked');

  // Illegal-attempts demo actually exercised every rejection path + the unseal/reseal cycle.
  expect(stats.illegal).toEqual({ cycleRejected: true, sealedRejected: true, terminalWaiterRejected: true, unsealCycleOk: true });

  void infraSealedRepo; // recorded for the report; not itself a separate assertion target

  // W2/N4 (harness handoff round-simv2-takeover.md): the three dormant paths actually fired —
  // not just "no invariant violation", but a genuine firing count > 0 each. Full-history invariants
  // above (findTerminalRegressions/findDepLatchRegressions/etc.) already re-ran against everything
  // these paths touched, so a >0 firing count here is proof the CAS/rule-5/A3 machinery ran for
  // real and still held, not proof-by-absence-of-chaos.
  expect(stats.chaos['reconcileRace:called'] ?? 0).toBeGreaterThan(0); // concurrent reconcile passes vs. the controller's own tick
  expect(stats.chaos['wake:lease_expired'] ?? 0).toBeGreaterThan(0); // A3: a real lease lapsed mid-produce()

  const staleDepAuditRows = (await sql`
    select count(*)::int as c from bw_sim_audit where entity = 'dep' and task_id = ${taskId} and new_status = 'stale'
  `) as Array<{ c: number }>;
  stats.chaos['staleDep:transitions'] = staleDepAuditRows[0]!.c; // joins the same per-seed report line as every other chaos stat
  expect(stats.chaos['staleDep:transitions']).toBeGreaterThan(0); // rule 5: expectedGen=1 vs. the real post-bump generation, actually observed

  // ---- 10. Cleanup (this seed's own rows only — FK-reverse order) ----------------------------
  await sql`delete from decisions where request_type = 'agent_wake' and meta->>'taskId' = ${taskId}`;
  await sql`delete from decisions where flow_id in (select id from flows where job_id in (select id from jobs where task_id = ${taskId}))`;
  await sql`delete from step_runs where flow_id in (select id from flows where job_id in (select id from jobs where task_id = ${taskId}))`;
  await sql`delete from flows where job_id in (select id from jobs where task_id = ${taskId})`;
  await sql`delete from dep_members where dep_id in (select id from deps where waiter_job in (select id from jobs where task_id = ${taskId}))`;
  await sql`delete from deps where waiter_job in (select id from jobs where task_id = ${taskId})`;
  await sql`delete from work_items where id in (select id from jobs where task_id = ${taskId})`;
  await sql`delete from task_seals where task_id = ${taskId}`;
  await sql`delete from job_events where job_id in (select id from jobs where task_id = ${taskId})`;
  await sql`delete from jobs where task_id = ${taskId}`;
  await sql`delete from tasks where id = ${taskId}`;
  for (const r of repoIds) await sql`delete from repos where id = ${r}`;
  await sql`delete from products where id = ${productId}`;
  await sql`delete from projects where id = ${repoIds[0]}`;
  await sql`delete from a2a_inbox where message_id = ${`${prefix}-a2a-msg`}`;

  return stats;
}

/**
 * W1 (harness handoff round-simv2-takeover.md): this sim must NEVER touch the dev DB — a chaos run
 * that crashed mid-way used to leave leftover rows/audit tables in `blazewrit` (the same DB every
 * other integration spec's BW_PG_URL default points at). Ensures its own dedicated `blazewrit_sim`
 * database exists (idempotent — `create database` has no `if not exists` clause in Postgres) via a
 * throwaway admin connection to the SAME server's `postgres` maintenance DB, derived from
 * BW_SIM_PG_URL itself so an overridden URL still targets the right host/port instead of a
 * hardcoded one. Catches ONLY `42P04` (duplicate_database, Postgres's real error code for "already
 * exists") — anything else (bad credentials, unreachable host) rethrows instead of masking a setup
 * failure as "must already exist".
 */
async function ensureSimDatabase(simUrl: string): Promise<void> {
  const target = new URL(simUrl);
  const dbName = target.pathname.replace(/^\//, '');
  const adminUrl = new URL(simUrl);
  adminUrl.pathname = '/postgres';
  const adminSql = new SQL(adminUrl.toString());
  try {
    await adminSql.unsafe(`create database "${dbName}"`);
  } catch (err) {
    if ((err as { errno?: string }).errno !== '42P04') throw err;
  } finally {
    await adminSql.end();
  }
}

// ---------------------------------------------------------------------------------------------
// Suite wiring (BW_SIM=1 gated — mirrors orchestrator/infra/pg-store.spec.ts's BW_PG_URL gate).
// dev-DB isolation (W1): BW_SIM_PG_URL, NOT BW_PG_URL — a dedicated blazewrit_sim database, never
// the shared dev DB every other integration spec's BW_PG_URL default points at.
// ---------------------------------------------------------------------------------------------
const BW_SIM_PG_URL = process.env.BW_SIM_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit_sim';

suite('graph chaos integration sim (harness v2 — env-gated, mulberry32-seeded, full-history audit)', () => {
  let sql: SQL;

  beforeAll(async () => {
    await ensureSimDatabase(BW_SIM_PG_URL);
    sql = new SQL(BW_SIM_PG_URL);
    await ensureSchema(sql);
    await setupAudit(sql);
  });

  afterAll(async () => {
    await teardownAudit(sql);
    await sql.end();
  });

  for (const seed of SEEDS) {
    test(
      `seed ${seed}: chaos + scripted agents converge to a fully-consistent terminal graph`,
      async () => {
        const stats = await runSeed(sql, seed);
        // eslint-disable-next-line no-console
        console.log(`[graph-chaos.sim seed=${seed}] convergence=${stats.convergenceMs}ms chaos=${JSON.stringify(stats.chaos)} agent=${JSON.stringify(stats.agent)}`);
      },
      150_000,
    );
  }
});
