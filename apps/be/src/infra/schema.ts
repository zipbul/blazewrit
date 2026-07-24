import type { SQL } from 'bun';

/**
 * Idempotent schema bootstrap. Runs on every boot so the DB is reproducible without a
 * separate migration tool. All statements are create/alter-if-not-exists, so re-running
 * is a no-op against an existing database.
 *
 * Projects are first-class (not derived from work_items) so the meta agent can PROPOSE a
 * project before any work exists: a `proposed` project shows as a ghost hearth until the
 * user approves it (→ `active`). Relationships are the inter-project edges on the canvas,
 * likewise proposed-then-confirmed.
 */
export async function ensureSchema(sql: SQL): Promise<void> {
  await sql`create table if not exists work_items (
    id text primary key,
    project_id text not null,
    type text not null,
    state text not null,
    title text,
    created_at timestamptz not null default now()
  )`;
  // context_id correlates the cross-project realizations of ONE user intent (A2A contextId).
  await sql`alter table work_items add column if not exists context_id text`;
  await sql`create table if not exists flows (
    id text primary key,
    work_item_id text,
    flow_type text not null,
    status text not null,
    current_step text not null,
    assemble_session_id text,
    created_at timestamptz not null default now()
  )`;
  await sql`alter table flows add column if not exists assemble_session_id text`;
  // Correlated to jobs(id) like work_item_id, but no FK: harness/job-graph.md migration step 4 —
  // dual-write only, jobs rows aren't guaranteed to exist for every job_id yet (see rest.ts).
  await sql`alter table flows add column if not exists job_id text`;
  await sql`create table if not exists step_runs (
    id text primary key,
    flow_id text not null references flows(id),
    step_name text not null,
    role text not null,
    attempt_no integer not null,
    status text not null,
    verdict text,
    session_id text,
    started_at timestamptz not null default now(),
    ended_at timestamptz
  )`;
  await sql`alter table step_runs add column if not exists session_id text`;
  await sql`create table if not exists learnings (
    id text primary key,
    flow_id text,
    project_id text,
    text text not null,
    created_at timestamptz not null default now()
  )`;
  // 똘이 conversation memory: conversation = data (no SDK sessions). scope = 'central' | work_item id.
  // seq is the ordering tiebreaker (created_at alone is not); client_msg_id anchors idempotent FE retry;
  // status 'failed' + redacted_at rows are hidden from the agent-visible view (bw_v_chat).
  await sql`create table if not exists chat_messages (
    seq bigserial primary key,
    scope text not null,
    role text not null,
    text text not null,
    payload jsonb,
    client_msg_id text,
    status text not null default 'answered',
    redacted_at timestamptz,
    created_at timestamptz not null default now(),
    unique (scope, client_msg_id)
  )`;
  await sql`create index if not exists chat_messages_scope_seq on chat_messages (scope, seq)`;
  await sql`create table if not exists agent_feedback (
    id text primary key,
    category text not null,
    content text not null,
    request text,
    status text not null default 'open',
    created_at timestamptz not null default now()
  )`;
  await sql`create table if not exists decisions (
    id text primary key,
    flow_id text,
    status text not null,
    request_type text not null,
    question text not null,
    options jsonb not null default '[]'::jsonb,
    answer text,
    created_at timestamptz not null default now(),
    answered_at timestamptz
  )`;
  // meta carries proposal payloads (requesting agent, proposed project/repo, edge endpoints).
  await sql`alter table decisions add column if not exists meta jsonb not null default '{}'::jsonb`;

  // First-class projects: status 'proposed' (awaiting user approval) | 'active'.
  await sql`create table if not exists projects (
    id text primary key,
    name text not null,
    repo_path text,
    status text not null default 'active',
    created_at timestamptz not null default now()
  )`;
  // A2A Agent Card (domain layer): per-project skills/description; common base merged in code.
  await sql`alter table projects add column if not exists card jsonb not null default '{}'::jsonb`;
  // Inter-project edges: status 'proposed' (agent-suggested) | 'confirmed'.
  await sql`create table if not exists relationships (
    id text primary key,
    from_project text not null,
    to_project text not null,
    type text not null default 'depends',
    status text not null default 'proposed',
    created_at timestamptz not null default now()
  )`;

  // Backfill: register any project that already exists only via work_items as an active project.
  await sql`insert into projects (id, name, status)
    select distinct project_id, project_id, 'active' from work_items
    on conflict (id) do nothing`;

  // Job graph layer (harness/job-graph.md) — additive; legacy write paths untouched.
  await sql`create table if not exists products (
    id text primary key,
    name text not null,
    created_at timestamptz not null default now()
  )`;
  await sql`create table if not exists repos (
    id text primary key,
    product_id text not null references products(id),
    name text not null,
    git_url text,
    cwd text not null,
    parent_repo_id text references repos(id),
    card jsonb not null default '{}',
    created_at timestamptz not null default now()
  )`;
  // 단일 기록자 통합 Phase 3 (job-graph.md P4/P5): per-repo autonomy toggle, replacing the process-wide
  // env var this codebase used to gate wake sessions on — a project's decision to let wake sessions
  // run autonomously is now DB state (read fresh per wake, per repo — graph/wake-consumer.ts), not a
  // boot-time-only, all-or-nothing env flag. Defaults to false (the same safe-by-default the env
  // var's own truthiness check gave).
  await sql`alter table repos add column if not exists autonomy boolean not null default false`;
  await sql`create table if not exists tasks (
    id text primary key,
    title text not null,
    description text,
    status text not null check (status in ('open', 'done', 'failed', 'cancelled')),
    created_at timestamptz not null default now()
  )`;
  await sql`create table if not exists task_seals (
    task_id text not null references tasks(id),
    repo_id text not null references repos(id),
    sealed_at timestamptz not null default now(),
    primary key (task_id, repo_id)
  )`;
  await sql`create table if not exists jobs (
    id text primary key,
    task_id text not null references tasks(id),
    repo_id text not null references repos(id),
    title text not null,
    description text,
    status text not null check (status in
      ('pending', 'ready', 'running', 'blocked', 'done', 'failed', 'cancelled')),
    generation int not null default 1,
    created_at timestamptz not null default now()
  )`;
  // P2 physical operations columns (harness/job-graph.md "물리(작음, 유지): 실행 lease/heartbeat
  // (워커 crash 감지)" — these are NOT model primitives, the frozen 8-table schema's exception is
  // explicitly for exactly this). lease_expires_at: set at claim (ready→running), renewed on every
  // step transition (heartbeat), cleared on any terminal write — a running job whose lease lapses
  // got no heartbeat, so nothing is still executing it. status_changed_at: every status-changing
  // write touches this; round 2's stall detection (rule 4) reads it as "time since last transition".
  await sql`alter table jobs add column if not exists lease_expires_at timestamptz`;
  await sql`alter table jobs add column if not exists status_changed_at timestamptz not null default now()`;
  // P4-2b 후속 (Fable+Codex 3자 리뷰): the HUMAN-APPROVED flowType (A2A metadata, dispatchTask's
  // own carriedFlowType) was never durable on the graph side — a registry-miss reconstruction
  // (rest.ts's runRegisteredJob) had no choice but to re-derive it from the title via
  // StubFlowClassifier, which can genuinely diverge from what was actually approved (a different
  // step sequence, an unwanted HITL pause). Nullable on purpose: only dispatchTask's own jobs ever
  // get one written (see rest.ts) — A2A-accept/job_add jobs (insertJobTx) never had an approved
  // flowType to begin with, so null there is correct, not a gap; reconstruction falls back to
  // classify(title) exactly as before whenever this is null.
  await sql`alter table jobs add column if not exists flow_type text`;
  await sql`create table if not exists deps (
    id text primary key,
    waiter_job text not null references jobs(id),
    predicate text not null default 'all' check (predicate in ('all', 'any')),
    status text not null default 'active' check (status in ('active', 'released', 'stale'))
  )`;
  await sql`create table if not exists dep_members (
    dep_id text not null references deps(id),
    target_type text not null check (target_type in ('job', 'task', 'external')),
    target_id text not null,
    expected_gen int,
    outcome text not null default 'pending'
      check (outcome in ('pending', 'satisfied', 'failed', 'cancelled')),
    acceptable text[] not null default '{satisfied}',
    primary key (dep_id, target_type, target_id)
  )`;
  await sql`create table if not exists external_gates (
    id text primary key,
    task_id text not null references tasks(id),
    kind text not null,
    description text,
    status text not null default 'pending' check (status in ('pending', 'fired')),
    created_at timestamptz not null default now()
  )`;
  // A2A transport idempotency (harness/job-graph.md P3 migration 10, rule 8): message.messageId
  // (A2A spec field, required on every inbound message) is the physical dedup key — a replayed
  // messageId (network retry, at-least-once redelivery) returns this stored response verbatim
  // instead of re-running the handler. No project scoping: messageId is client-generated and
  // meant to be globally unique per the A2A spec.
  await sql`create table if not exists a2a_inbox (
    message_id text primary key,
    response jsonb not null,
    created_at timestamptz not null default now()
  )`;
  // A2A negotiation (harness/job-graph.md P3 migration 11, rule 8): one round-trip, request ->
  // (accept | counter) — no FSM, a counter is just a direction-reversed new request. `ask` carries
  // WHAT is being asked for (job/dep/gate) as a plain object (jsonb — see a2a_inbox's own note on
  // double-encoding, same trap). Materialize only ever happens on accept, in one DB transaction;
  // request/counter only ever write this table.
  await sql`create table if not exists a2a_proposals (
    id text primary key,
    task_id text not null references tasks(id),
    from_repo text not null,
    to_repo text not null,
    kind text not null check (kind in ('request', 'counter')),
    ask jsonb not null,
    status text not null default 'proposed' check (status in ('proposed', 'accepted', 'countered', 'rejected')),
    created_at timestamptz not null default now()
  )`;

  // 단일 기록자 통합 Phase 1 (job-graph.md C1): append-only execution facts. Execution
  // (api/rest.ts's makeJobFlow) inserts one of these instead of writing jobs/work_items status
  // directly — graph/reconcile.ts's consumeJobEvents is the only thing that ever turns a row here
  // into a jobs.status write, making reconcile the sole state-machine writer again. The PK is the
  // whole idempotency story: a late-arriving duplicate report of the SAME (job, generation, kind)
  // fact is a safe `on conflict do nothing`, which is what lets the completion-write CAS/generation
  // guards that used to live in rest.ts disappear — there is no longer a write there for a stale
  // report to race against. `processed_at` marks consumption (null = still pending); it does NOT
  // gate re-processing on its own (consumeJobEvents' own `processed_at is null` filter does that).
  await sql`create table if not exists job_events (
    job_id text not null references jobs(id),
    generation int not null,
    kind text not null check (kind in ('succeeded', 'failed', 'rerun_requested')),
    created_at timestamptz not null default now(),
    processed_at timestamptz,
    primary key (job_id, generation, kind)
  )`;
  // R2 (3자 리뷰 수정 라운드, Codex 재검증): the unique index below rejects any EXISTING conflicting
  // pair outright — a database that already holds both a 'succeeded' and a 'failed' row for the
  // same (job, generation) (from before this round, or from a bug this round is closing) would make
  // the CREATE UNIQUE INDEX itself fail at boot, taking ensureSchema (and the whole boot) down with
  // it. Deterministic pre-cleanup, run every boot (idempotent — a no-op once no conflicts remain):
  // keep the EARLIER `created_at` (whichever actually happened first is the real outcome); on an
  // exact tie, keep 'failed' (a conservative default — a rerun is always possible from 'failed', not
  // from a wrongly-kept 'succeeded'). Scoped to only ('succeeded','failed') pairs, matching the
  // index's own predicate — 'rerun_requested' rows are never touched.
  await sql`
    delete from job_events a
    using job_events b
    where a.job_id = b.job_id
      and a.generation = b.generation
      and a.kind in ('succeeded', 'failed')
      and b.kind in ('succeeded', 'failed')
      and a.kind <> b.kind
      and (a.created_at > b.created_at or (a.created_at = b.created_at and a.kind = 'succeeded'))
  `;
  // F5 (3자 리뷰 수정 라운드): the PK alone allows BOTH a 'succeeded' and a 'failed' row to coexist
  // for the same (job, generation) — two different kinds are two different PK values, so `on
  // conflict do nothing` never catches that combination. Today's only producer (recordJobOutcome)
  // ever writes exactly one kind per generation, so this never fires in practice — but the schema
  // itself allowed a non-deterministic outcome (which kind "wins" would depend on read order) for
  // any future/buggy caller that raced both. This closes it structurally: one terminal outcome per
  // (job, generation), full stop — a second kind's insert hits this index instead and is absorbed
  // by the SAME `on conflict do nothing`, the first-committed kind deterministically winning.
  await sql`create unique index if not exists job_events_one_terminal on job_events (job_id, generation) where kind in ('succeeded', 'failed')`;

  // Backfill (harness/job-graph.md migration step 2): mirror projects → repos 1:1, with a
  // single placeholder product for repos that don't belong to one yet. Read-verification
  // only — the legacy write paths (projects/work_items) are untouched by this backfill.
  //
  // (a) cwd falls back to '.' (the current process cwd) when repo_path is unset. That is an
  // honest description of today's reality — the executor runs pinned to one process-wide cwd
  // — not a real per-repo cwd. repos.cwd only becomes the source of truth once dispatch
  // wiring (P1 remainder) resolves cwd per repo_id.
  // (b) This backfill only runs at boot, so a project registered while the server is already
  // running has no repos mirror until the next boot. Continuous mirroring (dual-write) is a
  // later migration step, not this one.
  await sql`insert into products (id, name) values ('legacy', 'legacy') on conflict (id) do nothing`;
  await sql`insert into repos (id, product_id, name, cwd)
    select p.id, 'legacy', p.name, coalesce(nullif(p.repo_path, ''), '.')
    from projects p
    on conflict (id) do nothing`;
  // Self-heal (3자 리뷰 수정 C4, Grok F14): the insert above is `on conflict (id) do nothing` — a
  // project registered before its repo_path was ever set gets mirrored with cwd='.' on the FIRST
  // boot, and setting repo_path afterward never reaches the mirror again (the insert is a no-op
  // every later boot). resolveRepoCwd would then keep running that repo's jobs against '.' (the
  // wrong checkout) forever, even though the real cwd is now known. Only fires when the mirror's
  // cwd is STILL '.' (the "not configured yet" signal) — a manually-set cwd (anything else) is
  // never touched, same protection the "does not overwrite" test above already covers for inserts.
  await sql`update repos set cwd = nullif(p.repo_path, '')
    from projects p
    where repos.id = p.id and repos.cwd = '.' and coalesce(nullif(p.repo_path, ''), '') <> ''`;

  // Backfill (harness/job-graph.md migration step 3): mirror work_items → tasks/jobs. A task's
  // id is the context_id anchor (coalesce(context_id, id)) — work_items that share one
  // context_id (one intent's cross-project realizations) collapse into a single task with one
  // job per work_item, which is the first place "tasks span repos" becomes true in data, not
  // just in the design doc. Read-verification only — /api/work-items keeps reading work_items
  // directly; this mirror isn't consumed anywhere yet.
  //
  // Mirror tasks stay 'open' regardless of the underlying work_item state: this legacy data
  // predates task_seals, so no repo has ever sealed its slice, and marking the mirror 'done'
  // would trip rule 9's terminal latch (harness/job-graph.md rule 9) and block future jobs
  // from landing under the same context.
  await sql`insert into tasks (id, title, status)
    select coalesce(w.context_id, w.id), coalesce(min(w.title), coalesce(w.context_id, w.id)), 'open'
    from work_items w
    group by coalesce(w.context_id, w.id)
    on conflict (id) do nothing`;

  // legacy_work_item_id anchors the job mirror back to its source row (harness/job-graph.md
  // migration step 3, "jobs.legacy_work_item_id"). repo_id = project_id, which the repos
  // backfill above guarantees exists by the time this insert runs.
  await sql`alter table jobs add column if not exists legacy_work_item_id text`;
  // 3자 리뷰 수정 E4 (Fable M4): the REAL job-creation write path (graph/store.ts's insertJob)
  // rejects a new job under a terminal task with TerminalTaskError (rule 9) — this raw backfill
  // INSERT used to have no such filter, so it could resurrect a brand-new mirror job under a task
  // that's already closed to further writes (another repo already sealed and completed that task
  // out from under this work_item's own project). `join tasks` on the SAME anchor id the tasks
  // upsert above just wrote/confirmed, filtered to 'open', closes that hole without touching a
  // work_item whose anchor task is (as almost all of them are) still open.
  await sql`insert into jobs (id, task_id, repo_id, title, status, generation, legacy_work_item_id, created_at)
    select w.id, coalesce(w.context_id, w.id), w.project_id, coalesce(w.title, w.id),
      case w.state
        when 'in_flow' then 'running'
        when 'done' then 'done'
        when 'blocked' then 'failed'
        else 'pending'
      end,
      1, w.id, w.created_at
    from work_items w
    join tasks t on t.id = coalesce(w.context_id, w.id)
    where t.status = 'open'
    on conflict (id) do nothing`;
  // Self-heal (harness/job-graph.md migration step 5): rows mirrored by an earlier boot (before
  // created_at was added to the insert above) got created_at = that boot's `now()` default
  // instead of the source work_item's real created_at. /api/work-items now sorts and displays
  // jobs.created_at directly, so a stale mirror timestamp would visibly reorder/misdate legacy
  // rows. Idempotent — a no-op once every mirrored row matches its source.
  await sql`update jobs set created_at = w.created_at
    from work_items w
    where jobs.legacy_work_item_id = w.id and jobs.created_at <> w.created_at`;

  // Self-heal (3자 리뷰 수정 B2-2, Codex major #22): the mirror INSERT above is `on conflict (id)
  // do nothing` — it only ever WRITES a job on the boot that first sees a given work_item, mapping
  // whatever state that work_item held AT THAT MOMENT. A work_item still 'in_flow' at that boot
  // (mirrored 'running') that only reaches done/blocked LATER (a rollout-window race — the work
  // predates this backfill layer, so no live dispatch completion write ever revisits this specific
  // row again) would otherwise stay mirrored 'running' forever. Scoped to legacy_work_item_id
  // rows only (a live dispatch's own job has that column NULL, so it's untouched here — this is
  // backfill self-correction, not a second completion-write path) and only fires when the
  // mirror's status is still non-terminal, so it's idempotent and never clobbers a job a live
  // reconcile/dispatch path has already moved on from.
  //
  // `jobs.generation = 1` (3자 리뷰 수정 E5, Fable M5): the legacy work_item row is NEVER revisited
  // once its state is set (no live write path routes a re-run back through it), so it can only
  // ever describe generation 1's outcome. bumpJobGeneration (graph/store.ts) can gen++ this same
  // mirror row to a fresh pending re-run slot (generation 2+), entirely independent of the
  // work_item — without this guard, the very next boot would read the still-terminal work_item and
  // slam that brand-new re-run slot straight back to done/failed before it ever got claimed, a
  // regression of the same "once moved on, never revert" principle every other self-heal here
  // already respects.
  await sql`update jobs set
      status = case w.state when 'done' then 'done' when 'blocked' then 'failed' else jobs.status end,
      status_changed_at = now(), lease_expires_at = null
    from work_items w
    where jobs.legacy_work_item_id = w.id
      and w.state in ('done', 'blocked')
      and jobs.status not in ('done', 'failed', 'cancelled')
      and jobs.generation = 1`;
}
