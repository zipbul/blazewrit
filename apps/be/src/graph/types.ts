/**
 * Domain row types for the job-graph layer (harness/job-graph.md). 1:1 with the DDL added to
 * infra/schema.ts — camelCase mirrors of the snake_case columns. No logic lives here; it's the
 * shared vocabulary the rest of graph/* (cycle, deps, transitions, derive, store) builds on.
 */

export type TaskStatus = 'open' | 'done' | 'failed' | 'cancelled';

export type JobStatus = 'pending' | 'ready' | 'running' | 'blocked' | 'done' | 'failed' | 'cancelled';

export type DepPredicate = 'all' | 'any';

export type DepStatus = 'active' | 'released' | 'stale';

export type DepTargetType = 'job' | 'task' | 'external';

/** 1:1 with a job/task's terminal outcome (rule 6 for task targets, mirrored for job targets). */
export type DepOutcome = 'pending' | 'satisfied' | 'failed' | 'cancelled';

export type ExternalGateStatus = 'pending' | 'fired';

export interface ProductRow {
  id: string;
  name: string;
  createdAt: string | Date;
}

export interface RepoRow {
  id: string;
  productId: string;
  name: string;
  gitUrl?: string;
  cwd: string;
  parentRepoId?: string;
  card: Record<string, unknown>;
  createdAt: string | Date;
}

export interface TaskRow {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  createdAt: string | Date;
}

/** Per-repo seal (rule 2): existence = that repo declared its slice of the task done. */
export interface TaskSealRow {
  taskId: string;
  repoId: string;
  sealedAt: string | Date;
}

export interface JobRow {
  id: string;
  taskId: string;
  repoId: string;
  title: string;
  description?: string;
  status: JobStatus;
  /** Re-run = same row, generation+1 (rule 9's gen++, not a new row). */
  generation: number;
  createdAt: string | Date;
}

/** A waiter's readiness condition. One job may have several dep rows — AND across dep rows. */
export interface DepRow {
  id: string;
  waiterJob: string;
  /** AND ('all') vs OR ('any') across THIS dep's members. */
  predicate: DepPredicate;
  status: DepStatus;
}

/** One (possibly polymorphic) target inside a dep. Composite key: (depId, targetType, targetId). */
export interface DepMemberRow {
  depId: string;
  targetType: DepTargetType;
  targetId: string;
  /** Job-target staleness anchor (rule 5) — ignored for task/external targets. */
  expectedGen?: number;
  outcome: DepOutcome;
  /** Which outcomes this member treats as "met" (e.g. accepting a cancelled target). Default {satisfied}. */
  acceptable: DepOutcome[];
}

export interface ExternalGateRow {
  id: string;
  taskId: string;
  kind: string;
  description?: string;
  status: ExternalGateStatus;
  createdAt: string | Date;
}
