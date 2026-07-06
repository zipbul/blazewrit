# Decide — Decision Ownership (Universal)

## Definition

> **Decide는 Investigate 산출물 위에서 *결정의 책임자*다.** 모든 flow 필수 (skip 없음). 산출물 깊이는 flow별 *mode*로 선언. Mode = Record | Plan | Design.

Decide는 *결정만* 한다 — 새 사실 캡처(Ground), 사실 해석(Investigate), AC 추출(Spec)을 다시 하지 않는다 (Boundary 참조). Decide의 출력은 하나의 **discriminated result enum**(아래 "Result enum & branches")으로 표현되며, 정상 결정(`decision`)뿐 아니라 제어/escalate 출력(`reclassify_required`, `request_upstream_deepen`, `precondition_fault`, `self_misjudgment`)도 같은 enum의 1급 분기다 (P1: 성공·제어 분기를 *모두* 선언, 실패만 정의하지 않음).

## Inputs

- Investigate 출력 (impact_map, constraints, risk_surface, architecture_impact, compatibility_verdict, ground_unknowns_addressed, sub_flow_identification?, triage_mismatch?)
- Ground 출력 (사실 근거)
- Triage 출력 (의도)
- request_text, conversation_context

## Input preconditions (P8: garbage-in 방어 — 횡단 input-precondition 절)

Decide는 *결정 활동 시작 전에* 필수 upstream 필드의 **존재 + 정형(well-formed)** 을 assert 한다. **이 assertion은 M1 grammar가 아니라 M2/orchestrator gate(`control/precondition-fault`)가 수행한다** — 검사 대상 필드(compatibility_verdict, risk_surface, impact_map, architecture_impact, partial_scope_handling 등)는 *Investigate가 소유*하며 decide.schema.json은 이들의 shape를 담지 않으므로, 정형 검사는 Investigate schema 위에서 orchestrator가 한다(decide grammar가 아니다). 이 절은 "진실"을 검사하지 않는다(그건 Verify 일) — 오직 *결손/기형*을 감지한다. Ground의 `active_flow_state` mechanical-error 패턴을 일반화한 것이다.

필수 입력 (모두 존재 + 정형이어야 함):

| 입력 | 정형 조건 |
|---|---|
| `Investigate.compatibility_verdict` | `result` 필드가 enum `{proceed, blocked, needs_clarification, no_op, partial_proceed}` 중 하나 |
| `Investigate.compatibility_verdict.issues` | array (빈 list 허용 — 빈 list는 *합법적 verdict*이지 결손 아님, 아래 원칙③ 참조). **각 item의 `severity`가 정형이어야 함**: `severity ∈ {fatal, high, medium, low}`(`_defs.SeverityIssue`). non-empty array의 어떤 item이 severity 부재/enum 무효이면 *mechanical error* → escalate. F1 force 입력과 *동일하게* P8 gate(M2/orchestrator, decide grammar 아님 — 이 필드는 Investigate 소유)가 item-level enum 정형을 assert 한다 — F1/F2 및 §5 tiebreak가 `count(... where severity ∈ {...})`를 평가하기 *전에*다. 따라서 기형 severity item이 `where` predicate에서 *조용히 0으로* 빠져 forced mode를 낮추는 garbage-in-as-verdict(L45 금지)을 차단한다 (기형 item → `precondition_fault`, cause=enum-invalid\|missing, failure_origin=investigate) |
| `Investigate.compatibility_verdict.partial_scope_handling` | **`result == partial_proceed`일 때만 필수**(그 외 result에선 부재가 정상). 정형: `{ proceed_set: array, blocked_set: array of { scope_ref, scope_hash } }` — 두 set 모두 존재 + array 타입(둘 다 빈 array 허용). **blocked_set의 각 entry는 `{ scope_ref, scope_hash }`** (coverage validator가 join하는 `scope_hash` member 포함 — bare scope_ref만 있고 scope_hash 부재면 기형). partial_proceed인데 부재/기형(set 부재, 또는 blocked_set entry에 scope_hash 결손)이면 *mechanical error* → escalate (아래 coverage validator가 blocked_set[].scope_hash를 신뢰하기 *전에* P8 gate가 entry 정형을 assert — false-reject/crash 차단; 기형 → `precondition_fault`, failure_origin=investigate) |
| `Investigate.risk_surface` | array of `{ area, severity, ... }` (빈 array 허용). **각 item의 `severity`가 정형이어야 함**: `severity ∈ {low, med, high, critical}`(`_defs.Severity`). non-empty array의 어떤 item이 severity 부재/enum 무효이면 *mechanical error* → escalate (F2 및 §5 tiebreak가 risk_surface severity를 평가하기 *전에*; 기형 item → `precondition_fault`, cause=enum-invalid\|missing, failure_origin=investigate) — issues[].severity와 동일 원칙 |
| `Investigate.impact_map.affected_files_count` | non-negative int (R6 mechanical force 입력) |
| `Investigate.architecture_impact.has_architecture_level` | bool (R6 force 입력) |
| `Investigate.architecture_impact.public_api_changes` | **array** of symbol (빈 array 허용 — Investigate L133 실재 필드; §5 비강제 tiebreak `.length` 입력). F-rule force 입력과 *동일하게* P8 gate(M2/orchestrator, decide grammar 아님)가 정형(=array 타입)을 assert 한다 — 부재/비-array(기형)이면 §5 tiebreak가 `.length`를 평가하기 *전에* `precondition_fault` (failure_origin=investigate)로 라우팅된다. 따라서 §5의 `.length == 0`은 *정형 array에서만* 평가됨이 보장된다 (빈-합법 `[]`은 `.length==0`으로 정상 처리, 기형은 escalate — '빈-합법 vs 기형' 분리) |
| `Investigate.based_on_ground` | Ground 산출물 ref 해소 가능 |
| `Ground` 출력, `Triage` 출력 | 존재 + ref 해소 가능 |

