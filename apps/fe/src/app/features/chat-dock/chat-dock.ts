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
import { ChatStore } from '../../data-access/chat-store';
import { WorkspaceStore } from '../../data-access/workspace-store';
import { UiState } from '../../data-access/ui-state';

/**
 * Bottom chat dock: 똘이(central) + per-task threads over the canvas. Owns only dock
 * LAYOUT state (open/height/focus); conversation state lives in ChatStore (SRP).
 */
@Component({
  selector: 'app-chat-dock',
  templateUrl: './chat-dock.html',
  styleUrl: './chat-dock.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatDock {
  protected readonly chat = inject(ChatStore);
  private readonly workspace = inject(WorkspaceStore);
  private readonly ui = inject(UiState);
  private readonly promptInput = viewChild<ElementRef<HTMLInputElement>>('q');

  /** Dock height (px) — fixed by default, user-resizable by dragging the top grip. */
  protected readonly dockOpen = signal(true);
  protected readonly dockHeight = signal(320);
  protected readonly pending = computed(() => this.workspace.openDecisions().length);

  protected openQuestions(): void {
    this.ui.openQuestions();
  }

  protected toggleDock(): void {
    this.dockOpen.update((v) => !v);
  }

  protected send(text: string): void {
    if (!this.dockOpen()) this.dockOpen.set(true);
    this.chat.send(text);
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

  constructor() {
    // "+ 프로젝트" (or anything bumping composerFocusTick) → open + focus the dock prompt.
    effect(() => {
      if (this.ui.composerFocusTick() > 0) {
        this.dockOpen.set(true);
        this.promptInput()?.nativeElement.focus();
      }
    });
  }
}
