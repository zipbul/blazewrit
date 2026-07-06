# Verify — Flow-Level Goal Verification

## Definition

> **Verify는 step reviewer가 아니다 — 플로우 전체가 목적을 달성했는지 검사하고 *flow-level verdict*를 낸다.** 모든 16 flow에서 예외 없이 실행. Internal multi-pass (전용 reviewer 없음 — 자체 검증 + cross-verify 완화). Verify는 *판정·라우팅 신호만* 내고, 후속 flow 큐잉·재invoke는 orchestrator가 한다 (경계: Verify는 flow를 만들지 않는다).

## Inputs

Verify가 받는 입력 (orchestrator가 주입). 필수 입력은 [Input preconditions](#input-preconditions)에서 존재+정형 assert.

- 전체 flow 산출물 (Triage → ... → 직전 step) — 각 step의 structured output
- 원래 `request_text`, `conversation_context`
- `Triage.flow_type` (16 정규 id 중 1), `Triage.complexity_signal` (high|medium|low|none)
- `Investigate.risk_surface` (severity: low|med|high|critical — **이 단일 척도만 사용**, 새 척도 발명 금지), `Investigate.architecture_impact.has_architecture_level`, `Investigate.impact_map.affected_files_count`
- `Ground.task_subgraph` (`ed_snapshot_version`, `god_nodes_in_scope`, `entry_nodes`) — freshness/race 재검 + P0 후속 신호 입력 (P8/P6: god_node는 Ground 생산 신호이므로 *받는다고 명시*)
- (코드 flow) `Spec.acceptance_criteria`, `Implement.firebat_results`, `Implement.emberdeck_drift`
- **`post_hoc_signal?`** (optional) — orchestrator가 *flow 완료 후* 외부에서 수신해 재invoke 시 주입하는 신호: `{ kind: user_reject | downstream_failure | external_regression, evidence }`. 이 신호와 *함께 전체 flow chain이 재주입*되며 Verify는 passes를 fresh하게 다시 돌린다 ([post_hoc 재invoke 실행 형태](#self-misjudgment-detection-r2) 참조 — internal_passes를 carry하지 않고 새로 populate). (P8: self-misjudgment trigger가 이 채널에 key를 걸므로 Inputs에 **명시 선언**. 없으면 trigger 미발화 — 정상.)
- **tool_status** — 하네스가 코드로 probe한 도구 가용성 (M2/G5): `{ firebat: present|absent|error, emberdeck: present|absent|error, pyreez: present|absent|error }`. Verify는 자기단언이 아니라 이 주입 fact로 분기 (M3 degrade-as-branch).

## Activities

```
1. Input precondition assert   필수 upstream 필드 존재+정형 검사 (P8) — 결손/기형이면 escalate
2. tool_status 분기 결정        firebat/emberdeck/pyreez 가용성 → mechanical/degraded/escalate 경로 선택 (P2, 원칙①)
3. Internal multi-pass          코드/비코드 flow별 3-4 pass 실행 (아래)
4. Multi-pass aggregation       pass 결과를 단일 verdict로 결합 (P1 집계규칙)
5. Goal-backward record 작성     모든 분기에서 "무엇이 TRUE여야 하나" 추적 기록 (P1: fail에서도 유지)
6. Result emit                  RESULT enum 1개 + 해당 분기 객체 출력 → orchestrator 라우팅
```

## Internal Multi-Pass

### 코드 flow

1. **Mechanical**: typecheck pass + all tests pass + `firebat blockers=0` + `emberdeck drift=0`. (firebat/emberdeck 부재·error 시 [Failure & degrade handling](#failure--degrade-handling) 참조 — 침묵 금지.)
2. **Goal-backward**: original request → plan → tests → code, "무엇이 TRUE여야 하나" 역추적. **이 기록은 PASS/FAIL/degraded 전 분기 출력에 포함** (P1: fail에서 빼지 말 것).
3. **Adversarial**: "어떻게 아직도 실패할 수 있나? 무엇을 놓쳤나?"
4. **pyreez cross-verification** — Pass 2-3 검증, **high-risk flow에서만 강제** ([high-risk flow 정의](#high-risk-flow-정의)). pyreez = enhancement 도구 (P5/P2): 부재 시 degraded_pass, 불일치 시 verify escalate. (pass4 omitted arm의 reason 어휘는 {tool_absent,tool_failed,timeout,unavailable,not_applicable}로 tighten — `skipped`은 pyreez에 부적용이라 제외. `not_applicable`은 *pass4 arm에만* 존재: non-high-risk flow에서 pyreez 부재는 result=pass 경로라 pass4가 Omitted{not_applicable}로 기록된다. degraded_tools.omission은 high-risk 강제-pyreez 부재 경로에서만 도달하므로 {tool_absent,tool_failed,timeout,unavailable}로 더 좁다 — not_applicable 미포함.)

### 비코드 flow (Review / Retro / Exploration / Spike / plan-standalone)

1. **Completeness**: required items present, evidence cited, measurements exist, terminal artifact 존재+substantive (Spike는 GO/NO-GO/CONDITIONAL verdict 포함 등 flow별 completion 기준 — flows/README §Non-Implementation 참조).
2. **Goal-backward**: original request → output, output이 요청에 답하는가. (기록 전 분기 유지 — P1.)
3. **Adversarial**: "이 결론이 틀릴 수 있는 이유는…"
4. **pyreez cross-verification** — Pass 2-3 검증, high-risk flow에서만 강제.

## Result enum & branches

> P1 (success branch): Investigate.compatibility_verdict의 discriminated-result 패턴을 재사용 — **성공 분기를 실패 분기와 동일하게 명시 선언**. Verify는 정확히 하나의 `result`를 내고, orchestrator가 라우팅 테이블로 분기한다.

```
result: pass | fail | degraded_pass | blocked | retry_exhausted
```

| result | 의미 | 동반 필수 객체 |
|---|---|---|
| `pass` | 모든 pass 통과, 목적 달성 | `verdict_summary` (+ 공통 `internal_passes`) |
| `degraded_pass` | enhancement 도구(pyreez) 부재로 cross-verify 없이 internal multi-pass만으로 PASS 판정 (P2/P5, 원칙①) | `verdict_summary` + `degraded_tools` (+ 공통 `internal_passes`) |
| `fail` | 1개 이상 pass 미통과 → 특정 producer step에 귀착 | `failure` 객체 (그 안의 `failure_origin` 필드가 귀착 step) |
| `blocked` | 자기 게이트 도구(firebat/emberdeck) mechanical error/timeout, 또는 stale-2nd, 또는 input-precondition fault, 또는 self-misjudgment — Verify가 자기 일을 못 함 (원칙①·③, 게이트 부재→escalate) | `escalation` 객체 |
| `retry_exhausted` | producer⇄reviewer 또는 (flow_id,step) 누적 fail cap 도달, 또는 cap_exceeded | `exhaustion` 객체 |

### 공통 (전 분기) 출력 필드

`result` discriminant와 무관하게 **모든** Verify 출력이 항상 운반하는 top-level required 필드 (schema top-level `required`):

- **`based_on`** — §5 RowRef 번들. Verify는 flow chain 전체를 평가하므로 평가한 row들을 기록한다. `triage_ref`는 항상 존재(모든 flow는 Triage에서 시작); spec_ref/test_ref는 코드 flow만(비코드 flow에선 schema가 forbid), report_ref는 비코드 flow에서 **required**이고 코드 flow에선 schema가 forbid — Report는 비코드 chain의 *terminal producer anchor*이므로 비코드 flow의 보장된 종단 correlation row다. 이 flow-conditional 강제(forbid+require 양쪽)는 schema allOf로 M1 grammar에서 닫힌다. **early-abort 예외**: `result=blocked` + `escalation.cause=input_precondition_fault` + `internal_passes.aborted=true`일 때는 upstream chain이 바로 malformed/missing(reason=upstream_chain_malformed)이라 Report row가 없을 수 있고 flow_kind도 생략 가능하므로, 이 abort 분기에서는 report_ref-required / spec_ref·test_ref-forbidden coupling이 면제된다 (malformed라 선언한 chain에 종단 anchor row를 강제하지 않음 — internal_passes/pass1 면제와 동형). 이때 based_on은 `triage_ref`만 보장한다. cross-flow correlation은 *이 RowRef 번들*로만 한다 (flow_id 자유기입 없음).
- **`flow_kind`** ∈ {`code`, `non_code`} — 어느 internal multi-pass set을 돌렸는지. 어느 `pass1_*` variant가 채워지는지 결정 (code→pass1_mechanical, non_code→pass1_completeness). **early-abort 예외**: `result=blocked` + `escalation.cause=input_precondition_fault` + `internal_passes.aborted=true`일 때는 passes가 *돌기 전*에 bail하므로 (a) flow_kind⇒pass1 강제 coupling이 면제되고 (없는 pass1을 날조하지 않음), (b) **chain이 malformed/unreadable라 flow_kind를 정직하게 분류할 수 없으면 flow_kind 자체를 생략한다** — 이 abort 분기에서 flow_kind는 top-level required에서 면제되어 비코드 default를 *날조하지 않는다* (garbage-in을 구체 분류로 강제 coercion 금지; flow_kind를 안 내면 based_on의 report_ref 강제/spec_ref·test_ref forbid coupling도 함께 도달하지 않는다). chain presence로 정직하게 도출 가능하면 그 값을 내도 된다 — 단 *추측*은 금지. (아래 schema allOf 참조.)
- **`internal_passes`** — 4-pass 자체검증 기록 (`pass1_mechanical`|`pass1_completeness`, `pass2_goal_backward`, `pass3_adversarial`, `pass4_pyreez_cross_verification`). PASS/FAIL/degraded 전 분기 공통 — goal-backward가 항상 보존됨 (P1). **early-abort 예외**: `result=blocked` + `escalation.cause=input_precondition_fault`일 때는 passes가 실행되기 전에 bail하므로 `internal_passes.aborted=true`로 표기하고 pass2/3/4 populated 기록을 요구하지 않는다 (안 돈 pass record 날조 금지 — 아래 schema allOf 참조). 이 bail 상태는 *선택이 아니다*: `cause=input_precondition_fault` ⇒ `internal_passes.aborted=true`가 schema allOf로 **강제**된다 (early-abort 면제 machinery 전체가 이 정확한 triple에 키잉하므로, aborted를 빠뜨려 populated-record 요구를 되살리는 일을 grammar가 막는다 — L69 "passes 돌기 전 bail"과 정합). 그 외 모든 분기(PASS/FAIL/degraded/blocked-non-precondition)는 4-pass populated record 유지.
- **`self_misjudgment_check`** — `{ suspected: bool, triggers?: [...] }`. R2 자기판단 의심 기록 (auditable). `triggers`는 `suspected=true`일 때만 present(minItems 1)하고 `suspected=false`면 forbidden — 이 coupling은 schema allOf로 M1 grammar에서 닫힌다 (suspected=true는 항상 auditable WHY를 운반하고, suspected=false는 stale trigger를 못 든다). **`suspected`는 매 출력에서 R2 조건의 진실을 정직하게 기록**한다 (top-level required). 단 *실현되는* `result`는 [Trigger precedence](#trigger-precedence-p1-동시-발화-결정성)를 따른다: 더 높은 우선순위 트리거(retry_exhausted rule 1, 또는 self-misjudgment가 아닌 다른 blocked 원인 — input_precondition_fault/gate_tool_unavailable/stale_2nd)가 *동시 발화*하면 그쪽이 이긴다. 따라서 suspected=true라도 result는 retry_exhausted나 다른-cause blocked일 수 있고, 그때 suspected=true를 거짓으로 false로 내릴 필요 없다. grammar coupling은 *실현된 self-misjudgment block일 때만* 닫는다: `result=blocked` ∧ `escalation.cause=verify_self_misjudgment` ⇒ `escalation.failure_origin=verify` (아래 schema allOf). suspected⇒(result,cause) 실현이 precedence를 따른다는 cross-trigger 진실은 M2 validator_contract (grammar는 const로 못 박지 않음). **early-abort 예외**: `result=blocked` + `escalation.cause=input_precondition_fault` + `internal_passes.aborted=true`일 때는 어떤 pass도 돌지 않아 R2가 *평가 불가*하므로 `self_misjudgment_check.suspected=false`로 고정하고 `triggers`는 forbidden이다 (suspected=false ⇒ triggers-forbidden coupling과 정합 — 안 돈 pass에서 self-misjudgment를 날조하지 않음). 이 const는 아래 schema allOf로 닫는다.

optional top-level 필드:

- **`high_risk_flow`** (boolean, optional) — [high-risk flow 정의](#high-risk-flow-정의)에서 도출한 high-risk 판정을 *출력에 기록*하는 감사용 필드 (pyreez cross-verify gate 결정의 근거를 auditable하게 남김). 파생 조건이지 새 척도 아님.
- **`declared_next_step`** (optional) — R16 advisory 후속 선언. orchestrator가 권위 있는 `expected_next_step`을 주입하고 `result`/`failure_origin`을 읽어 라우팅한다; `declared_next_step`은 *advisory*일 뿐이며 `declared_next_step==expected_next_step`은 M2 validator_contract (여기 grammar로 강제 안 함). (Verify는 `request_upstream_deepen`은 발행 안 함 — 원칙②.)

### PASS 출력 객체 (`verdict_summary` + 공통 `internal_passes`)

`result ∈ {pass, degraded_pass}`일 때 PASS 분기 필수 필드는 `verdict_summary` (string) 하나다 (degraded_pass는 추가로 `degraded_tools`). **별도 `pass_record` 객체는 없다** — goal-backward 기록과 per-pass 결과는 *모든 분기에서 항상 존재하는* top-level `internal_passes` 객체가 운반한다 (이 always-present 불변식이 분기별 pass_record보다 강하다). Reflect가 받는 `Verify 결과(PASS/...)`의 실체는 `result` + `verdict_summary` + `internal_passes`다.

> §5 storage law: flow/step 상관은 **top-level `based_on` RowRef 번들**로 한다 — verdict_summary/failure/escalation은 `flow_id`/`schema_version`/`verified_at` 같은 식별자를 *자유기입하지 않는다* (cross-flow correlation은 RowRef 기반). `source_version.ed_snapshot_version`만은 freshness/race 재검에 쓰는 *측정 hash*이므로 유지 (식별자 아님).

```yaml
verdict_summary: "<무엇이 TRUE로 검증되었나>"
# goal_satisfied + goal-backward 추적 + per-pass 결과는 분기 객체가 아니라 공통 internal_passes에 있다:
internal_passes:                          # 전 분기 공통 (top-level required, 아래 [공통 출력 필드] 참조)
  pass2_goal_backward:                     # Pass 2 산출 — 전 분기 유지 (P1)
    goal_satisfied: true                   # self-asserted truth — cross-verify로 완화만 (환원불가 residual)
    traced_assertions:
      - assertion: <"무엇이 TRUE여야 하나">
        holds: true
        evidence_ref: <file:line | artifact ref>   # optional
        source_tool: <probe origin>                # required (각 assertion 항목)
  # pass1_mechanical | pass1_completeness, pass3_adversarial, pass4_pyreez_cross_verification 도 여기 (집계 입력)
# P0 후속 신호는 별도 분기-레벨 필드 `p0_post_stabilization`로 emit (pass/degraded_pass 분기 공통, 아래 참조).
```

### `verdict_summary` + `degraded_tools` (degraded_pass 전용)

> degraded_pass는 **pyreez 전용**: enhancement 도구(pyreez)의 cross-verify leg이 *omitted*(부재/error/timeout)이고 나머지 pass가 전부 통과한 경우만(aggregation rule 3). 게이트 도구(firebat/emberdeck) mechanical error는 degraded_pass가 아니라 `blocked`. 따라서 `degraded_tools[].tool`은 `pyreez`로 제한. 객체 shape는 schema의 `degraded_tools` 배열을 따른다 (M3 Omitted 재사용).

```yaml
verdict_summary: "<무엇이 TRUE로 검증되었나>"
degraded_tools:                          # non-empty (degraded면 ≥1 도구 degrade)
  - tool: pyreez
    omission:                            # M3 Omitted branch
      status: omitted
      reason: tool_absent | tool_failed | timeout | unavailable   # canonical Omitted enum: absent→tool_absent, error→tool_failed, tool_unavailable→unavailable, tool_timeout→timeout. not_applicable 미포함 (그건 result=pass 경로의 pass4 arm 전용)
      source_tool: <probe origin>
    mandatory_but_unavailable: true      # degraded_pass 분기는 high-risk 강제-pyreez 부재 경로 전용이므로 *모든* degraded_tools 항목에서 항상 true (required) — 이 branch의 reachability rationale(high_risk_flow=true)과 동치다. low-risk-omitted는 애초 result=pass 경로라 여기 도달 안 함. "강제"는 시도 의무이지 성공 전제 아님 (P5).
# 단일-소스 강제 (M2 validator_contract) — degraded_pass는 *두 하위 case*이고 각각 별도 consistency 계약을 갖는다:
#   (A) pyreez **부재/error/timeout** case: pass4가 *Omitted arm*이고, *동일 invocation*의 `internal_passes.pass4_pyreez_cross_verification` Omitted arm과 이 `degraded_tools[].omission`은 **같은 pyreez 부재 한 건을 기록**하므로 그 `reason`이 **반드시 일치**해야 한다 (pass4.Omitted.reason == degraded_tools[].omission.reason). 둘은 어휘를 공유한다(absent→tool_absent, error→tool_failed, timeout→timeout, unavailable→unavailable; not_applicable은 pass4 전용이라 degraded_pass엔 도달 안 함).
#   (B) **present-but-no-result (Measured{not_run})** case: pass4가 *Measured arm*(cross_verify_result=not_run)이라 `.reason` 필드가 *없으므로* (A)의 reason-동일성은 구조상 적용 불가다. 대신 M2 validator는 `degraded_tools[].omission.reason == tool_failed` AND `pass4.value.cross_verify_result == not_run`을 요구한다 (present-but-no-result leg을 omission shape로 *정규화* — 부재 아닌 한 건을 reason=tool_failed로 기록, 아래 pyreez 표 `present`+`not_run` 행 참조).
# grammar가 두 독립 객체의 reason 동일성을 const로 못 박지 못하고 (A)/(B)를 pass4 arm tag로 분기도 못 하므로 — producer가 pass4 Omitted{tool_absent} + degraded_tools{timeout}(모순된 부재 사유) *또는* pass4 Measured{not_run} + degraded_tools{reason≠tool_failed}를 못 내도록 각 case의 mirror를 M2 validator가 닫는다 (schema $comment에 명시).
source_version:                          # freshness 재검 (race detection) — optional
  ed_snapshot_version: <hash>
# 품질 강등 의미(P5): verdict는 pyreez 없이도 well-defined — internal multi-pass(mechanical+goal-backward+adversarial)로 도출. cross-verify는 *추가 완화 leg*일 뿐 verdict 성립의 전제가 아니다 (cross-verify 완화 없음 = 약화).
```

## Multi-pass aggregation rule (P1)

> 이전 README는 3-4 pass를 *나열*만 하고 결합 함수가 없었다. 결정 함수를 명시한다.

1. **any-fail → fail**: 어느 pass라도 명확한 결함을 surface하고 **그것이 특정 step(들)에 귀착 가능**하면 `result=fail`. `failure_origin`은 결함이 귀착하는 step (아래 [Failure routing](#failure-routing)). (귀착 불가한 diffuse 결함은 fail이 아니라 [Self-misjudgment](#self-misjudgment-detection-r2)의 `unattributable_goal_failure` → blocked.)
2. **all-pass → pass**: 모든 실행된 pass가 통과하면 `result=pass`.
3. **pyreez 부재로 cross-verify pass가 *생략*된 경우**(omitted) — 나머지 pass 전부 통과일 때 high-risk 여부로 갈린다: **pyreez 부재 AND high_risk_flow → `result=degraded_pass`** (강제 pyreez가 빠짐 — fail 아님; P2 원칙①); **pyreez 부재 AND NOT high_risk_flow → `result=pass`** (cross-verify가 애초 필수 아니므로 degrade 아님 — pass4는 Omitted{not_applicable}로 기록, rule 8/precedence-8 소관). degraded_pass는 high-risk 강제-pyreez 부재 경로 전용이다.
4. **Pass 3 adversarial이 Pass 1 mechanical을 *뒤집을* 만한 증거를 surface한 경우** — mechanical이 PASS여도 aggregation은 *fail로 본다*. 단 그 증거가 (a) 특정 step에 귀착하면 `result=fail` + 해당 `failure_origin`; (b) **Verify 자신의 판단을 의심**하게 만들면 (pyreez 불일치 또는 자기 mechanical 결과를 신뢰 못 함) → [Self-misjudgment](#self-misjudgment-detection-r2) 경로 = `result=blocked` + `escalation(failure_origin=verify)`. (P1: "self-suspicion의 결과 verdict"가 이전엔 미정의 — 여기서 blocked/verify-escalate로 확정.)
5. **Compound flow**: sub-flow별 verdict를 모으되 동일 any-fail/all-pass 규칙을 *전체*에 적용 — 어느 sub-flow fail이면 flow fail.
6. **pyreez가 present인데 `cross_verify_result=not_run`인 경우**(cross-verify leg이 *결과를 못 냄*, 부재 아님) — 나머지 pass 전부 통과일 때 high-risk 여부로 갈린다: **not_run AND high_risk_flow → `result=degraded_pass`** (강제 leg이 미완료라 cross-verify 완화가 빠짐 — fail/blocked 아님, disagree와 구분); **not_run AND NOT high_risk_flow → `result=pass`** (leg이 애초 미강제). not_run은 Measured arm이므로 pass4는 Measured{not_run}으로 기록되어 *present였음*을 보존하고(present 사실 owner=pass4), high-risk degraded_pass 시 `degraded_tools`에 present-but-no-result leg을 omission shape로 *정규화*한 항목(`omission.status=omitted`, `omission.reason=tool_failed`, "present였으나 결과 미산출")을 1개 동반 기록한다(degraded_tools non-empty 요구 만족; 이 omitted 라벨은 부재 선언이 아니라 강등 mirror — 단일-소스 M2 (B) case). (rule 3와 평행하나 입력이 Omitted가 아니라 Measured{not_run}.)

### Trigger precedence (P1: 동시-발화 결정성)

> 위 규칙은 *개별* 트리거만 정의했다. 한 invocation에서 result-결정 트리거가 *여럿 동시* 참일 수 있다 (예: mechanical이 `failure_origin=implement` 결함을 surface AND firebat=error AND pyreez `cross_verify_result=disagree`). 그때 emit할 단일 `result`를 **결정적으로** 고른다. 더 낮은 번호가 이긴다 (first-match wins) — Verify가 *자기 일을 못 하는* 조건이 *downstream에 귀착하는 깨끗한 판정*보다 우선한다 (원칙①·③: 자기 게이트가 깨졌으면 그 위에서 내린 fail 귀착 자체를 신뢰할 수 없으므로 producer step으로 misroute 금지).

1. **retry_exhausted** — producer⇄reviewer cycle cap / (flow_id,step) 5-누적-fail / global `cap_exceeded` 도달 → `result=retry_exhausted` (다른 어떤 트리거보다 우선; 이미 cap 소진이면 재진입 자체 무의미).
2. **blocked (input-precondition fault)** — [Input preconditions](#input-preconditions) 결손/기형 → `result=blocked`. (chain/입력이 malformed면 그 위 모든 pass 결과가 신뢰 불가.)
3. **blocked (gate-tool mechanical error)** — firebat/emberdeck `error`/timeout → `result=blocked` + `escalation(failure_origin=verify)`. (게이트가 verdict를 못 냄 → mechanical leg이 신뢰 불가 → 그 위 fail 귀착도 보류.)
4. **blocked (stale-2nd)** — [Stale ED 2nd Attempt](#stale-ed-2nd-attempt) 조건 → `result=blocked` + `escalation(failure_origin=ground)`.
5. **blocked (self-misjudgment)** — pyreez `disagree` 또는 aggregation rule 4b 또는 `post_hoc_signal` → `result=blocked` + `escalation(failure_origin=verify)`.
6. **fail** — 위가 모두 거짓이고 어느 pass라도 step-귀착 결함 surface → `result=fail` (rule 1/4a).
7. **degraded_pass** — 위가 모두 거짓이고 **high_risk_flow인데** pyreez만 부재(omitted)로 강제 cross-verify leg 생략, 나머지 통과 → `result=degraded_pass` (rule 3 high-risk arm).
8. **pass** — 위가 모두 거짓 → `result=pass` (rule 2). **non-high-risk flow에서 pyreez 부재로 cross-verify가 생략된 경우도 여기 소관**(pass4 Omitted{not_applicable}, degrade 아님 — rule 3 non-high-risk arm).

(pyreez-부재 vs other-fail collision은 이 순서로 자동 해소: fail(6)이 degraded_pass(7)보다 우선이므로 "다른 pass가 fail이면 degraded_pass 아님"이 rule 3의 "나머지 pass 전부 통과면"과 정합. degraded_pass(7)는 high-risk만 소유하고 non-high-risk-omitted는 pass(8)가 소유하므로 동일 입력이 7/8 둘 다 만족하는 일이 없다 — high_risk_flow guard가 disjoint하게 가른다.)

## Failure routing

`result=fail`일 때 출력하는 top-level payload property는 `failure` 객체이며, 귀착 step은 그 *안의* `failure_origin` 필드다 (객체 이름은 `failure`, `failure_origin`은 그 필드 — 혼동 금지). (§5: flow/step 상관은 top-level `based_on` RowRef 번들로 — failure 객체는 flow_id/schema_version/verified_at을 자유기입하지 않는다. PASS는 식별자를 들고 FAIL은 안 드는 비대칭은 *based_on을 모든 분기가 공유*함으로써 제거.)

```
failure:                                   # top-level payload property (객체)
  failure_origin: triage | ground | investigate | decide | spec | test | implement | report | multiple   # 그 안의 귀착 필드
                                         # STEP-ATTRIBUTION enum only — verify/cap_exceeded 불포함 (self-misjudgment=blocked, cap=retry_exhausted)
  reason: specific issue description
  evidence: file:line | artifact reference
  escalate: false                        # fail은 보통 false (해당 producer produce⇄review 재진입); coupling은 M2
  source_version?: { ed_snapshot_version: <hash> }   # freshness 상관 (optional, blocked/escalation source_version과 동형)
  earliest_step?: <step>                 # failure_origin=multiple일 때 가장 좌측 step (M2가 요구)
  reclassify_count?: <int 0..3>          # failure_origin=triage일 때 reclassify cycle 수 (orchestrator 추적 plain int — CountClaim 아님)
```

→ Host(orchestrator)가 `failure_origin` 읽고 해당 step의 produce ⇄ review loop 재진입. (decide/failure-routing.md 재사용 — 새 메커니즘 0.)

| failure_origin | 처리 |
|---|---|
| `triage` | Triage 재invoke with prior_evidence (reclassify) — `reclassify_count` cap 3 |
| `ground` | Ground ⇄ Ground-Reviewer re-enters |
| `investigate` | Investigate ⇄ Investigate-Reviewer re-enters |
| `decide` | Decide ⇄ Decide-Reviewer re-enters |
| `spec` | Spec ⇄ Spec-Reviewer re-enters |
| `test` | Test ⇄ Test-Reviewer re-enters |
| `implement` | Implement ⇄ Implement-Reviewer re-enters |
| `report` | Report ⇄ Report-Reviewer re-enters — **비코드 flow에서만 유효** (코드 flow에서 `failure_origin=report`는 invalid → flow_kind=code면 schema allOf가 M1 grammar에서 금지, report_ref-forbidden-on-code와 동형) |
| `multiple` | **earliest problematic step first** (아래 ordering 정의) |

### "earliest" ordering 정의 (P8: 이전엔 모호)

`failure_origin=multiple`일 때 "earliest"는 **그 flow의 flows/README 체인 정의 상의 step 순서**로 결정 (chain order, 좌→우). 코드/비코드 flow가 체인이 다르므로 **해당 flow_type의 실제 체인**을 기준 source로 본다 (flows/README가 단일 source — M4). 예: 코드 flow는 `triage < ground < investigate < decide < spec < test < implement`; 비코드 flow(Review/Retro/Exploration/plan-standalone)는 `triage < ground < investigate < decide < report`. 가장 좌측(earliest) step을 `failure_origin`으로 단일 선택하고 나머지는 `reason`에 부기. (earliest부터 고치면 downstream 결함이 재생산되며 자연 해소 — re-entry cap이 ping-pong을 bound.)

## Self-Misjudgment Detection (R2)

Verify가 *자기 판단*을 의심하는 조건 (→ `result=blocked` + `escalation(failure_origin=verify)`):

- **pyreez cross-verify가 *반대 verdict*** (PASS vs FAIL 불일치) — pyreez `cross_verify_result=disagree`. (P2: 이건 degrade가 아니라 *불일치* → `failure_origin=verify` escalate, NEEDS_CONTEXT. pyreez 부재와 구분.)
- Pass 3 adversarial이 Pass 1 mechanical을 *뒤집을* 만한데 특정 step에 귀착 안 됨 (aggregation rule 4b).
- **임의의 pass(goal-backward 포함)가 명확한 결함을 surface하나 (a) 특정 single step에 귀착 불가 *그리고* (b) `multiple`로 여러 step에 분해 불가** (diffuse goal-not-met — 전체 flow가 목적을 못 냈는데 어느 step 탓인지 Verify가 정당화 못 함). 이건 4b의 일반 case다: step locus 없는 결함은 Verify가 producer를 *추측*해 misroute하지 않고 → `result=blocked` + `escalation(failure_origin=verify, reason=unattributable_goal_failure)`로 user/caller escalate. (원칙: 귀착 못 할 결함을 임의 step에 떠넘기지 않음 — in-lane.)
- **`post_hoc_signal`** 수신 (Inputs에 선언된 채널): user_reject | downstream_failure | external_regression. flow가 이미 PASS였는데 외부 신호가 그 판정을 반박 → Verify가 자기 과거 판정을 의심. (이 세 kind는 audit record의 `self_misjudgment_check.triggers`에서 단일 토큰 `post_hoc_external_signal`로 기록된다 — kind granularity는 입력 신호에만 보존되고 trigger 토큰으로 echo하지 않는다.)

  **post_hoc 재invoke 실행 형태** (이전엔 미정의 — 4-pass fresh 가정과 충돌): orchestrator가 post_hoc_signal로 Verify를 재invoke할 때 *전체 flow chain을 다시 주입*한다 (원래 PASS 때와 동일 Inputs + post_hoc_signal). Verify는 **passes를 fresh하게 다시 돌려** `internal_passes`를 *새로* populate한다 (이전 PASS의 record를 carry/재사용하지 않음 — stale 판정을 베끼지 않는다). 단 이 재invoke의 *목적은 자기 과거 판정 의심*이므로 결과는 거의 항상 self-misjudgment 경로다: `self_misjudgment_check.suspected=true` + trigger `post_hoc_external_signal` → `result=blocked` + `escalation(failure_origin=verify)` (NEEDS_CONTEXT, 자동 재invoke 없음). 재주입된 chain이 그 사이 superseded/stale면(예: ed_snapshot_version stale 또는 chain malformed) **precedence가 적용**된다: input-precondition fault(rule 2)나 stale-2nd(rule 4)가 self-misjudgment(rule 5)보다 높으므로, 그 경우엔 early-abort/stale 분기로 가고 `suspected=true`는 정직히 유지되되 *실현 result*는 더 높은 precedence가 가져간다 (L70 cross-trigger 진실 — M2). 즉 post_hoc 경로도 별도 입력 shape이나 별도 internal_passes 채움 규칙을 만들지 않고 *기존 fresh-run + precedence*에 합류한다.

→ orchestrator는 `failure_origin=verify`를 **자동 재invoke 하지 않음** — `NEEDS_CONTEXT`로 user/caller escalate (무한 self-route 방지). (제어신호 소유권 원칙②: Verify는 `request_upstream_deepen`을 *쓰지 않는다* — 그건 Decide 전용. 모든 degenerate/모호 upstream은 기존 `failure_origin` escalate로만 라우팅.)

## Failure & degrade handling

> P2 + 원칙①: 도구 역할로 갈린다. *게이트* 도구(firebat/emberdeck) mechanical 실패 → **escalate(blocked)**. *enhancement* 도구(pyreez) 부재 → **degraded_pass 분기**. M3 degrade-as-branch + R12 failure_modes 재사용 — 침묵 0.

### firebat (Mechanical gate — primary, 원칙①)

| tool_status.firebat | Verify 동작 |
|---|---|
| `present` | `blockers > 0` → mechanical FAIL → `failure_origin=implement`. `blockers = 0` → mechanical leg pass |
| `error` (exit 2 / MCP unreachable / timeout) | **게이트가 verdict를 못 냄 → `result=blocked` + `escalation(failure_origin=verify, reason=firebat_unavailable)`** (principle 1: primary gate → escalate; unknown-disposition.md `tool_unavailable→escalate`와 일치) |
| `absent` (프로젝트 미설치 — firebat.md degrade) | 문서화된 fallback: `typecheck + all tests pass`로 mechanical leg 판정. degrade이지 escalate 아님 (구성상 부재 ≠ 게이트 고장). firebat sub-tool은 Omitted branch로 두고, `internal_passes.pass1_mechanical.mechanical_fallback_used=true`로 fallback 표기. **이 flag=true는 자유기입 아님**: schema allOf가 flag=true ⇒ firebat/emberdeck 중 *최소 하나가 Omitted branch*임을 M1 grammar에서 강제한다 (두 게이트가 모두 Measured면 실제 fallback이 없었으므로 flag=true 금지) — flag와 실제 sub-tool 분기가 정합. |

### emberdeck (Mechanical gate — primary, 원칙①)

| tool_status.emberdeck | Verify 동작 |
|---|---|
| `present` | `drift > 0` → mechanical FAIL → `failure_origin=implement` (card↔code drift). `drift = 0` → pass |
| `error` | **`result=blocked` + `escalation(failure_origin=verify, reason=emberdeck_unavailable)`** (principle 1) |
| `absent` (미설치 — emberdeck.md degrade) | codeLinks/drift check disabled — drift leg 생략, mechanical은 typecheck+test+firebat로 판정. degrade 표기 |

### pyreez (cross-verification — *enhancement*, 원칙①)

| 상황 | Verify 동작 |
|---|---|
| `present` + `cross_verify_result ∈ {agree, inconclusive}` | cross_verify leg = pass, 정상 aggregation |
| `present` + `cross_verify_result = not_run` | pyreez가 *present였으나 cross-verify 결과를 못 냄* (leg 미완료). **부재(tool_status≠present)와 구분**: 이 케이스는 pass4의 *Measured* arm에 `cross_verify_result=not_run`으로 정직히 기록된다(present였음을 보존). aggregation에서는 *완료된(agree/inconclusive) leg이 아니므로* "강제 cross-verify leg 미달성"으로 취급: **high-risk flow → `result=degraded_pass`** (강제 leg이 결과 없음 = 부재와 동일 강등 의미; 나머지 pass 통과 시). 이때 pass4는 Measured{not_run}으로 남아 *present였음*을 보존하고, 부재가 아니지만 추가로 `degraded_tools` 항목을 1개 기록한다. degraded_tools shape에는 Measured/not_run 전용 arm이 없으므로 이 present-but-no-result leg은 **omission shape로 *의도적 정규화***된다: `omission.status=omitted`, `omission.reason=tool_failed`("present였으나 결과 미산출"). 이 omitted 라벨은 "도구 부재" 선언이 *아니라* — 같은 한 leg의 *권위 있는 present 사실은 pass4 Measured{not_run}이 들고*, degraded_tools는 degraded_pass 분기의 non-empty 요구를 만족시키며 강등 사유를 단일-소스로 정규화하는 mirror일 뿐이다 (위 단일-소스 M2 (B) case와 정합). **non-high-risk flow → `result=pass`** (leg 애초 미강제, degrade 아님). disagree와 달리 self-misjudgment 아님 (aggregation rule 6, precedence rule 7/8). |
| `present` + `cross_verify_result = disagree` | **pyreez 불일치 → `result=blocked` + `escalation(failure_origin=verify)`** = self-misjudgment (P2: disagree는 degrade가 *아님*) |
| **high-risk flow** + `absent` / `error` / `timeout` | **degraded 분기**: pass4_pyreez_cross_verification leg을 *Omitted arm*(`status:omitted`, `reason ∈ {tool_absent,tool_failed,timeout,unavailable}` — absent→tool_absent, error→tool_failed, timeout→timeout)으로 기록 → `result=degraded_pass` (나머지 pass 통과 시) + `degraded_tools`. (P2/P5 원칙①: pyreez는 *강제여도* enhancement다 — "강제"는 *시도 의무*이지 *성공 전제*가 아니다. 도구 부재는 escalate 아니라 degrade. degraded_pass는 high-risk 강제-pyreez 부재에서만 도달하므로 `degraded_tools[].mandatory_but_unavailable`은 *모든 항목에서 항상 true*(required)이고 high_risk_flow=true와 동치다 — verdict는 동일 `degraded_pass`.) |
| **not high-risk flow** + `absent` / `error` / `timeout` | pyreez 미강제 — pass4를 *Omitted arm*(`reason=not_applicable`)으로 기록, `result=pass` 그대로 (degrade 아님; cross-verify가 애초 필수 아니므로). |

> `cross_verify_result=not_run`은 pass4의 *Measured* arm enum 값으로, pyreez가 **present인데 실행 안 된**(또는 실행 직전 가용성은 있었으나 결과를 못 낸) 케이스를 표기한다. *부재* 케이스는 위 표대로 Measured가 아니라 *Omitted arm*(reason 어휘)으로 기록하므로 `not_run`을 쓰지 않는다 — 부재는 Omitted, present-but-no-result는 Measured{not_run}로 owner가 갈린다. **not_run의 aggregation verdict**는 위 pyreez 표(`present`+`not_run` 행)와 [aggregation rule 6](#multi-pass-aggregation-rule-p1)이 정의한다: high-risk면 degraded_pass(+ degraded_tools{omission.reason=tool_failed} 동반), 아니면 pass. 즉 not_run은 "묵음"이 아니라 부재와 동일한 강등 의미를 갖되 pass4 Measured arm에 *권위 있는 present 사실*을 남기고, degraded_tools 동반 항목의 `omission.status=omitted`는 그 present leg을 강등 mirror로 *정규화*한 것이지 present 사실을 부재로 덮어쓰는 게 아니다(owner: present=pass4 Measured, 강등 mirror=degraded_tools).

### "No reviewer / quality guaranteed" 강등 (P5)

Verify는 flow-level evaluator 자체다 — 별도 reviewer를 더하면 무한 recursion. **이전 README의 "품질은 internal multi-pass + pyreez cross-verification으로 *보장*된다"는 과장이었다 (pyreez 부재 시 그 보장이 조용히 붕괴).** 정직 강등:

- 품질은 **internal multi-pass(LLM 자기판정)** + **high-risk flow에서 cross-verify(pyreez)로 *완화*** 된다. *보장(guarantee)*이 아니라 *완화(mitigation)*.
- **verdict는 pyreez 없이도 well-defined** — pyreez 부재는 `degraded_pass` 분기로 명시 처리되며, mechanical + goal-backward + adversarial 3 pass만으로 결론을 낸다. cross-verify는 *추가 완화 leg*일 뿐 verdict 성립의 전제가 아니다.
- 환원불가 residual: `goal_satisfied: true`는 self-asserted truth — grammar/cross-verify가 *완화*하나 *제거*하지 못한다 (정직한 바닥).

## high-risk flow 정의

> 이전 README는 "high-risk flow"가 pyreez cross-verify(및 line-77 보장)를 gate하는데 *미정의*였다. 기존 신호만으로 닫는다 (새 척도·새 state 발명 금지 — Investigate.risk_surface 단일 척도 재사용).

flow는 다음 중 **하나라도** 참이면 high-risk (→ pyreez cross-verify 강제):

- `Investigate.risk_surface`에 `severity ∈ {high, critical}` 항목 존재, **또는**
- `Investigate.architecture_impact.has_architecture_level = true`, **또는**
- `Investigate.impact_map.affected_files_count ≥ 5` (pyreez.md "5+ affected files" 자율 trigger와 정합), **또는**
- `Triage.complexity_signal = high`, **또는**
- `Ground.task_subgraph.god_nodes_in_scope` 비어있지 않음, **또는**
- `flow_type ∈ {Migration, Performance, Compound}` (breaking surface / 측정 회귀 / 다-sub-flow — 본질적 고위험), **또는**
- P0 flow에서 위 god_node/complexity 조건 충족.

그 외 flow는 *not high-risk* — pyreez cross_verify는 omitted이며 이것은 degrade가 아니라 *정상 PASS* 경로다 (원칙③: legitimately-omitted ≠ missing).

## Input preconditions

> P8 (garbage-in 견고성, 횡단 절): Verify는 upstream이 항상 깨끗·존재·정형이라 가정하지 않는다. 필수 입력의 *존재+정형*을 assert (진실성은 assert 안 함 — 그게 Verify의 본업이지 precondition 아님). 결손/기형은 mechanical error → escalate.

Verify 진입 시 다음을 검사:

| precondition | 결손/기형 시 |
|---|---|
| 전체 flow 산출물 chain이 직전 step까지 존재 + 각 step의 result enum이 정형 | `result=blocked` + `escalation(cause=input_precondition_fault, reason=upstream_chain_malformed)` (input_precondition_fault는 producer-귀착 없으므로 `failure_origin` 생략 — L264 정합) |
| chain이 **`Triage.flow_type`의 flows/README 체인이 요구하는 row를 *모두* 포함** (단지 "직전 step까지 존재"가 아니라 해당 flow_type의 *필수 step 완비*) — 예: 코드 flow는 spec/test/implement row가, 비코드 flow는 report row가 present. present·정형이지만 *필수 step row가 빠진* 불완전 chain은 measure할 대상이 없다 | 상동 (`reason=incomplete_chain_for_flow_type`) — 이 거리는 `upstream_chain_malformed`(구조 기형)와 구분: 각 row는 well-formed인데 flow_type이 요구하는 step이 *빠진* case. earliest-missing-step을 evidence에 기록. (chain order는 [earliest ordering](#earliest-ordering-정의-p8-이전엔-모호) 정의 재사용 — flows/README 단일 source.) |
| `Triage.flow_type`가 16 정규 id 중 하나 | 상동 (`reason=invalid_flow_type`) |
| (Investigate가 체인에 있는 flow에서) [high-risk flow 정의](#high-risk-flow-정의)를 gate하는 파생 입력 — `Investigate.risk_surface`, `Investigate.architecture_impact.has_architecture_level`, `Investigate.impact_map.affected_files_count`, `Triage.complexity_signal` — 가 **존재+정형**. 이 필드가 결손/기형이면 mandatory-pyreez gate(high_risk_flow 도출)를 평가할 수 없다 | 상동 (`reason=missing_high_risk_signal`) — **결손/기형을 *not-high-risk* default로 조용히 coerce 금지** (garbage-in을 신뢰해 강제 cross-verify를 건너뛰면 under-defense). high_risk_flow를 정직히 도출 가능한 입력이 없으면 not-high-risk로 추측하지 않고 input_precondition_fault로 라우팅. (god_nodes_in_scope는 아래 P0 행이 별도 assert; flow_type은 위 행.) |
| (코드 flow) `Spec.acceptance_criteria` 존재 + non-empty | 상동 (`reason=missing_acceptance_criteria`) — **이것은 "정당하게 빔"이 아니라 "결손"이다 (원칙③). 빈 AC를 PASS로 고무도장 금지** |
| `Ground.task_subgraph.ed_snapshot_version` 존재 | 상동 (`reason=missing_freshness`) |
| `Ground.task_subgraph.ed_snapshot_version`가 **정형 Sha256**(hex64) — present인데 malformed(non-Sha256)면 staleness 비교가 불가하므로 stale-2nd가 아니라 **precondition fault** | 상동 (`reason=malformed_freshness`) — 이 거리를 *absent*(`missing_freshness`)와 *stale*([Stale ED 2nd Attempt](#stale-ed-2nd-attempt), cause=stale_2nd_attempt/failure_origin=ground)와 명시 구분: stale은 hash가 *present+정형이라 비교 가능*할 때만 도달; absent는 hash 자체가 없음; malformed는 present이나 비교 불가 → input_precondition_fault로 라우팅(precedence rule 2 > rule 4)하고 *조용히 coerce/drop 하지 않는다*. (schema SourceVersion.ed_snapshot_version = $ref Sha256이므로 malformed hash는 measure 단계 이전 precondition에서 차단.) |
| (P0 후속 신호 키잉 시) `Ground.task_subgraph.god_nodes_in_scope` 필드 존재 (빈 list는 OK — "god node 없음"은 정당한 사실) | 상동 (`reason=missing_god_node_signal`) |

**구분 (원칙③)**: 비코드 flow에서 `Spec.acceptance_criteria` *부재*는 결손이 아니다 (비코드 flow는 Spec 없음) — flow_type별 chain에 Spec이 있는 flow에서만 필수. *변경이 clean해서* mechanical이 깨끗한 것 = 정당한 PASS; *upstream이 깨져서* 빈 것 = escalate. 절대 후자를 전자로 rubber-stamp 안 함.

ping-pong 안전: input-precondition escalation은 `failure_origin` re-entry + **(flow_id, step) 5-누적-fail halt cap** (decide/failure-routing.md)이 bound하므로 무한 루프 불가.

## `escalation` (blocked 전용)

`result=blocked`일 때 출력. **모든 비-clean-fail block 원인**(self-misjudgment, gate-tool mechanical error/timeout, stale-2nd, input-precondition fault)을 운반. (§5: flow 상관은 top-level `based_on` RowRef — escalation은 flow_id/schema_version/verified_at을 자유기입하지 않는다.)

> **disposition은 구조적 상수**: blocked는 *항상* `NEEDS_CONTEXT` + auto-reinvoke 없음 — 이건 blocked 분기의 *구조적 상수*이므로 `escalation`에는 별도 `escalate`/`disposition` 필드가 **없다**. (sibling `failure`는 `escalate`가 *가변*[보통 false, producer loop 재진입], `exhaustion`은 `escalate` const true로 *기록*하지만, blocked는 모든 case가 needs-context라 기록할 disposition이 없다 — 라우팅은 cause/failure_origin만으로 도출.)

```yaml
escalation:
  cause: verify_self_misjudgment | gate_tool_unavailable | stale_2nd_attempt | input_precondition_fault
  failure_origin?: verify | ground       # *step-id 도메인만* (verify=self-misjudgment, ground=stale_2nd_attempt). 자동 재invoke 안 함. cap 계열은 여기 아님(retry_exhausted). cause와 const-coupled (schema allOf): cause=verify_self_misjudgment⇒failure_origin=verify, cause=stale_2nd_attempt⇒failure_origin=ground — 두 case 모두 M1 grammar에서 required+const로 닫힘. gate_tool_unavailable/input_precondition_fault는 producer-귀착이 없으므로 failure_origin이 **forbidden** (schema allOf가 M1에서 금지 — 비-귀착 cause에 verify/ground attribution을 못 붙임).
  reason
  evidence
  source_version?: { ed_snapshot_version: <hash> }   # stale_2nd_attempt면 trigger한 stale hash (freshness anchor)
  blocked_on:                            # cause=gate_tool_unavailable일 때 required (minItems 1): 어느 게이트(firebat/emberdeck)가 verdict를 막았고 왜 degrade 불가인지 — auditable record. 다른 cause에선 forbidden. (schema allOf const-coupling, verify_self_misjudgment/stale_2nd_attempt와 동형.)
    - tool: firebat | emberdeck
      omission: { status: omitted, reason: <…>, source_tool: <…> }
      why_verdict_blocking: "<degraded_pass 불가 이유>"
```

## RETRY_EXHAUSTED

Max iterations(producer⇄reviewer cycle cap, 또는 (flow_id,step) 5-누적-fail, 또는 global `cap_exceeded`) 도달 시 → `result=retry_exhausted` + `exhaustion`. **flow halt + escalate. silent proceed 금지. `DONE_WITH_CONCERNS` 출력 type 없음.**

`exhaustion` 객체 (escalation과 *별개* — cap 전용):

```yaml
exhaustion:
  cause: retry_cap | cap_exceeded        # cap 계열만; 단일 producer에 귀착 안 됨 — cap 의미는 cause가 운반 (failure_origin enum 오염 방지; field-type 일관)
  iterations: <int>                      # 시도된 produce⇄review iteration 수 — orchestrator 추적 plain int (CountClaim 아님)
  last_failure_origin?: <step>           # 마지막 실패 iteration의 STEP-ATTRIBUTION origin (cap_exceeded면 생략). verify/cap_exceeded 불포함. multiple이면 earliest_step이 disambiguate.
  earliest_step?: <step>                 # last_failure_origin=multiple일 때 가장 좌측(chain-order) step (M2가 요구) — multi-step 마지막 실패가 routing/learning에서 unrecoverable해지지 않도록 (fail.earliest_step과 동형).
  escalate: true                         # 항상 true — halt+escalate, silent proceed 금지
  reflect_classification: abandoned      # exhausted flow의 유일한 Reflect 분류 (DONE_WITH_CONCERNS 없음)
```

→ Reflect 분류: `cause ∈ {cap_exceeded, retry_cap}` (또는 `result=retry_exhausted`) → `abandoned` (학습 누적). `failure_origin=verify` self-misjudgment escalate(NEEDS_CONTEXT) → `suspended` (Reflect 미실행).

## Stale ED 2nd Attempt

`source_version` stale 검출 cycle cap=1 (원본 + 재invoke 1회 = 총 2 attempts). 2nd 재invoke에서도 stale 발견 시 → `result=blocked` + `escalation(failure_origin=ground, cause=stale_2nd_attempt)` 또는 flow halt + escalate (config). 무한 진행 금지. (compatibility-verdict.md stale 책임 표와 정합.)

## P0 Post-Stabilization (Verify SIGNALS, orchestrator queues)

> 경계 (P0 보강): **Verify는 후속 flow를 *만들지 않는다*. 신호만 낸다.** orchestrator가 신호를 읽고 큐잉. (Verify가 flow를 create하면 Report/Verify 경계 위반.)

P0(bugfix-p0) flow가 `result ∈ {pass, degraded_pass}`이고 다음 조건 충족 시 분기-레벨 `p0_post_stabilization` 신호 emit (pass·degraded_pass 분기 공통):

```yaml
p0_post_stabilization:                      # Verify는 이 신호만 출력 — 큐잉은 orchestrator (signal-only 경계)
  triggered_by: [high_complexity | god_node]  # 배열(minItems 1, unique) — 두 조건은 독립이라 *둘 다* 참일 수 있음. 둘 다 발화하면 두 항목 모두 기록 (Triage.complexity_signal=high *그리고* Ground.god_nodes_in_scope 비어있지 않음). 하나만 참이면 단일 항목.
  suggested_followup: bugfix_normal | retro   # 권고 — 실제 큐잉/실행 결정은 orchestrator
  suggested_depth: deep                       # suggested_followup=bugfix_normal일 때 required + const deep, retro면 부재 (depth 무의미) — 양쪽 모두 schema allOf로 강제
  evidence:                                    # 배열 — triggered_by의 *각 발화 항목마다 1개* ref. 둘 다 발화하면 god_node ref와 complexity ref를 *둘 다* 기록 (단일 alternation 아님). trigger↔ref 키잉(발화 트리거당 1 evidence)은 M2 validator_contract; 배열 shape은 schema가 닫음.
    - trigger: high_complexity | god_node      # 이 ref가 어느 발화 신호를 뒷받침하는지 (triggered_by 항목 mirror)
      ref: <god_node ref | complexity ref>
```

- orchestrator가 `p0_post_stabilization` 신호를 읽고 → Bug Fix (Normal) flow(depth=deep) 또는 Retro flow를 *자동 큐잉* (Review flow follow-up과 동일 메커니즘 재사용 — flows/README §Review follow-up). 자동 *실행*은 user/CI 결정.
- (입력 정합 P8: `god_node` 신호는 Inputs에 선언된 `Ground.task_subgraph.god_nodes_in_scope`에서만 읽는다 — Verify가 새로 캡처하지 않음.)

## Boundary

| 항목 | 책임 |
|---|---|
| step 출력 review | 각 step의 reviewer (Verify는 flow-level만) |
| 학습 추출 | Reflect |
| 결정 변경 | Decide (Verify는 routing 신호만, 결정 안 함) |
| 새 사실 캡처 (god_node, ed_snapshot) | Ground (Verify는 *받아서 읽기*만) |
| **후속 flow 생성/큐잉** | **Orchestrator** (Verify는 `p0_post_stabilization` *신호*만 — flow를 create/queue 하지 않음) |
| `request_upstream_deepen` 발행 | **Decide 전용** (원칙②: Verify는 절대 발행 안 함 — degenerate upstream은 `failure_origin` escalate로) |
| upstream 사실의 *진실성* 판단 외 *존재/정형* assert | Verify (input precondition, P8) — 단 *의미상 틀림*은 환원불가 residual |

## Depth

Verify는 flow의 risk에 따라 multi-pass 깊이를 조정:

- **shallow** (not high-risk flow): mechanical + goal-backward + adversarial 3 pass, pyreez 미강제(omitted=정상). caps: wall_s=30, tokens=6k.
- **deep** (high-risk flow): 3 pass + pyreez cross-verify 강제. caps: wall_s=180, tokens=20k. (Bug-Fix-Unreproducible의 "extended observation"은 Verify의 산출 활동이 아니다 — Verify에는 그 결과를 담을 출력 slot이 없고, 관찰 활동은 해당 flow의 producer step 소관이다. Verify는 그 산출물을 *받아 검사*만 하므로 여기서 별도 activity로 over-reach하지 않는다. Bug-Fix-Unreproducible이 deep로 가려면 [high-risk flow 정의](#high-risk-flow-정의)의 기존 신호(risk_surface severity / architecture_impact / affected_files / complexity / god_node) 중 하나가 참이어야 하며, flow_type 자체로 high-risk가 되지는 않는다 — flow_type-고정 high-risk 목록은 {Migration, Performance, Compound}로 한정.)

deepen은 [high-risk flow 정의](#high-risk-flow-정의) 조건으로 mechanical 결정 (LLM 재량 아님).
