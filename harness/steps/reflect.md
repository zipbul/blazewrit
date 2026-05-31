# Reflect — Post-Flow Learning

## Definition

> **Reflect은 flow 종료 후 학습을 추출한다.** Internal multi-pass (reviewer 없음). `completed` + `abandoned`에서 실행, `suspended`에서는 미실행.

Reflect는 *학습 추출*만 한다. 결정 변경(Decide), 코드 변경(Implement), flow-level 검증(Verify), in-flow provenance 기록(Investigate/Ground)은 **하지 않는다** — Boundary 참조. 특히 Reflect는 섹션마다 *cross-flow 산출물 인용*(per-section artifact citation = 어느 flow의 어느 row가 이 학습의 근거인가)을 **요구하지 않는다**: 그것은 cross-flow 학습에서 댈 수 없는 provenance이고 Investigate/Ground의 일이다 (P5: provenance over-reach 금지).

> **`source_tool`은 이 금지와 별개다 (R26 floor)**: 각 Finding/DiscoveredPattern은 `source_tool`(= *이 관찰을 surface한 도구* — observation-origin)을 **필수로 가진다**. 이건 위에서 금지한 "per-section cross-flow artifact citation"과 *구분되는* 것이다 — source_tool은 *어느 도구가 이 사실을 드러냈나*(현재 flow 내 관찰의 출처)이지, *어느 flow의 어느 row가 근거인가*(cross-flow provenance)가 아니다. 전자는 R26 floor로 강제(학습이 unsourced가 되지 않게), 후자는 over-reach로 금지. (선택적 `step_ref`는 finding을 특정 step_runs row에 핀할 수 있으나 *optional* — 강제 인용 아님.)

## Inputs

- 전체 flow 산출물 (Triage → ... → Verify) — Postgres `step_runs` rows. **단, abandoned flow에서는 downstream artifact가 결손일 수 있음** (Input Preconditions 참조).
- Verify 결과 (PASS / FAIL / RETRY_EXHAUSTED) — 코드 flow일 때만 존재.
- flow termination classification: `completed | abandoned | suspended` (orchestrator가 주입 — Input Preconditions 참조).
- `.claude/rules/<topic>.md` (Tier 2 curated) + 직전 flow들의 Tier 1 raw (prior runs). **첫-ever 실행 시 prior history는 빔** (Cold-Start 참조).

## Input Preconditions (garbage-in 견고성 — P8)

> 횡단 input-precondition 절. Reflect는 upstream을 *맹신하지 않는다*: 필수 입력의 **존재 + 정형**을 assert한다(진실성 검사는 아님 — 그건 Verify의 일). 결손/기형은 *조용히 빈 학습으로 통과시키지 않고* escalate한다 (principle 3: "정당하게 빔" vs "결손/기형" 구분).

1. **Termination classification 신뢰 검사 (P8)**: orchestrator가 주입하는 `completion_status` ∈ `{completed, abandoned, suspended}` 인지 assert. 값이 없거나 enum 밖이면 → **mechanical error → `result=precondition_escalated`** (`escalate={failure_origin=cap_exceeded, reason=`reflect_precondition: missing/invalid completion_status`}` — post-flow halt origin, Result Enum 참조). Reflect는 *추정으로 분류를 만들어내지 않는다* (principle 2: control-signal ownership — Reflect는 자기 trigger 조건을 발명하지 않음).

2. **suspended 즉시 종료**: `completion_status = suspended` (NEEDS_CONTEXT / active flow preempted) → Reflect **미실행**, terminal `result = skipped_suspended` 반환. (resume 시 flow가 재분류되어 다시 Reflect 진입 후보가 됨.)

3. **flow-identity 정형 검사**: `(flow_id, flow_type)` 존재 + 정형 assert. 결손/기형 → mechanical error → `result=precondition_escalated` (위와 동일 경로 — `failure_origin=cap_exceeded`).

