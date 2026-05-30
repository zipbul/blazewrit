# Triage — Stateless Classification Function

## Definition

> **Triage는 입력을 flow type으로 분류하는 stateless 함수다.**
> `(input) → (output)`. 코드 분석 안 함. flow state 안 봄. 루프 안 돔. persistence 없음. 한 invocation = 한 출력.

**Triage가 하는 것**: 입력을 이해해서 **16 canonical flow 중 하나로 분류**, 또는 분류 불가/모호하면 명시 출력. (오직 *분류*만 — 사실 수집/해석/판정/설계는 다른 step.)
**Triage가 안 하는 것**: 코드 보기 / flow 상태 관리 / 충돌 해결 / cycle 운영 / 설계 / 검증 / persistence — 전부 다른 step 또는 orchestrator의 일.

## Inputs

| 필드 | 필수 | 설명 |
|---|---|---|
| `primary_input` | ✓ | Channel-typed: UserMessage \| A2ARequest \| CIConfig |
| `channel` | ✓ | `user_session` \| `a2a` \| `ci` |
| `conversation_context` | optional | None-state turns (user 세션) |
| `clarifications` | optional | 이전 invocation의 Q&A 누적 `[{q, a}]` |
| `prior_evidence` | optional | reclassify용 `{prior_flow_type, evidence}` — *upstream-trusted* (Input preconditions 절 참조) |
| `reclassify_count` | optional (default 0) | orchestrator 추적 (현재까지 reclassify 시도 횟수, 0=최초 분류). *upstream-trusted* (Input preconditions 절 참조). Triage가 cap 도달 자체 검사 — 값 ≥ 3이면 분류 시도 없이 `ambiguous{disposition:escalate}` 출력 강제. |

**입력에 `active_flow_state` 없음.** Triage는 flow 상태 모름 — orchestrator의 일.

## Result enum & branches (P1: success/주요 출력을 실패 경로와 동일하게 명시 선언)

Triage 출력은 **4개 result로 exhaustive하게 분기**한다. orchestrator는 `result` discriminant 하나로 라우팅한다 — Investigate `compatibility_verdict`가 쓰는 *discriminated result enum + per-result 라우팅 테이블* 모양을 그대로 재사용한다(새 메커니즘 0).

```
result: proceed | none | ambiguous | error

proceed {                                       // (P1: SUCCESS 분기 — 실패만이 아니라 성공도 1급 선언)
  flow_type,                                    // 16 canonical id 중 1 (아래 Flow Type Enum)
  classification_metadata: {
    matched_rows: [signal_row_id],              // Signal Table의 IDed row 참조 (H3: 아래 ID 부여)
    confidence: high | medium | low,            // (H4: low에 실재 trigger — Confidence 절)
    complexity_signal: high | medium | low | none   // Comprehend가 PRODUCE (H2/P6: 생산규칙 — 아래)
  }
}

none {
  reasoning                                     // 왜 actionable 아닌지
}

ambiguous {
  disposition: clarify | escalate,              // (H1/worst: 실재 discriminant — magic string 아님)
  question                                      // 1 routing-blocking 질문 (disposition=clarify) 또는 escalate 사유 1줄
}

error {
  reason: GIBBERISH | INTERNAL
}
```

### Orchestrator 라우팅 테이블 (per-result, Investigate 식 재사용)

| result | discriminant | Orchestrator 처리 |
|---|---|---|
| `proceed` | `flow_type` (16 enum) | `orchestrator.start(flow_type)` — Ground 진입 |
| `none` | — | actionable signal 없음. user_session=자유 대화 계속 / a2a=`INTENT_NOT_ACTIONABLE` / ci=trigger config 에러 |
| `ambiguous` | **`disposition`** | `clarify` → routing-blocking 질문 1개를 caller에 surface → 답 받아 **재invoke** (loop). `escalate` → **flow halt + caller/user escalate** — *재invoke 안 함* (loop 방지). (H1/principle 3: "정당하게 빔"이 아니라 "결정 불가/upstream 결손"임을 disposition이 명시 구분) |
| `error` | `reason` | `GIBBERISH` → parse 불가, caller에 반환. `INTERNAL` → Triage 자체 실패 = **mechanical error → escalate** via `failure_origin=triage` (Input preconditions 절) |

