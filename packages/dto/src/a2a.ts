import { Field, Recipe, arrayOf, createRule } from '@zipbul/baker';
import { isString, isInt, isObject, isArray, isNotEmpty, isEnum, equals, oneOf } from '@zipbul/baker/rules';

/** JSON-RPC 2.0 standard error codes. */
export const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

/** A2A protocol-specific error codes (A2A spec §8). */
export const A2A_ERRORS = {
  TASK_NOT_FOUND: -32001,
  TASK_NOT_CANCELABLE: -32002,
  PUSH_NOTIFICATION_NOT_SUPPORTED: -32003,
} as const;

/** A2A Task lifecycle states (spec §6.3). */
export const TASK_STATES = [
  'submitted',
  'working',
  'input-required',
  'completed',
  'canceled',
  'failed',
  'rejected',
] as const;
export type TaskState = (typeof TASK_STATES)[number];

/** A2A message roles (spec §6.4). */
export const MESSAGE_ROLES = ['user', 'agent'] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

// --- Parts (discriminated union on `kind`, spec §6.5) ---
// baker has no polymorphic-array support, so each element is validated by a custom rule.

export interface TextPart {
  kind: 'text';
  text: string;
}
export interface FilePart {
  kind: 'file';
  file: Record<string, unknown>;
}
export interface DataPart {
  kind: 'data';
  data: Record<string, unknown>;
}
export type PartDto = TextPart | FilePart | DataPart;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Validates a single A2A Part against its `kind` discriminant + required payload. */
export const isPart = createRule({
  name: 'isPart',
  requiresType: 'object',
  validate: (value) => {
    if (!isPlainObject(value)) return false;
    switch (value.kind) {
      case 'text':
        return typeof value.text === 'string';
      case 'file':
        return isPlainObject(value.file);
      case 'data':
        return isPlainObject(value.data);
      default:
        return false;
    }
  },
});

// --- JSON-RPC envelope ---

/** JSON-RPC 2.0 request envelope used by the A2A transport (spec §6.1). */
@Recipe
export class JsonRpcRequestDto {
  @Field(isString, equals('2.0')) jsonrpc!: '2.0';
  @Field(isString, isNotEmpty) method!: string;
  @Field(isObject, { optional: true }) params?: Record<string, unknown>;
  @Field(oneOf(isString, isInt), { optional: true, nullable: true }) id?: string | number | null;
}

// --- Message / Task / Artifact (spec §6.3–6.6) ---

@Recipe
export class MessageDto {
  @Field(isString, equals('message')) kind!: 'message';
  @Field(isString, isNotEmpty) messageId!: string;
  @Field(isEnum(MESSAGE_ROLES)) role!: MessageRole;
  @Field(isArray, arrayOf(isPart)) parts!: PartDto[];
  @Field(isString, { optional: true }) contextId?: string;
  @Field(isString, { optional: true }) taskId?: string;
}

@Recipe
export class TaskStatusDto {
  @Field(isEnum(TASK_STATES)) state!: TaskState;
  @Field(isString, { optional: true }) timestamp?: string;
}

@Recipe
export class ArtifactDto {
  @Field(isString, isNotEmpty) artifactId!: string;
  @Field(isString, { optional: true }) name?: string;
  @Field(isArray, arrayOf(isPart)) parts!: PartDto[];
}

@Recipe
export class TaskDto {
  @Field(isString, equals('task')) kind!: 'task';
  @Field(isString, isNotEmpty) id!: string;
  @Field(isString, isNotEmpty) contextId!: string;
  @Field({ type: () => TaskStatusDto }) status!: TaskStatusDto;
  @Field({ type: () => [ArtifactDto], optional: true }) artifacts?: ArtifactDto[];
}

/** Params for the `message/send` method (spec §7.1). */
@Recipe
export class MessageSendParamsDto {
  @Field({ type: () => MessageDto }) message!: MessageDto;
}

/** Params for `tasks/get` and `tasks/cancel` (spec §7.3–7.4). */
@Recipe
export class TaskIdParamsDto {
  @Field(isString, isNotEmpty) id!: string;
}

// --- Streaming events (server output, spec §7.2.1) ---

export interface TaskStatusUpdateEvent {
  kind: 'status-update';
  taskId: string;
  contextId: string;
  status: { state: TaskState; timestamp?: string };
  final: boolean;
}

export interface TaskArtifactUpdateEvent {
  kind: 'artifact-update';
  taskId: string;
  contextId: string;
  artifact: ArtifactDto;
  append?: boolean;
  lastChunk?: boolean;
}

export type A2AStreamEvent = TaskStatusUpdateEvent | TaskArtifactUpdateEvent;

// --- Agent Card (discovery, spec §5) ---

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples?: string[];
}

export interface AgentProvider {
  organization: string;
  url?: string;
}

export interface AgentCapabilities {
  streaming: boolean;
  pushNotifications: boolean;
  stateTransitionHistory?: boolean;
}

export interface AgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  /** A2A spec version this card conforms to. */
  protocolVersion?: string;
  provider?: AgentProvider;
  /** Preferred A2A transport binding (e.g. 'JSONRPC'). */
  preferredTransport?: string;
  capabilities: AgentCapabilities;
  /** Named security schemes (spec §5). */
  securitySchemes?: Record<string, unknown>;
  security?: Array<Record<string, string[]>>;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: AgentSkill[];
}
