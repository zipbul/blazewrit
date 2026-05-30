# Reflect — Post-Flow Learning

## Definition

> **Reflect은 flow 종료 후 학습을 추출한다.** Internal multi-pass (reviewer 없음). `completed` + `abandoned`에서 실행, `suspended`에서는 미실행.

Reflect는 *학습 추출*만 한다. 결정 변경(Decide), 코드 변경(Implement), flow-level 검증(Verify), in-flow provenance 기록(Investigate/Ground)은 **하지 않는다** — Boundary 참조. 특히 Reflect는 섹션마다 산출물 인용(per-section artifact citation)을 **요구하지 않는다**: 그것은 cross-flow 학습에서 댈 수 없는 provenance이고 Investigate/Ground의 일이다 (P5: provenance over-reach 금지).

## Inputs

- 전체 flow 산출물 (Triage → ... → Verify) — Postgres `step_runs` rows. **단, abandoned flow에서는 downstream artifact가 결손일 수 있음** (Input Preconditions 참조).
- Verify 결과 (PASS / FAIL / RETRY_EXHAUSTED) — 코드 flow일 때만 존재.
- flow termination classification: `completed | abandoned | suspended` (orchestrator가 주입 — Input Preconditions 참조).
- `.claude/rules/<topic>.md` (Tier 2 curated) + 직전 flow들의 Tier 1 raw (prior runs). **첫-ever 실행 시 prior history는 빔** (Cold-Start 참조).

## Input Preconditions (garbage-in 견고성 — P8)

> 횡단 input-precondition 절. Reflect는 upstream을 *맹신하지 않는다*: 필수 입력의 **존재 + 정형**을 assert한다(진실성 검사는 아님 — 그건 Verify의 일). 결손/기형은 *조용히 빈 학습으로 통과시키지 않고* escalate한다 (principle 3: "정당하게 빔" vs "결손/기형" 구분).

1. **Termination classification 신뢰 검사 (P8)**: orchestrator가 주입하는 `completion_status` ∈ `{completed, abandoned, suspended}` 인지 assert. 값이 없거나 enum 밖이면 → **mechanical error → escalate** (`failure_origin=verify`, reason=`reflect_precondition: missing/invalid completion_status`). Reflect는 *추정으로 분류를 만들어내지 않는다* (principle 2: control-signal ownership — Reflect는 자기 trigger 조건을 발명하지 않음).

2. **suspended 즉시 종료**: `completion_status = suspended` (NEEDS_CONTEXT / active flow preempted) → Reflect **미실행**, terminal `result = skipped_suspended` 반환. (resume 시 flow가 재분류되어 다시 Reflect 진입 후보가 됨.)

3. **flow-identity 정형 검사**: `(flow_id, flow_type)` 존재 + 정형 assert. 결손/기형 → mechanical error → escalate (위와 동일 경로).

4. **abandoned에서의 downstream 결손은 *정상* (principle 3 — "정당하게 빔")**: `completion_status = abandoned`인 flow는 Decide/Spec/Test/Implement/Verify가 *원래 실행 안 됐을 수 있다* (blocked / no_op / user abandonment / RETRY_EXHAUSTED). 따라서 abandoned flow에서 downstream artifact 부재는 **결손이 아니라 합법적 상태** — escalate 하지 않고 `available_artifacts`로 *있는 만큼만* fact 수집(Pass 1 degrade 참조). 반대로 `completion_status = completed`인데 어떤 step row가 *기형*(존재 표시 + 내용 malformed)이면 그건 결손 → mechanical error → escalate.

> escalate ping-pong은 기존 `(flow_id, step)` **5-누적-fail halt cap** (decide/failure-routing.md)이 bound한다 — input-precondition escalate가 무한 루프를 만들지 않는다.

## Internal Multi-Pass

