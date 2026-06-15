import type { AgentCard, AgentSkill } from '@bw/dto';

export interface AgentCardInput {
  name: string;
  description: string;
  url: string;
  version: string;
  skills: AgentSkill[];
}

/**
 * Build a project's Agent Card (spec §5). First cut: streaming on, push notifications off
 * (their config method returns PUSH_NOTIFICATION_NOT_SUPPORTED).
 */
export function buildAgentCard(input: AgentCardInput): AgentCard {
  return {
    name: input.name,
    description: input.description,
    url: input.url,
    version: input.version,
    capabilities: { streaming: true, pushNotifications: false },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: input.skills,
  };
}