**`ambiguous.disposition`이 H1(worst hole)을 닫는다**: 종단 escalation 신호가 이제 schema에 *존재하는 enum 필드*다. orchestrator는 `disposition=escalate` (필드값)로 halt 분기 — magic sentence string-match 아님. cap 경로(reclassify ≥ 3)와 input-precondition fault 경로 둘 다 `disposition:escalate`를 낸다.

## Flow Type Enum — 16 canonical ids (P6: 닫힌 enum, canonical source로)

`flow_type`은 **정확히 아래 16개 id**. canonical machine source는 `legacy/.blazewrit/flows/<id>.md` 파일 stem이며, 이 enum은 그 단일 source의 *생성된 투영*이다(README 표기는 사람용 display name). 다른 값/대소문자/`...` 금지 — downstream router가 이 16개를 완전 enumerate 가능.

| flow_type (canonical id) | display name | 매핑 Signal row(s) |
|---|---|---|
| `feature` | Feature | S1 |
| `bugfix` | Bug Fix | S2 |
| `bugfix-p0` | Bug Fix P0 | S3 |
| `bugfix-unreproducible` | Bug Fix Unreproducible | S4 |
| `refactor` | Refactor | S5 |
| `performance` | Performance | S6 |
| `migration` | Migration | S7 |
| `test` | Test | S8 |
| `chore` | Chore | S9 |
| `plan-standalone` | plan-standalone | S10 |
| `review` | Review | S11 |
| `release` | Release | S12 |
| `retro` | Retro | S13 |
| `spike` | Spike | S14 |
| `exploration` | Exploration | S15 |
| `compound` | Compound | S16 |

**16개로 확정 — "17번째 row"는 flow_type이 아니다** (H0): Signal Table의 `S0 (No actionable signal)`은 `flow_type` 값이 *아니라* `result=none` OUTPUT으로 매핑된다. 따라서 flow_type 카디널리티 = 16, `none`은 별도 result. 본문 line "16 flow"와 정합.

## Signal Table (IDed — H3/P6: 각 row에 stable signal_row_id 부여)

`classification_metadata.matched_rows`는 아래 **`signal_row_id` (S1–S16, 그리고 비-flow인 S0)** 를 참조한다. ID는 안정적(append-only) — downstream가 "어느 signal이 매치했나"를 재구성 가능.

| signal_row_id | Signal | → result |
|---|---|---|
| `S1` | New capability + 2+ affected cards or 5+ files | `proceed(feature)` |
| `S2` | Error, crash, failing test, regression | `proceed(bugfix)` |
| `S3` | Error + P0/production down | `proceed(bugfix-p0)` |
| `S4` | Error + intermittent/unreproducible | `proceed(bugfix-unreproducible)` |
| `S5` | No behavior change + structural improvement | `proceed(refactor)` |
| `S6` | Profiling, benchmark, latency, throughput, memory target | `proceed(performance)` |
| `S7` | Dependency upgrade, API migration, framework change | `proceed(migration)` |
| `S8` | Coverage gap, missing tests, test strategy | `proceed(test)` |
| `S9` | Config, CI, docs, dependencies | `proceed(chore)` |
| `S10` | Planning, design, research, spec writing with concrete target | `proceed(plan-standalone)` |
| `S11` | PR review, code audit, diff analysis, security audit | `proceed(review)` |
| `S12` | Version bump, changelog, deploy | `proceed(release)` |
| `S13` | Retrospective, postmortem, analysis of past work | `proceed(retro)` |
| `S14` | Feasibility check, prototype, proof of concept | `proceed(spike)` |
| `S15` | Understanding, investigation, learning | `proceed(exploration)` |
| `S16` | Multiple blockers requiring different flows, or multi-phase task | `proceed(compound)` |
| `S0` | No actionable signal, no concrete target (discussion, brainstorming, casual exchange) | `none` (NOT a flow_type) |

`matched_rows`는 항상 **≥ 1개의 IDed row**를 담는다 — `proceed`면 정확히 1개(또는 strict-superset 우선 시 우선 row 1개), Compound면 분류 근거가 된 ≥2 row의 id 모두. 빈 `matched_rows`는 `proceed`에서 **금지**(매치 없으면 `proceed` 불가).

