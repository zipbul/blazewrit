import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { filter, skip } from 'rxjs';
import { WorkspaceStore } from '../../data-access/workspace-store';
import { LiveSync } from '../../data-access/live-sync';
import { UiState } from '../../data-access/ui-state';
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
  private readonly router = inject(Router);
  private readonly main = viewChild<ElementRef<HTMLElement>>('main');
  private readonly promptInput = viewChild<ElementRef<HTMLInputElement>>('q');

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

  /** Center prompt: hand the raw intent to blazewrit (meta agent triages + routes + runs). */
  protected submitIntent(text: string): void {
    const intent = text.trim();
    if (intent) this.store.submitIntent(intent);
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