**판별 (principle 3: "정당하게 빔" vs "결손/기형"):**
- 위 필드가 **존재하지만 빈 값**(예: `issues=[]`, `risk_surface=[]`, `affected_files_count=0`) → *합법적 verdict*. Decide 정상 진행 (clean change). 이것은 escalate 사유가 **아니다**.
- 위 필드가 **부재 / 타입 불일치 / enum 무효값 / ref 미해소** → *mechanical error*. Decide는 결정을 산출하지 않고 **escalate** 한다 (P8: failure_origin=investigate 또는 ground, 어느 upstream 필드가 깨졌는지에 따라). 산출은 result enum의 1급 분기 `result: precondition_fault`다 (성공·제어 분기와 배타적 — `decision`/mode payload도, reclassify/deepen payload도 없다):

```yaml
result: precondition_fault
failure_origin: ground | investigate     # 깨진 upstream step (Decide가 읽는 두 upstream에 한정; 공유 FailureOrigin enum의 tightened subset)
faulting_field: <부재/기형 필드명>        # 예: compatibility_verdict.result, risk_surface, compatibility_verdict.issues[].severity
cause: missing | type-mismatch | enum-invalid | ref-unresolved   # 닫힌 enum — 네 가지 mechanical cause (구조적 판정만, 진실/의미 판단 아님). grammar가 BRANCH D에서 이 enum을 강제
detail: <cause의 자유서술 — 어느 precondition이 어떻게 깨졌는지>   # cause의 elaboration (free string); 닫힌 taxonomy는 cause가 보유
based_on: { investigate_ref, ground_ref }  # RowRef bundle — 둘 다 필수 (Decide는 항상 Investigate AND Ground 위에 선다; 빈 based_on:{} 금지). failure_origin이 어느 쪽이 깨졌는지 말하더라도 provenance는 두 read 모두를 가리킨다
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
- `count(risk_surface where severity == med) ≥ 1 AND architecture_impact.public_api_changes.length == 0` (F2 임계 미만의 med 위험이 1건 이상 있되, public API 변경이 없는 — 즉 F4를 발화시키지 않는 비-architecture 위험). `public_api_changes`의 정형(array)은 P8 gate가 이미 assert 했으므로(위 input-preconditions 표) `.length`는 *정형 array*에서만 평가된다 — 기형이면 여기 도달 전에 `precondition_fault`로 escalate됨.
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
result: decision | reclassify_required | request_upstream_deepen | precondition_fault | self_misjudgment
```

| result | 의미 | Orchestrator 처리 |
|---|---|---|
| `decision` | **성공 분기** — 실제 결정 산출 (record\|plan\|design mode sub-union 포함) | 다음 step 진입 (Spec/Implement/Verify 체인, mode/flow별) |
| `reclassify_required` | Investigate가 `triage_mismatch` surface → Decide 진행 안 함 | Triage 재invoke (reclassify), reclassify_count cap 3/flow |
| `request_upstream_deepen` | shallow Ground/Investigate로 결정 불가 (Decide 전용 제어 신호) | 해당 step depth=deep 재invoke, cycle cap 1/flow |
| `precondition_fault` | **precondition-fault escalate** — Input-precondition gate가 필수 upstream 필드 부재/기형/enum 무효/ref 미해소 감지 → Decide 미결정 (성공·제어 분기와 배타적) | escalate, `failure_origin ∈ {ground, investigate}` (깨진 upstream). 5-누적 halt cap이 producer⇄reviewer re-entry를 bound |
| `self_misjudgment` | **self-misjudgment escalate** — Design cross-verify가 *동작*했고 결정과 *충돌*(`cross_verify_result == disagree`) → Decide 미결정 (성공·제어 분기와 배타적, `decision`이 disagree를 실을 수 없음) | escalate, `failure_origin = verify` (자기-오판 신호, Verify self-route — auto-reinvoke 없음). 5-누적 halt cap이 bound |

**제어 신호 소유권 (principle 2)**: `request_upstream_deepen`은 **Decide 전용**이다. 다른 어떤 step도 이 신호를 emit 하지 않는다 — 다른 소비자는 degenerate/missing upstream을 *기존 `failure_origin` escalate*로 라우팅한다. Decide만 1-cycle deepen 권한을 가진다.

### `decision` 분기의 공통 필수 필드 (모든 mode)