## Activities (single-pass, 루프 없음)

```
0. Input-precondition check (P8: garbage-in 맹신 금지 — 아래 Input preconditions 절)
   reclassify_count / prior_evidence 정형 assert. 결손/기형 → error(INTERNAL) → failure_origin=triage escalate.
   reclassify_count ≥ 3 → ambiguous{disposition:escalate} (분류 시도 없이 즉시).

1. Comprehend
   primary_input + clarifications + conversation_context + prior_evidence
   → verb / target / concern_count 추출
   → complexity_signal PRODUCE (아래 규칙)

2. Classify Decision (단일 출력)
   ├─ verb/target 추출 못함            → none(reasoning)
   ├─ 입력 무의미 (parse 실패)          → error(GIBBERISH)
   ├─ signal table 단일 row 매치       → proceed(flow_type, matched_rows=[Sx], confidence, complexity_signal)
   │  (또는 strict superset, S3 P0 over S2 Bug Fix)
   │  └─ verb/target ≥ 2 (서로 다른 flow 신호) → flow_type=compound, matched_rows=[관련 Sx…]
   ├─ 다중 row 매치, superset 없음     → ambiguous{disposition:clarify, question}
   │  question priority: verb > target > urgency > concern_count
   └─ Triage 자체 실패                 → error(INTERNAL) → failure_origin=triage escalate
```

**Ask cycle은 Triage 안에 없음.** 호출자가 답변 받으면 clarifications에 추가하고 *재invoke*. 포기 결정도 호출자.

### complexity_signal 생산 규칙 (H2/P6: 필수 출력의 PRODUCTION rule — Comprehend가 verb/target/concern_count에서 도출)

`complexity_signal`은 **Comprehend가 추출한 verb / target / concern_count로부터 결정적으로 도출**한다. 코드 분석 아님 — *입력 텍스트 신호*만으로 판단(boundary 준수). Ground의 deepen trigger 입력이며 `high`만이 trigger로 소비되고 `medium|low|none`은 non-trigger다.

| complexity_signal | 도출 조건 (입력 신호) |
|---|---|
| `high` | `concern_count ≥ 2` **또는** target이 다중 component/card/5+ files를 명시 **또는** flow_type ∈ {`feature`,`migration`,`performance`,`compound`} (본질적 deep) |
| `medium` | 단일 verb+target이나 cross-cutting 단서(여러 모듈 언급, "전반/곳곳") 1개 |
| `low` | 단일 verb + 단일 좁은 target, cross-cutting 단서 0 |
| `none` | result=proceed가 아닌 경우(none/ambiguous/error) — complexity_signal 미적용/생략 |

`proceed`에서는 `none` 외 3값 중 하나가 *반드시* 채워진다(필수 필드, 생산 누락 불가). `proceed`가 아닌 result는 `classification_metadata` 자체가 없으므로 complexity_signal 부재가 정상.

## Confidence (H4/P6: low에 실재 trigger 부여 — self-negating 제거)

`confidence`는 *세 값 모두 도달 가능*해야 한다. 아래가 각 값의 실재 trigger다.

- **high**: signal table 정확히 1 row 매치(또는 strict superset). clarifications 불필요.
- **medium**: 1 row 매치하지만 입력에 약간 모호 → 직전 `ambiguous{disposition:clarify}`에 대한 답(clarifications) 사용으로 단일 row 확정된 경우.
- **low** *(실재 trigger)*: 단일 우세 row로 분류는 가능하나 **약한 매치** — (a) prior_evidence가 *동일* flow_type을 지지하지만 현재 입력 단독으론 1 row가 marginal, **또는** (b) reclassify(`reclassify_count ≥ 1`)에서 직전 분류를 좁은 신호로 정정. 즉 `low`는 "ambiguous로 떨어뜨리진 않지만 downstream(특히 Investigate)이 *재검토 여지*를 알아야 하는 약한 proceed"를 표시한다. (우세 row가 *없으면* 여전히 `ambiguous` — `low`는 우세 row가 *있되 약한* 경우다.)

