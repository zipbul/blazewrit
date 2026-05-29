import { Field, Recipe } from '@zipbul/baker';
import { isString, isInt, isEnum, isISO8601 } from '@zipbul/baker/rules';
import { FLOW_TYPES, FLOW_STATUSES } from './enums';

/** A single attempt at executing a work item through the agent flow (DECISIONS §10). */
@Recipe
export class FlowDto {
  @Field(isString) id!: string;
  @Field(isString) workItemId!: string;
  @Field(isEnum(FLOW_TYPES)) flowType!: (typeof FLOW_TYPES)[number];
  @Field(isInt) attemptNo!: number;
  @Field(isString, { optional: true }) supersedesFlowId?: string;
  @Field(isEnum(FLOW_STATUSES)) status!: (typeof FLOW_STATUSES)[number];
  @Field(isString) currentStep!: string;
  @Field(isISO8601()) createdAt!: string;
}
