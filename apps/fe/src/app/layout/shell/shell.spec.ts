import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { DecisionRequestDto } from '@bw/dto';
import { Shell } from './shell';
import { WorkspaceStore } from '../../data-access/workspace-store';
import type { ConnectionVm } from '../../data-access/api';

const connections: ConnectionVm[] = [
  { projectId: 'api', endpoint: 'a2a://api:7142', status: 'connected', lastHeartbeat: '', latencyMs: 42, activeStreams: 1, agentState: 'working' },
  { projectId: 'infra', endpoint: 'a2a://infra:7144', status: 'disconnected', lastHeartbeat: '', latencyMs: null, activeStreams: 0, agentState: 'unreachable' },
];

const storeStub = {
  connections: signal(connections),
  openDecisions: signal([{ id: 'd1' } as DecisionRequestDto]),
  loadError: signal<string | null>(null),
} as unknown as WorkspaceStore;

describe('Shell', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Shell],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: WorkspaceStore, useValue: storeStub },
      ],
    }).compileComponents();
  });

  it('creates', () => {
    expect(TestBed.createComponent(Shell).componentInstance).toBeTruthy();
  });

  it('renders the five view links', () => {
    const fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const links = Array.from(el.querySelectorAll('.views a')).map((a) => a.textContent?.trim().split(/\s+/)[0]);
    expect(links).toEqual(['Dashboard', 'Board', 'Canvas', 'Decisions', 'Connections']);
  });

  it('shows the pending decision badge from the store', () => {
    const fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.views .badge')?.textContent?.trim()).toBe('1');
  });

  it('renders a connection dot per project in the status bar', () => {
    const fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.status .s .b').length).toBe(2);
  });
});
