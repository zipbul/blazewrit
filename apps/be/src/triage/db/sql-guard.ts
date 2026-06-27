import { parse } from 'pgsql-ast-parser';

/** Max raw query length accepted from the agent (rejects pathological inputs early). */
export const MAX_QUERY_BYTES = 8_000;

/** Thrown when a query is not a single read-only SELECT. The message is safe to surface to the agent. */
export class SqlGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SqlGuardError';
  }
}

/** Statement node kinds (exact `type` strings) that mutate or have side effects — denied anywhere in the tree. */
const DENY_TYPES = new Set<string>([
  'insert', 'update', 'delete', 'truncate', 'truncate table',
  'create table', 'create index', 'create view', 'create materialized view',
  'create sequence', 'create schema', 'create enum', 'create composite type',
  'create function', 'create extension', 'create role', 'create policy',
  'alter table', 'alter index', 'alter sequence', 'alter enum', 'alter schema', 'alter role',
  'drop', 'drop table', 'drop index', 'drop sequence', 'drop type', 'drop trigger',
  'drop function', 'drop view',
  'set', 'set global', 'set timezone', 'reset',
  'grant', 'revoke', 'copy', 'comment', 'do', 'prepare', 'deallocate',
  'begin', 'commit', 'rollback', 'start transaction', 'savepoint',
  'refresh materialized view', 'reindex', 'vacuum', 'analyze', 'lock',
  'raise', 'tablespace', 'reassign owned',
]);

/** Top-level statement kinds that are pure reads. */
const READ_TYPES = new Set<string>(['select', 'union', 'union all', 'values', 'with', 'with recursive']);

/** Recursively scan the AST; reject if any node carries a mutating statement `type`. */
function scanForMutations(node: unknown): void {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) scanForMutations(item);
    return;
  }
  const type = (node as { type?: unknown }).type;
  if (typeof type === 'string' && DENY_TYPES.has(type)) {
    throw new SqlGuardError(`disallowed statement: "${type}" — only a single read-only SELECT is permitted`);
  }
  for (const value of Object.values(node as Record<string, unknown>)) scanForMutations(value);
}

/**
 * Assert `rawSql` is exactly one read-only SELECT. Throws SqlGuardError otherwise. This is the
 * STATIC layer of defense — the binding boundary is still the read-only role + READ ONLY
 * transaction in `runReadOnly`. Rejecting here just gives the agent a clean, fast error.
 */
export function assertReadOnlySelect(rawSql: string): void {
  if (Buffer.byteLength(rawSql, 'utf8') > MAX_QUERY_BYTES) {
    throw new SqlGuardError(`query too large (> ${MAX_QUERY_BYTES} bytes)`);
  }
  let statements;
  try {
    statements = parse(rawSql);
  } catch (err) {
    throw new SqlGuardError(`could not parse SQL: ${(err as Error).message}`);
  }
  if (statements.length === 0) throw new SqlGuardError('empty query');
  if (statements.length > 1) throw new SqlGuardError('multiple statements are not allowed; send one SELECT');

  const top = statements[0] as { type?: string };
  if (!top.type || !READ_TYPES.has(top.type)) {
    throw new SqlGuardError(`statement type "${top.type ?? 'unknown'}" is not a read; only SELECT is permitted`);
  }
  scanForMutations(statements[0]);
}
