import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { WorkspaceStore } from '../../data-access/workspace-store';
import { FocusLive } from '../../data-access/focus-live';
import { UiState } from '../../data-access/ui-state';
import { FLOW_STEPS } from '../../data-access/flow-model';

const CARD_W = 168;
const CARD_H = 86;
const COL_W = 210; // horizontal spacing between hearths
const ROW_H = 184; // vertical spacing between rows
const TOP = 78; // clear the Fleet label + add button row

interface Placed {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
  readonly ghost: boolean; // proposed project awaiting approval
  readonly flagged: boolean; // has an open question on its flow
  readonly selected: boolean;
  readonly progress: number; // 0..1 of the active flow
  readonly focusItemId: string | null;
  readonly x: number; // px
  readonly y: number; // px
  readonly cx: number; // center px
  readonly cy: number;
}

interface Edge {
  readonly id: string;
  readonly d: string; // svg path
  readonly proposed: boolean;
  readonly label: string;
  readonly lx: number;
  readonly ly: number;
}

/** Canvas = a spatial fleet map (projects as hearths scattered across the field, with
 *  relationship edges + ghost hearths for proposed projects) + the live detail rail. */
@Component({
  selector: 'app-canvas',
  templateUrl: './canvas.html',
  styleUrl: './canvas.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Canvas {
  private readonly store = inject(WorkspaceStore);
  private readonly live = inject(FocusLive);
  private readonly ui = inject(UiState);

  private readonly mapEl = viewChild<ElementRef<HTMLElement>>('mapEl');
  protected readonly mapWidth = signal(900);
  private readonly mapViewHeight = signal(560);

  protected readonly focus = this.live.focus;
  protected readonly focusFlow = this.live.focusFlow;
  protected readonly metro = this.live.metro;
  protected readonly liveLines = this.live.liveLines;

  constructor() {
    afterNextRender(() => {
      const el = this.mapEl()?.nativeElement;
      if (!el) return;
      const ro = new ResizeObserver(() => {
        this.mapWidth.set(el.clientWidth);
        this.mapViewHeight.set(el.clientHeight);
      });
      ro.observe(el);
      this.mapWidth.set(el.clientWidth);
      this.mapViewHeight.set(el.clientHeight);
    });
  }

  /** Project ids that have an unanswered question on their active flow → hearth gets flagged. */
  private readonly flaggedProjects = computed(() => {
    const items = this.store.workItems();
    const byFlow = new Map(items.map((w) => [w.activeFlowId ?? '', w.projectId]));
    const ids = new Set<string>();
    for (const d of this.store.openDecisions()) {
      const pid = byFlow.get(d.flowId);
      if (pid) ids.add(pid);
    }
    return ids;
  });

  /** Hearths placed across the map on a deterministic organic scatter (pixel space). */
  protected readonly placed = computed<Placed[]>(() => {
    const items = this.store.workItems();
    const focusId = this.live.focus()?.id ?? null;
    const flagged = this.flaggedProjects();
    const projects = this.store.projects();
    const w = this.mapWidth();
    const n = projects.length;
    // Scatter hearths in a 2-wide brick pattern so they use the vertical field instead of
    // clustering in one flat top row; bounded so they never collide with the add button/rail.
    const fit = Math.max(1, Math.floor((w - 40) / COL_W));
    const cols = Math.max(1, Math.min(fit, 2, n));

    // Center the hearth cluster in the map (both axes) so it sits as a balanced
    // constellation instead of jamming into the top-left corner (matches the v4 scatter).
    const rows = Math.max(1, Math.ceil(n / cols));
    const clusterH = (rows - 1) * ROW_H + CARD_H + 48; // +48 for the brick stagger
    const offsetY = Math.max(TOP, (this.mapViewHeight() - clusterH) / 2);
    const usedCols = Math.min(cols, n);
    const clusterW = (usedCols - 1) * COL_W + CARD_W + (rows > 1 ? 34 : 0);
    const offsetX = Math.max(24, (w - clusterW) / 2);

    return projects.map((p, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const projItems = items.filter((wi) => wi.projectId === p.id);
      const activeItem = projItems.find((wi) => this.store.flowFor(wi)?.status === 'active');
      const flow = activeItem ? this.store.flowFor(activeItem) : null;

      let progress = 0;
      if (flow) {
        const steps = FLOW_STEPS[flow.flowType] ?? [];
        const idx = steps.indexOf(flow.currentStep);
        progress = steps.length > 1 && idx >= 0 ? idx / (steps.length - 1) : 0;
      }

      const x = offsetX + col * COL_W + (row % 2) * 34;
      const y = offsetY + row * ROW_H + (col % 2) * 48; // brick-stagger columns for an organic scatter
      const focusItem = activeItem ?? projItems[0] ?? null;
      return {
        id: p.id,
        name: p.name,
        active: !!activeItem,
        ghost: p.regStatus === 'proposed',
        flagged: flagged.has(p.id),
        selected: !!focusId && projItems.some((wi) => wi.id === focusId),
        progress,
        focusItemId: focusItem?.id ?? null,
        x,
        y,
        cx: x + CARD_W / 2,
        cy: y + CARD_H / 2,
      };
    });
  });

  /** Edges between hearths from relationship data (confirmed solid / proposed dashed). */
  protected readonly edges = computed<Edge[]>(() => {
    const byId = new Map(this.placed().map((h) => [h.id, h]));
    return this.store
      .relationships()
      .map((r) => {
        const a = byId.get(r.from);
        const b = byId.get(r.to);
        if (!a || !b) return null;
        // Anchor on the dominant axis: side-by-side cards connect left↔right edges,
        // stacked cards connect top↔bottom edges — so the line always exits the side
        // that actually faces the other card (never loops back around).
        const horizontal = Math.abs(b.cx - a.cx) >= Math.abs(b.cy - a.cy);
        let x1: number, y1: number, x2: number, y2: number, c1x: number, c1y: number, c2x: number, c2y: number;
        if (horizontal) {
          const ltr = a.cx <= b.cx;
          x1 = ltr ? a.x + CARD_W : a.x;
          x2 = ltr ? b.x : b.x + CARD_W;
          y1 = a.cy;
          y2 = b.cy;
          const dx = Math.max(36, Math.abs(x2 - x1) * 0.5) * (ltr ? 1 : -1);
          c1x = x1 + dx; c1y = y1; c2x = x2 - dx; c2y = y2;
        } else {
          const ttb = a.cy <= b.cy;
          y1 = ttb ? a.y + CARD_H : a.y;
          y2 = ttb ? b.y : b.y + CARD_H;
          x1 = a.cx;
          x2 = b.cx;
          const dy = Math.max(30, Math.abs(y2 - y1) * 0.5) * (ttb ? 1 : -1);
          c1x = x1; c1y = y1 + dy; c2x = x2; c2y = y2 - dy;
        }
        return {
          id: r.id,
          d: `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`,
          proposed: r.status === 'proposed',
          label: r.status === 'proposed' ? '? 연결' : r.type,
          lx: (x1 + x2) / 2,
          ly: (y1 + y2) / 2 - 7,
        };
      })
      .filter((e): e is Edge => e !== null);
  });

  protected readonly mapHeight = computed(() => {
    const ys = this.placed().map((h) => h.y);
    return (ys.length ? Math.max(...ys) : 0) + CARD_H + 60;
  });

  /** Short metro labels so the 8-step flow fits one row in the 360px rail (matches v4). */
  private static readonly STEP_ABBR: Record<string, string> = {
    ground: 'grnd', investigate: 'inv', decide: 'dec', spec: 'spec',
    test: 'test', implement: 'impl', verify: 'vfy', reflect: 'rfl', report: 'rpt',
  };
  protected abbr(step: string): string {
    return Canvas.STEP_ABBR[step] ?? step.slice(0, 4);
  }

  protected select(workItemId: string | null): void {
    if (workItemId) this.live.select(workItemId);
  }

  /** "+ 프로젝트": projects are intent-driven — focus the center prompt so the agent can propose one. */
  protected addProject(): void {
    this.ui.focusComposer();
  }
}
