import { Field, Recipe } from '@zipbul/baker';
import { isString, isInt, isEnum, isObject, isISO8601 } from '@zipbul/baker/rules';
import { AGENT_EVENT_TYPES } from './enums';

/**
 * Append-only agent output event (DECISIONS §14). Captured from the per-repo agent
 * via A2A TaskArtifactUpdateEvent, persisted by bz, streamed to the UI over SSE.
 */
@Recipe
export class AgentEventDto {
  @Field(isString) id!: string;
  @Field(isString) stepRunId!: string;
  @Field(isString) sessionId!: string;
  @Field(isInt) seq!: number;
  @Field(isEnum(AGENT_EVENT_TYPES)) type!: (typeof AGENT_EVENT_TYPES)[number];
  @Field(isObject) payload!: Record<string, unknown>;
  @Field(isISO8601()) createdAt!: string;
}
