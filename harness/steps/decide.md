# Decide — Decision Ownership (Universal)

## Definition

> **Decide는 Investigate 산출물 위에서 *결정의 책임자*다.** 모든 flow 필수 (skip 없음). 산출물 깊이는 flow별 *mode*로 선언. Mode = Record | Plan | Design.

Decide는 *결정만* 한다 — 새 사실 캡처(Ground), 사실 해석(Investigate), AC 추출(Spec)을 다시 하지 않는다 (Boundary 참조). Decide의 출력은 하나의 **discriminated result enum**(아래 "Result enum & branches")으로 표현되며, 정상 결정(`decision`)뿐 아니라 두 제어 출력(`reclassify_required`, `request_upstream_deepen`)도 같은 enum의 1급 분기다 (P1: 성공·제어 분기를 *모두* 선언, 실패만 정의하지 않음).

## Inputs

- Investigate 출력 (impact_map, constraints, risk_surface, architecture_impact, compatibility_verdict, ground_unknowns_addressed, sub_flow_identification?, triage_mismatch?)
- Ground 출력 (사실 근거)
- Triage 출력 (의도)
- request_text, conversation_context

## Input preconditions (P8: garbage-in 방어 — 횡단 input-precondition 절)

Decide는 *결정 활동 시작 전에* 필수 upstream 필드의 **존재 + 정형(well-formed)** 을 mechanical 하게 assert 한다. 이 절은 "진실"을 검사하지 않는다(그건 Verify 일) — 오직 *결손/기형*을 감지한다. Ground의 `active_flow_state` mechanical-error 패턴을 일반화한 것이다.

필수 입력 (모두 존재 + 정형이어야 함):

| 입력 | 정형 조건 |
|---|---|
| `Investigate.compatibility_verdict` | `result` 필드가 enum `{proceed, blocked, needs_clarification, no_op, partial_proceed}` 중 하나 |
| `Investigate.compatibility_verdict.issues` | array (빈 list 허용 — 빈 list는 *합법적 verdict*이지 결손 아님, 아래 원칙③ 참조) |
| `Investigate.risk_surface` | array of `{ area, severity ∈ {low,med,high,critical}, ... }` (빈 array 허용) |
| `Investigate.impact_map.affected_files_count` | non-negative int (R6 mechanical force 입력) |
| `Investigate.architecture_impact.has_architecture_level` | bool (R6 force 입력) |
| `Investigate.architecture_impact.public_api_changes` | array of symbol (빈 array 허용 — Investigate L133 실재 필드; §5 비강제 tiebreak `.length` 입력) |
| `Investigate.based_on_ground` | Ground 산출물 ref 해소 가능 |
| `Ground` 출력, `Triage` 출력 | 존재 + ref 해소 가능 |

**판별 (principle 3: "정당하게 빔" vs "결손/기형"):**
- 위 필드가 **존재하지만 빈 값**(예: `issues=[]`, `risk_surface=[]`, `affected_files_count=0`) → *합법적 verdict*. Decide 정상 진행 (clean change). 이것은 escalate 사유가 **아니다**.
- 위 필드가 **부재 / 타입 불일치 / enum 무효값 / ref 미해소** → *mechanical error*. Decide는 결정을 산출하지 않고 **escalate** 한다 (P8: failure_origin=investigate 또는 ground, 어느 upstream 필드가 깨졌는지에 따라). 산출은 result enum의 1급 분기 `result: precondition_fault`다 (성공·제어 분기와 배타적 — `decision`/mode payload도, reclassify/deepen payload도 없다):

```yaml
result: precondition_fault
failure_origin: ground | investigate     # 깨진 upstream step (Decide가 읽는 두 upstream에 한정; 공유 FailureOrigin enum의 tightened subset)
faulting_field: <부재/기형 필드명>        # 예: compatibility_verdict.result, risk_surface
detail: <missing | type-mismatch | enum-invalid | ref-unresolved 설명>   # 구조적 판정만 (진실/의미 판단 아님)
based_on: { ... }                         # RowRef bundle
```
- **금지**: 결손/기형 upstream을 빈-합법으로 *조용히 취급*하여 결정을 고무도장 찍지 않는다 (P7 차단: garbage-in을 verdict로 위장 금지).