`low` confidence는 여전히 valid `proceed`다(orchestrator는 정상 start). downstream가 신뢰도 메타로 활용.

## Input preconditions (P8: upstream-trusted 필드 정형 assert — garbage-in 맹신 금지)

Triage는 stateless라 `reclassify_count`/`prior_evidence`의 *진실*(실제 시도 횟수)을 검증할 수 없다 — 그러나 **존재+정형(shape)** 은 assert할 수 있고, 결손/기형은 escalate한다. 이는 Verify의 일(truth)이 아니라 *입력 계약 위반 감지*다.

| precondition | 위반 시 처리 |
|---|---|
| `reclassify_count`가 present인데 비-정수 / 음수 / non-numeric | `error(INTERNAL)` → **failure_origin=triage escalate** (principle 2: 비-Decide 소비자는 `request_upstream_deepen` 못 씀 — 기존 failure_origin escalate 사용) |
| `prior_evidence`가 present인데 `prior_flow_type`이 16 canonical id 밖 / `evidence` 부재 | `error(INTERNAL)` → failure_origin=triage escalate |
| `reclassify_count ≥ 3` | 분류 시도 없이 `ambiguous{disposition:escalate, question:"reclassify cap reached, manual intervention required"}` (cap 자기검사 — 정형이므로 escalate-as-verdict, mechanical error 아님) |
| `primary_input`/`channel` 부재 | `error(INTERNAL)` → failure_origin=triage escalate (필수 필드 부재) |

**escalation은 무한 ping-pong하지 않는다**: `(flow_id, triage)` **5-누적-fail halt cap** + reclassify cap 3이 escalation을 bound한다(decide/failure-routing.md 재사용). 따라서 input-precondition escalate는 안전.

`reclassify_count` 값 자체의 *위조*(거짓 0)는 stateless Triage가 못 잡는 환원불가 residual — orchestrator가 단일 source로 counter를 소유·증가시키므로 신뢰 경계는 orchestrator에 있다(아래 Reclassify Cap).

### prior_evidence 불일치 처리 (H6/P8: prior_flow_type ↔ 현재 comprehension 충돌)

reclassify 시 `prior_evidence.prior_flow_type`이 현재 Comprehend 결과와 *다른* flow를 지시할 수 있다. cap은 loop COUNT만 bound하므로 *disagreement DECISION* 규칙을 명시한다 — 단 Triage는 *분류만* 한다(사실 재해석/판정 금지, 그건 Investigate/Decide):

| 상황 | 처리 |
|---|---|
| 현재 입력이 prior와 *다른* 단일 우세 row 지지 | 현재 분류 채택(`proceed(new flow_type)`), `confidence=low` (정정 신호), `matched_rows`=현재 row. prior는 무시(재해석 금지). |
| 현재 입력이 prior_flow_type을 *다시* 지지 (정정 근거 약함) | `proceed(prior_flow_type)`, `confidence=medium` (clarifications 사용 시) — 안정 분류. |
| 현재 입력이 두 flow를 동등 지지(우세 row 없음) | `ambiguous{disposition:clarify, question}` (1 routing-blocking 질문). reclassify_count가 cap 도달이면 위 표에 의해 `disposition:escalate`. |

Triage는 "prior가 맞나 새 게 맞나"를 *판정*하지 않는다 — *현재 입력 신호*로 분류하고, 불일치는 `confidence=low`로 *표시*만 한다. 판정·영향분석은 Investigate/Decide의 일(STAY-IN-LANE).

## Failure & degrade handling

Triage는 **enhancement 도구가 없다** — 외부 MCP/도구 호출 없이 입력 텍스트만으로 분류하는 *primary*-only step이다. 따라서 degraded_pass 분기가 없다(보조 도구 부재 자체가 불가능). 자기 핵심 실패는 두 경로로만 표면화한다:

- **mechanical error** (parse 불가 / 내부 예외 / 필수 입력 결손·기형): `error(GIBBERISH | INTERNAL)`. `INTERNAL`은 `failure_origin=triage`로 escalate(principle 1: primary 실패 → escalate). (H1과 정합: 이건 "정당하게 빔"이 아니라 mechanical error다 — principle 3.)
- **terminal escalation** (reclassify cap 도달): `ambiguous{disposition:escalate}`. orchestrator는 halt(재invoke 안 함).

