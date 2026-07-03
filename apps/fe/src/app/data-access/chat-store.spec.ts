import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import type { WorkItemDto } from '@bw/dto';
import { ChatStore } from './chat-store';
import { BlazewritApi, type ChatTurnVm, type IntentVm, type TableVm } from './api';
import { WorkspaceStore } from './workspace-store';
import { UiState } from './ui-state';

const ISO = '2026-07-01T00:00:00Z';
const wi = (id: string, title: string, state: string): WorkItemDto =>
  ({ id, projectId: 'p', title, description: '', type: 'task', labels: [], state, priority: 1, source: 'user', createdAt: ISO, updatedAt: ISO }) as unknown as WorkItemDto;

const INTENT: IntentVm = {
  summary: 's', flowType: 'feature', targetProject: '결제', isNewProject: false,
  suggestedProjectName: null, relatedProjects: [], needsClarification: false,
  clarifyingQuestion: null, clarifyOptions: [], confidence: 0.9, rationale: 'r',
};

function setup(items: WorkItemDto[] = [], history: ChatTurnVm[] = []) {
  type Turn = { reply: string; intent: IntentVm | null; feedback: null; view: TableVm | null };
  const api = {
    triage: vi.fn(() => of<Turn>({ reply: '응답', intent: null, feedback: null, view: null })),
    dispatch: vi.fn(() => of({ accepted: true })),
    clarify: vi.fn(() => of({ accepted: true, decisionId: 'd1' })),
    chatHistory: vi.fn(() => of(history)),
  };
  const workspace = { workItems: signal(items), reload: vi.fn() };
  const ui = { openQuestions: vi.fn(), composerFocusTick: signal(0) };
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: BlazewritApi, useValue: api },
      { provide: WorkspaceStore, useValue: workspace },
      { provide: UiState, useValue: ui },
    ],
  });
  return { store: TestBed.inject(ChatStore), api, workspace, ui };
}

describe('ChatStore threads', () => {
  it('always exposes 똘이(central) first, then one tab per in-flow work item', () => {
    const { store } = setup([wi('a', 'A작업', 'in_flow'), wi('b', 'B작업', 'done'), wi('c', 'C작업', 'in_flow')]);
    const t = store.threads();
    expect(t[0]).toEqual({ id: 'central', label: '똘이', kind: 'central' });
    expect(t.slice(1).map((x) => x.id)).toEqual(['a', 'c']); // done 제외
  });

  it('caps task tabs at 8', () => {
    const many = Array.from({ length: 12 }, (_, i) => wi(`t${i}`, `작업${i}`, 'in_flow'));
    const { store } = setup(many);
    expect(store.threads().length).toBe(1 + 8);
  });

  it('falls back to central when the active thread disappears', () => {
    const { store } = setup([wi('a', 'A', 'in_flow')]);
    store.setActive('a');
    expect(store.active().id).toBe('a');
    TestBed.inject(WorkspaceStore).workItems.set([]);
    expect(store.active().id).toBe('central');
  });
});

describe('ChatStore hydration (server = source of truth)', () => {
  it('hydrates central on startup and renders persisted turns incl. table payload', () => {
    const view: TableVm = { title: '현황', columns: ['c'], rows: [['v']] };
    const { store, api } = setup([], [
      { seq: 1, role: 'user', text: '이전 질문', payload: null, createdAt: ISO },
      { seq: 2, role: 'agent', text: '이전 답', payload: { view }, createdAt: ISO },
    ]);
    expect(api.chatHistory).toHaveBeenCalledWith('central');
    expect(store.activeMsgs().map((m) => m.text)).toEqual(['이전 질문', '이전 답']);
    expect(store.activeMsgs()[1]?.table).toEqual(view);
  });

  it('hydrates a task thread on first activation only', () => {
    const { store, api } = setup([wi('a', 'A작업', 'in_flow')]);
    store.setActive('a');
    store.setActive('central');
    store.setActive('a');
    const calls = api.chatHistory.mock.calls.map((c: unknown[]) => c[0]);
    expect(calls.filter((s) => s === 'a').length).toBe(1);
  });
});

