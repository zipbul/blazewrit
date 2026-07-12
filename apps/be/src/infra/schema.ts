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
}
