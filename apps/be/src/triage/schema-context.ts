import { READ_VIEWS } from './db/views.contract';

/**
 * Render the read surface as prompt text, DERIVED from `views.contract.ts` so the agent's view
 * of the schema can never drift from what is actually granted. Injected into the system prompt
 * so the agent knows exactly what it can query without round-tripping to introspect the schema.
 */
export function buildSchemaContext(): string {
  const lines = READ_VIEWS.map((v) => {
    const cols = v.columns.map((c) => `${c.name} ${c.type}${c.note ? ` -- ${c.note}` : ''}`).join('\n    ');
    return `${v.view} — ${v.purpose}\n    ${cols}`;
  });
  return `You may read ONLY these views (no base tables):\n\n${lines.join('\n\n')}`;
}
