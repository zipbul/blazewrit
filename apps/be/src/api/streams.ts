import type { AgentEvent, OrchestratorStore } from '../orchestrator/types';

/** Flow-level SSE hub: the write path publishes, dashboard subscribes (status = mirror). */
export class FlowHub {
  private readonly subs = new Set<(line: string) => void>();
  subscribe(fn: (line: string) => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
  publish(event: object): void {
    const line = `data: ${JSON.stringify(event)}\n\n`;
    for (const fn of this.subs) fn(line);
  }
}

interface StepSub {
  onEvent: (dto: Record<string, unknown>) => void;
  onDone: () => void;
}

/** Per-step-run agent-output hub: buffers events for replay + live-streams to UI subscribers. */
export class StepStreamHub {
  private readonly buffers = new Map<string, Array<Record<string, unknown>>>();
  private readonly subs = new Map<string, Set<StepSub>>();
  private readonly finished = new Set<string>();
  private readonly seqs = new Map<string, number>();

  record(stepRunId: string, ev: AgentEvent): void {
    const seq = (this.seqs.get(stepRunId) ?? 0) + 1;
    this.seqs.set(stepRunId, seq);
    const dto = {
      id: `${stepRunId}-${seq}`,
      stepRunId,
      sessionId: stepRunId,
      seq,
      type: ev.type,
      payload: ev.payload,
      createdAt: new Date().toISOString(),
    };
    const buf = this.buffers.get(stepRunId) ?? [];
    buf.push(dto);
    this.buffers.set(stepRunId, buf);
    for (const sub of this.subs.get(stepRunId) ?? []) sub.onEvent(dto);
  }

  finish(stepRunId: string): void {
    this.finished.add(stepRunId);
    for (const sub of this.subs.get(stepRunId) ?? []) sub.onDone();
  }

  subscribe(stepRunId: string, onEvent: StepSub['onEvent'], onDone: StepSub['onDone']): () => void {
    for (const e of this.buffers.get(stepRunId) ?? []) onEvent(e);
    if (this.finished.has(stepRunId)) {
      onDone();
      return () => {};
    }
    const sub: StepSub = { onEvent, onDone };
    const set = this.subs.get(stepRunId) ?? new Set<StepSub>();
    set.add(sub);
    this.subs.set(stepRunId, set);
    return () => set.delete(sub);
  }
}

/** Wrap a store so flow/step-run writes publish flow events (+ close per-step streams on finish). */
export function publishing(store: OrchestratorStore, flowHub: FlowHub, stepHub: StepStreamHub): OrchestratorStore {
  return {
    createFlow: async (f) => {
      await store.createFlow(f);
      flowHub.publish({ type: 'flow-created', flowId: f.id, flowType: f.flowType });
    },
    setCurrentStep: async (id, step) => {
      await store.setCurrentStep(id, step);
      flowHub.publish({ type: 'current-step', flowId: id, currentStep: step });
    },
    setStatus: async (id, status) => {
      await store.setStatus(id, status);
      flowHub.publish({ type: 'status', flowId: id, status });
    },
    startStepRun: async (r) => {
      await store.startStepRun(r);
      flowHub.publish({ type: 'step-run-started', flowId: r.flowId, stepRunId: r.id, step: r.step, role: r.role });
    },
    finishStepRun: async (id, status, verdict) => {
      await store.finishStepRun(id, status, verdict);
      flowHub.publish({ type: 'step-run-finished', stepRunId: id, status, verdict });
      stepHub.finish(id);
    },
    getFlow: (id) => store.getFlow(id),
    stepRuns: (id) => store.stepRuns(id),
  };
}