**Ping-pong bound**: precondition escalate는 producer⇄reviewer re-entry로 라우팅되며 `(flow_id, step)` **5회 누적-fail halt cap**(failure-routing.md)이 무한 escalate를 이미 bound 한다 — 따라서 input-precondition escalation은 안전하다.

## Mode 결정 방식 (Hybrid + Mechanical Force)

Mode는 다음 순서로 *deterministic* 하게 확정된다. orchestrator가 Investigate schema 필드에 평가(LLM judgment 우회, R6). Decide LLM은 *이미 force된 mode로* 진입한다.

### 1. Gate (mode 결정 자체의 전제)

mode upgrade / force trigger는 **`compatibility_verdict.result ∈ {proceed, partial_proceed}` 인 경우에만** 평가된다. result가 그 외(`blocked` / `needs_clarification` / `no_op`)이면 **Decide 자체가 미실행** — orchestrator가 mechanical 강제 halt 하므로 어떤 upgrade trigger도 halt 명령을 override 할 수 없다 (compatibility-verdict.md L102).

### 2. Declared base mode

flow definition이 *기본 mode* 선언 (`decide_mode: record | plan | design`).

### 3. Mechanical force (R6) — Investigate 실재 필드 평가

orchestrator가 아래 force rule을 평가한다. **모두 Investigate가 실제로 생산하는 schema 필드만** 읽는다 (P4: 금지된 "options" 필드 읽지 않음):

| # | Force rule (Investigate 실재 필드) | 결과 |
|---|---|---|
| F1 | `count(compatibility_verdict.issues where severity ∈ {medium, high, fatal}) ≥ 2` | **Plan** 강제 |
| F2 | `any(risk_surface where severity ∈ {high, critical})` AND declared=record | **Plan** 강제 |
| F3 | `impact_map.affected_files_count ≥ 5` AND declared=record | **Plan** 강제 |
| F4 | `architecture_impact.has_architecture_level == true` | **Design** 강제 (declared 무관) |

> **severity 척도 일원화**: F1/F2는 `compatibility_verdict.issues[].severity`(enum `fatal|high|medium|low`)와 `risk_surface[].severity`(enum `low|med|high|critical`) — Investigate가 이미 정의한 척도를 *그대로* 사용한다. 새 severity 척도를 발명하지 않는다.

### 4. Force precedence — 동시 발화 시 (P4 / completeness hole: 동시 force resolution)

여러 force rule이 동시에 발화할 수 있다 (예: architecture-level 변경이면서 issues ≥ 2). **precedence는 *depth 단조 증가* 방향으로 결정한다 — 더 깊은 mode가 항상 이긴다:**

```
Design > Plan > Record
```

- **F4(Design)가 발화하면 항상 Design** — F1/F2/F3(Plan) 중 무엇이 같이 발화하든 **Design이 supersede** 한다. (F4만 `declared 무관`을 달고 있는 이유가 이것이다 — 가장 강한 force.)
- F4 미발화, F1/F2/F3 중 하나 이상 발화 → **Plan**.
- 어느 force도 미발화 → 아래 5번(declared base mode 유지 + 비강제 tiebreak).

> 근거: mode = 산출 depth. 동시 신호가 있을 때 *더 얕은 mode로 가는 것*은 약한 신호가 강한 신호를 무력화하는 것이므로 안전하지 않다. depth-max 규칙은 deterministic 하고 추가 상태가 필요 없다.

### 5. 비강제 tiebreak — force 없을 때 (P4: Investigate 실재 필드 읽음)

force(F1~F4)가 하나도 발화하지 않으면 declared base mode를 유지하되, declared=record일 때 **record→plan upgrade 여부**를 다음 *실재 필드*로 판정한다 (P4 핵심: 여기서 금지된 "Investigate 옵션 신호"를 읽지 **않는다** — Investigate는 옵션을 생산하지 않으며 그런 필드는 schema에 존재하지 않는다):

`upgrade_pressure` = 다음 중 *하나라도* 참:
- `count(compatibility_verdict.issues where severity ∈ {medium, high, fatal}) == 1` (F1의 임계 미만이지만 비자명한 1건의 medium+ 이슈 — 비교/ordering 필요)
- `1 ≤ count(risk_surface where severity ∈ {med}) ` 가 존재하고 `architecture_impact.public_api_changes.length ≥ 1` 가 아닌 비-architecture 위험
- `impact_map.affected_files_count` 가 2~4 (F3 임계 미만이나 자명 1줄 결정이라 보기 어려운 다중 파일 변경)

