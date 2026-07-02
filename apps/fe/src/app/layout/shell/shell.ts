import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { filter, skip } from 'rxjs';
import { WorkspaceStore } from '../../data-access/workspace-store';
import { LiveSync } from '../../data-access/live-sync';
import { UiState } from '../../data-access/ui-state';
import { BlazewritApi, type IntentVm } from '../../data-access/api';
import { QuestionDrawer } from '../../features/questions/question-drawer';

interface ChatMsg {
  readonly role: 'me' | 'agent';
  readonly text: string;
}
interface Thread {
  readonly id: string;
  readonly label: string;
  readonly kind: 'central' | 'task';
  readonly project?: string;
}

const CENTRAL: Thread = { id: 'central', label: '똘이', kind: 'central' };

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, QuestionDrawer],
  templateUrl: './shell.html',
  styleUrl: './shell.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Shell {
  private readonly store = inject(WorkspaceStore);
  private readonly live = inject(LiveSync);
  private readonly ui = inject(UiState);
  private readonly api = inject(BlazewritApi);
  private readonly router = inject(Router);
  private readonly main = viewChild<ElementRef<HTMLElement>>('main');
  private readonly promptInput = viewChild<ElementRef<HTMLInputElement>>('q');

  /** Bottom chat dock: central + per-task threads, collapsible. Canvas/header/drawer unchanged. */
  protected readonly dockOpen = signal(true);
  /** Dock height (px) — fixed by default, user-resizable by dragging the top grip. */
  protected readonly dockHeight = signal(320);
  protected readonly activeId = signal<string>('central');
  protected readonly thinking = signal(false);
  protected readonly chatError = signal<string | null>(null);
  protected readonly dispatching = signal(false);
  /** Per-thread message history, proposed intent, and the request the intent was derived from. */
  private readonly msgs = signal<Record<string, ChatMsg[]>>({ central: [] });
  private readonly intents = signal<Record<string, IntentVm | null>>({});
  private readonly requests = signal<Record<string, string>>({});

  /** 중앙 + a tab per in-flow work item (capped). Reuses existing store data; no canvas change. */
  protected readonly threads = computed<Thread[]>(() => {
    const tasks = this.store
      .workItems()
      .filter((w) => w.state === 'in_flow')
      .slice(0, 8)
      .map<Thread>((w) => ({ id: w.id, label: w.title, kind: 'task', project: w.projectId }));
    return [CENTRAL, ...tasks];
  });
  protected readonly active = computed<Thread>(
    () => this.threads().find((t) => t.id === this.activeId()) ?? CENTRAL,
  );
  protected readonly activeMsgs = computed<ChatMsg[]>(() => this.msgs()[this.activeId()] ?? []);
  protected readonly activeIntent = computed<IntentVm | null>(() => this.intents()[this.activeId()] ?? null);

  protected readonly connections = this.store.connections;
  protected readonly loadError = this.store.loadError;
  protected readonly pending = computed(() => this.store.openDecisions().length);
  protected readonly liveAgents = computed(
    () => this.store.connections().filter((c) => c.agentState === 'working').length,
  );

  protected openQuestions(): void {
    this.ui.openQuestions();
  }

  protected setActive(id: string): void {
    this.activeId.set(id);
    this.chatError.set(null);
  }

  protected toggleDock(): void {
    this.dockOpen.update((v) => !v);
  }

  /** Drag the dock's top grip to resize its height (grows upward). */
  protected startResize(ev: PointerEvent): void {
    ev.preventDefault();
    if (!this.dockOpen()) this.dockOpen.set(true);
    const startY = ev.clientY;
    const startH = this.dockHeight();
    const max = Math.round(window.innerHeight * 0.8);
    const move = (e: PointerEvent) => {
      this.dockHeight.set(Math.max(160, Math.min(max, startH + (startY - e.clientY))));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /** Send to the active thread. Task threads scope the message to that work item for the central agent. */
  protected send(text: string): void {
    const body = text.trim();
    if (!body || this.thinking()) return;
    const id = this.activeId();
    const t = this.active();
    const request = t.kind === 'task' ? `[작업: ${t.label}] ${body}` : body;
    if (!this.dockOpen()) this.dockOpen.set(true);
    this.pushMsg(id, { role: 'me', text: body });
    this.setIntent(id, null);
    this.requests.update((r) => ({ ...r, [id]: request }));
    this.thinking.set(true);
    this.chatError.set(null);
    this.api.triage(request).subscribe({
      next: ({ reply, intent }) => {
        this.pushMsg(id, { role: 'agent', text: reply });
        this.setIntent(id, intent);
        this.thinking.set(false);
      },
      error: (err) => {
        this.chatError.set(this.errText(err, '응답에 실패했습니다'));
        this.thinking.set(false);
      },
    });
  }

  /** Approve the proposed intent: dispatch to the resolved project, or propose a new one. */
  protected proceed(): void {
    const id = this.activeId();
    const i = this.intents()[id];
    const request = this.requests()[id];
    if (!i || !request || this.dispatching()) return;
    this.dispatching.set(true);
    this.chatError.set(null);
    const opts =
      i.isNewProject || !i.targetProject
        ? { newProjectName: i.suggestedProjectName ?? request.slice(0, 24) }
        : { targetProject: i.targetProject };
    this.api.dispatch(request, opts).subscribe({
      next: () => this.afterAct(id, '✓ 실행했습니다.'),
      error: (err) => {
        this.chatError.set(this.errText(err, '실행에 실패했습니다'));
        this.dispatching.set(false);
      },
    });
  }

  /** Ambiguous intent: send the agent's question to the drawer inbox (answering it re-triages + routes). */
  protected askClarification(): void {
    const id = this.activeId();
    const i = this.intents()[id];
    const request = this.requests()[id];
    if (!i?.clarifyingQuestion || !request || this.dispatching()) return;
    this.dispatching.set(true);
    this.chatError.set(null);
    this.api.clarify(request, i.clarifyingQuestion, i.clarifyOptions ?? []).subscribe({
      next: () => {
        this.afterAct(id, '❓ 질문함에 등록했습니다.');
        this.ui.openQuestions();
      },
      error: (err) => {
        this.chatError.set(this.errText(err, '질문 등록에 실패했습니다'));
        this.dispatching.set(false);
      },
    });
  }

  protected clearIntent(): void {
    this.setIntent(this.activeId(), null);
  }

  private afterAct(id: string, note: string): void {
    this.dispatching.set(false);
    this.setIntent(id, null);
    this.pushMsg(id, { role: 'agent', text: note });
  }

  private pushMsg(id: string, m: ChatMsg): void {
    this.msgs.update((s) => ({ ...s, [id]: [...(s[id] ?? []), m] }));
  }
  private setIntent(id: string, i: IntentVm | null): void {
    this.intents.update((s) => ({ ...s, [id]: i }));
  }
  private errText(err: unknown, fallback: string): string {
    const e = err as { error?: { error?: unknown } };
    return typeof e?.error?.error === 'string' ? e.error.error : fallback;
  }

  constructor() {
    this.live.start(); // subscribe to backend SSE → real-time mirror

    // "+ 프로젝트" (or anything calling focusComposer) → focus the dock prompt.
    effect(() => {
      if (this.ui.composerFocusTick() > 0) {
        this.dockOpen.set(true);
        this.promptInput()?.nativeElement.focus();
      }
    });

    // Move focus to the main region on USER-initiated navigation (WCAG 2.4.3).
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        skip(1),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.main()?.nativeElement.focus());
  }
}
