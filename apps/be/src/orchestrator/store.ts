import type { FlowStatus, ReviewVerdict } from '@bw/dto';
import type { FlowRecord, OrchestratorStore, StepRunRecord, StepRunStatus } from './types';

/** TEMPORARY in-memory flow/step-run store — Postgres impl is PgOrchestratorStore. */
export class InMemoryOrchestratorStore implements OrchestratorStore {
  private readonly flows = new Map<string, FlowRecord>();
  private readonly runs: StepRunRecord[] = [];

  async createFlow(flow: FlowRecord): Promise<void> {
    this.flows.set(flow.id, { ...flow });
  }

  async setCurrentStep(flowId: string, step: string): Promise<void> {
    const flow = this.flows.get(flowId);
    if (flow) flow.currentStep = step;
  }

  async setStatus(flowId: string, status: FlowStatus): Promise<void> {
    const flow = this.flows.get(flowId);
    if (flow) flow.status = status;
  }

  async startStepRun(run: { id: string; flowId: string; step: string; role: 'producer' | 'reviewer'; attempt: number }): Promise<void> {
    this.runs.push({ ...run, status: 'running' });
  }

  async finishStepRun(id: string, status: StepRunStatus, verdict?: ReviewVerdict): Promise<void> {
    const run = this.runs.find((r) => r.id === id);
    if (run) {
      run.status = status;
      if (verdict) run.verdict = verdict;
    }
  }

  async getFlow(flowId: string): Promise<FlowRecord | undefined> {
    return this.flows.get(flowId);
  }

  async stepRuns(flowId: string): Promise<StepRunRecord[]> {
    return this.runs.filter((r) => r.flowId === flowId);
  }
}