판정:
- `upgrade_pressure == true` → declared=record 를 **plan 으로 upgrade** (옵션 비교/ordering 필요한 다중 신호).
- `upgrade_pressure == false` → **declared mode 그대로** (record).

### 6. N=0 / 신호 부재 시 동작 (P7: degenerate option count 명시 처리)

비강제 tiebreak에서 *어떤 upgrade 신호도 없을 때*(issues 0건, risk_surface 빈/저위험만, affected_files_count ≤ 1) — 이것은 **합법적 "자명 결정" 상태**다 (principle 3: 빈-합법). Decide는 **declared mode(record)를 그대로 유지**하고 정상 진행한다. 이것은 escalate 사유가 아니다.

> **명시(이전 holes 닫음)**: 과거 계약은 "옵션 1개(자명) vs 옵션 N≥2"로 분기하며 N=0(신호 부재)을 침묵했고, 그 N=0이 바로 Investigate가 옵션을 생산하지 않으므로 *항상 도착하는 입력*이었다. 이제 tiebreak는 옵션이 아니라 *Investigate 실재 필드*를 읽으므로 "N=0"은 곧 "upgrade_pressure=false = 자명한 record"로 **명확히 정의된 경로**다 (P4 + P7).

만약 신호 부재가 *upstream 결손*에서 비롯된 것이라면(필수 필드 자체가 부재/기형) — 그건 위 "Input preconditions"에서 이미 *결정 활동 전에* escalate 로 잡힌다. 따라서 6번에 도달한 시점의 "신호 부재"는 *합법적 빔*임이 보장된다 (principle 3: 빈-합법 vs 빈-결손 분리).

### 7. Mode 확정 후 산출

확정된 mode로 진입하여 아래 "Mode별 활동·산출"을 수행한다.

## Result enum & branches (P1: 성공 분기 포함 전체 result enum 선언)

Decide 출력은 top-level **discriminated result enum**이다 (Investigate의 compatibility_verdict가 `proceed|blocked|...`를 선언한 것과 동일 shape — 실패 분기만이 아니라 **성공 분기도 같은 방식으로 선언**한다). orchestrator는 result별 라우팅 테이블로 라우팅한다.

```
result: decision | reclassify_required | request_upstream_deepen | precondition_fault
```

| result | 의미 | Orchestrator 처리 |
|---|---|---|
| `decision` | **성공 분기** — 실제 결정 산출 (record\|plan\|design mode sub-union 포함) | 다음 step 진입 (Spec/Implement/Verify 체인, mode/flow별) |
| `reclassify_required` | Investigate가 `triage_mismatch` surface → Decide 진행 안 함 | Triage 재invoke (reclassify), reclassify_count cap 3/flow |
| `request_upstream_deepen` | shallow Ground/Investigate로 결정 불가 (Decide 전용 제어 신호) | 해당 step depth=deep 재invoke, cycle cap 1/flow |
| `precondition_fault` | **precondition-fault escalate** — Input-precondition gate가 필수 upstream 필드 부재/기형/enum 무효/ref 미해소 감지 → Decide 미결정 (성공·제어 분기와 배타적) | escalate, `failure_origin ∈ {ground, investigate}` (깨진 upstream). 5-누적 halt cap이 producer⇄reviewer re-entry를 bound |

**제어 신호 소유권 (principle 2)**: `request_upstream_deepen`은 **Decide 전용**이다. 다른 어떤 step도 이 신호를 emit 하지 않는다 — 다른 소비자는 degenerate/missing upstream을 *기존 `failure_origin` escalate*로 라우팅한다. Decide만 1-cycle deepen 권한을 가진다.

### `decision` 분기의 공통 필수 필드 (모든 mode)

