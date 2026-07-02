import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import type { WorkItemDto } from '@bw/dto';
import { ChatDock } from './chat-dock';
import { BlazewritApi } from '../../data-access/api';
import { WorkspaceStore } from '../../data-access/workspace-store';
import { UiState } from '../../data-access/ui-state';

const ISO = '2026-07-01T00:00:00Z';
const wi = (id: string, title: string): WorkItemDto =>
  ({ id, projectId: 'p', title, description: '', type: 'task', labels: [], state: 'in_flow', priority: 1, source: 'user', createdAt: ISO, updatedAt: ISO }) as unknown as WorkItemDto;

function setup() {
  const api = {
    triage: vi.fn(() => of({ reply: '표 응답', intent: null, feedback: null, view: { title: '현황', columns: ['이름'], rows: [['결제']] } })),
    chatHistory: vi.fn(() => of([])),
    dispatch: vi.fn(() => of({ accepted: true })),
    clarify: vi.fn(() => of({ accepted: true, decisionId: 'd' })),
  };
  const workspace = { workItems: signal([wi('a', 'A작업')]), openDecisions: signal([]), reload: vi.fn() };
  const ui = { openQuestions: vi.fn(), composerFocusTick: signal(0) };
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: BlazewritApi, useValue: api },
      { provide: WorkspaceStore, useValue: workspace },
      { provide: UiState, useValue: ui },
    ],
    imports: [ChatDock],
  });
  const fixture = TestBed.createComponent(ChatDock);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, api };
}

describe('ChatDock', () => {
  it('renders 똘이 + one tab per in-flow work item', () => {
    const { el } = setup();
    const tabs = Array.from(el.querySelectorAll('.dtab')).map((t) => t.textContent?.trim());
    expect(tabs[0]).toContain('똘이');
    expect(tabs[1]).toContain('A작업');
  });

  it('switches the composer placeholder when a task tab is selected', () => {
    const { fixture, el } = setup();
    (el.querySelectorAll('.dtab')[1] as HTMLButtonElement).click();
    fixture.detectChanges();
    const input = el.querySelector('.dcompose input') as HTMLInputElement;
    expect(input.placeholder).toContain('A작업');
  });

  it('sends via the composer and renders the reply + the agent table', async () => {
    const { fixture, el, api } = setup();
    const input = el.querySelector('.dcompose input') as HTMLInputElement;
    input.value = '현황 보여줘';
    (el.querySelector('.dcompose') as HTMLFormElement).dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    expect((api.triage.mock.calls[0] as unknown as [string])[0]).toBe('현황 보여줘');
    expect(el.textContent).toContain('표 응답');
    expect(el.querySelector('.dtable .dt-title')?.textContent).toContain('현황');
    expect(el.querySelector('.dtable td')?.textContent).toContain('결제');
  });

  it('collapses to the tab strip when toggled', () => {
    const { fixture, el } = setup();
    (el.querySelector('.dock-toggle') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.dock-body')).toBeNull();
    expect(el.querySelector('.dock')?.classList.contains('collapsed')).toBe(true);
  });
});
