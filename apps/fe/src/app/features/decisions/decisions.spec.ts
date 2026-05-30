import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { DecisionRequestDto } from '@bw/dto';
import { Decisions } from './decisions';
import { WorkspaceStore } from '../../data-access/workspace-store';

const open: DecisionRequestDto[] = [
  {
    id: 'dec1', flowId: 'f144', requestingAgent: 'decide', status: 'open', requestType: 'single_choice',
    question: '캐시 TTL 정책?', options: [
      { label: '전역', value: 'global', risk: 'high' },
      { label: '점진', value: 'gradual', risk: 'low', recommended: true },
    ], context: { why_asking: 'breaking change' }, blocking: true, risk: 'high', createdAt: '2026-05-29T00:00:00Z',
  },
  {
    id: 'dec3', flowId: 'f142', requestingAgent: 'decide', status: 'open', requestType: 'free_text',
    question: 'fallback 정의?', options: [], context: {}, blocking: false, risk: 'low', createdAt: '2026-05-29T00:00:00Z',
  },
];

function makeStore() {
  const answered: Array<{ id: string; value: string }> = [];
  const stub = {
    openDecisions: signal(open),
    answerDecision: (id: string, value: string) => answered.push({ id, value }),
  } as unknown as WorkspaceStore;
  return { stub, answered };
}

describe('Decisions', () => {
  let answered: Array<{ id: string; value: string }>;

  beforeEach(async () => {
    const { stub, answered: a } = makeStore();
    answered = a;
    await TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), { provide: WorkspaceStore, useValue: stub }],
      imports: [Decisions],
    }).compileComponents();
  });

  it('creates', () => {
    expect(TestBed.createComponent(Decisions).componentInstance).toBeTruthy();
  });

  it('renders a card per open decision with its options', () => {
    const fixture = TestBed.createComponent(Decisions);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.card').length).toBe(2);
    expect(el.querySelectorAll('.opt').length).toBe(2);
    expect(el.querySelector('.opt.recommended')).toBeTruthy();
  });

  it('answers a single-choice decision with the chosen option value', () => {
    const fixture = TestBed.createComponent(Decisions);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    (el.querySelector('.opt') as HTMLButtonElement).click();
    expect(answered).toEqual([{ id: 'dec1', value: 'global' }]);
  });

  it('renders a reactive textarea for free-text decisions', () => {
    const fixture = TestBed.createComponent(Decisions);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.ta')).toBeTruthy();
    // submit disabled while the required control is empty
    const submit = Array.from(el.querySelectorAll('.answer .btn.ok')).find(
      (b) => (b as HTMLButtonElement).textContent?.includes('제출'),
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });
});