```yaml
result: decision
mode: record | plan | design
decision_record: <한 줄 권위 진술>          # 모든 mode 필수
reason: { statement, grounded_in: [investigate/ground row refs], source_tool }   # 모든 mode 필수, 사실 근거
based_on: { investigate_ref, ground_ref }    # 모든 mode 필수 (provenance)
# source_tool (이 파일 전역): R26 provenance floor — 항목을 *생산한* 도구/출처의 이름 (non-empty string). 닫힌 enum이 아니라 도구/출처 식별자다.
#   값 예: Decide 자기-추론 origin은 record-decision|plan-chosen|design-document, 외부 도구는 pyreez|emberdeck|WebFetch|WebSearch 등. fabricated 금지(R22) — 실제 생산 출처만.
depth: shallow | deep                         # record→shallow / plan·design→deep (mode와 일치)
declared_next_step: <R16 advisory>            # orchestrator가 expected_next_step 주입·대조
unverified: <bool>                            # R13 floor, KEEP polarity (Verify로 propagate). 기본 false; Design pyreez 미실행(not_run)/불확정(inconclusive) degrade 분기에서만 true (L220/L222). Record/Plan은 cross-verify 미대상 → 항상 false (단일 producing 규칙, 아래 참조)
followup_flows?: [ ... ]                       # ★ 모든 mode 가용 (아래 "Followup queuing slot" 참조)
```

## Mode별 활동·산출

### Record mode (자명 결정)

**활동**: 결정 1개 + 근거 기록

**산출** (공통 필드 + ):
```yaml
mode: record
# (공통 필드: decision_record, reason, based_on, depth=shallow, declared_next_step, unverified)
followup_flows?: [{ type: bugfix|refactor|feature, scope_ref, scope_hash }]   # Review audit flow 후속 처리 + partial_proceed.blocked_set 큐잉
```

**flow 예**: Chore (typo fix), simple Bug Fix (single approach), Release (자명 version), Review (audit findings)

**Review followup**: Review flow의 Decide.Record가 review findings을 `followup_flows` array로 surface. `(type, scope_hash)` 기준 dedup 강제. Decide-Reviewer가 검증. 자동 실행은 안 함 — orchestrator가 queue.

### Plan mode (옵션 선택)

**활동**: 옵션 N개 비교 + 1 선택 + 우선순위/의존 ordering

**산출** (공통 필드 + ):
```yaml
mode: plan
options_considered: [{ id, approach, trade_offs, est_effort }]   # N ≥ 2. est_effort ∈ {low, medium, high} (상대 effort 척도, 단일 권위 enum — 자유문자열 아님)
chosen: { option_id, rationale }                                  # option_id ∈ options_considered.id
sequencing?: [{ step, depends_on }]   # Compound sub-flow 순서, Migration cycle 순서 등
followup_flows?: [{ type, scope_ref, scope_hash }]   # ★ partial_proceed.blocked_set 큐잉 (아래 참조)
# (공통 필드: decision_record, reason, based_on, depth=deep, declared_next_step, unverified)
```

**flow 예**: Bug Fix Unreproducible (hypothesis 우선순위), Refactor, Migration, Test, Spike, Retro, Exploration

### Design mode (전체 설계)

**활동**: 옵션 deliberation (pyreez) + architecture 결정 + policy/biz rule + 유저 플로우 + 요구사항 + intent card

**산출** (공통 필드 + ):
```yaml
mode: design
options_deliberated: { measured: [...] } | { omitted: { reason, source_tool } }   # pyreez degrade 분기 (아래 도구 참조)
design_document: { architecture, policies, user_flows, requirements }              # 4 sub-part 모두 필수
intent_card: { measured: { card_id } } | { omitted: { reason, source_tool } }      # emberdeck degrade 분기
adr: { title, context, decision, consequences, status }                            # R34. status ∈ {proposed, accepted, deprecated, superseded} (ADR lifecycle, 단일 권위 enum)
cross_verify_required: <bool>                                                       # R5 high-stakes trigger (= true면 cross-verify 실행 의무)
cross_verify_result: agree | disagree | inconclusive | not_run                      # R5 cross-verify 결과 (Design 전용, 아래 산출 규칙). disagree = 자기-오판 신호(L221/L266). 기본 not_run
task_list?: [ ... ]
gate_rules?: [{ condition, action }]        # Compound top-level 한정 — sub-flow 사이 gate 평가용
sub_flow_sequence?: [{ sub_flow_ref, flow_type, depends_on }]   # Compound top-level 한정
followup_flows?: [{ type, scope_ref, scope_hash }]   # ★ partial_proceed.blocked_set 큐잉 (아래 참조)
# (공통 필드: decision_record, reason, based_on, depth=deep, declared_next_step, unverified)
```

