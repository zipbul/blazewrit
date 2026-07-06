import type { FlowDto, StepRunDto, StepRunStatus } from '@bw/dto';

export interface FlowRow {
  id: string;
  work_item_id: string | null;
  flow_type: string;
  status: string;
  current_step: string;
  created_at: string | Date;
}

export interface StepRunRow {
  id: string;
  flow_id: string;
  step_name: string;
  role: string;
  attempt_no: number;
  status: string;
  verdict: string | null;
  started_at: string | Date;
  ended_at: string | Date | null;
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function toFlowDto(row: FlowRow): FlowDto {
  return {
    id: row.id,
    workItemId: row.work_item_id ?? '',
    flowType: row.flow_type as FlowDto['flowType'],
    attemptNo: 1,
    status: row.status as FlowDto['status'],
    currentStep: row.current_step,
    createdAt: iso(row.created_at),
  };
}

export function toStepRunDto(row: StepRunRow): StepRunDto {
  const dto: StepRunDto = {
    id: row.id,
    flowId: row.flow_id,
    stepName: row.step_name,
    role: row.role as StepRunDto['role'],
    attemptNo: row.attempt_no,
    status: row.status as StepRunStatus,
    startedAt: iso(row.started_at),
  };
  if (row.ended_at) dto.endedAt = iso(row.ended_at);
  if (row.role === 'reviewer' && (row.verdict === 'pass' || row.verdict === 'fail')) {
    dto.reviewVerdict = row.verdict;
  }
  return dto;
}