`request_upstream_deepen`은 **Triage가 절대 emit하지 않는다** — 그건 Decide 전용 제어 신호다(principle 2). Triage가 upstream으로 더 깊이 필요한 경우는 없다(Triage가 *첫* step).

## 채널별 동작

| 채널 | none | ambiguous{clarify} | ambiguous{escalate} | error |
|---|---|---|---|---|
| user_session | 호스트 LLM이 자유 대화 계속 | 호스트 LLM이 user에 질문 → 답 받아 재invoke | flow halt + user escalate ("intent 결정 불가") | (rare; Comprehend 실패 시) |
| a2a | `INTENT_NOT_ACTIONABLE` 반환 | `INTENT_INCOMPLETE` + question 반환 | `INTENT_UNRESOLVABLE` 반환 (halt) | `GIBBERISH`/`INTERNAL` 반환 |
| ci | trigger config 에러 | trigger config 에러 (config 부족) | trigger config 에러 (cap) | trigger config 에러 |

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
| Cycle cap, 포기 결정, reclassify_count *증가/소유* | Host LLM / orchestrator |
| Reframe count, 회복 정책 | Orchestrator |
| 코드 분석, 의존성, 영향 범위 | Ground / Investigate |
| prior vs 현재 *판정*, 영향 분석 | Investigate / Decide |
| 서비스 architecture, 정책, 요구사항 | Decide(Design) |
| Sub-flow 분해 (Compound) | Decide(Design) |
| AC, 코드 architecture, task | Spec |
| 검증 | Verify |
| 학습 | Reflect |
| flow-state 관리 / persistence | Orchestrator |
| 도구 권한, hook | Mechanical 영역 (셸/코드) |

## Signal Strength Rules

Signal strength는 *Triage 출력 분기*를 결정.

| Strength | Criteria | Triage 출력 |
|----------|----------|-------------|
| Clear | Input has explicit verb + target ("fix the NPE in auth.py", "add avatar upload") | `proceed(flow_type, confidence=high)` |
| Implied | Input describes problem/goal without explicit action ("auth is slow") | `ambiguous{disposition:clarify, question}` 1개 — 호출자가 답 받아 재invoke → `proceed` (medium) |
| Ambiguous | No actionable target ("something feels off") | `none(reasoning)` — user 세션은 자유 대화, A2A/CI는 INTENT_NOT_ACTIONABLE |

## None ↔ Flow Transition Rules

None ↔ Flow 전이는 *호스트 LLM*의 책임이지 Triage의 책임이 아니다. 호스트 LLM이 conversation 누적을 보다가 actionable signal 감지 시 Triage invoke. 결과에 따라 처리:

| Trigger | Host LLM 행동 |
|---------|---------------|
| User states actionable intent | Triage invoke → `proceed`면 orchestrator.start, `ambiguous{clarify}`면 user에 질문 후 재invoke, `none`이면 자유 대화 계속 |
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

Triage reclassify는 **flow 당 최대 3회 시도** (즉 `reclassify_count`가 0→1→2로 증가, 3번째 시도까지 invoke됨). `reclassify_count ≥ 3` 도달 시 Triage가 자동 `ambiguous{disposition:escalate}` 출력(Input preconditions 절). orchestrator는 `ambiguous`의 `disposition=escalate` *필드값*을 읽고 flow halt + user/caller escalate("intent 결정 불가"), 재invoke 안 함(loop 방지 — H1: discriminant가 magic string이 아니라 실재 enum 필드라 분기가 결정적). `disposition=clarify`이면 정상 질문→재invoke loop.

`reclassify_count`의 *소유자는 orchestrator*다 — orchestrator가 단일 source로 값을 증가시키고, reclassify 시 `flow_id`를 *유지*(변경 X)하여 counter 의미를 보존한다. Triage는 그 값을 *읽고 정형 검증*만 한다(증가/소유 안 함 — Boundary). A2A/CI도 동일 cap. `(flow_id, triage)` 5-누적-fail halt cap이 reclassify+escalate 전체 ping-pong을 추가로 bound한다.
