import type { SQL } from 'bun';
import type { FlowStatus, ReviewVerdict } from '@bw/dto';
import type { FlowRecord, OrchestratorStore, StepRunRecord, StepRunStatus } from '../types';

/** Postgres-backed flow/step-run store (Bun native SQL). */
export class PgOrchestratorStore implements OrchestratorStore {
  constructor(private readonly sql: SQL) {}

  async createFlow(flow: FlowRecord): Promise<void> {
    await this.sql`
      insert into flows (id, work_item_id, flow_type, status, current_step, assemble_session_id)
      values (${flow.id}, ${flow.workItemId ?? null}, ${flow.flowType}, ${flow.status}, ${flow.currentStep}, ${flow.assembleSessionId ?? null})
    `;
  }

  async setCurrentStep(flowId: string, step: string): Promise<void> {
    await this.sql`update flows set current_step = ${step} where id = ${flowId}`;
  }

  async setStatus(flowId: string, status: FlowStatus): Promise<void> {
    await this.sql`update flows set status = ${status} where id = ${flowId}`;
  }

  async setAssembleSession(flowId: string, sessionId: string): Promise<void> {
    await this.sql`update flows set assemble_session_id = ${sessionId} where id = ${flowId}`;
  }

  async startStepRun(run: { id: string; flowId: string; step: string; role: 'producer' | 'reviewer'; attempt: number; sessionId?: string }): Promise<void> {
    await this.sql`
      insert into step_runs (id, flow_id, step_name, role, attempt_no, status, session_id)
      values (${run.id}, ${run.flowId}, ${run.step}, ${run.role}, ${run.attempt}, ${'running'}, ${run.sessionId ?? null})
    `;
  }

  async finishStepRun(id: string, status: StepRunStatus, verdict?: ReviewVerdict): Promise<void> {
    await this.sql`
      update step_runs set status = ${status}, verdict = ${verdict ?? null}, ended_at = now() where id = ${id}
    `;
  }

  async getFlow(flowId: string): Promise<FlowRecord | undefined> {
    const rows = await this.sql`select id, work_item_id, flow_type, status, current_step from flows where id = ${flowId}`;
    const row = rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      flowType: row.flow_type,
      status: row.status,
      currentStep: row.current_step,
      workItemId: row.work_item_id ?? undefined,
    };
  }

  async stepRuns(flowId: string): Promise<StepRunRecord[]> {
    const rows = await this.sql`
      select id, flow_id, step_name, role, attempt_no, status, verdict
      from step_runs where flow_id = ${flowId} order by started_at, id
    `;
    return rows.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      flowId: r.flow_id as string,
      step: r.step_name as string,
      role: r.role as 'producer' | 'reviewer',
      attempt: r.attempt_no as number,
      status: r.status as StepRunStatus,
      verdict: (r.verdict as 'pass' | 'fail' | null) ?? undefined,
    }));
  }
}
