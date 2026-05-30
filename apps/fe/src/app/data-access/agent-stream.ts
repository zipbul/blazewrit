import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { AgentEventDto } from '@bw/dto';
import { BlazewritApi } from './api';

/**
 * Live agent-output stream for a step run, over SSE (mirrors the A2A
 * TaskArtifactUpdateEvent → bz → UI path, DECISIONS §14). Consume with `toSignal`
 * so the subscription tears down with the component.
 */
@Injectable({ providedIn: 'root' })
export class AgentStream {
  private readonly api = inject(BlazewritApi);

  events(stepRunId: string): Observable<AgentEventDto> {
    return new Observable<AgentEventDto>((subscriber) => {
      const es = new EventSource(this.api.streamUrl(stepRunId));
      es.addEventListener('agent-event', (e) => {
        try {
          subscriber.next(JSON.parse((e as MessageEvent).data) as AgentEventDto);
        } catch (err) {
          es.close();
          subscriber.error(err);
        }
      });
      es.addEventListener('done', () => {
        es.close();
        subscriber.complete();
      });
      es.onerror = () => {
        es.close();
        // CLOSED = backend ended the stream cleanly (the mock does this after replay).
        // CONNECTING = a transient/real connection failure the consumer should see.
        if (es.readyState === EventSource.CLOSED) {
          subscriber.complete();
        } else {
          subscriber.error(new Error(`SSE connection failed for step run ${stepRunId}`));
        }
      };
      return () => es.close();
    });
  }
}
