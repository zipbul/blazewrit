# Spec — Acceptance Criteria + Code Architecture

## Definition

> **Spec은 Decide 출력에서 *구현 가능한 형식*을 추출한다.** Decide가 어느 mode로 냈든 — Design의 design document, Plan의 option_selection + sequencing + rationale, Record의 decision + rationale — 그 안에 *이미 담긴* 정책·요구사항·접근을 측정 가능한 AC + 코드 architecture (디렉토리/파일 설계, 모듈 경계, 의존 관계) + task 분해 + 의존성 + 순서로 변환한다. **(P4: Decide 3 mode 전체에 일반화 — 정체성을 Decide(Design)에 결박하지 않는다.)**

Plan-as-prompt: Spec 출력이 곧 downstream(Test/Implement) 실행 프롬프트.

**Spec은 결정·설계를 *다시 하지 않는다*.** AC는 Decide가 *이미 선택·결정한 것*을 implementable form으로 푸는 것이지, 새 정책·새 architecture 선택·새 옵션을 만드는 것이 아니다. Decide가 어떤 architecture를 골랐으면 Spec은 그것을 파일/모듈/의존으로 *기계적으로 전개*할 뿐, 다른 architecture를 제안하지 않는다. **(P4 / Boundary: Spec ≠ Decide. design re-derivation 금지.)**

## Inputs

- **Decide 출력 (필수, mode 무관)** — Spec은 셋 중 무엇이든 받아 AC를 추출한다 **(P4)**:
  - `mode=design`일 때: design document (chosen_architecture, policies, user_flows, requirements, intent_card_id)
  - `mode=plan`일 때: option_selection (`chosen`), `options_considered`, `sequencing`, rationale
  - `mode=record`일 때: `decision`(한 줄) + `rationale`
- Investigate 출력 (constraints, risk_surface, compatibility_verdict.issues) — *optional enrichment* (edge_case 우선순위·제약 출처). greenfield 등 Investigate degenerate 체인에서는 비어 있을 수 있다.
- Ground 출력 (task_subgraph, volatile_state) — 실재 path/심볼 근거.
- 모든 ref는 §5 RowRef (Postgres step_runs row id) — `based_on.{decide_ref, investigate_ref, ground_ref}`.

**Mode별 AC 추출 규칙 (P4: Design 전용 가정 제거)**:

| Decide mode | AC 추출 원천 | intent-card 링크 |
|---|---|---|
| design | `policies[]` + `requirements[]` + `user_flows[]` → 각각 1+ AC | `intent_card_id` 존재 → spec card가 link (조건부) |
| plan | `chosen.approach` + `sequencing[]` → 구현 단위별 AC; `options_considered`는 *맥락만* (재선택 금지) | intent card 없음 → spec card는 **degrade(omitted)** 가능 |
| record | `decision` 한 줄 → 그 결정을 만족시키는 최소 AC(들) | intent card 없음 → spec card **degrade(omitted)** 가능 |

> **intent-card 링크는 Design 조건부다.** `decide.intent_card_id`가 존재할 때만 spec card가 그 intent card에 codeLink로 연결된다. Plan/Record는 intent card가 없으므로 링크 활동 자체가 *없음* — 부재가 에러가 아니다. **(P4: intent-card linkage = Design-conditional)**

## Activities

1. **AC 추출** — Decide가 mode 무관하게 *결정·확정한* 정책/요구사항/접근을 측정 가능한 acceptance criterion으로 변환 (id, statement, measurement, edge_cases). 새 정책·설계를 만들지 않는다. **(P4)**
2. **코드 architecture 설계** — 디렉토리/파일 배치, 모듈 경계, 의존 그래프. 실재 path 사용 (`change_kind` ∈ create|modify|read). Decide가 architecture를 골랐으면 그것을 전개; 안 골랐으면(Plan/Record) chosen approach + Ground task_subgraph로부터 *전개*하되 새 architecture를 *선택*하지 않는다.
3. **Task 분해** — implementable 단위로 쪼개기 (single concern per task). id, description, depends_on, ac_refs, file_paths, parallel_marker.
4. **순서·의존** — task ordering, blocking relation (acyclic 강제 — M2 validator가 topological sort).
5. **(Design 조건부) emberdeck spec card + codeLinks** — `decide.intent_card_id`가 존재할 때만, spec card를 생성하고 design document의 intent card에 link. emberdeck 부재/실패 시 degrade. **(P4 조건부 + P2 enhancement degrade)**

