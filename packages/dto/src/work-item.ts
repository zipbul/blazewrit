import { Field, Recipe, arrayOf } from '@zipbul/baker';
import { isString, isInt, isEnum, isArray, minLength, isISO8601 } from '@zipbul/baker/rules';
import { WORK_ITEM_TYPES, WORK_ITEM_STATES, WORK_ITEM_SOURCES } from './enums';

/** A unit of work in a project (DECISIONS §10). work_item : flow = 1:N. */
@Recipe
export class WorkItemDto {
  @Field(isString) id!: string;
  @Field(isString) projectId!: string;
  @Field(isString, minLength(1)) title!: string;
  @Field(isString) description!: string;
  @Field(isEnum(WORK_ITEM_TYPES)) type!: (typeof WORK_ITEM_TYPES)[number];
  @Field(isArray, arrayOf(isString)) labels!: string[];
  @Field(isEnum(WORK_ITEM_STATES)) state!: (typeof WORK_ITEM_STATES)[number];
  @Field(isInt) priority!: number;
  @Field(isEnum(WORK_ITEM_SOURCES)) source!: (typeof WORK_ITEM_SOURCES)[number];
  @Field(isString, { optional: true }) activeFlowId?: string;
  /** Correlates cross-project realizations of one user intent (A2A contextId). */
  @Field(isString, { optional: true }) contextId?: string;
  @Field(isISO8601(), { optional: true }) completedAt?: string;
  @Field(isISO8601()) createdAt!: string;
  @Field(isISO8601()) updatedAt!: string;
}
