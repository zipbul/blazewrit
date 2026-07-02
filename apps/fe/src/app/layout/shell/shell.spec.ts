import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { Shell } from './shell';
import { WorkspaceStore } from '../../data-access/workspace-store';
import { LiveSync } from '../../data-access/live-sync';
import { BlazewritApi } from '../../data-access/api';

/** Shell is layout-only now: header nav + stage + question drawer + chat dock. */
const storeStub = {
  loadError: signal<string | null>(null),
  workItems: signal([]),
  openDecisions: signal([]),
  reload: () => {},
} as unknown as WorkspaceStore;

const apiStub = { triage: () => of({ reply: '', intent: null, feedback: null, view: null }) } as unknown as BlazewritApi;
const liveStub = { start: () => {} } as unknown as LiveSync;

describe('Shell', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Shell],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: WorkspaceStore, useValue: storeStub },
        { provide: LiveSync, useValue: liveStub },
        { provide: BlazewritApi, useValue: apiStub },
      ],
    }).compileComponents();
  });

  it('creates', () => {
    expect(TestBed.createComponent(Shell).componentInstance).toBeTruthy();
  });

  it('renders the three nav links (Canvas / Board / 피드백)', () => {
    const fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();
    const links = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.views a')).map(
      (a) => a.textContent?.trim(),
    );
    expect(links).toEqual(['Canvas', 'Board', '피드백']);
  });

  it('mounts the chat dock and the question drawer', () => {
    const fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-chat-dock')).toBeTruthy();
    expect(el.querySelector('app-question-drawer')).toBeTruthy();
  });

  it('shows the error banner when the workspace load fails', () => {
    (storeStub.loadError as ReturnType<typeof signal<string | null>>).set('projects 로드 실패');
    const fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.error-banner')?.textContent).toContain('projects 로드 실패');
    (storeStub.loadError as ReturnType<typeof signal<string | null>>).set(null);
  });
});