## Result enum & branches (P1: 성공 분기를 실패 분기와 *함께* 선언)

> Spec 출력은 `result` discriminant 위의 **discriminated union**이다 — Investigate의 compatibility_verdict (proceed | blocked | needs_clarification | no_op) 패턴을 *그대로 재사용*한다 (새 메커니즘 발명 0). 한 branch만 채워진다(grammar 강제). **(P1: success branch를 first-class로 선언; P7/principle 3: 빈-합법 vs 빈-결손 구분)**

| result | 의미 | payload (필수 필드) | orchestrator 처리 |
|---|---|---|---|
| **proceed** | 정상 spec 산출 (유일하게 AC/architecture/tasks/spec_card_id를 담는 branch) | `acceptance_criteria` (≥1), `code_architecture`, `tasks` (≥1), `spec_card_id` | Spec → Test/Implement 진입 |
| **needs_clarification** | HITL 답 없이 finalize 불가 (legacy `[NEEDS CLARIFICATION]`, max 3) | `clarifications: [{ question, blocks_ac, source_tool }]` (1–3) | NEEDS_CONTEXT → user 응답 후 Spec 재invoke (clarification 누적). Reflect 분류 = suspended |
| **blocked** | upstream 계약이 불충족/상충/누락 — Spec 자기 잘못 아님 | `blocked_reason` ∈ {conflicting_policy, unsatisfiable_requirement, missing_upstream, compatibility_blocker}, `detail`, `attributed_step` (StepName), `source_tool` | `failure_origin=<attributed_step>`로 escalate — orchestrator가 해당 step ⇄ reviewer 재진입 (failure-routing) **(P8 / principle 2)** |
| **no_op** | spec 낼 게 *합법적으로* 없음 | `reason` ∈ {non_code_flow, no_implementable_surface}, `detail?`, `source_tool` | Spec → Test → Implement *skip*. Reflect 분류 = abandoned/completed (flow별) |

**branch 선택 규칙 (mechanical, V1-V13 류)**:
- S1. Decide 출력이 구현 가능한 surface를 담고(어느 mode든) AC 추출이 1개 이상 가능 → **proceed**.
- S2. flow가 비코드/문서/exploratory라서 *원래* 구현 surface가 없음(예: Decide.Record가 "문서만 갱신" 같은 합법적 non-code 결정) → **no_op(non_code_flow)**. *합법적 빔* — escalate 아님. **(principle 3)**
- S3. Decide가 코드 flow인데 implementable surface가 *전혀 안 나옴*(예: design document·option·decision이 모두 텅 비었거나 상충) → **blocked** with `blocked_reason=missing_upstream`(텅 빔) 또는 `conflicting_policy`(상충). *결손/기형 빔이지 합법 no_op이 아님* — escalate. **(P7 / principle 3: 빈-결손은 mechanical error)**
- S4. AC 추출은 됐으나 특정 정책·요구사항이 사람 결정 없이는 측정 가능하게 못 됨(애매) → **needs_clarification** (max 3).

## Failure & degrade handling

### 입력 precondition fault → blocked escalate (P8 / principle 3)

Spec은 upstream을 *진실*로 검증하지 않는다(그건 Verify 일). 하지만 *존재 + 정형*은 intake에서 assert한다 — Ground의 active_flow_state mechanical-error 패턴을 일반화한 **단일 횡단 input-precondition 절**(아래 "Input preconditions"). 결손/기형이면 `result=blocked` + `failure_origin`으로 escalate하며, **`request_upstream_deepen`을 emit하지 않는다** — 그 제어 신호는 Decide 전용이다. **(principle 2: control-signal ownership)** ping-pong은 기존 (flow_id, step) 5-누적-fail halt cap이 bound한다 (failure-routing.md).