**flow 예**: Feature, Performance, plan-standalone, Compound (top-level)

## Followup queuing slot — partial_proceed.blocked_set (P7/원칙③: 큐잉 출력 슬롯을 모든 mode에 일반화)

`followup_flows`는 **세 mode 모두에서 가용한 출력 슬롯**이다 (이전 계약은 Record mode에만 두어, Plan/Design인 partial_proceed flow가 큐잉할 자리가 없었던 hole을 닫음).

두 가지 source가 `followup_flows`로 큐잉된다:

1. **Review/audit surfacing** (Record mode): Review flow가 review findings를 후속 처리로 surface.
2. **partial_proceed.blocked_set 큐잉** (어느 mode든 — 특히 Plan): `compatibility_verdict.result == partial_proceed`이면 Decide는 `partial_scope_handling.proceed_set`을 *실행*하고, `partial_scope_handling.blocked_set`의 각 scope ref를 `followup_flows`로 큐잉한다 (compatibility-verdict.md V13 / L100, L102 강제). Migration 같은 partial_proceed flow는 Plan mode이므로(F-rule이 record를 plan으로 올릴 수 있음) **Plan mode에도 이 슬롯이 반드시 존재해야 한다** — 그래서 일반화했다.

```yaml
followup_flows:
  - type: bugfix | refactor | feature   # 큐잉할 후속 flow 종류
    scope_ref: <row ref to finding/blocked-scope row>   # DECISIONS §5: Postgres step_runs row id, file path 아님
    scope_hash: <stable hash of scope>                    # dedup key
```

- **Dedup**: `(type, scope_hash)` 기준 dedup 강제 (Decide-Reviewer 검증). 중복 (type, scope_hash) 쌍 reject.
- **실행 안 함**: Decide는 *큐잉만* 한다. 자동 실행 금지 — orchestrator가 queue (Reflect 후 또는 gate 후 처리). partial_proceed는 *부분 작업 완료 + 후속 flow 생성*이 정상 종료다.
- **partial_proceed에서 followup 누락 시**: `partial_scope_handling.blocked_set`이 비어있지 않은데 `followup_flows`가 그 blocked_set을 커버하지 못하면 Decide-Reviewer fail (required-field-missing). 부분 완료를 후속 없이 종료하지 않는다.

## 도구 (mode별) + tool-absence routing (principle 1: 도구 역할로 분기)

| Mode | emberdeck | pyreez | 외부 리서치 |
|---|---|---|---|
| Record | (기존 카드 read만) | — | — |
| Plan | (read), `create_card`(spec 단계로 미루어도 가능) | `deliberate` (옵션 비교, **enhancement**) | optional |
| Design | `create_card` (intent), 기존 read | `deliberate` (architecture, ideation, **enhancement**) | yes |

**Decide의 도구 역할 분류 (principle 1):**

- Decide의 **primary "tool"은 LLM 결정 추론 그 자체** — Investigate/Ground 산출물을 읽고 결정을 내리는 것은 외부 MCP에 의존하지 않는다. 따라서 Record/Plan의 옵션 비교는 도구 없이도 가능하다.
- **pyreez = enhancement 도구** (옵션 deliberation / cross-verify). pyreez 부재/error/timeout 시 → **degraded 분기**, escalate 아님 (principle 1: enhancement 부재 → degraded_pass):
  - **`cross_verify_result` 산출 규칙 (Design 전용, 단일 권위)**: `cross_verify_required == true`(Design high-stakes)이고 pyreez가 *동작*하면 Decide는 cross-verify를 *실행*하고 그 결과를 `cross_verify_result`로 **반드시 기록**한다 — pyreez 판정이 결정과 일치=`agree`, 정반대=`disagree`, 불확정=`inconclusive`. pyreez가 *미실행*(부재/error/timeout, 또는 `cross_verify_required == false`)이면 `cross_verify_result: not_run`. 이것이 enum `{agree, disagree, inconclusive, not_run}`의 유일한 producing 규칙이며, 다른 값을 발명하지 않는다.
  - `options_deliberated`를 **Omitted 분기**로 산출: `{ omitted: { reason: "pyreez unavailable", source_tool: "pyreez" } }` (R22 — null/placeholder 생성 금지, 1급 degrade 분기. M3 Measured|Omitted).
  - Decide는 LLM 자체 추론으로 결정을 *진행*하되 `unverified=true` 설정 + `cross_verify_result: not_run` 기록 (Verify가 단일 게이트로 cross-verify 미수행을 인지).
  - **Design mode high-stakes에서 pyreez 불일치**(`cross_verify_result == disagree`, 즉 도구가 *동작했고* 결정과 충돌)는 degrade가 아니라 → **failure_origin=verify escalate** (자기-오판 신호, principle 1: enhancement가 *반대 신호*를 주면 escalate). 단순 부재(not_run)/불확정(inconclusive)과 구분한다 — `agree`/`inconclusive`/`not_run`은 escalate 아님(`inconclusive`는 결정 일치도 충돌도 아니므로 degraded 진행, `unverified=true` 유지).
