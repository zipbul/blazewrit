import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { WorkItemDto, FlowDto } from '@bw/dto';
import { Dashboard } from './dashboard';
import type { ProjectVm } from '../../data-access/api';
import { WorkspaceStore } from '../../data-access/workspace-store';
import { FocusLive, type LiveLine } from '../../data-access/focus-live';
import type { FlowMetro } from '../../data-access/flow-model';

const ISO = '2026-05-29T00:00:00Z';
const projects: ProjectVm[] = [
  { id: 'api', name: 'api', status: 'up', activeCount: 3 },
  { id: 'web', name: 'web', status: 'up', activeCount: 0 },
  { id: 'infra', name: 'infra', status: 'down', activeCount: 0 },
];
const flow: FlowDto = { id: 'f142', workItemId: '142', flowType: 'bugfix', attemptNo: 2, status: 'active', currentStep: 'test', createdAt: ISO };
const focusItem: WorkItemDto = { id: '142', projectId: 'api', title: '결제 모듈 분기 버그', description: '', type: 'bug', labels: [], state: 'in_flow', priority: 1, source: 'user', activeFlowId: 'f142', createdAt: ISO, updatedAt: ISO };
const metro: FlowMetro = {
  steps: [
    { name: 'ground', state: 'done' },
    { name: 'test', state: 'active' },
    { name: 'reflect', state: 'pending' },
  ],
  attempts: 2,
  reviewerFailed: false,
  activeStep: 'test',
};

const storeStub = {
  projects: signal(projects),
  workItems: signal([focusItem]),
  activeCount: signal(1),
  flowFor: () => flow,
} as unknown as WorkspaceStore;

const liveStub = {
  focus: signal(focusItem),
  focusId: signal(focusItem.id),
  focusFlow: signal(flow),
  metro: signal(metro),
  liveLines: signal([] as LiveLine[]),
} as unknown as FocusLive;

describe('Dashboard', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: WorkspaceStore, useValue: storeStub },
        { provide: FocusLive, useValue: liveStub },
      ],
      imports: [Dashboard],
    }).compileComponents();
  });

  it('creates', () => {
    expect(TestBed.createComponent(Dashboard).componentInstance).toBeTruthy();
  });

  it('renders the focused work item title and an active flow step', () => {
    const fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.focus h2')?.textContent).toContain('결제 모듈 분기 버그');
    expect(el.querySelector('.metro .n.ac')).toBeTruthy();
  });

  it('labels each metro step state for assistive tech', () => {
    const fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.metro .n.ac')?.getAttribute('aria-label')).toContain('active');
  });

  it('renders a connection dot per project', () => {
    const fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.conns .x').length).toBe(3);
  });
});