4. **abandoned에서의 downstream 결손은 *정상* (principle 3 — "정당하게 빔")**: `completion_status = abandoned`인 flow는 Decide/Spec/Test/Implement/Verify가 *원래 실행 안 됐을 수 있다* (blocked / no_op / user abandonment / RETRY_EXHAUSTED). 따라서 abandoned flow에서 downstream artifact 부재는 **결손이 아니라 합법적 상태** — escalate 하지 않고 `available_artifacts`로 *있는 만큼만* fact 수집(Pass 1 degrade 참조). 반대로 `completion_status = completed`인데 어떤 step row가 *기형*(존재 표시 + 내용 malformed)이면 그건 결손 → mechanical error → escalate.

> escalate ping-pong은 **구조적으로 발생하지 않는다**: Reflect는 flow *종료 후* 실행되어 in-flow producer⇄reviewer / reclassify 루프에 진입하지 않으므로 `(flow_id, step)` 5-누적-fail halt cap(decide/failure-routing.md, in-flow 루프 전용)은 *이 step에 적용되지 않는다 — 의존하지 않는다*. 대신 escalate는 `failure_origin=cap_exceeded`(= halt origin, **NO auto-reinvoke** — `_defs.schema.json` FailureOrigin)로 나가고, orchestrator는 이를 기록만 하며 종료된 flow를 재개하거나 Reflect를 재큐잉하지 않는다. 재invoke가 없으니 무한 루프를 만들 경로 자체가 없다 (cap이 아니라 *re-entry 부재*가 bound).

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

- prior Tier 1 raw 0건 AND 매칭 Tier 2 rule 0건 → Pass 3는 `prior_learning_comparison`을 **`cold_start` branch**(`{ status: cold_start, baseline_statement }`)로 표기, `baseline_statement`를 "no prior baseline — this run establishes baseline"으로 채움. (`prior_learning_comparison`은 3-branch oneOf: `measured` = priors 비교됨 / `cold_start` = prior history 없음(첫 실행, 합법적 baseline 수립) / `Omitted` = prior-run 쿼리 *자체가* 실패/timeout한 *도구 결손*. cold_start는 Omitted가 *아니다* — 도구 실패가 아니라 시간순 첫 실행의 정상 상태이므로 별도 branch로 구분한다.)
- patterns_discovered는 여전히 *이번 flow 내부* 관찰로 채워질 수 있음 (cross-flow 반복 카운트만 1에서 시작 — Tier 2 Promotion 참조). **cold_start에서도 `occurrence_count`는 backed CountClaim이어야 한다 (R23)**: count=1 baseline조차 bare integer가 아니라 source(예: prior-run 쿼리가 0/1 distinct flow를 반환한 command + `raw_stdout_sha256`)를 carry해야 한다. cold_start는 prior history *부재*의 정상 상태일 뿐, count의 provenance 요구를 면제하지 않는다 (schema가 강제하는 R23 invariant).
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
- Tier 1 raw는 *있는 만큼* archive (부분 학습 보존), 단 status=`incomplete`로 태그 → Tier 2 promotion 후보에서 제외 (filler가 rule로 승격되는 것 방지). **부분 보존의 schema 표현**: substance floor를 통과한 섹션만 그 섹션 필드에 emit되고, *실패한 섹션은 비거나 filler 배열로 emit되지 않고 아예 OMIT된다* (schema는 hollow/empty 섹션을 표현할 수 없다 — `ReflectionSection`은 `minItems:1` + Finding `minLength:24`이라 빈/자리표시 배열을 emit할 수 없으므로, 실패 섹션은 생략이 유일한 표현이고 `incomplete_details.failing_sections`가 *어느 섹션이 생략됐는지*를 명명한다). 즉 reflect_incomplete에서 4 섹션은 unconditionally-required가 아니며, 통과한 만큼만 present.
- escalate는 *아님* — Reflect는 flow를 routing하지 않는다 (Boundary). `reflect_incomplete`는 학습 추출 자체의 verdict이지 upstream 결손 신호가 아님. orchestrator는 이를 기록만 하고 flow를 이미 종료된 상태로 둔다.

