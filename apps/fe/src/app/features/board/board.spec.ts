import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { WorkItemDto, FlowDto } from '@bw/dto';
import { Board } from './board';
import { WorkspaceStore } from '../../data-access/workspace-store';

const ISO = '2026-05-29T00:00:00Z';
const flows: FlowDto[] = [
  { id: 'f142', workItemId: '142', flowType: 'bugfix', attemptNo: 2, status: 'active', currentStep: 'test', createdAt: ISO },
  { id: 'f144', workItemId: '144', flowType: 'refactor', attemptNo: 1, status: 'active', currentStep: 'ground', createdAt: ISO },
];
const workItems: WorkItemDto[] = [
  { id: '142', projectId: 'api', title: '결제 모듈 분기 버그', description: '', type: 'bug', labels: [], state: 'in_flow', priority: 1, source: 'user', activeFlowId: 'f142', createdAt: ISO, updatedAt: ISO },
  { id: '144', projectId: 'api', title: '캐시 리팩터', description: '', type: 'task', labels: [], state: 'in_flow', priority: 3, source: 'agent', activeFlowId: 'f144', createdAt: ISO, updatedAt: ISO },
];

const storeStub = {
  workItems: signal(workItems),
  flowFor: (w: WorkItemDto) => flows.find((f) => f.id === w.activeFlowId),
} as unknown as WorkspaceStore;

describe('Board', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: WorkspaceStore, useValue: storeStub },
      ],
      imports: [Board],
    }).compileComponents();
  });

  it('creates', () => {
    expect(TestBed.createComponent(Board).componentInstance).toBeTruthy();
  });

  it('places a task in the lane matching its flow current step', () => {
    const fixture = TestBed.createComponent(Board);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const lanes = Array.from(el.querySelectorAll('.lane'));
    const testLane = lanes.find((l) => l.querySelector('.lane-h')?.textContent?.includes('test'));
    expect(testLane?.querySelector('.tc .t')?.textContent).toContain('결제 모듈 분기 버그');
  });
});
