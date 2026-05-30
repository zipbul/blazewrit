import { Injectable, computed, inject, signal } from '@angular/core';
import type { WorkItemDto, FlowDto } from '@bw/dto';
import { BlazewritApi, type ProjectVm } from './api';

/**
 * Workspace snapshot shared across the dashboard/board/canvas views (DECISIONS §15).
 * A single root store loads projects/work-items/flows once; views derive their own
 * projections with `computed`. The live agent stream is component-local, not stored here.
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceStore {
  private readonly api = inject(BlazewritApi);

  readonly projects = signal<readonly ProjectVm[]>([]);
  readonly workItems = signal<readonly WorkItemDto[]>([]);
  readonly flows = signal<readonly FlowDto[]>([]);

  readonly activeCount = computed(
    () => this.workItems().filter((w) => w.state === 'in_flow').length,
  );

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
  }

  flowFor(workItem: WorkItemDto): FlowDto | undefined {
    return workItem.activeFlowId ? this.flowById().get(workItem.activeFlowId) : undefined;
  }
}
