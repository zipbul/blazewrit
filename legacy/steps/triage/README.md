# Triage — Stateless Classification Function

## Definition

> **Triage는 입력을 flow type으로 분류하는 stateless 함수다.**  
> `(input) → (output)`. 코드 분석 안 함. flow state 안 봄. 루프 안 돔. persistence 없음. 한 invocation = 한 출력.

**Triage가 하는 것**: 입력을 이해해서 16 flow 중 하나로 분류, 또는 분류 불가/모호하면 명시 출력.  
**Triage가 안 하는 것**: 코드 보기 / flow 상태 관리 / 충돌 해결 / cycle 운영 / 설계 / 검증 / persistence — 전부 다른 step 또는 orchestrator의 일.

## Inputs

| 필드 | 필수 | 설명 |
|---|---|---|
| `primary_input` | ✓ | Channel-typed: UserMessage \| A2ARequest \| CIConfig |
| `channel` | ✓ | `user_session` \| `a2a` \| `ci` |
| `conversation_context` | optional | None-state turns (user 세션) |
| `clarifications` | optional | 이전 invocation의 Q&A 누적 `[{q, a}]` |
| `prior_evidence` | optional | reclassify용 `{prior_flow_type, evidence}` |
| `reclassify_count` | optional (default 0) | orchestrator 추적 (현재까지 reclassify 시도 횟수, 0=최초 분류). Triage가 cap 도달 자체 검사 — 값 ≥ 3이면 분류 시도 없이 `ambiguous(question="reclassify cap reached, manual intervention required")` 출력 강제. orchestrator가 ambiguous(escalate) 받으면 flow halt — 재invoke 안 함 (loop 방지) |

**입력에 `active_flow_state` 없음.** Triage는 flow 상태 모름 — orchestrator의 일.

## Outputs (4 type — exhaustive)

```
proceed {
  flow_type,                              // feature | bugfix | ... | compound
  classification_metadata: {
    matched_rows: [signal_row_id],
    confidence: high | medium | low,
    complexity_signal: high | medium | low | none   // input에서 추론된 작업 복잡도 — Step Depth Policy의 deepen trigger 입력
  }
}

none {
  reasoning                               // 왜 actionable 아닌지
}

ambiguous {
  question                                // 1 routing-blocking 질문
}

error {
  reason: GIBBERISH | INTERNAL
}
```

## Activities (single-pass, 루프 없음)

```
1. Comprehend
   primary_input + clarifications + conversation_context + prior_evidence
   → verb / target / concern_count 추출

2. Classify Decision (단일 출력)
   ├─ verb/target 추출 못함            → none(reasoning)
   ├─ 입력 무의미 (parse 실패)          → error(GIBBERISH)
   ├─ signal table 단일 row 매치       → proceed(flow_type, confidence)
   │  (또는 strict superset, P0 over Bug Fix)
   │  └─ verb/target ≥ 2 → flow_type=Compound
   ├─ 다중 row 매치, superset 없음     → ambiguous(question)
   │  question priority: verb > target > urgency > concern_count
   └─ Triage 자체 실패                 → error(INTERNAL)
```

**Ask cycle은 Triage 안에 없음.** 호출자가 답변 받으면 clarifications에 추가하고 *재invoke*. 포기 결정도 호출자.

## Confidence

- **high**: signal table 정확히 1 row 매치 (또는 strict superset)
- **medium**: 1 row 매치하지만 입력에 약간 모호 (clarifications 사용됨)
- **low**: 거의 출력되지 않음 — Triage는 우세 row 없으면 ambiguous 출력

## 채널별 동작

| 채널 | none | ambiguous | error |
|---|---|---|---|
| user_session | 호스트 LLM이 자유 대화 계속 | 호스트 LLM이 user에 질문 → 답 받아 재invoke | (rare; Comprehend 실패 시) |
| a2a | INTENT_NOT_ACTIONABLE 반환 | INTENT_INCOMPLETE + question 반환 | GIBBERISH/INTERNAL 반환 |
| ci | trigger config 에러 | trigger config 에러 (config 부족) | trigger config 에러 |

## Properties

- **Stateless**: pure function. 호출 간 상태 없음.
- **Idempotent**: 같은 입력 → 같은 출력 (LLM 비결정성 modulo).
- **Single-pass**: 한 invocation = 한 출력. 루프 없음.
- **No flow state**: active/suspended 모름.
- **No code analysis**: 코드 read 금지 (도구 영역).
- **No persistence**: 디스크 안 씀 (artifact 없음).

## Boundary — Triage가 안 하는 것 (다른 책임자)

| 항목 | 책임자 |
|---|---|
| Active flow 검사, 충돌 해결, preempt | Orchestrator + caller |
| Suspended flow 유사도 / 재개 제안 | Orchestrator |
| Cycle cap, 포기 결정 | Host LLM / caller |
| Reframe count, 회복 정책 | Orchestrator |
| 코드 분석, 의존성, 영향 범위 | Ground / Investigate |
| 서비스 architecture, 정책, 요구사항 | Decide(Design) |
| Sub-flow 분해 (Compound) | Decide(Design) |
| AC, 코드 architecture, task | Spec |
| 검증 | Verify |
| 학습 | Reflect |
| flow-state 관리 / persistence | Orchestrator |
| 도구 권한, hook | Mechanical 영역 (셸/코드) |

