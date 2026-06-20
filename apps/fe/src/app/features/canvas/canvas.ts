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

const GROUP_W = 256;
const GAP = 30;
const MARGIN = 28;
const HEADER_H = 56;
const CHIP_H = 32;
const BODY_PAD = 8;
const EMPTY_H = 30;
const MAX_CHIPS = 6;

interface Chip {
  readonly id: string;
  readonly title: string;
  readonly state: string;
  readonly stepLabel?: string;
  readonly contextId?: string;
  readonly ax: number; // absolute center x (for cross-project links)
  readonly ay: number;
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
  readonly extra: number;
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

interface FlowLink {
  readonly id: string;
  readonly d: string;
}

type Selection = { kind: 'project'; id: string } | { kind: 'task'; id: string } | null;

/**
 * Canvas = the living dependency graph. Renders EVERYTHING at once: project nodes (groups)
 * with their tasks as chips, project→project DEPENDENCY edges, and cross-project FLOW links
 * (tasks sharing a contextId = one user intent realized across projects) with embers running
 * along them = A2A communication. Layout/affordances iterate from here.
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

  /** Project groups (masonry-packed), each carrying its tasks as chips with absolute anchors. */
  protected readonly groups = computed<Group[]>(() => {
    const items = this.store.workItems();
    const flagged = this.flaggedProjects();
    const selProject = this.selectedProjectId();
    const projects = this.store.projects();
    const cols = Math.max(1, Math.min(4, Math.floor((this.viewWidth() - MARGIN) / (GROUP_W + GAP)) || 1));
    const colY = Array.from({ length: cols }, () => MARGIN);

    return projects.map((p) => {
      const projItems = items
        .filter((w) => w.projectId === p.id)
        .sort((a, b) => (a.state === 'in_flow' ? 0 : 1) - (b.state === 'in_flow' ? 0 : 1));
      const activeCount = projItems.filter((w) => w.state === 'in_flow').length;
      const slice = projItems.slice(0, MAX_CHIPS);
      const extra = Math.max(0, projItems.length - slice.length);
      const bodyH = slice.length ? slice.length * CHIP_H + BODY_PAD * 2 + (extra ? 18 : 0) : EMPTY_H;
      const h = HEADER_H + bodyH;

      let col = 0;
      for (let c = 1; c < cols; c++) if (colY[c]! < colY[col]!) col = c;
      const x = MARGIN + col * (GROUP_W + GAP);
      const y = colY[col]!;
      colY[col] = y + h + GAP;

      const chips: Chip[] = slice.map((w, i) => this.chip(w, x, y, i));
      return {
        id: p.id, name: p.name,
        active: activeCount > 0, ghost: p.regStatus === 'proposed',
        flagged: flagged.has(p.id), selected: selProject === p.id,
        activeCount, chips, extra,
        x, y, w: GROUP_W, h, cx: x + GROUP_W / 2, cy: y + h / 2,
      };
    });
  });

  private chip(w: WorkItemDto, gx: number, gy: number, i: number): Chip {
    const flow = this.store.flowFor(w);
    return {
      id: w.id, title: w.title, state: w.state,
      stepLabel: flow?.currentStep ? this.abbr(flow.currentStep) : undefined,
      contextId: w.contextId,
      ax: gx + GROUP_W / 2,
      ay: gy + HEADER_H + BODY_PAD + i * CHIP_H + CHIP_H / 2,
    };
  }

  protected readonly fieldWidth = computed(() => {
    const g = this.groups();
    const right = g.length ? Math.max(...g.map((x) => x.x + x.w)) : 0;
    return Math.max(this.viewWidth(), right + MARGIN);
  });
  protected readonly fieldHeight = computed(() => {
    const g = this.groups();
    return (g.length ? Math.max(...g.map((x) => x.y + x.h)) : 0) + MARGIN;
  });

  /** Project→project dependency edges (the structural graph). */
  protected readonly edges = computed<Edge[]>(() => {
    const byId = new Map(this.groups().map((g) => [g.id, g]));
    return this.store.relationships().map((r) => {
      const a = byId.get(r.from);
      const b = byId.get(r.to);
      if (!a || !b) return null;
      const horizontal = Math.abs(b.cx - a.cx) >= Math.abs(b.cy - a.cy);
      let x1: number, y1: number, x2: number, y2: number, c1x: number, c1y: number, c2x: number, c2y: number;
      if (horizontal) {
        const ltr = a.cx <= b.cx;
        x1 = ltr ? a.x + a.w : a.x; x2 = ltr ? b.x : b.x + b.w; y1 = a.cy; y2 = b.cy;
        const dx = Math.max(36, Math.abs(x2 - x1) * 0.5) * (ltr ? 1 : -1);
        c1x = x1 + dx; c1y = y1; c2x = x2 - dx; c2y = y2;
      } else {
        const ttb = a.cy <= b.cy;
        y1 = ttb ? a.y + a.h : a.y; y2 = ttb ? b.y : b.y + b.h; x1 = a.cx; x2 = b.cx;
        const dy = Math.max(30, Math.abs(y2 - y1) * 0.5) * (ttb ? 1 : -1);
        c1x = x1; c1y = y1 + dy; c2x = x2; c2y = y2 - dy;
      }
      return {
        id: r.id, proposed: r.status === 'proposed',
        d: `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`,
        label: r.status === 'proposed' ? '? 의존' : 'depends',
        lx: (x1 + x2) / 2, ly: (y1 + y2) / 2 - 7,
      };
    }).filter((e): e is Edge => e !== null);
  });

  /** Cross-project FLOW links: chips sharing a contextId across projects = one intent's path. */
  protected readonly flowLinks = computed<FlowLink[]>(() => {
    const byCtx = new Map<string, Array<{ pid: string; ax: number; ay: number }>>();
    for (const g of this.groups()) {
      for (const c of g.chips) {
        if (!c.contextId) continue;
        const arr = byCtx.get(c.contextId) ?? [];
        arr.push({ pid: g.id, ax: c.ax, ay: c.ay });
        byCtx.set(c.contextId, arr);
      }
    }
    const links: FlowLink[] = [];
    for (const [ctx, members] of byCtx) {
      const projects = new Set(members.map((m) => m.pid));
      if (projects.size < 2) continue; // only cross-project realizations form a flow
      const [hub, ...rest] = members;
      for (let i = 0; i < rest.length; i++) {
        const a = hub!, b = rest[i]!;
        const mx = (a.ax + b.ax) / 2;
        links.push({
          id: `${ctx}-${i}`,
          d: `M ${a.ax} ${a.ay} C ${mx} ${a.ay}, ${mx} ${b.ay}, ${b.ax} ${b.ay}`,
        });
      }
    }
    return links;
  });

  protected selectProject(id: string): void {
    this.selection.set({ kind: 'project', id });
  }
  protected selectTask(id: string, ev: Event): void {
    ev.stopPropagation();
    this.selection.set({ kind: 'task', id });
    this.live.select(id);
  }

  protected addProject(): void {
    this.ui.focusComposer();
  }
}
