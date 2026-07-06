import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { TRIAGE_MCP_SERVER } from './db/db-read.tool';

export const SHOW_TABLE_TOOL = 'show_table';
/** Fully-qualified tool name the agent must be allow-listed for. */
export const SHOW_TABLE_TOOL_FQN = `mcp__${TRIAGE_MCP_SERVER}__${SHOW_TABLE_TOOL}`;

/** A declarative table the FE renders in the dock (the agent answers "with a screen"). */
export interface TableView {
  title: string;
  columns: string[];
  /** Row cells as strings, aligned to columns. */
  rows: string[][];
}

const tableShape = {
  title: z.string(),
  columns: z.array(z.string()).min(1).max(8),
  rows: z.array(z.array(z.string())).max(100),
};

/**
 * The agent calls this when the user asks to SEE data (목록/현황/정리해서 보여줘) — the FE renders
 * the table in the chat dock. Declarative: the agent describes WHAT to show, never touches the DOM.
 */
export function showTableTool(onView: (view: TableView) => void) {
  return tool(
    SHOW_TABLE_TOOL,
    '조회 결과를 화면에 표로 보여준다. 사용자가 "보여줘/목록/정리해줘"처럼 데이터를 눈으로 보길 원하면 ' +
      'db_read로 조회한 뒤 이 툴로 표를 렌더하라(긴 텍스트 표 대신). 말 응답은 한 줄 요약만.',
    tableShape,
    async (args) => {
      onView(args as TableView);
      return { content: [{ type: 'text' as const, text: 'table rendered' }] };
    },
  );
}
