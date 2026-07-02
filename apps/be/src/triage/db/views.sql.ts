import type { SQL } from 'bun';
import { READ_VIEWS, READ_ROLE } from './views.contract';

/**
 * The view bodies. Keyed by view name so they stay aligned with `views.contract.ts`
 * (a startup check asserts the two sets match). Base tables are NEVER granted to the read
 * role — only these views are, so the agent can only ever see these projections.
 */
const VIEW_BODIES: Record<string, string> = {
  bw_v_projects: `
    select p.id, p.name, p.status,
           coalesce(f.active_flows, 0)::int as active_flows,
           p.created_at
    from projects p
    left join (
      select w.project_id, count(*) as active_flows
      from flows fl
      join work_items w on w.id = fl.work_item_id
      where fl.status not in ('completed', 'abandoned')
      group by w.project_id
    ) f on f.project_id = p.id`,
  bw_v_relationships: `
    select id, from_project, to_project, type, status from relationships`,
  bw_v_work_items: `
    select id, project_id, type, state, title, created_at from work_items`,
  bw_v_flows: `
    select id, work_item_id, flow_type, status, current_step, created_at from flows`,
  bw_v_decisions: `
    select id, flow_id, status, request_type, question, answer, answered_at, created_at from decisions`,
  bw_v_learnings: `
    select id, project_id, text, created_at from learnings`,
  bw_v_chat: `
    select m.seq as id,
           m.scope,
           coalesce(w.title, case when m.scope = 'central' then '중앙' else m.scope end) as scope_title,
           m.role, m.text, m.created_at
    from chat_messages m
    left join work_items w on w.id = m.scope
    where m.redacted_at is null and m.status <> 'failed'`,
};

/**
 * Idempotently provision the triage read model: a NOLOGIN role with SELECT on curated views
 * only (no base-table grants), plus the views themselves. This role is the real read-only
 * boundary — `runReadOnly` does `SET LOCAL ROLE` into it inside a READ ONLY transaction, so
 * any write fails on privilege AND on transaction mode, and base tables are unreachable.
 */
export async function ensureTriageReadModel(sql: SQL): Promise<void> {
  // Contract/DDL drift guard: every contracted view must have a body and vice-versa.
  const contracted = READ_VIEWS.map((v) => v.view).sort();
  const bodied = Object.keys(VIEW_BODIES).sort();
  if (contracted.join(',') !== bodied.join(',')) {
    throw new Error(`triage read-model drift: contract=[${contracted}] bodies=[${bodied}]`);
  }

  // Role (NOLOGIN: a privilege bucket we SET ROLE into, never a connectable account).
  // READ_ROLE is a code constant (never user input), so inlining it is safe; params cannot be
  // used inside a dollar-quoted DO body anyway.
  await sql.unsafe(`do $$ begin
    if not exists (select 1 from pg_roles where rolname = '${READ_ROLE}') then
      execute format('create role %I nologin', '${READ_ROLE}');
    end if;
  end $$`);
  // Start from zero: the role gets nothing implicitly.
  await sql.unsafe(`revoke all on all tables in schema public from ${READ_ROLE}`);
  await sql.unsafe(`grant usage on schema public to ${READ_ROLE}`);

  for (const view of READ_VIEWS) {
    // drop+create (not `or replace`): view evolution may add/reorder columns, which replace forbids.
    await sql.unsafe(`drop view if exists ${view.view}`);
    await sql.unsafe(`create view ${view.view} as ${VIEW_BODIES[view.view]}`);
    // Views are security-definer by default: they read base tables as the owner (superuser),
    // so the role only needs SELECT on the view, never on the base tables.
    await sql.unsafe(`grant select on ${view.view} to ${READ_ROLE}`);
  }
}
