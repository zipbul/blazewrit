/**
 * The read surface the central triage agent is allowed to see — the SINGLE source of truth.
 * `views.sql.ts` derives the DDL + grants from this; `schema-context.ts` derives the prompt
 * description from this. Adding a column here (and in the matching view SQL) is the only way to
 * widen what the agent can read. Base tables are never exposed — only these curated views.
 */
export interface ReadColumn {
  readonly name: string;
  readonly type: string;
  readonly note?: string;
}

export interface ReadView {
  /** View name as created in Postgres (prefixed `bw_v_`). */
  readonly view: string;
  /** One line telling the agent what this view answers. */
  readonly purpose: string;
  readonly columns: readonly ReadColumn[];
}

export const READ_VIEWS: readonly ReadView[] = [
  {
    view: 'bw_v_projects',
    purpose: 'Registered projects, their lifecycle status, and how many flows are currently active.',
    columns: [
      { name: 'id', type: 'text', note: 'project id (slug)' },
      { name: 'name', type: 'text' },
      { name: 'status', type: 'text', note: "'active' | 'proposed' | other" },
      { name: 'active_flows', type: 'int', note: 'count of in-progress flows' },
      { name: 'created_at', type: 'timestamptz' },
    ],
  },
  {
    view: 'bw_v_relationships',
    purpose: 'Directed links between projects (who depends on / collaborates with whom).',
    columns: [
      { name: 'id', type: 'text' },
      { name: 'from_project', type: 'text' },
      { name: 'to_project', type: 'text' },
      { name: 'type', type: 'text', note: "e.g. 'depends'" },
      { name: 'status', type: 'text', note: "'proposed' | 'active'" },
    ],
  },
  {
    view: 'bw_v_work_items',
    purpose: 'Units of intent already captured, their type and current state, newest first.',
    columns: [
      { name: 'id', type: 'text' },
      { name: 'project_id', type: 'text' },
      { name: 'type', type: 'text', note: "'feature' | 'bug' | 'task'" },
      { name: 'state', type: 'text', note: "e.g. 'in_flow' | 'done' | 'blocked'" },
      { name: 'title', type: 'text', note: 'the original request text' },
      { name: 'created_at', type: 'timestamptz' },
    ],
  },
  {
    view: 'bw_v_flows',
    purpose: 'Workflow runs against work items — flow type, status, and which step they are on.',
    columns: [
      { name: 'id', type: 'text' },
      { name: 'work_item_id', type: 'text' },
      { name: 'flow_type', type: 'text', note: 'feature|bugfix|refactor|research|migration|audit|chore' },
      { name: 'status', type: 'text' },
      { name: 'current_step', type: 'text' },
      { name: 'created_at', type: 'timestamptz' },
    ],
  },
  {
    view: 'bw_v_decisions',
    purpose: 'Open/closed human-in-the-loop decisions — question AND answer, so past exchanges are reconstructable.',
    columns: [
      { name: 'id', type: 'text' },
      { name: 'flow_id', type: 'text', note: 'nullable — some decisions are flow-less' },
      { name: 'status', type: 'text', note: "'open' | 'answered'" },
      { name: 'request_type', type: 'text' },
      { name: 'question', type: 'text' },
      { name: 'answer', type: 'text', note: 'null until answered' },
      { name: 'answered_at', type: 'timestamptz', note: 'null until answered' },
      { name: 'created_at', type: 'timestamptz' },
    ],
  },
  {
    view: 'bw_v_chat',
    purpose:
      "Conversation history with the user, every thread. scope = 'central' | a bw_v_work_items.id. " +
      'Search it (ILIKE on text/scope_title, time bounds) to recall past discussion beyond the visible window.',
    columns: [
      { name: 'id', type: 'bigint', note: 'ordering key — order by id' },
      { name: 'scope', type: 'text', note: "'central' | work item id" },
      { name: 'scope_title', type: 'text', note: "thread title ('중앙' or the work item title)" },
      { name: 'role', type: 'text', note: "'user' | 'agent' | 'summary'" },
      { name: 'text', type: 'text' },
      { name: 'created_at', type: 'timestamptz' },
    ],
  },
  {
    view: 'bw_v_learnings',
    purpose: 'Reflections captured at flow end — prior knowledge the agent can reuse.',
    columns: [
      { name: 'id', type: 'text' },
      { name: 'project_id', type: 'text' },
      { name: 'text', type: 'text' },
      { name: 'created_at', type: 'timestamptz' },
    ],
  },
] as const;

/** Role that owns the read grant. SET LOCAL ROLE to this inside the read-only transaction. */
export const READ_ROLE = 'bw_triage_ro';