- **emberdeck (ED) = enhancement 도구** (intent card 생성). ED 부재/error 시 → `intent_card`를 **Omitted 분기**(`{ omitted: { reason, source_tool: "emberdeck" } }`)로 산출. 설계 자체는 성립하므로 degraded_pass — fabricated card id 금지 (R22). Design은 card 미생성으로 *halt 하지 않는다*; Spec/후속이 card 없이 진행하거나 orchestrator가 card 재생성 큐잉.
- **외부 리서치(WebFetch/WebSearch) = enhancement** — 부재 시 degraded (해당 source 없이 결정), escalate 아님.

> **요약 (principle 1)**: Decide의 모든 외부 도구는 *enhancement*다 (primary는 LLM 추론). 따라서 도구 부재는 일관되게 **degraded 분기**이며 escalate가 아니다. *예외 하나*: Design pyreez가 *반대 신호*(disagree)를 내면 그건 부재가 아니라 *불일치*이므로 failure_origin escalate. (Ground의 ED나 Implement/Verify의 firebat처럼 *gate/primary* 도구였다면 부재→escalate였겠지만, Decide에선 ED가 enhancement다.)

## Triage Mismatch 처리

Investigate가 `triage_mismatch`를 surface하면 Decide는:
- 즉시 reclassify trigger — Decide 출력 = **`result: reclassify_required`** (위 result enum 분기 B). 진행 안 함.
- orchestrator가 새 flow type으로 Triage 재진입.

```yaml
result: reclassify_required
reclassify: { mismatch_reason, suggested_flow_type?, triage_mismatch_ref, source_tool }
based_on: { investigate_ref }
```

Triage reclassify cap: flow 당 3회 (`reclassify_count` 0→1→2; 3번째 invoke까지). `reclassify_count ≥ 3` 시 Triage 자체 ambiguous(escalate) → flow halt (failure-routing.md).

## Upstream Deepen Request (Decide 전용 제어 신호 — principle 2)

Decide가 shallow Ground/Investigate 출력으로 결정 불가 시 → Decide 출력 = **`result: request_upstream_deepen`** (위 result enum 분기 C).

```yaml
result: request_upstream_deepen
deepen_request: { target_step: ground | investigate, reason, missing_evidence?: [...], source_tool }   # missing_evidence는 optional (schema 필수 아님 — target_step/reason/source_tool만 필수)
based_on: { ... }
```

orchestrator가 해당 step을 depth=deep로 재invoke.

**Cycle cap**: upstream deepen **1회**(무한 cycle 방지, failure-routing.md "Upstream deepen 1회만"). 그래도 부족 시 Verify가 final safety (`failure_origin=ground|investigate` → reclassify with depth=deep 강제).

**소유권 명시 (principle 2)**: 이 신호는 *Decide만* emit 한다. shallow upstream을 만나는 다른 step은 이 신호 대신 `failure_origin` escalate path를 쓴다.

## Failure & degrade handling (요약)