describe('ChatStore send', () => {
  it('sends {request, scope, clientMsgId} — no prefix hack', () => {
    const { store, api } = setup([wi('a', 'A작업', 'in_flow')]);
    store.setActive('a');
    store.send('진행해줘');
    expect(api.triage).toHaveBeenCalledTimes(1);
    const [req, scope, cmid] = api.triage.mock.calls[0] as unknown as [string, string, string];
    expect(req).toBe('진행해줘'); // 원문 그대로 — '[작업:…]' 오염 없음
    expect(scope).toBe('a');
    expect(typeof cmid).toBe('string');
  });

  it('keeps thread histories isolated', () => {
    const { store } = setup([wi('a', 'A작업', 'in_flow')]);
    store.send('중앙 메시지');
    store.setActive('a');
    expect(store.activeMsgs().map((m) => m.text)).not.toContain('중앙 메시지');
  });

  it('ignores blank input and blocks a second send while thinking', () => {
    const { store, api } = setup();
    store.send('   ');
    expect(api.triage).not.toHaveBeenCalled();
    api.triage.mockReturnValue(new Subject());
    store.send('첫번째');
    store.send('두번째');
    expect(api.triage).toHaveBeenCalledTimes(1);
  });

  it('stores the intent and attaches the table view to the agent message', () => {
    const view: TableVm = { title: 't', columns: ['c'], rows: [['v']] };
    const { store, api } = setup();
    api.triage.mockReturnValue(of({ reply: '표', intent: INTENT, feedback: null, view }));
    store.send('보여줘');
    expect(store.activeIntent()).toEqual(INTENT);
    expect(store.activeMsgs().at(-1)?.table).toEqual(view);
  });

  it('surfaces the backend error body on failure', () => {
    const { store, api } = setup();
    api.triage.mockReturnValue(throwError(() => ({ error: { error: '터짐' } })));
    store.send('x');
    expect(store.chatError()).toBe('터짐');
    expect(store.thinking()).toBe(false);
  });
});

describe('ChatStore proceed / clarify (server-side confirmation turns)', () => {
  function primed(intent: IntentVm) {
    const s = setup();
    s.api.triage.mockReturnValue(of({ reply: 'r', intent, feedback: null, view: null }));
    s.store.send('요청');
    s.api.chatHistory.mockClear();
    return s;
  }

  it('dispatches with the scope and RE-HYDRATES (no locally fabricated ✓ bubble)', () => {
    const { store, api, workspace } = primed(INTENT);
    store.proceed();
    expect(api.dispatch).toHaveBeenCalledWith('요청', { targetProject: '결제', flowType: 'feature' }, 'central');
    expect(store.activeIntent()).toBeNull();
    expect(api.chatHistory).toHaveBeenCalledWith('central'); // 서버 확인 턴을 끌어옴
    expect(workspace.reload).toHaveBeenCalled();
  });

  it('proposes a new project when the intent says so', () => {
    const { store, api } = primed({ ...INTENT, isNewProject: true, targetProject: null, suggestedProjectName: '재고' });
    store.proceed();
    expect(api.dispatch).toHaveBeenCalledWith('요청', { newProjectName: '재고' }, 'central');
  });

  it('does nothing without a pending intent', () => {
    const { store, api } = setup();
    store.proceed();
    expect(api.dispatch).not.toHaveBeenCalled();
  });

  it('routes an ambiguous intent to the drawer with the scope and opens the inbox', () => {
    const { store, api, ui } = primed({ ...INTENT, needsClarification: true, clarifyingQuestion: '어느 쪽?', clarifyOptions: ['a'] });
    store.askClarification();
    expect(api.clarify).toHaveBeenCalledWith('요청', '어느 쪽?', ['a'], 'central');
    expect(ui.openQuestions).toHaveBeenCalled();
  });
});