## Result Enum & Branches (P1 — 성공/주요 출력 명시 선언)

> Investigate의 `compatibility_verdict.result` 패턴(discriminated enum + per-result 라우팅 테이블)을 재사용하여 **success 분기를 failure 분기와 *같은 방식으로* 선언**한다 (P1: 성공 출력 미정의 닫음 — 새 enum 척도 발명 아님).

> 필드명은 schema(`reflect.schema.json`)와 1:1로 정렬한다. 4 섹션(what_worked/what_failed/unexpected/patterns_discovered)은 `sections` wrapper에 중첩되지 *않고* **top-level 필드**이며, 각 섹션은 *findings의 배열*(Finding = `{ text, source_tool, step_ref? }` — provenance-bearing list)이다. `patterns_discovered`도 top-level 배열(DiscoveredPattern). Tier 1 raw가 persist되는 row는 `self_ref`(이 Reflect 출력 자신의 step_runs row id = Tier 1 archived row)이고, 어느 flow의 reflection인지는 `based_on.flow_ref`다 (별도 `tier1_archived_ref`/`flow_ref` 없음).

```
# top-level reflect 출력 (schema reflect.schema.json)
  step: reflect
  result: completed_reflection | reflect_incomplete | precondition_escalated | archive_escalated
                                              # P1 discriminant. skipped_suspended는 *emit 안 됨* — suspended는 Reflect 미실행이라 이 structured_output을 내지 않음 (orchestrator-internal 신호, 아래 참조)
  self_ref                                    # 이 출력이 persist되는 step_runs row = Tier 1 archived raw row
  classification: completed | abandoned       # 입력 분류 (suspended는 Reflect 미실행 → 이 enum에 없음)
  based_on: { flow_ref, step_refs[], verify_result? }   # flow_ref=어느 flow, step_refs=Triage..Verify row들, verify_result=PASS|FAIL|RETRY_EXHAUSTED (코드 flow일 때만)
  # --- completed_reflection일 때 필수 (substance-pass) ---
  what_worked: [ Finding ]                    # 각 Finding = { text, source_tool, step_ref? }
  what_failed: [ Finding ]
  unexpected: [ Finding ]
  patterns_discovered: [ DiscoveredPattern ]  # { text, occurrence_count(CountClaim), promotion_eligible, source_tool }
  prior_learning_comparison: measured | cold_start | Omitted   # Pass 3 결과 (3-branch oneOf, 아래 Cold-Start 참조)
  tier2_promotions: [ { write_mode: append|create|deferred, topic, pattern_ref, rules_file?, occurrence_count?, deduped_against?, deferred_reason? } ]
                                              # Dedup/Promotion 결과. deferred = Tier 2 write 경합/IO 실패 → Tier 1 pending 보존(primary 학습 보존), rules_file 없음 + deferred_reason 필수 (아래 write 경합 처리)
  iterations: 1..3                            # internal multi-pass 횟수
  unverified?                                 # R13 floor (KEEP polarity, 아래 참조)
  # --- result=reflect_incomplete일 때 필수 ---
  incomplete_details?: { failing_sections[], iterations_used, reason }
  # --- result ∈ {precondition_escalated, archive_escalated}일 때 필수 ---
  escalate?: { failure_origin: cap_exceeded, reason }   # post-flow halt origin (아래 참조)
```

> **`skipped_suspended`는 schema-emitted 값이 아니다**: `completion_status=suspended`면 Reflect는 *실행되지 않고* structured_output을 내지 않는다(Input Precondition 2). 따라서 suspended-skip은 orchestrator-internal control 신호이지 `result` enum에 emit되는 값이 아니다. 이 출력의 `result` enum은 실제 emit되는 4개 값 `{completed_reflection, reflect_incomplete, precondition_escalated, archive_escalated}`만 담는다.

