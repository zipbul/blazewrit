# Workflow Plan

Status: Architecture finalized. Final design: **9 steps, 7 reviewers, 16 flows**, produce ⇄ review loop pattern, Ground + Investigate + Decide chain (Analyze/기획 deprecated). Execution model: script orchestrator (orchestrator.ts) — see EXECUTION_PLAN.md.

## Architecture

```
None (자유 대화/논의) ↔ Triage → Flow[Ground → Investigate → Decide → Spec? → Core Steps → Verify → Reflect]
```

- **None**: Free conversation state. 사용자가 뭘 할지 모를 때 에이전트와 대화/논의. Actionable signal이 나오면 Triage가 Flow로 전환. 논의 중 결정된 내용은 Flow 진입 시 context로 상속.
- **Triage**: **Stateless classification function** — `(input) → (output)`. 입력을 16 flow 중 하나로 분류 (또는 none/ambiguous/error). 코드 분석 안 함. flow 상태 안 봄. 루프 안 돔. persistence 없음. 한 invocation = 한 출력. Output 4종: `proceed(flow_type)` / `none` / `ambiguous(question)` / `error`. Ask cycle은 Triage 밖 — 호출자가 답 받아 clarifications와 재invoke. Active flow 충돌 / cycle cap / 충돌 해결 / preempt 등은 모두 orchestrator/caller 책임.
- **Ground**: **Evidence boundary.** Triage된 의도 → bounded·sourced·current 사실 + 명시 불확실성. 해석/판단/선택 없음. 3 활동: (1) ED graph query — request 영역 subgraph (bounded), (2) Volatile capture — flow_type별 선언된 measurement profile 실행, (3) Surface — ED ambiguous/inferred + capture 실패 → unknowns/conflicts. 모든 사실에 source provenance + freshness metadata.
- **Investigate**: **Task-specific interpretation** — Ground 사실을 *설계 가능한 문제 정의*로 해석. 활동: Impact (영향 범위, ED traversal) / Constraints (제약 식별) / Risk surface (실패 모드) / Compatibility verdict (명백 호환성). *결정·옵션 생성·설계 안 함* — 모두 Decide 책임. 깊이는 flow별. (이전 명명: "Analyze".)
- **Decide**: **Decision ownership step — universal, 모든 flow 필수.** Investigate 산출물 위에서 *결정*. 3 mode 산출물:
  - **Record** (Chore / P0 / simple Bug Fix / Release): 결정 1줄 + 근거 (decision record)
  - **Plan** (Bug Fix Unreproducible / Refactor / Migration / Test / Spike): 옵션 선택 + 우선순위 + 접근 명세
  - **Design** (Feature / Performance / 기획-standalone / Compound): 기획서 (architecture + 정책 + 유저 플로우 + 요구사항) + emberdeck intent card
  
  Mode 결정: flow definition이 기본 mode 선언 + Decide가 옵션 N≥2 발견 시 Record→Plan upgrade 가능 (situational upgrade). Design mode만 intent card 자동 생성.
- **Spec**: 기획서에서 AC 추출 + 코드 architecture(디렉토리/파일 설계) + task 분해. emberdeck spec card + codeLinks. 플로우에 따라 포함/생략.
- **Core Steps**: Test, Implement, Report (from step pool).
- **Verify**: Mandatory on every flow. 플로우 전체 목적 달성 확인. All 16 flows end with Verify → Reflect. On FAIL, diagnoses failure origin and routes back to responsible step.
- **Reflect**: Mandatory on every flow completion and abandonment. Does NOT run on suspension.
- **Step Execution**: All steps except Verify and Reflect run as produce ⇄ review loop with dedicated reviewer agent (Ralph Loop pattern).
- **Flow State**: Persisted in `.blazewrit/flow-state.yaml`. Updated on every step transition. Read at session start. Survives context loss.

## Step Pool (9)

| Step | Description |
|------|-------------|
| Ground | **Evidence boundary** — Triage된 의도를 bounded·sourced·current 사실 + 명시 불확실성으로 변환. 해석/판단/선택 없음. ED graph subgraph + flow별 measurement profile + surface (ambiguous/inferred/capture-fail → unknowns/conflicts). 모든 사실에 provenance·freshness. |
| Investigate | **Task-specific interpretation** — Ground 사실을 설계 가능한 문제 정의로 해석. Impact / Constraints / Risk / Compatibility. *결정·옵션·설계 안 함*. 깊이는 flow별. (이전 명명: Analyze.) |
| Decide | **Decision ownership — universal, 모든 flow 필수.** Investigate 위에서 결정. 3 mode 산출물: Record (결정 1줄+근거) / Plan (옵션 선택+우선순위+접근) / Design (기획서 + emberdeck intent card). Mode = flow definition declared + situational upgrade. Design mode만 intent card 자동 생성. |
| Spec | 기획서에서 AC 추출(번호, 측정 가능, 정책 룰 포함) + 코드 architecture(디렉토리/파일 설계, 모듈 경계, 의존 관계) + task 분해 + 의존성 + 순서. emberdeck spec card + codeLinks. Plan-as-prompt: Spec 출력이 곧 downstream 실행 프롬프트. |
| Test | Write failing tests (RED). Reproduce bugs. Add coverage. Profile/measure (Performance flow). Validate migration scripts (Migration flow). |
| Implement | Write code (GREEN). Sub-activities: setup (deps, config, infrastructure), code, commit. firebat scan after every change. emberdeck validate_code_links. Atomic commits per logical unit. |
| Report | Synthesize analysis, investigation, or review results into a deliverable output. Used by: Review, Retro, Exploration, Spike, 기획(standalone) flow. |
| Verify | Flow-level goal verification. 플로우 전체 목적 달성 확인 (코드/비코드 모두). Internal multi-pass: mechanical/completeness → goal-backward → adversarial. pyreez for high-risk. On FAIL, diagnoses failure origin and routes back. |
| Reflect | Post-flow learning. Internal multi-pass: fact collection → pattern extraction → prior comparison. Records: what worked, what failed, unexpected, patterns. Writes to instruction files. Runs on completion and abandonment (not suspension). |

## Step Depth Policy (Adaptive)

모든 step이 *default = shallow*. 명시 mechanical trigger 발동 시 *deepen*. 비용 ↓ + 안전 ↑ (다층).

### Shallow vs Deep per step

| Step | Shallow activities | Deep activities |
|---|---|---|
| Ground | volatile_capture + lightweight ed_query (token_budget=1k, **god_node priority** by graph degree) | full ed_query, volatile + flow_profile, full surface |
| Investigate | compatibility check + unknown_disposition | impact + constraints + risk + compatibility + unknown_disposition |
| Decide | mode=Record | mode=Plan or Design (upgrade) |
| Spec | AC list만 (각 line max, no architecture detail) | AC + 코드 architecture + task decomposition + codeLinks |
| Test | targeted (단일 RED test) | full coverage (multi-test + edge cases + profile) |
| Implement | minimal patch (single concern) | full implementation + setup + 다중 commits |
| Report | summary (key findings 1-page) | full structured report (severity 분류 + action items + 검증 trail) |

### Mechanical Caps

| Step | Shallow caps | Deep caps |
|---|---|---|
| Ground | wall_s=20, tokens=5k | wall_s=180, tokens=20k |
| Investigate | wall_s=20, tokens=4k | wall_s=180, tokens=20k |
| Decide | Record: wall_s=10, tokens=1k | Plan: wall_s=60, tokens=10k / Design: wall_s=300, tokens=30k |
| Spec | wall_s=30, tokens=5k | wall_s=240, tokens=25k |
| Test | wall_s=60, tokens=10k | wall_s=600, tokens=40k |
| Implement | wall_s=120, tokens=15k | wall_s=900, tokens=60k |
| Report | wall_s=30, tokens=5k | wall_s=180, tokens=15k |

### Deepen Triggers (mechanical, orchestrator가 prior 출력에서 평가)

```
Ground.deepen if (OR):
  - flow_type ∈ {Feature, Migration, Performance, Compound}
  - Triage.classification_metadata.complexity_signal = high
  - shallow ed_query 결과에 god_node 포함
  - volatile_capture failures (lint/test/typecheck) ≥ 1

Investigate.deepen if (OR):
  - Ground.depth = deep (cascade)
  - flow_type ∈ {Migration, Feature, Performance, Compound, Bug Fix Unreproducible}
  - Ground.unknowns.length ≥ 3
  - Ground.task_subgraph.entry_nodes.length > 5      # TR4 fix: list size 비교 명시
  - prior_evidence with depth_upgrade=true (reclassify path)

Decide upgrade (OR):
  → Plan if:
    - flow_type ∈ {Refactor, Test, Spike, Retro, Exploration}
    - Investigate.compatibility_verdict.issues.length ≥ 2
    - Investigate.risk_surface contains severity = high
  → Design if:
    - flow_type ∈ {Feature, Performance, Migration, 기획-standalone, Compound}
    - Investigate output에 architecture-level 영향 표시
```

### Upstream Deepen Request

Decide가 shallow Ground/Investigate 출력으로 결정 불가 시 → `request_upstream_deepen` 신호 → orchestrator가 해당 step 재invoke with depth=deep.

**Cycle cap**: upstream deepen 1회 (무한 cycle 방지). 그래도 부족 시 Verify가 final safety (`failure_origin=ground|investigate` → reclassify with depth=deep 강제).

### P0 Depth Precedence (M1 fix)

P0 (Bug Fix P0) flow는 *시간 critical* → 빠른 fix 우선. complexity_signal=high 같은 다른 deepen trigger와 충돌 시:

```
Phase 1 (Emergency Pass): P0 emergency 진행 — depth=shallow 강제 (다른 trigger 무시)
  → Ground shallow → Investigate shallow → Decide(Record) → Implement(emergency) → Verify
  
Phase 2 (Post-Stabilization): Verify PASS 후 *자동 후속 flow 생성*
  → 만약 P0 진입 시 complexity_signal=high였거나 god_node 검출됐다면
  → 자동 Bug Fix (Normal) flow with depth=deep 큐잉
  → 또는 Retro flow로 분석
```

**P0 override 규칙**: flow_type=bugfix-p0이면 *모든 다른 deepen trigger 무시*. P0 자체가 최우선 precedence. Verify가 emergency fix 후 *post-stabilization follow-up* 자동 트리거.

### Shallow → Deep Transition

단일 invocation 내 escalation 허용:
1. Shallow 활동 실행 (wall_s 한도 내)
2. Trigger 발동 감지 → deep 활동 추가, wall_s 연장
3. Shallow 캡처 fact는 deep input 재사용 (폐기 안 함)

또는 분리 invocation: orchestrator가 shallow 완료 후 trigger 평가 → deep invocation 재호출 (shallow 출력 입력).

### Reviewer Checklist (mechanical, LLM 판단 최소화)

| Step | Shallow reviewer check |
|---|---|
| Ground-Reviewer (shallow) | (1) volatile_capture.status 4개 모두 명시, (2) task_subgraph.entry_nodes ≥1 OR `referent_unresolved` unknowns 명시, (3) freshness 기록 (ed_snapshot + git_HEAD) |
| Investigate-Reviewer (shallow) | (1) compatibility_verdict.result 명시 + Validation Rules V1-V10 통과, (2) ground_unknowns_addressed 매 항목 disposition + rationale, (3) shallow면 impact_map 빈 허용 (단 일관성: volatile.failures=0 AND entry_nodes 적음 AND unknowns 없을 때만) |
| Decide-Reviewer (Record) | (1) decision_record + rationale 존재, (2) based_on (Ground/Investigate ref) 명시, (3) mode 일치 |

Deep reviewer는 위 + 활동별 충분성 추가 검사 (기존 정의).

### Safety + Data Discipline + Learning (정직 재명명, O1 fix)

이전 "7 safety layer"는 정직하지 않음 — provenance/freshness는 *data discipline*이지 active safety 아니고, Reflect는 *post-hoc learning*이지 current-flow protection 아님. 솔직히 재분류:

**Active Safety (4 layer)** — 단일 flow 실행 중 실수 catch:
| Layer | 잡는 것 |
|---|---|
| Orchestrator triggers | mechanical depth 결정, halt 강제 |
| Step caps | 무한 실행 방지 (wall_s + tokens) |
| Step reviewer checklist | 출력 일관성 (mechanical 가능한 한) |
| Verify | 변경 후 누락 catch (`failure_origin` 라우팅) |

**Data Discipline (2)** — audit·재현·stale 검출:
| 메커니즘 | 역할 |
|---|---|
| Provenance | 모든 fact/issue/unknown에 source_tool, audit 추적 |
| Freshness | ed_snapshot + git_HEAD + source_version, stale 검출 |

**Learning (1)** — flow 종료 후 시스템 개선:
| 메커니즘 | 역할 |
|---|---|
| Reflect | 패턴 학습 → trigger·default depth·matrix 조정 |

→ 단일 active layer 실수도 다른 active layer가 catch. Data discipline + Learning은 *long-term* 보조.

## Step Execution Pattern

Every step (except Verify and Reflect) runs as a produce ⇄ review loop (Ralph Loop pattern). Each step agent is paired with a dedicated reviewer agent. The reviewer runs in fresh context and receives only the step's output — never the producer's reasoning.

```
Step Agent → output
  → Mechanical gates (if applicable: typecheck, test, firebat)
    → FAIL → error feedback to Step Agent, retry
    → PASS → Step Reviewer Agent (fresh context, output only)
      → PASS → next step
      → FAIL + feedback → Step Agent retries with feedback
      → max iterations (3) → **HALT** (flow suspend, user/caller에 escalate)
```

**C2 fix**: 이전 정의는 max iterations 후 `DONE_WITH_CONCERNS, proceed` — *품질 실패가 silent 통과*. 변경: max iterations 도달 시 **flow halt + escalate**. proceed 안 함. `DONE_WITH_CONCERNS` 출력 type 폐지.

**NEW3 fix (cross-cycle fail cap)**: producer⇄reviewer 3-fail cap은 *단일 cycle*. reclassify로 재진입 시 fail counter reset. 그러나 *(flow_id, step_name) total fail count*도 추적 — 5회 누적 시 flow-level halt (reclassify 무한 loop 방지).

**Additional cap (서브 에이전트 결함 fix — triage_mismatch loop)**: Triage 재invoke (reclassify 트리거)는 **flow 당 최대 3회**. `reclassify_count` 추적. flow_id는 reclassify 시 *유지* (변경 X) — counter 의미 보존. 3회 초과 시 flow halt + user/caller escalate ("intent 결정 불가"). A2A/CI도 동일 cap.

**NEW5 fix (RETRY_EXHAUSTED Reflect 분류)**: RETRY_EXHAUSTED → Reflect 분류는 **abandoned** (의도 외 termination). Reflect 실행 (학습 누적).

### Step-Reviewer Pairs

| Step | Reviewer | Reviewer checks |
|------|----------|----------------|
| Ground | Ground-Reviewer | subgraph entry≥1 OR `referent_unresolved` 명시, volatile 각 항목 explicit status (success/fail/timeout/skipped-with-reason), ED ambiguous/inferred·capture 실패 모두 unknowns/conflicts에 매핑, 모든 사실 항목에 `source_tool` 존재, freshness 기록 (ed_snapshot_version + git_HEAD), 해석·판단 prose 없음 |
| Investigate | Investigate-Reviewer | impact_map이 Ground entry_nodes 모두 커버, risk_surface가 god_nodes_in_scope 각각에 대해, compatibility_verdict 명시 (V1-V11 통과), **validity 검사 결과 명시** (no_op 시 no_op_details + evidence ref), **ground_unknowns_addressed 매 항목 disposition + rationale + follow_up_ref 명시** (silent 미처리 0), **matrix 권장 벗어난 경우 rationale 강화 확인**, 옵션·설계 prose 없음 (Decide 영역 침범 금지) |
| Decide | Decide-Reviewer | mode 일치 (declared vs 산출물), Record: 결정+근거 1쌍 이상, Plan: 옵션 N≥2 비교 + 선택 이유 + 우선순위, Design: 기획서 (architecture+policy+userflow+req) + intent card 생성. 모든 mode: decision_record + reason 필수. ground·investigate 사실에 근거. |
| Spec | Spec-Reviewer | 모든 정책이 AC로 변환됐는가, AC 측정 가능한가, 코드 architecture(디렉토리/파일) 명확한가, task 분해 빠짐없는가 |
| Test | Test-Reviewer | 테스트가 행위를 검증하는가 (smoke test 아닌가), AC traceability, 엣지 케이스 커버리지 |
| Implement | Implement-Reviewer | 코드가 spec을 충족하는가, deviation rules 준수, stub/hollow 없는가 |
| Report | Report-Reviewer | findings에 severity + 증거가 있는가, action items 존재, claims이 검증됐는가 |

### Steps Without Reviewers