```yaml
result: decision
mode: record | plan | design
decision_record: <한 줄 권위 진술>          # 모든 mode 필수
reason: { statement, grounded_in: [investigate/ground row refs], source_tool }   # 모든 mode 필수, 사실 근거
based_on: { investigate_ref, ground_ref }    # 모든 mode 필수 (provenance)
# source_tool (이 파일 전역): R26 provenance floor — 항목을 *생산한* 도구/출처의 이름 (non-empty string, _defs.SourceTool). 닫힌 enum이 아니라 자유 도구/출처 식별자다 — schema도 reviewer도 특정 토큰 집합을 강제하지 않는다 (값 예시는 단지 free-string 예시일 뿐 검증되는 vocabulary가 아니다). fabricated 금지(R22) — 실제 생산 출처만.
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
followup_flows?: [{ source: audit|blocked_scope, type: bugfix|refactor|feature, scope_ref, scope_hash }]   # Review audit flow 후속 처리(source=audit) + partial_proceed.blocked_set 큐잉(source=blocked_scope)
```

**flow 예**: Chore (typo fix), simple Bug Fix (single approach), Release (자명 version), Review (audit findings)

**Review followup**: Review flow의 Decide.Record가 review findings을 `followup_flows` array로 surface. `(type, scope_hash)` 기준 dedup 강제. Decide-Reviewer가 검증. 자동 실행은 안 함 — orchestrator가 queue.

### Plan mode (옵션 선택)

**활동**: 옵션 N개 비교 + 1 선택 + 우선순위/의존 ordering

**산출** (공통 필드 + ):
```yaml
mode: plan
options_considered: [{ id, approach, trade_offs, est_effort, verify_probe? }]   # N ≥ 2. est_effort ∈ {low, medium, high} (상대 effort 척도, 단일 권위 enum — 자유문자열 아님). verify_probe? = R20 optional 재실행 가능 assertion ({command, expected_result}, _defs.VerifyProbe) — M2 validator가 command를 *재실행*해 expected_result와 대조한다 (self-assertion은 진실 아님). 존재 시에만 검사. **불일치 시**: option premise 반증 → Decide-Reviewer reject(producer 재결정) — precondition_fault/self_misjudgment 아님 (아래 Failure & degrade 표 참조)
chosen: { option_id, rationale }                                  # option_id ∈ options_considered.id
sequencing?: [{ step, depends_on }]   # Plan 전용 ordering vocabulary — Migration cycle 순서, Plan-mode sub-task 우선순위 등 (schema: record/design 분기에서 false로 금지)
followup_flows?: [{ source, type, scope_ref, scope_hash }]   # ★ partial_proceed.blocked_set 큐잉(source=blocked_scope) (아래 참조). source ∈ {audit, blocked_scope}
# (공통 필드: decision_record, reason, based_on, depth=deep, declared_next_step, unverified)
```

**flow 예**: Bug Fix Unreproducible (hypothesis 우선순위), Refactor, Migration, Test, Spike, Retro, Exploration

### Design mode (전체 설계)

**활동**: 옵션 deliberation (pyreez) + architecture 결정 + policy/biz rule + 유저 플로우 + 요구사항 + intent card