```
Pass 1: Fact collection — 각 step에서 무엇이 일어났고 결과가 무엇인가
        (abandoned면 available_artifacts만 — 없는 step은 "did_not_run"으로 기록, 결손 아님)
Pass 2: Pattern extraction — 반복 테마, 의외, 무엇이 통하고 실패했나
Pass 3: Prior learning comparison — Tier 1 raw + Tier 2 rules 읽고 과거와 비교
        (prior history 빔 → Cold-Start 분기, escalate 아님)
→ max 3 iterations: 4 required 섹션이 모두 substance floor를 통과할 때까지
  3회 후에도 미통과 → cap-exhaustion terminal state (아래 참조), silent pass 금지
```

### Pass 1 degrade — abandoned flow의 부분 artifact (principle 3)

abandoned flow에서 일부 step이 실행 안 됐으면, Pass 1은 *없는 사실을 지어내지 않고* 각 step을 `ran | did_not_run` 로 표기한다. `did_not_run`은 학습 가치가 있는 *사실*이다 (예: "blocked at Investigate → Decide 미진입"). 이건 결손 escalate가 아니라 *정당하게 빈* 입력의 정상 처리다.

### Pass 3 Cold-Start — 빈 flow-history (degenerate no-history)

첫-ever 실행(또는 해당 topic에 prior rule 없음): Pass 3의 "과거와 비교"는 **no-op이 아니라 baseline 수립**으로 정의된다 (principle 3: 빈 history는 *합법적 결과*지 결손이 아님).

- prior Tier 1 raw 0건 AND 매칭 Tier 2 rule 0건 → Pass 3는 `prior_comparison = cold_start` 표기, 비교 섹션을 "no prior baseline — this run establishes baseline"으로 채움.
- patterns_discovered는 여전히 *이번 flow 내부* 관찰로 채워질 수 있음 (cross-flow 반복 카운트만 1에서 시작 — Tier 2 Promotion 참조).
- Cold-start는 substance floor를 *면제하지 않는다*: 4 섹션은 여전히 비-filler여야 함 (없는 비교 대신 "baseline 수립" 명시가 substance).
- Cold-start는 **escalate가 아니다** — prior history 부재는 도구/upstream 결손이 아니라 시간순 첫 실행의 정상 상태.

## Required Sections (구조 강제 — P5)

모든 Reflect 출력은 다음 **4 섹션 전부**를 포함해야 한다. Reflect structure check hook이 **4개 모두**를 검사한다 (P5: 3→4 교정 — 기존 hook은 `what_worked/what_failed/patterns` 3개만, 게다가 이름 불일치 `patterns` vs `patterns_discovered`로 검사했음. 이제 4개 canonical 이름 전부 검사):

1. **what_worked** — 성공한 기법·도구·접근
2. **what_failed** — 무엇이 안 통했고 왜
3. **unexpected** — 의외, 엣지 케이스, 틀린 것으로 판명된 가정
4. **patterns_discovered** — 추적할 가치 있는 반복 관찰

## Structure Check Hook + Substance Floor (P5 — "substantive" 정직 강등)

> **정직한 강등 (P5)**: 원본은 "structure hook(4섹션) + distillation + append-only가 *품질을 보장*"이라 주장했으나, 그 어느 것도 substance를 측정하지 않았다(hook=존재, distillation=반복 횟수, append-only=쓰기 모드). 여기서는 hook이 *실제로 무엇을 deliver하는지*만 주장한다 — 그 이상은 환원불가 LLM 판단으로 정직하게 남긴다.

Hook(`hookReflectStructure`, Stop / PostToolUse(Write) on instruction files)이 **mechanical하게 강제**하는 것 (P5: warn-only → blocking-enough 교정):

1. **4-섹션 존재 (blocking)**: `what_worked, what_failed, unexpected, patterns_discovered` 4개 key 모두 present. 하나라도 누락 → **block** (warn-only 아님 — 누락 Reflect는 통과 못 함).
2. **Substance floor — non-filler/non-empty (blocking)**: 각 섹션이 *기계적으로 검출 가능한 hollow*가 아닌지 검사:
   - 비-공백 minLength (placeholder 길이 미만 거부),
   - filler/stub 토큰 거부 (예: "N/A", "none", "TODO", "tbd", "...", 빈 bullet, section 헤더만) — 단, 의미 있는 부정(예: what_failed = "no failures: all steps passed first try" + 근거)은 *통과*. 구분: filler는 *내용 없는 자리표시*, 합법적 부정은 *근거 있는 사실*.
   - cold-start 면제 없음 (위 참조).