| Step | Why no reviewer | Quality guaranteed by |
|------|----------------|----------------------|
| Verify | Verify IS the flow-level evaluator. Adding a reviewer creates infinite recursion | Internal multi-pass (mechanical → goal-backward → adversarial) + pyreez cross-verification |
| Reflect | Output quality is structurally guaranteed | Structure check hook (4 sections) + 3-tier distillation filter + append-only |

### Verify: Flow-Level Goal Verification

Verify is not a step reviewer — it checks whether the ENTIRE FLOW achieved its PURPOSE. Runs on all 16 flows without exception.

**Internal multi-pass (per invocation):**

For code-producing flows:
1. Mechanical: typecheck + all tests pass + firebat blockers=0 + emberdeck drift=0
2. Goal-backward: original request → plan → tests → code, traces "what must be TRUE"
3. Adversarial: "how could this still fail? what did I miss?"
4. pyreez cross-verification for Pass 2-3 (high-risk flows)

For non-code flows:
1. Completeness: required items present, evidence cited, measurements exist
2. Goal-backward: original request → output, does output answer the request
3. Adversarial: "this conclusion could be wrong because..."
4. pyreez cross-verification for Pass 2-3 (high-risk flows)

**Failure routing — Verify diagnoses WHERE the problem is:**

```
Verify FAIL →
  failure_origin: triage | ground | investigate | decide | spec | test | implement | report
  reason: specific issue description
  evidence: file:line or artifact reference

Host reads failure_origin → routes back to that step's produce ⇄ review loop
  → triage: 재invoke with prior_evidence (reclassify) — reclassify_count cap 3
  → ground: Ground ⇄ Ground-Reviewer re-enters
  → investigate: Investigate ⇄ Investigate-Reviewer re-enters
  → decide: Decide ⇄ Decide-Reviewer re-enters
  → spec: Spec ⇄ Spec-Reviewer re-enters
  → test: Test ⇄ Test-Reviewer re-enters
  → implement: Implement ⇄ Implement-Reviewer re-enters
  → report: Report ⇄ Report-Reviewer re-enters — *비코드 flow (Review/Retro/Exploration/Spike/기획-standalone)에서만 유효*. 코드 flow에서 failure_origin=report는 invalid (Verify가 거부)
  → multiple: earliest problematic step first
```

### Reflect: Internal Multi-Pass

```
Pass 1: Fact collection — what happened at each step, what results
Pass 2: Pattern extraction — recurring themes, surprises, what worked/failed
Pass 3: Prior learning comparison — read .blazewrit/flow-history/, compare with past
→ max 3 iterations until 4 required sections are substantive
```

## Triage — Stateless Classification Function

### Definition

> **Triage는 입력을 flow type으로 분류하는 stateless 함수다.**  
> `(input) → (output)`. 코드 분석 안 함. flow state 안 봄. 루프 안 돔. persistence 없음. 한 invocation = 한 출력.

**Triage가 하는 것**: 입력을 이해해서 16 flow 중 하나로 분류, 또는 분류 불가/모호하면 명시 출력.  
**Triage가 안 하는 것**: 코드 보기 / flow 상태 관리 / 충돌 해결 / cycle 운영 / 설계 / 검증 / persistence — 전부 다른 step 또는 orchestrator의 일.

### Inputs

| 필드 | 필수 | 설명 |
|---|---|---|
| `primary_input` | ✓ | Channel-typed: UserMessage \| A2ARequest \| CIConfig |
| `channel` | ✓ | `user_session` \| `a2a` \| `ci` |
| `conversation_context` | optional | None-state turns (user 세션) |
| `clarifications` | optional | 이전 invocation의 Q&A 누적 `[{q, a}]` |
| `prior_evidence` | optional | reclassify용 `{prior_flow_type, evidence}` |

**입력에 `active_flow_state` 없음.** Triage는 flow 상태 모름 — orchestrator의 일.

### Outputs (4 type — exhaustive)

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

### Activities (single-pass, 루프 없음)

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

### Confidence

- **high**: signal table 정확히 1 row 매치 (또는 strict superset)
- **medium**: 1 row 매치하지만 입력에 약간 모호 (clarifications 사용됨)
- **low**: 거의 출력되지 않음 — Triage는 우세 row 없으면 ambiguous 출력

### 채널별 동작

| 채널 | none | ambiguous | error |
|---|---|---|---|
| user_session | 호스트 LLM이 자유 대화 계속 | 호스트 LLM이 user에 질문 → 답 받아 재invoke | (rare; Comprehend 실패 시) |
| a2a | INTENT_NOT_ACTIONABLE 반환 | INTENT_INCOMPLETE + question 반환 | GIBBERISH/INTERNAL 반환 |
| ci | trigger config 에러 | trigger config 에러 (config 부족) | trigger config 에러 |

### Properties

- **Stateless**: pure function. 호출 간 상태 없음.
- **Idempotent**: 같은 입력 → 같은 출력 (LLM 비결정성 modulo).
- **Single-pass**: 한 invocation = 한 출력. 루프 없음.
- **No flow state**: active/suspended 모름.
- **No code analysis**: 코드 read 금지 (도구 영역).
- **No persistence**: 디스크 안 씀 (artifact 없음).

### Boundary — Triage가 안 하는 것 (다른 책임자)

| 항목 | 책임자 |
|---|---|
| Active flow 검사, 충돌 해결, preempt | Orchestrator + caller |
| Suspended flow 유사도 / 재개 제안 | Orchestrator |
| Cycle cap, 포기 결정 | Host LLM / caller |
| Reframe count, 회복 정책 | Orchestrator |
| 코드 분석, 의존성, 영향 범위 | Analyze |
| 서비스 architecture, 정책, 요구사항 | 기획 |
| Sub-flow 분해 (Compound) | 기획 |
| AC, 코드 architecture, task | Spec |
| 검증 | Verify |
| 학습 | Reflect |
| flow-state 관리 / persistence | Orchestrator |
| 도구 권한, hook | Mechanical 영역 (셸/코드) |

### Signal Table

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
| Planning, design, research, spec writing with concrete target | 기획 (standalone) |
| PR review, code audit, diff analysis, security audit | Review |
| Version bump, changelog, deploy | Release |
| Retrospective, postmortem, analysis of past work | Retro |
| Feasibility check, prototype, proof of concept | Spike |
| Understanding, investigation, learning | Exploration |
| Multiple blockers requiring different flows, or multi-phase task | Compound |
| No actionable signal, no concrete target (discussion, open brainstorming, casual exchange) | None (free conversation) |

### Signal Strength Rules

Signal strength는 *Triage 출력 분기*를 결정.

| Strength | Criteria | Triage 출력 |
|----------|----------|-------------|
| Clear | Input has explicit verb + target ("fix the NPE in auth.py", "add avatar upload") | `proceed(flow_type, confidence=high)` |
| Implied | Input describes problem/goal without explicit action ("auth is slow") | `ambiguous(question)` 1개 — 호출자가 답 받아 재invoke → `proceed` (medium) |
| Ambiguous | No actionable target ("something feels off") | `none(reasoning)` — user 세션은 자유 대화, A2A/CI는 INTENT_NOT_ACTIONABLE |

### None ↔ Flow Transition Rules

None ↔ Flow 전이는 *호스트 LLM*의 책임이지 Triage의 책임이 아니다. 호스트 LLM이 conversation 누적을 보다가 actionable signal 감지 시 Triage invoke. 결과에 따라 처리:

| Trigger | Host LLM 행동 |
|---------|---------------|
| User states actionable intent | Triage invoke → `proceed`면 orchestrator.start, `ambiguous`면 user에 질문 후 재invoke, `none`이면 자유 대화 계속 |
| Conversation produces spec-level detail | Host LLM이 conversation_context와 함께 Triage invoke → 결과 처리 |
| User explicitly abandons | Host LLM이 orchestrator.abandon 호출 (Triage 미관여) |
| No flow-related input for 3+ exchanges | Host LLM이 user에 "continue or suspend?" 질문 (Triage 미관여) |

### Flow Lifecycle Rules

| Event | Action | State file update |
|-------|--------|-------------------|
| **Start** | Triage classifies → Analyze → begin core steps | Write: flow type, step, status=active |
| **Suspend** (user switches topic) | Save progress to state file (no Reflect) | Write: status=suspended, current step, completed work, pending items |
| **Suspend** (P0 preemption) | Pause immediately → new Bug Fix P0 flow starts | Write: status=suspended, preempted_by=P0, resume point |
| **Resume** | Read state file → skip completed steps → continue from suspension point | Write: status=active |
| **Complete** | Reflect → record learnings | Write: status=completed |
| **Abandon** | Reflect(abandoned, reason) | Write: status=abandoned |

Resume priority: P0 preemption always resumes after P0 completes. User-suspended flows resume only on explicit request.

### User Override

User can override Triage classification at any point:
- "This isn't a refactor, it's a feature" → reclassify, restart from Ground for new flow type
- "Skip the tests, just implement" → follow user directive, Reflect records deviation
- "I don't want a flow for this" → None, even if signal was clear

### Context Inheritance Rules

호스트 LLM이 Triage invoke 시 `conversation_context`로 None-state turns를 전달. Triage의 Comprehend가 이를 통합 이해.

- **Inherit**: decisions made, constraints identified, scope discussed, files mentioned, approach agreed
- **Do not inherit**: abandoned ideas, rejected approaches, tangential discussion (호스트 LLM이 필터)
- **Rule**: Triage는 `conversation_context`를 *Comprehend의 입력*으로 사용. 별도 결박 artifact 생산 안 함 — 분류 결과만 출력. 다음 step (Ground)도 같은 conversation_context를 orchestrator로부터 받음.

## Ground — Evidence Boundary

### Definition

> **Ground는 Triage된 의도를 bounded·sourced·current 사실 + 명시 불확실성으로 변환한다.** 영향 해석도, 행동 선택도 하지 않는다. 다음 step (Analyze)이 *추측 없이* 영향 분석할 수 있는 evidence 기반을 제공.

**Ground가 하는 것**: ED 그래프 query / volatile 측정 / unknown·conflict surface  
**Ground가 안 하는 것**: 판정, 영향 분석, 설계, 계획, 카드 생성, 코드 변경, 측정값 *해석*, 위험 *판단*

### Inputs

| 필드 | 필수 | 설명 |
|---|---|---|
| `flow_type`, `classification_metadata`, `clarifications` | ✓ | Triage 출력 |
| `request_text` | ✓ | 원 입력 |
| `conversation_context` | optional | None-state turns |
| `channel` | ✓ | user_session \| a2a \| ci |
| `active_flow_state` | optional | 다른 in-flight 작업 인지용 (충돌 해결은 orchestrator) |
| `scope_hint` | optional | 모노리포 패키지/경로 한정 (Triage가 추출 또는 caller가 명시) |

### Activities (병렬 가능 1·2, 3은 둘 위에서)

```
1. ED Graph Query
   - request_text + clarifications + scope_hint → ED MCP query
   - 출력: bounded subgraph (entry nodes + neighbors + god nodes in scope)
   - cap: token budget + god node expansion limit
   - per-node: freshness metadata (last_updated, source)

2. Volatile Capture (flow_type별 선언된 profile)
   - Universal (모든 flow): typecheck, test, lint, git status/log
   - Conditional (flow별 선언):
     · Performance: + perf baseline 측정
     · Migration: + dependency/compatibility audit
     · Bug Fix Unreproducible: + observability data
     · Release: + version·changelog 상태
   - 각 명령: bounded timeout
   - 명령 부재 시: skipped-with-reason
   - 캡처 시작·종료 git HEAD 비교 → 변동 시 racing_changes 1회 재시도

3. Surface
   - ED의 AMBIGUOUS/INFERRED 엣지 → unknowns 또는 conflicts에 매핑
   - capture 실패/timeout → unknowns
   - request referent 그래프에 부재 → unknowns[{dim: referent, reason: unresolved}]
   - silent gap 금지: 모든 모름·모순 명시
```

### Output (provenance 강제)

```yaml
flow_id: <id>
captured_at: ISO8601
schema_version: 1
input_refs: { triage_output, request_text, conversation_context, scope_hint }

task_subgraph:
  entry_nodes: [{ id, source: ed_query, freshness: ISO8601 }]
  neighbors: [...]
  god_nodes_in_scope: [...]
  bounded_at: token_count
  ed_snapshot_version: <ED version/hash>

volatile_state:
  typecheck: { status: success|fail|timeout|skipped, output_hash, source_command, captured_at, duration_ms }
  tests: { status, passed, failed: [...], coverage, source_command, captured_at, duration_ms }
  lint: { status, warnings, errors, source_command, captured_at, duration_ms }
  git: { branch, dirty, head_start, head_end, recent_commits: [...] }
  # flow-conditional 추가 (해당 시):
  perf_baseline?: { ... }
  dependency_audit?: { ... }
  observability?: { ... }

unknowns: [{ dim, reason, source_tool, attempted_at }]
conflicts: [{ sources: [tool|file], description, source_tool }]

freshness:
  ed_snapshot_version
  git_head_start
  git_head_end           # 다르면 racing_changes 표시
  racing_changes: bool

verification_proof:
  tool_calls: [{ tool, args_hash, output_hash, exit_code }]
  read_files: [{ path, hash, mtime }]
  ed_queries: [{ query, result_hash }]
```

**Provenance 강제**: 모든 fact / unknown / conflict 항목에 `source_tool` 필수. `verification_proof` 해시만으론 부족 — 항목별로 출처 추적 가능해야 함.

### Reviewer (ground-reviewer)

| 검사 | 기준 |
|---|---|
| task_subgraph | `entry_nodes` ≥1 **OR** unknowns에 `referent_unresolved` 명시 |
| volatile_state | profile-required 각 명령에 explicit status (success/fail/timeout/skipped-with-reason) |
| unknowns 매핑 | ED의 AMBIGUOUS/INFERRED 엣지 + capture 실패가 unknowns 또는 conflicts에 모두 매핑됨 |
| provenance | 모든 사실 항목에 `source_tool` 존재 |
| freshness | `ed_snapshot_version` + `git_head_start` 기록됨 |
| racing_changes | `head_start ≠ head_end`이면 표시 (재시도 1회 후도 변동 시) |
| Boundary 준수 | 해석·판단 흔적 없음 (예: "perf delta 의미 X" 같은 평가 prose 금지) |

### Volatile Profile by Flow Type

선언된 capture profile만 실행. Ground가 *어느 측정이 중요한지 판단하지 않음* — flow definition이 미리 선언.

| Flow | Universal + 추가 conditional 필드 |
|---|---|
| Feature, Bug Fix, Bug Fix P0, Refactor, Test, Chore, Review, Retro, Exploration, Compound, 기획-standalone, Spike | Universal만 (typecheck/tests/lint/git) |
| Performance | + `perf_baseline: { p50, p95, p99, throughput, captured_at, command }` |
| Migration | + `dependency_audit: { packages: [{name, current, latest, breaking}], lockfile_hash }` |
| Bug Fix Unreproducible | + `observability: { logs_query, metrics_query, traces_query, results }` |
| Release | + `release_state: { last_version, new_commits_count, changelog_entries: [...] }` |

profile은 `.blazewrit/flows/<type>.md`의 `volatile_profile` 필드에서 선언.

**TR6 fix**: 위 conditional 필드는 *명시 schema*. Ground 출력의 `volatile_state.<conditional_field>`로 carrier 제공. Investigate가 type-safe 참조 가능. opaque artifact만 흐르던 이전 정의 폐기.

### Cache 정책 (logically stateless + strict invalidation)

논리적으로 stateless (같은 입력 → 같은 출력). 캐시 사용 가능, 단 invalidation 엄격:

**Cache key**: `hash(request_text + conversation_context_digest + ed_snapshot_version + git_HEAD + worktree_status + volatile_commands_definition + flow_type + scope_hint)`

cache hit이어도 freshness metadata 노출 필수. 모든 키 구성요소 변동 시 invalidate.

### Active Flow Conflict 우선순위 (M5 fix)

Ground는 conflict resolution 안 함. orchestrator가 *Ground 진입 전* 해결. 그러나 Ground는 *해결 후 잔재* 또는 *suspended/preempted prior*를 인지:

| `active_flow_state` 상태 | Ground 처리 |
|---|---|
| `active: null, suspended: []` | 그대로 진행 |
| `active: null, suspended: [prior1, prior2]` (orchestrator가 suspend 처리 후) | 그대로 진행. unknowns에 *유사 영역 suspended가 있다* hint (similarity 검사 시) |
| `active: null, preempted: prior_id` (P0 preempt 직후) | 그대로 진행. metadata에 preempted prior 기록 (post-stabilization follow-up에 사용) |
| `active: <something>` | **mechanical error** — orchestrator가 해결 안 한 채 Ground 진입 = bug. Ground 즉시 escalate |

### 채널별 차이

없음 — Ground는 channel-agnostic. 단 `conversation_context`가 user_session에서만 존재 (a2a/ci는 빈 값).

### Boundary — Ground가 안 하는 것

