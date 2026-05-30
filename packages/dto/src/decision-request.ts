import { Field, Recipe } from '@zipbul/baker';
import { isString, isBoolean, isEnum, isObject, isISO8601 } from '@zipbul/baker/rules';
import { DECISION_STATUSES, DECISION_REQUEST_TYPES, RISK_LEVELS } from './enums';

/** One selectable answer to a decision (DECISIONS §10: {label, value, risk, recommended, effect}). */
@Recipe
export class DecisionOptionDto {
  @Field(isString) label!: string;
  @Field(isString) value!: string;
  @Field(isEnum(RISK_LEVELS), { optional: true }) risk?: (typeof RISK_LEVELS)[number];
  @Field(isBoolean, { optional: true }) recommended?: boolean;
  @Field(isString, { optional: true }) effect?: string;
}

/**
 * A human-in-the-loop question raised by an agent mid-flow (DECISIONS §10).
 * Surfaced in the UI decision inbox; answering it resumes the suspended flow.
 */
@Recipe
export class DecisionRequestDto {
  @Field(isString) id!: string;
  @Field(isString) flowId!: string;
  @Field(isString, { optional: true }) stepRunId?: string;
  @Field(isString) requestingAgent!: string;
  @Field(isEnum(DECISION_STATUSES)) status!: (typeof DECISION_STATUSES)[number];
  @Field(isEnum(DECISION_REQUEST_TYPES)) requestType!: (typeof DECISION_REQUEST_TYPES)[number];
  @Field(isString) question!: string;
  @Field({ type: () => [DecisionOptionDto] }) options!: DecisionOptionDto[];
  /** why_asking / findings / evidence. */
  @Field(isObject) context!: Record<string, unknown>;
  /** true = the flow is paused until answered; false = a provisional path continues. */
  @Field(isBoolean) blocking!: boolean;
  @Field(isEnum(RISK_LEVELS), { optional: true }) risk?: (typeof RISK_LEVELS)[number];
  @Field(isISO8601()) createdAt!: string;
  @Field(isISO8601(), { optional: true }) answeredAt?: string;
  @Field(isString, { optional: true }) answer?: string;
}