> **`unverified` (R13 floor, KEEP polarity)**: Reflect 출력은 자신의 학습 중 일부가 미검증임을 표시하는 optional `unverified` flag를 carry할 수 있다 — *forbidden true 아님*, propagate된다. Reflect는 unverified gate가 *아니다*(Verify가 gate). Reflect는 기록만 한다.

> **Post-flow escalate channel = `failure_origin=cap_exceeded` (verify 아님)**: Reflect는 flow *종료 후* 실행되므로 in-flow producer⇄reviewer / reclassify 루프에 들어가지 않는다. 따라서 in-flow 의미를 가진 `failure_origin=verify`(= Verify self-misjudgment, FailureOrigin enum, `_defs.schema.json`)를 빌려 쓰지 않는다 — 그건 Verify-owned 값이고 의미도 맞지 않는다. 대신 canonical FailureOrigin enum의 **`cap_exceeded`**(= "global flow caps blown, halt+escalate, NO auto-reinvoke" — orchestrator-level halt origin)를 재사용한다. `cap_exceeded`는 정의상 *자동 재invoke 안 하는* halt 신호라, 이미 종료된 flow를 다시 열거나 Reflect를 재큐잉하지 않는다 — 즉 **루프 자체가 구조적으로 없으므로 bound할 카운터가 필요 없다** (in-flow 5-누적 cap에 의존하지 않음). orchestrator 처리: escalate를 기록하고 종료된 flow를 그대로 둔다. (새 enum 값 발명 아님 — 기존 `cap_exceeded` 재사용. Reflect는 FailureOrigin enum에 자기 step 값을 추가하지 않는다 — Boundary: routing 비소유.)

> 아래 표의 위 4개 행은 schema가 **emit하는 `result` enum 값**이다. 마지막 행 `skipped_suspended`는 *emit되지 않는* orchestrator-internal disposition이다(suspended면 Reflect가 실행 자체를 안 하므로 structured_output이 없음) — `result` enum 밖이며, 완전성을 위해 표시한다.

