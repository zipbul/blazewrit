import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { WorkspaceStore } from '../../data-access/workspace-store';
import { FocusLive } from '../../data-access/focus-live';
import { deriveMetro } from '../../data-access/flow-model';

@Component({
  selector: 'app-canvas',
  templateUrl: './canvas.html',
  styleUrl: './canvas.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Canvas {
  private readonly store = inject(WorkspaceStore);
  private readonly live = inject(FocusLive);

  protected readonly project = computed(() => this.store.projects().at(0) ?? null);
  protected readonly focusId = this.live.focusId;
  protected readonly liveLines = this.live.liveLines;

  /** Dashed wire from the focused task node to the live feed node. */
  protected readonly liveWire = 'M 612 72 C 740 72, 770 190, 870 190';

  protected readonly nodes = computed(() => {
    const focusId = this.live.focusId();
    return this.store.workItems().map((w, i) => {
      const flow = this.store.flowFor(w);
      const top = 32 + i * 170;
      const centerY = top + 40;
      return {
        item: w,
        flow,
        steps: flow ? deriveMetro(flow.flowType, flow.currentStep).steps : [],
        top,
        focus: w.id === focusId,
        wire: `M 200 110 C 300 110, 300 ${centerY}, 400 ${centerY}`,
      };
    });
  });
}
