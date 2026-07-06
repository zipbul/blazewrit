import type { FlowType } from '@bw/dto';

/**
 * Structured intent — the triage agent's output. Richer than a bare FlowType: it also resolves
 * the request against current DB state (which project, new or existing, related work) and flags
 * when it cannot decide. Lives in-feature for now; promote to `@bw/dto` once a consumer needs it.
 */
export interface Intent {
  /** One-line restatement of what the user wants. */
  summary: string;
  /** Best-guess workflow type. */
  flowType: FlowType;
  /** Existing project id this targets, or null if none / a new project. */
  targetProject: string | null;
  /** True when the request implies a project that does not exist yet. */
  isNewProject: boolean;
  /** When isNewProject, a short proposed project name/id (else null). */
  suggestedProjectName: string | null;
  /** Other existing project ids likely involved. */
  relatedProjects: string[];
  /** True when the agent cannot responsibly proceed without asking the user. */
  needsClarification: boolean;
  /** The question to ask when needsClarification is true, else null. */
  clarifyingQuestion: string | null;
  /** Candidate answers for the clarifying question (e.g. likely projects), or [] when it must be free-form. */
  clarifyOptions: string[];
  /** 0..1 self-rated confidence in this classification. */
  confidence: number;
  /** Short why — what in the request/DB drove the decision. */
  rationale: string;
}