| result (emit) | 의미 | Orchestrator 처리 |
|---|---|---|
| `completed_reflection` | 4 섹션 substance-pass, 학습 추출 + Tier archive 완료 (P1: success 분기) | flow `reflect_completed=true` 마킹. Tier 1 archive, Tier 2 dedup/promote 반영 |
| `reflect_incomplete` | cap 3 소진, substance floor 미통과 (Cap-Exhaustion) | 기록만 — 부분 raw는 status=incomplete로 archive, Tier 2 승격 제외. flow는 이미 종료 상태 유지 |
| `precondition_escalated` | input precondition 결손/기형 (P8) | `escalate={failure_origin=cap_exceeded, reason}` 기록 (halt origin — 재invoke 없음). 종료된 flow 그대로 |
| `archive_escalated` | **primary 산출 실패**: Tier 1 (Postgres) archive 자체가 실패 (principle 1 — primary 도구 결손) | `escalate={failure_origin=cap_exceeded, reason}` 기록 (halt origin — 재invoke 없음). 학습이 어디에도 보존 안 됐으므로 silent pass 금지. 종료된 flow 그대로 |
| `skipped_suspended` *(emit 아님 — control disposition)* | `completion_status=suspended` → Reflect 미실행 (precondition 2) | no-op. resume 시 재분류 |

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
- **contradiction-evidence 가용성 조건 (non-code / abandoned flow 닫음)**: contradiction을 ledger에 기록하려면 반대 결과가 **Verify-확정**이어야 한다 — 그런데 Verify 결과는 *코드 flow일 때만* 존재하고(Inputs 참조), abandoned flow에선 Verify가 `did_not_run`일 수 있다(Pass 1 degrade). 따라서:
  - 후속 flow가 **non-code flow**(Review/Retro/Exploration/Spike/plan-standalone)이거나 **Verify가 did_not_run**인 abandoned flow면 → *Verify-확정 contradicting fact가 없으므로* ledger에 `outcome: contradicting`을 **기록하지 않는다** (rule status도 전이 안 함 — deprecate 금지). 이는 결손/escalate가 아니라 *정당한 비-기록*이다 (Reflect는 미확정 추측으로 active rule을 강등하지 않음 — principle 3: 확정 사실만 evidence).
  - 그 관찰은 *버려지지 않는다*: 이번 flow의 `patterns_discovered`에 *이번 flow 내부 관찰*로 기록되어 자체 `pattern_key` ledger에 supporting evidence(또는 새 candidate rule)로 누적된다. 즉 "rule을 강등"하진 않지만 *반대 신호를 별도 pattern으로 축적* → 충분히 누적되면 그 자체가 candidate가 되어 cross-flow로 드러난다 (stay-in-lane: Reflect는 심판이 아니라 사실 축적자).
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
- write 충돌(lock 획득 실패/IO error) → Reflect는 학습을 *잃지 않는다*: Tier 1 raw에 `tier2_write_pending: { topic, pattern_key }` 기록 + Reflect `result=completed_reflection` 유지하되 해당 `tier2_promotions[]` 항목을 `write_mode=deferred`로 표기(이 항목은 성공 쓰인 `rules_file` 없이 `deferred_reason` 필수). (Reflect의 *primary* 산출은 학습 추출이고 Tier 1 archive다 — Tier 2 write는 *enhancement*. principle 1: enhancement 실패는 escalate가 아니라 degraded branch.) orchestrator가 Tier 1의 pending을 다음 idle에 재시도.
- 즉 Tier 2 write 실패는 mechanical error escalate가 *아님* — Tier 1에 학습이 보존되므로 degraded(deferred) 처리. (principle 1: Tier 2 file write = enhancement 도구 역할 → degraded; Postgres Tier 1 archive = primary → 그게 실패하면 그건 `result=archive_escalated`, `failure_origin=cap_exceeded` escalate — Result Enum 참조.)

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
| `completion_status` 결손/enum-밖 | mechanical error → `result=precondition_escalated`, `failure_origin=cap_exceeded` | P8 / principle 3 (결손) |
| `(flow_id, flow_type)` 결손/기형 | mechanical error → `result=precondition_escalated`, `failure_origin=cap_exceeded` | P8 |
| `completed`인데 step row malformed | mechanical error → `result=precondition_escalated`, `failure_origin=cap_exceeded` | principle 3 (기형) |
| `abandoned` + downstream did_not_run | 정상 — `did_not_run` fact로 기록, escalate 아님 | principle 3 (정당하게 빔) / Pass 1 degrade |
| prior history 빔 (첫 실행) | `cold_start` — baseline 수립, escalate 아님 | principle 3 (빈=합법) |
| 후속 non-code/abandoned flow가 active rule과 충돌 관찰 (Verify-확정 없음) | contradiction 비-기록(rule status 불변) + 반대 신호를 patterns_discovered로 축적, escalate 아님 | principle 3 (확정 사실만 evidence) / Tier 2 Lifecycle |
| 3 iter 후 substance 미통과 | `reflect_incomplete` terminal — 부분 archive(incomplete 태그), Tier 2 제외 | P5 cap-exhaustion |
| Tier 2 file write 충돌/IO 실패 | degraded — Tier 1에 pending 기록, `tier2_promotions[].write_mode=deferred` 표기, escalate 아님 | principle 1 (Tier2=enhancement) |
| Tier 1 (Postgres) archive 실패 | mechanical error → `result=archive_escalated`, `failure_origin=cap_exceeded` | principle 1 (Tier1 archive=primary) |

> Reflect는 *flow를 routing하지 않는다* — `request_upstream_deepen`를 emit하지 않는다 (principle 2: Decide 전용). escalate(precondition/archive 둘 다)는 `failure_origin=cap_exceeded`(post-flow halt origin, NO auto-reinvoke — Result Enum 참조)로만 나가고, Reflect는 flow 종료 후 실행되어 in-flow re-entry가 없으므로 ping-pong 루프 자체가 구조적으로 없다 (in-flow 5-누적 cap에 의존하지 않음).

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
