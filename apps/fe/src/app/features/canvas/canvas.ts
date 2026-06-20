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

const MARGIN = 170;
const EW = 152; // ember box width (for hull containment)
const EH = 24; // ember box height
const ROW = 30; // vertical gap between embers
const PAD = 34; // boundary padding outward from node corners
const LABEL_GAP = 30; // space reserved above for the floating label

interface P { x: number; y: number; }

interface Ember {
  readonly id: string;
  readonly title: string;
  readonly state: string;
  readonly step?: string;
  readonly x: number;
  readonly y: number;
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
  readonly cx: number;
  readonly cy: number;
  readonly top: number; // boundary top (for label)
  readonly blob: string;
  readonly poly: P[]; // padded boundary polygon (for precise trail anchoring)
}

interface Trail { readonly id: string; readonly d: string; readonly proposed: boolean; readonly hasFlow: boolean; readonly lx: number; readonly ly: number; }
interface Node { id: string; r: number; x: number; y: number; }

type Selection = { kind: 'project'; id: string } | { kind: 'task'; id: string } | null;

function wobble(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.sin(h);
}

/** Convex hull (Andrew's monotone chain). */
function convexHull(pts: P[]): P[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: P, a: P, b: P) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: P[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop(); lower.push(q); }
  const upper: P[] = [];
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]!; while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop(); upper.push(q); }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

