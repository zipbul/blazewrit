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

  /** Bumped on every live (SSE) backend event so views re-derive (e.g. re-fetch step runs). */
  readonly liveTick = signal(0);

  private readonly onError = (what: string) => (err: unknown) =>
    this.loadError.set(`${what} 로드 실패: ${err instanceof Error ? err.message : String(err)}`);

  constructor() {
    this.reload();
    this.api.connections().subscribe({ next: (v) => this.connections.set(v), error: this.onError('connections') });
  }

  /** Re-fetch the projections that change as flows run (after a center prompt / live tick). */
  reload(): void {
    this.api.projects().subscribe({ next: (v) => this.projects.set(v), error: this.onError('projects') });
    this.api.workItems().subscribe({ next: (v) => this.workItems.set(v), error: this.onError('work-items') });
    this.api.flows().subscribe({ next: (v) => this.flows.set(v), error: this.onError('flows') });
    this.api.decisions().subscribe({ next: (v) => this.decisions.set(v), error: this.onError('decisions') });
  }

  /** Center intake: submit a raw intent (optionally HITL-gated), then refresh. */
  submitIntent(request: string, hitl = false): void {
    this.api.submitIntent(request, hitl).subscribe({
      next: () => this.reload(),
      error: this.onError('intent'),
    });
  }

  /** Called by LiveSync on each backend SSE event: re-pull snapshots + tick derived views. */
  notifyLive(): void {
    this.liveTick.update((t) => t + 1);
    this.reload();
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
