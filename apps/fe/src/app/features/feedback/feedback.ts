import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { BlazewritApi, type FeedbackVm } from '../../data-access/api';

/** Simple board of agent-logged platform limitations (ui / feature / unmet) — the self-improvement backlog. */
@Component({
  selector: 'app-feedback',
  imports: [DatePipe],
  templateUrl: './feedback.html',
  styleUrl: './feedback.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Feedback {
  private readonly api = inject(BlazewritApi);

  protected readonly items = signal<readonly FeedbackVm[]>([]);
  protected readonly error = signal<string | null>(null);

  protected label(category: FeedbackVm['category']): string {
    return category === 'ui' ? '화면 없음' : category === 'feature' ? '기능 없음' : '요구 미충족';
  }

  constructor() {
    this.api.feedback().subscribe({
      next: (v) => this.items.set(v),
      error: (err: unknown) =>
        this.error.set(`피드백 로드 실패: ${err instanceof Error ? err.message : String(err)}`),
    });
  }
}
