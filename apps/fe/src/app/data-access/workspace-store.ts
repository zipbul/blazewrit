import { Injectable, computed, inject, signal } from '@angular/core';
import type { WorkItemDto, FlowDto, DecisionRequestDto } from '@bw/dto';
import { BlazewritApi, type ConnectionVm, type ProjectVm } from './api';

/**
 * Workspace snapshot shared across the views (DECISIONS §15). A single root store loads
 * projects/work-items/flows/decisions/connections once; views derive their own projections
 * with `computed`. The live agent stream is component-local, not stored here.
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceStore {
  private readonly api = inject(BlazewritApi);

  readonly projects = signal<readonly ProjectVm[]>([]);
  readonly workItems = signal<readonly WorkItemDto[]>([]);
  readonly flows = signal<readonly FlowDto[]>([]);
  readonly decisions = signal<readonly DecisionRequestDto[]>([]);
  readonly connections = signal<readonly ConnectionVm[]>([]);

  readonly activeCount = computed(
    () => this.workItems().filter((w) => w.state === 'in_flow').length,
  );
  readonly openDecisions = computed(() => this.decisions().filter((d) => d.status === 'open'));

  private readonly flowById = computed(
    () => new Map(this.flows().map((f) => [f.id, f] as const)),
  );

  readonly loadError = signal<string | null>(null);

  constructor() {
    // One-shot GETs complete after a single emission — no teardown needed for a root singleton.
    const onError = (what: string) => (err: unknown) =>
      this.loadError.set(`${what} 로드 실패: ${err instanceof Error ? err.message : String(err)}`);
    this.api.projects().subscribe({ next: (v) => this.projects.set(v), error: onError('projects') });
    this.api.workItems().subscribe({ next: (v) => this.workItems.set(v), error: onError('work-items') });
    this.api.flows().subscribe({ next: (v) => this.flows.set(v), error: onError('flows') });
    this.api.decisions().subscribe({ next: (v) => this.decisions.set(v), error: onError('decisions') });
    this.api.connections().subscribe({ next: (v) => this.connections.set(v), error: onError('connections') });
  }

  flowFor(workItem: WorkItemDto): FlowDto | undefined {
    return workItem.activeFlowId ? this.flowById().get(workItem.activeFlowId) : undefined;
  }

  /** Answer a decision and replace it in the local snapshot with the backend's updated copy. */
  answerDecision(id: string, answer: string): void {
    this.api.answerDecision(id, answer).subscribe({
      next: (updated) =>
        this.decisions.update((list) => list.map((d) => (d.id === id ? updated : d))),
      error: (err: unknown) =>
        this.loadError.set(`결정 응답 실패: ${err instanceof Error ? err.message : String(err)}`),
    });
  }
}
