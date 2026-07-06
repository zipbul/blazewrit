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
| `prior_evidence` | optional | reclassify용 `{prior_flow_type, evidence}` — `evidence`는 **non-empty(공백-아님) 정보 carrier**(non-empty string 또는 `{prior_matched_rows, summary}` 구조, summary non-empty). *upstream-trusted* (Input preconditions 절 참조) |
| `reclassify_count` | optional (default 0) | orchestrator 추적 (현재까지 reclassify 시도 횟수, 0=최초 분류). *upstream-trusted* (Input preconditions 절 참조). 값 `0`,`1`,`2`가 **3회의 *분류 시도***이고, 값 `≥ 3`은 cap escalate invocation이다 — Triage가 cap 도달 자체 검사하여 값 ≥ 3이면 분류 시도 없이 `ambiguous{disposition:escalate}` 출력 강제. |

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
    complexity_signal: high | medium | low | none   // 입력신호(Comprehend) ⊕ flow_type(Classify)로 FINALIZE; proceed에선 {high|medium|low} 중 1, `none`은 비-proceed 부재 sentinel (H2/P6: 생산규칙 — 아래)
  }
}

none {
  reasoning                                     // 왜 actionable 아닌지
}

ambiguous {
  disposition: clarify | escalate,              // (H1/worst: 실재 discriminant — magic string 아님)
  question                                      // 1 routing-blocking 질문 (disposition=clarify) 또는 escalate 사유 1줄
                                                 //   escalate 2종: (1) cap 경로(reclassify_count≥3)=예약 cap 문자열 "reclassify cap reached, manual intervention required" 고정 / (2) 非-cap escalate(reclassify_count<3, undecidable: 다중 row 매치·superset 없음인데 후보를 분리하는 routing-blocking 질문 형성 불가)=원인 명시 free 1줄(예약 cap 문자열 금지). Activity 2/Confidence/Input-precondition 절 참조.
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
| `error` | `reason` | `GIBBERISH` → parse 불가, caller에 반환. `INTERNAL` → Triage 자체 실패 = **mechanical error → orchestrator-level halt escalate** (`failure_origin=triage` 의 reclassify-loop 의미 *아님* — `## INTERNAL escalate semantics` 절) |

**`ambiguous.disposition`이 H1(worst hole)을 닫는다**: 종단 escalation 신호가 이제 schema에 *존재하는 enum 필드*다. orchestrator는 `disposition=escalate` (필드값)로 halt 분기 — magic sentence string-match 아님. **cap 경로**(reclassify ≥ 3, *정형 escalate-as-verdict*)는 `ambiguous{disposition:escalate}`를 낸다. **input-precondition mechanical fault 경로**(non-integer reclassify_count / 기형 prior_evidence / 부재·enum-밖 channel)는 `error(INTERNAL)` → orchestrator-level halt를 낸다(`## INTERNAL escalate semantics`). 둘 다 종단 halt지만 *정형 verdict*(cap)와 *mechanical error*(fault)를 result enum 수준에서 구분한다(principle 3).

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
| `compound` | Compound | S16 (meta-row — 절대 matched_rows에 실리지 않음; compound는 근거 component row S1..S15를 인용) |

**16개로 확정 — "17번째 row"는 flow_type이 아니다** (H0): Signal Table의 `S0 (No actionable signal)`은 `flow_type` 값이 *아니라* `result=none` OUTPUT으로 매핑된다. 따라서 flow_type 카디널리티 = 16, `none`은 별도 result. 본문 line "16 flow"와 정합.

**S16은 S0와 평행한 *문서화-되지만-절대-방출되지-않는 meta-row*다**: `S16 (Multiple blockers...)`은 `flow_type=compound`에 *문서상* 매핑되지만, compound의 `matched_rows`는 **S16 자체가 아니라** 분류 근거가 된 ≥2 *component* row(S1..S15)를 인용한다. 즉 S16은 S0와 똑같이 표에 존재하되 어떤 출력 token으로도 방출되지 않으며, proceed의 matched_rows pattern `^S([1-9]|1[0-5])$`이 S0·S16 둘 다를 grammar로 금지한다(`matched_rows=[S16]`는 schema 위반 — high-confidence compound 규칙의 ≥2-non-superset-component-row 단언과 정합).

## Signal Table (IDed — H3/P6: 각 row에 stable signal_row_id 부여)

`classification_metadata.matched_rows`는 아래 **citable component `signal_row_id` (S1–S15)** 만 참조한다. 비-flow인 `S0`과 compound meta-row인 `S16`은 아래 표에 문서화되지만 *어떤 출력에도 실리지 않는다* — proceed의 matched_rows는 S1..S15로 제한되고(S0·S16 둘 다 금지: S0은 flow_type 없음, S16은 compound이 근거 component row S1..S15를 인용하므로 meta-row 자체는 비인용), `none`은 matched_rows 자체가 없다(S0은 carrier 불필요, `reasoning`으로 충분). ID는 안정적(append-only) — downstream가 "어느 signal이 매치했나"를 재구성 가능.

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
| `S16` | Multiple blockers requiring different flows, or multi-phase task | `proceed(compound)` (S16=meta-row: compound으로 매핑되나 *matched_rows에 절대 안 실림* — compound은 근거 component row S1..S15 인용; S0와 평행) |
| `S0` | No actionable signal, no concrete target (discussion, brainstorming, casual exchange) | `none` (NOT a flow_type) |

`matched_rows`는 항상 **≥ 1개의 IDed component row(S1..S15)**를 담는다 — 비-compound `proceed`면 **정확히 1개**다. strict-superset 우선(예: S3 P0가 S2 Bug Fix를 subsume)이면 **우세 superset row 1개만** 인용한다(subsumed 하위 row는 matched_rows에 *싣지 않는다* — 즉 `[S3]`이지 `[S2,S3]`이 아니다; M2 superset 검출은 우세 row로부터 subsumed row를 *재도출*할 뿐 matched_rows에 둘 다 기대하지 않는다). Compound면 분류 근거가 된 ≥2 *component* row(S1..S15)의 id 모두(S16 meta-row는 **금지** — S16은 compound으로 매핑되나 자체가 matched_rows에 실리지 않음). 빈 `matched_rows`는 `proceed`에서 **금지**(매치 없으면 `proceed` 불가). 따라서 비-compound proceed의 matched_rows cardinality는 정확히 1(superset이라도 1) — multi-element matched_rows는 compound에서만 적법하다.

## Activities (single-pass, 루프 없음)

```
0. Input-precondition check (P8: garbage-in 맹신 금지 — 아래 Input preconditions 절)
   **명시적 precedence — 순서 고정**:
   0a. FIRST: 모든 shape/precondition INTERNAL assert를 *먼저* 실행 — reclassify_count(정수·비음수 유효성 포함) / prior_evidence / channel / clarifications / conversation_context 정형. 결손/기형/enum-밖 → error(INTERNAL) → orchestrator-level halt escalate. (reclassify_count의 정수 유효성 자체가 precondition이므로 cap 검사는 *유효한 정수에만* 가능 — 따라서 0a가 반드시 선행.)
   0b. THEN (0a의 모든 assert가 PASS한 경우에만): reclassify_count ≥ 3 → ambiguous{disposition:escalate} (분류 시도 없이 즉시, 분류에 엄격히 선행).
   즉 INTERNAL 결함과 cap이 동시 성립해도 **0a(error INTERNAL)가 항상 우선**한다 — 기형 입력은 cap에 도달하지 못한다. precedence 모호성 없음.

1. Comprehend
   primary_input + clarifications + conversation_context + prior_evidence
   → verb / target / concern_count 추출
   → complexity_signal의 *입력-신호 성분* 도출 (concern_count, target breadth, cross-cutting 단서 — flow_type 무관 부분만). 최종 complexity_signal 확정은 flow_type을 아는 Activity 2에서. (아래 규칙)

2. Classify Decision (단일 출력 — flow_type 확정 후 complexity_signal도 여기서 FINALIZE)
   ├─ 입력 무의미 (parse 실패)          → error(GIBBERISH)   ← 1차 판별자: parse 성립 먼저 (GIBBERISH↔none 경계 절과 정합)
   ├─ verb/target 추출 못함            → none(reasoning)      ← parse는 됐으나 actionable target 없음
   ├─ signal table 단일 row 매치       → flow_type 확정 → complexity_signal FINALIZE (입력-신호 성분 ⊕ flow_type) → proceed(flow_type, matched_rows=[Sx], confidence, complexity_signal)
   │  (또는 strict superset, S3 P0 over S2 Bug Fix)
   │  └─ verb/target ≥ 2 (서로 다른 flow 신호) → flow_type=compound, matched_rows=[근거 component Sx… (S1..S15, ≥2개; S16 meta-row 금지)]
   ├─ 다중 row 매치, superset 없음     → routing-blocking 질문 형성 가능? 
   │     ├─ 형성 가능 (단일 verb/target/urgency/concern axis가 후보들을 분리)  → ambiguous{disposition:clarify, question}
   │     └─ 형성 불가 (어떤 단일 axis로도 후보를 분리하는 질문을 만들 수 없음 = undecidable) → ambiguous{disposition:escalate, question:<원인 명시 free 1줄, cap 문자열 금지>}  ← 非-cap escalate (reclassify_count<3)
   │  question priority: verb > target > urgency > concern_count
   └─ Triage 자체 실패                 → error(INTERNAL) → orchestrator-level halt escalate
```

**Ask cycle은 Triage 안에 없음.** 호출자가 답변 받으면 clarifications에 추가하고 *재invoke*. 포기 결정도 호출자.

### GIBBERISH ↔ none 경계 (defect: 두 분기 사이 미정의 gap 제거)

두 분기는 **Comprehend가 입력을 *해석 가능한 진술*로 파싱했는지** 여부로 갈린다 — verb/target 매치 여부가 아니라 *파싱 성립 여부*가 1차 판별자다:

| 조건 (Comprehend 관점) | 분기 |
|---|---|
| 입력이 **응집된 자연어 진술로 파싱 불가** — 무작위 토큰/바이너리/깨진 인코딩/문장 구조 0, verb-유사 단어가 있어도 진술을 구성 못함 | `error(GIBBERISH)` (mechanical parse 실패) |
| 입력이 **응집된 진술로 파싱은 됨**(이해 가능) — 그러나 actionable한 verb+target을 추출 못함 (논의/잡담/모호한 느낌, concrete target 부재) | `none(reasoning)` |

즉 "verb-유사 단어가 섞인 무작위 토큰"은 **진술로 파싱되지 않으면 GIBBERISH**, **이해 가능한 진술이지만 actionable target이 없으면 none**이다. 경계는 *추출 결과의 빈약함*이 아니라 *파싱 자체의 성립*에 있다(principle 3: parse 실패=mechanical error → GIBBERISH; 파싱은 됐으나 정당하게 actionable-아님=verdict → none). 둘 사이 gap 없음 — 모든 입력은 "파싱 성립" 축에서 정확히 한쪽이다.

### complexity_signal 생산 규칙 (H2/P6: 필수 출력의 PRODUCTION rule — 입력 신호 ⊕ flow_type)

`complexity_signal`은 **입력 텍스트 신호(verb / target / concern_count)와 확정된 flow_type으로부터 결정적으로 도출**한다. 코드 분석 아님 — *입력 텍스트 신호*만으로 판단(boundary 준수). 두 단계로 생산한다: Comprehend(Activity 1)가 *입력-신호 성분*(concern_count, target breadth, cross-cutting 단서)을 도출하고, Classify(Activity 2)가 flow_type 확정 후 **최종값을 FINALIZE**한다 — `high`의 일부 트리거가 flow_type을 보기 때문(아래 표). deepen trigger 입력이며 `high`만이 trigger로 소비되고 `medium|low`는 non-trigger다(`none`은 proceed가 아니라 애초에 부재).

**아래 high/medium/low 표는 `result=proceed`일 때만 적용된다** (proceed가 아니면 `classification_metadata` 자체가 없어 complexity_signal이 존재하지 않음 — 따라서 비-proceed 입력이 concern_count≥2여도 `high` 행과 충돌하지 않는다; 표 진입 자체가 proceed-guard됨):

**이 표는 priority-ordered match다 — 위에서 아래로 *첫 매치 행이 이김*** (precedence 명시: high disjunct가 medium/low 텍스트 행을 지배). 즉 high의 어느 disjunct든 성립하면 — 특히 flow_type ∈ {`feature`,`migration`,`performance`,`compound`}(본질적 deep) 절이 성립하면 — 설령 동일 입력이 low 행의 텍스트 기준에도 *문자적으로* 매치하더라도 **`high`로 확정**한다(예: tiny 단일 concern의 feature). medium 행은 high가 성립하지 *않을 때만* 평가되며, **low 행은 high·medium 둘 다 성립하지 않는 *모든* proceed를 받는 catch-all default다** — 따라서 high도 medium도 아닌 proceed 입력은 (단일 좁은 target이든, target breadth 미지·concern_count==0이든) 빠짐없이 결정적으로 `low`로 떨어진다. 두 truthy 행 사이 모호성도, "어느 행에도 안 잡히는 proceed" gap도 없음 — 정확히 한 값:

| 우선순위 | complexity_signal (proceed 한정) | 도출 조건 (입력 신호 ⊕ flow_type) |
|---|---|---|
| 1 (최우선) | `high` | `concern_count ≥ 2` **또는** target이 다중 component/card/5+ files를 명시 **또는** flow_type ∈ {`feature`,`migration`,`performance`,`compound`} (본질적 deep) — *어느 disjunct든 성립하면 즉시 high, 하위 행 무시* |
| 2 | `medium` | (high 미성립) 단일 verb+target이나 cross-cutting 단서(여러 모듈 언급, "전반/곳곳") 1개 |
| 3 (default) | `low` | (high·medium 둘 다 미성립) **그 외 모든 proceed 입력** — 단일 좁은 target이든, target breadth가 미지/zero-concern(concern_count==0, 예: 'release v2'가 S12에 매치)이든, high·medium 어느 행에도 안 잡힌 proceed는 결정적으로 `low`로 fall through (positively-described 행이 아니라 *catch-all default*) |

`proceed`에서는 위 3값 중 정확히 하나가 *반드시* 채워진다(필수 필드, 생산 누락 불가). `proceed`가 *아닌* result(none/ambiguous/error)는 `classification_metadata` 자체가 없으므로 complexity_signal 필드가 **부재**한다 — 이 부재 상태를 schema 상 `none` enum 값으로 표기한다(즉 `none`은 "표의 한 행"이 아니라 *비-proceed에서의 필드 부재 sentinel*이며, high/medium/low 표와 상호배타다). 따라서 `none`과 high/medium/low는 같은 입력에서 동시에 성립할 수 없다.

## Confidence (H4/P6: low에 실재 trigger 부여 — self-negating 제거)

`confidence`는 *세 값 모두 도달 가능*해야 한다. 아래가 각 값의 실재 trigger다.

- **high**: **최초 분류(`reclassify_count == 0` 그리고 `prior_evidence` 부재)에서만** signal table 정확히 1 row 매치(또는 strict superset; 이때 matched_rows는 우세 superset row **1개만** 인용), clarifications 불필요. **또는 `flow_type=compound`** — compound의 정의상 근거인 ≥2 non-superset *component* row(S1..S15; S16 meta-row 아님) 매치 자체가 high의 trigger다(compound는 단일-우세-row 케이스가 아니라 다중-row가 *기대*되는 분류이므로, 다중 non-superset row가 ambiguous로 떨어지지 않고 high proceed가 된다 — schema `confidence_consistent_with_match_cardinality`가 compound를 '다중 non-superset row ⇒ ambiguous' 단언에서 면제). **compound는 reclassify(`reclassify_count ≥ 1`) 여부·정정 여부와 무관하게 항상 high다** — compound의 ≥2-component-row 근거가 single-row high·low(b) 정정 규칙을 *지배*한다(아래 high↔medium·compound↔low(b) precedence 참조). **single-row high는 `prior_evidence` 존재(reclassify) 케이스를 배제한다** — reclassify에서 prior_flow_type을 *재확인*하는 single-row 케이스는 high가 아니라 medium(안정 재확인)이다.
- **medium**: 1 row 매치하지만 입력에 약간 모호 → 직전 `ambiguous{disposition:clarify}`에 대한 답(clarifications) 사용으로 단일 row 확정된 경우(단 **prior_flow_type을 *다른* flow로 정정하지 *않는* non-correcting 확정에 한함** — 정정이면 아래 medium↔low(b) precedence에 의해 low(b)), **또는** reclassify에서 **현재 입력 자체가** `prior_flow_type`을 *다시* 독립 지지하는 안정 재확인(현재 입력 단독으로 prior row가 우세-row threshold를 넘김 — clarifications 사용 여부 무관). prior 재확인은 high도 low도 아닌 안정 분류다. **high↔medium precedence (reclassify re-confirm)**: 어떤 reclassify(`reclassify_count ≥ 1`, `prior_evidence` 존재)가 *같은* prior_flow_type을 single row로 재확인하면 — 현재 입력 단독이 prior row 우세-threshold를 넘기는 강한 재확인이라도 — high가 *아니라* medium이다(안정 재확인). high의 single-row trigger는 최초 분류(`reclassify_count == 0`, prior_evidence 부재)에만 예약된다. 따라서 같은 입력이 high의 'single row 매치' 텍스트와 medium의 'reclassify 재확인' 텍스트에 동시 매치하는 일은 발생하지 않는다 — prior_evidence 존재 여부가 둘을 결정적으로 가른다. (compound은 이 precedence의 예외: compound로의 분류는 reclassify 재확인이라도 항상 high — compound 규칙이 지배.)
- **low** *(실재 trigger)*: 단일 우세 row로 분류는 가능하나 **약한 매치** — (a) prior_evidence가 *동일* flow_type을 지지하지만 **현재 입력은 그 prior row를 독립적으로 재지지하지 못함**(현재 신호 단독으론 우세-row threshold 미만이라 marginal; 지지의 무게를 prior_evidence가 짊), **또는** (b) reclassify(`reclassify_count ≥ 1`)에서 직전 분류를 좁은 신호로 *다른* single flow_type으로 정정(`matched_rows`=정정된 single component row 1개). 즉 `low`는 "ambiguous로 떨어뜨리진 않지만 downstream(특히 Investigate)이 *재검토 여지*를 알아야 하는 약한 proceed"를 표시한다. (우세 row가 *없으면* 여전히 `ambiguous` — `low`는 우세 row가 *있되 약한* 경우다.) **low(b)는 *single-row* 정정에만 적용된다 — compound로의 정정(reclassify가 ≥2 component row로 새로 분류)은 low(b)가 아니라 high다(compound↔low(b) precedence: compound의 ≥2-component-row 근거가 정정 규칙을 지배하므로, reclassify가 prior와 *다른* flow set의 compound로 분류해도 confidence=high; 아래 compound↔low(b) precedence 참조).

**medium ↔ low(a) precedence (same-flow re-confirm-under-reclassify 중복 제거)**: 두 trigger는 **현재 입력이 prior row를 독립적으로 재지지하는가**라는 단일 기준으로 *상호배타적으로* 갈린다 — 현재 입력 단독이 prior row의 우세-row threshold를 *넘기면* `medium`(현재 입력 자체가 재확인), *넘기지 못하면*(지지가 prior_evidence에 의존) `low(a)`. 따라서 same flow_type re-support reclassify 입력에 대해 단일 confidence 값이 결정적으로 정해진다 — 두 값이 동시에 강제되지 않는다.

**medium ↔ low(b) precedence (correcting-reclassify 중복 제거)**: medium은 prior_flow_type을 *유지*하는 same-flow 확정(clarifications-confirm 또는 현재-입력 재확인)에만 적용되고, low(b)는 reclassify(`reclassify_count ≥ 1`)가 직전 분류를 *다른* flow로 좁게 정정하는 경우다 — 두 trigger는 **현재 분류가 prior_flow_type과 같은 flow인가(유지) vs 다른 flow인가(정정)**라는 단일 기준으로 갈린다. 따라서 **정정(다른 flow로 reclassify)이면 clarifications 사용 여부와 무관하게 항상 low(b)가 이긴다** — clarifications로 *정정된* 단일 row를 확정했더라도 그것은 same-flow 재확인이 아니라 flow *변경*이므로 medium-via-clarifications가 아니다. medium-via-clarifications는 prior와 *같은* flow를 확정하는 non-correcting 케이스에만 예약된다. 그러므로 reclassify-정정 입력에 대해 단일 confidence 값(low(b))이 결정적으로 정해진다 — medium과 low(b)가 동시에 강제되지 않는다.

**compound ↔ low(b) precedence (compound 정정 중복 제거)**: low(b)는 reclassify가 *single* 우세 row로 *다른* flow를 정정하는 경우에만 적용된다. reclassify가 prior와 다른 flow set의 **compound**(verb/target ≥ 2, ≥2 component row 매치)로 새로 분류하면 — single-row 정정이 아니라 compound 분류이므로 — **compound 규칙이 지배하여 confidence=high다**(low(b) 아님). 두 trigger는 **정정 결과가 single row인가(low(b)) vs ≥2 component row의 compound인가(high)**라는 단일 기준으로 갈린다. compound의 defining ≥2-component-row 근거(high의 trigger)는 reclassify·정정 맥락에서도 동일하게 성립하므로, compound 분류는 reclassify 여부와 무관하게 항상 high이며 low(b)와 동시에 강제되지 않는다. 따라서 compound-정정 입력에 대해 단일 confidence 값(high)이 결정적으로 정해진다(schema `confidence_consistent_with_match_cardinality` + `compound_confidence_high_dominates_reclassify`).

`low` confidence는 여전히 valid `proceed`다(orchestrator는 정상 start). downstream가 신뢰도 메타로 활용.

## Input preconditions (P8: upstream-trusted 필드 정형 assert — garbage-in 맹신 금지)

Triage는 stateless라 `reclassify_count`/`prior_evidence`의 *진실*(실제 시도 횟수)을 검증할 수 없다 — 그러나 **존재+정형(shape)** 은 assert할 수 있고, 결손/기형은 escalate한다. 이는 Verify의 일(truth)이 아니라 *입력 계약 위반 감지*다.

| precondition | 위반 시 처리 |
|---|---|
| `reclassify_count`가 present인데 비-정수 / 음수 / non-numeric | `error(INTERNAL)` → **orchestrator-level halt escalate** (principle 2: 비-Decide 소비자는 `request_upstream_deepen` 못 씀; principle 1: primary 실패 → escalate. *reclassify 루프 아님* — 아래 `## INTERNAL escalate semantics` 참조) |
| `prior_evidence`가 present인데 `prior_flow_type`이 16 canonical id 밖 / `evidence` 부재 또는 **기형**(non-empty string도 아니고 `{prior_matched_rows, summary}` 구조도 아님 / `evidence`가 empty·whitespace-only string / 구조형인데 `summary`가 empty·whitespace-only) | `error(INTERNAL)` → orchestrator-level halt escalate (P8: `evidence`는 Comprehend 입력(Activity 1)으로 직접 먹여지므로 단순 *존재*만이 아니라 *non-empty 정보성 shape*를 assert — empty/whitespace evidence는 garbage-in이므로 신뢰 금지. `prior_evidence_evidence_nonempty_shape`) |
| `prior_evidence`가 present인데 `reclassify_count == 0`(또는 부재→default 0) | `error(INTERNAL)` → orchestrator-level halt escalate (cross-field 계약 위반: prior_evidence는 reclassify용이므로 reclassify 상태(`reclassify_count ≥ 1`)를 *함의*한다 — reclassify_count==0과 prior_evidence 동시 존재는 stale/inconsistent upstream이다. confidence/disagreement 트리거가 존재하지 않는 reclassify 상태를 참조하게 두지 않는다. 즉 `prior_evidence present` ⇒ `reclassify_count ≥ 1` 불변식을 assert; 위반=계약 위반.) |
| `reclassify_count ≥ 1` 이고 `reclassify_count < 3` 인데 `prior_evidence` **부재** | `error(INTERNAL)` → orchestrator-level halt escalate (cross-field 계약 위반: `reclassify_count ≥ 1`은 active reclassify 상태를 *주장*하므로 reclassify-context 입력인 `prior_evidence`를 *함의*한다 — `reclassify_count ≥ 1` 인데 prior_evidence가 없으면 confidence low(a)/low(b)/medium·disagreement-table 분기가 *읽을 prior가 없는* reclassify 상태에 진입하게 된다(silent garbage-in). 즉 `reclassify_count ≥ 1 (그리고 < 3)` ⇒ `prior_evidence present` 불변식을 assert — 위는 prior_evidence-present-with-count-0를, 이 행은 그 *대칭*인 count≥1-without-prior_evidence를 닫는다. 두 행이 함께 `prior_evidence present ⟺ reclassify_count ≥ 1`[단, count≥3 cap escalate는 분류 시도 전 short-circuit이라 prior_evidence 불요 — 0b가 0a 후 실행되나 본 행은 `< 3` scope]를 완성한다. `reclassify_count_active_implies_prior_evidence`) |
| `reclassify_count ≥ 3` | 분류 시도 없이 `ambiguous{disposition:escalate, question:"reclassify cap reached, manual intervention required"}` (cap 자기검사 — 정형이므로 escalate-as-verdict, mechanical error 아님). 이 *정확한 문자열 동등* 단언은 `reclassify_count ≥ 3` cap 경로에만 적용된다(schema `reclassify_cap_forces_ambiguous_escalate` scope) — 다른 어떤 escalate에도 발화하지 않음. |
| 非-cap escalate (`reclassify_count < 3`인데 undecidable/upstream-deficient로 escalate 도달 — *생산 조건*: 다중 row 매치·superset 없음인데 routing-blocking 질문을 형성할 수 없음, 즉 어떤 단일 verb/target/urgency/concern axis로도 후보를 분리하는 질문을 만들 수 없는 undecidable tie. Activity 2 / disagreement-table 참조) | `ambiguous{disposition:escalate, question:<원인 명시 1줄>}` — question은 비어있지 않은 원인 1줄이며 예약 cap 문자열 "reclassify cap reached, manual intervention required"를 쓰지 *않는다*(그 문자열은 cap 전용; schema `noncap_escalate_question_is_nonempty_noncap_reason`). cap 동등 검사는 여기 적용 안 됨. |
| `primary_input`/`channel` 부재 | `error(INTERNAL)` → orchestrator-level halt escalate (필수 필드 부재) |
| `primary_input`가 present이나 empty/whitespace-only(존재하되 degenerate) | `error(GIBBERISH)` → caller 반환 (부재 아님 → INTERNAL 계약 위반 아님; 빈/공백 carrier는 응집된 진술로 *파싱 불가*이므로 GIBBERISH↔none 경계의 1차 판별자[parse 성립 여부]에서 parse 실패 = `error(GIBBERISH)`로 확정. 부재[필수 필드 결손 → INTERNAL]와 명시 구분: 결손은 계약 위반, 빈 present는 parse-불가 입력이다.) |
| `primary_input`의 내부 타입(UserMessage \| A2ARequest \| CIConfig)이 `channel`과 일치하는지 | **검증 안 함 — 의도적**. Triage에 `primary_input`의 내부 typing은 *불투명(opaque)*하다: Triage는 `primary_input`을 Comprehend에 그대로 먹이는 자연어 텍스트 carrier로만 다루며 channel-타입 페어링(예: channel=a2a인데 UserMessage 모양)을 *assert하지 않는다*. 이는 silent-trust gap이 아니라 *명시적 lane 결정*이다 — primary_input 내부 구조의 권위 source는 upstream channel adapter이지 Triage가 아니며(Boundary: 채널 어댑팅은 Triage 일 아님), Comprehend는 channel-불문 텍스트 추출만 한다. (대조: `channel` enum-밖, 필수 필드 부재, cross-field 불변식 위반은 위에서 차단된다.) |
| `channel`이 present인데 `{user_session, a2a, ci}` enum 밖 (예: `slack`) | `error(INTERNAL)` → orchestrator-level halt escalate (입력 계약 위반 — sister step Ground ground.md `channel ∈ {user_session, a2a, ci}` precondition과 정합; 채널별 동작 표가 정확히 이 3값만 enumerate하므로 enum 밖 값은 정의된 per-channel 분기가 없음) |
| `clarifications`가 present인데 array가 아니거나 원소가 `{q, a}` 형태 아님(q/a 부재) | `error(INTERNAL)` → orchestrator-level halt escalate (P8: optional 입력도 shape assert — Comprehend가 직접 소비하므로 기형 신뢰 금지) |
| `clarifications`의 *cross-field* precondition | **없음 — 명시적 결정**. `clarifications`는 (shape 외에) 어떤 cross-field 불변식도 지지 *않는다*: 임의의 channel과 함께, 임의의 `reclassify_count`(0 포함)와 함께 올 수 있다. clarify loop는 reclassify와 *독립*이기 때문이다 — clarify는 직전 `ambiguous{disposition:clarify}` 질문에 대한 답 누적이지 reclassify 상태(`reclassify_count ≥ 1`)를 *함의하지 않는다*(대조: `prior_evidence` present ⇒ `reclassify_count ≥ 1`, `conversation_context` present ⇒ `channel == user_session`은 함의). 따라서 `reclassify_count == 0`에 동반된 clarifications는 정상이며 INTERNAL을 발화하지 않는다(shape만 통과하면 신뢰). 이 침묵-아닌-명시 결정으로 prior_evidence/conversation_context와의 비대칭이 의도적 lane 결정임을 닫는다(schema `clarifications_has_no_crossfield_precondition`). |
| `conversation_context`가 present인데 정형(None-state turn 표현)이 아님 | `error(INTERNAL)` → orchestrator-level halt escalate (P8: optional 입력도 shape assert) |
| `conversation_context`가 present인데 `channel != user_session` | `error(INTERNAL)` → orchestrator-level halt escalate (cross-field 불변식: 공유 `_defs` Channel def가 'conversation_context exists only for user_session'를 선언하므로 `conversation_context present` ⇒ `channel == user_session`. a2a/ci가 conversation_context를 실어 보내면 stale/malformed upstream이다 — channel-enum precondition과 평행하게 차단; schema `conversation_context_implies_user_session_channel`. shape assert(위 행)와 별개의 cross-field 단언으로, Comprehend에 먹이기 전 garbage-in 방어[P8]를 그 불변식에 대해 완성한다.) |

**escalation은 무한 ping-pong하지 않는다**: 위 `error(INTERNAL)` input-precondition escalate는 `failure_origin=triage` reclassify 루프가 *아니라* **orchestrator-level 종단 halt**라 애초에 재진입하지 않는다(`## INTERNAL escalate semantics`). reclassify 루프(`failure_origin=triage`, Verify-귀착)는 `(flow_id, triage)` **5-누적-fail halt cap** + reclassify cap 3이 bound한다(decide/failure-routing.md 재사용). 양쪽 모두 무한 루프 없이 안전.

`reclassify_count` 값 자체의 *위조*(거짓 0)는 stateless Triage가 못 잡는 환원불가 residual — orchestrator가 단일 source로 counter를 소유·증가시키므로 신뢰 경계는 orchestrator에 있다(아래 Reclassify Cap).

### prior_evidence 불일치 처리 (H6/P8: prior_flow_type ↔ 현재 comprehension 충돌)

reclassify 시 `prior_evidence.prior_flow_type`이 현재 Comprehend 결과와 *다른* flow를 지시할 수 있다. cap은 loop COUNT만 bound하므로 *disagreement DECISION* 규칙을 명시한다 — 단 Triage는 *분류만* 한다(사실 재해석/판정 금지, 그건 Investigate/Decide):

| 상황 | 처리 |
|---|---|
| 현재 입력이 prior와 *다른* **단일** 우세 row 지지 | 현재 분류 채택(`proceed(new flow_type)`), `confidence=low` — low(b) single-row 정정, `matched_rows`=현재 row 1개. prior는 무시(재해석 금지). |
| 현재 입력이 prior와 *다른* flow set의 **compound** 지지(verb/target ≥ 2, ≥2 component row) | 현재 분류 채택(`proceed(compound)`), `confidence=high` — compound↔low(b) precedence: compound 규칙이 정정 규칙을 지배(reclassify·정정이라도 compound는 항상 high), `matched_rows`=근거 component row ≥2개. prior는 무시(재해석 금지). |
| 현재 입력 *자체가* prior_flow_type을 *다시* 독립 지지 (현재 입력 단독으로 prior row가 우세-row threshold를 넘김) | `proceed(prior_flow_type)`, `confidence=medium` — 안정 분류. clarifications 사용 여부와 무관하게 medium(현재 입력 자체의 prior 재확인은 그 자체로 medium trigger다 — Confidence 절 medium 참조; clarifications 없이 재확인해도 high(신선 단일 매치)도 low(약한/정정)도 아니므로 medium으로 확정). |
| 현재 입력은 prior row를 *독립적으로 재지지하지 못함* (현재 신호 단독은 우세-row threshold 미만 marginal; 지지의 무게를 prior_evidence가 짊) | `proceed(prior_flow_type)`, `confidence=low` — low(a). medium과의 경계: 현재 입력 *단독* threshold 충족 여부가 결정적 기준(Confidence 절 medium↔low(a) precedence 참조). 단일 confidence 값으로 결정. |
| 현재 입력이 두 flow를 동등 지지(우세 row 없음), routing-blocking 질문 형성 *가능* (단일 verb/target/urgency/concern axis가 후보들을 분리) | `ambiguous{disposition:clarify, question}` (1 routing-blocking 질문). **이 행은 `reclassify_count < 3`에서만 평가된다** — `reclassify_count ≥ 3`이면 Activity 0의 cap 검사가 *분류 시도 전* 이미 short-circuit하여 예약 cap 문자열로 `disposition:escalate`를 강제하므로(cap이 분류에 **엄격히 선행**), two-flow tie는 cap에서 결코 도달하지 않는다. |
| 현재 입력이 두 flow를 동등 지지(우세 row 없음), routing-blocking 질문 형성 *불가* (어떤 단일 verb/target/urgency/concern axis로도 후보를 분리하는 질문을 만들 수 없음 = undecidable) | `ambiguous{disposition:escalate, question:<원인 명시 free 1줄>}` — 非-cap escalate. **이 행도 `reclassify_count < 3`에서만 평가된다**(cap이 분류에 엄격히 선행하므로 tie 자체가 cap에서 도달 불가). question은 cap 문자열 "reclassify cap reached, manual intervention required"를 *쓰지 않는* 비어있지 않은 free 1줄이다(`noncap_escalate_question_is_nonempty_noncap_reason`). cap 동등 검사는 여기 적용 안 됨. 이것이 clarify(질문 형성 가능)와 非-cap escalate(질문 형성 불가)를 가르는 결정적 조건이다. |
| 현재 입력이 actionable target을 못 뽑음(파싱은 됨, verb+target 부재) | `none(reasoning)` — **reclassify에서 `none`은 허용된 disposition이다**. reclassify가 입력 변경으로 재invoke되었는데 현재 입력이 더 이상 actionable하지 않으면 정상적으로 `result=none`을 낸다(Activity 2의 GIBBERISH↔none 경계와 동일 규칙). prior_evidence는 *무시*된다(재해석 금지 — Triage는 현재 입력만 분류; prior는 carrier 없는 `none`에 실리지 않으며 matched_rows 자체가 없다). reclassify가 항상 proceed/ambiguous를 내야 한다는 제약은 없다. |
| 현재 입력이 응집된 진술로 파싱 불가(무작위 토큰/깨진 인코딩) | `error(GIBBERISH)` — **reclassify에서 `GIBBERISH`도 허용된 disposition이다**. reclassify 입력이 parse에 실패하면 최초 분류와 동일하게 mechanical parse 실패로 `error(GIBBERISH)`를 낸다(GIBBERISH↔none 경계 절 1차 판별자 동일 적용). prior_evidence는 error 출력에 실리지 않으며 *무시*된다(error는 분류 결과가 아니라 실행/parse 결함이라 prior 재확인·정정 의미 없음). 이는 `error(INTERNAL)` orchestrator-halt와 달리 통상 caller 반환 경로다(`## 채널별 동작` GIBBERISH 행). |

Triage는 "prior가 맞나 새 게 맞나"를 *판정*하지 않는다 — *현재 입력 신호*로 분류하고, 불일치는 `confidence=low`로 *표시*만 한다. 판정·영향분석은 Investigate/Decide의 일(STAY-IN-LANE).

## Failure & degrade handling

Triage는 **enhancement 도구가 없다** — 외부 MCP/도구 호출 없이 입력 텍스트만으로 분류하는 *primary*-only step이다. 따라서 degraded_pass 분기가 없다(보조 도구 부재 자체가 불가능). 자기 핵심 실패는 두 경로로만 표면화한다:

- **mechanical error** (parse 불가 / 내부 예외 / 필수 입력 결손·기형): `error(GIBBERISH | INTERNAL)`. `INTERNAL`은 **orchestrator-level halt escalate**(principle 1: primary 실패 → escalate). (H1과 정합: 이건 "정당하게 빔"이 아니라 mechanical error다 — principle 3.) (`failure_origin=triage`의 reclassify-loop 의미가 *아님* — 아래 `## INTERNAL escalate semantics`.)
- **terminal escalation** (reclassify cap 도달): `ambiguous{disposition:escalate}`. orchestrator는 halt(재invoke 안 함).

`request_upstream_deepen`은 **Triage가 절대 emit하지 않는다** — 그건 Decide 전용 제어 신호다(principle 2). Triage가 upstream으로 더 깊이 필요한 경우는 없다(Triage가 *첫* step).

### INTERNAL escalate semantics (defect: `failure_origin=triage` ≠ halt)

canonical `decide/failure-routing.md`은 `failure_origin=triage`를 **"Triage 재invoke with prior_evidence (reclassify), cap 3"** 로 정의한다 — 즉 *halt가 아니라 reclassify 루프*다. 그 값은 **Verify가 변경 후 flow 오분류를 Triage 탓으로 귀착**시킬 때(prior_evidence를 동반한 정상 reclassify 진입)만 쓰는 routing 신호다.

Triage *자체*의 `error(INTERNAL)`(parse 내부 예외 / upstream-precondition 위반)은 *오분류가 아니라 실행 결함*이라 **reclassify할 prior 분류가 없다** — 따라서 `failure_origin=triage` 루프로 재진입시키면 안 되고, **orchestrator-level halt**로 escalate한다. orchestrator는 이를 `ambiguous{disposition:escalate}`/`cap_exceeded`와 동일한 **종단 halt** 분기로 처리한다(재invoke 안 함, 기존 orchestrator halt 동작 재사용 — 새 메커니즘 0). 즉:

| Triage escalate 종류 | 신호 | orchestrator 처리 |
|---|---|---|
| 정상 reclassify (Verify-귀착 오분류) | `failure_origin=triage` + prior_evidence | Triage 재invoke (reclassify cap 3) |
| 자기 mechanical error | `error(INTERNAL)` | **종단 halt** (재invoke 안 함) |
| terminal escalation (cap 도달) | `ambiguous{disposition:escalate}` | **종단 halt** (재invoke 안 함) |

`error(INTERNAL)` 종단 halt는 `(flow_id, triage)` 5-누적-fail halt cap과 무관하게 *즉시* halt다(루프에 의존하지 않음). 5-누적-fail cap은 reclassify 루프(`failure_origin=triage`)만 bound한다.

## 채널별 동작

| 채널 | none | ambiguous{clarify} | ambiguous{escalate} | error |
|---|---|---|---|---|
| user_session | 호스트 LLM이 자유 대화 계속 | 호스트 LLM이 user에 질문 → 답 받아 재invoke | flow halt + user escalate ("intent 결정 불가") | `GIBBERISH`(rare; Comprehend 실패 시)=호스트가 재진술 요청 / `INTERNAL`(기형 reclassify_count·prior_evidence·내부 예외)=호스트가 system/internal-error escalation 표면화(orchestrator-level halt) |
| a2a | `INTENT_NOT_ACTIONABLE` 반환 | `INTENT_INCOMPLETE` + question 반환 | `INTENT_UNRESOLVABLE` 반환 (halt) | `GIBBERISH`/`INTERNAL` 반환 |
| ci | trigger config 에러 | trigger config 에러 (config 부족) | trigger config 에러 (cap) | trigger config 에러 |

이 표는 `{user_session, a2a, ci}` 3채널을 **exhaustive**하게 enumerate한다. `channel`이 이 enum 밖이면(예: `slack`) Activity 0의 input-precondition에서 *분류 시도 전* `error(INTERNAL)` → orchestrator-level halt로 차단되므로(Input preconditions 절) 이 표의 미정의 행에 도달하지 않는다 — default/else 분기 불필요. (sister step ground.md의 동일 `channel ∈ {…}` precondition과 정합.)

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
| Undecidable | 다중 flow를 동등 지지(우세 row 없음)인데 후보를 분리하는 routing-blocking 질문을 형성할 수 없음 (어떤 단일 verb/target/urgency/concern axis로도 분리 불가) | `ambiguous{disposition:escalate, question:<원인 명시 free 1줄>}` 非-cap escalate (`reclassify_count<3`; Activity 2 / disagreement-table 참조) — orchestrator halt |
| Ambiguous | No actionable target ("something feels off") | `none(reasoning)` — user 세션은 자유 대화, A2A/CI는 INTENT_NOT_ACTIONABLE |

## None ↔ Flow Transition Rules — *context-only (orchestrator/host-LLM 소유, Triage 비관여)*

> **이 절은 비-규범 컨텍스트다**: Triage의 출력이 *어떻게 소비되는지* 보여줄 뿐, Triage가 지는 의무가 아니다. 전이 결정(invoke 시점/abandon/suspend)은 전부 host-LLM/orchestrator의 일이며(Boundary 표 참조), Triage는 invoke되면 *분류 1개*만 출력한다. 아래 "Host LLM 행동" 열의 어떤 행도 Triage가 수행하지 않는다.

None ↔ Flow 전이는 *호스트 LLM*의 책임이지 Triage의 책임이 아니다. 호스트 LLM이 conversation 누적을 보다가 actionable signal 감지 시 Triage invoke. 결과에 따라 처리:

| Trigger | Host LLM 행동 |
|---------|---------------|
| User states actionable intent | Triage invoke → `proceed`면 orchestrator.start, `ambiguous{clarify}`면 user에 질문 후 재invoke, `none`이면 자유 대화 계속 |
| Conversation produces spec-level detail | Host LLM이 conversation_context와 함께 Triage invoke → 결과 처리 |
| User explicitly abandons | Host LLM이 orchestrator.abandon 호출 (Triage 미관여) |
| No flow-related input for 3+ exchanges | Host LLM이 user에 "continue or suspend?" 질문 (Triage 미관여) |

## Flow Lifecycle Rules — *context-only (Orchestrator 소유, Triage 비관여)*

> **이 절은 비-규범 컨텍스트다**: lifecycle 전이·state-file 쓰기·resume 정책은 전부 **Orchestrator의 persistence 책임**이며(Boundary 표: "flow-state 관리 / persistence → Orchestrator", "No persistence"), Triage 계약이 그 형식을 정의하지 않는다. Triage가 lifecycle에 기여하는 *유일한* 지점은 **Start**의 첫 분류뿐 — 그 외 행은 Triage가 수행하지 않으며, state-file 필드 형식의 권위 source는 orchestrator/state-schema이지 이 표가 아니다. (state-file 컬럼은 *예시적 설명*이지 Triage가 쓰는 schema가 아니다.)

| Event | (orchestrator) Action | (orchestrator-owned) State file — *예시, Triage 비작성* |
|-------|--------|-------------------|
| **Start** | **Triage classifies** → Ground → Investigate → Decide → core steps | (orchestrator가 기록) flow type, step, status=active |
| **Suspend** (user switches topic) | Save progress (no Reflect) | (orchestrator) status=suspended, current step, completed work, pending items |
| **Suspend** (P0 preemption) | Pause immediately → new Bug Fix P0 flow starts | (orchestrator) status=suspended, preempted_by=P0, resume point |
| **Resume** | skip completed steps → continue from suspension point | (orchestrator) status=active |
| **Complete** | Reflect → record learnings | (orchestrator) status=completed |
| **Abandon** | Reflect(abandoned, reason) | (orchestrator) status=abandoned |

Resume priority(orchestrator 정책): P0 preemption always resumes after P0 completes. User-suspended flows resume only on explicit request. *Triage는 이 정책에 관여하지 않는다.*

## User Override — *context-only (host-LLM/orchestrator 소유, Triage 비관여)*

> **이 절은 비-규범 컨텍스트다**: override를 *해석·집행*(reclassify 진입, Ground 재시작, deviation 기록)하는 것은 host-LLM/orchestrator의 일이다. Triage가 하는 일은 override가 *재invoke*로 도달했을 때(예: 새 directive가 `primary_input`/`clarifications`에 반영됨) 그 입력을 다시 *분류*하는 것뿐이다 — restart/Reflect-기록/flow 생성 여부는 Triage가 결정하지 않는다.

User can override Triage classification at any point (집행은 host-LLM/orchestrator):
- "This isn't a refactor, it's a feature" → (orchestrator) reclassify, restart from Ground for new flow type
- "Skip the tests, just implement" → (orchestrator/host) follow user directive, Reflect records deviation
- "I don't want a flow for this" → (host) None으로 취급, even if signal was clear

## Context Inheritance Rules

호스트 LLM이 Triage invoke 시 `conversation_context`로 None-state turns를 전달. Triage의 Comprehend가 이를 통합 이해.

- **Inherit / Do-not-inherit 필터링은 host-LLM 소유** *(context-only, 비-규범)*: 무엇을 `conversation_context`에 담고 무엇을 거를지는 host-LLM이 invoke *전에* 결정한다 — Triage는 받은 것을 입력으로 쓸 뿐 필터링하지 않는다.
  - **Inherit (host가 담음)**: decisions made, constraints identified, scope discussed, files mentioned, approach agreed
  - **Do not inherit (host가 거름)**: abandoned ideas, rejected approaches, tangential discussion
- **Rule (Triage 자기 의무)**: Triage는 `conversation_context`를 *Comprehend의 입력*으로 사용. 별도 결박 artifact 생산 안 함 — 분류 결과만 출력. 다음 step (Ground)도 같은 conversation_context를 orchestrator로부터 받음.

## Reclassify Cap

Triage reclassify는 **flow 당 최대 3회의 *분류 시도***(classifying attempts)를 허용한다 — `reclassify_count` 값 `0`, `1`, `2`가 그 3회의 분류 시도이며, `reclassify_count ≥ 3` 도달 시(4번째 invoke) Triage는 *분류를 시도하지 않고* 자동 `ambiguous{disposition:escalate}`를 출력한다(Input preconditions 절). 즉 escalate를 발화하는 값 `3`은 분류 시도가 아니라 *cap escalate invocation*이므로 "3 classifying attempts (count 0,1,2) + cap escalate at count≥3"로 일관되게 읽힌다. orchestrator는 `ambiguous`의 `disposition=escalate` *필드값*을 읽고 flow halt + user/caller escalate("intent 결정 불가"), 재invoke 안 함(loop 방지 — H1: discriminant가 magic string이 아니라 실재 enum 필드라 분기가 결정적). `disposition=clarify`이면 정상 질문→재invoke loop.

**상한 무방어는 의도된 결정이다**: precondition은 `reclassify_count`의 정수·비음수 유효성만 assert하고(Input preconditions 절 line 191) *상한*은 두지 않는다 — 임의의 유효 비음수 정수 ≥ 3은(9999 같은 비정상적으로 큰 값 포함) **모두 정상적으로 cap escalate(`ambiguous{disposition:escalate}`)로 매핑된다**. 이는 누락이 아니라 결정이다: orchestrator가 counter의 *단일 source*이자 소유자이므로(아래) cap-3 / 5-누적-fail halt 불변식을 *지키는 것은 orchestrator 책임*이고, stateless Triage는 ≥3이라는 단조 임계만 본다 — "3인지 9999인지"는 Triage 분기에 무관(둘 다 cap 도달 = 종단 escalate). 따라서 거대한 값은 inconsistent upstream으로 *재분류되지 않으며* INTERNAL을 발화하지 않는다(정수 유효성[line 191]만 통과하면 cap escalate). 상한 sanity 검사를 Triage에 두지 않는 이유: counter 진실의 권위 source는 orchestrator이고(아래), Triage는 그 값의 *위조/과대*를 못 잡는 환원불가 residual을 지지 않는다(stateless).

`reclassify_count`의 *소유자는 orchestrator*다 — orchestrator가 단일 source로 값을 증가시키고, reclassify 시 `flow_id`를 *유지*(변경 X)하여 counter 의미를 보존한다. Triage는 그 값을 *읽고 정형 검증*만 한다(증가/소유 안 함 — Boundary). A2A/CI도 동일 cap. `(flow_id, triage)` 5-누적-fail halt cap이 reclassify+escalate 전체 ping-pong을 추가로 bound한다.
