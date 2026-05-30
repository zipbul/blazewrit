/** Shared enum literals for blazewrit DTOs (DECISIONS §10/§14). */

export const WORK_ITEM_TYPES = ['bug', 'feature', 'task'] as const;
export type WorkItemType = (typeof WORK_ITEM_TYPES)[number];

export const WORK_ITEM_STATES = [
  'inbox',
  'backlog',
  'blocked',
  'in_flow',
  'done',
  'rejected',
] as const;
export type WorkItemState = (typeof WORK_ITEM_STATES)[number];

export const WORK_ITEM_SOURCES = ['user', 'agent', 'audit'] as const;
export type WorkItemSource = (typeof WORK_ITEM_SOURCES)[number];

export const FLOW_TYPES = [
  'feature',
  'bugfix',
  'refactor',
  'research',
  'migration',
  'audit',
  'chore',
] as const;
export type FlowType = (typeof FLOW_TYPES)[number];

export const FLOW_STATUSES = ['active', 'suspended', 'completed', 'abandoned'] as const;
export type FlowStatus = (typeof FLOW_STATUSES)[number];

export const STEP_RUN_ROLES = ['producer', 'reviewer', 'subagent'] as const;
export type StepRunRole = (typeof STEP_RUN_ROLES)[number];

export const STEP_RUN_STATUSES = [
  'queued',
  'running',
  'validating',
  'reviewing',
  'done',
  'done_with_concerns',
  'rejected',
  'blocked',
  'needs_context',
] as const;
export type StepRunStatus = (typeof STEP_RUN_STATUSES)[number];

export const REVIEW_VERDICTS = ['pass', 'fail'] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

export const AGENT_EVENT_TYPES = [
  'user',
  'assistant',
  'thinking',
  'tool_use',
  'tool_result',
  'result',
] as const;
export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

// --- HITL decision requests (DECISIONS §10) ---

export const DECISION_STATUSES = ['open', 'answered', 'expired', 'cancelled'] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export const DECISION_REQUEST_TYPES = ['approval', 'free_text', 'single_choice', 'multi_choice'] as const;
export type DecisionRequestType = (typeof DECISION_REQUEST_TYPES)[number];

/** Risk tier for an option/decision — drives UI emphasis (DECISIONS §15 HITL risk model). */
export const RISK_LEVELS = ['low', 'medium', 'high'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];