| 상황 | 분류 | 처리 |
|---|---|---|
| 필수 upstream 필드 부재/기형/enum 무효 (Input preconditions) | mechanical error (principle 3: 빈-결손) | escalate — `failure_origin = investigate \| ground` (어느 필드가 깨졌는지). Decide 미산출. 5-누적 halt cap이 bound. |
| 필수 필드 존재하나 빈 값 (issues=[], risk=[], affected=0) | 합법 verdict (principle 3: 빈-합법) | 정상 진행. record(자명) 또는 force/tiebreak대로. escalate 아님. |
| `compatibility_verdict.result ∈ {blocked, needs_clarification, no_op}` | upstream verdict | **Decide 미실행** (orchestrator mechanical halt). upgrade trigger override 불가. |
| `compatibility_verdict.result == partial_proceed` | 부분 진행 | proceed_set 실행 + blocked_set → `followup_flows` 큐잉. |
| pyreez/emberdeck/외부리서치 부재·error (enhancement, Design) | degraded (principle 1) | Omitted 분기 산출, `cross_verify_result=not_run`, `unverified=true`. escalate 아님. |
| Design pyreez `cross_verify_result == disagree` | 도구 불일치(반대 신호) | **failure_origin=verify escalate** (자기-오판). 단순 부재(not_run)/불확정(inconclusive)와 구분. |
| Design pyreez `cross_verify_result == agree\|inconclusive` | cross-verify 동작·비충돌 | 정상/degraded 진행. `agree`→`unverified=false` 가능, `inconclusive`→`unverified=true` 유지. escalate 아님. |
| Record/Plan mode 정상 산출 (cross-verify 미대상) | 합법 산출 | `unverified=false` (기본). escalate 아님. |
| Investigate `triage_mismatch` surface | 오분류 의심 | `result: reclassify_required`. reclassify cap 3. |
| shallow Ground/Investigate로 결정 불가 | 정보 부족 | `result: request_upstream_deepen` (Decide 전용). cap 1. |

## Adaptive Depth

Step Depth Policy 참조. Decide는 mode 자체가 depth (Record=shallow / Plan=deep / Design=deep). (`medium`은 Depth enum 값이 아니라 아래 wall_s/token budget tier 이름일 뿐이다 — depth 필드는 `shallow|deep` 만 갖는다, common-field 규칙 plan·design→deep와 일치):
- **Record**: wall_s=10, tokens=1k
- **Plan**: wall_s=60, tokens=10k
- **Design**: wall_s=300, tokens=30k

`depth` 필드는 mode와 일치해야 한다 (record→shallow; plan·design→deep). M2 validator가 depth↔mode 일치 검증.

### Mode upgrade triggers (단일 권위 정의 — 두 상충 정의 reconcile)

> **이전 계약 hole 닫음**: 과거 계약은 같은 upgrade trigger를 *두 곳*에서 다르게 정의했다 — (a) Mechanical Force는 `severity ≥ medium 인 issues ≥ 2`, (b) Adaptive-Depth 절은 `issues.length ≥ 2`(severity 필터 없음). 이는 모순이었다 (low-severity 2건이 한쪽에선 Plan-force, 다른 쪽에선 아님). **§"Mode 결정 방식 / 3. Mechanical force (R6)"의 F1~F4가 *유일한 권위 정의*다.** Adaptive-Depth는 그 force 정의를 *참조*만 하며 독립 임계를 두지 않는다.

따라서 upgrade trigger의 단일 권위 정의는:
- **→ Plan** (declared=record일 때): F1 `count(issues where severity ∈ {medium,high,fatal}) ≥ 2` **OR** F2 `any(risk_surface severity ∈ {high,critical})` **OR** F3 `affected_files_count ≥ 5`. (force 미발화 시 비강제 tiebreak의 `upgrade_pressure`가 1-issue/2-4-files 경계를 처리 — §5.)
- **→ Design**: F4 `architecture_impact.has_architecture_level == true` (declared 무관, Plan을 supersede — §4 precedence).
- flow_type 자체로 인한 declared base mode는 flow definition `decide_mode`가 선언 (Refactor/Test/Spike/Retro/Exploration → 통상 plan; Feature/Performance/Migration/plan-standalone/Compound → 통상 design). 이는 *declared base*이며, R6 force가 이를 상향만 할 수 있다 (하향 없음 — depth-monotone).

**Gate 재확인**: 모든 upgrade/force trigger는 `compatibility_verdict.result ∈ {proceed, partial_proceed}`일 때만 평가된다 (그 외엔 Decide 미실행).

## Reviewer (decide-reviewer)

