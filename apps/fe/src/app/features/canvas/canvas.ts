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
import type { WorkItemDto } from '@bw/dto';
import { WorkspaceStore } from '../../data-access/workspace-store';
import { FocusLive } from '../../data-access/focus-live';
import { UiState } from '../../data-access/ui-state';

const GROUP_W = 256; // project group width
const GAP = 26; // gap between groups
const MARGIN = 28; // field padding
const HEADER_H = 56; // group header height
const CHIP_H = 32; // task chip height
const BODY_PAD = 14; // group body padding (top+bottom)
const EMPTY_H = 30; // idle/no-task body height
const MAX_CHIPS = 6; // tasks shown before "+N"

interface Chip {
  readonly id: string;
  readonly title: string;
  readonly state: string; // work item state
  readonly step?: string; // flow current step (abbreviated upstream)
  readonly stepLabel?: string;
}

interface Group {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
  readonly ghost: boolean;
  readonly flagged: boolean;
  readonly selected: boolean;
  readonly activeCount: number;
  readonly chips: Chip[];
  readonly extra: number; // hidden task count (+N)
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly cx: number;
  readonly cy: number;
}

interface Edge {
  readonly id: string;
  readonly d: string;
  readonly proposed: boolean;
  readonly label: string;
  readonly lx: number;
  readonly ly: number;
}

type Selection = { kind: 'project'; id: string } | { kind: 'task'; id: string } | null;