Hook이 **강제 못 하는 것 (정직한 floor)**: 섹션이 *진실하고 통찰 있는지*. 그건 환원불가 LLM 판단이다 (HARNESS_FLOW_REVIEW G6 residual: "promotion-count 판단"·통찰 진실성). Reflect는 reviewer가 없으므로 — 이 한계를 *숨기지 않고* 명시한다. substance floor는 hollow를 *기계적으로 막을 수 있는 만큼* 막고, 그 위는 보장하지 않는다 (P5: substantive 보증을 hook이 실제 deliver하는 것으로 강등).

### Cap-Exhaustion Terminal State (P5 — cap 소진 미정의 닫음)

`max 3 iterations` 후에도 substance floor를 통과하지 못하면 (예: 3회 모두 어떤 섹션이 filler) — **silent pass 금지** (원본은 여기를 침묵 → hollow Reflect가 그냥 통과했음):

- terminal `result = reflect_incomplete` 반환 + `incomplete_details: { failing_sections: [...], iterations_used: 3, reason }`.
- 이는 Verify의 RETRY_EXHAUSTED와 *유사한 cap-halt* (decide/failure-routing.md의 cap 패턴 재사용 — 새 메커니즘 발명 아님): Reflect는 학습을 *위조하지 않고* "추출 실패"를 명시적 terminal로 보고.
- Tier 1 raw는 *있는 만큼* archive (부분 학습 보존), 단 status=`incomplete`로 태그 → Tier 2 promotion 후보에서 제외 (filler가 rule로 승격되는 것 방지).
- escalate는 *아님* — Reflect는 flow를 routing하지 않는다 (Boundary). `reflect_incomplete`는 학습 추출 자체의 verdict이지 upstream 결손 신호가 아님. orchestrator는 이를 기록만 하고 flow를 이미 종료된 상태로 둔다.

## Result Enum & Branches (P1 — 성공/주요 출력 명시 선언)

> Investigate의 `compatibility_verdict.result` 패턴(discriminated enum + per-result 라우팅 테이블)을 재사용하여 **success 분기를 failure 분기와 *같은 방식으로* 선언**한다 (P1: 성공 출력 미정의 닫음 — 새 enum 척도 발명 아님).

```
reflect_result:
  result: completed_reflection | reflect_incomplete | skipped_suspended | precondition_escalated
  flow_ref                                  # 어느 flow의 reflection인가
  completion_status_in: completed | abandoned   # 입력 분류 (suspended는 skipped로 빠짐)
  sections: { what_worked, what_failed, unexpected, patterns_discovered }   # completed_reflection일 때 4개 substance-pass
  prior_comparison: compared | cold_start       # Pass 3 결과
  tier1_archived_ref?                        # Tier 1 raw row id (Postgres)
  tier2_writes?: [ { topic, action: append | create, rule_ref } ]   # Dedup/Promotion 결과
  incomplete_details?: { failing_sections, iterations_used, reason }   # result=reflect_incomplete일 때 필수
  escalate?: { failure_origin, reason }      # result=precondition_escalated일 때 필수
```

| result | 의미 | Orchestrator 처리 |
|---|---|---|
| `completed_reflection` | 4 섹션 substance-pass, 학습 추출 + Tier archive 완료 (P1: success 분기) | flow `reflect_completed=true` 마킹. Tier 1 archive, Tier 2 dedup/promote 반영 |
| `reflect_incomplete` | cap 3 소진, substance floor 미통과 (Cap-Exhaustion) | 기록만 — 부분 raw는 status=incomplete로 archive, Tier 2 승격 제외. flow는 이미 종료 상태 유지 |
| `skipped_suspended` | `completion_status=suspended` → Reflect 미실행 (precondition 2) | no-op. resume 시 재분류 |
| `precondition_escalated` | input precondition 결손/기형 (P8) | `failure_origin=verify`로 escalate. 5-누적 halt cap이 bound |