**산출** (공통 필드 + ):
```yaml
mode: design
options_deliberated: { status: measured, value: [{ id, approach, trade_offs }], source_tool } | { status: omitted, reason, source_tool }   # pyreez degrade 분기 (status 판별 union, _defs.Measured | _defs.Omitted — wrapper key 아님; 아래 도구 참조). Measured.value는 N≥2 (각 item은 { id, approach, trade_offs }) (pyreez가 *동작*했다면 최소 2개 옵션을 deliberate — 0/1개 measured deliberation은 degenerate. 정당한 부재는 Omitted 분기이지 빈 measured array가 아니다)
design_document: { architecture, policies, user_flows, requirements }              # 4 sub-part 모두 필수. 각 sub-part 내부 shape: architecture = { summary, source_tool, components? } (summary·source_tool 필수, components?는 optional string array — R26 provenance: source_tool이 이 architecture 결정을 *생산한* 출처를 명명); policies = [{ rule, scope, exceptions? }] (minItems 1 — rule·scope 필수, exceptions?는 optional string array); user_flows = [string] (minItems 1); requirements = [string] (minItems 1)
intent_card: { status: measured, value: { card_id }, source_tool } | { status: omitted, reason, source_tool }      # emberdeck degrade 분기 (status 판별 union, _defs.Measured | _defs.Omitted — wrapper key 아님)
adr: { title, context, decision, consequences, status, alternatives_considered? }  # R34. status ∈ {proposed, accepted, deprecated, superseded} (ADR lifecycle, 단일 권위 enum). alternatives_considered? = optional array of 고려된 대안 서술 (schema optional)
cross_verify_required: <bool>                                                       # R5 high-stakes trigger (= true면 cross-verify 실행 의무). Design이라도 강제 true 아님 — free bool (schema const-pin 없음, M2 강제 없음): Design은 high-stakes 기본값으로 true를 *권고*하나, pyreez 부재/error/timeout이거나 해당 결정이 cross-verify로 검증할 외부-측정 대상이 없을 때(예: 순수 policy/문서 결정) false가 *정당*하다. false면 producing 규칙상 `cross_verify_result: not_run` + `unverified=true`로 산출된다 (degraded, escalate 아님 — L240/reviewer unverified-polarity). 즉 Design은 cross-verify를 *조용히 opt-out* 할 수 없다: false는 반드시 not_run/unverified=true로 *드러나며* Verify가 단일 게이트로 미수행을 인지한다 (R5 floor는 mitigation이지 elimination이 아니다 — schema cross_verify_required $comment 'Mitigation, not elimination')
cross_verify_result: agree | disagree | inconclusive | not_run                      # R5 cross-verify 결과 (Design 전용, 아래 산출 규칙). disagree = 자기-오판 신호 → `decision` 미산출, `result: self_misjudgment`로 escalate (분기 E). 기본 not_run
task_list?: [{ id, description, parallel_marker, files, depends_on?, affected_files_count?: CountClaim }]   # §10 task 분해 (optional). parallel_marker = R19/R33 (같은 file 공유하는 두 task는 둘 다 false여야 함 — M2 cross-task 검사). affected_files_count = R23 CountClaim(bare int 금지, M2가 raw_stdout에서 재유도). depends_on = task_list[].id 참조 (M2 존재성/acyclic)
compound_top_level?: <bool>                  # Compound top-level discriminant (orchestrator가 flow_type=compound로부터 주입). true면 gate_rules + sub_flow_sequence 둘 다 필수 — 이 conditional-required는 M2 validator(reviewer/compound-toplevel-trigger)가 강제한다 (grammar 아님, trigger 필드)
gate_rules?: [{ condition, action }]        # Compound top-level 한정 (compound_top_level==true면 필수) — sub-flow 사이 gate 평가용. action ∈ {proceed, pivot, abort, retry} (단일 권위 enum). condition = JsonLogic predicate, operator allow-list {==, !=, >, <, >=, <=, and, or, not, in, var} (M2가 grammar validity + var-path 해소 검증, gate executor=orchestrator). cap: pivot 2/compound, retry 1/sub_flow (compound-recursion.md)
sub_flow_sequence?: [{ sub_flow_ref, flow_type, depends_on }]   # Compound top-level 한정 (compound_top_level==true면 필수)
followup_flows?: [{ source, type, scope_ref, scope_hash }]   # ★ partial_proceed.blocked_set 큐잉(source=blocked_scope) (아래 참조). source ∈ {audit, blocked_scope}
# (공통 필드: decision_record, reason, based_on, depth=deep, declared_next_step, unverified)
```

**flow 예**: Feature, Performance, plan-standalone, Compound (top-level)

> **두 ordering vocabulary 분리 (단일 권위 — hole 닫음)**: ordering을 표현하는 필드는 **mode별로 정확히 하나**다. **`sequencing` = Plan 전용** (`{step, depends_on}` — Migration cycle/Plan sub-task 순서), **`sub_flow_sequence` = Design/Compound top-level 전용** (`{sub_flow_ref(RowRef), flow_type, depends_on}` — sub-flow 분해+순서). **vocabulary 분리(어느 필드가 어느 mode에 사는가)는 grammar가 강제한다**: `sequencing`은 record/design 분기에서 `false`로 금지되어 Plan에만 남고, `sub_flow_sequence`는 Design 분기에만 선언된다. 단 **`compound_top_level==true`면 gate_rules+sub_flow_sequence 둘 다 필수**라는 *conditional-required*는 grammar가 아니라 **M2 validator `reviewer/compound-toplevel-trigger`** 가 강제한다 (design 분기는 정적 design 필드만 required로 두고 compound_top_level에 대한 if/then을 두지 않으므로, compound_top_level:true이면서 gate_rules/sub_flow_sequence가 빠진 design은 shape-legal이며 M2에서만 잡힌다 — schema $comment L345의 'true => ... both required (M2)' 와 일치). **왜 Plan flow는 Compound ordering shape가 필요 없나**: sub-flow 분해(자신을 여러 sub-flow로 쪼개는 것)는 Compound top-level의 *Design 책임*이며 — `compound_top_level` discriminant이 그 mode를 Design으로 강제한다(F-rule/flow_type=compound). Plan flow는 sub-flow를 *생성*하지 않고 자기 step/cycle만 ordering 하므로 `{step, depends_on}` 평면 shape로 충분하다. 즉 두 vocabulary는 *겹치는 표현*이 아니라 *서로 다른 ordering 대상*(step vs sub-flow row)이다.

## Followup queuing slot — partial_proceed.blocked_set (P7/원칙③: 큐잉 출력 슬롯을 모든 mode에 일반화)

`followup_flows`는 **세 mode 모두에서 가용한 출력 슬롯**이다 (이전 계약은 Record mode에만 두어, Plan/Design인 partial_proceed flow가 큐잉할 자리가 없었던 hole을 닫음).

두 가지 source가 `followup_flows`로 큐잉되며, 각 entry는 필수 `source` 태그로 구분된다 (`source ∈ {audit, blocked_scope}`). 이 태그가 *coverage join의 disambiguation*이다 — coverage validator는 `source==blocked_scope` entry만 센다. 따라서 audit entry가 우연히 blocked scope와 같은 `scope_hash`를 가져도 coverage를 가짜로 만족시키거나 실제 blocked scope를 혼동시킬 수 없다 (한 슬롯을 공유하지만 두 source는 join에서 분리된다):

