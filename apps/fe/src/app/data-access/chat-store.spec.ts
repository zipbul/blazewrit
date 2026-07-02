import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import type { WorkItemDto } from '@bw/dto';
import { ChatStore } from './chat-store';
import { BlazewritApi, type IntentVm, type TableVm } from './api';
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

interface ApiStub {
  triage: ReturnType<typeof vi.fn>;
  dispatch: ReturnType<typeof vi.fn>;
  clarify: ReturnType<typeof vi.fn>;
}

function setup(items: WorkItemDto[] = []) {
  const api: ApiStub = {
    triage: vi.fn(() => of({ reply: '응답', intent: null, feedback: null, view: null })),
    dispatch: vi.fn(() => of({ accepted: true })),
    clarify: vi.fn(() => of({ accepted: true, decisionId: 'd1' })),
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
    // work item leaves in_flow → thread gone → active falls back
    TestBed.inject(WorkspaceStore).workItems.set([]);
    expect(store.active().id).toBe('central');
  });
});

describe('ChatStore send', () => {
  it('pushes my message + the agent reply into the ACTIVE thread only', () => {
    const { store, api } = setup([wi('a', 'A작업', 'in_flow')]);
    store.send('안녕');
    expect(api.triage).toHaveBeenCalledWith('안녕');
    expect(store.activeMsgs().map((m) => m.role)).toEqual(['me', 'agent']);
    store.setActive('a');
    expect(store.activeMsgs()).toEqual([]); // 다른 스레드는 오염 없음
  });

  it('scopes a task-thread message with the work-item title', () => {
    const { store, api } = setup([wi('a', 'A작업', 'in_flow')]);
    store.setActive('a');
    store.send('진행해줘');
    expect(api.triage).toHaveBeenCalledWith('[작업: A작업] 진행해줘');
  });

  it('ignores blank input and does not call the API', () => {
    const { store, api } = setup();
    store.send('   ');
    expect(api.triage).not.toHaveBeenCalled();
  });

  it('blocks a second send while thinking', () => {
    const { store, api } = setup();
    api.triage.mockReturnValue(new Subject()); // never resolves
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

describe('ChatStore proceed / clarify', () => {
  function primed(intent: IntentVm) {
    const s = setup();
    s.api.triage.mockReturnValue(of({ reply: 'r', intent, feedback: null, view: null }));
    s.store.send('요청');
    return s;
  }

  it('dispatches to the resolved existing project', () => {
    const { store, api, workspace } = primed(INTENT);
    store.proceed();
    expect(api.dispatch).toHaveBeenCalledWith('요청', { targetProject: '결제' });
    expect(store.activeIntent()).toBeNull(); // 카드 정리
    expect(workspace.reload).toHaveBeenCalled();
  });

  it('proposes a new project when the intent says so', () => {
    const { store, api } = primed({ ...INTENT, isNewProject: true, targetProject: null, suggestedProjectName: '재고' });
    store.proceed();
    expect(api.dispatch).toHaveBeenCalledWith('요청', { newProjectName: '재고' });
  });

  it('does nothing without a pending intent', () => {
    const { store, api } = setup();
    store.proceed();
    expect(api.dispatch).not.toHaveBeenCalled();
  });

  it('routes an ambiguous intent to the drawer via clarify and opens the inbox', () => {
    const { store, api, ui } = primed({ ...INTENT, needsClarification: true, clarifyingQuestion: '어느 쪽?', clarifyOptions: ['a'] });
    store.askClarification();
    expect(api.clarify).toHaveBeenCalledWith('요청', '어느 쪽?', ['a']);
    expect(ui.openQuestions).toHaveBeenCalled();
  });
});
