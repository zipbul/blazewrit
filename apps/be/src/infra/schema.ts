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
  await sql`create table if not exists flows (
    id text primary key,
    work_item_id text,
    flow_type text not null,
    status text not null,
    current_step text not null,
    created_at timestamptz not null default now()
  )`;
  await sql`create table if not exists step_runs (
    id text primary key,
    flow_id text not null references flows(id),
    step_name text not null,
    role text not null,
    attempt_no integer not null,
    status text not null,
    verdict text,
    started_at timestamptz not null default now(),
    ended_at timestamptz
  )`;
  await sql`create table if not exists learnings (
    id text primary key,
    flow_id text,
    project_id text,
    text text not null,
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
}