## 3-Tier Progressive Knowledge Distillation

Ralph Loop 채택. ACE (arXiv 2510.04618)의 "brevity bias"·"context collapse" 경고 반영.

| Tier | Location | Content | Lifecycle |
|------|----------|---------|-----------|
| **Raw** | Postgres `flow-history` row (`flow_id`) | 전체 Reflect 출력 | flow completion/abandonment 시 auto-archive (incomplete면 status 태그) |
| **Curated** | `.claude/rules/<topic>.md` | Tier 1에서 **3+ flow에 걸쳐** 관찰된 pattern. **append-only 본문 + 별도 status 헤더** (아래 lifecycle 참조) | pattern 반복 시 Tier 1에서 promote |
| **Permanent** | CLAUDE.md (manual) | user가 enshrine 선택한 battle-tested rule | user 결정만. Reflect는 여기 write 안 함 |

> §5 저장 모델: workflow 산출물은 Postgres. *유일* 파일 예외 = Tier 2 `.claude/rules/*.md` (Claude Code가 읽는 학습 입력이라서). Tier 1 raw는 *파일 아님* — Postgres row.

### Same-Pattern 매칭 기준 (Tier 2 카운트 + Dedup 공유 — 닫음)

> 원본은 promotion threshold("3+ times")와 Dedup("동일 패턴 검색") 둘 다 "same pattern"을 *정의 없이* 공유했다. 여기서 단일 정의로 닫는다 — promotion 카운트와 dedup이 *같은* 매칭 기준을 쓴다.

**pattern_key** = `(normalized_pattern_statement_hash, topic)`.
- `normalized_pattern_statement` = patterns_discovered 항목의 핵심 주장을 소문자·공백정규화·stopword 제거한 정규형.
- 두 pattern이 *동일*하다 = 같은 `pattern_key` (같은 topic + 같은 정규형 hash). 이게 promotion 카운트 단위이자 dedup 매칭 단위 — **하나의 정의**.

### Tier 2 Promotion — "3+ across flows" 카운팅/증가 규칙 (닫음)

> 원본은 "3+ flow에 걸쳐 관찰"이 *어떻게 카운트·증가*되는지 침묵했다. 여기서 명시한다.

- Tier 2 rule 파일 각각은 **append-only evidence ledger**를 가진다: 매 evidence = `{ flow_id, observed_at, fact_ref }`.
- **occurrence count = ledger의 *distinct flow_id* 개수** (같은 flow 내 중복 관찰은 1로 셈 — cross-flow 반복이 기준).
- 매 Reflect 실행에서 patterns_discovered 각 항목에 대해:
  1. `pattern_key`로 기존 Tier 2 rule 검색 (Dedup과 동일 매칭).
  2. **Found** → 그 rule의 ledger에 이 flow의 evidence append (distinct flow_id 1 증가). count가 3에 *처음 도달*하면 rule을 `status: active` 로 마킹 (그 전엔 `status: candidate`).
  3. **Not found** → 새 rule 파일 생성, ledger에 첫 evidence(count=1), `status: candidate`.
- 즉 "3+"는 *distinct flow_id 3개 이상이 ledger에 누적*되었을 때 충족. 카운트는 파일 자체(append-only ledger)가 보유 — 별도 state subsystem 발명 아님 (기존 파일 재사용).
- **promotion이 곧 dedup**: 같은 pattern은 새 파일을 만들지 않고 기존 ledger에 누적 → "Never create duplicate rules" 충족.

### Tier 2 Lifecycle — "Append-only" vs "Pruned when contradicted" 모순 해소 (닫음)

> 원본은 "Append-only — never rewrite" 와 "Pruned when contradicted" 를 *동시에* 주장하며 누가/언제/무엇이 "contradicted"인지 정의 안 함 — 직접 모순. 여기서 해소한다. **핵심: 본문 evidence는 append-only로 유지하고, "prune"은 본문 삭제가 아니라 status 전이다** (append-only 위배 없음).

