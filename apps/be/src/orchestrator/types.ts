import type { FlowType, FlowStatus, ReviewVerdict } from '@bw/dto';

export interface StepOutput {
  step: string;
  output: unknown;
}

/** A live agent-output event emitted during a step (tool_use, thinking, assistant text…). */
export interface AgentEvent {
  type: 'user' | 'assistant' | 'thinking' | 'tool_use' | 'tool_result' | 'result';
  payload: Record<string, unknown>;
}

export interface StepContext {
  flowId: string;
  flowType: FlowType;
  step: string;
  attempt: number;
  /** The originating user request/intent, threaded to every step's prompt. */
  request: string;
  /** Outputs of prior completed steps (data flow: Ground facts → Investigate, etc.). */
  priorOutputs: StepOutput[];
  /** The producer output under review — set only on review() calls. */
  producerOutput?: unknown;
  /** Sink for live agent-output events of this step run (wired to the per-step SSE hub). */
  emit?: (event: AgentEvent) => void;
}

export interface ProducerOutcome {
  output: unknown;
}

export interface ReviewOutcome {
  verdict: ReviewVerdict;
}

/**
 * Runs a single step. Real impl invokes the Claude Agent SDK (cwd = project repo);
 * the orchestrator only knows this interface (SRP).
 */
export interface StepExecutor {
  produce(ctx: StepContext): Promise<ProducerOutcome>;
  review(ctx: StepContext): Promise<ReviewOutcome>;
}

export interface FlowRecord {
  id: string;
  flowType: FlowType;
  status: FlowStatus;
  currentStep: string;
  /** Link to the originating work item, set at creation so the UI can render the flow live. */
  workItemId?: string;
  /** Link to the job-graph job this flow executes (harness/job-graph.md migration step 4). */
  jobId?: string;
  /** SDK session of the assemble call that composed this flow (re-askable for debugging). */
  assembleSessionId?: string;
}

export type StepRunStatus = 'running' | 'done' | 'rejected';

export interface StepRunRecord {
  id: string;
  flowId: string;
  step: string;
  role: 'producer' | 'reviewer';
  attempt: number;
  status: StepRunStatus;
  verdict?: ReviewVerdict;
}

/** Persistence port for flow + step-run state. Async so Postgres (or any remote store) fits. */
export interface OrchestratorStore {
  createFlow(flow: FlowRecord): Promise<void>;
  setCurrentStep(flowId: string, step: string): Promise<void>;
  /** Record the assemble session late — two-phase composes the flow after ground runs. */
  setAssembleSession(flowId: string, sessionId: string): Promise<void>;
  setStatus(flowId: string, status: FlowStatus): Promise<void>;
  /** Insert a step run in `running` state (the UI streams its live events). */
  startStepRun(run: { id: string; flowId: string; step: string; role: 'producer' | 'reviewer'; attempt: number; sessionId?: string }): Promise<void>;
  /** Finalize a step run with its terminal status (+ reviewer verdict). */
  finishStepRun(id: string, status: StepRunStatus, verdict?: ReviewVerdict): Promise<void>;
  getFlow(flowId: string): Promise<FlowRecord | undefined>;
  stepRuns(flowId: string): Promise<StepRunRecord[]>;
}
