import { describe, expect, it } from 'bun:test';
import { assertReadOnlySelect, SqlGuardError } from './sql-guard';

describe('assertReadOnlySelect', () => {
  const accepts = [
    'select 1',
    'select id, name from bw_v_projects',
    "select id from bw_v_projects where status = 'active'",
    'select count(*) from bw_v_work_items',
    'with t as (select 1 as x) select * from t',
    'select id from bw_v_projects order by created_at desc limit 5',
  ];
  for (const sql of accepts) {
    it(`accepts: ${sql}`, () => {
      expect(() => assertReadOnlySelect(sql)).not.toThrow();
    });
  }

  const rejects: Array<[string, string]> = [
    ['insert', "insert into projects (id) values ('x')"],
    ['update', "update projects set status = 'x'"],
    ['delete', 'delete from projects'],
    ['truncate', 'truncate projects'],
    ['drop', 'drop table projects'],
    ['set role', 'set role postgres'],
    ['multi-statement', 'select 1; select 2'],
    ['data-modifying CTE', 'with t as (delete from projects returning *) select * from t'],
    ['empty', '   '],
  ];
  for (const [label, sql] of rejects) {
    it(`rejects ${label}: ${sql}`, () => {
      expect(() => assertReadOnlySelect(sql)).toThrow(SqlGuardError);
    });
  }

  it('rejects oversized input', () => {
    expect(() => assertReadOnlySelect(`select ${'1,'.repeat(5000)}1`)).toThrow(SqlGuardError);
  });
});