| 항목 | 책임 |
|---|---|
| Feasibility 판정 (proceed/blocked) | Investigate |
| 영향 범위 *해석* | Investigate |
| 옵션 후보 / 접근 결정 | Decide |
| 카드 *생성* (intent/spec) | Decide(Design)/Spec — Ground는 *읽기*만 |
| 측정값 *의미 판단* (예: "이건 느림") | Investigate |
| 위험·심각도 *판단* | Investigate / Verify |
| 코드 변경 | Implement |

## Investigate — Task-Specific Interpretation

### Definition

> **Investigate는 Ground 사실을 *설계 가능한 문제 정의*로 해석한다.** 영향·제약·위험·호환성. *옵션 안 만듦, 결정 안 함* (Decide 책임). 새 사실 캡처 안 함 (Ground 책임).

### Inputs

- Ground 출력 (task_subgraph, volatile_state, unknowns, conflicts, provenance, freshness)
- Triage 출력 (flow_type, classification_metadata, clarifications)
- request_text, conversation_context

### Activities

```
1. Impact 추적          ED traversal from entry_nodes — callers/callees/data flow
2. Constraint 식별       정책·컨트랙트·보안 자세에서 도출
3. Risk surface         실패 모드 (impact × Ground concerns) — severity + probability + evidence
4. Validity 검사         Ground 사실 vs Triage 의도 target 비교 — task가 진짜 의미 있나? (no-op 감지)
5. Compatibility 판정    명백 호환성 + Validity 결과 → proceed | blocked | needs_clarification | no_op
                        (도달 가능성·옵션 의존 판단은 Decide 영역)
6. Unknown disposition   Ground unknowns 각각 → 6 disposition 중 1 분류 (matrix 기반, 명시 rationale)
```

### Validity 검사 — Flow별 No-op 조건

| Flow | No-op 검출 |
|---|---|
| Performance | Ground.volatile.perf_baseline ≤ Triage 요청 target |
| Migration | Ground.dependency_audit이 이미 target version 보여줌 |
| Bug Fix | Ground 또는 reproduce 시도에서 bug 재현 불가 (이미 fix됨) |
| Refactor | 코드가 이미 target 패턴 준수 |
| Chore | 변경 target이 이미 원하는 상태 (typo 없음 등) |
| Feature | Ground.task_subgraph에 기능 이미 구현 표시 |
| Test | Ground.coverage가 이미 target 충족 |
| Release | git log에 신규 commits 없음 |

No-op 감지 시 → `compatibility_verdict.result = no_op` + `no_op_details` 필수.

### Unknown Disposition Matrix

Ground unknown은 *반드시* 다음 6 disposition 중 하나로 처분. matrix는 *기본 권장*이며 벗어날 시 rationale 강제.

| Disposition | 의미 | 후속 처리 |
|---|---|---|
| `resolved` | Investigate가 *완전히* 해결 (외부 리서치·코드 read·도구 호출) | unknown 제거, 사실로 승격 (verification_proof 동반) |
| `partially_resolved` | 일부만 해결됨 — 부분 사실 확보 + 잔여 부분은 다른 disposition으로 sub-처리 (TR5 fix) | 해결된 부분: resolved로. 잔여: risk/constraint/clarification 등 sub_disposition 명시 |
| `risk` | 불확실성을 risk로 변환 | risk_surface에 항목 추가 (severity + probability) |
| `constraint` | 사실 부재가 제약으로 작용 | constraints에 항목 추가 (blocking 표기) |
| `clarification` | user/caller 응답 필요 | NEEDS_CONTEXT (Investigate halt + 질문) — compatibility_verdict.result=needs_clarification으로 *자동 연결*, follow_up_ref가 가리키는 compat issue 생성 |
| `defer` | 다음 step에서 해결 가능 | deferred_decisions 기록 (defer_to: decide \| spec \| test \| implement) |
| `escalate` | flow halt — 도구/시스템 문제 | compatibility_verdict=blocked + blocker 기록 |

**기본 matrix** (Ground unknown 유형 → 권장 disposition):

| Ground unknown 유형 | 권장 disposition |
|---|---|
| `capture_failed: timeout` | risk |
| `capture_failed: tool_error` | escalate |
| `inaccessible: permission_denied` | constraint (기본) / clarification (권한 요청 가능 시) |
| `tool_unavailable` (ED/firebat/pyreez 부재) | escalate |
| `referent_unresolved` (request entity 그래프 부재) | clarification |
| ED `AMBIGUOUS` edge | risk |
| ED `INFERRED` edge (low confidence) | risk |
| ED `drift` (card↔code 불일치) | constraint |
| 외부 lib/API 미상 | resolved (WebFetch/Context7 시도) / 실패 시 risk |
| 사실 간 `contradiction` | clarification |
| `racing_changes` (Ground 재시도 후 잔존) | risk |

### Output

```yaml
flow_id: ...
based_on_ground: <ground 산출물 hash>

impact_map:
  primary_areas: [{ node, change_kind, source: ed_traversal }]
  ripple: [{ node, distance, why }]
  external_surface: [{ contract, consumers, breaking?: bool }]

constraints: [{ source: rule|contract|security|domain, description, blocking?: bool }]

risk_surface: [{ area, severity: low|med|high|critical, probability: likely|possible|unlikely, evidence }]

compatibility_verdict:
  result: proceed | blocked | needs_clarification | no_op
  schema_version: 1
  checked_at: ISO8601
  source_version:                                            # freshness
    ed_snapshot: <hash>
    rules_version: <hash>
    contracts_version: <hash>

  issues:                                                    # cap 50, dedup, most-severe-wins
    - id                                                     # invocation-scoped unique
      type: missing_referent | policy_violation | stack_incompatibility
          | breaking_change | deprecated_usage | resource_constraint
          | security_violation | compliance_violation | license_conflict
          | contract_violation | environment_mismatch | timing_constraint
          | circular_dependency | platform_unsupported | other
      custom_type?: <string>                                 # type=other일 때 필수
      severity: fatal | high | medium | low
      scope:                                                 # 모두 optional, 모두 빈 = project-wide
        component?: <node/module>
        tenant?: <id>
        dependency?: <package@version>
        platform?: <env>
        sub_flow?: <flow_id>
        target_set?: [<consumer_id>]                         # bounded (top N + summary)
      description
      evidence: <ground/investigate ref>                     # required
      requires_user?: bool                                   # true → needs_clarification 유발
      blocks_flow?: bool                                     # true → blocked 유발
      suggested_followup

  reason                                                     # result 결정 근거
  blockers?: [issue_id]                                      # result=blocked일 때 필수
  open_questions?: [issue_id]                                # result=needs_clarification일 때 필수

  sub_flow_verdicts?:                                        # Compound only
    - sub_flow_id
      result
      issue_refs: [issue_id]

  issues_overflow?:                                          # 50개 초과 시
    total_found: N
    captured: 50
    summary: <string>

  no_op_details?:                                            # result=no_op일 때 필수
    reason                                                   # 왜 no-op인가
    evidence: <ground/investigate fact ref>                  # Ground/Triage 비교 근거
    current_state: <캡처된 사실>                              # baseline/version/coverage 등
    target_state: <Triage 의도 추출>                          # 요청 목표
    suggested_action: abandon | wait_for_change | reframe_request
```

### Compatibility Verdict — Validation Rules (mechanical)

```
V1. issues 빈 list → result=proceed 강제
V2. 어느 issue.blocks_flow=true → result=blocked
V3. V2 없고 어느 issue.requires_user=true → result=needs_clarification
V4. V2/V3 모두 미충족 → result=proceed
V5. issue dedup: (root_cause hash + scope hash) 같으면 1 issue, max(severity) 채택
V6. issues.length ≤ 50, 초과 시 issues_overflow 필수
V7. type=other → custom_type 필수
V8. result=blocked → blockers 비어있지 않음
V9. result=needs_clarification → open_questions 비어있지 않음
V10. 모든 issue에 evidence 필수 (provenance)
V11. result=no_op → no_op_details 필수 (reason + evidence + current_state + target_state + suggested_action)
V12. result ∈ {proceed, blocked, needs_clarification, no_op, **partial_proceed**} — enum 무효값 reject. V13 (이번 fix)와 일관성.
V13. **Partial-proceed result** (서브 에이전트 D-Scenario-B fix): Migration 등에서 일부 dependents accept + 일부 reject 시 — `result=partial_proceed` (별도 enum value). `issues`는 `scope.target_set` per 영향 범위 분리. `partial_scope_handling: {proceed_set: [scope refs], blocked_set: [scope refs], followup_required: bool}`. Decide는 partial_proceed에서 *실행* (proceed_set 처리), blocked_set은 followup_flows로 큐잉. all-or-nothing 강제 제거. *contradiction 해소*: blocked → halt 그대로 유지 (V13와 무관), partial_proceed가 별도 case.
```

### Compatibility Verdict — Stale 검출 책임 (M3 fix 세부)

| 누가 | 언제 | 어떻게 |
|---|---|---|
| Decide | Investigate 출력 수신 시 | `source_version.ed_snapshot` vs 현재 ED snapshot — mismatch면 Investigate 재invoke 요청 (최대 1회 재invoke = 총 2 attempts) |
| Verify | 최종 검증 시 | source_version + V1-V13 + race detection (verdict checked_at vs current 시점) |
| Mid-flow ED 변경 | ED background incremental update가 flow 도중 발생 | source_version mismatch 자동 trigger → re-evaluation. Cycle cap이 무한 막음. |

**NEW4 fix (2nd attempt도 stale일 때)**: 2nd attempt (= 1회 재invoke 후)도 stale 발견 시 → `failure_origin=ground` 신호로 Verify에 위임 또는 flow halt + escalate (config 설정). 무한 진행 금지. cycle cap=1의 정확한 의미: *원본 + 재invoke 1회 = 총 2 attempts*.

### Compatibility Verdict — Result별 Flow 처리

| result | Orchestrator 처리 |
|---|---|
| proceed | Decide step 진입 (mode upgrade trigger 허용) |
| blocked | **Flow halt 강제** — Decide 미실행. blockers를 user/caller에 surface |
| needs_clarification | **Decide 미실행** — NEEDS_CONTEXT → user/caller 응답 후 Investigate 재invoke (clarifications 누적) |
| no_op | **Flow halt 강제** — Decide 미실행. Reflect 실행 (abandonment 분류). no_op_details 학습 |
| **partial_proceed** | Decide 진입 — `partial_scope_handling.proceed_set` 처리. `blocked_set`은 followup_flows로 큐잉. 부분 작업 완료 + 후속 flow 생성 |

**중요 (TR1·TR2 fix)**: Decide의 mode upgrade trigger는 *compatibility_verdict.result=proceed인 경우에만* 평가됨. result가 proceed 외 (blocked/needs_clarification/no_op)이면 *Decide 자체 미실행* — upgrade trigger가 halt 명령을 override 불가. Orchestrator가 mechanical 강제.

**Reflect 분류 (TR3 fix)**: 
- completed: 모든 step 정상 종료
- abandoned: blocked / no_op / user abandonment
- suspended: NEEDS_CONTEXT 또는 active flow preempted
→ Reflect는 completed + abandoned에서 실행, suspended에서는 미실행 (이전 정의 유지).

### Investigate Output — 나머지 schema

```yaml
ground_unknowns_addressed:
  - unknown_ref               # Ground unknown 항목 ID/index
    unknown_type              # matrix 매칭용 (capture_failed/inaccessible/...)
    disposition               # resolved | partially_resolved | risk | constraint | clarification | defer | escalate
    rationale                 # 왜 이 disposition
    matrix_default            # optional bool — matrix 권장 따랐는지 (false면 rationale 강화)
    follow_up_ref             # optional — risk_id | constraint_id | compat_issue_id | deferred_decision_id | blocker_id
    sub_dispositions          # optional, partially_resolved일 때 필수 — [{ part: <description>, disposition: <enum>, follow_up_ref }]

(Compound only) sub_flow_identification: [{ flow_type, scope, rationale }]   # 식별만, 분해/순서는 Decide

triage_mismatch?: { suspected_flow_type, evidence }   # Triage 오류 의심 시 surface (reclassify 트리거)

verification_proof: { ed_queries, web_fetches?, file_reads }
```

### Tools 허용

