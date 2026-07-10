import { tmpdir } from 'node:os';
import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { FlowType } from '@bw/dto';
import type { QueryFn } from '../orchestrator/infra/agent-step-executor';
import { KNOWN_STEPS } from './build-workflow';
import { withMindset } from './mindset';

/** Facts ground surfaced, on which the agent bases its step selection. */
export interface GroundFacts {
  hasTests?: boolean;
  mutation?: boolean;
  scope?: string;
  crossProjectDep?: boolean;
  [k: string]: unknown;
}

export interface AssembleInput {
  /** The flow_type seed 똘이 attached to the intent. */
  seed: FlowType;
  facts: GroundFacts;
}

export interface StepPick {
  name: string;
  /** One-line why, tied to a ground fact — makes this composition, not a renamed switch. */
  why: string;
}

export interface AssembleResult {
  /** Ordered step names the agent chose (raw — buildWorkflow enforces the grammar). */
  picks: string[];
  rationales: StepPick[];
  /** SDK session id — recorded so this decision can be re-asked/debugged later. */
  sessionId: string;
}

const OUTPUT_FORMAT = {
  type: 'json_schema' as const,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      steps: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { name: { type: 'string' }, why: { type: 'string' } },
          required: ['name', 'why'],
        },
      },
    },
    required: ['steps'],
  },
};

const PROMPT = (seed: FlowType, facts: GroundFacts) => `당신은 프로젝트 실행 에이전트다. ground 단계에서 확인된 사실을 근거로,
이 작업에 필요한 스텝들을 순서대로 고른다. 안전 골격(ground 시작, 변경 작업이면 verify→reflect 종단,
리뷰 게이트)은 시스템이 강제하므로 당신은 "중간 스텝"만 판단한다.

고를 수 있는 스텝: ${KNOWN_STEPS.join(', ')}
- investigate: 사실을 설계 가능한 문제로 해석 (비자명한 작업)
- decide: 방향 결정 (선택지가 있을 때)
- spec: 수용기준+아키텍처+분해 (feature/migration 등 규모 있는 것)
- test: 실패 테스트/재현 (test-first면 implement보다 먼저)
- implement: 실제 변경
- report: 조사/감사 결과 보고 (읽기 전용 작업)

flow_type 씨드: ${seed}
ground 사실: ${JSON.stringify(facts)}

각 스텝에 그 사실에 근거한 한 줄 이유(why)를 붙여라. 필요 없는 스텝은 넣지 마라.`;

export interface AssembleDeps {
  queryFn?: QueryFn;
  model?: string;
}

/**
 * The ONE agent judgment call in flow assembly: ground facts → an ordered step selection with
 * fact-linked rationales, plus the SDK session_id (every agent decision must be re-askable for
 * debugging). No tools, no repo access — pure composition. The picks are raw; buildWorkflow is
 * the mechanical safety wall that consumes them.
 */
export async function assembleChain(input: AssembleInput, deps: AssembleDeps = {}): Promise<AssembleResult> {
  const options: Options = {
    cwd: tmpdir(),
    settingSources: [],
    systemPrompt: withMindset('You are the flow assembler: compose the step chain this task needs, each pick justified by a ground fact.'),
    // The SDK spends turn 1 on the model's own reasoning; the structured-output result lands on
    // turn 2. maxTurns:1 always ends in error_max_turns (→ silent degrade), so 2 is the floor.
    maxTurns: 2,
    allowedTools: [],
    outputFormat: OUTPUT_FORMAT,
  };
  if (deps.model) options.model = deps.model;

  const run = deps.queryFn ?? (query as QueryFn);
  for await (const message of run({ prompt: PROMPT(input.seed, input.facts), options }) as AsyncIterable<SDKMessage>) {
    if (message.type !== 'result') continue;
    if (message.subtype === 'success') {
      const out = (message as { structured_output?: { steps?: StepPick[] } }).structured_output;
      const rationales = out?.steps ?? [];
      return {
        picks: rationales.map((s) => s.name),
        rationales,
        sessionId: (message as { session_id?: string }).session_id ?? '',
      };
    }
    throw new Error(`assembleChain failed: ${message.subtype}`);
  }
  throw new Error('assembleChain produced no result');
}