### emberdeck (enhancement tool) 부재/실패 → degrade, NOT escalate (P2 / principle 1)

emberdeck(create_card + codeLinks)는 Spec의 **enhancement** 도구지 primary 도구가 아니다 — spec card는 추적 보조물이고, AC/architecture/task는 emberdeck 없이도 전부 산출된다. 따라서 principle 1에 따라 **부재 = degraded branch**(escalate 아님):

- `spec_card_id`는 `Measured | Omitted` (M3 degrade) 형태다.
  - emberdeck attached + (Design일 때) intent card 존재 → `{ status: measured, value: <card id>, code_links?: [...] }`.
  - emberdeck unattached/실패/timeout, **또는** Decide mode가 plan/record라 intent card가 없음 → `{ status: omitted, reason: unavailable|tool_failed|not_applicable, source_tool: "emberdeck" }`.
- **null·placeholder·`# 강제` 금지** (R22). 부재의 유일한 합법 표현은 구조 완전한 Omitted 객체다. **(P2: enhancement 부재 = 정의된 omitted branch, silence 아님)**
- spec_card_id가 omitted여도 `result`는 여전히 **proceed**일 수 있다 — spec card는 게이트가 아니다. (대조: ED=Ground primary→escalate, firebat=Implement/Verify 게이트→escalate. emberdeck@Spec은 enhancement→degrade.) **(principle 1)**

### AC/task 폭발 (cap 초과)

Spec 자체는 mode→depth가 아니라 depth caps(wall_s/tokens)만 갖지만, 분해가 폭발할 때의 동작을 정의한다:
- AC 또는 task 수가 단일 Spec invoke로 측정 가능하게 다 못 담길 정도면(caps 소진 임박) → Spec은 **부분 산출하지 않는다**. `result=blocked` + `blocked_reason=unsatisfiable_requirement`(또는 `missing_upstream`) + `detail="decomposition exceeds single-spec budget; upstream Decide(Design) scope too broad — split flow"` 로 escalate한다. **(P8: 분기 열고 닫음 — caps-hit에 정의된 동작)**
- 이는 Compound/Migration cycle 분할 신호로 orchestrator에 전달된다(별도 sub-flow). Spec이 임의로 잘라 *조용히 일부만 proceed*하지 않는다. **(principle 3: 부분 빔을 rubber-stamp 금지)**

### caps 소진 (mid-activity)

wall_s/tokens가 모든 정책에 AC를 붙이기 전에 소진되면 → `result=blocked` + `blocked_reason=unsatisfiable_requirement` + `detail`에 미완 범위 기록. 부분 proceed 금지(위와 동일 원리).

## Input preconditions (P8: garbage-in 맹신 제거 — 단일 횡단 절)

Activity 진입 전, Spec은 필수 upstream 필드의 *존재 + 정형*을 mechanical하게 assert한다 (진실성 아님 — 그건 Verify). 실패 시 즉시 `result=blocked` + `failure_origin=<attributed_step>`. **(P8 / principle 2: Decide-아닌 소비자는 failure_origin escalate, request_upstream_deepen 아님)**

| precondition | 검사 | 위반 시 |
|---|---|---|
| `decide_ref` 존재 + Decide row 해소 | row가 step_name=decide로 resolve | blocked(missing_upstream, attributed_step=decide) |
| Decide payload이 mode에 맞는 surface 보유 | design→design document / plan→chosen+sequencing / record→decision (해당 mode 필드가 비어있지 않음) | blocked(missing_upstream, attributed_step=decide) **(principle 3: 빈-결손)** |
| `ground_ref` 존재 + task_subgraph 보유 | row resolve + task_subgraph 비어있지 않음(architecture path 근거 필요) | blocked(missing_upstream, attributed_step=ground) |
| Decide constraint vs Investigate constraint 무모순 | 동일 scope에 상충하는 두 제약 없음 | blocked(conflicting_policy, attributed_step=decide) — Spec은 *어느 쪽이 이긴다*고 결정하지 않는다(그건 Decide 일); 모순을 surface하고 Decide로 라우팅 **(P8 + Boundary: Spec ≠ Decide)** |
| `compatibility_verdict`가 fatal issue를 담지 않음 | Investigate가 fatal issue surface 시 | blocked(compatibility_blocker, attributed_step=investigate) |

