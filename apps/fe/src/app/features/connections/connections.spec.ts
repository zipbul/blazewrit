import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Connections } from './connections';
import { WorkspaceStore } from '../../data-access/workspace-store';
import type { ConnectionVm } from '../../data-access/api';

const connections: ConnectionVm[] = [
  { projectId: 'api', endpoint: 'a2a://api.local:7142', status: 'connected', lastHeartbeat: '2026-05-29T00:21:18Z', latencyMs: 42, activeStreams: 1, agentState: 'working' },
  { projectId: 'infra', endpoint: 'a2a://infra.local:7144', status: 'disconnected', lastHeartbeat: '2026-05-29T00:09:02Z', latencyMs: null, activeStreams: 0, agentState: 'unreachable' },
];

const storeStub = { connections: signal(connections) } as unknown as WorkspaceStore;

describe('Connections', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), { provide: WorkspaceStore, useValue: storeStub }],
      imports: [Connections],
    }).compileComponents();
  });

  it('creates', () => {
    expect(TestBed.createComponent(Connections).componentInstance).toBeTruthy();
  });

  it('renders a health row per connection with status and agent state', () => {
    const fixture = TestBed.createComponent(Connections);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.row').length).toBe(2);
    expect(el.querySelector('.row .dot.ok')).toBeTruthy();
    expect(el.querySelector('.row.down .dot.bad')).toBeTruthy();
    expect(el.querySelector('.state.unreachable')?.textContent?.trim()).toBe('unreachable');
  });

  it('shows a dash for null latency', () => {
    const fixture = TestBed.createComponent(Connections);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const vals = Array.from(el.querySelectorAll('.metric .mval')).map((v) => v.textContent?.trim());
    expect(vals).toContain('—');
  });
});
