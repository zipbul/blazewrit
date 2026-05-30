import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { WorkspaceStore } from '../../data-access/workspace-store';
import { FocusLive } from '../../data-access/focus-live';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard {
  private readonly store = inject(WorkspaceStore);
  private readonly live = inject(FocusLive);

  protected readonly projects = this.store.projects;
  protected readonly activeCount = this.store.activeCount;

  protected readonly focus = this.live.focus;
  protected readonly focusFlow = this.live.focusFlow;
  protected readonly metro = this.live.metro;
  protected readonly liveLines = this.live.liveLines;

  protected readonly otherTasks = computed(() =>
    this.store.workItems().slice(1).map((w) => ({ item: w, flow: this.store.flowFor(w) ?? null })),
  );
}