**deepen trigger 입력 guard**: deepen trigger 중 `Investigate.compatibility_verdict.issues.length ≥ 2`는 그 필드가 *존재 + 정형*일 때만 평가된다. Investigate degenerate(greenfield 등)라 `compatibility_verdict`가 비어/부재면 → 그 trigger는 *조용히 false*(누락이 deepen을 강제하지 않음). 다른 deepen trigger(flow_type, Decide.mode=design)는 독립적으로 평가된다. **(P8: 절대 absent 필드를 정형으로 가정하지 않음)**

**합법적 빈 입력 vs 결손 빈 입력 (principle 3)**:
- *합법*: Decide.Record가 "문서/config만, 코드 없음"을 결정 → Spec은 `no_op(non_code_flow)` (escalate 아님, AC 발명 아님).
- *결손*: Decide row가 있는데 payload가 텅 비었거나 mode 필드가 누락 → `blocked(missing_upstream)` escalate.
- Spec은 둘째를 첫째로 *조용히 rubber-stamp하지 않는다*. AC를 *발명*하지도 않는다(R14 fail-loud). 빈 AC로 proceed도 안 한다 — proceed branch는 `acceptance_criteria` ≥1을 강제한다.

## Output

> 출력은 `result` branch 하나. 아래는 **proceed** branch (유일하게 AC/architecture/tasks 담음). 다른 branch는 "Result enum & branches" 표의 payload만 담는다.

```yaml
result: proceed
acceptance_criteria:            # ≥1 강제 (빈 AC로 proceed 불가)
  - id            # ^AC-[0-9]{3,}$
    statement     # "When {condition}, then {observable outcome}" — minLength 가드
    measurement   # ↓ verify_probe 형태로 정의 (P6)
    edge_cases    # ↓ cardinality 정의 (P6)
    verify_probe: { command, expected_result }   # R20 — measurement의 기계 실행 형태
    source_tool   # provenance: 이 AC가 추출된 Decide 원천 (design-document|plan-chosen|record-decision)
    unverified    # R13 KEEP 극성 — Spec이 직접 검증 못 한 AC는 true로 propagate
code_architecture:
  directories: [{ path, purpose?, existing }]
  files: [{ path, purpose, exports, change_kind: create|modify|read, change_summary? }]
  module_boundaries: [{ module, responsibility, owns? }]
  dependencies: [{ from, to, kind: internal|external }]
tasks:                          # ≥1 강제
  - id              # ^T-[0-9]{3,}$
    description     # single concern
    depends_on      # [task id], acyclic (M2)
    ac_refs         # ≥1, 모든 ac_ref는 실재 AC id (M2 referential integrity)
    file_paths      # ≥1 — R33 same-file 상호배타 입력
    parallel_marker # bool — R33
spec_card_id:                   # M3 degrade — Measured | Omitted (P2)
  # measured: { status: measured, value: <card id>, code_links?: [...] }
  # omitted:  { status: omitted, reason: unavailable|tool_failed|not_applicable, source_tool: emberdeck }
files_to_read?: [<path>]        # plan-as-prompt: Test/Implement가 읽을 실재 source path (READ 입력, §5 ref 아님)
based_on: { decide_ref, investigate_ref?, ground_ref }   # §5 RowRef. decide_ref/ground_ref 필수
declared_next_step              # R16 advisory — orchestrator가 expected_next_step 주입, M2 대조
```