1. **Review/audit surfacing** (`source=audit`, 어느 mode든): Review flow가 review findings를 후속 처리로 surface. **mode 제약 없음** — `source=audit`는 Record/Plan/Design 어느 산출에서도 합법이다 (Review flow는 통상 Record지만, audit-surfacing은 mode에 묶이지 않은 출력 슬롯이다; schema의 단일 공유 `followup_flows` 정의가 세 mode 모두에서 `source ∈ {audit, blocked_scope}`를 허용하는 것과 일치 — audit을 Record로 제한하는 grammar 분기도 M2 validator도 없으며, 두지 않는 것이 의도다). coverage join 대상이 아니며 dedup만 적용된다.
2. **partial_proceed.blocked_set 큐잉** (`source=blocked_scope`, 어느 mode든 — 특히 Plan): `compatibility_verdict.result == partial_proceed`이면 Decide는 `partial_scope_handling.proceed_set`을 *실행*하고, `partial_scope_handling.blocked_set`의 각 entry `{ scope_ref, scope_hash }`를 `followup_flows`로 큐잉한다 (compatibility-verdict.md V13 / L100, L102 강제). coverage validator는 `blocked_set[].scope_hash`를 `followup_flows[].scope_hash`에 join하므로 — blocked_set entry의 `scope_hash` member는 P8 gate가 위 input-preconditions 표에서 이미 정형 assert 했다 (bare scope_ref만 있는 entry는 기형 → `precondition_fault`). **proceed_set 처리에는 별도 출력 필드가 없다** — proceed_set은 *결정 자체의 대상 scope*이므로 그 처리 결과는 일반 `decision_record`/`reason`(및 plan이면 `options_considered`/`chosen`) payload로 surface된다. 별도 `proceeded_scope` 슬롯이나 그에 대한 별도 validator는 두지 않는다(blocked_set 만 후속 큐잉이 필요하므로 *비대칭*이 정상 — proceed_set은 큐잉이 아니라 즉시 결정이다). reviewer는 blocked_set 커버리지만 검증한다. Migration 같은 partial_proceed flow는 Plan mode이므로(F-rule이 record를 plan으로 올릴 수 있음) **Plan mode에도 이 슬롯이 반드시 존재해야 한다** — 그래서 일반화했다.

```yaml
followup_flows:
  - source: audit | blocked_scope        # 두 source 구분 — coverage join은 blocked_scope만 센다
    type: bugfix | refactor | feature   # 큐잉할 후속 flow 종류
    scope_ref: <row ref to finding/blocked-scope row>   # DECISIONS §5: Postgres step_runs row id, file path 아님
    scope_hash: <stable hash of scope>                    # dedup key
```

- **Dedup**: `(type, scope_hash)` 기준 dedup 강제 (Decide-Reviewer 검증). 중복 (type, scope_hash) 쌍 reject.
- **실행 안 함**: Decide는 *큐잉만* 한다. 자동 실행 금지 — orchestrator가 queue (Reflect 후 또는 gate 후 처리). partial_proceed는 *부분 작업 완료 + 후속 flow 생성*이 정상 종료다.
- **partial_proceed에서 followup 누락 시**: `partial_scope_handling.blocked_set`이 비어있지 않은데 `followup_flows`가 그 blocked_set을 커버하지 못하면(각 blocked_set entry의 `scope_hash`가 `source==blocked_scope`인 `followup_flows[].scope_hash`에 나타나야 함 — join key; audit entry는 join에서 제외) Decide-Reviewer fail (required-field-missing). 부분 완료를 후속 없이 종료하지 않는다. join이 신뢰하는 blocked_set entry의 `scope_hash` member는 P8 gate가 정형 assert 했다(위).

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
  - `options_deliberated`를 **Omitted 분기**로 산출: `{ status: omitted, reason: unavailable, detail: "pyreez unavailable", source_tool: "pyreez" }` (R22 — null/placeholder 생성 금지, 1급 degrade 분기. M3 Measured|Omitted). `reason`은 닫힌 `_defs.Omitted` enum `{tool_absent, tool_failed, timeout, unavailable, skipped, not_applicable}` 중 하나여야 하며 자유서술이 아니다 — 사람-읽는 원인은 optional `detail`에 둔다.
  - Decide는 LLM 자체 추론으로 결정을 *진행*하되 `unverified=true` 설정 + `cross_verify_result: not_run` 기록 (Verify가 단일 게이트로 cross-verify 미수행을 인지).
  - **Design mode high-stakes에서 pyreez 불일치**(`cross_verify_result == disagree`, 즉 도구가 *동작했고* 결정과 충돌)는 degrade가 아니라 → **`result: self_misjudgment` (failure_origin=verify) escalate** (자기-오판 신호, principle 1: enhancement가 *반대 신호*를 주면 escalate). disagree는 `decision` 분기에 실릴 수 **없다** — 유일한 home이 `self_misjudgment` 분기다 (위 result enum 분기 E; **M2 validator `control/disagree-escalate`** 가 `decision`+disagree를 reject — grammar는 design-mode `cross_verify_result` enum에 disagree를 *허용*하므로 shape-legal이며, disagree를 `decision`에 실은 산출은 오직 M2에서만 잡힌다). 단순 부재(not_run)/불확정(inconclusive)과 구분한다 — `agree`/`inconclusive`/`not_run`은 escalate 아님이며 `decision`(design) 분기에 남는다(`inconclusive`는 결정 일치도 충돌도 아니므로 degraded 진행, `unverified=true` 유지).
