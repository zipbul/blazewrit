import { Injectable, signal } from '@angular/core';

/** Cross-component UI state for transient overlays (question drawer, etc.). Root singleton. */
@Injectable({ providedIn: 'root' })
export class UiState {
  /** Whether the question inbox drawer is open. */
  readonly questionDrawerOpen = signal(false);

  /** Bumped to request the shell focus the center composer (e.g. "+ 프로젝트"). */
  readonly composerFocusTick = signal(0);

  openQuestions(): void {
    this.questionDrawerOpen.set(true);
  }
  closeQuestions(): void {
    this.questionDrawerOpen.set(false);
  }
  toggleQuestions(): void {
    this.questionDrawerOpen.update((v) => !v);
  }
  focusComposer(): void {
    this.composerFocusTick.update((t) => t + 1);
  }
}