### `measurement` 필드 정의 (P6: measurement = verify_probe 형태)

`measurement`는 자유 산문 TBD가 아니다 — reviewer가 "mechanical assertion 가능"을 요구하므로, **각 AC는 R20 `verify_probe { command, expected_result }`를 동반**한다 (이미 상류에 존재하는 mechanical-assertion 기계). `measurement` string은 *측정 방법*(단위·assertion target)을 서술하고, `verify_probe`가 그것을 *재실행 가능한 명령*으로 못박는다. **(P6: measurement → R20 verify_probe로 wiring)**

- `verify_probe.command` = 그 AC가 만족됐는지 재증명하는 명령 (예: `bun test path/to.spec.ts -t 'AC-001'`, `grep -c 'export' file`, `curl ...`).
- `verify_probe.expected_result` = 재실행이 내야 하는 결과 (예: `"exit 0, 1 passing"`, `"exactly 1 match"`).
- **본질적으로 측정 불가능한 정책** (예: "코드가 읽기 좋아야 한다")은 그대로 AC가 될 수 없다 → Spec은 측정 가능 형태로 환원하거나(예: "공개 심볼당 doc-comment 존재" → `grep`), 환원 불가면 `result=needs_clarification` (사람이 측정 기준 제시). **AC를 측정 불가인 채 발명하지 않는다.** **(P6 + R14 fail-loud)**
- 진실성(probe가 실제로 통과하는지)은 Spec이 self-assert하지 않는다 — M2 validator가 `verify_probe`를 *재실행*해 `expected_result`와 대조한다 (sibling validator_contract). Spec은 SHAPE만 책임진다.

### `edge_cases` cardinality 정의 (P6)

`edge_cases`는 AC당 **required array** (필드 자체는 필수 — 모델이 "엣지 고려"를 조용히 건너뛸 수 없음). **빈 array는 허용** — 진짜로 엣지가 없는 AC가 존재하기 때문(예: 상수 export 존재 여부). 즉 *필드 존재는 강제, 내용은 0개 허용*. 각 원소는 boundary/exception/null/permission/state-transition 중 하나를 서술하는 non-empty string. **(P6: cardinality = required field, empty-allowed, per-element minLength 1)**

## Step Depth Policy

| Depth | 활동 | 산출 (P8: Shallow output 모순 제거) | Caps |
|---|---|---|---|
| Shallow | AC list 중심 — architecture/task는 *최소* (단일 파일/단일 task 수준) | **proceed branch 전체 필드 산출** — `acceptance_criteria`(≥1) + `code_architecture`(최소이나 비어있지 않음) + `tasks`(≥1) + `spec_card_id`(degrade 가능) + `based_on` + `declared_next_step`. *어느 필드도 생략하지 않는다.* | wall_s=30, tokens=5k |
| Deep | AC + 전체 코드 architecture + task decomposition + (Design 시) codeLinks | 동일 필드, 깊이만 증가 | wall_s=240, tokens=25k |

> **Shallow vs Output 모순 해소 (P8)**: 원 contract는 "Shallow = AC list만"이라 했으나 Output block은 `code_architecture/tasks/spec_card_id`를 무조건 보였다 — 모순. 해소: **proceed branch의 required 필드 집합은 depth와 무관하게 동일**하다(grammar가 강제). Shallow는 *필드를 생략*하는 게 아니라 각 필드를 *얕게*(architecture=대상 파일 1–2개, tasks=1개) 채운다. 어느 depth에서도 빈 `acceptance_criteria`/`tasks`로 proceed 불가. depth가 줄이는 건 *내용의 깊이*지 *스키마 모양*이 아니다.

**Deepen triggers (OR)**:
- `flow_type ∈ {Feature, Migration, Performance, Compound}`
- `Decide.mode = design`
- `Investigate.compatibility_verdict.issues.length ≥ 2` *(단, compatibility_verdict가 존재+정형일 때만 평가 — 위 Input preconditions의 deepen guard 참조)* **(P8)**

## Reviewer (spec-reviewer)