/** Closed Catmull-Rom → cubic bezier (organic smoothing). */
function smoothClosed(p: ReadonlyArray<P>): string {
  const n = p.length;
  if (n < 3) return '';
  let d = `M ${p[0]!.x.toFixed(1)} ${p[0]!.y.toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = p[(i - 1 + n) % n]!, p1 = p[i]!, p2 = p[(i + 1) % n]!, p3 = p[(i + 2) % n]!;
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d + ' Z';
}

/** Ray from (cx,cy) toward (tx,ty); returns where it crosses the polygon (boundary anchor). */
function rayHit(cx: number, cy: number, poly: P[], tx: number, ty: number): P {
  const dx = tx - cx, dy = ty - cy;
  let best: P | null = null, bestT = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    const ex = b.x - a.x, ey = b.y - a.y;
    const denom = dx * ey - dy * ex;
    if (Math.abs(denom) < 1e-6) continue;
    const t = ((a.x - cx) * ey - (a.y - cy) * ex) / denom;
    const s = ((a.x - cx) * dy - (a.y - cy) * dx) / denom;
    if (t > 0 && s >= 0 && s <= 1 && t < bestT) { bestT = t; best = { x: cx + dx * t, y: cy + dy * t }; }
  }
  return best ?? { x: cx, y: cy };
}

/** Boundary that always CONTAINS the points: hull (or circle fallback) padded outward + smoothed.
 *  Returns the smoothed path AND the padded polygon (for precise edge anchoring of trails). */
function regionBoundary(pts: P[], cx: number, cy: number, seed: string): { path: string; poly: P[] } {
  const hull = convexHull(pts);
  let poly: P[];
  if (hull.length < 3) {
    const far = pts.reduce((m, q) => Math.max(m, Math.hypot(q.x - cx, q.y - cy)), 0);
    const R = far + PAD + 18;
    poly = Array.from({ length: 14 }, (_, k) => {
      const a = (k / 14) * Math.PI * 2;
      const rr = R * (0.95 + 0.07 * wobble(`${seed}:${k}`));
      return { x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr };
    });
  } else {
    const gx = hull.reduce((s, q) => s + q.x, 0) / hull.length;
    const gy = hull.reduce((s, q) => s + q.y, 0) / hull.length;
    poly = hull.map((q, k) => {
      const dx = q.x - gx, dy = q.y - gy, d = Math.hypot(dx, dy) || 1;
      const pad = PAD * (0.92 + 0.14 * wobble(`${seed}:${k}`));
      return { x: q.x + (dx / d) * pad, y: q.y + (dy / d) * pad };
    });
  }
  return { path: smoothClosed(poly), poly };
}

/**
 * Canvas = a free-form firelight diagram. Each project is an organic REGION whose boundary is
 * computed from its task positions (hull + padding + smoothing) so tasks are always contained.
 * Force layout places regions across 2D; dependencies/A2A are curved trails/sparks. Pan + zoom.
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

  /** Force layout: repulsion + dependency springs + gravity. Region radius from task count. */
  private readonly layout = computed<Map<string, Node>>(() => {
    const projects = this.store.projects();
    const rels = this.store.relationships();
    const counts = this.counts();
    const n = projects.length;
    if (n === 0) return new Map();
    const radius = (id: string) => {
      const c = Math.min(counts.get(id) ?? 0, 5);
      return Math.max(96, (c * ROW) / 2 + PAD + EH / 2 + 30);
    };
    const nodes: Node[] = projects.map((p, i) => {
      const a = (i / n) * Math.PI * 2;
      return { id: p.id, r: radius(p.id), x: Math.cos(a) * 340, y: Math.sin(a) * 250 };
    });
    const idx = new Map(nodes.map((nd, i) => [nd.id, i] as const));
    const edges = rels.map((r) => [idx.get(r.from), idx.get(r.to)] as const)
      .filter((e): e is readonly [number, number] => e[0] != null && e[1] != null);

    for (let it = 0; it < 340; it++) {
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const a = nodes[i]!, b = nodes[j]!;
        const dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy) || 0.01;
        const rep = 48000 / (d * d);
        a.x += (dx / d) * rep; a.y += (dy / d) * rep; b.x -= (dx / d) * rep; b.y -= (dy / d) * rep;
        const minD = a.r + b.r + 80;
        if (d < minD) { const push = (minD - d) / 2; a.x += (dx / d) * push; a.y += (dy / d) * push; b.x -= (dx / d) * push; b.y -= (dy / d) * push; }
      }
      for (const [ai, bi] of edges) {
        const a = nodes[ai]!, b = nodes[bi]!;
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01;
        const k = (d - (a.r + b.r + 130)) * 0.02;
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
      const projItems = items.filter((w) => w.projectId === p.id)
        .sort((a, b) => (a.state === 'in_flow' ? 0 : 1) - (b.state === 'in_flow' ? 0 : 1));
      const activeCount = projItems.filter((w) => w.state === 'in_flow').length;
      const shown = projItems.slice(0, 5);

      // tidy vertical stack of embers centered on the node, shifted down to leave label room
      const stackTop = nd.y + LABEL_GAP - ((shown.length - 1) * ROW) / 2;
      const embers: Ember[] = shown.map((w, i) => {
        const flow = this.store.flowFor(w);
        return {
          id: w.id, title: w.title, state: w.state,
          step: flow?.currentStep ? this.abbr(flow.currentStep) : undefined,
          x: nd.x, y: stackTop + i * ROW,
        };
      });

      // boundary contains every ember box corner (+ a label anchor point at top)
      const pts: P[] = [];
      for (const e of embers) {
        pts.push({ x: e.x - EW / 2, y: e.y - EH / 2 }, { x: e.x + EW / 2, y: e.y - EH / 2 },
                 { x: e.x - EW / 2, y: e.y + EH / 2 }, { x: e.x + EW / 2, y: e.y + EH / 2 });
      }
      pts.push({ x: nd.x, y: nd.y - 8 }); // pull the top in toward the label
      if (!embers.length) pts.push({ x: nd.x, y: nd.y });
      const { path: blob, poly } = regionBoundary(pts, nd.x, nd.y, p.id);
      const top = Math.min(...poly.map((q) => q.y)) - 4;

      return {
        id: p.id, name: p.name,
        active: activeCount > 0, ghost: p.regStatus === 'proposed',
        flagged: flagged.has(p.id), selected: sel === p.id,
        activeCount, embers, extra: Math.max(0, projItems.length - shown.length),
        cx: nd.x, cy: nd.y, top, blob, poly,
      };
    });
  });

  protected readonly fieldWidth = computed(() => {
    const r = this.regions();
    return (r.length ? Math.max(...r.map((x) => x.cx + EW)) : 0) + MARGIN;
  });
  protected readonly fieldHeight = computed(() => {
    const r = this.regions();
    return (r.length ? Math.max(...r.map((x) => x.cy + 160)) : 0) + MARGIN;
  });

  /** Pairs of projects that share a contextId = an A2A flow channel (its trail gets a spark). */
  private readonly flowPairs = computed(() => {
    const byCtx = new Map<string, Set<string>>();
    for (const w of this.store.workItems()) {
      if (!w.contextId) continue;
      const s = byCtx.get(w.contextId) ?? new Set<string>(); s.add(w.projectId); byCtx.set(w.contextId, s);
    }
    const pairs = new Set<string>();
    for (const projSet of byCtx.values()) {
      const ids = [...projSet];
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        pairs.add([ids[i], ids[j]].sort().join('|'));
      }
    }
    return pairs;
  });

  /** Dependency trails, anchored precisely on each region's drawn boundary; A2A rides them. */
  protected readonly trails = computed<Trail[]>(() => {
    const byId = new Map(this.regions().map((g) => [g.id, g]));
    const flow = this.flowPairs();
    return this.store.relationships().map((r) => {
      const a = byId.get(r.from), b = byId.get(r.to);
      if (!a || !b) return null;
      const s = rayHit(a.cx, a.cy, a.poly, b.cx, b.cy); // exact point on A's boundary toward B
      const e = rayHit(b.cx, b.cy, b.poly, a.cx, a.cy); // exact point on B's boundary toward A
      const ang = Math.atan2(e.y - s.y, e.x - s.x);
      const mx = (s.x + e.x) / 2, my = (s.y + e.y) / 2;
      const off = 22 * wobble(r.id || `${r.from}-${r.to}`);
      const px = mx + Math.cos(ang + Math.PI / 2) * off, py = my + Math.sin(ang + Math.PI / 2) * off;
      return {
        id: r.id, proposed: r.status === 'proposed',
        hasFlow: flow.has([r.from, r.to].sort().join('|')),
        d: `M ${s.x.toFixed(1)} ${s.y.toFixed(1)} Q ${px.toFixed(1)} ${py.toFixed(1)} ${e.x.toFixed(1)} ${e.y.toFixed(1)}`,
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
    return !!el && (!!el.closest('.emb') || (el as SVGElement).classList?.contains('rim'));
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
