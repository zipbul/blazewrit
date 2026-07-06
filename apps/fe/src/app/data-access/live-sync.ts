import { Injectable, NgZone, inject } from '@angular/core';
import { API_BASE_URL } from './api';
import { WorkspaceStore } from './workspace-store';

/**
 * Live mirror: subscribes to the backend SSE event stream and pokes the store on every
 * event so flows/work-items/step-runs reflect backend state in real time (status = mirror).
 */
@Injectable({ providedIn: 'root' })
export class LiveSync {
  private readonly base = inject(API_BASE_URL);
  private readonly store = inject(WorkspaceStore);
  private readonly zone = inject(NgZone);
  private source?: EventSource;

  start(): void {
    if (this.source) return;
    this.source = new EventSource(`${this.base}/api/stream`);
    this.source.onmessage = () => this.zone.run(() => this.store.notifyLive());
    // The browser auto-reconnects on transient errors; nothing to do here.
  }
}