- **본문(evidence ledger)은 영구 append-only — never rewrite, never delete.** 과거 evidence는 지워지지 않는다 (context collapse 방지).
- **"contradicted"의 정의**: *후속* flow의 Reflect가 같은 `pattern_key`에 대해 **반대 결과를 사실로 기록**한 경우 (예: rule="X always works" 인데 후속 flow에서 X가 실패하고 그 실패가 Verify 결과로 *확정*됨). contradiction은 *새 evidence 항목*(`outcome: contradicting`)으로 ledger에 **append**된다 — 기존 항목 삭제 아님.
- **"prune"의 정의 (재정의)**: 본문 삭제가 *아니라* rule의 status 헤더를 전이하는 것:
  - supporting distinct-flow ≥ 3 AND contradicting distinct-flow = 0 → `status: active`
  - contradicting evidence 1+ 누적 → `status: deprecated` (rule은 *남되* "더 이상 신뢰 말 것" 표시)
  - Claude Code가 `.claude/rules`를 읽을 때 `status: deprecated`/`candidate`는 *권고 아님* (active만 권고). 이게 "pruned"의 실효 — **물리 삭제 없이 효력 제거**.
- **누가**: Reflect (후속 flow의). Verify/Decide가 아니다. Reflect는 *자기 학습 기록*만 한다 — rule이 "틀렸다"고 *판정*하지 않고, 후속 flow의 *Verify-확정된 사실*을 evidence로 옮길 뿐 (principle: stay-in-lane — `missed` 항목 교정: "contradicted 판정"이 Verify/Decide-류 적부 판정으로 새지 않도록, Reflect는 *새 사실의 기록자*이지 *rule의 심판*이 아님. 판정 입력은 후속 flow의 Verify 결과다).
- **언제**: 후속 flow의 Reflect Pass 3 (prior comparison) — 새 flow 결과가 기존 rule과 충돌하는 사실을 발견했을 때.

### Dedup Rule

Tier 2 (`.claude/rules/`) write 전, Reflect는 `pattern_key`로 기존 rule 검색:
- Found → 기존 파일 ledger에 evidence append (Promotion 규칙과 동일 경로)
- Not found → 새 파일 생성

Never create duplicate rules. (매칭 기준 = Same-Pattern 매칭, 위 단일 정의.)

### Tier 2 Write 경합/실패 처리 (file contention — P8 적용)

`.claude/rules/<topic>.md`는 *유일한 파일 산출물*이라 동시 flow에서 경합·부분 쓰기 가능. 처리:

- write는 **append-or-create를 단일 원자 연산**으로 (file lock / append-mode O_APPEND). 부분 쓰기 방지.
- write 충돌(lock 획득 실패/IO error) → Reflect는 학습을 *잃지 않는다*: Tier 1 raw에 `tier2_write_pending: { topic, pattern_key }` 기록 + Reflect `result=completed_reflection` 유지하되 `tier2_writes[].action`에 `deferred` 표기. (Reflect의 *primary* 산출은 학습 추출이고 Tier 1 archive다 — Tier 2 write는 *enhancement*. principle 1: enhancement 실패는 escalate가 아니라 degraded branch.) orchestrator가 Tier 1의 pending을 다음 idle에 재시도.
- 즉 Tier 2 write 실패는 mechanical error escalate가 *아님* — Tier 1에 학습이 보존되므로 degraded(deferred) 처리. (principle 1: Tier 2 file write = enhancement 도구 역할 → degraded; Postgres Tier 1 archive = primary → 그게 실패하면 그건 escalate.)

## Reflect 분류 (입력 분류 — P8 precondition으로 신뢰됨)