- **emberdeck (ED) = enhancement 도구** (intent card 생성). ED 부재/error 시 → `intent_card`를 **Omitted 분기**(`{ status: omitted, reason, source_tool: "emberdeck" }`, `reason`은 닫힌 `_defs.Omitted` enum — 예: `unavailable`)로 산출. 설계 자체는 성립하므로 degraded_pass — fabricated card id 금지 (R22). Design은 card 미생성으로 *halt 하지 않는다*; Spec/후속이 card 없이 진행하거나 orchestrator가 card 재생성 큐잉.
- **외부 리서치(WebFetch/WebSearch) = enhancement** — 부재 시 degraded (해당 source 없이 결정), escalate 아님.

> **요약 (principle 1)**: Decide의 모든 외부 도구는 *enhancement*다 (primary는 LLM 추론). 따라서 도구 부재는 일관되게 **degraded 분기**이며 escalate가 아니다. *예외 하나*: Design pyreez가 *반대 신호*(disagree)를 내면 그건 부재가 아니라 *불일치*이므로 failure_origin escalate. (Ground의 ED나 Implement/Verify의 firebat처럼 *gate/primary* 도구였다면 부재→escalate였겠지만, Decide에선 ED가 enhancement다.)

## Triage Mismatch 처리

Investigate가 `triage_mismatch`를 surface하면 Decide는:
- 즉시 reclassify trigger — Decide 출력 = **`result: reclassify_required`** (위 result enum 분기 B). 진행 안 함.
- orchestrator가 새 flow type으로 Triage 재진입.

```yaml
result: reclassify_required
reclassify: { mismatch_reason, suggested_flow_type?, triage_mismatch_ref, source_tool }
based_on: { investigate_ref }   # reclassify는 triage_mismatch를 surface한 Investigate row *하나만* 가리킨다 — Ground/Triage는 아직 결정에 소비되지 않음. 정확히 investigate_ref 1개(빈 based_on:{} 금지, 추가 ref도 금지 — schema additionalProperties:false). 다른 모든 분기의 "둘 다 필수"와 의도적으로 다른 single-ref 분기다
```

Triage reclassify cap: flow 당 3회 (`reclassify_count` 0→1→2; 3번째 invoke까지). `reclassify_count ≥ 3` 시 Triage 자체 ambiguous(escalate) → flow halt (failure-routing.md).

## Upstream Deepen Request (Decide 전용 제어 신호 — principle 2)

Decide가 shallow Ground/Investigate 출력으로 결정 불가 시 → Decide 출력 = **`result: request_upstream_deepen`** (위 result enum 분기 C).

```yaml
result: request_upstream_deepen
deepen_request: { target_step: ground | investigate, reason, missing_evidence?: [...], source_tool }   # missing_evidence는 optional (schema 필수 아님 — target_step/reason/source_tool만 필수)
based_on: { investigate_ref, ground_ref }   # 둘 다 필수 (Decide는 항상 Investigate AND Ground 위에 선다; 빈 based_on:{} 금지)
```

orchestrator가 해당 step을 depth=deep로 재invoke.

**Cycle cap**: upstream deepen **1회**(무한 cycle 방지, failure-routing.md "Upstream deepen 1회만"). 그래도 부족 시 Verify가 final safety (`failure_origin=ground|investigate` → reclassify with depth=deep 강제).

**소유권 명시 (principle 2)**: 이 신호는 *Decide만* emit 한다. shallow upstream을 만나는 다른 step은 이 신호 대신 `failure_origin` escalate path를 쓴다.

## Self-misjudgment escalate (Design cross-verify disagree — 분기 E)

Design high-stakes cross-verify가 *동작*했고 결정과 *충돌*(`cross_verify_result == disagree`)이면 → Decide 출력 = **`result: self_misjudgment`** (위 result enum 분기 E). 이는 도구 *부재*(degrade)가 아니라 *반대 신호*이므로 `decision`을 산출하지 않고 escalate 한다 (principle 1).

```yaml
result: self_misjudgment
failure_origin: verify                        # 항상 verify (자기-오판, Verify self-route — auto-reinvoke 없음; 공유 FailureOrigin enum의 tightened single value)
cross_verify_result: disagree                 # 항상 disagree — disagree가 실릴 수 있는 유일한 분기 (`decision`은 disagree reject)
detail: <pyreez가 주장한 것 vs Decide가 내린 결정 — 충돌 증거>
based_on: { investigate_ref, ground_ref }     # RowRef bundle — 둘 다 필수 (Decide는 항상 Investigate AND Ground 위에 선다; 빈 based_on:{} 금지)
```

`agree`/`inconclusive`/`not_run`은 이 분기로 오지 않고 `decision`(design) 분기에 남는다. 5-누적 halt cap이 producer⇄reviewer re-entry를 bound 한다.

## Failure & degrade handling (요약)

