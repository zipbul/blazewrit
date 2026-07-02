/**
 * What the central (blazewrit) agent can actually do — the SINGLE source for the prompt's action
 * catalog. The agent picks one of these each turn; if none fit the user's request, it must say so
 * instead of fabricating. Add an entry here when a new action/surface ships (then the agent knows
 * about it automatically next turn). Mirrors how `schema-context` derives the read surface.
 */
export interface Capability {
  /** Short name shown to the agent. */
  readonly name: string;
  /** What it does + how the user sees the response (말 vs 화면 카드). */
  readonly does: string;
}

export const CAPABILITIES: readonly Capability[] = [
  { name: 'db_read', does: '현재 상태 조회 — 읽기전용 SELECT(bw_v_* 뷰). 사실이 필요하면 먼저 쓴다.' },
  {
    name: 'propose_intent',
    does: '실행할 작업이면 구조화된 작업 의도를 제안 → 화면에 "작업 카드"로 표시(대상 프로젝트/신규 여부/flow/신뢰도, 모호하면 needsClarification으로 되묻기).',
  },
  { name: '대화 응답', does: '잡담·질문·설명·조언은 그냥 말(자유 텍스트)로 답한다.' },
  {
    name: 'record_feedback',
    does: '위 수단으로 사용자를 제대로 응대 못 할 때 결핍을 기록(ui=표현할 화면 없음 / feature=기능 없음 / unmet=요구 미충족). 지어내는 대신 이걸 쓴다.',
  },
];

/** Render the catalog for the system prompt. */
export function buildCapabilityContext(): string {
  const lines = CAPABILITIES.map((c) => `- ${c.name}: ${c.does}`).join('\n');
  return `지금 할 수 있는 동작(actions):\n${lines}`;
}
