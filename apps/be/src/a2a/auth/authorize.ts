import type { Principal } from './principal';

/** Decides whether a principal may act on a target project. */
export type Authorizer = (principal: Principal, projectId: string) => boolean;

/**
 * Relationship-graph authorization: a human (UI) is allowed everywhere, a project may
 * act on itself, and a peer may act on a target only if a declared relationship edge exists.
 */
export function makeRelationshipAuthorizer(graph: Map<string, Set<string>>): Authorizer {
  return (principal, projectId) => {
    if (principal.kind === 'user') return true;
    if (principal.id === projectId) return true;
    return graph.get(principal.id)?.has(projectId) ?? false;
  };
}
