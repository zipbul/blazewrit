import { ChangeDetectionStrategy, Component, ElementRef, inject, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { filter, skip } from 'rxjs';
import { WorkspaceStore } from '../../data-access/workspace-store';
import { LiveSync } from '../../data-access/live-sync';
import { QuestionDrawer } from '../../features/questions/question-drawer';
import { ChatDock } from '../../features/chat-dock/chat-dock';

/** App layout only: header/nav + routed stage + question drawer + chat dock (SRP — no domain state). */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, QuestionDrawer, ChatDock],
  templateUrl: './shell.html',
  styleUrl: './shell.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Shell {
  private readonly store = inject(WorkspaceStore);
  private readonly live = inject(LiveSync);
  private readonly router = inject(Router);
  private readonly main = viewChild<ElementRef<HTMLElement>>('main');

  protected readonly loadError = this.store.loadError;

  constructor() {
    this.live.start(); // subscribe to backend SSE → real-time mirror

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