- result branch가 V-룰 류 mechanical 규칙(S1–S4)을 따르는가 (proceed면 AC≥1·tasks≥1 강제, 빈 AC로 proceed 아님)
- 모든 정책/요구사항이 (mode 무관하게 Decide 원천에서) AC로 변환됐는가 — coverage (모든 policy → ≥1 AC)
- AC 측정 가능한가 — 각 AC에 `verify_probe { command, expected_result }` 존재 (P6); measurement가 mechanical assertion으로 환원됨
- `edge_cases` 필드가 매 AC에 존재 (내용 0개 허용) (P6)
- 코드 architecture (디렉토리/파일) 명확 + path 실재 (modify/read는 on-disk, create는 면제 — M2)
- task 분해 빠짐없는가 — 모든 AC가 ≥1 task.ac_refs에 커버 (M2 referential integrity), task graph acyclic
- `based_on`이 입력 계약에 맞게 조건부 — `decide_ref`/`ground_ref` 필수, `investigate_ref`는 Investigate 있는 체인에서 필수 **(P3-류 conditional provenance)**
- **(Design 조건부)** `decide.intent_card_id` 존재 시에만 emberdeck spec card 생성 + codeLinks 매핑 검증; Plan/Record거나 emberdeck 부재면 `spec_card_id`가 Omitted인지 확인 (omitted를 결함으로 보지 않음) **(P2 / P4)**
- blocked/needs_clarification/no_op branch면 해당 필수 payload(blocked_reason+attributed_step / clarifications / reason) 존재 + Spec이 *boundary 침범 없이*(설계 재선택·AC 발명 없이) 도달했는가

## Boundary — Spec이 안 하는 것

| 항목 | 책임 |
|---|---|
| 결정·옵션 deliberation·재선택 | Decide |
| **architecture/policy 선택 (re-derive)** | Decide(Design) — Spec은 *전개*만 **(P4)** |
| 상충 제약의 *승자 결정* | Decide — Spec은 모순을 surface하고 blocked로 라우팅 |
| 사실 캡처 | Ground |
| 해석·영향 분석 | Investigate |
| upstream 사실의 *진실성* 검증 (존재/정형 assert만 함) | Verify |
| Test 작성 | Test |
| 코드 작성 | Implement |
| follow-up flow 라우팅/큐잉 | orchestrator (Spec은 blocked로 *신호*만) |

## Depth & 제어 신호 소유권 (요약)

- Spec은 `request_upstream_deepen`을 **emit하지 않는다** — 그 신호는 Decide 전용이다. Spec의 upstream 결손 대응은 `result=blocked` + `failure_origin` escalate (failure-routing 재진입)뿐이다. **(principle 2)**
- escalation ping-pong은 (flow_id, step) 5-누적-fail halt cap + producer⇄reviewer 3-fail cap이 bound한다 (failure-routing.md) — 그래서 input-precondition escalate가 무한 루프를 못 만든다. **(P8 안전성 근거)**

## Sibling 메커니즘 (이 contract가 *재사용*하는 것 — 발명 0)

- result discriminated union + orchestrator 라우팅 테이블 ← Investigate compatibility_verdict (proceed|blocked|needs_clarification|no_op). **(P1)**
- `spec_card_id` Measured|Omitted ← M3 DegradableMeasurement (R22 placeholder 금지). **(P2)**
- `verify_probe` ← R20 (measurement의 재실행 형태). **(P6)**
- `failure_origin` escalate + producer⇄reviewer 재진입 + 5-누적-fail halt cap ← failure-routing.md. **(P8)**
- `based_on` RowRef + conditional 키 ← §5 / BasedOn. **(P3-류)**
- `declared_next_step` advisory + orchestrator 주입 ← R16. M2 validator(verify_probe 재실행, ac_refs/depends_on referential integrity, task graph acyclicity, path 실재, RowRef 해소)는 SHAPE 밖 — sibling 책임(이 contract는 TRUTH를 self-assert하지 않음).