| 분류 | 조건 | Reflect 실행 |
|---|---|---|
| `completed` | 모든 step 정상 종료 | ✓ |
| `abandoned` | blocked / no_op / user abandonment / RETRY_EXHAUSTED | ✓ (downstream 결손은 *정당하게 빔* — Pass 1 degrade) |
| `suspended` | NEEDS_CONTEXT 또는 active flow preempted | ✗ (`skipped_suspended`) |

> 이 분류는 orchestrator가 주입한다. Reflect는 이를 **신뢰하되 정형 검사**한다 (P8: Input Precondition 1·2). enum 밖/결손이면 추정으로 메우지 않고 escalate — Reflect는 자기 trigger를 발명하지 않는다.

## No Reviewer (정직한 한계 — P5)

Reflect는 별도 reviewer가 없다. *대신* 보장하는 것:
- **structure check hook**: 4-섹션 존재 + substance floor(non-filler/non-empty) — **blocking** (warn-only 아님). hollow를 *기계적으로 검출 가능한 만큼* 차단.
- **3-tier distillation**: 반복(distinct-flow count)으로 신호/노이즈 분리.
- **append-only ledger + status 전이**: context collapse 방지.

**보장하지 *못하는* 것 (정직)**: 섹션의 *진실성·통찰 깊이*. reviewer 없는 step이므로 이는 환원불가 LLM 판단으로 남는다 (HARNESS_FLOW_REVIEW residual). 원본의 "substantive 품질 보장" 주장은 hook이 실제 deliver하는 *구조+non-filler floor*로 정직하게 강등됐다 (P5). 이 step의 핵심 claim은 *hollow의 기계적 차단*이지 *통찰의 보장*이 아니다.

## Failure & Degrade Handling

| 상황 | 처리 | 근거 |
|---|---|---|
| `completion_status` 결손/enum-밖 | mechanical error → `failure_origin=verify` escalate | P8 / principle 3 (결손) |
| `(flow_id, flow_type)` 결손/기형 | mechanical error → escalate | P8 |
| `completed`인데 step row malformed | mechanical error → escalate | principle 3 (기형) |
| `abandoned` + downstream did_not_run | 정상 — `did_not_run` fact로 기록, escalate 아님 | principle 3 (정당하게 빔) / Pass 1 degrade |
| prior history 빔 (첫 실행) | `cold_start` — baseline 수립, escalate 아님 | principle 3 (빈=합법) |
| 3 iter 후 substance 미통과 | `reflect_incomplete` terminal — 부분 archive(incomplete 태그), Tier 2 제외 | P5 cap-exhaustion |
| Tier 2 file write 충돌/IO 실패 | degraded — Tier 1에 pending 기록, `deferred` 표기, escalate 아님 | principle 1 (Tier2=enhancement) |
| Tier 1 (Postgres) archive 실패 | mechanical error → escalate | principle 1 (Tier1 archive=primary) |

> Reflect는 *flow를 routing하지 않는다* — `request_upstream_deepen`를 emit하지 않는다 (principle 2: Decide 전용). precondition escalate는 기존 `failure_origin` 경로로만 가고, 5-누적-fail halt cap이 ping-pong을 bound한다.

## Boundary

| 항목 | 책임 |
|---|---|
| 결정 변경 | Decide (Reflect은 학습만, 결정 안 함) |
| 코드 변경 | Implement |
| Flow-level 검증·routing | Verify (Reflect은 escalate-신호만, follow-up flow 큐잉 안 함) |
| In-flow provenance 기록 / 섹션별 artifact 인용 | Investigate / Ground (Reflect은 강제 인용 안 함 — P5 over-reach 금지) |
| rule "틀림" 적부 판정 | 후속 flow의 Verify (Reflect은 그 *결과를 evidence로 기록*만, 심판 아님 — `missed` 교정) |
| CLAUDE.md 직접 write | User (Reflect은 Tier 2까지만) |

## Depth

Reflect는 항상 실행되는(`completed`/`abandoned`) shallow-by-default step이다. mechanical trigger(예: substance floor 재실패 → iteration)에서만 deepen. cap 3 (Adaptive Step Depth Policy 정합). cap 소진 = `reflect_incomplete` terminal.
