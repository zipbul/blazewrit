import { describe, expect, it } from 'bun:test';
import { showTableTool, SHOW_TABLE_TOOL_FQN, type TableView } from './show-table.tool';

describe('showTableTool', () => {
  it('captures the declarative table via the callback', async () => {
    const seen: TableView[] = [];
    const t = showTableTool((v) => seen.push(v));
    const view = { title: '태스크 현황', columns: ['프로젝트', '제목'], rows: [['결제', '환불 버그']] };
    const res = await t.handler(view, {});
    expect(seen).toEqual([view]);
    expect(res.isError).toBeUndefined();
  });

  it('declares bounded input (columns 1..8, rows ≤100) in its schema', () => {
    // zod shape sanity: the schema itself enforces the caps the FE relies on.
    const shape = t2Shape();
    expect(shape.columns.safeParse([]).success).toBe(false); // min 1
    expect(shape.columns.safeParse(Array(9).fill('c')).success).toBe(false); // max 8
    expect(shape.rows.safeParse(Array(101).fill(['x'])).success).toBe(false); // max 100
    expect(shape.rows.safeParse([['a', 'b']]).success).toBe(true);
  });

  it('exposes the FQN the agent must be allow-listed for', () => {
    expect(SHOW_TABLE_TOOL_FQN).toBe('mcp__bw_triage__show_table');
  });
});

function t2Shape() {
  return showTableTool(() => {}).inputSchema;
}
