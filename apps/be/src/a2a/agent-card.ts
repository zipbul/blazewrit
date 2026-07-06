import type { AgentCard, AgentSkill } from '@bw/dto';

/** A2A spec version the project agent cards conform to. */
export const A2A_PROTOCOL_VERSION = '0.3.0';

export interface AgentCardInput {
  name: string;
  description: string;
  url: string;
  version: string;
  skills: AgentSkill[];
}

/**
 * Build a project's Agent Card (spec §5) = the COMMON BASE every blazewrit project agent
 * advertises (transport/capabilities/provider/modes), merged with the caller's per-project
 * identity + skills. The base is generated uniformly so cards don't drift across projects.
 * Push notifications off for now (its config method returns PUSH_NOTIFICATION_NOT_SUPPORTED).
 */
export function buildAgentCard(input: AgentCardInput): AgentCard {
  return {
    name: input.name,
    description: input.description,
    url: input.url,
    version: input.version,
    protocolVersion: A2A_PROTOCOL_VERSION,
    provider: { organization: 'blazewrit' },
    preferredTransport: 'JSONRPC',
    capabilities: { streaming: true, pushNotifications: false, stateTransitionHistory: true },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain', 'application/json'],
    skills: input.skills,
  };
}

export interface SeedCardOptions {
  projectId: string;
  name: string;
  /** The registration intent — seeds the project's first domain skill/description. */
  intent: string;
  /** Base origin for the A2A endpoint URL (default empty → relative). */
  baseUrl?: string;
}

/**
 * Seed a new project's card at registration: common base + a single domain skill derived
 * from the intent. The project agent self-optimizes `skills`/`description` later (reflect);
 * name/scope changes go through HITL.
 */
export function seedProjectCard(opts: SeedCardOptions): AgentCard {
  const base = opts.baseUrl ?? '';
  return buildAgentCard({
    name: opts.name,
    description: opts.intent,
    url: `${base}/agents/${opts.projectId}/a2a`,
    version: '1.0.0',
    skills: [{ id: opts.projectId, name: opts.name, description: opts.intent, tags: [] }],
  });
}