| 상황 | 분류 | 처리 |
|---|---|---|
| 필수 upstream 필드 부재/기형/enum 무효 (Input preconditions) | mechanical error (principle 3: 빈-결손) | escalate — `failure_origin = investigate \| ground` (어느 필드가 깨졌는지). Decide 미산출. 5-누적 halt cap이 bound. |
| 필수 필드 존재하나 빈 값 (issues=[], risk=[], affected=0) | 합법 verdict (principle 3: 빈-합법) | 정상 진행. record(자명) 또는 force/tiebreak대로. escalate 아님. |
| `compatibility_verdict.result ∈ {blocked, needs_clarification, no_op}` | upstream verdict | **Decide 미실행** (orchestrator mechanical halt). upgrade trigger override 불가. |
| `compatibility_verdict.result == partial_proceed` | 부분 진행 | proceed_set 실행 + blocked_set → `followup_flows` 큐잉. |
| pyreez/emberdeck/외부리서치 부재·error (enhancement, Design) | degraded (principle 1) | Omitted 분기 산출, `cross_verify_result=not_run`, `unverified=true`. escalate 아님. |
| Design pyreez `cross_verify_result == disagree` | 도구 불일치(반대 신호) | **`result: self_misjudgment` (failure_origin=verify) escalate** (자기-오판). `decision`이 disagree를 실을 수 없음 — disagree 전용 분기. 단순 부재(not_run)/불확정(inconclusive)와 구분. |
| Design pyreez `cross_verify_result == agree\|inconclusive` | cross-verify 동작·비충돌 | 정상/degraded 진행. `agree`→`unverified=false` 가능, `inconclusive`→`unverified=true` 유지. escalate 아님. |
| Record/Plan mode 정상 산출 (cross-verify 미대상) | 합법 산출 | `unverified=false` (기본). escalate 아님. |
| Plan `options_considered[].verify_probe` 재실행이 `expected_result`와 불일치 | self-assertion 반증 (도구 불일치 아님 — Decide 자신의 probe) | **Decide-Reviewer reject** (producer⇄reviewer re-entry, 5-누적 halt cap이 bound). `precondition_fault` 아님(upstream 결손이 아니라 Decide의 자기-주장) · `self_misjudgment` 아님(그건 Design pyreez disagree 전용). 산출자가 재결정(반증된 option 제거/교체 또는 expected_result 정정). M2 validator R20. |
| Investigate `triage_mismatch` surface | 오분류 의심 | `result: reclassify_required`. reclassify cap 3. |
| shallow Ground/Investigate로 결정 불가 | 정보 부족 | `result: request_upstream_deepen` (Decide 전용). cap 1. |

## Adaptive Depth

Step Depth Policy 참조. Decide는 mode 자체가 depth (Record=shallow / Plan=deep / Design=deep). (`medium`은 Depth enum 값이 아니라 아래 wall_s/token budget tier 이름일 뿐이다 — depth 필드는 `shallow|deep` 만 갖는다, common-field 규칙 plan·design→deep와 일치):
- **Record**: wall_s=10, tokens=1k
- **Plan**: wall_s=60, tokens=10k
- **Design**: wall_s=300, tokens=30k

`depth` 필드는 mode와 일치해야 한다 (record→shallow; plan·design→deep). M2 validator가 depth↔mode 일치 검증.

### Mode upgrade triggers (단일 권위 정의 — 두 상충 정의 reconcile)

> **이전 계약 hole 닫음**: 과거 계약은 같은 upgrade trigger를 *두 곳*에서 다르게 정의했다 — (a) Mechanical Force는 `severity ≥ medium 인 issues ≥ 2`, (b) Adaptive-Depth 절은 `issues.length ≥ 2`(severity 필터 없음). 이는 모순이었다 (low-severity 2건이 한쪽에선 Plan-force, 다른 쪽에선 아님). **§"Mode 결정 방식 / 3. Mechanical force (R6)"의 F1~F4가 *유일한 권위 정의*다.** Adaptive-Depth는 그 force 정의를 *참조*만 하며 독립 임계를 두지 않는다. 마찬가지로 **x-validator-contract R6도 임계 숫자를 재정의하지 않고 이 단일 권위(F1~F4)를 *참조*한다** — 같은 숫자를 두 권위 사본으로 두는 drift를 막기 위함이며, issues≥2 사례에서 닫은 dual-definition hole과 동일 원칙이다.

따라서 upgrade trigger의 단일 권위 정의는:
- **→ Plan** (declared=record일 때): F1 `count(issues where severity ∈ {medium,high,fatal}) ≥ 2` **OR** F2 `any(risk_surface severity ∈ {high,critical})` **OR** F3 `affected_files_count ≥ 5`. (force 미발화 시 비강제 tiebreak의 `upgrade_pressure`가 1-issue/2-4-files 경계를 처리 — §5.)
- **→ Design**: F4 `architecture_impact.has_architecture_level == true` (declared 무관, Plan을 supersede — §4 precedence).
- flow_type 자체로 인한 declared base mode는 flow definition `decide_mode`가 선언 (Refactor/Test/Spike/Retro/Exploration → 통상 plan; Feature/Performance/Migration/plan-standalone/Compound → 통상 design). 이는 *declared base*이며, R6 force가 이를 상향만 할 수 있다 (하향 없음 — depth-monotone).

