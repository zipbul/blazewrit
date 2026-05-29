import { Field, Recipe } from '@zipbul/baker';
import { isString, isInt, isEnum, isISO8601 } from '@zipbul/baker/rules';
import { STEP_RUN_ROLES, STEP_RUN_STATUSES, REVIEW_VERDICTS } from './enums';

/**
 * One agent invocation = one row (DECISIONS §14). Producer/reviewer/subagent each
 * a distinct run; `parentStepRunId` forms the compound + subagent tree.
 * This is what the UI binds to for the "status = mirror of flow" requirement.
 */
@Recipe
export class StepRunDto {
  @Field(isString) id!: string;
  @Field(isString) flowId!: string;
  @Field(isString, { optional: true }) parentStepRunId?: string;
  @Field(isString) stepName!: string;
  @Field(isEnum(STEP_RUN_ROLES)) role!: (typeof STEP_RUN_ROLES)[number];
  @Field(isInt) attemptNo!: number;
  @Field(isInt, { optional: true }) loopIteration?: number;
  @Field(isEnum(STEP_RUN_STATUSES)) status!: (typeof STEP_RUN_STATUSES)[number];
  @Field(isEnum(REVIEW_VERDICTS), { optional: true }) reviewVerdict?: (typeof REVIEW_VERDICTS)[number];
  @Field(isString, { optional: true }) sessionId?: string;
  @Field(isISO8601()) startedAt!: string;
  @Field(isISO8601(), { optional: true }) endedAt?: string;
}
