import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  effect,
  HostListener,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormRecord, ReactiveFormsModule, Validators } from '@angular/forms';
import type { DecisionRequestDto } from '@bw/dto';
import { WorkspaceStore } from '../../data-access/workspace-store';
import { UiState } from '../../data-access/ui-state';

/**
 * Question inbox as a right-overlay drawer with focused triage: the agent's questions
 * surface here (header badge → slide-in) instead of stacking inline and pushing the
 * canvas down. One question is "focused" at full detail; the rest wait in a compact
 * queue. Answering advances to the next. Esc / backdrop closes; ↑↓ moves focus.
 */
@Component({
  selector: 'app-question-drawer',
  imports: [ReactiveFormsModule],
  templateUrl: './question-drawer.html',
  styleUrl: './question-drawer.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuestionDrawer {
  private readonly store = inject(WorkspaceStore);
  private readonly ui = inject(UiState);
  private readonly cdr = inject(ChangeDetectorRef);

  protected readonly open = this.store.openDecisions;
  protected readonly isOpen = this.ui.questionDrawerOpen;

  /** Index of the focused question within the open queue. */
  private readonly focusIndex = signal(0);

  /** The question shown at full detail (clamped to the live queue length). */
  protected readonly current = computed<DecisionRequestDto | null>(() => {
    const list = this.open();
    if (list.length === 0) return null;
    const i = Math.min(this.focusIndex(), list.length - 1);
    return list[i] ?? null;
  });
  /** The remaining questions, shown as a compact queue. */
  protected readonly queue = computed(() => {
    const cur = this.current();
    return this.open().filter((d) => d.id !== cur?.id);
  });

  /** One control per free-text decision, keyed by decision id. */
  protected readonly answers = new FormRecord<FormControl<string>>({});
  /** Local multi-select state, keyed by decision id → chosen option values. */
  protected readonly selections = signal<Record<string, readonly string[]>>({});

  constructor() {
    effect(() => {
      for (const d of this.open()) {
        if (d.requestType === 'free_text' && !this.answers.contains(d.id)) {
          this.answers.addControl(
            d.id,
            new FormControl('', { nonNullable: true, validators: [Validators.required] }),
          );
        }
      }
    });
    // Keep the focus index valid as the queue drains; reset to top when the drawer opens.
    effect(() => {
      if (this.isOpen()) this.focusIndex.set(0);
    });
    this.answers.events.pipe(takeUntilDestroyed()).subscribe(() => this.cdr.markForCheck());
  }

  @HostListener('document:keydown', ['$event'])
  protected onKey(e: KeyboardEvent): void {
    if (!this.isOpen()) return;
    if (e.key === 'Escape') {
      this.ui.closeQuestions();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.focusIndex.update((i) => Math.min(i + 1, this.open().length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.focusIndex.update((i) => Math.max(i - 1, 0));
    }
  }

  protected close(): void {
    this.ui.closeQuestions();
  }

  protected focusQuestion(id: string): void {
    const idx = this.open().findIndex((d) => d.id === id);
    if (idx >= 0) this.focusIndex.set(idx);
  }

  protected answer(id: string, value: string): void {
    this.store.answerDecision(id, value);
  }

  protected submitText(id: string): void {
    const control = this.answers.controls[id];
    if (control?.valid) this.store.answerDecision(id, control.value.trim());
  }

  protected isSelected(id: string, value: string): boolean {
    return (this.selections()[id] ?? []).includes(value);
  }

  protected toggle(id: string, value: string): void {
    this.selections.update((s) => {
      const current = s[id] ?? [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...s, [id]: next };
    });
  }

  protected submitMulti(id: string): void {
    const values = this.selections()[id] ?? [];
    if (values.length) this.store.answerDecision(id, values.join(','));
  }

  protected selectionCount(id: string): number {
    return (this.selections()[id] ?? []).length;
  }
}
