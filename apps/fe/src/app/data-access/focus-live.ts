import { Injectable, computed, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, of, scan, switchMap } from 'rxjs';
import type { AgentEventDto, StepRunDto } from '@bw/dto';
import { BlazewritApi } from './api';
import { AgentStream } from './agent-stream';
import { WorkspaceStore } from './workspace-store';
import { deriveMetro } from './flow-model';

export interface LiveLine {
  readonly kind: 'tool' | 'think' | 'ok' | 'plain';
  readonly text: string;
}

/** Safely read a string field from the loosely-typed event payload. */
function str(p: Record<string, unknown>, key: string, fallback = ''): string {
  const v = p[key];
  return typeof v === 'string' ? v : fallback;
}

function formatEvent(ev: AgentEventDto): LiveLine {
  const p = ev.payload;
  switch (ev.type) {
    case 'tool_use':
      return { kind: 'tool', text: `▸ ${str(p, 'name', 'tool')} ${str(p, 'input')}`.trimEnd() };
    case 'tool_result':
      return { kind: 'ok', text: `✓ ${str(p, 'summary', 'done')}` };
    case 'thinking':
      return { kind: 'think', text: str(p, 'text') };
    default:
      return { kind: 'plain', text: str(p, 'text', ev.type) };
  }
}

/**
 * Reactive derivations for the currently focused work item — its flow metro and the
 * live agent-event stream of its running step run. Shared by the dashboard and canvas
 * views so the focus/live logic exists once (root singleton).
 */
@Injectable({ providedIn: 'root' })
export class FocusLive {
  private readonly store = inject(WorkspaceStore);
  private readonly api = inject(BlazewritApi);
  private readonly stream = inject(AgentStream);

  readonly focus = computed(() => this.store.workItems().at(0) ?? null);
  /** Single source of truth for "which work item is focused" (consumed by dashboard + canvas). */
  readonly focusId = computed(() => this.focus()?.id ?? null);
  readonly focusFlow = computed(() => {
    const f = this.focus();
    return f ? (this.store.flowFor(f) ?? null) : null;
  });

  private readonly focusFlowId = computed(() => this.focusFlow()?.id ?? null);
  readonly stepRuns = toSignal(
    toObservable(this.focusFlowId).pipe(
      // catchError INSIDE switchMap: a failed fetch maps to [] without terminating the
      // outer toObservable pipeline, so later focus changes keep updating (self-healing).
      switchMap((id) =>
        id ? this.api.stepRuns(id).pipe(catchError(() => of([] as StepRunDto[]))) : of([] as StepRunDto[]),
      ),
    ),
    { initialValue: [] as StepRunDto[] },
  );

  readonly metro = computed(() => {
    const flow = this.focusFlow();
    return flow ? deriveMetro(flow.flowType, flow.currentStep, this.stepRuns()) : null;
  });

  private readonly activeStepRunId = computed(
    () => this.stepRuns().find((r) => r.status === 'running')?.id ?? null,
  );
  private readonly liveEvents = toSignal(
    toObservable(this.activeStepRunId).pipe(
      // scan inside switchMap: each step-run starts a fresh accumulator.
      switchMap((id) =>
        id
          ? this.stream.events(id).pipe(
              scan((acc, ev) => [...acc, ev], [] as AgentEventDto[]),
              // A dropped stream maps to last-good/empty instead of throwing on signal read.
              catchError(() => of([] as AgentEventDto[])),
            )
          : of([] as AgentEventDto[]),
      ),
    ),
    { initialValue: [] as AgentEventDto[] },
  );
  readonly liveLines = computed(() => this.liveEvents().map(formatEvent));
}
