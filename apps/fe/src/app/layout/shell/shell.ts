import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { filter, skip } from 'rxjs';
import { WorkspaceStore } from '../../data-access/workspace-store';
import { LiveSync } from '../../data-access/live-sync';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './shell.html',
  styleUrl: './shell.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Shell {
  private readonly store = inject(WorkspaceStore);
  private readonly live = inject(LiveSync);
  private readonly router = inject(Router);
  private readonly main = viewChild<ElementRef<HTMLElement>>('main');

  protected readonly connections = this.store.connections;
  protected readonly loadError = this.store.loadError;
  protected readonly pending = computed(() => this.store.openDecisions().length);
  protected readonly liveAgents = computed(
    () => this.store.connections().filter((c) => c.agentState === 'working').length,
  );

  /** Center prompt: hand the raw intent to blazewrit (meta agent triages + routes + runs). */
  protected submitIntent(text: string, hitl: boolean): void {
    const intent = text.trim();
    if (intent) this.store.submitIntent(intent, hitl);
  }

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