- ED MCP query (graph traversal — read only)
- 외부 리서치 (WebFetch / WebSearch / Context7) — 아래 정책 준수
- Read (path-restricted): CLAUDE.md, AGENTS.md, .claude/rules/** 만 (project rules)

**Bash 도구 제거** (서브에이전트 D1 fix): Investigate는 Bash 사용 안 함. git log 같은 commit history 필요 시 → Ground의 volatile_capture에서 미리 수집 (Ground 책임).

**NEW1 (B1 잔여 fix)**: Investigate는 **프로젝트 내부 코드 read 금지**. Ground가 미흡한 detail이 필요하면 `request_upstream_deepen` 신호로 Ground deep 재invoke. 직접 코드 read = boundary 위반. Mechanical 강제: agent frontmatter `tools: [WebFetch, WebSearch, Read]` + Read의 path hook 제한.

### External Research Policy

외부 리서치는 *수단*이지 *기본*이 아님. claim 단위로 trigger·source·tool·stop criteria 결정.

#### Triggers (claim이 외부 진실 의존 시)

- Lib API spec, version compatibility, deprecation status
- 보안 advisory (CVE / GHSA / 벤더 보안 피드)
- License / 컴플라이언스 의무
- 외부 API contract / 벤더 행위 / pricing·quota
- 표준 (RFC / W3C / ISO / IETF) 행위
- Browser·runtime 지원 매트릭스
- Package registry metadata (npm / pypi / crates.io)
- 내부 docs가 외부 source를 인용 → 확인
- 캐시된 내부 사실과 외부 실시간 상태 충돌 의심

#### Source Eligibility (trust 등급)

| Trust | Source 유형 |
|---|---|
| **high** | official_current (벤더 canonical URL, 현재 버전), standards_body (RFC/W3C/ISO/IETF), source_code (authoritative), security_advisory (CVE/GHSA) |
| **medium** | official_stale (구버전 official), vendor_changelog, package_registry |
| **low** | community (StackOverflow, 블로그), cached_archive (web.archive.org) |
| **rejected** | generated_seo, expired without alternatives |

generated_seo는 *어떤 경우에도 authoritative 인용 불가*.

#### Tool Selection (context-dependent, 고정 우선순위 아님)

| Claim 유형 | 권장 tool 순서 |
|---|---|
| Lib API spec | Context7 (indexed) → WebFetch official docs (verification) |
| Version compat / breaking | WebFetch official changelog/migration guide → package registry |
| CVE / security | WebFetch CVE/GHSA URL → 벤더 security feed |
| Standards behavior | WebFetch 표준 doc (RFC/W3C) |
| Community pattern (last resort) | WebSearch + low trust caveat |
| Freshness 검증 | WebFetch *직접* (cached intermediaries skip) |

#### Stop Criteria (고정 budget 아님)

```
sufficient_evidence: claim verified at trust ≥ medium AND no contradictions
diminishing_returns: 3+ sources agree
blocking_failure: source inaccessible OR user input needed
safety_cap:
  per Investigate invocation:
    Migration / Feature / Spike: 60s wall, 30k tokens (liberal)
    Bug Fix Unreproducible / Performance: 40s, 20k
    Bug Fix (general) / Refactor / Test: 20s, 10k (claim-driven override 허용)
    Chore / Release / Review / Retro / Exploration / 기획-standalone: 10s, 5k
```

caps는 *default*. 특정 claim이 더 필요 시 (예: simple Bug Fix에 OAuth 표준 확인) Investigate가 명시 rationale로 cap 초과 가능, reviewer 검증.

#### Provenance (claim 중요도별, 균일 아님)

| Claim 분류 | Provenance 요구 |
|---|---|
| decision_critical (compatibility issue·risk 결정 근거) | 전체: url + accessed_at + content_hash + source_type + version_snapshot |
| version_sensitive | 전체 |
| conflict_with_internal | 전체 |
| background_context | aggregated: `sources_consulted: [url 목록]`, `primary: url` |

소소한 background claim에 전체 provenance 강제 = mechanical noise. **claim 중요도가 provenance 깊이 결정**.

#### Conflict 처리 (외부 vs 내부 사실)

| 충돌 유형 | 규칙 |
|---|---|
| External API fact (lib 변경) vs 내부 캐시 | **external 채택**, conflicts에 기록 |
| 내부 contract/policy/규칙 vs external | **내부 채택** (silent override 금지), conflicts에 owner review용 기록 |
| 소스 권위 모호 | conflicts에 기록, user/Decide 결정 위임 |

**원칙**: 내부 source-of-truth는 owner 결정 없이 silent override 안 됨.

#### No-Results 처리 (claim 중요도별)

| Claim 분류 | 처리 |
|---|---|
| decision_critical | compatibility issue 등록 (blocks_flow 또는 requires_user) |
| version_sensitive | risk_surface 항목 + follow-up flag |
| background | 진행, unknown disposition=defer |
| feasibility-critical (Spike) | *negative signal*로 명시 — "no evidence found" 자체가 사실 |

#### Failure Recovery

| Failure | 처리 |
|---|---|
| Rate limit | 우선순위 fallback (Context7 한도 → WebFetch → WebSearch caveat) |
| Network error | 1 재시도 → unknown[external_inaccessible] |
| Auth required (private docs) | unknown[external_inaccessible: auth] → escalate or skip |
| Paywall | unknown[external_inaccessible: paywall] |
| 모든 source 실패 | claim 중요도별 No-Results 처리 |

### Boundary — Investigate가 안 하는 것 (B1 clarification)

| 항목 | 책임 |
|---|---|
| **프로젝트 내부 새 사실 캡처** (ED query, 코드 read, 빌드 실행, 카드 metadata) | Ground |
| 옵션 생성 | Decide |
| 결정 (어느 접근) | Decide |
| 설계 (architecture, policy, userflow) | Decide(Design) |
| AC 추출 | Spec |
| 코드 변경 | Implement |
| 최종 검증 | Verify |

**Boundary clarification (B1)**: Investigate의 외부 리서치 (WebFetch / WebSearch / Context7)는 *프로젝트 내부 사실 캡처*가 아닌 *외부 검증을 위한 read* — Investigate의 해석 활동에 필요한 *외부 가설 확인*. 프로젝트 내부 ED·코드·빌드는 Ground 책임. 외부는 Investigate가 *해석 보조*로 read. 경계 명확.

## Decide — Decision Ownership (Universal)

### Definition

> **Decide는 Investigate 산출물 위에서 *결정의 책임자*다.** 모든 flow 필수 (skip 없음). 산출물 깊이는 flow별 *mode*로 선언. Mode = Record | Plan | Design.

### Inputs

- Investigate 출력 (impact_map, constraints, risk_surface, compatibility_verdict, etc.)
- Ground 출력 (사실 근거)
- Triage 출력 (의도)
- request_text, conversation_context

### Mode 결정 방식 (Hybrid)

1. flow definition이 *기본 mode* 선언 (`decide_mode: record | plan | design`)
2. Decide 첫 활동: Investigate의 옵션 신호 검사
   - 옵션 1개 (자명) → declared mode 그대로
   - 옵션 N≥2 → declared가 record면 **plan으로 upgrade**
   - 정책·architecture 영향 광범 → declared 무관 design 권장 (단 reclassify는 trigger 안 함)
3. mode 확정 후 산출

### Mode별 활동·산출

#### Record mode (자명 결정)
**활동**: 결정 1개 + 근거 기록  
**산출**:
```yaml
mode: record
decision: <한 줄>
rationale: <Investigate 어느 사실에 근거>
based_on: { investigate_ref, ground_ref }
```
**flow 예**: Chore (typo fix), simple Bug Fix (single approach), Release (자명 version)

#### Plan mode (옵션 선택)
**활동**: 옵션 N개 비교 + 1 선택 + 우선순위/의존 ordering  
**산출**:
```yaml
mode: plan
options_considered: [{ id, approach, trade_offs, est_effort }]
chosen: { option_id, rationale }
sequencing?: [{ step, depends_on }]   # Compound sub-flow 순서, Migration cycle 순서 등
based_on: { investigate_ref, ground_ref }
```
**flow 예**: Bug Fix Unreproducible (hypothesis 우선순위), Refactor, Migration, Test, Spike

#### Design mode (전체 설계)
**활동**: 옵션 deliberation (pyreez) + architecture 결정 + policy/biz rule + 유저 플로우 + 요구사항 + intent card  
**산출**:
```yaml
mode: design
options_deliberated: [...]
chosen_architecture: { ... }
policies: [{ rule, scope, exceptions }]
user_flows: [...]
requirements: [...]
intent_card_id: <emberdeck card>
based_on: { investigate_ref, ground_ref }
```
**flow 예**: Feature, Performance, 기획-standalone, Compound (top-level)

### 도구 (mode별)

| Mode | emberdeck | pyreez | 외부 리서치 |
|---|---|---|---|
| Record | (기존 카드 read만) | — | — |
| Plan | (read), `create_card`(spec 단계로 미루어도 가능) | `deliberate` (옵션 비교) | optional |
| Design | `create_card` (intent), 기존 read | `deliberate` (architecture, ideation) | yes |

### Triage Mismatch 처리

Investigate가 `triage_mismatch`를 surface하면 Decide는:
- 즉시 reclassify trigger (orchestrator로 신호) — 새 flow type으로 Triage 재진입
- Decide 출력 = `reclassify_required` 특수 산출, 진행 안 함

### Boundary — Decide가 안 하는 것

| 항목 | 책임 |
|---|---|
| 새 사실 캡처 | Ground |
| 사실 해석 | Investigate |
| AC 추출 (구현 가능 형식) | Spec |
| 코드 변경 | Implement |
| 결정 *결과* 검증 | Verify |
| 학습 추출 | Reflect |

## Flow State Persistence

Flow state is file-based, not context-dependent. Survives session boundaries, compaction, and context loss.

### State File

Location: `.blazewrit/flow-state.yaml` (list of active/suspended flows)

```yaml
# List structure — supports multiple suspended flows + one active
flows:
  - id: feature-avatar-upload
    flow: feature
    status: active          # active | suspended | completed | abandoned
    step: implement         # current step
    started: 2026-03-31T14:00:00
    summary: "Adding avatar upload to user profile"
    completed_steps:
      - analyze: "impact scope: 3 files, S3 연동, no blockers"
      - 기획:
          status: DONE
          artifact: ".blazewrit/plans/feature-avatar-upload-기획.md"
      - spec:
          status: DONE
          artifact: ".blazewrit/plans/feature-avatar-upload-spec.md"
      - test:
          status: DONE
          artifact: "src/__tests__/avatar-upload.test.ts"
    pending:
      - "implement cycle 1: resize logic"
      - "verify"

  - id: bugfix-p0-auth
    flow: bugfix-p0
    status: suspended
    step: verify
    started: 2026-03-31T13:00:00
    suspended_at: 2026-03-31T13:45:00
    suspend_reason: "User switched to feature work"
    completed_steps:
      - analyze: "symptom: auth token expiry not refreshed"
      - implement:
          status: DONE
          artifact: "src/auth/token-refresh.ts (commit abc123)"
    pending:
      - "verify"
      - "test (retroactive)"

# Compound flow tracks sub-flows internally
  - id: compound-payment-overhaul
    flow: compound
    status: active
    step: sub-flow-2
    sub_flows:
      - { flow: migration, status: completed, summary: "DB schema migrated" }
      - { flow: feature, status: active, summary: "New payment API" }
      - { flow: test, status: pending }
```

### State File Rules

1. **Write on every step transition** — host updates after each step agent (producer or reviewer) returns
2. **Read at session start** — Triage checks for active/suspended flows before classifying new input
3. **Single active flow** — only one flow can be active at a time. Starting a new flow requires suspending or completing the current one
4. **Suspended flows persist** — no automatic expiry. User chooses which to resume (not LIFO stack)
5. **P0 preemption** — auto-prompts resume after P0 completes
6. **Completed/abandoned flows are archived** — moved to `.blazewrit/flow-history/` with timestamp for Retro flow access
7. **Compound sub-flows** — tracked within the compound entry, not as separate list items

## Execution Protocol

Full execution architecture in EXECUTION_PLAN.md. This section covers the design rationale and mechanisms that integrate with the workflow.

### Design Rationale

blazewrit의 오케스트레이터는 TypeScript 스크립트(orchestrator.ts)다. LLM이 아니다. 루프가 기계적으로 보장된다.

Not a CLI binary (GSD-2), not a tool collection (gstack), not a fixed pipeline (spec-kit), not prompt-enforced rules (host LLM이 루프를 빼먹을 수 있음). **스크립트가 루프를 돌고, AI는 각 스텝에서 작업만 한다** (Ralph Loop 패턴).

채택 근거: Ralph Loop (114줄 bash)이 증명. GSD/gstack/spec-kit은 호스트 LLM에 루프를 맡겨 prompt-enforced 한계를 가짐.

입력 채널별 구동:
- **A2A/CI**: orchestrator.ts가 전체 루프를 직접 구동 (`claude --agent X --print`). 풀자동.
- **유저 세션**: PostToolUse(Agent) 훅이 orchestrator.ts next를 자동 호출. 호스트 LLM은 훅의 지시를 따라 Agent tool 실행.

### Execution Model

```
orchestrator.ts (TypeScript 스크립트 — 상태 머신, 루프 보장)
  │
  ├─ Triage: 호출자가 분류 후 flow type 전달
  │   A2A: server.ts 기계 분류 → 실패 시 claude 호출
  │   유저: 호스트 LLM이 signal table로 분류
  │   CI: 트리거 설정에 명시
  │
  ├─ Step execution → Produce ⇄ Review loop
  │   ├─ [새 세션] claude --agent {step} --print (producer)
  │   ├─ Mechanical gates (typecheck, test — exit code)
  │   ├─ [새 세션] claude --agent {step}-reviewer --print (reviewer, 산출물만 수신)
  │   ├─ PASS → next step / FAIL → retry with feedback / attempt >= 3 → **HALT** (RETRY_EXHAUSTED)
  │   ├─ Step Agent = custom agent (.claude/agents/<step>.md)
  │   ├─ tools/disallowedTools: per agent frontmatter (mechanical)
  │   ├─ mcpServers: scoped per agent (firebat, emberdeck, pyreez)
  │   ├─ maxTurns: runaway prevention per agent
  │   ├─ isolation: worktree (for high-risk Implement)
  │   └─ return: completion status + output artifact (sentinel pattern)
  │
  ├─ Verify → Flow-level goal verification (internal multi-pass, no reviewer)
  │   ├─ On FAIL: diagnoses failure_origin → orchestrator routes back to responsible step
  │   └─ Verify 3회 실패 → BLOCKED
  │
  ├─ Step transition → orchestrator.ts updates flow-state.yaml, determines next step
  │
  ├─ Crash recovery → flow-state.yaml은 스텝 사이에만 업데이트
  │   → 재개 시 현재 스텝 산출물 확인 → 미완성이면 revert + 재실행
  │
  └─ Hooks (유저 세션 전용)
      ├─ PostToolUse(Agent): orchestrator.ts next 자동 호출
      └─ Stop: 미완료 flow 존재 시 세션 종료 차단

에이전트 내부 훅 (모든 채널):
  ├─ PostToolUse(Edit|Write): firebat scan
  ├─ PostToolUse(Read|Grep|Glob): stuck detection counter
  ├─ PreToolUse(Bash(git commit*)): regression_guard
  └─ Conditional: coverage gate, Reflect structure check
```

### Why Custom Agents, Not Skills

| Capability | Skill | Custom Agent | blazewrit needs |
|------------|-------|-------------|-----------------|
| Fresh context | Shared with host | **Isolated** | Yes — prevents context rot across steps |
| mcpServers scoping | Not supported | **Supported** | Yes — firebat/emberdeck/pyreez per step |
| permissionMode | Not supported | **Supported** | Yes — acceptEdits for Implement |
| maxTurns | Not supported | **Supported** | Yes — runaway prevention |
| worktree isolation | Not supported | **Supported** | Yes — high-risk Implement |
| hooks scoping | Supported | **Supported** | Yes |
| Transcript survival | Lost on compaction | **Persists independently** | Yes — long workflows |

Custom agents get fresh context and return condensed results. This matches the "fresh context per step" principle (Ralph Loop, GSD, Anthropic 4.6 best practice).

### Enforcement by Consequence

Enforcement strength is matched to the consequence of violation:

| Consequence of violation | Enforcement | Mechanism | Examples |
|---|---|---|---|
| **Dangerous** (bad code ships, data loss) | **Hook — mechanical** | Runs regardless of agent behavior | firebat scan, regression_guard, blocker check |
| **Role violation** (step does wrong thing) | **allowed-tools — mechanical** | Host tool blocks restricted tools | Verify can't Edit, Reflect can't Edit |
| **Order violation** (step skipped) | **File dependency — natural failure** | Next step fails without previous artifact | Implement can't run without plan file |
| **Conditional skip** (optional step wrongly skipped) | **Hook — conditional check** | Script validates condition before allowing skip | Coverage < 80% → Test mandatory |
| **Completion skip** (Reflect skipped) | **Hook — Stop gate** | Session can't end with unreflected completed flow | Stop hook checks state file |
| **Quality issue** (poor analysis, weak learning) | **Prompt + structure check** | Instructions guide, script checks structure | Reflect must have required sections |
| **Judgment error** (wrong classification) | **Prompt only** | Clear rules, tables, examples | Triage signal table, decision classification |

### Tool Restrictions Per Step Agent

Each step agent defines `tools` (allow list) or `disallowedTools` (deny list) in its frontmatter. Path restrictions use hooks (gstack `/freeze` pattern).

| Agent | tools | mcpServers | Rationale |
|-------|-------|------------|-----------|
| ground | Read, Grep, Glob, Bash | emberdeck | Read-only + bash for typecheck/test/lint/git 실행. 사실 캡처 |
| ground-reviewer | Read, Grep, Glob | — | Read-only. 사실 완전성·provenance·freshness 검증 |
| investigate | **WebFetch, WebSearch only (외부)** + Read 한정 (CLAUDE.md/AGENTS.md/rules만) | emberdeck (query only), Context7 | NEW1 mechanical 강제: 프로젝트 코드 read 금지 (Ground 책임). 외부 리서치만. Read 도구의 path restriction = `allowed_paths: [CLAUDE.md, AGENTS.md, .claude/rules/**]` — hook으로 강제. 위반 시 mechanical block. |
| investigate-reviewer | Read, Grep, Glob | — | Read-only. 영향·제약·위험·호환성 검증, 옵션·설계 prose 금지 |
| decide | Read, Grep, Glob, Write | emberdeck, pyreez | Write 한정 — decision record / plan / 기획서(Design mode). emberdeck intent card (Design만). pyreez deliberation (Plan/Design) |
| decide-reviewer | Read, Grep, Glob | — | Read-only. mode 일치, decision+rationale, 옵션 비교 (Plan), 기획서 완전성 (Design) |
| spec | Read, Grep, Glob, Bash, Write | emberdeck | AC 추출 + 코드 architecture + task 분해. emberdeck spec card + codeLinks |
| spec-reviewer | Read, Grep, Glob | — | Read-only. AC 완전성, 코드 architecture 명확성 검증 |
| test | Read, Grep, Glob, Bash, Edit, Write | firebat | Writes test code |
| test-reviewer | Read, Grep, Glob | — | Read-only. 테스트 품질, AC traceability 검증 |
| implement | Read, Grep, Glob, Bash, Edit, Write | firebat, emberdeck | Full access. firebat scans every change. emberdeck validate_code_links |
| implement-reviewer | Read, Grep, Glob | — | Read-only. spec 충족, stub detection |
| report | Read, Grep, Glob, Bash, Write | — | Produces reports. No code edits (Edit blocked) |
| report-reviewer | Read, Grep, Glob | — | Read-only. findings severity, evidence, action items 검증 |
| verify | Read, Grep, Glob, Bash | firebat, emberdeck, pyreez | Read-only. Flow-level goal verification. No reviewer |
| reflect | Read, Grep, Glob, Write | — | Writes instruction files. No reviewer. Structural guarantee |

### Orchestrator Protocol

orchestrator.ts가 오케스트레이터. Triage만 호출자(호스트 LLM 또는 server.ts)가 수행.

orchestrator.ts 인터페이스:
- `run(flow, request)` — A2A/CI: 전체 루프 실행
- `next()` — 유저 세션: 훅이 호출, 다음 스텝 반환
- `start(flow, request)` — flow 생성, 첫 스텝 반환
- `resume(flow_id, context)` — NEEDS_CONTEXT/crash 후 재개
- `abandon(flow_id)` — 중단 + Reflect 실행
- `reclassify(flow_id, new_flow)` — 플로우 재분류
- `status(flow_id?)` — 상태 조회
- `check-incomplete()` — 미완료 flow 존재 여부 (Stop 훅용)

유저 세션에서 호스트 LLM의 역할 (orchestration.md):
- Triage 분류 (signal table)
- `orchestrator.ts start` 호출
- PostToolUse 훅이 반환한 지시에 따라 Agent tool 실행
- NEEDS_CONTEXT 시 유저와 대화 후 `orchestrator.ts resume`
- 유저 개입 시 `reclassify` / `abandon` 호출

### Completion Status Protocol

Every step agent returns one of:

| Status | Meaning | Orchestrator action |
|--------|---------|-------------------|
| DONE | Step completed. Artifact produced + reviewer PASS | Write to state. Next step |
| BLOCKED | Cannot proceed | Write to state. Flow halt + escalate to user/caller |
| NEEDS_CONTEXT | Missing information | Write to state. NEEDS_CONTEXT → user/caller → step 재invoke |
| RETRY_EXHAUSTED | producer⇄reviewer 3회 fail | Write to state. **Flow halt + escalate** (C2 fix: 이전 DONE_WITH_CONCERNS proceed → halt) |

### Artifact Chain

Each step produces a defined artifact. Artifacts are **maps, not summaries** — findings + constraints + files_to_read. 다음 에이전트는 산출물(지도)을 읽고, files_to_read의 소스 코드를 직접 읽는다. 요약을 맹신하지 않고 코드를 직접 확인. (GSD `<files_to_read>` 패턴)

Missing artifact = natural failure (spec-kit pattern — adopted because it enforces order without extra machinery).

| Step | Produces | Consumed by |
|------|----------|-------------|
| Ground | task_subgraph + volatile_state + unknowns/conflicts + provenance + freshness (`.blazewrit/grounds/<flow-id>.md`) | Investigate (모든 flow) |
| Investigate | impact_map + constraints + risk_surface + compatibility_verdict + ground_unknowns_addressed (`.blazewrit/investigations/<flow-id>.md`) | Decide (모든 flow) |
| Decide | mode별 산출 — Record: decision_record / Plan: option_selection / Design: 기획서(`.blazewrit/plans/<flow-id>-기획.md`) + emberdeck intent card | Spec (있을 시), Test/Implement (Spec 없는 flow) |
| Spec | AC list + 코드 architecture + task decomposition (`.blazewrit/plans/<flow-id>-spec.md`) + emberdeck spec card + codeLinks | Test, Implement |
| Test | Test file paths + RED/GREEN status | Implement |
| Implement | Changed file paths + commit refs | Verify |
| Report | Report file (`.blazewrit/reports/<flow-id>.md`) | Verify |
| Verify | Verification result (PASS/FAIL + failure_origin + details) | Reflect (or back to failed step) |
| Reflect | Learnings in instruction files | Next session (auto-loaded by host tool) |

Plan-as-prompt (GSD pattern): Spec output IS the execution prompt for downstream steps (Test, Implement).

### Hooks

#### Safety Hooks (always active)

| Hook | Trigger | Action | Why |
|------|---------|--------|-----|
| firebat scan | PostToolUse(Edit\|Write) | Scan changed files. Error → block | Catches bad code immediately |
| regression_guard | PreToolUse(Bash(git commit*)) | emberdeck regression check | Prevents spec drift from being committed |
| stuck detection | PostToolUse(Read\|Grep\|Glob) | Count consecutive read-only calls. 5 → warn, 8 → force escalate | GSD analysis paralysis guard |
| blocker check | Stop | firebat blockers > 0 → block session end | Prevents leaving broken state |

#### Enforcement Hooks

| Hook | Trigger | Action | Why |
|------|---------|--------|-----|
| Reflect gate | Stop | Check state file: any flow completed without reflect_completed=true → block | Prevents skipping Reflect |
| Reflect structure | PostToolUse(Write) on instruction files | Check Reflect output has required sections (what_worked, what_failed, patterns) → warn if missing | Ensures Reflect isn't hollow |
| Coverage gate | PreToolUse(Edit\|Write) in Implement context | If flow=refactor and coverage < 80% and Test not in completed_steps → block | Enforces conditional Test requirement |

### Self-Validation Protocol

Within-step quality loop (prompt-enforced, iteration-capped):

```
Do work → Check against step criteria → Pass? → DONE
                                       → Fail? → Fix (iteration++)
                                       → iteration >= 3? → return RETRY_EXHAUSTED (halt, no proceed)
```

Iteration count tracked within step agent execution. Not in flow-state.yaml.

### Decision Classification

Within any step (gstack pattern — adopted because it prevents both over-automation and unnecessary blocking):

| Type | Criteria | Action |
|------|----------|--------|
| Mechanical | One clearly correct answer | Auto-decide silently |
| Taste | Reasonable people disagree | Surface to user at next gate |
| User Challenge | High risk or irreversible | STOP immediately, ask user |

Prompt-enforced. Classification itself is judgment — cannot be mechanically forced.

### Fact Verification Protocol

에이전트의 학습 데이터에서 나온 지식은 가설이다 (GSD: "Training data = hypothesis — 6-18 months stale"). 가설은 검증해야 사실이 된다. 검증 = 직접 읽거나 직접 실행. "그럴 것 같다"는 근거가 아니다.

| 주장 유형 | 검증 방법 | 미검증 시 |
|-----------|----------|----------|
| 외부 API/라이브러리 스펙 | Read로 docs/README 직접 확인 또는 Bash로 실행 확인 | `[UNVERIFIED]` 태그 |
| 구현 가능성 | 프로토타입 코드 작성 + 실행 | `[UNVERIFIED]` 태그 |
| 성능 수치 | benchmark/profile 직접 측정 | `[UNMEASURED]` 태그 |
| 기존 코드 동작 | Read로 코드 직접 확인 또는 test 실행 | `[UNVERIFIED]` 태그 |
| 호환성/의존성 | 직접 설치 + import 확인 | `[UNVERIFIED]` 태그 |

적용 대상: 모든 producer + 모든 reviewer. 예외 없음.
`[UNVERIFIED]`/`[UNMEASURED]` 태그가 있는 항목은 의사결정 근거로 사용 불가.
Verify가 `[UNVERIFIED]` 항목을 발견하면 FAIL + 해당 스텝으로 라우팅하여 검증 요구.

### What Cannot Be Mechanically Enforced

Only items that are **pure judgment with no structural proxy**:

| Item | Why it's irreducible | Mitigation |
|------|---------------------|-----------|
| Triage classification | Interpreting user intent is judgment | Signal table + LLM classification. Ambiguity → `ambiguous(question)` 출력으로 호출자가 명시적 처리. 잘못된 분류는 Verify가 발견 시 `failure_origin: triage` → reclassify로 회복 |
| Decision classification | Assessing risk/reversibility is judgment | Decision type table with examples per step |
| Self-validation content quality | Evaluating "good enough" is judgment | Criteria checklist per step. Max 3 iterations |
| Reclassification detection | Recognizing flow mismatch is judgment | Trigger list with concrete conditions. 3-failure rule is hookable |

## Quality Assurance

How blazewrit guarantees output quality in fully autonomous A2A operation with no human in the loop. Organized by enforcement domain: harness (mechanical), context (information management), prompt (behavioral rules). Every mechanism cites evidence level and source.

### Harness — Mechanical Quality Enforcement

These work regardless of LLM behavior. The agent cannot bypass them.

| Mechanism | What | Evidence | Source |
|-----------|------|----------|--------|
| **Deterministic quality gates** | typecheck + lint + firebat + test suite run as exit-code gates between steps. Non-zero = step fails | MEASURED: "Testing is the single biggest differentiator between agentic engineering and vibe coding" — Osmani | GSD, gstack, spec-kit, Anthropic harness |
| **Spec-Test traceability** | Script checks that each acceptance criterion in plan has ≥1 corresponding test case. Missing coverage = Test step incomplete | PRODUCTION-TESTED: GSD plan-checker "Requirement Coverage" dimension; spec-kit analyze Pass E "Coverage Gaps" | GSD, spec-kit |
| **Completion signal** | Step agent outputs sentinel string for mechanical completion detection. Harness greps — not LLM self-assessment | PRODUCTION-TESTED: Ralph Loop `<promise>COMPLETE</promise>` grep | Ralph Loop |
| **Hallucination guard** | If step agent produces zero tool calls, reject output. Agent that only talks without acting = hallucinated response | PRODUCTION-TESTED: GSD-2 auto engine "zero tool calls = rejected" | GSD-2 |
| **Crash recovery** | flow-state.yaml은 스텝 사이에만 업데이트 → 재개 시 현재 스텝 산출물 확인 → 미완성이면 revert + 재실행. 별도 메커니즘 불필요 — 새 세션 + 파일 상태가 자동 해결 | PRODUCTION-TESTED: Ralph Loop fresh restart pattern | Ralph, GSD-2 |
| **Self-consistency bias prevention** | Reviewer agent receives artifact only. Never receives producer's reasoning. 매 스텝 새 세션이므로 이전 추론 오염 없음 | MEASURED: Anthropic "models consistently show positive bias when grading their own work" | Anthropic harness |
| **Fresh context per step** | 모든 스텝이 새 세션. orchestrator.ts가 `claude --agent X --print`로 매번 새 프로세스 spawn. Context rot 구조적 불가 | PRODUCTION-TESTED: Ralph Loop "malloc/free — kill the process"; Anthropic "fresh context > compaction" | Ralph, Anthropic 4.6 |

Already in WORKFLOW_PLAN.md (not repeated): hooks (firebat scan, regression_guard, stuck detection, blocker check, Reflect gate, coverage gate), hook failure policy, maxTurns, worktree isolation, fix attempt limit (3), artifact chain validation.

### Context — Information Management

What each agent sees, when, and how degradation is prevented.

| Mechanism | What | Evidence | Source |
|-----------|------|----------|--------|
| **Context budget model** | Quality degrades with usage: 0-30% PEAK, 30-50% GOOD, 50-70% DEGRADING, 70%+ POOR. Tasks sized to complete within GOOD zone | PRODUCTION-TESTED: GSD plans target ~50% usage, 2-3 tasks max per plan | GSD |
| **Context pressure monitor** | 유저 세션 호스트 LLM 전용. PostToolUse hook injects warnings: 35% remaining = WARNING, 25% = CRITICAL. 스텝 에이전트는 fresh context이므로 불필요. A2A/CI에서는 orchestrator.ts가 프로세스 단위로 관리하므로 불필요 | PRODUCTION-TESTED: GSD `gsd-context-monitor.js` PostToolUse hook | GSD |
| **Context packets** | Each step agent receives explicit `files_to_read` list. First instruction: "Read every listed file before any action." No more, no less | PRODUCTION-TESTED: GSD `<files_to_read>` XML blocks; spec-kit progressive loading | GSD, spec-kit |
| **Session startup sequence** | Every agent session: (1) verify working directory, (2) read git log + state files, (3) identify task, (4) baseline verification, (5) begin work | PRODUCTION-TESTED: Anthropic official pattern; Ralph Loop reads prd.json + progress.txt first | Anthropic, Ralph |
| **One-task-per-session** | Each step agent implements exactly one bounded task. Prevents scope creep and context exhaustion | PRODUCTION-TESTED: Ralph Loop "one story per iteration — critical constraint"; Anthropic "one-feature-per-session" | Ralph, Anthropic |
| **Prompt caching architecture** | Static content (rules, enforcement, tool definitions) at prompt top. Dynamic content (plan artifacts, state) at bottom. Preserves cache across sessions | MEASURED: arXiv 2601.06007 "41-80% cost reduction, 13-31% TTFT improvement" | Academic |
| **Instruction repetition** | Critical constraints repeated at key decision points within long-running agents, not just loaded at session start | MEASURED: arXiv 2601.03269 "instruction repetition recovers compliance 20-35%" | Academic |

Already in WORKFLOW_PLAN.md (not repeated): flow state persistence, artifact chain, plan-as-prompt, 3-tier knowledge distillation, flow definitions on-demand read.

### Prompt — Behavioral Rules in Agent Instructions

Embedded in step agent prompts. Prompt-enforced, not mechanical — but backed by evidence.

| Mechanism | What | Evidence | Source |
|-----------|------|----------|--------|
| **Goal-backward verification** | Verify checks "what must be TRUE for success" — not "what steps were taken." Traces observable truths → required artifacts → required wiring | PRODUCTION-TESTED: GSD verifier 4-level check (exists → substantive → wired → data-flowing) | GSD |
| **Structured return contracts** | Every agent returns fixed format: status (DONE/BLOCKED/etc) + artifact path + evidence. No free-form prose between steps | PRODUCTION-TESTED: GSD defined output format per agent; gstack completion protocol | GSD, gstack |
| **Forced uncertainty marking** | Unknown = explicit `[NEEDS CLARIFICATION: specific question]`. Max 3 markers — make informed guesses for rest | PRODUCTION-TESTED: spec-kit max 3 markers | spec-kit |
| **Root cause before fix** | Bug Fix: never apply fix without identifying root cause first. Data flow tracing → hypothesis → verification → fix | PRODUCTION-TESTED: gstack `/investigate` iron law; 3-strike limit | gstack |
| **Two-pass review** | Verify runs two passes: Pass 1 CRITICAL (security, race conditions, data loss) blocks. Pass 2 INFORMATIONAL (style, naming) is advisory | PRODUCTION-TESTED: gstack `/review` two-pass system | gstack |
| **Escalation limits** | Hard caps prevent infinite loops: max 3 uncertainty markers, max 5 clarification questions, max 3 validation iterations, max 50 analysis findings | PRODUCTION-TESTED: spec-kit across all commands | spec-kit |
| **Mandatory initial read** | First line of every agent prompt: "Read every file in files_to_read before any other action" | PRODUCTION-TESTED: GSD "MUST read before any action" | GSD |
| **Append-only progress** | State and progress files are append-only. Agents never overwrite previous entries — only add | PRODUCTION-TESTED: Ralph Loop "never replace progress.txt" | Ralph |
| **Stub detection criteria** | Verify checks for hollow implementations: `return null`, `TODO`, `FIXME`, empty handlers, fetch without await, query result not returned | PRODUCTION-TESTED: GSD verifier stub detection rules | GSD |
| **Anti-pattern examples** | Each agent prompt includes concrete "DON'T" examples. Specificity tables: "TOO VAGUE vs JUST RIGHT" | PRODUCTION-TESTED: GSD anti-pattern lists; gstack AI slop detection | GSD, gstack |

Already in WORKFLOW_PLAN.md (not repeated): self-validation loop (max 3), decision classification, deviation rules, chunking rule.

### How Quality Mechanisms Integrate with Workflow

Quality mechanisms are not a separate chain — they are embedded in the workflow's step transitions and repetition cycles. The workflow's [Test ⇄ Implement]* loop, [Implement → Verify]* loop, and compound [Flow → Gate]* loop ARE the quality loops. orchestrator.ts가 각 전환에서 gate를 기계적으로 실행하고, 매 스텝은 새 세션으로 spawn된다 (Ralph Loop pattern).

Quality mechanisms apply at three points:

1. **Step entry** — artifact validation (previous step output exists), context packet delivery (files_to_read), mandatory initial read, session startup sequence
2. **Within step** — self-validation loop (max 3), deviation rules, escalation limits, hallucination guard (zero tool calls = reject), instruction repetition at decision points
3. **Step exit / transition** — deterministic gates (typecheck + test + firebat), completion signal, structured return contract, flow-state update

### Known Limitations

Three gaps that cannot be closed with current technology:

| Gap | Why it's irreducible | Mitigation |
|-----|---------------------|-----------|
| **Test quality** | Script can count AC → test mapping. Cannot verify the test actually validates the criterion. LLM judgment | Test-Reviewer + pyreez multi-model review. Two-pass review in Verify (CRITICAL first) |
| **기획 quality** | 나쁜 기획서 → 완벽한 쓰레기. 기획의 서비스 architecture, 정책, 유저 플로우가 잘못되면 downstream 전부 잘못됨 | 기획-Reviewer + pyreez multi-model deliberation. Forced uncertainty marking. Anti-pattern examples |
| **Triage classification** | 유저 세션에서 호스트 LLM이 Triage 수행. 잘못 분류할 수 있음. A2A에서는 기계 분류 + LLM fallback | Signal table with concrete examples. Ambiguity → Analyze에 위임. 유저가 재분류 가능 (`orchestrator.ts reclassify`) |
| **유저 세션 훅 지시 따르기** | PostToolUse 훅이 다음 Agent 지시를 반환하지만 호스트 LLM이 따르지 않을 수 있음. A2A/CI에서는 해당 없음 (스크립트가 루프 구동) | 지시가 단순함 ("Agent(X) 실행"). Stop 훅이 미완료 flow 감지. prompt-enforced 범위가 최소 |

Note: 스텝 순서 보장, reviewer 실행 보장, state 업데이트는 더 이상 Known Limitation이 아님 — orchestrator.ts(스크립트)가 기계적으로 보장. GSD/gstack/spec-kit과 달리 호스트 LLM에 루프를 맡기지 않음.

## Flows (16)

모든 flow는 `Ground → Investigate → Decide → ...` 순. **Decide는 universal — skip 없음**, mode만 차등.  
`Ground(volatile_profile)`은 flow별 선언된 measurement profile (universal + conditional).  
`Decide(mode)`는 flow의 기본 mode 선언 (Record / Plan / Design) — Decide가 옵션 발견 시 upgrade 가능.

```
Feature:
  Ground(universal)
  → Investigate(impact scope, card query, blockers, feasibility)
  → Decide(Design)              # 기획서 + intent card
  → Spec → [Test ⇄ Implement]* → Verify → Reflect

Bug Fix:
  Ground(universal)
  → Investigate(error logs, related code)
  → Decide(Record→Plan?)        # 단일 fix면 Record, 옵션 N≥2면 Plan
  → Test(reproduce) → Implement(fix) → Verify → Reflect

Bug Fix P0:
  Ground(universal)
  → Investigate(minimal: symptom location only)
  → Decide(Record)              # emergency fix 결정
  → Implement(emergency) → Verify → Test(retroactive) → Reflect

Bug Fix Unreproducible:
  Ground(universal + observability)
  → Investigate(logs, history, hypothesis 식별)
  → Decide(Plan)                # hypothesis 우선순위 선택
  → Implement(hypothesis) → Verify(extended observation) → Reflect

Refactor:
  Ground(universal)
  → Investigate(coverage, dependencies)
  → Decide(Plan→Design?)        # 단순 리팩터=Plan, 광범 시 Design upgrade
  → Spec → [Test(<80%)]? → [Implement → Verify]* → Reflect

Performance:
  Ground(universal + perf baseline)
  → Investigate(profile target, baseline interpretation)
  → Decide(Design)              # 목표+정책+architecture
  → Spec → [Test(profile) → Implement → Verify(measure)]* → Reflect

Migration:
  Ground(universal + dependency_audit)
  → Investigate(compatibility matrix, breaking surface)
  → Decide(Plan)                # 옵션 비교 + 순서, 광범 시 Design upgrade
  → Spec → [Test(validate) → Implement → Verify]* → Reflect

Test:
  Ground(universal)
  → Investigate(coverage gap)
  → Decide(Plan)                # 어떤 테스트, 어떤 순서
  → Test → Verify → Reflect

Chore:
  Ground(universal)
  → Investigate(minimal: change target)
  → Decide(Record)              # 자명한 1줄 결정
  → Implement → Verify → Reflect

기획 (standalone):
  Ground(universal)
  → Investigate(existing cards, docs)
  → Decide(Design)              # 기획서 산출
  → Report → Verify → Reflect

Review:
  Ground(universal)
  → Investigate(diff, related code)
  → Decide(Record)              # 리뷰 verdict 결정
  → Report → Verify → Reflect

Release:
  Ground(universal + version_changelog)
  → Investigate(minimal: version, CI status)
  → Decide(Record)              # patch/minor/major + changelog 항목 결정
  → Implement(version) → Verify → Reflect

Retro:
  Ground(universal)
  → Investigate(git log, history)
  → Decide(Plan)                # 어느 영역 학습 추출, 우선순위
  → Report → Verify → Reflect

Spike:
  Ground(universal)
  → Investigate(minimal)
  → Decide(Plan)                # 어느 prototype 접근
  → Implement(prototype) → Report → Verify → Reflect

Exploration:
  Ground(universal)
  → Investigate(관련 영역 탐색)
  → Decide(Plan)                # 어느 깊이/방향으로 탐색
  → Report → Verify → Reflect

Compound:
  Ground(universal)
  → Investigate(sub-flow identification)
  → Decide(Design)              # sub-flow 분해 + 의존성 ordering
  → [Sub-Flow → Gate]* → Report → Verify → Reflect
  (각 Sub-Flow는 자체 Ground → Investigate → Decide → ... 실행)
```

## Reclassification Rules

Any step can trigger reclassification:

- Bug Fix discovers design flaw → Refactor or Compound
- Refactor requires public API change → Migration
- Spike confirms feasibility → Feature
- Any flow: 3 failures with same approach → stop, escalate
- Any flow: scope exceeds bounds → Compound or chunking

## Compound Flow Rules (recursion contract — TR7·M6·M10 fix)

### Recursion 구조

```
Compound (top-level)
  Ground → Investigate(sub_flow_identification) → Decide(Design: decomposition + ordering)
  ↓
  for each sub_flow in Decide.Design.sub_flow_sequence:
    [Sub-Flow self-execution]
      Triage(prior_evidence=parent compound) → Ground → Investigate → Decide → 
      [conditional Spec/Test/Implement] → Verify → Reflect (sub-flow level)
    ↓
    Gate (between sub-flows): proceed | pivot | abort | retry
  ↓
  Compound Report → Compound Verify → Compound Reflect (top-level)
```

### Sub-flow Identification 시점

- *식별*은 top-level Investigate (사실 기반: "이 작업이 N concerns")
- *분해/순서/gate criteria*는 top-level Decide(Design)
- *Dynamic N*: Review가 N bugs 발견 같은 경우 — Investigate가 N 식별 + Decide가 N 별 sub-flow 생성. Triage 시점 결정 안 함 (M6 fix).

### Gate Criteria (sub-flow 사이 결정)

| Gate 결과 | 다음 |
|---|---|
| proceed | 다음 sub_flow 실행 |
| pivot | 잔여 sub_flow 재구성 (Compound Decide 재invoke) |
| abort | Compound flow halt, 부분 완료 sub-flow reflect |
| retry | 직전 sub_flow 재실행 (with deep upgrade) |

Gate criteria는 *top-level Decide(Design) 산출물*에 명시 (Triage 시점 아님).

### Gate Executor (서브 에이전트 검토 fix)

Gate 평가 = **orchestrator 코드** (LLM 아님). top-level Decide(Design) 산출물의 `gate_rules: [{condition, action}]`를 mechanical 평가:
- `condition`: sub_flow.status / output에 대한 predicate (예: "sub_flow.verify.result == PASS")
- `action`: proceed | pivot | abort | retry

LLM 호출 없음. 결정 deterministic. 단 *재invoke action* (pivot, retry)는 cap 적용.

### Pivot / Retry Cap (서브 에이전트 결함 fix)

- `pivot` (Compound Decide 재invoke): Compound 당 **최대 2회** (무한 재분해 방지)
- `retry` (직전 sub_flow 재실행 with deep upgrade): sub_flow 당 **최대 1회** (cycle cap 적용)
- 초과 시: Compound flow halt + escalate.

### Compound State 추적

Compound flow의 state 필드:
```yaml
flow_id: <compound_id>
type: compound
sub_flows:
  - sub_flow_id, type, status: pending|active|completed|failed|aborted
    parent: <compound_id>
    own_state: <link to sub_flow_id 자체 state>
    gate_result: proceed|pivot|abort|retry|null
sub_flow_sequence: [...]  # Decide(Design)이 정한 순서
current_position: index
```

### Sub-flow 자체 실행

각 sub-flow는 *full chain* 실행 (Triage→Ground→Investigate→Decide→...→Verify→Reflect). 자체 flow_state entry 가짐. parent compound와 linked.

Sub-flow Triage 입력 (NEW6 fix — 명시 context inheritance):
- `primary_input`: parent Compound의 request 또는 Decide(Design)에서 추출된 sub-task description
- `prior_evidence`: { parent_compound_id, prior_sub_flow_results, parent_classification_metadata }
- `channel`: parent와 동일 (user_session sub-flow는 user_session, A2A sub-flow는 A2A)
- `conversation_context`: parent의 conversation_context 상속 (user_session에서)
- `inherited_caller_credentials`: parent A2A의 credentials 상속 (NEW9 — A2A 자격 전달)
- `pre_approved`: parent에서 상속 (CI에서 sub-flow 자동 진행 허용)

### Completion Predicate

Compound 완료 조건:
- 모든 sub_flow.status ∈ {completed, aborted}
- 또는 명시 abort gate

Failure propagation: sub-flow status=failed → Compound flow pause for gate decision (retry/abort/pivot).

## Chunking Rule

When Investigate identifies scope exceeding bounds (5+ files, 3+ modules), Decide MUST produce a chunking plan (Plan or Design mode):
- Split into bounded cycles, each covering one concern/module
- Each cycle is a complete mini-flow (Test → Implement → Verify)
- Dependency order between cycles defined in the plan

## Bug Fix Paths

| Condition | Path |
|-----------|------|
| Normal (reproducible) | Ground → Investigate → Decide(Record→Plan?) → Test(reproduce RED) → Implement(fix GREEN) → Verify → Reflect |
| P0/production down | Ground → Investigate(minimal) → Decide(Record) → Implement(emergency fix) → Verify → Test(retroactive, mandatory within 24h) → Reflect. Enforcement: scheduled trigger checks `retroactive_test_due` in flow-state.yaml every 6h, auto-creates Test flow if overdue. Fallback: SessionStart hook warns on next session. |
| Unreproducible (intermittent) | Ground → Investigate(hypothesis 식별) → Decide(Plan: hypothesis 우선순위) → Implement(hypothesis fix, documented) → Verify(extended observation) → Reflect |

## Refactor Guards

- If Investigate identifies target code has <80% test coverage → Test step mandatory before Implement to establish baseline
- Large scope (5+ files) → Decide forced to Design mode for chunking plan
- Breaking changes (public API) → reclassify as Migration

## Migration Test-First Rule

Migration flow includes Test before each Implement cycle:
```
Decide(Plan) → Spec → [Test(validate migration) → Implement(apply migration) → Verify]*
```
Test validates: migration scripts are reversible, data integrity preserved, rollback works.

## Tool Integration

### Per-Step Tool Mapping

| Step | emberdeck | firebat | pyreez |
|------|-----------|---------|--------|
| Ground | `query_graph` (subgraph 추출, freshness metadata 포함) | `scan --baseline` (volatile lint 부분, flow별 profile에서) | — |
| Investigate | `get_card_context`, `pre_change_check` | `query-dependencies` (Migration) | — |
| Decide | `create_card` (intent, **Design mode만**); 기존 카드 read (모든 mode) | — | `deliberate` (Plan/Design mode: 옵션 비교 / ideation / architecture) |
| Spec | `create_card` (spec), `codeLinks` | — | `deliberate` (complex spec) |
| Test | — | `scan` (after test code) | — |
| Implement | `validate_code_links`, `write_spec_annotations` | `scan` (every change, expandAffected) | — |
| Report | — | — | — |
| Verify | `regression_guard` (threshold=0) | `scan` (full project) | `deliberate` (review mode, high-risk) |
| Reflect | — | — | — |

### emberdeck Chain (Intent → Spec → Code → Verify)

```
기획: create intent card (의도 기록)
  → Spec: create spec card + codeLinks (명세 + 코드 연결)
    → Implement: validate_code_links (코드가 spec과 일치하는지)
      → Verify: regression_guard (drift=0, spec 대비 변화 없음)
```

### pyreez Trigger Criteria

Called only when:
- 5+ affected files, OR
- emberdeck card risk = high/critical, OR
- Explicit request from user/agent

Otherwise: agent plans independently.

### Tool Availability (M4 fix — degrade vs escalate 분리)

Tool 부재 처리는 *상황별 분리*:

**Pre-flow Degrade (시스템 설정 차원)**: 도구가 *프로젝트에 설치 안 됨*. 알려진 부재 → graceful degradation 자동 활성:
- emberdeck 부재 → code-only analysis, text-only plans, no drift check (ED graph는 graphify로 대체 또는 disable)
- firebat 부재 → `test` + `typecheck` only (scan/blocker hook 비활성)
- pyreez 부재 → agent 단독 결정 (deliberation 없음)

**Mid-flow Escalate (invocation 차원)**: 도구가 *invocation 중 실패* (network/timeout/rate limit). 알려진 가용성 위반:
- Disposition matrix: `tool_unavailable` → escalate (compatibility blocked)
- Investigate가 *예상한* 도구 실패 → flow halt

**경계 명확**: degrade는 *flow 시작 전* 시스템 capability, escalate는 *flow 진행 중* 가용성 실패. 둘은 *서로 다른 케이스*이므로 disposition matrix와 graceful degradation rule 모두 정당.

## Deviation Rules

1. firebat severity=error → auto-fix attempt
2. firebat severity=warning → fix if task-related, skip otherwise
3. emberdeck drift detected → update spec card, confirm, proceed
4. **3 failures with same approach → stop, escalate**
5. P0 severity → skip Test, fix first, retroactive test mandatory

## Verify Checklist

All must PASS:
1. emberdeck `regression_guard` PASS (skip if no emberdeck)
2. firebat `scan` blockers = 0 (or test + typecheck pass if no firebat)
3. Most complex execution path traced end-to-end through actual code
4. Every Plan/Spec item mapped to code (file:line)

## Flow Variants — Operational Edge Cases

### Review flow follow-up (M7 fix)

Review flow는 *audit only* — 코드 변경 안 함. 그러나 review findings에 *코드 수정 필요*가 surface되는 흔한 케이스:

- Review의 Decide(Record) 산출물: `decision_record` + `followup_flows: [{type: bugfix|refactor|feature, scope: <finding ref>}]`
- `followup_flows`가 비어있지 않으면 → Review 완료 후 orchestrator가 자동으로 후속 flow 큐잉 (각 finding이 자체 flow_id로)
- 사용자 cycle: Review → followups queued → 사용자가 각 후속 flow를 별도로 실행
- 자동 실행 안 함 (user/CI 결정)

**NEW7 fix (dedup)**: `followup_flows`는 `(type, scope_hash)` 기준 dedup 강제. 같은 영역에 같은 type 후속 1개로 통합. Decide-Reviewer가 검증.

### Release CI confirm gate 처리 (M8 fix)

`gate_policy: confirm: [migration, release]`는 user 입력 가정. CI/A2A에서 user 부재 → 충돌:

| Channel | Confirm gate 처리 |
|---|---|
| user_session | user에 prompt (normal) |
| CI | trigger config의 `pre_approved: bool` 필드. true면 자동 진행. false면 *flow halt* + scheduled retry (다음 user 세션에서 처리) |
| A2A | caller request의 `pre_approved` 필드. true면 자동. false면 INTENT_NOT_COMPLETE 반환 (caller가 결정) |

Config에서 `gate_policy.allow_pre_approval: false`이면 CI/A2A에서 confirm 필수 flow는 항상 halt (보안 정책).

**NEW8 fix (pre_approved scope 제약)**: `pre_approved` 우회는 *명시 flow type만* 허용. `gate_policy.allow_pre_approval_flows: [release, migration]` (default) — 다른 flow에 pre_approved 보내도 무시. 보안 risk 최소화.

### External Auth in A2A (M9 fix)

Investigate의 외부 리서치 일부가 *auth 필요* (private docs, paid API):

| 상황 | 처리 |
|---|---|
| user_session: auth 필요 | user에 credential 요청 (NEEDS_CONTEXT) |
| A2A: caller가 credential payload에 포함 | 그대로 사용 (provenance: caller-supplied) |
| A2A: credential 없음 | unknown[external_inaccessible: auth] — caller에 알림 (INTENT_INCOMPLETE 가능) |
| CI: secret manager 통합 | 사전 설정 secret 사용 (config 지정) |

Auth 자체는 *Investigate의 책임 아님* — 외부 도구 (WebFetch 등)가 credential 받음. Investigate는 graceful 처리.

### no_op in A2A (caller가 terminal result 원함)

A2A에서 result=no_op:
- Flow halt + Reflect는 동일
- caller에 *terminal result* 반환: `{status: no_op, details: <no_op_details>, suggested_action}`
- caller가 follow-up 결정 (abandon vs reframe)

## Gate Policy

```yaml
gate_policy:
  confirm: [migration, release]
  auto: [*]
```

Configurable per project in `.blazewrit/config.yaml`. `auto: []` = fully manual. `confirm: [migration, release]` = mostly automated.

## Hook Enforcement

See Execution Protocol > Hooks for complete hook specification. Summary:

**Safety**: firebat scan (PostToolUse Edit/Write), regression_guard (PreToolUse commit), stuck detection (PostToolUse Read/Grep/Glob), blocker check (Stop)

**Enforcement**: Reflect gate (Stop), Reflect structure check (PostToolUse Write), coverage gate (PreToolUse Edit/Write in Refactor)

### Hook Failure Policy

| Hook category | On crash/timeout | Rationale |
|---------------|-----------------|-----------|
| **Safety** (firebat, regression_guard, blocker check) | **fail-closed** — wrapper script catches crash → exit 2 (deny) | Violation consequence is dangerous (bad code ships). AgentSpec: >90% unsafe code prevention requires mechanical enforcement |
| **Enforcement** (Reflect gate, coverage gate) | **fail-open** (Claude Code default: non-0/non-2 exit = continue) | Violation consequence is quality issue. Guardrails-as-Infrastructure: stricter policies reduce task success rates |

### Hook Context Detection

Hooks that need flow context (e.g., coverage gate checking if current flow is Refactor) read `.blazewrit/flow-state.yaml` directly. The active flow's `flow` and `step` fields provide the needed context. No environment variables or separate mechanisms required.

## Delivery Form Factor

### What blazewrit Is

blazewrit is a **workflow rule set + thin script orchestrator**. 규칙(에이전트 프롬프트, 플로우 정의, 훅)과 오케스트레이터 스크립트(orchestrator.ts)를 프로젝트에 설치한다. orchestrator.ts가 루프를 기계적으로 구동하고, 각 스텝은 custom agent로 실행된다.

### Why This Form

| Alternative | Why rejected |
|-------------|-------------|
| **Standalone CLI** (GSD-2 model) | Rebuilds what Claude Code already provides (hooks, agents, mcpServers). Maintenance cost |
| **Rules only** (prompt-enforced) | 호스트 LLM이 루프를 관리 → 스텝 건너뛰기, reviewer 누락 가능. 모든 레퍼런스 시스템의 한계 |
| **Claude Code plugin** | Plugin subagents restricted (no hooks/mcpServers/permissionMode) |
| **MCP server** | MCP exposes individual tools, not orchestrated workflows |
| **Skill collection** (gstack model) | Skills share host context (context rot), no mcpServers scoping, no maxTurns, no worktree isolation |

### Bun Package — Setup Tool (No Runtime Dependency)

blazewrit is a setup tool, not a runtime dependency. It copies rules, agents, hooks, and scripts into the project, then exits. Nothing remains in `dependencies`.

```
bunx @zipbul/blazewrit init
```

Deploys into the project:

```
├── .claude/rules/blazewrit/
│   ├── orchestration.md          ← Triage + state management protocol (always loaded, kept concise)
│   └── enforcement.md            ← deviation rules, gate policy, decision classification
│
├── .claude/agents/
│   ├── analyze.md                ← producer: read-only + bash, mcpServers:[emberdeck]
│   ├── analyze-reviewer.md       ← reviewer: read-only, checks analysis scope/depth
│   ├── 기획.md                    ← producer: tools, mcpServers:[emberdeck,pyreez], maxTurns
│   ├── 기획-reviewer.md           ← reviewer: read-only, checks 기획서 completeness (유저플로우, 정책, architecture)
│   ├── spec.md                   ← producer: tools, mcpServers:[emberdeck], maxTurns
│   ├── spec-reviewer.md          ← reviewer: read-only, checks AC completeness, 코드 architecture clarity
│   ├── test.md                   ← producer: tools, mcpServers:[firebat], maxTurns
│   ├── test-reviewer.md          ← reviewer: read-only, checks behavior testing, AC traceability
│   ├── implement.md              ← producer: tools, mcpServers:[firebat,emberdeck], maxTurns, isolation:worktree
│   ├── implement-reviewer.md     ← reviewer: read-only, checks spec fulfillment, stub detection
│   ├── report.md                 ← producer: tools, maxTurns
│   ├── report-reviewer.md        ← reviewer: read-only, checks severity, evidence, action items
│   ├── verify.md                 ← no reviewer: internal multi-pass + pyreez, mcpServers:[firebat,emberdeck,pyreez]
│   └── reflect.md                ← no reviewer: structural guarantee (hook + 3-tier + append-only)
│
├── .claude/settings.json          ← hooks (PostToolUse(Agent): orchestrator next, Stop: check-incomplete, 에이전트 내부 safety hooks)
│
├── .blazewrit/
│   ├── orchestrator.ts            ← 스크립트 오케스트레이터 (상태 머신, 루프 구동, gate 실행)
│   ├── config.yaml                ← gate_policy, flow settings
│   ├── flows/                     ← flow definitions (on-demand read, NOT context-resident)
│   │   ├── feature.md
│   │   ├── bugfix.md
│   │   ├── bugfix-p0.md
│   │   └── ...                    ← 16 flow files
│   ├── scripts/                   ← hook wrapper scripts, gate scripts
│   └── a2a/
│       └── server.ts              ← A2A server (프로토콜 처리 → orchestrator.ts run 호출)
└──
```

**Context budget**: `.claude/rules/blazewrit/` (always loaded) is kept concise — Triage signal table + orchestration protocol only. Flow definitions live in `.blazewrit/flows/` and are read on-demand after Triage classifies. This follows GSD's phase-aware context loading pattern: load only what the current phase needs.

### A2A Integration

blazewrit is input-channel agnostic. A2A는 풀자동 — 유저 개입 없음. CancelTask로 중단 가능.

```
External Agent ──A2A──→ server.ts (프로토콜 처리)
                              │
                              ├─ Triage: 기계 분류 → 실패 시 claude 호출
                              │
                              ↓
                        orchestrator.ts run (전체 루프, 기계적 보장)
                              │
                              ├─ claude --agent ground --print
                              ├─ claude --agent ground-reviewer --print
                              ├─ claude --agent investigate --print
                              ├─ claude --agent investigate-reviewer --print
                              ├─ claude --agent decide --print
                              ├─ claude --agent decide-reviewer --print
                              ├─ ...각 스텝 새 세션...
                              ├─ claude --agent verify --print
                              ├─ claude --agent reflect --print
                              │
                              ↓
                        Result ──A2A──→ External Agent

CancelTask → server.ts → SIGTERM → orchestrator가 subprocess kill → revert → suspended
NEEDS_CONTEXT → task status: input-required → 클라이언트 에이전트에 질문 반환
```

blazewrit provides a reference A2A server implementation (`.blazewrit/a2a/server.ts`). Minimal thin layer: receive request → spawn `claude` session in project directory → return result. Projects can customize or replace with their own A2A infrastructure.

### Input Channels

| Channel | Example | Human required |
|---------|---------|---------------|
| Human direct | User types request in Claude Code session | Yes |
| Agent (A2A) | Product agent sends feature request to project's A2A server | No — pyreez + self-validation |
| Auto trigger | CI failure → Bug Fix, scheduled cron → Retro | No |

## Quality Assurance Mechanisms

| Mechanism | What it solves | Source |
|-----------|---------------|--------|
| Emberdeck card-unit decomposition | Agent capability limits (FeatureBench 11%) | GSD context budget |
| File-based state (cards, reports, git) | Context degradation over long sessions | Ralph Loop, GSD context-packet |
| Mechanical verification (5/6 checks) | LLM self-evaluation unreliable | Anthropic evaluator research |
| Multi-model cross-verification (pyreez) | Single model bias | gstack dual-voice, AceMAD |
| Goal-backward verification | "exists" ≠ "works" | GSD verifier |

## Validation Status

- 48 scenarios simulated across 14 flows (pre-decomposition) + structural review of 3 Bug Fix variants and Exploration
- Orient decomposed into Triage + Analyze (dedicated step agent) — *historical, 이후 Analyze는 Investigate로 개명, Triage stateless화*
- Step pool: ~~8 (Analyze, 기획, Spec, Test, Implement, Report, Verify, Reflect)~~ **→ 9 (Ground, Investigate, Decide, Spec, Test, Implement, Report, Verify, Reflect)** — Analyze/기획 폐기, Ground/Investigate/Decide 신설
- Flow count: 16 (Bug Fix split into 3 paths)
- Reclassification rules added (any step can trigger)
- Tool mapping updated (firebat in Analyze for Migration only)
- Triage classification logic added (signal table, strength rules, None classification)
- **Triage 최종 정의: Stateless classification function.** `(input) → (output)`. Inputs: primary_input + channel + optional(conversation_context, clarifications, prior_evidence). Outputs 4종: `proceed(flow_type, confidence)` / `none(reasoning)` / `ambiguous(question)` / `error(reason)`. Single-pass, 루프 없음, persistence 없음, flow state 안 봄, 코드 분석 안 함. Ask cycle은 Triage 밖 — 호출자가 답변 받으면 clarifications에 추가하여 재invoke. Active flow 충돌/cycle cap/preempt/conflict resolution은 모두 orchestrator/caller 책임. **스코프 엄격화 이유**: 이전 elaborate 설계 (Frame Intent 15필드, Active Check, conflict resolution table, state machine, similar_suspended, sub_flow_types 등)는 모두 다른 step의 책임을 Triage에 잘못 흡수한 over-reach였음. 진짜 Triage는 *분류만* — 의도 결박/캡처는 워크플로우 전체가 점진적으로 정밀화하는 일이지 첫 step의 일이 아님.
- **Ground step 신설 — Evidence Boundary.** Step Pool 8 → 9. Triage 다음에 위치 (`None ↔ Triage → Flow[Ground → Analyze → ...]`). Triage된 의도를 bounded·sourced·current 사실 + 명시 불확실성으로 변환. 3 활동: (1) ED graph query — request 영역 bounded subgraph, (2) Volatile capture — flow_type별 선언된 measurement profile 실행 (universal: typecheck/test/lint/git, conditional: Performance/Migration/Bug Fix Unreproducible/Release), (3) Surface — ED ambiguous/inferred + capture 실패 → unknowns/conflicts (silent gap 금지). **Provenance 강제**: 모든 fact/unknown/conflict에 source_tool 명시. **Freshness 강제**: ed_snapshot_version + git_HEAD start/end 기록, racing_changes 검출. **Reviewer 강화**: subgraph entry≥1 OR referent_unresolved, volatile 각 항목 explicit status (success/fail/timeout/skipped-with-reason), ambiguous/inferred·실패 unknowns 매핑. **Cache 허용** (logically stateless): cache key = hash(request + conversation_digest + ed_snapshot + git_HEAD + worktree + commands_def + flow_type + scope_hint). **Boundary**: 해석·판단·선택 없음 — 측정값 의미 판단/위험 평가/feasibility는 Analyze 책임. **Analyze 책임 재정의**: "이해/사실 캡처"는 Ground로 이관, Analyze는 *task-specific 해석/영향 분석*만. **codex 교차 검토 반영**: provenance granularity / flow-conditional profile은 선언만 (Ground가 판단 안 함) / volatile result status 강제 / 모노리포 scope_hint / active_flow_overlap 처리 / racing_changes 검출.
- **Analyze → Investigate 개명.** "Analyze"는 너무 generic — 다른 step도 분석함. *Task-specific interpretation*이 본질. Investigate가 명명-기능 정합. 활동 (Impact/Constraints/Risk/Compatibility) 동일하되 *옵션 생성·결정·설계는 배제* (Decide로 이관). codex 검증.
- **Unknown Disposition Matrix 명시화 (결함 #3·#4 해결).** Ground unknown 처분이 이전엔 implicit (LLM 판단). 이제 6 disposition (resolved/risk/constraint/clarification/defer/escalate) + unknown 유형별 권장 matrix 정립. 매 unknown은 `{disposition, rationale, follow_up_ref, matrix_default?}` 명시 — silent 미처리 0. Reviewer가 매 항목 disposition + rationale 검증, matrix 벗어난 경우 rationale 강화 확인. **codex 권장 반영**: "environment/tooling capture failures → risk; missing dependency/API/policy → constraint; ambiguous intent/scope → clarification; irrelevant unknown → defer with rationale" — 모두 matrix에 포함 + 추가 (resolved/escalate).
- **Compatibility Verdict 구조화 (결함 #6 해결).** 단순 `{result, reason, blockers?}`였던 verdict를 *3-state result + scoped issues list + freshness*로 확장. 4 round 적대적 검증, 25 angle 공격. codex 자기 prior 권장 (`high_risk_proceed`) **over-recommendation 인정** — risk_surface와 중복. 최종 안: (1) `result: proceed|blocked|needs_clarification` 3-state 유지, (2) `issues: [{type(15 base + other), severity, scope(component/tenant/dependency/platform/sub_flow/target_set), evidence, requires_user?, blocks_flow?, suggested_followup}]` — cap 50, dedup (root_cause+scope hash, most-severe-wins), (3) `source_version` (ed_snapshot/rules_version/contracts_version) freshness, (4) `sub_flow_verdicts` Compound 전용, (5) Validation Rules V1-V10 (mechanical hook), (6) Stale 검출 책임 Decide/Verify 명시. **scope per issue가 핵심**: 없으면 Compound·partial-compat에서 over-block (codex 시뮬레이션이 입증). type taxonomy *extensible* (closed enum 금지). 시나리오 d (Performance no-op) 는 호환성 영역 밖 — task validity 결함 #11로 별도 노트.
- **External Research Policy (결함 #8 해결).** Investigate의 외부 도구 사용이 미정의였음 — 초안 (고정 budget + 고정 tool 우선순위 + 전체 provenance)을 codex가 *5개 항목 WRONG*으로 검증: 고정 budget=arbitrary (위험·claim 수와 무관), 고정 tool 우선순위=context-dependent (freshness 검증은 WebFetch 직접 필요), "external preferred" rule=unsafe (내부 contract silent override 위험), 균일 provenance=mechanical noise, per-flow override=too crude. 최종 정책: (1) **Triggers**: claim 단위 — lib API/version compat/CVE/license/contract/standards/runtime support/registry metadata, (2) **Source eligibility** 4-tier (high: official_current·standards·source·security_advisory / medium: official_stale·changelog·registry / low: community·archive / rejected: generated_seo), (3) **Tool selection** *context-dependent* (claim 유형별 권장 매핑), (4) **Stop criteria** — sufficient_evidence·diminishing_returns·blocking_failure·safety_cap (flow별 default cap, claim-driven override 허용 with rationale), (5) **Provenance claim 중요도별** (decision_critical: 전체, background: aggregated), (6) **Conflict 처리**: external API fact는 external 채택, *내부 contract/policy는 silent override 금지* (owner review용 기록), (7) **No-results 처리** claim 중요도별 (decision_critical→compatibility issue, version_sensitive→risk, background→defer, feasibility-critical→negative signal), (8) **Failure recovery** (rate limit fallback, auth/paywall→external_inaccessible). codex 10 항목 모두 반영.
- **Step Depth Policy — Adaptive (결함 #10 해결).** 소형 flow over-engineering 해결. 초안 (per-flow mode declaration)을 codex가 *6개 항목 WRONG*으로 검증: LLM call 수 미감소, budget 숫자 arbitrary, compat 안전망 입력 빈약, reviewer 비용 재발, matrix sprawl, looks-trivial-but-isnt 미처리. 최종 정책: 모든 step이 *default=shallow*, 명시 mechanical trigger 발동 시 deepen. (1) **Shallow/Deep 활동 분리** 각 step 정의, (2) **Mechanical caps** (wall_s + tokens) shallow/deep별, (3) **Deepen triggers** OR 매칭 (flow_type / Triage.complexity_signal / god_node detection / volatile failures / Ground.unknowns count / entry_nodes size 등 mechanical 계산), (4) **Upstream deepen request** (Decide→orchestrator→Ground/Investigate 재invoke, cap 1회), (5) **Shallow→Deep transition** (in-place escalation + fact 재사용), (6) **Reviewer checklist mechanical** (Ground-Reviewer 3 check / Investigate-Reviewer 3 check / Decide-Reviewer 3 check — LLM 판단 최소화), (7) **god_node priority** in shallow ed_query (graph degree 기반, random 5 아닌 high-degree top), (8) **token budget** (1k for shallow ed_query, arbitrary node count 대체), (9) **Triage.complexity_signal** 부수 출력 (deepen trigger 입력). **Multi-Layer Safety 7-layer**: orchestrator triggers / step caps / reviewer checklist / Verify / Reflect / provenance / freshness. 단일 layer 실수도 다른 layer catch. codex 비판 6/6 처리.
- **Task Validity 검출 (결함 #11 해결).** Performance baseline 이미 target 도달, Migration 이미 완료 등 *작업 자체가 의미 없는* 케이스 검출 부재였음. **Investigate 책임**으로 추가 — Ground 사실 vs Triage 의도 target 비교는 *해석* 활동이므로 적합. compatibility_verdict.result 확장 **3-state → 4-state** (proceed/blocked/needs_clarification/**no_op**). no_op는 compatibility의 "can-do" 차원과 *다른 의미* ("should-do") — codex의 high_risk_proceed 거부 사유 (risk_surface와 내용 중복)와 달리 no_op는 *어디에도 중복 없는 새 차원*이라 4-state 정당화. **검출 rule per flow** (Performance: baseline ≤ target, Migration: 이미 target version, Bug Fix: reproduce 불가, Refactor: 이미 target 패턴, Chore: 이미 원하는 상태, Feature: 이미 구현, Test: coverage 충족, Release: 신규 commit 없음). **출력**: `no_op_details {reason, evidence, current_state, target_state, suggested_action: abandon|wait_for_change|reframe_request}`. **Validation V11** 추가. **Orchestrator 처리**: result=no_op → flow halt + Reflect 실행 (학습 누적). **Activities** 6번째 추가 (Validity 검사).
- **Trace-level 결함 처리 batch 5 (서브 에이전트 verification round 2).** Batch 4 검증 round에서 발견된 잔여·신규 결함 처리. **D1 (HIGH)**: Investigate Tools 섹션 line 785에 "Bash 제한적" 잔재 — 1147 frontmatter와 모순. Fix: Bash 완전 제거, git log 등은 Ground 책임. **M-NEW1 + Scenario B (HIGH)**: V13 partial-proceed가 result=blocked 강제 halt와 모순. Fix: `partial_proceed` 별도 enum value 추가 (V12 확장), Decide가 proceed_set 처리 + blocked_set은 followup_flows로 큐잉. **NEW9 정의**: Sub-flow Triage에서 `inherited_caller_credentials` 상속 — parent A2A의 credentials를 sub-flow가 외부 리서치 시 자동 사용. pre_approved와 동일 inheritance 원리. *보안*: Sub-flow Triage에서도 pre_approved scope check 적용 — privilege escalation 방지. **Step Pool count drift**: Validation Status 잔재 "8" 수정 (별도). **NEW10 (M-NEW2)**: Sub-flow Triage 시점에 *상속된* pre_approved/credentials에 대해 `allow_pre_approval_flows` 재검사 — Compound→Release sub-flow 자동 우회 방지.
- **Trace-level 결함 처리 batch 4 (서브 에이전트 적대 검증 결과).** Codex 한도 도달 → general-purpose sub-agent로 교차 검증. 16 결함 발견·우선순위 8개 처리. **CRITICAL #1**: Investigate Tool Restrictions table이 Read/Grep/Glob/Bash 허용 — NEW1 (코드 read 금지) 위반. Fix: tools 제한 = WebFetch/WebSearch + Read(allowed_paths: rules만), Bash 제거, hook으로 mechanical 강제. **#3 Step Pool count drift**: "8" 잔재 → "9" 정정 (header). **#7 Compound Gate executor**: orchestrator code (LLM 아닌) 평가, gate_rules predicate. **Pivot/Retry cap**: pivot 2회, retry 1회/sub_flow. **Migration partial-proceed (Scenario 1)**: V13 추가 — issue.scope.target_set로 부분 영향 분리, Decide.partial_scope_handling으로 분해 가능. all-or-nothing 강제 제거. **triage_mismatch 무한 reclassify cap**: flow 당 3회 (`reclassify_count` 추적). 초과 시 user/caller escalate. **Spec/Test/Implement/Report Step Depth Policy 추가**: shallow/deep 활동 + caps 명시 (기존 누락). **M3 cycle cap=1 의미 정정**: 원본 + 재invoke 1회 = 총 2 attempts. **failure_origin=report 제약**: 비코드 flow만 유효, 코드 flow에선 invalid.
- **Trace-level 결함 처리 batch 3 (self-attack 8 신규).** Batch 1-2 후 자체 적대 검증으로 8개 추가 결함 발견·처리. **NEW1**: Investigate의 "코드 read-only (Ground 못 캡처 detail)" boundary 위반 — 제거. 부족 시 `request_upstream_deepen`. **NEW2**: V12 추가 — compat result enum 무효값 reject. **NEW3**: producer⇄reviewer 3-fail cap (단일 cycle) + (flow_id, step_name) total fail 5회 누적 cap (reclassify 무한 loop 방지). **NEW4**: stale ED 2nd 재시도 fail 시 failure_origin=ground 또는 halt. **NEW5**: RETRY_EXHAUSTED는 Reflect 분류 abandoned. **NEW6**: Sub-flow Triage context inheritance 명시 — parent classification_metadata + caller_credentials + pre_approved 상속. **NEW7**: Review followup_flows dedup `(type, scope_hash)` 강제. **NEW8**: pre_approved scope 명시 flow type만 (default [release, migration]) — 보안 risk 최소화.
- **Trace-level 결함 처리 batch 2 (operational gaps + boundary + safety 정직 재명명).** Batch 1 이후 잔여 처리. **M3** stale ED mid-flow: source_version 비교 책임 명시 (Decide/Verify/Mid-flow 트리거). **M4** tool degrade vs escalate 모순 해소: pre-flow degrade(설정 차원)와 mid-flow escalate(invocation 차원) 분리. **M5** P0 + active flow overlap: orchestrator가 *Ground 진입 전* 해결, Ground는 preempted/suspended 잔재만 인지 (active≠null이면 mechanical error). **M7** Review flow follow-up: Decide(Record).followup_flows 필드, 자동 큐잉 (자동 실행은 아님). **M8** Release/Migration confirm gate에서 user 부재: CI/A2A에 pre_approved 필드, config.allow_pre_approval 정책. **M9** External auth A2A: caller credential payload, 없으면 external_inaccessible. **B1** Investigate 외부 리서치 boundary clarification: 외부 read = *해석 보조* (외부 검증), *프로젝트 내부 사실 캡처*는 Ground 책임. **O1** safety layer 정직 재명명: 7-layer 과장 → "Active Safety 4 (orchestrator/caps/reviewer/Verify) + Data Discipline 2 (provenance/freshness) + Learning 1 (Reflect)". Provenance/Freshness=audit, Reflect=post-hoc로 정직 분류. Codex와 내가 7 시나리오 trace-level 시뮬레이션 — 이전 conceptual 시뮬레이션이 못 잡은 실제 contract break 다수 발견. **TR1**: needs_clarification 후 Decide의 mode upgrade trigger가 halt 명령 override. Fix: Decide upgrade는 *result=proceed에만* 평가. blocked/needs_clarification/no_op에서는 Decide 자체 미실행. **TR2**: no_op + flow_type=Performance → Decide(Design) upgrade 강제 → "do nothing" architecture 출력. Fix: TR1과 동일 — halt이 mode upgrade 위. **TR3**: schema `?` notation YAML 유효하지만 typed consumer 거부. Fix: 산문 명세로 변경 (optional 필드는 "optional" 명시), strict schema는 future spec. Reflect 분류 명시 추가 (completed/abandoned/suspended). **TR4**: `entry_nodes > 5` rule 비교 모호. Fix: `entry_nodes.length > 5` 명시. **TR5**: disposition enum에 `partially_resolved` 추가 (codex T5에서 실제 발견 — 5 callers 해결 + 다른 peers 미상). sub_dispositions 필드 추가. clarification disposition은 *자동으로* compat issue 생성 (follow_up_ref 매핑) — 이중 메커니즘 해소. **TR6**: volatile_state flow-conditional 필드 schema 명시 — perf_baseline/dependency_audit/observability/release_state 각 구조. opaque artifact만 흐르던 이전 폐기. **C1**: Verify failure_origin enum `analyze|기획|spec|test|implement|report` → `triage|ground|investigate|decide|spec|test|implement|report`로 동기화. **C2**: DONE_WITH_CONCERNS 폐지 → RETRY_EXHAUSTED (halt). max iterations 후 silent proceed 대신 flow halt + escalate. **M1**: P0 depth precedence — flow_type=bugfix-p0이면 *모든 deepen trigger 무시*, shallow 강제. Verify PASS 후 post-stabilization follow-up flow 자동 큐잉. **TR7·M10**: Compound recursion contract 명시 — sub-flow self-execution (Triage 재진입 + 자체 G→I→D→Verify), gate criteria 4종 (proceed/pivot/abort/retry), state 추적 schema, completion predicate, failure propagation rule. Sub-flow N은 Investigate가 식별, Decide(Design)이 분해 — Triage 시점 결정 안 함 (M6 fix).
- **Decide step 신설 — Decision Ownership (universal).** Step Pool 9 → 9 (기획 → Decide로 일반화). 결함 #1 (결정 소유권 공백) 해결. 기존 기획은 *기획서 산출* 함의로 conditional 처리되어 Bug Fix / Chore / P0 / Release / Bug Fix Unreproducible flow에서 결정 owner 부재 → silent decision. **Decide는 모든 flow 필수**, 산출물 깊이는 mode로 차등: Record (1줄 결정+근거) / Plan (옵션 N개 비교+선택+우선순위) / Design (기획서: architecture+policy+userflow+req + emberdeck intent card). Mode = flow definition declared + situational upgrade (옵션 N≥2 발견 시 Record→Plan). Design mode만 intent card 자동 생성. **명명 근거 (codex)**: "기획"이 한국어로 *큰 산출물* 함의 → minimal flow에서 형식적 통과·skip 압력 유발. step 이름이 *책임 (ownership)*을 가리켜야 함. Naming은 control surface (agent 역할·산출물·review 기준 매개) — semantic noise 아님. **Triage Mismatch 처리**: Investigate가 surface하면 Decide가 reclassify trigger (orchestrator 신호) — Verify까지 안 가도 됨. Compound의 sub-flow 분해/순서는 top-level Decide(Design)에서, sub-flow별 자체 Decide는 자기 mode로 실행.
- Flow lifecycle rules added (start, suspend, resume, complete, abandon)
- Flow state persistence added (flow-state.yaml, list structure, archive)
- Execution protocol: orchestrator.ts (스크립트)가 루프 구동. A2A/CI는 전체 루프, 유저 세션은 PostToolUse 훅 구동
- Enforcement by consequence: dangerous→hook, role violation→allowed-tools, order→file dependency, conditional skip→hook gate, completion→Stop hook, quality→prompt+structure check, judgment→prompt only
- Design rationale documented: why each reference pattern was adopted or rejected
- Implementability verified against Claude Code capabilities: no nonexistent features assumed
- Design decisions 9-12 resolved: Reflect 3-tier distillation, non-impl completion criteria, worktree rollback, hook context detection
- Hook failure policy added: safety=fail-closed, enforcement=fail-open
- P0 retroactive test enforcement: scheduled trigger (mechanical) + SessionStart fallback (advisory)
- Gate policy storage location defined: `.blazewrit/config.yaml`
- Execution model changed: step = custom agent (not skill). Fresh context per step (`claude --agent X --print`), scoped mcpServers/hooks/permissionMode/maxTurns/isolation
- blazewrit identity: workflow rule set + thin script orchestrator. orchestrator.ts가 루프 구동, LLM은 각 스텝에서 작업만 수행
- Delivery form factor: bunx setup tool deploys rules + agents + orchestrator.ts + hooks + scripts + A2A server
- A2A integration: server.ts → orchestrator.ts run (풀자동). CancelTask → SIGTERM. NEEDS_CONTEXT → input-required
- Delivery: bunx setup tool (no runtime dependency), not npm install
- Context budget: rules (always loaded, concise) vs flows (on-demand read) split
- Flow definitions moved from .claude/rules/ to .blazewrit/flows/ (phase-aware context loading)
- Quality Assurance section: harness (7), context (7), prompt (10) — all with evidence level and source
- Step execution pattern: produce ⇄ review loop (Ralph Loop) for all steps except Verify and Reflect
- Step pool history: ~~8 (Analyze, 기획, ...)~~ → **9 (Ground, Investigate, Decide, Spec, Test, Implement, Report, Verify, Reflect)** (Analyze→Investigate 개명, 기획→Decide 일반화, Ground 신설)
- Agent count: **16 total = 9 producers + 7 reviewers** (Ground/Investigate/Decide 신규 producer + 그 reviewers, Spec/Test/Implement/Report/Verify/Reflect 기존 + 그 reviewers — Verify·Reflect는 no reviewer)
- Verify: mandatory on ALL 16 flows. Internal multi-pass. Failure routing to origin step
- Reflect: internal multi-pass (fact collection → pattern extraction → prior comparison)
- 기획: 기획서 = 통합문서 (서비스 architecture + 정책/비즈니스 룰 + 유저 플로우 + 요구사항). ideation은 기획의 하위 활동. roadmap 제거.
- Spec: 기획서에서 AC 추출 + 코드 architecture(디렉토리/파일 설계) + task 분해
- Analyze: Prepare 흡수. 전용 에이전트. Triage의 Implied/Ambiguous signal도 처리
- None state: 자유 대화/논의. ideation이 아닌 탐색적 대화. Signal 나오면 Flow 전환
- Known limitations: test quality, 기획 quality, Triage 분류 정확도, 유저 세션 훅 지시 따르기 — 스텝 순서/reviewer 실행은 더 이상 limitation 아님 (스크립트 보장)

## Reflect Detail

### 3-Tier Progressive Knowledge Distillation

Adopted from Ralph Loop's 3-tier pattern. ACE (arXiv 2510.04618) warns against "brevity bias" (removing domain insights for conciseness) and "context collapse" (detail erosion through iterative rewrites).

| Tier | Location | Content | Lifecycle |
|------|----------|---------|-----------|
| **Raw** | `.blazewrit/flow-history/<id>.yaml` | Full Reflect output: what_worked, what_failed, unexpected, patterns_discovered | Auto-archived on flow completion/abandonment |
| **Curated** | `.claude/rules/<topic>.md` | Patterns observed 3+ times across flows. Append-only updates — never rewrite existing content | Promoted from Tier 1 when pattern repeats. Pruned when contradicted by evidence |
| **Permanent** | CLAUDE.md (manual) | Battle-tested rules the user chooses to enshrine | User decision only. Reflect never writes here directly |

### Reflect Required Sections

Every Reflect output must contain (enforced by Reflect structure check hook):

1. **what_worked** — techniques, tools, approaches that succeeded
2. **what_failed** — what didn't work and why
3. **unexpected** — surprises, edge cases, assumptions proven wrong
4. **patterns_discovered** — recurring observations worth tracking

### Dedup Rule

Before writing to Tier 2 (`.claude/rules/`), Reflect searches existing rule files for the same pattern. If found: append new evidence to existing file. If not found: create new file. Never create duplicate rules.

## Non-Implementation Flow Completion Criteria

Flows without code output (Review, Retro, Exploration, Spike, 기획 standalone) complete when their terminal artifact exists and is substantive (GSD verifier Level 1 + Level 2: exists and not stub).

| Flow | Terminal artifact | Completion = |
|------|------------------|--------------|
| Review | `.blazewrit/reports/<flow-id>.md` | Report exists + every finding has severity tag |
| Retro | `.blazewrit/reports/<flow-id>.md` | Report exists + at least 1 action item |
| Exploration | `.blazewrit/reports/<flow-id>.md` | Report exists with content (no minimum structure) |
| Spike | `.blazewrit/reports/<flow-id>.md` | Report exists + feasibility verdict (GO / NO-GO / CONDITIONAL) |
| 기획 (standalone) | `.blazewrit/plans/<flow-id>-기획.md` | 기획서 exists + next step explicitly named |

## Rollback and Failure Recovery

### Worktree Isolation (High-Risk Flows)

High-risk flows (Feature, Migration, Refactor) run Implement in a git worktree. Verify checks the worktree. Merge to main only on Verify PASS. On failure, delete worktree — zero rollback cost, zero main branch contamination.

```
Feature/Migration/Refactor:
  Implement → runs in git worktree (Claude Code isolation: worktree)
    → Verify PASS → merge worktree to main
    → Verify FAIL → iteration++ (fix in same worktree)
    → iteration >= 3 with same approach → STOP, escalate
    → User chooses: different approach | fresh restart | abandon

Low-risk flows (Bug Fix, Chore, Test, Release):
  Implement → runs on main branch directly
    → Verify FAIL → git revert last commit, retry
    → 3 failures → BLOCKED, escalate
```

**Fresh restart option**: When stuck, starting over in a new worktree with fresh context is often better than debugging accumulated state (Devin insight, Ralph Loop pattern, Anthropic 4.6 best practice: fresh context > compaction).

### Escalation on Failure

| Failure count | Same approach? | Action |
|---------------|---------------|--------|
| 1-2 | Yes | Retry with fix |
| 3 | Yes | STOP — same approach exhausted (GSD deviation rule 4) |
| 1-2 | No (different approach) | Continue |
| 3 | No | BLOCKED — present options: fresh restart, user intervention, abandon |

## Remaining Work (Implementation Phase)

Full execution architecture in EXECUTION_PLAN.md. Below is the implementation checklist.

### Orchestrator
1. orchestrator.ts 구현 — 상태 머신, CLI (run/next/start/resume/abandon/reclassify/status/check-incomplete), claude 호출, gate 실행
2. flow-state.yaml 스키마 확정

### Step Agents + Reviewer Agents
3. **Producer agents (9)** — 신규: ground.md, investigate.md, decide.md (옛 analyze.md, 기획.md 폐기). 기존: spec.md, test.md, implement.md, report.md, verify.md, reflect.md. Custom agent frontmatter (tools, mcpServers, hooks, maxTurns, isolation) + prompt body (output contract, self-validation criteria, artifact format).
4. **Reviewer agents (7)** — 신규: ground-reviewer.md, investigate-reviewer.md, decide-reviewer.md (옛 analyze-reviewer.md, 기획-reviewer.md 폐기). 기존: spec-reviewer.md, test-reviewer.md, implement-reviewer.md, report-reviewer.md. Read-only tools, review criteria, structured feedback format.

### Orchestration Rules (유저 세션용)
5. orchestration.md (.claude/rules/blazewrit/) — Triage 호출 정책 (signal 감지 시 invoke, ambiguous 출력 시 user에 질문 후 재invoke, none 출력 시 자유 대화 유지) + Active flow 충돌 처리 (orchestrator/host LLM) + 훅 지시 따르기 규칙
6. enforcement.md (.claude/rules/blazewrit/) — deviation rules, gate policy, decision classification

### Flow Definitions
7. 16 flow definition files (.blazewrit/flows/) — step order, conditional steps, loop conditions, Verify failure routing

### Hooks + Scripts
8. .claude/settings.json — PostToolUse(Agent): orchestrator next, Stop: check-incomplete
9. 에이전트 내부 safety hooks: firebat scan, regression_guard, stuck detection
10. Hook wrapper scripts (fail-closed for safety)
11. A2A server.ts 구현

### Resolved Design Decisions
- ~~Execution model~~ → EXECUTION_PLAN.md (스크립트 오케스트레이터, 세션 모델, 아티팩트 모델, 채널별 구동, crash recovery)
- ~~Reflect detail~~ → See "Reflect Detail" section
- ~~Non-implementation flow completion criteria~~ → See "Non-Implementation Flow Completion Criteria" section
- ~~Rollback guidance~~ → See "Rollback and Failure Recovery" section
- ~~Hook context detection~~ → See "Hook Enforcement > Hook Context Detection"
