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

const REGION_W = 196;
const MARGIN = 120;

interface Ember {
  readonly id: string;
  readonly title: string;
  readonly state: string;
  readonly step?: string;
}

interface Region {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
  readonly ghost: boolean;
  readonly flagged: boolean;
  readonly selected: boolean;
  readonly activeCount: number;
  readonly embers: Ember[];
  readonly extra: number;
  readonly cx: number; // center (virtual coords)
  readonly cy: number;
  readonly h: number; // panel height
  readonly glow: number; // glow radius (activity)
}

interface Trail {
  readonly id: string;
  readonly d: string;
  readonly proposed: boolean;
  readonly lx: number;
  readonly ly: number;
}

interface FlowLink {
  readonly id: string;
  readonly d: string;
}

interface Node {
  id: string;
  r: number;
  h: number;
  x: number;
  y: number;
}

type Selection = { kind: 'project'; id: string } | { kind: 'task'; id: string } | null;

/**
 * Canvas = a dark field of HEARTHS. Each project is a region of firelight (not a card),
 * placed by a force layout (dependencies attract, projects repel) so it fills 2D space and
 * self-organizes. Tasks are embers inside the glow; dependencies are trails between hearths;
 * A2A communication runs as sparks along them. Pan + zoom to roam.
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
  private readonly viewW = signal(1000);
  private readonly viewH = signal(700);

  // pan / zoom
  protected readonly panX = signal(0);
  protected readonly panY = signal(0);
  protected readonly zoom = signal(1);
  private drag: { x: number; y: number; px: number; py: number } | null = null;

  protected readonly selection = signal<Selection>(null);

  constructor() {
    afterNextRender(() => {
      const el = this.mapEl()?.nativeElement;
      if (!el) return;
      const ro = new ResizeObserver(() => {
        this.viewW.set(el.clientWidth);
        this.viewH.set(el.clientHeight);
      });
      ro.observe(el);
      this.viewW.set(el.clientWidth);
      this.viewH.set(el.clientHeight);
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

  /** Deterministic force layout: repulsion + dependency springs + center gravity, normalized. */
  private readonly layout = computed<Map<string, Node>>(() => {
    const projects = this.store.projects();
    const items = this.store.workItems();
    const rels = this.store.relationships();
    const n = projects.length;
    if (n === 0) return new Map();

    const nodes: Node[] = projects.map((p, i) => {
      const count = items.filter((w) => w.projectId === p.id).length;
      const h = 58 + Math.min(count, 5) * 26 + (count ? 12 : 18);
      const r = Math.max(120, Math.hypot(REGION_W, h) / 2 + 30);
      const a = (i / n) * Math.PI * 2;
      return { id: p.id, r, h, x: Math.cos(a) * 280, y: Math.sin(a) * 200 };
    });
    const idx = new Map(nodes.map((nd, i) => [nd.id, i] as const));
    const edges = rels
      .map((r) => [idx.get(r.from), idx.get(r.to)] as const)
      .filter((e): e is readonly [number, number] => e[0] != null && e[1] != null);

    for (let it = 0; it < 320; it++) {
      for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++) {
          const a = nodes[i]!, b = nodes[j]!;
          let dx = a.x - b.x, dy = a.y - b.y;
          let d = Math.hypot(dx, dy) || 0.01;
          const rep = 26000 / (d * d);
          a.x += (dx / d) * rep; a.y += (dy / d) * rep;
          b.x -= (dx / d) * rep; b.y -= (dy / d) * rep;
          const minD = a.r + b.r;
          if (d < minD) {
            const push = (minD - d) / 2;
            a.x += (dx / d) * push; a.y += (dy / d) * push;
            b.x -= (dx / d) * push; b.y -= (dy / d) * push;
          }
        }
      for (const [ai, bi] of edges) {
        const a = nodes[ai]!, b = nodes[bi]!;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const k = (d - (a.r + b.r + 40)) * 0.02;
        a.x += (dx / d) * k; a.y += (dy / d) * k;
        b.x -= (dx / d) * k; b.y -= (dy / d) * k;
      }
      for (const nd of nodes) { nd.x *= 0.995; nd.y *= 0.995; }
    }

    // normalize to positive coords with margin
    const minX = Math.min(...nodes.map((nd) => nd.x - REGION_W / 2));
    const minY = Math.min(...nodes.map((nd) => nd.y - nd.h / 2));
    for (const nd of nodes) { nd.x += MARGIN - minX; nd.y += MARGIN - minY; }
    return new Map(nodes.map((nd) => [nd.id, nd]));
  });

  protected readonly regions = computed<Region[]>(() => {
    const items = this.store.workItems();
    const flagged = this.flaggedProjects();
    const sel = this.selectedProjectId();
    const lay = this.layout();
    return this.store.projects().map((p) => {
      const nd = lay.get(p.id)!;
      const projItems = items
        .filter((w) => w.projectId === p.id)
        .sort((a, b) => (a.state === 'in_flow' ? 0 : 1) - (b.state === 'in_flow' ? 0 : 1));
      const activeCount = projItems.filter((w) => w.state === 'in_flow').length;
      const shown = projItems.slice(0, 5);
      return {
        id: p.id, name: p.name,
        active: activeCount > 0, ghost: p.regStatus === 'proposed',
        flagged: flagged.has(p.id), selected: sel === p.id,
        activeCount,
        embers: shown.map((w) => {
          const flow = this.store.flowFor(w);
          return { id: w.id, title: w.title, state: w.state, step: flow?.currentStep ? this.abbr(flow.currentStep) : undefined };
        }),
        extra: Math.max(0, projItems.length - shown.length),
        cx: nd.x, cy: nd.y, h: nd.h,
        glow: 90 + Math.min(activeCount, 5) * 16,
      };
    });
  });

  protected readonly fieldWidth = computed(() => {
    const r = this.regions();
    return (r.length ? Math.max(...r.map((x) => x.cx + REGION_W / 2)) : 0) + MARGIN;
  });
  protected readonly fieldHeight = computed(() => {
    const r = this.regions();
    return (r.length ? Math.max(...r.map((x) => x.cy + x.h / 2)) : 0) + MARGIN;
  });

  /** Dependency trails between hearth centers. */
  protected readonly trails = computed<Trail[]>(() => {
    const lay = this.layout();
    return this.store.relationships().map((r) => {
      const a = lay.get(r.from);
      const b = lay.get(r.to);
      if (!a || !b) return null;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      return {
        id: r.id, proposed: r.status === 'proposed',
        d: `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`,
        lx: mx, ly: my - 6,
      };
    }).filter((t): t is Trail => t !== null);
  });

  /** Cross-project A2A flow (tasks sharing a contextId across projects) — sparks ride these. */
  protected readonly flowLinks = computed<FlowLink[]>(() => {
    const lay = this.layout();
    const byCtx = new Map<string, Set<string>>();
    for (const w of this.store.workItems()) {
      if (!w.contextId) continue;
      const s = byCtx.get(w.contextId) ?? new Set<string>();
      s.add(w.projectId);
      byCtx.set(w.contextId, s);
    }
    const links: FlowLink[] = [];
    for (const [ctx, projSet] of byCtx) {
      const projs = [...projSet].map((id) => lay.get(id)).filter((nd): nd is Node => !!nd);
      if (projs.length < 2) continue;
      const hub = projs[0]!;
      for (let i = 1; i < projs.length; i++) {
        const b = projs[i]!;
        links.push({ id: `${ctx}-${i}`, d: `M ${hub.x} ${hub.y} L ${b.x} ${b.y}` });
      }
    }
    return links;
  });

  // ── pan / zoom ──
  protected onWheel(e: WheelEvent): void {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    this.zoom.update((z) => Math.min(2.2, Math.max(0.3, z * factor)));
  }
  protected onPointerDown(e: PointerEvent): void {
    if ((e.target as HTMLElement).closest('.region')) return; // let region clicks through
    this.drag = { x: e.clientX, y: e.clientY, px: this.panX(), py: this.panY() };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  protected onPointerMove(e: PointerEvent): void {
    if (!this.drag) return;
    this.panX.set(this.drag.px + (e.clientX - this.drag.x));
    this.panY.set(this.drag.py + (e.clientY - this.drag.y));
  }
  protected onPointerUp(): void {
    this.drag = null;
  }
  protected resetView(): void {
    this.panX.set(0); this.panY.set(0); this.zoom.set(1);
  }

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
