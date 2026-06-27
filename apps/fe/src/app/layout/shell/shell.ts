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

  /** The central agent's free-text reply to the last message. */
  protected readonly reply = signal<string | null>(null);
  /** Structured intent the agent proposed (only when the message was an actionable work request). */
  protected readonly intent = signal<IntentVm | null>(null);
  protected readonly thinking = signal(false);
  protected readonly chatError = signal<string | null>(null);
  /** The exact message the current intent was proposed for (so proceeding uses it, not edited text). */
  protected readonly analyzedRequest = signal<string>('');
  protected readonly dispatching = signal(false);

  protected readonly connections = this.store.connections;
  protected readonly loadError = this.store.loadError;
  protected readonly pending = computed(() => this.store.openDecisions().length);
  protected readonly liveAgents = computed(
    () => this.store.connections().filter((c) => c.agentState === 'working').length,
  );

  /** Open the question inbox drawer (agent questions surface here, not inline). */
  protected openQuestions(): void {
    this.ui.openQuestions();
  }

  /** Center prompt: talk to the central agent. Free reply + (if actionable) a structured intent card. */
  protected send(text: string): void {
    const request = text.trim();
    if (!request || this.thinking()) return;
    this.thinking.set(true);
    this.chatError.set(null);
    this.reply.set(null);
    this.intent.set(null);
    this.analyzedRequest.set(request);
    this.api.triage(request).subscribe({
      next: ({ reply, intent }) => {
        this.reply.set(reply);
        this.intent.set(intent);
        this.thinking.set(false);
      },
      error: (err) => {
        this.chatError.set(typeof err?.error?.error === 'string' ? err.error.error : '응답에 실패했습니다');
        this.thinking.set(false);
      },
    });
  }

  /** Approve the proposed intent and execute it: dispatch to the resolved project, or propose a new one. */
  protected proceed(): void {
    const i = this.intent();
    const request = this.analyzedRequest();
    if (!i || !request || this.dispatching()) return;
    this.dispatching.set(true);
    this.chatError.set(null);

    const opts =
      i.isNewProject || !i.targetProject
        ? { newProjectName: i.suggestedProjectName ?? request.slice(0, 24) }
        : { targetProject: i.targetProject };
    this.api.dispatch(request, opts).subscribe({
      next: () => this.afterProceed(),
      error: (err) => {
        this.chatError.set(typeof err?.error?.error === 'string' ? err.error.error : '실행에 실패했습니다');
        this.dispatching.set(false);
      },
    });
  }

  /** Ambiguous intent: send the agent's question to the drawer inbox (answering it re-triages + routes). */
  protected askClarification(): void {
    const i = this.intent();
    const request = this.analyzedRequest();
    if (!i?.clarifyingQuestion || !request || this.dispatching()) return;
    this.dispatching.set(true);
    this.chatError.set(null);
    this.api.clarify(request, i.clarifyingQuestion, i.clarifyOptions ?? []).subscribe({
      next: () => {
        this.afterProceed();
        this.ui.openQuestions();
      },
      error: (err) => {
        this.chatError.set(typeof err?.error?.error === 'string' ? err.error.error : '질문 등록에 실패했습니다');
        this.dispatching.set(false);
      },
    });
  }

  private afterProceed(): void {
    this.dispatching.set(false);
    this.intent.set(null);
    this.reply.set(null);
    this.analyzedRequest.set('');
    this.chatError.set(null);
  }

  /** Dismiss the agent's reply + proposed intent. */
  protected clearIntent(): void {
    this.intent.set(null);
    this.reply.set(null);
    this.chatError.set(null);
  }

  constructor() {
    this.live.start(); // subscribe to backend SSE → real-time mirror

    // "+ 프로젝트" (or anything calling focusComposer) → focus the center prompt.
    effect(() => {
      if (this.ui.composerFocusTick() > 0) this.promptInput()?.nativeElement.focus();
    });

    // Move focus to the main region on USER-initiated navigation (WCAG 2.4.3).
    // skip(1) leaves the initial load's focus at document start so the skip-link is the first tab stop.
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        skip(1),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.main()?.nativeElement.focus());
  }
}
