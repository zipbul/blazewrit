import { HttpClient } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import type { WorkItemDto, FlowDto, StepRunDto } from '@bw/dto';

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
  readonly activeCount: number;
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

  /** SSE URL for a step run's live agent-event stream. */
  streamUrl(stepRunId: string): string {
    return `${this.base}/api/step-runs/${stepRunId}/stream`;
  }
}