- mode 일치 (declared+force 결과 vs 산출물 mode). M2: 산출 `mode` == R6가 계산한 forced mode.
- **force precedence 적용 확인**: 동시 force 시 Design > Plan > Record 규칙대로 mode 확정됐는지 (§4).
- Record: 결정+근거 1쌍 이상 (decision_record + reason).
- Plan: 옵션 N≥2 비교 + 선택 이유(chosen.option_id ∈ options_considered) + 우선순위(`sequencing?` — optional ordering; 존재 시 depends_on 존재성/acyclic 검증, 필수 아님 — schema/Plan-yaml의 optional이 권위).
- Design: design_document (architecture+policy+userflow+req 4 모두) + intent_card(또는 Omitted 분기 — ED 부재 시 정당) + adr + cross_verify_required.
- **adr.status enum 검증**: `adr.status ∈ {proposed, accepted, deprecated, superseded}` (enum 밖 값 reject).
- **cross_verify_result 정합성** (Design): 값이 enum `{agree, disagree, inconclusive, not_run}` 안에 있는지 + producing 규칙 일치 — `cross_verify_required==true`이고 pyreez 동작 시 `cross_verify_result ∈ {agree, disagree, inconclusive}`(not_run이면 fail: 동작했는데 미기록), pyreez 미실행/`cross_verify_required==false`면 `not_run`이어야 함. `disagree`이면 산출이 `failure_origin=verify escalate` 경로로 갔는지 확인(disagree인데 정상 decision 산출 시 fail).
- **est_effort enum 검증** (Plan): `options_considered[].est_effort ∈ {low, medium, high}`.
- **unverified 정합성**: Record/Plan은 `unverified==false`, Design은 cross_verify_result에 일치(not_run/inconclusive→true, agree→false 가능). polarity 위반 reject.
- 모든 mode: decision_record + reason 필수, ground·investigate 사실에 근거 (reason.grounded_in 실 row 해소).
- **followup_flows dedup** (`type` + `scope_hash`) — 모든 mode에서 검사.
- **partial_proceed 커버리지**: `compatibility_verdict.result == partial_proceed`인데 `partial_scope_handling.blocked_set`이 비어있지 않으면, 그 blocked_set이 `followup_flows`로 큐잉됐는지 확인 (누락 시 fail).
- **degrade 정당성**: `options_deliberated`/`intent_card`가 Omitted 분기이면 해당 도구 부재가 실제였는지(`reason`+`source_tool`) 확인. fabricated 값 reject.
- Compound top-level: gate_rules 명시 + sub_flow_sequence 정의 (둘 다).
- **제어 출력 정당성**: `reclassify_required`는 Investigate.triage_mismatch가 실재할 때만; `request_upstream_deepen`는 cap 1 미초과 + target_step ∈ {ground, investigate}.

## Boundary — Decide가 안 하는 것

| 항목 | 책임 |
|---|---|
| 새 사실 캡처 | Ground |
| 사실 해석 | Investigate |
| 옵션 *신호* 생산 (Decide가 옵션을 *만들고* 비교) | Decide 자신 — 단 Investigate에서 "옵션"을 *읽지 않는다* (Investigate는 옵션 생산 금지). tiebreak는 Investigate 실재 필드(issues/risk/files)만 읽음 |
| AC 추출 (구현 가능 형식) | Spec |
| 코드 변경 | Implement |
| 결정 *결과* 검증 | Verify |
| 학습 추출 | Reflect |
| 제어 신호 *실행* (Triage 재invoke / upstream 재invoke / followup 실행) | Orchestrator (Decide는 *신호/큐잉*만) |

**제어 신호 소유권 재확인 (principle 2)**: `request_upstream_deepen`은 Decide 전용 신호다. Decide는 이를 *emit*하고 orchestrator가 *실행*한다.

## Sub-policies

- [compound-recursion.md](../../legacy/steps/decide/compound-recursion.md) — Compound flow recursion contract (sub-flow self-execution + gate executor + cap)
- [failure-routing.md](../../legacy/steps/decide/failure-routing.md) — failure_origin enum + reclassify cap + 5-누적 halt cap (Verify가 Decide 단계 결정 잘못 발견 시 라우팅)
- [compatibility-verdict.md](../../legacy/steps/investigate/compatibility-verdict.md) — Investigate의 5-state result + partial_proceed.blocked_set (Decide가 followup_flows로 큐잉) + V1-V13