## Signal Table

| Signal | Flow |
|--------|------|
| New capability + 2+ affected cards or 5+ files | Feature |
| Error, crash, failing test, regression | Bug Fix |
| Error + P0/production down | Bug Fix P0 |
| Error + intermittent/unreproducible | Bug Fix Unreproducible |
| No behavior change + structural improvement | Refactor |
| Profiling, benchmark, latency, throughput, memory target | Performance |
| Dependency upgrade, API migration, framework change | Migration |
| Coverage gap, missing tests, test strategy | Test |
| Config, CI, docs, dependencies | Chore |
| Planning, design, research, spec writing with concrete target | plan-standalone |
| PR review, code audit, diff analysis, security audit | Review |
| Version bump, changelog, deploy | Release |
| Retrospective, postmortem, analysis of past work | Retro |
| Feasibility check, prototype, proof of concept | Spike |
| Understanding, investigation, learning | Exploration |
| Multiple blockers requiring different flows, or multi-phase task | Compound |
| No actionable signal, no concrete target (discussion, open brainstorming, casual exchange) | None (free conversation) |

## Signal Strength Rules

Signal strength는 *Triage 출력 분기*를 결정.

| Strength | Criteria | Triage 출력 |
|----------|----------|-------------|
| Clear | Input has explicit verb + target ("fix the NPE in auth.py", "add avatar upload") | `proceed(flow_type, confidence=high)` |
| Implied | Input describes problem/goal without explicit action ("auth is slow") | `ambiguous(question)` 1개 — 호출자가 답 받아 재invoke → `proceed` (medium) |
| Ambiguous | No actionable target ("something feels off") | `none(reasoning)` — user 세션은 자유 대화, A2A/CI는 INTENT_NOT_ACTIONABLE |

## None ↔ Flow Transition Rules

None ↔ Flow 전이는 *호스트 LLM*의 책임이지 Triage의 책임이 아니다. 호스트 LLM이 conversation 누적을 보다가 actionable signal 감지 시 Triage invoke. 결과에 따라 처리:

| Trigger | Host LLM 행동 |
|---------|---------------|
| User states actionable intent | Triage invoke → `proceed`면 orchestrator.start, `ambiguous`면 user에 질문 후 재invoke, `none`이면 자유 대화 계속 |
| Conversation produces spec-level detail | Host LLM이 conversation_context와 함께 Triage invoke → 결과 처리 |
| User explicitly abandons | Host LLM이 orchestrator.abandon 호출 (Triage 미관여) |
| No flow-related input for 3+ exchanges | Host LLM이 user에 "continue or suspend?" 질문 (Triage 미관여) |

## Flow Lifecycle Rules

| Event | Action | State file update |
|-------|--------|-------------------|
| **Start** | Triage classifies → Ground → Investigate → Decide → core steps | Write: flow type, step, status=active |
| **Suspend** (user switches topic) | Save progress to state file (no Reflect) | Write: status=suspended, current step, completed work, pending items |
| **Suspend** (P0 preemption) | Pause immediately → new Bug Fix P0 flow starts | Write: status=suspended, preempted_by=P0, resume point |
| **Resume** | Read state file → skip completed steps → continue from suspension point | Write: status=active |
| **Complete** | Reflect → record learnings | Write: status=completed |
| **Abandon** | Reflect(abandoned, reason) | Write: status=abandoned |

Resume priority: P0 preemption always resumes after P0 completes. User-suspended flows resume only on explicit request.

## User Override

User can override Triage classification at any point:
- "This isn't a refactor, it's a feature" → reclassify, restart from Ground for new flow type
- "Skip the tests, just implement" → follow user directive, Reflect records deviation
- "I don't want a flow for this" → None, even if signal was clear

## Context Inheritance Rules

호스트 LLM이 Triage invoke 시 `conversation_context`로 None-state turns를 전달. Triage의 Comprehend가 이를 통합 이해.

- **Inherit**: decisions made, constraints identified, scope discussed, files mentioned, approach agreed
- **Do not inherit**: abandoned ideas, rejected approaches, tangential discussion (호스트 LLM이 필터)
- **Rule**: Triage는 `conversation_context`를 *Comprehend의 입력*으로 사용. 별도 결박 artifact 생산 안 함 — 분류 결과만 출력. 다음 step (Ground)도 같은 conversation_context를 orchestrator로부터 받음.

## Reclassify Cap

Triage reclassify는 **flow 당 최대 3회 시도** (즉 `reclassify_count`가 0→1→2로 증가, 3번째 시도까지 invoke됨). `reclassify_count ≥ 3` 도달 시 Triage가 자동 `ambiguous(escalate)` 출력 (input field rule, 위 참조). orchestrator는 ambiguous(escalate) 받으면 flow halt + user/caller escalate ("intent 결정 불가"), 재invoke 안 함. flow_id는 reclassify 시 *유지* (변경 X) — counter 의미 보존. A2A/CI도 동일 cap.
