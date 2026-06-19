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

const CARD_W = 168;
const CARD_H = 86;
const COL_W = 210; // horizontal spacing between hearths
const ROW_H = 184; // vertical spacing between rows
const TOP = 78; // clear the Fleet label + add button row
const MAX_EMBERS = 6; // orbiting embers shown before collapsing to +N

interface Placed {
  readonly id: string;
  readonly name: string;
  readonly active: boolean; // has ≥1 in-flight task
  readonly ghost: boolean; // proposed project awaiting approval
  readonly flagged: boolean; // has an open question
  readonly selected: boolean;
  readonly activeCount: number; // concurrent in-flight tasks
  readonly embers: number[]; // orbit angles (deg), one per active task (capped)
  readonly x: number;
  readonly y: number;
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

interface DossierTask {
  readonly id: string;
  readonly title: string;
  readonly type: string;
  readonly state: string;
  readonly flowType?: string;
  readonly currentStep?: string;
  readonly status?: string;
  readonly flagged: boolean;
}

type Selection = { kind: 'project'; id: string } | { kind: 'task'; id: string } | null;

/**
 * Canvas = the PROJECT GRAPH (nodes = projects, edges = relationships) with a live ACTIVITY
 * overlay (orbiting embers = concurrent tasks, A2A flow on edges). Task-level detail (the
 * flow metro/stream) is NOT painted on a node — it opens in the rail when a task is selected.
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
  protected readonly mapWidth = signal(900);
  private readonly mapViewHeight = signal(560);

  /** What the rail shows: a project dossier, a task's flow, or nothing. */
  protected readonly selection = signal<Selection>(null);

  // Task-flow detail (rail, task mode) — driven by FocusLive when a task is selected.
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

  private selectedProjectId(): string | null {
    const s = this.selection();
    if (s?.kind === 'project') return s.id;
    if (s?.kind === 'task') return this.store.workItems().find((w) => w.id === s.id)?.projectId ?? null;
    return null;
  }

  /** Project nodes placed on a centered organic scatter, carrying their aggregate activity. */
  protected readonly placed = computed<Placed[]>(() => {
    const items = this.store.workItems();
    const flagged = this.flaggedProjects();
    const selProject = this.selectedProjectId();
    const projects = this.store.projects();
    const w = this.mapWidth();
    const n = projects.length;
    const fit = Math.max(1, Math.floor((w - 40) / COL_W));
    const cols = Math.max(1, Math.min(fit, 2, n));
    const rows = Math.max(1, Math.ceil(n / cols));
    const clusterH = (rows - 1) * ROW_H + CARD_H + 48;
    const offsetY = Math.max(TOP, (this.mapViewHeight() - clusterH) / 2);
    const usedCols = Math.min(cols, n);
    const clusterW = (usedCols - 1) * COL_W + CARD_W + (rows > 1 ? 34 : 0);
    const offsetX = Math.max(24, (w - clusterW) / 2);

    return projects.map((p, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const projItems = items.filter((wi) => wi.projectId === p.id);
      const activeCount = projItems.filter((wi) => wi.state === 'in_flow').length;
      const shown = Math.min(activeCount, MAX_EMBERS);
      const embers = Array.from({ length: shown }, (_, k) => (360 / Math.max(1, shown)) * k);
      const x = offsetX + col * COL_W + (row % 2) * 34;
      const y = offsetY + row * ROW_H + (col % 2) * 48;
      return {
        id: p.id,
        name: p.name,
        active: activeCount > 0,
        ghost: p.regStatus === 'proposed',
        flagged: flagged.has(p.id),
        selected: selProject === p.id,
        activeCount,
        embers,
        x,
        y,
        cx: x + CARD_W / 2,
        cy: y + CARD_H / 2,
      };
    });
  });

  /** Relationship edges (confirmed solid / proposed dashed), anchored on the dominant axis. */
  protected readonly edges = computed<Edge[]>(() => {
    const byId = new Map(this.placed().map((h) => [h.id, h]));
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

  /** Project dossier (rail, project mode): the project's tasks with their flow status. */
  protected readonly dossier = computed(() => {
    const pid = this.selectedProjectId();
    if (!pid || this.selection()?.kind !== 'project') return null;
    const flagged = this.flaggedProjects().has(pid);
    const tasks: DossierTask[] = this.store
      .workItems()
      .filter((w) => w.projectId === pid)
      .map((w) => this.toDossierTask(w));
    return { projectId: pid, flagged, tasks };
  });

  private toDossierTask(w: WorkItemDto): DossierTask {
    const flow = this.store.flowFor(w);
    return {
      id: w.id,
      title: w.title,
      type: w.type,
      state: w.state,
      flowType: flow?.flowType,
      currentStep: flow?.currentStep,
      status: flow?.status,
      flagged: false,
    };
  }

  private static readonly STEP_ABBR: Record<string, string> = {
    ground: 'grnd', investigate: 'inv', decide: 'dec', spec: 'spec',
    test: 'test', implement: 'impl', verify: 'vfy', reflect: 'rfl', report: 'rpt',
  };
  protected abbr(step: string): string {
    return Canvas.STEP_ABBR[step] ?? step.slice(0, 4);
  }

  protected selectProject(id: string): void {
    this.selection.set({ kind: 'project', id });
  }
  protected selectTask(id: string): void {
    this.selection.set({ kind: 'task', id });
    this.live.select(id);
  }

  /** "+ 프로젝트": projects are intent-driven — focus the center prompt so the agent can propose one. */
  protected addProject(): void {
    this.ui.focusComposer();
  }
}
