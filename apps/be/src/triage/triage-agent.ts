import { tmpdir } from 'node:os';
import { query, createSdkMcpServer, type Options, type SDKResultSuccess } from '@anthropic-ai/claude-agent-sdk';
import type { SQL } from 'bun';
import type { QueryFn } from '../orchestrator/infra/agent-step-executor';
import { dbReadTool, DB_READ_TOOL_FQN, TRIAGE_MCP_SERVER } from './db/db-read.tool';
import { proposeIntentTool, PROPOSE_INTENT_TOOL_FQN } from './propose-intent.tool';
import { recordFeedbackTool, RECORD_FEEDBACK_TOOL_FQN, type AgentFeedback } from './feedback.tool';
import { showTableTool, SHOW_TABLE_TOOL_FQN, type TableView } from './show-table.tool';
import { buildSchemaContext } from './schema-context';
import { buildCapabilityContext } from './capability-context';
import type { Intent } from './intent';

const SYSTEM_PROMPT = `당신은 blazewrit의 중앙 에이전트 "똘이"다. 멀티 프로젝트 에이전트 플랫폼이고, 프로젝트마다
전용 에이전트가 있다. 사용자와 직접 대화한다. 한국어로 간결하게 답한다. 자신을 지칭할 땐 "똘이"라고 한다.

매 메시지마다, 위의 "지금 할 수 있는 동작(actions)" 중 무엇으로 응답할지 고른다:
1. 답하려면 사실이 필요하면 → 먼저 db_read로 확인한다.
2. 실행할 작업 요청이면(만들기/고치기/리팩터/조사/마이그레이션 등) → db_read로 근거를 본 뒤
   propose_intent를 호출해 작업을 "화면 카드"로 제안한다(대상 프로젝트/신규 여부/flow/신뢰도).
   짧은 말 요약도 같이 준다. 어느 프로젝트/무엇인지 모호하면 needsClarification으로 되묻는다.
3. 잡담·질문·설명이면 → 그냥 말로 답한다. 단, 사용자가 데이터를 "보여줘/목록/현황/정리해줘"라고 하면
   db_read로 조회한 뒤 show_table로 화면에 표를 띄우고, 말로는 한 줄 요약만 한다.
4. **위 동작 어느 것으로도 사용자가 원하는 걸 할 수 없으면 — 절대 되는 척하거나 지어내지 마라.**
   "지금 그건 할 수 없다"고 솔직히 말하고, 무엇이 빠졌는지(원하는 동작과 이유)를 분명히 알려라.
   그리고 record_feedback으로 그 결핍을 기록하라 — 표현할 화면이 없으면 category=ui,
   블레이즈릿 기능 자체가 없으면 category=feature, 사용자 요구/만족을 못 채웠으면 category=unmet.

원칙: 응답을 "말로 할지(자유 텍스트)" vs "화면으로 할지(propose_intent 카드)" 매번 판단한다.
없는 능력을 있는 척하지 않는다 — 안 되면 안 된다고 말하고 record_feedback으로 남긴다.`;

export interface TriageAgentDeps {
  /** The write/superuser connection — only the in-process db_read tool touches it, under full read-only enforcement. */
  sql: SQL;
  /** Defaults to the real SDK `query`; inject a fake for tests. */
  queryFn?: QueryFn;
  model?: string;
  maxTurns?: number;
}

/** A conversational turn with the central agent: free reply, plus a structured intent when actionable. */
export interface TurnResult {
  /** The agent's natural-language reply (always present). */
  reply: string;
  /** Structured intent when the message was an actionable work request, else null. */
  intent: Intent | null;
  /** Platform-limitation feedback the agent logged this turn (ui/feature/unmet), else null. */
  feedback: AgentFeedback | null;
  /** Declarative table the agent asked the FE to render this turn, else null. */
  view: TableView | null;
}

/** Runs the Claude Agent SDK with read-only DB access; the agent converses and proposes intents. */
export class TriageAgent {
  constructor(private readonly deps: TriageAgentDeps) {}

  async chat(text: string): Promise<TurnResult> {
    let captured: Intent | null = null;
    let feedback: AgentFeedback | null = null;
    let view: TableView | null = null;
    const server = createSdkMcpServer({
      name: TRIAGE_MCP_SERVER,
      version: '0.1.0',
      tools: [
        dbReadTool(this.deps.sql),
        proposeIntentTool((i) => { captured = i; }),
        recordFeedbackTool((f) => { feedback = f; }),
        showTableTool((v) => { view = v; }),
      ],
    });
    const options: Options = {
      cwd: tmpdir(), // no repo access; only the two MCP tools are pre-approved
      mcpServers: { [TRIAGE_MCP_SERVER]: server },
      allowedTools: [DB_READ_TOOL_FQN, PROPOSE_INTENT_TOOL_FQN, RECORD_FEEDBACK_TOOL_FQN, SHOW_TABLE_TOOL_FQN],
      permissionMode: 'dontAsk', // deny anything not pre-approved, never prompt (headless-safe)
      systemPrompt: `${buildCapabilityContext()}\n\n${SYSTEM_PROMPT}\n\n${buildSchemaContext()}`,
      maxTurns: this.deps.maxTurns ?? 12,
    };
    if (this.deps.model) options.model = this.deps.model;

    const run = this.deps.queryFn ?? (query as QueryFn);
    for await (const message of run({ prompt: text, options })) {
      if (message.type !== 'result') continue;
      if (message.subtype === 'success') {
        return { reply: (message as SDKResultSuccess).result ?? '', intent: captured, feedback, view };
      }
      throw new Error(`central agent failed: ${message.subtype}`);
    }
    throw new Error('central agent produced no result');
  }
}
