import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { WorkItemDto, FlowDto } from '@bw/dto';
import type { ProjectVm } from '../../data-access/api';
import { Canvas } from './canvas';
import { WorkspaceStore } from '../../data-access/workspace-store';
import { FocusLive, type LiveLine } from '../../data-access/focus-live';

const ISO = '2026-05-29T00:00:00Z';
const projects: ProjectVm[] = [{ id: 'api', name: 'api', status: 'up', activeCount: 3 }];
const flows: FlowDto[] = [
  { id: 'f142', workItemId: '142', flowType: 'bugfix', attemptNo: 2, status: 'active', currentStep: 'test', createdAt: ISO },
  { id: 'f143', workItemId: '143', flowType: 'feature', attemptNo: 1, status: 'active', currentStep: 'implement', createdAt: ISO },
];
const workItems: WorkItemDto[] = [
  { id: '142', projectId: 'api', title: '결제 모듈 분기 버그', description: '', type: 'bug', labels: [], state: 'in_flow', priority: 1, source: 'user', activeFlowId: 'f142', createdAt: ISO, updatedAt: ISO },
  { id: '143', projectId: 'api', title: '검색 자동완성', description: '', type: 'feature', labels: [], state: 'in_flow', priority: 2, source: 'user', activeFlowId: 'f143', createdAt: ISO, updatedAt: ISO },
];

const storeStub = {
  projects: signal(projects),
  workItems: signal(workItems),
  flowFor: (w: WorkItemDto) => flows.find((f) => f.id === w.activeFlowId),
} as unknown as WorkspaceStore;

const liveStub = {
  focus: signal(workItems[0]),
  focusId: signal(workItems[0].id),
  liveLines: signal([] as LiveLine[]),
} as unknown as FocusLive;

describe('Canvas', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: WorkspaceStore, useValue: storeStub },
        { provide: FocusLive, useValue: liveStub },
      ],
      imports: [Canvas],
    }).compileComponents();
  });

  it('creates', () => {
    expect(TestBed.createComponent(Canvas).componentInstance).toBeTruthy();
  });

  it('renders a task node per work item plus the project node and wires', () => {
    const fixture = TestBed.createComponent(Canvas);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.node.task').length).toBe(2);
    expect(el.querySelector('.node.proj .nm')?.textContent).toContain('api');
    // one project→task wire per task plus the live wire
    expect(el.querySelectorAll('svg.wires path').length).toBe(3);
  });

  it('exposes accessible names on the zoom controls', () => {
    const fixture = TestBed.createComponent(Canvas);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const labels = Array.from(el.querySelectorAll('.zoom button')).map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(['Zoom in', 'Zoom out', 'Fit to screen']);
  });
});