/**
 * Canvas = the PROJECT DEPENDENCY GRAPH. Each project is a GROUP (container) holding its
 * tasks as small chips; dependency edges connect groups. Full-width, scrollable in all
 * directions when the graph overflows. Detail-on-click is handled separately.
 */
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
  protected readonly viewWidth = signal(900);

  /** Selection drives the (separate) detail surface; kept for when detail-on-click lands. */
  protected readonly selection = signal<Selection>(null);

  constructor() {
    afterNextRender(() => {
      const el = this.mapEl()?.nativeElement;
      if (!el) return;
      const ro = new ResizeObserver(() => this.viewWidth.set(el.clientWidth));
      ro.observe(el);
      this.viewWidth.set(el.clientWidth);
    });
  }

  private static readonly STEP_ABBR: Record<string, string> = {
    ground: 'grnd', investigate: 'inv', decide: 'dec', spec: 'spec',
    test: 'test', implement: 'impl', verify: 'vfy', reflect: 'rfl', report: 'rpt',
  };
  protected abbr(step: string): string {
    return Canvas.STEP_ABBR[step] ?? step.slice(0, 4);
  }

  /** Project ids with an unanswered question → flagged. */
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

  private chipFor(w: WorkItemDto): Chip {
    const flow = this.store.flowFor(w);
    return {
      id: w.id,
      title: w.title,
      state: w.state,
      step: flow?.currentStep,
      stepLabel: flow?.currentStep ? this.abbr(flow.currentStep) : undefined,
    };
  }

  private selectedProjectId(): string | null {
    const s = this.selection();
    if (s?.kind === 'project') return s.id;
    if (s?.kind === 'task') return this.store.workItems().find((w) => w.id === s.id)?.projectId ?? null;
    return null;
  }

  /** Project groups packed into balanced columns (masonry), sized to their task count. */
  protected readonly groups = computed<Group[]>(() => {
    const items = this.store.workItems();
    const flagged = this.flaggedProjects();
    const selProject = this.selectedProjectId();
    const projects = this.store.projects();
    const cols = Math.max(1, Math.min(4, Math.floor((this.viewWidth() - MARGIN) / (GROUP_W + GAP)) || 1));
    const colY = Array.from({ length: cols }, () => MARGIN); // running y per column

    return projects.map((p) => {
      const projItems = items
        .filter((w) => w.projectId === p.id)
        .sort((a, b) => (a.state === 'in_flow' ? -1 : 1) - (b.state === 'in_flow' ? -1 : 1));
      const activeCount = projItems.filter((w) => w.state === 'in_flow').length;
      const chips = projItems.slice(0, MAX_CHIPS).map((w) => this.chipFor(w));
      const extra = Math.max(0, projItems.length - chips.length);

      const bodyH = chips.length ? chips.length * CHIP_H + BODY_PAD + (extra ? 18 : 0) : EMPTY_H;
      const h = HEADER_H + bodyH;

      // shortest column (masonry) for compact packing
      let col = 0;
      for (let c = 1; c < cols; c++) if (colY[c]! < colY[col]!) col = c;
      const x = MARGIN + col * (GROUP_W + GAP);
      const y = colY[col]!;
      colY[col] = y + h + GAP;

      return {
        id: p.id,
        name: p.name,
        active: activeCount > 0,
        ghost: p.regStatus === 'proposed',
        flagged: flagged.has(p.id),
        selected: selProject === p.id,
        activeCount,
        chips,
        extra,
        x,
        y,
        w: GROUP_W,
        h,
        cx: x + GROUP_W / 2,
        cy: y + h / 2,
      };
    });
  });

  /** Field size = bounding box of all groups (drives scroll). */
  protected readonly fieldWidth = computed(() => {
    const g = this.groups();
    const right = g.length ? Math.max(...g.map((x) => x.x + x.w)) : 0;
    return Math.max(this.viewWidth(), right + MARGIN);
  });
  protected readonly fieldHeight = computed(() => {
    const g = this.groups();
    return (g.length ? Math.max(...g.map((x) => x.y + x.h)) : 0) + MARGIN;
  });

  /** Dependency edges between groups (confirmed solid / proposed dashed), dominant-axis anchored. */
  protected readonly edges = computed<Edge[]>(() => {
    const byId = new Map(this.groups().map((g) => [g.id, g]));
    return this.store
      .relationships()
      .map((r) => {
        const a = byId.get(r.from);
        const b = byId.get(r.to);
        if (!a || !b) return null;
        const horizontal = Math.abs(b.cx - a.cx) >= Math.abs(b.cy - a.cy);
        let x1: number, y1: number, x2: number, y2: number, c1x: number, c1y: number, c2x: number, c2y: number;
        if (horizontal) {
          const ltr = a.cx <= b.cx;
          x1 = ltr ? a.x + a.w : a.x;
          x2 = ltr ? b.x : b.x + b.w;
          y1 = a.cy; y2 = b.cy;
          const dx = Math.max(36, Math.abs(x2 - x1) * 0.5) * (ltr ? 1 : -1);
          c1x = x1 + dx; c1y = y1; c2x = x2 - dx; c2y = y2;
        } else {
          const ttb = a.cy <= b.cy;
          y1 = ttb ? a.y + a.h : a.y;
          y2 = ttb ? b.y : b.y + b.h;
          x1 = a.cx; x2 = b.cx;
          const dy = Math.max(30, Math.abs(y2 - y1) * 0.5) * (ttb ? 1 : -1);
          c1x = x1; c1y = y1 + dy; c2x = x2; c2y = y2 - dy;
        }
        return {
          id: r.id,
          d: `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`,
          proposed: r.status === 'proposed',
          label: r.status === 'proposed' ? '? 의존' : 'depends',
          lx: (x1 + x2) / 2,
          ly: (y1 + y2) / 2 - 7,
        };
      })
      .filter((e): e is Edge => e !== null);
  });

  protected selectProject(id: string): void {
    this.selection.set({ kind: 'project', id });
  }
  protected selectTask(id: string, ev: Event): void {
    ev.stopPropagation();
    this.selection.set({ kind: 'task', id });
    this.live.select(id);
  }

  /** "+ 프로젝트": projects are intent-driven — focus the center prompt so the agent can propose one. */
  protected addProject(): void {
    this.ui.focusComposer();
  }
}
