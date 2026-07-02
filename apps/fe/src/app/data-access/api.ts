import { HttpClient } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import type { WorkItemDto, FlowDto, StepRunDto, DecisionRequestDto } from '@bw/dto';

/**
 * Base URL of the blazewrit backend. Defaults to the local mock (apps/mock);
 * override this token in app.config to point at the real zipbul backend (DECISIONS §13).
 */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  providedIn: 'root',
  factory: () => 'http://localhost:4500',
});

/** Connection/health view of a project (not a persisted DTO). */
export interface ProjectVm {
  readonly id: string;
  readonly name: string;
  readonly status: 'up' | 'down';
  /** Registration lifecycle: 'proposed' = ghost hearth awaiting approval, 'active' = live. */
  readonly regStatus: 'proposed' | 'active';
  readonly activeCount: number;
}

/** An inter-project edge on the canvas (agent-proposed, user-confirmed). */
export interface RelationshipVm {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly type: string;
  readonly status: 'proposed' | 'confirmed';
}

/** Structured intent the central triage agent derives from a raw request (read-only analysis). */
export interface IntentVm {
  readonly summary: string;
  readonly flowType: string;
  readonly targetProject: string | null;
  readonly isNewProject: boolean;
  readonly suggestedProjectName: string | null;
  readonly relatedProjects: string[];
  readonly needsClarification: boolean;
  readonly clarifyingQuestion: string | null;
  readonly clarifyOptions: string[];
  readonly confidence: number;
  readonly rationale: string;
}

/** One persisted conversation turn (hydration shape of GET /api/chat/:scope). */
export interface ChatTurnVm {
  readonly seq: number;
  readonly role: 'user' | 'agent' | 'summary';
  readonly text: string;
  readonly payload: { intent?: IntentVm | null; view?: TableVm | null } | null;
  readonly createdAt: string;
}

/** A declarative table the agent asked the FE to render in the dock. */
export interface TableVm {
  readonly title: string;
  readonly columns: string[];
  readonly rows: string[][];
}

/** A platform limitation the agent logged while serving a user (self-improvement board entry). */
export interface FeedbackVm {
  readonly id: string;
  readonly category: 'ui' | 'feature' | 'unmet';
  readonly content: string;
  readonly request: string;
  readonly status: string;
  readonly createdAt: string;
}

/** A2A connection + agent health for a repo (runtime view, distinguishes silent vs dead). */
export interface ConnectionVm {
  readonly projectId: string;
  readonly endpoint: string;
  readonly status: 'connected' | 'degraded' | 'disconnected';
  readonly lastHeartbeat: string;
  readonly latencyMs: number | null;
  readonly activeStreams: number;
  readonly agentState: 'idle' | 'working' | 'unreachable';
}

/** Thin typed wrapper over the backend REST surface. */
@Injectable({ providedIn: 'root' })
export class BlazewritApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(API_BASE_URL);

  projects(): Observable<ProjectVm[]> {
    return this.http.get<ProjectVm[]>(`${this.base}/api/projects`);
  }

  workItems(): Observable<WorkItemDto[]> {
    return this.http.get<WorkItemDto[]>(`${this.base}/api/work-items`);
  }

  flows(): Observable<FlowDto[]> {
    return this.http.get<FlowDto[]>(`${this.base}/api/flows`);
  }

  stepRuns(flowId: string): Observable<StepRunDto[]> {
    return this.http.get<StepRunDto[]>(`${this.base}/api/flows/${flowId}/step-runs`);
  }

  decisions(): Observable<DecisionRequestDto[]> {
    return this.http.get<DecisionRequestDto[]>(`${this.base}/api/decisions`);
  }

  answerDecision(id: string, answer: string): Observable<DecisionRequestDto> {
    return this.http.post<DecisionRequestDto>(`${this.base}/api/decisions/${id}/answer`, { answer });
  }

  connections(): Observable<ConnectionVm[]> {
    return this.http.get<ConnectionVm[]>(`${this.base}/api/connections`);
  }

  relationships(): Observable<RelationshipVm[]> {
    return this.http.get<RelationshipVm[]>(`${this.base}/api/relationships`);
  }

  /** Center intake: submit a raw intent; the backend (meta agent) triages + routes + runs. */
  submitIntent(request: string, hitl = false): Observable<{ accepted: boolean; workItemId?: string }> {
    return this.http.post<{ accepted: boolean; workItemId?: string }>(`${this.base}/api/run`, { request, hitl });
  }

  /** One 똘이 turn in a thread: free reply + optional intent / feedback / table view. */
  triage(request: string, scope: string, clientMsgId?: string): Observable<{ reply: string; intent: IntentVm | null; feedback: FeedbackVm | null; view: TableVm | null }> {
    return this.http.post<{ reply: string; intent: IntentVm | null; feedback: FeedbackVm | null; view: TableVm | null }>(
      `${this.base}/api/triage`,
      { request, scope, clientMsgId },
    );
  }

  /** Persisted conversation history of a thread (server truth — hydrates the dock). */
  chatHistory(scope: string, limit = 50): Observable<ChatTurnVm[]> {
    return this.http.get<ChatTurnVm[]>(`${this.base}/api/chat/${encodeURIComponent(scope)}?limit=${limit}`);
  }

  /** Agent self-improvement board: limitations the agent logged while serving users. */
  feedback(): Observable<FeedbackVm[]> {
    return this.http.get<FeedbackVm[]>(`${this.base}/api/feedback`);
  }

  /** Dispatch an approved triage analysis: to a resolved existing project, or as a newly-named project. */
  dispatch(
    request: string,
    opts: { targetProject?: string; newProjectName?: string },
    scope = 'central',
  ): Observable<{ accepted: boolean; workItemId?: string; pendingRegistration?: boolean; projectId?: string }> {
    return this.http.post<{ accepted: boolean; workItemId?: string; pendingRegistration?: boolean; projectId?: string }>(
      `${this.base}/api/dispatch`,
      { request, ...opts, scope },
    );
  }

  /** Open a clarification question in the drawer inbox for an ambiguous request (answering re-triages). */
  clarify(request: string, question: string, options: string[] = [], scope = 'central'): Observable<{ accepted: boolean; decisionId: string }> {
    return this.http.post<{ accepted: boolean; decisionId: string }>(`${this.base}/api/clarify`, { request, question, options, scope });
  }

  /** SSE URL for a step run's live agent-event stream. */
  streamUrl(stepRunId: string): string {
    return `${this.base}/api/step-runs/${stepRunId}/stream`;
  }
}
