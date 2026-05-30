import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { WorkspaceStore } from '../../data-access/workspace-store';

/**
 * Superset of every step across all FLOW_STEPS (data-access/flow-model), in canonical
 * order. Using the full union (not a subset) ensures no work item whose flow sits at
 * 'spec' or 'report' is silently dropped from the board.
 */
const LANES = [
  'ground',
  'investigate',
  'decide',
  'spec',
  'test',
  'implement',
  'verify',
  'report',
  'reflect',
] as const;

const KNOWN = new Set<string>(LANES);

@Component({
  selector: 'app-board',
  templateUrl: './board.html',
  styleUrl: './board.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Board {
  private readonly store = inject(WorkspaceStore);

  protected readonly lanes = computed(() => {
    const items = this.store.workItems().map((w) => ({ item: w, flow: this.store.flowFor(w) }));
    const stepLanes = LANES.map((step) => ({
      step,
      faint: false,
      tasks: items.filter((t) => t.flow?.currentStep === step),
    }));
    // Anything without a flow, or at a step we don't column for, lands in backlog (no loss).
    const backlog = items.filter((t) => !t.flow || !KNOWN.has(t.flow.currentStep));
    return [...stepLanes, { step: 'backlog', faint: true, tasks: backlog }];
  });
}
