import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormRecord, ReactiveFormsModule, Validators } from '@angular/forms';
import { WorkspaceStore } from '../../data-access/workspace-store';

@Component({
  selector: 'app-decisions',
  imports: [ReactiveFormsModule],
  templateUrl: './decisions.html',
  styleUrl: './decisions.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Decisions {
  private readonly store = inject(WorkspaceStore);
  private readonly cdr = inject(ChangeDetectorRef);

  protected readonly open = this.store.openDecisions;

  /** One control per free-text decision, keyed by decision id (official Reactive Forms). */
  protected readonly answers = new FormRecord<FormControl<string>>({});

  /** Local multi-select state, keyed by decision id → chosen option values. */
  protected readonly selections = signal<Record<string, readonly string[]>>({});

  constructor() {
    // Add a control as each free-text decision appears.
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
    // Zoneless: bridge form value/status events to change detection (official guidance).
    this.answers.events.pipe(takeUntilDestroyed()).subscribe(() => this.cdr.markForCheck());
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
