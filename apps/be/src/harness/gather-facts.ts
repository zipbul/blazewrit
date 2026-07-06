import type { SQL } from 'bun';
import type { FlowType } from '@bw/dto';
import type { GroundFacts } from './assemble-chain';

/**
 * Gather the facts the DB already knows before assembly — a cheap, tool-less pre-ground so the
 * agent composes on real signals, not just the flow_type seed. (Full two-phase — running ground
 * and extracting its typed facts — is v2; this is what we can source without an agent call.)
 *
 * - mutation: does this seed change code? (drives the verify→reflect spine)
 * - crossProjectDep: does this project depend on others? (a confirmed relationship edge) — the
 *   agent can then weigh cross-project coordination.
 */
export async function gatherFacts(
  sql: SQL,
  projectId: string,
  flowType: FlowType,
  request: string,
): Promise<GroundFacts> {
  const deps = (await sql`
    select 1 from relationships
    where from_project = ${projectId} and status = 'confirmed' limit 1
  `) as unknown[];
  return {
    mutation: flowType !== 'research' && flowType !== 'audit',
    scope: request,
    crossProjectDep: deps.length > 0,
  };
}
