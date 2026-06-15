import type { AgentCard } from '@bw/dto';
import { buildAgentCard, type AgentCardInput } from '../agent-card';

/** Resolves a project's Agent Card. Real impl reads the project registry + relationship graph. */
export interface ProjectRegistry {
  card(projectId: string): AgentCard | undefined;
}

/** TEMPORARY in-memory registry — replaced by the registry package (DB-backed). */
export class InMemoryRegistry implements ProjectRegistry {
  constructor(private readonly projects: Map<string, AgentCardInput>) {}

  card(projectId: string): AgentCard | undefined {
    const input = this.projects.get(projectId);
    return input ? buildAgentCard(input) : undefined;
  }
}
