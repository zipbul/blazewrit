import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { SQL } from 'bun';
import { runReadOnly } from './read-only-query';
import { SqlGuardError } from './sql-guard';

export const TRIAGE_MCP_SERVER = 'bw_triage';
export const DB_READ_TOOL = 'db_read';
/** Fully-qualified tool name the agent must be allow-listed for. */
export const DB_READ_TOOL_FQN = `mcp__${TRIAGE_MCP_SERVER}__${DB_READ_TOOL}`;

/**
 * The agent's only path to the database: one read-only SELECT over the curated views.
 * Guard/role/cap enforcement lives in `runReadOnly`; this adapter just maps to MCP shapes.
 */
export function dbReadTool(sql: SQL) {
  return tool(
    DB_READ_TOOL,
    'Run ONE read-only SQL SELECT against blazewrit\'s curated views (the bw_v_* views only). ' +
      'Returns JSON rows. Writes, DDL, multiple statements, and base-table access are rejected.',
    { sql: z.string().describe('a single SELECT statement over the bw_v_* views') },
    async (args) => {
      try {
        const { rows, rowCount, truncated } = await runReadOnly(sql, args.sql);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ rowCount, truncated, rows }) }] };
      } catch (err) {
        const msg = err instanceof SqlGuardError ? err.message : `query failed: ${(err as Error).message}`;
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true };
      }
    },
  );
}
