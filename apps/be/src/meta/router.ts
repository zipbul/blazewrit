/** Decision of the blazewrit meta agent: which project an intent belongs to. */
export interface RouteDecision {
  kind: 'existing' | 'create';
  project: string;
}

/** Derive a project name from a request (first token, stripped of common Korean particles). */
export function deriveProjectName(request: string): string {
  const first = request.trim().split(/\s+/)[0] ?? '';
  const stripped = first.replace(/[을를이가에서의는과와로]+$/u, '');
  return stripped || 'general';
}

/**
 * Meta routing (stub): if the intent mentions an existing project, route there; otherwise
 * create a new project named from the intent. Real impl is an LLM meta agent that also
 * wires inter-project relationships.
 */
export function routeProject(request: string, existing: string[]): RouteDecision {
  const lower = request.toLowerCase();
  const match = existing.find((p) => p && lower.includes(p.toLowerCase()));
  if (match) return { kind: 'existing', project: match };
  return { kind: 'create', project: deriveProjectName(request) };
}