**Gate 재확인**: 모든 upgrade/force trigger는 `compatibility_verdict.result ∈ {proceed, partial_proceed}`일 때만 평가된다 (그 외엔 Decide 미실행).

## Reviewer (decide-reviewer)

- mode 일치 (declared+force 결과 vs 산출물 mode). M2: 산출 `mode` == R6가 계산한 forced mode.
- **force precedence 적용 확인**: 동시 force 시 Design > Plan > Record 규칙대로 mode 확정됐는지 (§4).
- Record: 결정+근거 1쌍 이상 (decision_record + reason).
- Plan: 옵션 N≥2 비교 + 선택 이유(chosen.option_id ∈ options_considered) + 우선순위(`sequencing?` — **Plan 전용** optional ordering; 존재 시 depends_on 존재성/acyclic 검증, 필수 아님 — schema/Plan-yaml의 optional이 권위). `options_considered[].verify_probe?`(R20)가 존재하면 **M2 validator가 그 command를 재실행**해 expected_result와 대조한다(자기-주장은 진실 아님) — optional이므로 부재는 정상. 불일치(재실행 결과 ≠ expected_result)면 해당 option premise 반증으로 간주해 **decision reject**(producer 재결정; precondition_fault/self_misjudgment 아님 — Failure 표 참조). `sub_flow_sequence`는 Plan 산출에 나타나면 안 된다(Design/Compound 전용 — schema record/?? 측에서 design 분기에만 선언; Plan은 sub-flow를 분해하지 않음).
- Design: design_document (architecture+policy+userflow+req 4 모두) + intent_card(또는 Omitted 분기 — ED 부재 시 정당) + adr + cross_verify_required.
- **adr.status enum 검증**: `adr.status ∈ {proposed, accepted, deprecated, superseded}` (enum 밖 값 reject).
- **cross_verify_result 정합성** (Design): 값이 enum `{agree, disagree, inconclusive, not_run}` 안에 있는지 + producing 규칙 일치 — `cross_verify_required==true`이고 pyreez 동작 시 `cross_verify_result ∈ {agree, disagree, inconclusive}`(not_run이면 fail: 동작했는데 미기록), pyreez 미실행/`cross_verify_required==false`면 `not_run`이어야 함. `disagree`이면 산출이 `result: self_misjudgment` (failure_origin=verify) 분기로 갔는지 확인 — `decision`에 `cross_verify_result==disagree`를 실은 산출은 reject (**M2 validator** control/disagree-escalate — grammar는 disagree를 shape-legal로 허용하므로 이 거부는 schema가 아니라 M2가 수행한다).
- **est_effort enum 검증** (Plan): `options_considered[].est_effort ∈ {low, medium, high}`.
- **unverified 정합성**: Record/Plan은 `unverified==false`, Design은 cross_verify_result에 일치(not_run/inconclusive→true, agree→false 가능). polarity 위반 reject.
- 모든 mode: decision_record + reason 필수, ground·investigate 사실에 근거 (reason.grounded_in 실 row 해소).
- **followup_flows dedup** (`type` + `scope_hash`) — 모든 mode에서 검사.
- **partial_proceed 커버리지**: `compatibility_verdict.result == partial_proceed`인데 `partial_scope_handling.blocked_set`이 비어있지 않으면, 그 blocked_set이 `followup_flows`로 큐잉됐는지 확인 — join key는 `blocked_set[].scope_hash` → `source==blocked_scope`인 `followup_flows[].scope_hash`이며 blocked_set entry shape `{ scope_ref, scope_hash }`(P8 gate가 scope_hash 정형 assert)에 의존 (누락 시 fail). audit-source entry는 이 join에서 제외되므로 scope_hash 충돌이 커버리지를 혼동시키지 않는다.
- **degrade 정당성**: `options_deliberated`/`intent_card`가 Omitted 분기이면 해당 도구 부재가 실제였는지(`reason`+`source_tool`) 확인. fabricated 값 reject. Measured 분기이면 `options_deliberated.value` N≥2 (grammar 강제 — 0/1개 measured deliberation reject; 부재는 Omitted로만 표현).
- Compound top-level: `mode==design` 이고 `compound_top_level==true`(orchestrator가 flow_type=compound top-level 마커로부터 주입하는 discriminant)이면 gate_rules 명시 + sub_flow_sequence 정의 (둘 다 필수). `compound_top_level` 부재/false면 둘 다 optional — 이 trigger 필드가 conditional-required의 mechanical 트리거다.
- **제어 출력 정당성**: `reclassify_required`는 Investigate.triage_mismatch가 실재할 때만 — `reclassify.triage_mismatch_ref`(필수)가 그 triage_mismatch를 surface한 Investigate row로 해소되는지 확인(미해소/부재 reject); `request_upstream_deepen`는 cap 1 미초과 + target_step ∈ {ground, investigate}; `self_misjudgment`는 Design cross_verify_result==disagree일 때만 + failure_origin==verify; `precondition_fault`는 `cause ∈ {missing, type-mismatch, enum-invalid, ref-unresolved}`(닫힌 enum, grammar 강제) + failure_origin ∈ {ground, investigate} + `detail`은 cause의 자유서술.

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
