import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { Feedback } from './feedback';
import { BlazewritApi, type FeedbackVm } from '../../data-access/api';

const ITEMS: FeedbackVm[] = [
  { id: '1', category: 'ui', content: '표 화면 없음', request: '표로 보여줘', status: 'done', createdAt: '2026-07-01T00:00:00Z' },
  { id: '2', category: 'feature', content: '스케줄러 없음', request: '', status: 'open', createdAt: '2026-07-02T00:00:00Z' },
];

function setup(feedback = () => of(ITEMS)) {
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), { provide: BlazewritApi, useValue: { feedback: vi.fn(feedback) } }],
    imports: [Feedback],
  });
  const fixture = TestBed.createComponent(Feedback);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

describe('Feedback board', () => {
  it('renders one row per feedback with the Korean category label', () => {
    const { el } = setup();
    const items = el.querySelectorAll('.fb-item');
    expect(items.length).toBe(2);
    expect(items[0]?.querySelector('.cat')?.textContent).toContain('화면 없음');
    expect(items[1]?.querySelector('.cat')?.textContent).toContain('기능 없음');
    expect(items[0]?.querySelector('.req')?.textContent).toContain('표로 보여줘');
    expect(items[1]?.querySelector('.req')).toBeNull(); // request 없는 항목은 줄 생략
  });

  it('shows the empty state when there is no feedback', () => {
    const { el } = setup(() => of([]));
    expect(el.querySelector('.fb-empty')?.textContent).toContain('아직 기록된 피드백이 없습니다');
  });

  it('shows an alert on load failure', () => {
    const { el } = setup(() => throwError(() => new Error('boom')));
    expect(el.querySelector('.fb-error')?.textContent).toContain('피드백 로드 실패');
  });
});
