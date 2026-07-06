import type { SQL } from 'bun';
import { assertReadOnlySelect } from './sql-guard';
import { READ_ROLE } from './views.contract';

/** Hard caps so one query can never flood the agent's context or hold the DB. */
export const MAX_ROWS = 200;
export const MAX_RESULT_BYTES = 100_000;
const STATEMENT_TIMEOUT_MS = 4_000;

export interface ReadResult {
  /** Rows after capping (the agent only ever sees these). */
  rows: unknown[];
  /** Total rows the query produced before capping. */
  rowCount: number;
  /** True when rows were dropped to satisfy a cap. */
  truncated: boolean;
}

/**
 * Run one agent-supplied SELECT under defense-in-depth: static guard → READ ONLY transaction →
 * `SET LOCAL ROLE` into the privilege-less read role → statement timeout → row/byte caps.
 * Any write fails twice over (role lacks grants AND the transaction is read-only), and base
 * tables are unreachable because the role is only granted SELECT on the curated views.
 */
export async function runReadOnly(sql: SQL, rawSql: string): Promise<ReadResult> {
  assertReadOnlySelect(rawSql);
  return sql.begin(async (tx: SQL) => {
    await tx.unsafe('set transaction read only');
    await tx.unsafe(`set local statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    await tx.unsafe(`set local role ${READ_ROLE}`);

    const result = (await tx.unsafe(rawSql)) as unknown;
    const rows = Array.isArray(result) ? result : [];

    let out = rows.slice(0, MAX_ROWS);
    let truncated = rows.length > out.length;
    // Byte cap: halve until the serialized payload fits.
    while (out.length > 1 && Buffer.byteLength(JSON.stringify(out), 'utf8') > MAX_RESULT_BYTES) {
      out = out.slice(0, Math.ceil(out.length / 2));
      truncated = true;
    }
    return { rows: out, rowCount: rows.length, truncated };
  });
}
