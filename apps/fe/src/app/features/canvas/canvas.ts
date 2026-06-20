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

const MARGIN = 180;
const ROW = 28; // ember vertical gap

interface Ember { id: string; title: string; state: string; step?: string; x: number; y: number; }
/** A spark in the fountain: rises from y0→y1 while drifting sx→sx+dx, fading. */
interface FSpark { sx: number; dx: number; y0: number; y1: number; r: number; dur: number; begin: number; }

interface Region {
  id: string; name: string;
  active: boolean; ghost: boolean; flagged: boolean; selected: boolean;
  activeCount: number;
  cx: number; cy: number; hitR: number; top: number;
  auraRx: number; auraRy: number; coreR: number; // 달아오른 불기운: radiant heat glow body
  fountain: FSpark[]; // 분수 불티: rising spark fountain
  embers: Ember[]; extra: number;
}

interface Trail { id: string; d: string; proposed: boolean; hasFlow: boolean; lx: number; ly: number; }
interface Node { id: string; r: number; x: number; y: number; }
type Selection = { kind: 'project'; id: string } | { kind: 'task'; id: string } | null;

/** Deterministic seeded RNG from a string (so each project's shape is fixed forever). */
function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => {
    h += 0x6d2b79f5; let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Canvas = a field of EMBER CLOUDS. Each project is a soft ember nebula (overlapping glow
 * lobes) with a bright core and an upward flame tip — a shape generated DETERMINISTICALLY
 * from the project id, so every project looks distinct but its shape is fixed forever.
 * Tasks are embers inside; dependencies are curved trails; A2A rides them as sparks.
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

  protected readonly panX = signal(0);
  protected readonly panY = signal(0);
  protected readonly zoom = signal(1);
  private drag: { x: number; y: number; px: number; py: number } | null = null;

  protected readonly selection = signal<Selection>(null);

  constructor() {
    afterNextRender(() => {
      const el = this.mapEl()?.nativeElement;
      if (!el) return;
      const ro = new ResizeObserver(() => { this.viewW.set(el.clientWidth); this.viewH.set(el.clientHeight); });
      ro.observe(el);
      this.viewW.set(el.clientWidth); this.viewH.set(el.clientHeight);
    });
  }

  private static readonly STEP_ABBR: Record<string, string> = {
    ground: 'grnd', investigate: 'inv', decide: 'dec', spec: 'spec',
    test: 'test', implement: 'impl', verify: 'vfy', reflect: 'rfl', report: 'rpt',
  };
  protected abbr(step: string): string { return Canvas.STEP_ABBR[step] ?? step.slice(0, 4); }

  private readonly flaggedProjects = computed(() => {
    const items = this.store.workItems();
    const byFlow = new Map(items.map((w) => [w.activeFlowId ?? '', w.projectId]));
    const ids = new Set<string>();
    for (const d of this.store.openDecisions()) { const pid = byFlow.get(d.flowId); if (pid) ids.add(pid); }
    return ids;
  });

  private selectedProjectId(): string | null {
    const s = this.selection();
    if (s?.kind === 'project') return s.id;
    if (s?.kind === 'task') return this.store.workItems().find((w) => w.id === s.id)?.projectId ?? null;
    return null;
  }

  private readonly counts = computed(() => {
    const m = new Map<string, number>();
    for (const w of this.store.workItems()) m.set(w.projectId, (m.get(w.projectId) ?? 0) + 1);
    return m;
  });

  private baseR(id: string): number { return 82 + Math.min(this.counts().get(id) ?? 0, 5) * 13; }

  /** Force layout (repulsion + dependency springs + gravity), region radius ~ ember cloud extent. */
  private readonly layout = computed<Map<string, Node>>(() => {
    const projects = this.store.projects();
    const rels = this.store.relationships();
    const n = projects.length;
    if (n === 0) return new Map();
    const nodes: Node[] = projects.map((p, i) => {
      const a = (i / n) * Math.PI * 2;
      return { id: p.id, r: this.baseR(p.id) * 1.25 + 34, x: Math.cos(a) * 360, y: Math.sin(a) * 260 };
    });
    const idx = new Map(nodes.map((nd, i) => [nd.id, i] as const));
    const edges = rels.map((r) => [idx.get(r.from), idx.get(r.to)] as const)
      .filter((e): e is readonly [number, number] => e[0] != null && e[1] != null);
    for (let it = 0; it < 340; it++) {
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const a = nodes[i]!, b = nodes[j]!;
        const dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy) || 0.01;
        const rep = 52000 / (d * d);
        a.x += (dx / d) * rep; a.y += (dy / d) * rep; b.x -= (dx / d) * rep; b.y -= (dy / d) * rep;
        const minD = a.r + b.r + 60;
        if (d < minD) { const push = (minD - d) / 2; a.x += (dx / d) * push; a.y += (dy / d) * push; b.x -= (dx / d) * push; b.y -= (dy / d) * push; }
      }
      for (const [ai, bi] of edges) {
        const a = nodes[ai]!, b = nodes[bi]!;
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01;
        const k = (d - (a.r + b.r + 110)) * 0.02;
        a.x += (dx / d) * k; a.y += (dy / d) * k; b.x -= (dx / d) * k; b.y -= (dy / d) * k;
      }
      for (const nd of nodes) { nd.x *= 0.995; nd.y *= 0.995; }
    }
    const minX = Math.min(...nodes.map((nd) => nd.x - nd.r));
    const minY = Math.min(...nodes.map((nd) => nd.y - nd.r));
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
      const cx = nd.x, cy = nd.y;
      const base = this.baseR(p.id);
      const r = rng(p.id);
      // 달아오른 불기운: a hot radiant heat glow (the region body that holds the tasks),
      // slightly elliptical + per-id size so it isn't a uniform circle.
      const auraRx = base * (1.0 + r() * 0.35);
      const auraRy = base * (0.78 + r() * 0.26);
      const coreR = base * 0.42;
      // 분수 불티: a fountain of sparks rising from the base and drifting outward as they fade.
      const baseY = cy + auraRy * 0.45;
      const F = 16 + Math.floor(r() * 10); // sparks
      const fountain: FSpark[] = Array.from({ length: F }, () => {
        const sx = cx + (r() - 0.5) * auraRx * 0.5;
        const h = base * (0.8 + r() * 1.5);          // rise height (varied)
        const dx = (r() - 0.5) * auraRx * 1.1;        // outward drift → fountain spread
        const dur = 1.6 + r() * 1.6;
        const begin = -(r() * dur);                   // negative → mid-flight at load (staggered)
        const rr = 0.8 + r() * 1.7;
        return { sx, dx, y0: baseY, y1: baseY - h, r: rr, dur, begin };
      });
      const hitR = Math.max(auraRx, base * 2);
      const minTop = cy - base * 2;

      const projItems = items.filter((w) => w.projectId === p.id)
        .sort((a, b) => (a.state === 'in_flow' ? 0 : 1) - (b.state === 'in_flow' ? 0 : 1));
      const activeCount = projItems.filter((w) => w.state === 'in_flow').length;
      const shown = projItems.slice(0, 5);
      const stackTop = cy + 6 - ((shown.length - 1) * ROW) / 2;
      const embers: Ember[] = shown.map((w, i) => {
        const flow = this.store.flowFor(w);
        return {
          id: w.id, title: w.title, state: w.state,
          step: flow?.currentStep ? this.abbr(flow.currentStep) : undefined,
          x: cx, y: stackTop + i * ROW,
        };
      });

      return {
        id: p.id, name: p.name,
        active: activeCount > 0, ghost: p.regStatus === 'proposed',
        flagged: flagged.has(p.id), selected: sel === p.id,
        activeCount, cx, cy, hitR: hitR + 6, top: minTop - 6,
        auraRx, auraRy, coreR, fountain,
        embers, extra: Math.max(0, projItems.length - shown.length),
      };
    });
  });

  protected readonly fieldWidth = computed(() => {
    const r = this.regions();
    return (r.length ? Math.max(...r.map((x) => x.cx + x.hitR)) : 0) + MARGIN;
  });
  protected readonly fieldHeight = computed(() => {
    const r = this.regions();
    return (r.length ? Math.max(...r.map((x) => x.cy + x.hitR)) : 0) + MARGIN;
  });

  private readonly flowPairs = computed(() => {
    const byCtx = new Map<string, Set<string>>();
    for (const w of this.store.workItems()) {
      if (!w.contextId) continue;
      const s = byCtx.get(w.contextId) ?? new Set<string>(); s.add(w.projectId); byCtx.set(w.contextId, s);
    }
    const pairs = new Set<string>();
    for (const set of byCtx.values()) {
      const ids = [...set];
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) pairs.add([ids[i], ids[j]].sort().join('|'));
    }
    return pairs;
  });

  protected readonly trails = computed<Trail[]>(() => {
    const byId = new Map(this.regions().map((g) => [g.id, g]));
    const flow = this.flowPairs();
    return this.store.relationships().map((r) => {
      const a = byId.get(r.from), b = byId.get(r.to);
      if (!a || !b) return null;
      const ang = Math.atan2(b.cy - a.cy, b.cx - a.cx);
      const sx = a.cx + Math.cos(ang) * a.hitR * 0.92, sy = a.cy + Math.sin(ang) * a.hitR * 0.92;
      const ex = b.cx - Math.cos(ang) * b.hitR * 0.92, ey = b.cy - Math.sin(ang) * b.hitR * 0.92;
      const mx = (sx + ex) / 2, my = (sy + ey) / 2;
      const seed = (() => { let h = 0; for (const c of (r.id || `${r.from}-${r.to}`)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.sin(h); })();
      const px = mx + Math.cos(ang + Math.PI / 2) * 22 * seed, py = my + Math.sin(ang + Math.PI / 2) * 22 * seed;
      return {
        id: r.id, proposed: r.status === 'proposed',
        hasFlow: flow.has([r.from, r.to].sort().join('|')),
        d: `M ${sx.toFixed(1)} ${sy.toFixed(1)} Q ${px.toFixed(1)} ${py.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`,
        lx: px, ly: py - 5,
      };
    }).filter((t): t is Trail => t !== null);
  });

  protected onWheel(e: WheelEvent): void {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    this.zoom.update((z) => Math.min(2.4, Math.max(0.3, z * factor)));
  }
  private interactive(t: EventTarget | null): boolean {
    const el = t as Element | null;
    return !!el && (!!el.closest('.emb') || (el as SVGElement).classList?.contains('hit'));
  }
  protected onPointerDown(e: PointerEvent): void {
    if (this.interactive(e.target)) return;
    this.drag = { x: e.clientX, y: e.clientY, px: this.panX(), py: this.panY() };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  protected onPointerMove(e: PointerEvent): void {
    if (!this.drag) return;
    this.panX.set(this.drag.px + (e.clientX - this.drag.x));
    this.panY.set(this.drag.py + (e.clientY - this.drag.y));
  }
  protected onPointerUp(): void { this.drag = null; }
  protected resetView(): void { this.panX.set(0); this.panY.set(0); this.zoom.set(1); }

  protected selectProject(id: string): void { this.selection.set({ kind: 'project', id }); }
  protected selectTask(id: string, ev: Event): void {
    ev.stopPropagation();
    this.selection.set({ kind: 'task', id });
    this.live.select(id);
  }
  protected addProject(): void { this.ui.focusComposer(); }
}
