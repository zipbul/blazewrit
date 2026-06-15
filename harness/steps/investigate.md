# Investigate — Task-Specific Interpretation

> Successor contract. Same section structure as `legacy/steps/investigate/README.md`, with every
> documented hole closed and three new sections added where the holes demand them:
> **Result enum & branches**, **Failure & degrade handling**, **Input preconditions**.
> Each fix is tagged inline with the pattern (P1–P8) or cross-cutting principle it applies.

## Definition

> **Investigate는 Ground 사실을 *설계 가능한 문제 정의*로 해석한다.** 영향·제약·위험·호환성. *옵션 안 만듦, 결정 안 함* (Decide 책임). 새 사실 캡처 안 함 (Ground 책임).

Investigate는 *interpret/impact/verdict*만 한다 — 옵션 생성·결정·설계·AC 추출·사실 캡처는 모두 경계 밖
(STAY IN LANE: Investigate = interpret/impact/verdict; no options, no design, no fact-capture).

## Inputs

- Ground 출력 (task_subgraph, volatile_state, unknowns, conflicts, provenance, freshness)
- Triage 출력 (flow_type, classification_metadata, clarifications)
- request_text, conversation_context

각 입력은 **소비 전에 Input preconditions 절의 mechanical assert를 통과해야 한다** (P8: garbage-in 방어).
precondition 위반은 *해석 결과가 아니라 mechanical error* — 아래 **Input preconditions** 참조.

## Activities

```
1. Impact 추적          ED traversal from entry_nodes — callers/callees/data flow
2. Constraint 식별       정책·컨트랙트·보안 자세에서 도출
3. Risk surface         실패 모드 (impact × Ground concerns) — severity + probability + evidence
4. Validity 검사         Ground 사실 vs Triage 의도 target 비교 — task가 진짜 의미 있나? (no-op 감지)
5. Compatibility 판정    명백 호환성 + Validity 결과 → proceed | blocked | needs_clarification | no_op | partial_proceed
                        (도달 가능성·옵션 의존 판단은 Decide 영역)
6. Unknown disposition   Ground unknowns 각각 → 7 disposition 중 1 분류 (matrix 기반, 명시 rationale)
7. Triage-mismatch surface (조건부) Ground 사실이 Triage flow_type과 모순되면 triage_mismatch 산출 (아래 production rule)
```

**Activity 0 — Input precondition gate (모든 다른 activity보다 먼저, mechanical):**
Activity 1~7을 시작하기 전에 **Input preconditions** 절의 assert를 실행한다. 실패 시 어떤 해석도
수행하지 않고 mechanical error 출력으로 즉시 종료한다 (principle 3: 결손 입력 = mechanical error, 빈
해석 verdict 아님).

## Validity 검사 — Flow별 No-op 조건

> **전제**: 이 표의 각 행은 *해당 Ground 필드가 존재하고 정형*일 때만 평가된다.
> 필드가 **부재/기형**이면 no-op 판정이 아니라 mechanical error다 — **Input preconditions** 절에서 escalate
> (principle 3 + P8). "필드가 존재하고 값이 비어/동일 = 합법적 no-op", "필드 자체가 없음 = 결손→escalate"를
> 명확히 구분한다.

> 이 표는 canonical flow_type 16개 *전부*를 덮는다 (PC3 통과 flow는 반드시 여기 행이 있다 — silent 미정의 0). No-op 조건이 *구조적으로 성립할 수 없는* flow는 명시적 **N/A (no no-op 조건)** 행으로 표기하여 "표에 없음 = 미정의"를 막는다.

| Flow (canonical stem) | No-op 검출 (필드 존재 전제) | no_op_details.suggested_action (P6: action 매핑) |
|---|---|---|
| `performance` | Ground.volatile.perf_baseline ≤ Triage 요청 target | `abandon` (목표 이미 충족, 재요청 불필요) |
| `migration` | Ground.dependency_audit이 이미 target version 보여줌 | `abandon` (이미 target version) |
| `bugfix` | Ground 또는 reproduce 시도에서 bug 재현 불가 (이미 fix됨) | `abandon` (이미 수정됨) |
| `bugfix-p0` | Ground 또는 reproduce 시도에서 bug 재현 불가 (이미 fix됨) | `abandon` (이미 수정됨) |
| `bugfix-unreproducible` | **N/A** — 이 flow의 *전제 자체가* reproduce 실패다(재현 불가). 따라서 reproduce 실패는 no-op 트리거가 아니라 flow 진행 조건이며, 구조적 no-op 조건이 없다(증상 소멸/이미 수정 여부 판단은 deepen impact 분석으로 처리, no_op 미적용) | (no-op 없음) |
| `refactor` | 코드가 이미 target 패턴 준수 | `abandon` (이미 준수) |
| `chore` | 변경 target이 이미 원하는 상태 (typo 없음 등) | `abandon` (이미 원하는 상태) |
| `feature` | Ground.task_subgraph에 기능 이미 구현 표시 | `abandon` (이미 구현됨) |
| `test` | Ground.coverage가 이미 target 충족 | `abandon` (이미 커버됨) |
| `release` | git log(=Ground.volatile)에 신규 commits 없음 | `wait_for_change` (변경 발생 시 재시도 가능) |
| `spike` | **N/A** — spike는 feasibility 탐색이라 "이미 충족" no-op 조건이 구조적으로 없음 (결과는 feasibility verdict; no_op 미적용) | (no-op 없음) |
| `review` | **N/A** — review는 read-only 평가라 변경 대상이 없어 no-op 조건 없음 | (no-op 없음) |
| `retro` | **N/A** — retro는 회고 산출물이라 코드베이스 사실 대비 no-op 조건 없음 | (no-op 없음) |
| `exploration` | **N/A** — exploration은 개방형 조사라 "이미 충족" 목표가 없어 no-op 조건 없음 | (no-op 없음) |
| `plan-standalone` | **N/A** — plan-standalone은 계획 산출이라 변경 대상 사실이 없어 no-op 조건 없음 | (no-op 없음) |
| **`compound` (집계)** | **모든 sub-flow가 각자 no_op** (각 sub-flow는 자기 flow_type 행으로 판정) — 즉 sub_flow_verdicts의 result가 *전부* no_op일 때에만 Compound 전체가 no_op (P7/principle 3: Compound aggregate no-op 규칙) | `abandon` (모든 sub-flow가 무의미) |

**no_op suggested_action 매핑 규칙 (mechanical, P6: enum value selection 정의):**
- `abandon` ← 목표가 *이미 영구히* 충족된 no-op (`performance`/`migration`/`bugfix`/`bugfix-p0`/`refactor`/`chore`/`feature`/`test`/`compound`-aggregate). 재요청이 같은 결과를 낼 것이므로 폐기. (`bugfix-unreproducible`는 no-op 조건이 N/A이므로 이 매핑 대상이 아니다 — Validity 표 참조.)
- `wait_for_change` ← 목표가 *현 시점에만* 무의미 (`release`: 신규 commit 없음). 상태가 바뀌면 의미를 가지므로 변경 대기.
- `reframe_request` ← Validity 검사가 *요청이 가리키는 target이 이미 원하는 상태이지만 요청 표현이 그 사실과 어긋나게 다른 대상을 함의*함을 발견했을 때 (예: 요청 target은 이미 존재/충족이나 요청 문구가 다른 의도를 함의). 즉 *요청이 명시한 target 기준으로는 변경이 불필요*하되(그래서 no_op), 요청 표현을 *그 사실에 맞게 재구성*하면 다른 의미를 가질 수 있음을 권고한다. 이 reframe는 *재분류*(flow_type 의심)가 아니라 *동일 flow_type 내 요청 표현 정정*이므로 triage_mismatch와는 별개이며, 동반될 수도 있다 (아래 참조).
  - **reframe_request no_op의 current_state/target_state 의미 (계약 명시):** `current_state` = 요청 target이 가리키는 캡처된 사실(이미 원하는 상태임을 보이는 baseline/version/존재 사실), `target_state` = Triage가 요청에서 추출한 의도 target. 둘이 *동일 대상에 대해 이미 일치*(=변경 불필요, no_op 정당)하되 요청 문구가 그 일치를 벗어나는 표현을 쓸 때 reframe_request를 권고한다. (current_state/target_state는 abandon/wait_for_change와 동일한 필드 의미를 유지하며, reframe_request는 suggested_action만 다르다.)
  - **triage_mismatch→needs_clarification와의 경계:** 동일 divergence가 *현 flow_type 가정 하의 해석 자체를 무효화*하면 (요청과 Ground 사실이 *서로 다른 작업 종류*를 가리켜 flow_type이 의심됨), 이는 reframe_request no_op이 아니라 triage_mismatch + `result=needs_clarification` 경로다 (L201-206). reframe_request no_op은 *해석이 무효화되지 않고* 요청 target 기준 no_op이 성립하는 경우에만 산출한다 (no_op과 needs_clarification은 상호 배타적 result이므로 둘 중 하나로만 라우팅).

No-op 감지 시 → `compatibility_verdict.result = no_op` + `no_op_details` 필수.
[compatibility-verdict.md 참조](#compatibility-verdict--schema--validation--routing).

**Compound sub-flow no-op vs aggregate no-op (P7, principle 3):**
- *각 sub-flow의 no-op*은 그 sub-flow의 flow_type 행으로 개별 판정되어 `sub_flow_verdicts[].result = no_op`에 기록된다 (이건 기존 메커니즘 — 발명 아님).
- *Compound 전체의 no_op*은 **sub_flow_verdicts의 result가 전부 no_op일 때에만** 성립한다 (V14 — flow_type이 이 schema 밖(Triage)이므로 Compound-conditional 요구는 grammar 강제 불가; M2 INV-M2-4가 검증, has_architecture_level과 동일 처리). **flow_type=Compound이면 sub_flow_verdicts는 어느 result든 present+non-empty여야 하며**(omit로 aggregate 전제를 vacuously 통과시키는 홀 차단), sub_flow_identification도 동일하게 Compound이면 present+non-empty / non-Compound이면 absent(INV-M2-4). 하나라도 no_op이 아닌 *mixed* 케이스는 Compound 전체가 no_op이 아니며, non-no_op sub-flow들로 result가 결정된다 — `partial_proceed`(일부 sub-flow가 V2b scope-confined block) 또는 `proceed`(non-no_op 전부 proceed). **이때 no_op sub-flow들은 버려지지 않고** partial_proceed면 `partial_scope_handling.no_op_set`에, 그 외 routing(proceed/blocked/needs_clarification)이면 `sub_flow_verdicts`에 result=no_op로 기록된다 (V14b — legitimately-empty 출력 슬롯; blocked_set/proceed_set 아님; sub_flow_verdicts는 verdict-level optional이라 모든 branch에서 보존 슬롯으로 허용됨). (이 규칙이 legacy의 누락된 Compound 행 + mixed no_op 출력 슬롯을 닫는다.)

## Result enum & branches (P1: success 분기 명시 — 실패뿐 아니라 성공 분기도 동일하게 선언)

Investigate의 단일 출력 discriminator는 `compatibility_verdict.result`이며 **5-state**다. 각 result는
*성공/진행 분기와 실패/정지 분기를 모두* 명시적으로 선언한다 (P1: success branch declared the same way
as the failure branch — Investigate의 기존 5-state 라우팅 테이블 재사용, 새 enum 발명 0).

| result | 의미 | Investigate가 채우는 필수 필드 | Orchestrator 라우팅 |
|---|---|---|---|
| `proceed` | **SUCCESS 분기.** blocking issue 없음, no-op 아님, 입력 정상 | `reason` (왜 proceed) + impact_map/risk_surface 등 정상 산출 | Decide step 진입 (mode upgrade trigger 허용) |
| `partial_proceed` | **부분 SUCCESS 분기.** blocking issue가 *bounded scope에 한정*되고 proceed 가능한 나머지가 남음 (V2b) | `partial_scope_handling{proceed_set, blocked_set, no_op_set?, followup_required}` | Decide 진입 — proceed_set 처리, blocked_set은 followup_flows로 큐잉 |
| `blocked` | *flow-wide* blocking issue (project-wide scope 또는 affected area 전부 차단, V2a) 또는 escalate-disposition 존재 | `blockers: [issue_id]` (비어있지 않음) | **Flow halt 강제** — Decide 미실행, blockers surface |
| `needs_clarification` | user/caller 응답 필요 | `open_questions: [issue_id]` (비어있지 않음) | **Decide 미실행** — NEEDS_CONTEXT → 응답 후 Investigate 재invoke (clarification_round cap 3, 아래) |
| `no_op` | **합법적 빈 결과 분기** — 변경이 정말 불필요 | `no_op_details{reason, evidence, current_state, target_state, suggested_action}` | **Flow halt 강제** — Reflect 실행 (abandonment 분류) |

**`proceed`는 success 분기로 *명시적으로* 선언된다** (P1): legacy는 V1("issues 빈 list → proceed 강제")로
proceed를 *우발적*으로만 도달시켰다. 이 계약은 proceed를 다른 result와 동일한 1급 분기로 선언하며,
**proceed는 입력 precondition을 통과한 경우에만** 도달 가능하다 — 아래 V1 보강 참조.

**Mechanical error 분기 (위 5-state 밖, P8/principle 1·3):** 입력 precondition 위반 또는 *주요 도구*
(ED MCP) 부재/오류는 `compatibility_verdict.result` 어느 값도 아니다. Investigate는 verdict를 만들 수 없으므로
**mechanical error 출력**을 낸다 — 아래 **Failure & degrade handling** 참조. 이건 5-state enum과 별개의
종단 신호이며, no_op/proceed로 위장하지 않는다 (principle 3).

## Output 구조

핵심 output 필드:
- `flow_id` · `based_on{ground_ref, triage_ref}` · `based_on_ground` · `depth` (identity/lineage — §5 RowRef; schema root-required. envelope correlation은 RowRef 기반 based_on으로 표현하며 free-fill하지 않음)
- `impact_map` (affected_files / affected_files_count 포함 — R6 입력)
- `constraints`
- `risk_surface`
- `architecture_impact` (new_modules / public_api_changes / has_architecture_level — R6 입력)
- `compatibility_verdict` → [Result enum & branches](#result-enum--branches) + [compatibility-verdict 절](#compatibility-verdict--schema--validation--routing)
- `ground_unknowns_addressed` → matrix [unknown-disposition 절](#unknown-disposition-matrix)
- `sub_flow_identification` (Compound 전용)
- `triage_mismatch?` (Triage 오류 의심 시 surface — reclassify 트리거; **production rule 아래 명시**)
- `external_research?` (optional — 외부 리서치 findings; ExternalFinding[] — claim/claim_class/result/no_results_handling?. [External Research Policy 절](#external-research-policy) 정책 준수; result는 Measured(trust grade) | Omitted(degrade). provenance는 `external_research[].result.provenance`에 기록. `no_results_handling?`는 *result가 Omitted일 때만 의미*있는 sibling field로, No-Results 처분을 emit한다 — enum `compat_issue | risk_surface | defer | negative_signal` (아래 No-Results 표 매핑). **present iff result.status=='omitted' + claim_class 결정 매핑 일치는 cross-field truth이므로 grammar가 아니라 M2 INV-M2-15가 강제**한다)
- `verification_proof`
- `source_manifest?` (R36 — 인용 파일 + cited_lines; M2 INV-M2-12가 cited line 존재 검증)
- `declared_next_step` (R16 — advisory; orchestrator가 expected_next_step 주입, M2 INV-M2-11이 equality assert)
- `unverified` (R13 floor — KEEP polarity; Investigate가 스스로 검증 못한 claim 표기, Verify까지 persist)
- `ed_availability` (ED MCP 가용성 분기 — M3 degrade-as-branch; Measured(ed_snapshot_version) | Omitted; 아래 Failure & degrade handling)

### impact_map / constraints / risk_surface 스키마

```yaml
flow_id: ...
based_on_ground: <RowRef>                        # §5 Ground step_run RowRef (hash 아님). ed_snapshot_version hash는 별도 compatibility_verdict.source_version.ed_snapshot_version에 기록 (= 이 Ground row의 task_subgraph.ed_snapshot_version). PC2가 그 hash 존재+정형 assert

ed_availability:                                 # M3 degrade-as-branch: ED MCP(주요 도구) 상태
  # Measured.value.ed_snapshot_version=정상 traversal / Omitted=ED 부재→mechanical error (아래)
  # Measured | Omitted

impact_map:
  primary_areas: [{ node, change_kind, source: ed_traversal }]
  ripple: [{ node, distance, why, source }]                  # source = SourceTool provenance (R26)
  external_surface: [{ contract, consumers, breaking: bool, source }]   # breaking 필수(optional 아님), source = SourceTool (R26)
  affected_files: [<path>, ...]               # mechanical derive from Ground.task_subgraph.entry_nodes + ripple. R6 입력
  affected_files_count: { value, derived_from: [<RowRef>...], source_tool }   # = affected_files.length (R6 캐시). CountClaim 아님 — Investigate는 Bash 없으므로 command+raw_stdout 없음; 상류 graph row(entry_nodes+ripple)에서 derive하는 derivation-provenance shape. INV-M2-1이 derived_from으로 재유도

constraints: [{ source: rule|contract|security|domain, description, blocking?: bool, constraint_id?, source_tool }]   # source_tool = SourceTool provenance (R26). constraint_id? = optional invocation-scoped id — disposition=constraint의 follow_up_ref 타겟

risk_surface: [{ area, severity: low|med|high|critical, probability: likely|possible|unlikely, evidence, evidence_ref?, risk_id?, source_tool }]   # source_tool = SourceTool provenance (R26). evidence_ref? = optional §5 RowRef(이 risk를 grounding하는 Ground/Investigate fact row); risk_id? = optional invocation-scoped id — disposition=risk의 follow_up_ref 타겟
# severity scale은 Investigate.risk_surface의 단일 척도(low|med|high|critical) — 두 번째 척도 발명 금지

architecture_impact:                          # R6 입력 — mechanical detect
  new_modules: [<path or symbol>, ...]        # 신규 디렉토리/모듈 제안 (Investigate가 ED graph + ripple로 derive)
  public_api_changes: [<symbol>, ...]         # 변경되는 public symbol/contract list
  has_architecture_level: <bool>              # = (new_modules.length > 0) OR (public_api_changes.length > 0). R6 force trigger
```

**Derivation rules** (LLM judgment 우회, mechanical):
- `affected_files` ← Ground.task_subgraph.entry_nodes의 file path + impact_map.ripple의 node가 file 유형이면 path 합집합. dedup.
- `architecture_impact.new_modules` ← Investigate가 *Impact 분석 중* (ED traversal + ripple 추적) 발견된 신규 디렉토리 path 또는 신규 module symbol 신호. 옵션 생성·선택은 Decide 영역 — Investigate는 *영향 받는 신규 모듈 식별*만
- `architecture_impact.public_api_changes` ← `impact_map.external_surface[].contract` 중 `breaking=true`인 항목
- `has_architecture_level` ← orchestrator가 derived field로 자동 계산 (Investigate가 입력 안 함)
- Investigate-Reviewer가 derivation 일관성 검증 (entry_nodes 변경 없는데 affected_files 누락 시 fail)

### ground_unknowns_addressed 스키마

```yaml
ground_unknowns_addressed:
  - unknown_ref               # Ground unknown 항목 ID/index
    unknown_type              # matrix 매칭용 (capture_failed/inaccessible/...)
    disposition               # resolved | partially_resolved | risk | constraint | clarification | defer | escalate
    rationale                 # 왜 이 disposition
    matrix_default            # optional bool — matrix 권장 따랐는지 (false면 rationale 강화)
    follow_up_ref             # optional — risk_id | constraint_id | compat_issue_id | deferred_decision_id | blocker_id
    sub_dispositions          # optional, partially_resolved일 때 필수 — [{ part: <description>, disposition: <6-terminal enum>, follow_up_ref }]
                              # 중첩 disposition은 6 terminal 값만 {resolved|risk|constraint|clarification|defer|escalate} — sub_disposition 자체는 partially_resolved 불가(재귀 없음, schema 강제)
                              # follow_up_ref는 residual part가 resolved가 *아니면* 필수 (schema if/then 강제) — escalate→blocker / clarification→requires_user issue / risk→risk_surface / constraint→constraints / defer→deferred_decisions 매핑은 top-level과 동일하게 INV-M2-6/7이 recurse 검증 (residual escalate·clarification silent 미라우팅 0)
```

### Compound + triage_mismatch + verification_proof

```yaml
(Compound only) sub_flow_identification: [{ flow_type, scope, rationale, source_tool }]   # 식별만, 분해/순서는 Decide. source_tool = SourceTool provenance (R26)

triage_mismatch?: { suspected_flow_type, evidence, source_tool }   # production rule 아래 (confidence 필드 없음 — schema 정합)

verification_proof: { tool_calls, read_files, ed_queries? }   # shared VerificationProof $def — tool_calls+read_files 필수, ed_queries optional (web_fetches 없음 — 외부 리서치 provenance는 external_research[].result.provenance에 기록)
```

#### triage_mismatch production rule (P6/P8: 미정의 production rule + 동반 verdict 명시)

legacy는 `triage_mismatch?`가 "reclassify 트리거"라는 *효과*만 말하고 **언제 emit하는지, 어떤 result와
동반되는지, proceed와 공존 가능한지**를 침묵했다. 다음 규칙으로 닫는다:

**언제 emit하는가 (production rule, mechanical 판정 보조):**
Activity 7에서, **Ground가 캡처한 사실이 Triage가 지정한 `flow_type`과 구조적으로 모순**될 때만 emit한다.
즉:
- Ground.task_subgraph/volatile 사실이 *다른 flow_type의 시그니처*를 명백히 보임 (예: Triage=Chore인데
  Ground가 public API breaking change + 신규 module을 보임 → suspected_flow_type=Feature),
- 또는 Triage 의도 target과 Ground 사실 대상이 *서로 다른 작업 종류*를 가리킴.
단순한 scope 차이·세부 불일치는 mismatch가 **아니다** (Investigate는 분류를 *재수행*하지 않는다 — 그건
Triage의 일; STAY IN LANE). Investigate는 *의심 신호*만 surface한다.

**어떤 verdict와 동반되는가 (동반 result 규칙):**
- triage_mismatch는 **`compatibility_verdict.result`와 독립적으로 emit될 수 있는 surface 신호**다 —
  그 자체가 result를 강제하지 않는다.
- 다만 mismatch가 **현재 flow_type 가정 하에서 해석을 신뢰할 수 없게** 만들면 (예: 잘못된 flow_type 때문에
  Validity·no-op 판정이 무의미해짐), Investigate는 `result = needs_clarification`을 동반하고 mismatch를
  `open_questions`로 연결되는 compat issue로 등록한다 (reclassify가 user/orchestrator 결정을 필요로 하므로).
- mismatch가 **해석을 무효화하지 않으면** (Investigate가 현 flow_type으로도 일관된 impact/risk를 낼 수 있으면),
  `result = proceed`와 **공존 가능**하다 — triage_mismatch는 *권고적 surface*로만 남고 orchestrator가
  reclassify 여부를 결정한다. (즉 triage_mismatch는 proceed와 공존 가능; 단 *무효화* 시에는 needs_clarification.)
- triage_mismatch는 **절대로 no_op/blocked를 *자동으로* 유발하지 않는다** — 그 두 result는 각자의 조건
  (no-op 검출 / blocking issue)으로만 도달한다.

**reclassify 라우팅 (소유권 경계, principle 2):**
triage_mismatch는 *Triage 재분류를 요청하는 surface 신호*이지 Investigate가 reclassify를 *실행*하는 게
아니다. Orchestrator가 triage_mismatch를 읽고 Triage를 prior_evidence와 함께 재invoke한다
(`reclassify_count` cap 3 — [failure-routing.md](#failure-origin-routing) 참조). Investigate는
`request_upstream_deepen`을 **emit하지 않는다** — 그건 Decide 전용 신호다 (principle 2: control-signal
ownership). Triage 재분류는 reclassify 경로(prior_evidence)로, *Investigate→Ground* 결손은 failure_origin
escalate 경로로 라우팅된다.

## Tools 허용

- ED MCP query (graph traversal — read only) — **PRIMARY 도구** (이 step의 핵심 일; 부재=escalate, principle 1)
- 외부 리서치 (WebFetch / WebSearch / Context7) — **ENHANCEMENT 도구** ([external-research 절](#external-research-policy) 정책 준수; 부재/실패는 claim 중요도별 degrade, escalate 아님)
- Read (path-restricted): `CLAUDE.md`, `AGENTS.md`, `.claude/rules/**` (project rules) + `.blazewrit/grounds/**`, `.blazewrit/investigations/**`, `.blazewrit/plans/**`, `.blazewrit/reports/**`, `.blazewrit/flow-state.json`, `.blazewrit/flow-history/**` (이전 step artifact — artifact chain 위해 필수)

**Bash 도구 제거**: Investigate는 Bash 사용 안 함. git log 같은 commit history 필요 시 → Ground의 volatile_capture에서 미리 수집 (Ground 책임).

**프로젝트 내부 코드 read 금지**: Ground가 미흡한 detail이 필요하면 — Investigate는 *직접 코드 read를
하지 않는다*. 그러나 (principle 2) Investigate는 `request_upstream_deepen`을 emit하지 **않는다** (그건
Decide 전용 신호). Ground가 미흡/결손이면 Investigate는 **failure_origin escalate** 경로로 라우팅한다
(아래 Failure & degrade handling). 직접 코드 read = boundary 위반. Mechanical 강제: agent frontmatter
`tools: [WebFetch, WebSearch, Read]` + Read의 path hook 제한.

## Input preconditions (P8: garbage-in 방어 — 신규 절)

> **횡단 input-precondition 절** (전 소비자 동일 패턴, Ground의 active_flow_state mechanical-error 패턴
> 일반화). Investigate는 해석을 시작하기 전에 *필수 upstream 필드의 존재 + 정형*을 assert한다. **진실은
> assert하지 않는다 — 그건 Verify의 일** (principle 1·3). 결손/기형이면 mechanical error로 escalate한다
> (failure_origin은 실패한 precondition에 따라 `ground` 또는 `triage` — PC1~PC6 표 참조; investigate_error.failure_origin은 ground|triage|investigate 3값만 합법, 'upstream' 같은 umbrella 값 없음). ping-pong은 기존 `(flow_id, step)` 5-누적-fail halt cap이 이미 bound하므로
> precondition escalation은 안전하다.

**필수 precondition assert (Activity 0, mechanical):**

| # | assert | 위반 시 (mechanical error) | 태그 |
|---|---|---|---|
| PC1 | `Ground.task_subgraph` 존재 + `entry_nodes`가 **존재하고 비어있지 않음** | mechanical error, `failure_origin=ground` | **P7 핵심**: 빈 entry_nodes 차단 |
| PC2 | `Ground.task_subgraph.ed_snapshot_version` 존재 + 정형 (이 hash는 `compatibility_verdict.source_version.ed_snapshot_version`에 기록됨 — `based_on_ground` RowRef와는 별개 필드; based_on_ground는 §5 RowRef, hash 아님) | mechanical error, `failure_origin=ground` | P8 |
| PC3 | `Triage.flow_type`이 존재 + **canonical flow_type 집합**의 멤버 (unknown/missing flow_type 아님). canonical 집합 = Triage `FlowType` enum의 16개 hyphenated 멤버 (단일 출처, 아래 정의) | mechanical error, `failure_origin=triage` | P8 |
| PC4 | Validity 표에서 *이 flow_type이 요구하는* Ground 필드 (예: `migration`→`dependency_audit`, `release`→`volatile`(git log), `performance`→`volatile.perf_baseline`; `bugfix`/`bugfix-p0`→reproduce 시도 결과; `refactor`→대상 코드, `chore`→대상, `feature`→`task_subgraph`, `test`→`coverage`)가 **존재**. **N/A flow** (`bugfix-unreproducible`/`spike`/`review`/`retro`/`exploration`/`plan-standalone`)는 no-op 조건 자체가 없으므로 PC4 required-field assert가 *공집합*(검사 없음, vacuously PASS)이다. `compound`는 각 sub-flow의 PC4를 그 sub-flow의 flow_type 행으로 적용. | mechanical error, `failure_origin=ground` | P8/principle 3 |
| PC5 | ED MCP(주요 도구) attached + 응답 (timeout/error 아님) | mechanical error, `kind=primary_tool_unavailable` + `failure_origin=investigate` (자기 주요 도구) — **precondition_violation 아님** | principle 1 |
| PC6 | `Ground.unknowns` 필드가 **존재하고 array** (빈 array=합법: unknown 없음 / 부재·non-array=기형). ground_unknowns_addressed(Activity 6) + INV-M2-9 coverage('{unknown_ref} ⊇ {Ground.unknowns[].id}')의 소비 입력이므로, 부재/기형이면 INV-M2-9가 빈 ground_unknowns_addressed로 *vacuously* 통과하는 홀이 생김 | mechanical error, `kind=precondition_violation` + `failure_origin=ground` | P8/principle 3 (PC4의 '필드 부재 vs present-but-empty' 구분을 unknowns에 동일 적용) |
| PC6b | `Ground.unknowns` array의 **각 원소**가 non-empty `.id` + non-empty `.unknown_type`를 가짐 (container는 PC6, 원소 정형은 PC6b). 결손/empty id면 INV-M2-9 coverage('{unknown_ref} ⊇ {Ground.unknowns[].id}')가 garbage id를 소비하고, 결손 unknown_type이면 matrix lookup(INV-M2-8)·disposition이 garbage를 소비하므로, *present-but-malformed* 원소는 disposition/coverage를 silent 저하시킨다. 위반 시 Activity 6 소비 전에 차단 | mechanical error, `kind=precondition_violation` + `failure_origin=ground` | P8/principle 3 (container guard를 원소 수준으로 확장) |

> **Canonical flow_type 집합 (단일 출처 — PC3·PC4·Validity 표·deepen·safety_cap 전부 이 집합의 strict subset):**
> Triage `FlowType` enum의 16개 hyphenated stem이 유일한 권위 멤버 집합이다 (UNIFORM: hyphenated, no underscore):
> `feature, bugfix, bugfix-p0, bugfix-unreproducible, refactor, performance, migration, test, chore, plan-standalone, review, release, retro, spike, exploration, compound`.
> 이 계약의 *모든* flow 목록(Validity 표, deepen 트리거, External-Research safety_cap)은 이 16개의 strict subset이며 같은 stem 철자를 쓴다. "Bug Fix"·"Bug Fix(general)"는 `bugfix`, "Bug Fix Unreproducible"는 `bugfix-unreproducible`, "Bug Fix P0"는 `bugfix-p0`로 통일한다 (display name 혼용 금지). `bugfix-p0`/`bugfix-unreproducible`는 `bugfix`와 *별개* flow_type다.

> **PC5 kind 규칙 (contract hole 닫음 — both):** PC5(ED MCP 부재/오류/timeout) 위반은 **반드시 `kind=primary_tool_unavailable`로 emit한다** (`precondition_violation`이 아니다). 이는 schema if/then이 `ed_availability=Omitted`를 강제하도록 하여 ED 부재 상태가 un-flag된 채 새지 않게 한다. `kind=precondition_violation`은 **PC1~PC4 + PC6 + PC6b 전용**으로 예약한다 (PC1·PC4·PC6·PC6b→`failure_origin=ground`, PC3→`triage`). 즉 kind↔precondition 매핑은 mechanical: PC1-PC4·PC6·PC6b → precondition_violation, PC5 → primary_tool_unavailable. (이 kind↔PC 매핑은 cross-field truth이므로 grammar가 표현 못함 — M2가 강제; 단 *kind=primary_tool_unavailable일 때 ed_availability=Omitted 동반*은 schema if/then이 grammar-강제.)

**PC1 — V1 자동 proceed 고무도장 차단 (P7, principle 3 — 이 step의 worst hole):**
legacy에서 빈 `entry_nodes` → 빈 impact_map → 빈 issues → V1("issues 빈 list → result=proceed 강제")가
**non-actionable Ground를 자동 proceed로 도장**찍었다. 이 계약은 그것을 막는다:

- **PC1이 먼저 실행된다.** `entry_nodes`가 비어있으면 Investigate는 V1을 *평가하지 않는다* —
  V1보다 *앞선* mechanical error로 종료한다 (`failure_origin=ground`).
- 따라서 **"빈 issues → proceed"는 entry_nodes가 *존재하고 비어있지 않은* 경우에만 도달 가능**하다.
  그 경우의 빈 issues는 *합법적으로 빔* (실제로 변경이 깨끗함, principle 3의 첫째 항목) → proceed가 정당하다.
- entry_nodes가 비어있는 경우의 빈 issues는 *upstream 결손* (principle 3의 둘째 항목) → escalate.
- 이로써 V1은 다음과 같이 보강된다 (compatibility-verdict 절 V1 참조): **V1은 PC1 통과를 전제로만
  발화한다.** "issues 빈 list AND entry_nodes 비어있지 않음 → proceed; issues 빈 list AND entry_nodes
  비어있음 → 도달 불가(PC1이 선차단)".

**소유권 (principle 2):** 위 어떤 precondition 위반도 `request_upstream_deepen`을 emit하지 **않는다**
(그건 Decide 전용). 전부 기존 `failure_origin` escalate 경로 + producer⇄reviewer 재진입으로 라우팅된다.

**STALE Ground 입력 (intake 시점):** Investigate는 `source_version.ed_snapshot_version` hash를 *기록*하지만 stale *판정*은
하지 않는다 — stale 검출은 Decide(수신 시)·Verify(최종)에 위임된다 (compatibility-verdict 절 Stale 표).
단 Investigate의 precondition은 **그 hash가 존재함**(PC2; based_on_ground RowRef가 가리키는 Ground row의 task_subgraph.ed_snapshot_version)을 assert한다; hash 자체가 결손이면 stale 판정 이전에
mechanical error다. (이건 intake stale-detection을 Investigate에 새로 부여하는 게 아니라 — 그건 boundary
밖 — 기존 위임을 명시화한 것이다.)

## Failure & degrade handling (P1·P2: 도구 부재 + 실패 분기 — 신규 절)

> 도구 부재 라우팅은 **도구 역할**로 갈린다 (principle 1):
> *PRIMARY 도구(ED MCP) 부재 → escalate*; *ENHANCEMENT 도구(외부 리서치) 부재 → degraded branch*.

**(1) ED MCP (PRIMARY 도구) 부재/오류/timeout — principle 1: 주요 도구 → escalate:**
- ED MCP는 Activity 1(Impact 추적)의 핵심이다. 부재/오류/timeout이면 Investigate는 *자기 일을 못 한다*.
- `ed_availability = Omitted` (M3 degrade-as-branch로 *상태를 표기*) + **mechanical error 출력**
  (`failure_origin=investigate` — 자기 주요 도구 실패; unknown-disposition.md L24 `tool_unavailable →
  escalate`와 일치).
- 이 경우 `compatibility_verdict`를 **생산하지 않는다** — 빈 impact_map을 proceed/no_op로 위장하지 않는다
  (principle 3). degraded_pass를 ED에 쓰지 않는다 (principle 1: ED는 enhancement가 아니라 primary; 기존
  matrix와 충돌 회피).
- Orchestrator가 producer⇄reviewer 재진입 또는 `(flow_id, step)` 5-누적-fail halt cap으로 처리.

**(2) 외부 리서치 (ENHANCEMENT 도구) 부재/실패 — principle 1: 보조 도구 → degraded branch:**
- 외부 리서치(WebFetch/WebSearch/Context7)는 *해석 보조*다. 부재·rate-limit·network·auth·paywall·all-source-failure는
  [external-research 절](#external-research-policy)의 claim-중요도별 degrade로 처리된다 — **escalate가 아님**.
- decision_critical claim 실패 → compat issue 등록(blocks_flow/requires_user); conflict_with_internal → compat issue;
  version_sensitive → risk_surface; background_context → unknown disposition=defer; feasibility_critical → negative_signal.
  (이건 degraded_pass에 해당: verdict는 계속 산출되되 해당 claim은 unknown/risk로 강등.)

**(3) Ground unknowns의 tool_unavailable disposition:**
Ground가 `tool_unavailable`(ED/firebat/pyreez 부재) unknown을 넘기면 → disposition=`escalate` →
`compatibility_verdict=blocked` + blocker (unknown-disposition 절 matrix). 이건 Ground가 *이미 표시한*
unknown의 처분이며, Investigate 자신의 ED 부재(위 (1))와는 별개 경로다.

**(4) 입력 precondition 위반:** 위 **Input preconditions** 절 — 전부 `failure_origin` escalate.

**(5) issues_overflow / stale 2nd-attempt:** compatibility-verdict 절의 cap 50 + stale 2nd-attempt 규칙 그대로.

**모든 mechanical error 출력 shape (principle 3 — no_op/proceed로 위장 금지):**
```yaml
investigate_error:
  kind: precondition_violation | primary_tool_unavailable
  failure_origin: ground | triage | investigate
  reason: <specific>           # 어떤 assert/도구가 실패했는지
  evidence: <RowRef | tool-probe>   # PC1-PC4+PC6+PC6b(kind=precondition_violation): Ground/Triage artifact RowRef. PC5(ED MCP 부재, kind=primary_tool_unavailable): tool-probe = Omitted shape(status:omitted+reason+source_tool) — 상류 row 없으므로 RowRef 강제 안 함. evidence-arm↔kind 매핑은 schema if/then이 grammar-강제한다: kind=primary_tool_unavailable→evidence Omitted arm으로 pin, kind=precondition_violation→evidence RowRef arm으로 pin (precondition_violation이 tool-probe Omitted를 위조할 수 없음).
  # compatibility_verdict 미산출 — 빈 verdict를 proceed/no_op로 채우지 않음
# error 출력은 *정확히* {kind, failure_origin, reason, evidence} (+root identity: flow_id/based_on/based_on_ground/depth)만 carry한다.
# 어떤 해석/provenance 출력도 동반하지 않는다 — verification_proof / triage_mismatch / external_research /
# sub_flow_identification / deferred_decisions / source_manifest / declared_next_step / unverified는 error branch에서 *모두 부재여야 한다* (schema error branch가 properties:false로 forbid). 빈 해석을 error에 끼워넣지 않음 (principle 3).
# kind=primary_tool_unavailable일 때: ed_availability를 Omitted 분기로 *반드시* 동반 산출 (ED 부재 상태 표기, schema if/then 강제 — ed_availability는 error branch에서 forbid되지 않는 유일한 비-identity 필드) + evidence는 Omitted tool-probe arm으로 pin. precondition_violation에는 ed_availability 불요 + evidence는 RowRef arm으로 pin (둘 다 schema if/then grammar-강제).
```

## Reviewer (investigate-reviewer)

- **Input precondition 통과 확인** (P8): entry_nodes 비어있지 않음(PC1) · ed_snapshot_version 존재(PC2) ·
  flow_type canonical(PC3) · flow별 필수 Ground 필드 존재(PC4) · ED MCP Measured(PC5) · Ground.unknowns 존재+array(PC6) · 각 unknown 원소 id+unknown_type 정형(PC6b). 위반 시 verdict가
  *mechanical error*여야 하며 proceed/no_op이면 **fail** (P7 고무도장 차단 검증).
- impact_map이 Ground entry_nodes 모두 커버 (단 entry_nodes 비어있으면 이 검사 전에 PC1이 이미 fail —
  trivial pass 불가)
- risk_surface가 impact_map의 primary_areas/ripple high-impact node를 빠짐없이 덮음 (impact × Ground concerns 도출 — Activity 3; 별도 미정의 입력 참조 안 함)
- compatibility_verdict 명시 (V1-V14b 통과; V1은 PC1 전제 하에서만 발화)
- **blocked vs partial_proceed scope 판정 일관성** (신규): result=blocked면 V2a 충족(어느 blocking issue scope project-wide *또는* blocking scope 합집합이 affected area 전부 덮음 → 모든 blocking issue.scope_confined=false). result=partial_proceed면 V2b 충족(모든 blocking issue scope bounded + scope_confined=true + proceed 나머지 ≥1 + partial_scope_handling.proceed_set/blocked_set 일치). scope_confined 값이 V2a/V2b 판정과 어긋나면 **fail** (partial_proceed가 V2에 삼켜지거나 flow-wide block이 partial로 새지 않음)
- validity 검사 결과 명시 (no_op 시 no_op_details + evidence ref + **suggested_action이 매핑 규칙(abandon/wait_for_change/reframe_request 3-way)과 일치** — Validity 표가 아니라 매핑 규칙 절 기준; reframe_request은 표에 행이 없고 cross-cutting 조건으로만 산출)
- ground_unknowns_addressed 매 항목 disposition + rationale + follow_up_ref 명시 (silent 미처리 0); partially_resolved의 sub_dispositions[] residual part도 non-resolved면 follow_up_ref 필수 + 매핑 일치(INV-M2-6/7 recurse) — residual escalate/clarification silent 미라우팅이면 fail
- matrix 권장 벗어난 경우 rationale 강화 확인
- **triage_mismatch 일관성** (신규): emit 시 production rule 충족(구조적 모순 evidence 있음) + 동반 result
  규칙 준수(무효화→needs_clarification / 권고적→proceed 공존 / no_op·blocked 자동유발 금지) + `request_upstream_deepen`
  미사용(principle 2)
- **Compound aggregate no_op 일관성** (신규): Compound가 no_op이면 sub_flow_verdicts result가 *전부* no_op인지 검증(V14); mixed(일부 no_op + 일부 non-no_op)이면 no_op sub-flow가 *버려지지 않고* partial_proceed면 `partial_scope_handling.no_op_set`에, proceed면 `sub_flow_verdicts`에 result=no_op로 기록됐는지(V14b) — no_op sub-flow가 blocked_set/proceed_set에 잘못 들어가면 **fail**
- **needs_clarification 재invoke cap 일관성** (신규): result=needs_clarification 재invoke가 누적 3회 cap을 넘지 않는지; 3회 미해소 시 RETRY_EXHAUSTED halt(Reflect abandoned)로 라우팅됐는지 — 추가 needs_clarification로 무한 재invoke되면 **fail**. (이 경로는 mechanical error 아니므로 `failure_origin` 값을 산출하지 않아야 함)
- `ed_availability` 가 실제 ED 사용/부재와 일치 (Omitted인데 verdict 산출 시 fail — principle 1·3; **이제 grammar-강제**: NORMAL 출력 branch가 ed_availability를 Measured arm에 pin하므로 Omitted+verdict 조합은 schema-invalid. ED-down은 mechanical-error branch(kind=primary_tool_unavailable)에서만 출현)
- 옵션·설계 prose 없음 (Decide 영역 침범 금지)

## Adaptive Depth

Step Depth Policy 참조. Investigate default shallow:
- **shallow**: compatibility check + unknown_disposition. caps: wall_s=20, tokens=4k
- **deep**: 전체 6 activities. caps: wall_s=180, tokens=20k

**deepen triggers (OR)**:
- Ground.depth = deep (cascade)
- flow_type ∈ {`migration`, `feature`, `performance`, `compound`, `bugfix-unreproducible`} (canonical stem subset)
- Ground.unknowns.length ≥ 3
- Ground.task_subgraph.entry_nodes.length > 5
- prior_evidence with depth_upgrade=true (reclassify path)

> Input precondition gate(Activity 0)는 depth와 무관하게 *항상* 실행된다 — shallow에서도 PC1~PC6는
> 먼저 평가된다 (빈 Ground 고무도장은 depth로 우회 불가, P7).

## Boundary — Investigate가 안 하는 것

| 항목 | 책임 |
|---|---|
| **프로젝트 내부 새 사실 캡처** (ED query, 코드 read, 빌드 실행, 카드 metadata) | Ground |
| 옵션 생성 | Decide |
| 결정 (어느 접근) | Decide |
| 설계 (architecture, policy, userflow) | Decide(Design) |
| AC 추출 | Spec |
| 코드 변경 | Implement |
| 최종 검증 | Verify |
| **stale 입력 *판정*** (hash 기록은 하되 stale 여부 판단은 안 함) | Decide(수신 시) / Verify(최종) |
| **reclassify *실행*** (triage_mismatch는 surface만; 재invoke는 orchestrator) | Triage(재분류) / Orchestrator(재invoke) |
| **`request_upstream_deepen` 발화** (Decide 전용 control 신호 — principle 2) | Decide |

**Boundary clarification**: Investigate의 외부 리서치 (WebFetch / WebSearch / Context7)는 *프로젝트 내부 사실 캡처*가 아닌 *외부 검증을 위한 read* — Investigate의 해석 활동에 필요한 *외부 가설 확인*. 프로젝트 내부 ED·코드·빌드는 Ground 책임. 외부는 Investigate가 *해석 보조*로 read. 경계 명확.

**Boundary clarification (degenerate upstream, principle 2·3)**: 빈/결손 Ground를 Investigate가 *고치지*
않는다 — Investigate는 *감지*하고 (precondition assert) 기존 `failure_origin` escalate로 *라우팅*만 한다.
upstream을 deepen하라고 *명령*하는 권한(`request_upstream_deepen`)은 Decide의 것이지 Investigate의 것이
아니다. Investigate는 "이 입력으로는 해석 불가"를 mechanical error로 신고할 뿐이다.

## Sub-policies (이 문서에 인라인 — 단일 계약)

> 원래 별도 파일이던 세 sub-policy는 본 successor 계약에 절로 포함된다 (참조 끊김 방지).

### Compatibility Verdict — Schema + Validation + Routing

#### Schema

```yaml
compatibility_verdict:
  result: proceed | blocked | needs_clarification | no_op | partial_proceed
  schema_version: 1
  checked_at: ISO8601
  source_version:                                            # freshness (canonical: ed_snapshot_version 단일 명칭 — INV-M2-10이 freshness 검증하는 유일 hash)
    ed_snapshot_version: <hash>                              # Ground 출력의 task_subgraph.ed_snapshot_version과 동일 field name (PC2가 존재 assert)

  issues:                                                    # cap 50, dedup, most-severe-wins
    - id                                                     # invocation-scoped unique
      type: missing_referent | policy_violation | stack_incompatibility
          | breaking_change | deprecated_usage | resource_constraint
          | security_violation | compliance_violation | license_conflict
          | contract_violation | environment_mismatch | timing_constraint
          | circular_dependency | platform_unsupported | other
      custom_type?: <string>                                 # type=other일 때 필수
      severity: fatal | high | medium | low                  # (compat issue 척도 — risk_surface의 low|med|high|critical와 별 필드)
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
      blocks_flow?: bool                                     # true → 이 issue가 (적어도 자기 scope 안에서) 차단
      scope_confined?: bool                                  # blocks_flow=true일 때만 의미 — true=차단이 bounded scope에 한정(나머지 proceed 가능 → partial_proceed 후보) / false 또는 부재=flow-wide 차단(→blocked). mechanical derive: 아래 V2/V13
      suggested_followup

  reason                                                     # result 결정 근거 (proceed/partial_proceed success 분기에도 필수 — P1)
  blockers?: [issue_id]                                      # result=blocked일 때 필수
  open_questions?: [issue_id]                                # result=needs_clarification일 때 필수 (triage_mismatch 무효화 시 여기 연결)

  sub_flow_verdicts?:                                        # Compound only — 각 sub-flow의 result (aggregate no_op 판정 입력)
    - sub_flow_id
      result
      issue_refs: [issue_id]

  issues_overflow?:                                          # 50개 초과 시
    total_found: { value, derived_from: [<RowRef>...], source_tool }   # CountClaim 아님 — Investigate는 Bash 없으므로 command+raw_stdout 없음; 열거된 issue row에서 derive하는 derivation-provenance shape (affected_files_count과 동일). INV-M2-13이 derived_from으로 재유도
    captured: 50
    summary: <string>

  no_op_details?:                                            # result=no_op일 때 필수
    reason                                                   # 왜 no-op인가
    evidence: <ground/investigate fact ref>                  # Ground/Triage 비교 근거
    current_state: <캡처된 사실>                              # baseline/version/coverage 등
    target_state: <Triage 의도 추출>                          # 요청 목표
    suggested_action: abandon | wait_for_change | reframe_request   # suggested_action 매핑 규칙(절)으로 mechanical 선택 (P6) — Validity 표는 abandon/wait_for_change만, reframe_request은 매핑 규칙 cross-cutting 조건

  partial_scope_handling?:                                   # result=partial_proceed일 때 필수
    proceed_set: [scope refs]
    blocked_set: [scope refs]
    no_op_set?: [sub_flow_id]                                # Compound mixed 전용 — result=no_op인 sub-flow들 (legitimately-empty; Decide 미처리 + blocked 아님). V14b
    followup_required: bool
```

#### Validation Rules (mechanical)

```
V0.  (선행, P7) PC1~PC6 + PC6b 통과 — 위반 시 verdict 미산출, mechanical error. V1~V13은 V0 통과 전제 하에만 발화. (PC5=primary_tool_unavailable, PC1-PC4+PC6+PC6b=precondition_violation)
V1.  issues 빈 list AND entry_nodes 비어있지 않음 → result=proceed (합법적 빈 결과, principle 3).
     issues 빈 list AND entry_nodes 비어있음 → 도달 불가 (V0/PC1이 선차단 → escalate). 고무도장 금지.
V2.  blocks_flow=true issue가 1개 이상 존재할 때 — V2a/V2b로 분기 (V13 partial_proceed 판정을 V2가 삼키지 않도록 *먼저* scope 판정):
     V2a (flow-wide block → blocked): 다음 중 하나면 result=blocked —
         (i) 어느 blocking issue의 scope가 비어있음(=project-wide, 위 schema "모두 빈 = project-wide"), 또는
         (ii) blocking issue들의 scope 합집합이 impact_map의 affected area를 *전부* 덮음(=proceed 가능한 나머지 0).
         이 경우 모든 blocking issue.scope_confined=false (mechanical 강제).
     V2b (scope-confined block → partial_proceed로 위임): 모든 blocking issue의 scope가 bounded(component/sub_flow/dependency/platform/target_set 중 ≥1 non-empty)
         AND blocking scope 합집합 밖에 affected area가 남음(proceed 가능한 나머지 ≥1) → result=blocked 아님; V13로 넘어가 result=partial_proceed.
         이 경우 해당 blocking issue.scope_confined=true (mechanical 강제).
     (precedence: V2가 V13보다 먼저 실행되나 V2는 *blocked로 가둘지 partial_proceed로 넘길지*만 결정 — scope-confined면 V13이 최종 result를 정한다. V2가 partial_proceed를 unconditional 삼키지 않음.)
V3.  V2a(blocked) 미발화 AND 어느 issue.requires_user=true → result=needs_clarification
V4.  V2a(blocked)·V2b(partial_proceed)·V3(needs_clarification) 모두 미충족 (+ no_op 아님) → result=proceed
V5.  issue dedup: (root_cause hash + scope hash) 같으면 1 issue, max(severity) 채택
V6.  issues.length ≤ 50, 초과 시 issues_overflow 필수
V7.  type=other → custom_type 필수
V8.  result=blocked → blockers 비어있지 않음
V9.  result=needs_clarification → open_questions 비어있지 않음
V10. 모든 issue에 evidence 필수 (provenance)
V11. result=no_op → no_op_details 필수 (reason + evidence + current_state + target_state + suggested_action) +
     suggested_action이 **suggested_action 매핑 규칙 ("no_op suggested_action 매핑 규칙" 절, abandon/wait_for_change/reframe_request 3-way)** 과 일치 (P6). (Validity 표는 abandon/wait_for_change만 산출; reframe_request는 매핑 규칙의 cross-cutting 조건 — 요청 target 기준 no_op이되 요청 표현이 그 사실과 어긋나게 다른 의도를 함의 — 으로만 산출되므로 "표 매핑"이 아니라 "매핑 규칙"을 참조한다. reframe_request의 current_state/target_state 의미는 매핑 규칙 절에 명시; 해석을 무효화하는 divergence는 reframe_request no_op이 아니라 triage_mismatch+needs_clarification 경로다.)
V12. result ∈ {proceed, blocked, needs_clarification, no_op, partial_proceed} — enum 무효값 reject
V13. Partial-proceed result (mechanical predicate = V2b 충족; "일부 accept + 일부 reject"는 V2b의 scope-합집합 판정으로 정의됨, LLM judgment 아님):
     V2b가 발화(모든 blocking issue scope-confined + proceed 가능한 나머지 ≥1)했을 때에만 result=partial_proceed.
     issues는 scope.target_set per 영향 범위 분리. partial_scope_handling{proceed_set, blocked_set, no_op_set?, followup_required}.
     proceed_set = blocking scope 밖 affected area; blocked_set = blocking issue들의 scope 합집합. (no_op_set은 Compound mixed 전용 — V14b 참조.)
     Decide는 partial_proceed에서 실행(proceed_set), blocked_set은 followup_flows로 큐잉.
V14. (Compound, 신규 — **M2-only**: flow_type은 이 schema의 필드가 아니라 Triage 상류에 있으므로 grammar가 Compound-conditional을 표현 못함; has_architecture_level처럼 orchestrator-derived로 M2 INV-M2-4가 강제) **flow_type=Compound이면 sub_flow_verdicts가 *반드시 존재 + non-empty* (어느 result든 — no_op뿐 아니라 전부)**. 이로써 aggregate-no_op 전제가 *omission으로 vacuously 충족되는 홀*을 닫는다(omit하면 검증할 게 없어 고무도장됨). 그 위에서 result=no_op AND flow_type=Compound → sub_flow_verdicts의 모든 result=no_op (aggregate no_op 규칙, P7). sub_flow_verdicts/sub_flow_identification은 schema에서 unconditionally optional이며 **Compound-conditional presence(둘 다 compound이면 present+non-empty, non-compound이면 absent)는 grammar가 아니라 M2 INV-M2-4가 검증**한다.
V14b. (Compound mixed, 신규 — **M2-only**, line 71 mixed 케이스 출력 슬롯) flow_type=Compound AND sub_flow_verdicts에 no_op이 ≥1 *AND* non-no_op도 ≥1 (즉 V14 전부-no_op 미충족):
      → result는 non-no_op sub-flow들로 결정 (그 중 V2a flow-wide block 있으면 blocked; V2b scope-confined block 있으면 partial_proceed; needs_clarification 있으면 needs_clarification; 아니면 proceed). 즉 no_op sub-flow는 result discriminator에 *기여하지 않는다* (legitimately-empty, principle 3).
      → result=partial_proceed로 라우팅될 때: no_op sub-flow들의 sub_flow_id를 partial_scope_handling.no_op_set에 기록 (blocked_set/proceed_set 아님 — Decide 미처리·차단 아님).
      → result=proceed로 라우팅될 때(non-no_op이 전부 proceed): no_op sub-flow들은 partial_scope_handling 없이 sub_flow_verdicts에만 result=no_op로 남고, Decide가 proceed sub-flow만 처리한다.
      → result=blocked 또는 needs_clarification로 라우팅될 때: 이 두 branch는 partial_scope_handling을 schema가 *금지*하므로 (blocked/needs_clarification branch의 `partial_scope_handling:false`) no_op_set 슬롯이 없다. no_op sub-flow들은 **sub_flow_verdicts에 result=no_op로 보존**된다 (sub_flow_verdicts는 result와 무관하게 verdict-level optional이라 모든 branch에서 허용됨 — discriminated branch 밖). 즉 mixed 4개 routing 전부 no_op sub-flow 보존 슬롯이 명시된다: partial_proceed→`partial_scope_handling.no_op_set`, 나머지 셋(proceed/blocked/needs_clarification)→`sub_flow_verdicts[result=no_op]`. (line 71 "mixed no_op 출력 슬롯" 약속 완전 충족.)
      (no_op sub-flow는 abandon으로 surface되나 Compound 전체를 halt시키지 않는다 — 전부-no_op일 때만 V14로 Compound halt.)
```

#### Stale 검출 책임

| 누가 | 언제 | 어떻게 |
|---|---|---|
| Decide | Investigate 출력 수신 시 | `source_version.ed_snapshot_version` vs 현재 ED snapshot — mismatch면 Investigate 재invoke 요청 (최대 1회 재invoke = 총 2 attempts) |
| Verify | 최종 검증 시 | source_version + V1-V14 + race detection (verdict checked_at vs current 시점) |
| Mid-flow ED 변경 | ED background incremental update가 flow 도중 발생 | source_version mismatch 자동 trigger → re-evaluation. Cycle cap이 무한 막음. |

> **Investigate 자신은 intake 시 stale *판정* 안 함** (boundary 밖) — `ed_snapshot_version` *존재*만 PC2로
> assert하고, stale 여부 판단은 위 위임. (legacy의 "Investigate가 silently 소비" 우려를 *명시적 위임*으로 닫음.)

**2nd attempt도 stale일 때**: 2nd attempt(= 1회 재invoke 후)도 stale 발견 시 → `failure_origin=ground`
신호로 Verify에 위임 또는 flow halt + escalate (config). 무한 진행 금지. cycle cap=1의 정확한 의미:
*원본 + 재invoke 1회 = 총 2 attempts*.

#### Result별 Flow 처리

| result | Orchestrator 처리 |
|---|---|
| proceed | Decide step 진입 (mode upgrade trigger 허용) |
| blocked | **Flow halt 강제** — Decide 미실행. blockers를 user/caller에 surface |
| needs_clarification | **Decide 미실행** — NEEDS_CONTEXT → user/caller 응답 후 Investigate 재invoke (clarifications 누적). **clarification_round cap 3** (아래) |
| no_op | **Flow halt 강제** — Decide 미실행. Reflect 실행 (abandonment 분류). no_op_details 학습 |
| partial_proceed | Decide 진입 — `partial_scope_handling.proceed_set` 처리. `blocked_set`은 followup_flows로 큐잉 |
| *(mechanical error)* | verdict 아님 — `failure_origin` escalate (producer⇄reviewer 재진입 / 5-누적-fail halt cap) |

**needs_clarification 재invoke cap (self-edge bound — 다른 모든 재진입 경로와 동일하게 명시):**
needs_clarification는 *합법적 5-state result*이지 mechanical error/FAIL이 아니므로 `(flow_id, step)` 5-누적-FAIL halt cap이 *세지 않는다*. 따라서 매 round마다 새 clarification(새 Ground unknown disposition=clarification 또는 무효화 잔존 triage_mismatch)이 surface되면 무한 재invoke가 가능하다 — 이를 막기 위해 **clarification_round cap 3**: 동일 `(flow_id, investigate)`에 대한 needs_clarification 재invoke는 누적 3회까지. 3회째에도 미해소 open_question이 남으면 → 더 이상 needs_clarification로 재invoke하지 않고 **RETRY_EXHAUSTED로 flow halt** (기존 메커니즘 재사용 — 새 신호 발명 아님; Reflect `abandoned` 분류, 위 Reflect 분류표 `RETRY_EXHAUSTED` 항목). 이 cap은 reclassify cap 3·stale cycle cap 1과 같은 계열의 bound이며, needs_clarification이 *해소로 수렴*하는 경우(매 round open_questions가 줄어듦)는 정상 진행으로 cap에 걸리지 않는다. (mechanical error 경로가 아니므로 `investigate_error`/`failure_origin`을 산출하지 않는다 — failure_origin은 ground|triage|investigate 3값으로 유지.)

**중요 (halt 강제 메커니즘)**: Decide의 mode upgrade trigger는 *result=proceed 또는 partial_proceed인 경우에만*
평가됨. 그 외(blocked/needs_clarification/no_op)이면 Decide 자체 미실행. Orchestrator가 mechanical 강제.

**Reflect 분류**: `completed`(모든 step 정상) / `abandoned`(blocked / no_op / user abandonment / RETRY_EXHAUSTED) /
`suspended`(NEEDS_CONTEXT 또는 active flow preempted). Reflect는 completed + abandoned에서 실행, suspended에서 미실행.

### Unknown Disposition Matrix

Ground unknown은 *반드시* 다음 7 disposition 중 하나로 처분. matrix는 *기본 권장*이며 벗어날 시 rationale 강제.

#### 7 Dispositions

| Disposition | 의미 | 후속 처리 |
|---|---|---|
| `resolved` | Investigate가 *완전히* 해결 (외부 리서치·도구 호출) | unknown 제거, 사실로 승격 (verification_proof 동반) |
| `partially_resolved` | 일부만 해결됨 — 부분 사실 확보 + 잔여 부분은 다른 disposition으로 sub-처리 | 해결된 부분: resolved로. 잔여: risk/constraint/clarification 등 sub_disposition 명시 |
| `risk` | 불확실성을 risk로 변환 | risk_surface에 항목 추가 (severity + probability) |
| `constraint` | 사실 부재가 제약으로 작용 | constraints에 항목 추가 (blocking 표기) |
| `clarification` | user/caller 응답 필요 | NEEDS_CONTEXT — result=needs_clarification으로 자동 연결, follow_up_ref가 compat issue 가리킴 |
| `defer` | 다음 step에서 해결 가능 | deferred_decisions 기록 (defer_to: decide \| spec \| test \| implement). *defer→deferred_decisions 항목 linkage는 grammar required[]가 아니라 M2 INV-M2-7 cross-field validator가 강제* (deferred_decisions는 top-level optional) |
| `escalate` | flow halt — 도구/시스템 문제 | compatibility_verdict=blocked + blocker 기록 |

#### 기본 Matrix (Ground unknown 유형 → 권장 disposition)

| Ground unknown 유형 | 권장 disposition |
|---|---|
| `capture_failed:timeout` | risk |
| `capture_failed:tool_error` | escalate |
| `inaccessible:permission_denied` | constraint (기본) / clarification (권한 요청 가능 시) |
| `tool_unavailable` (ED/firebat/pyreez 부재) | escalate (principle 1: 주요 도구 부재 → escalate) |
| `referent_unresolved` (request entity 그래프 부재) | clarification |
| ED `AMBIGUOUS` edge | risk |
| ED `INFERRED` edge (low confidence) | risk |
| ED `drift` (card↔code 불일치) | constraint |
| 외부 lib/API 미상 | resolved (WebFetch/Context7 시도) / 실패 시 risk |
| 사실 간 `contradiction` (Ground가 unknown으로 표시한 것) | clarification |
| `racing_changes` (Ground 재시도 후 잔존) | risk |

> **Off-matrix unknown_type 규칙 (open-enum 홀 닫음, INV-M2-8):** `unknown_type`은 constrained-but-open string이라 위 표에 *행이 없는* 값이 올 수 있다. 행이 없으면 권장 disposition이 **미정의**이므로 matrix lookup이 불가하다 — 이 경우 `matrix_default`는 **반드시 false**(따를 default가 없음)이고 강화 rationale 요구가 적용된다. `matrix_default=true`는 unknown_type이 표의 한 행과 일치 *AND* disposition이 그 행 권장과 같을 때에만 합법이다. (이 type↔matrix_default cross-field truth는 grammar가 표현 못함 — M2 INV-M2-8가 강제.)

> **Silent fact-vs-fact contradiction (잔여 보강, principle 1·3):** 위 `contradiction` 행은 *Ground가 이미
> unknown으로 표시한* 모순만 발화한다. Investigate가 해석 중 **Ground가 표시하지 않은** 두 사실 간 직접 모순을
> 발견하면, 이를 `risk_surface` 항목(severity는 단일 척도 low|med|high|critical)으로 등록하고, 모순이 *해석을
> 신뢰 불가하게* 만들면 `requires_user=true` compat issue로 승격하여 needs_clarification으로 라우팅한다.
> Investigate는 모순을 *해소*(어느 사실이 맞는지 판정)하지 않는다 — 그건 Ground 사실 재캡처/Verify 영역.
> Investigate는 모순을 *risk/clarification으로 surface*만 한다 (STAY IN LANE).

#### ground_unknowns_addressed 출력 schema — 위 Output 구조의 동일 스키마 사용.

#### Reviewer 검증
- 매 항목 disposition + rationale + follow_up_ref 명시 (silent 미처리 0)
- matrix 권장 벗어난 경우 rationale 강화 확인
- `clarification` disposition은 자동으로 compat issue 생성, follow_up_ref가 그 compat issue 가리킴

### External Research Policy

외부 리서치는 *수단*이지 *기본*이 아님. claim 단위로 trigger·source·tool·stop criteria 결정.
**외부 리서치는 ENHANCEMENT 도구다** — 부재/실패는 degrade(claim 중요도별), escalate 아님 (principle 1).

#### Triggers (claim이 외부 진실 의존 시)
Lib API spec / version compat / deprecation; 보안 advisory(CVE/GHSA); License/컴플라이언스;
외부 API contract/pricing·quota; 표준(RFC/W3C/ISO/IETF) 행위; Browser·runtime 지원; Package registry
metadata; 내부 docs가 외부 source 인용 시 확인; 캐시된 내부 사실 vs 외부 실시간 충돌 의심.

#### Source Eligibility (trust 등급)
| Trust | Source 유형 |
|---|---|
| **high** | official_current, standards_body(RFC/W3C/ISO/IETF), source_code(authoritative), security_advisory(CVE/GHSA) |
| **medium** | official_stale, vendor_changelog, package_registry |
| **low** | community(StackOverflow/블로그), cached_archive(web.archive.org) |
| **rejected** | generated_seo, expired without alternatives |

generated_seo는 *어떤 경우에도 authoritative 인용 불가*.

#### Tool Selection (context-dependent)
Lib API spec→Context7→WebFetch official; Version compat→WebFetch changelog/migration→registry;
CVE→WebFetch CVE/GHSA→벤더 feed; Standards→WebFetch 표준 doc; Community(last resort)→WebSearch + low caveat;
Freshness→WebFetch *직접*.

#### Stop Criteria (고정 budget 아님)
```
sufficient_evidence: claim verified at trust ≥ medium AND no contradictions
diminishing_returns: 3+ sources agree
blocking_failure: source inaccessible OR user input needed
safety_cap (per Investigate invocation; canonical stem subset, compound은 sub-flow 최대치 적용):
  migration / feature / spike: 60s wall, 30k tokens
  bugfix-unreproducible / performance: 40s, 20k
  bugfix / bugfix-p0 / refactor / test: 20s, 10k (claim-driven override 허용)
  chore / release / review / retro / exploration / plan-standalone: 10s, 5k
```
caps는 default. 특정 claim이 더 필요 시 명시 rationale로 cap 초과 가능, reviewer 검증.

#### Provenance (claim 중요도별)
| Claim 분류 | Provenance 요구 |
|---|---|
| decision_critical | 전체: url + accessed_at + content_hash + source_type + version_snapshot |
| version_sensitive | 전체 |
| conflict_with_internal | 전체 |
| feasibility_critical | 전체: url + accessed_at + content_hash + source_type + version_snapshot (spike feasibility 판단 입력 — decision_critical과 동일 depth) |
| background_context | aggregated: `sources_consulted`, `primary` |

#### Conflict 처리 (외부 vs 내부 사실)
| 충돌 유형 | 규칙 |
|---|---|
| External API fact vs 내부 캐시 | **external 채택**, conflicts 기록 |
| 내부 contract/policy/규칙 vs external | **내부 채택**(silent override 금지), conflicts 기록 |
| 소스 권위 모호 | conflicts 기록, user/Decide 결정 위임 |

**원칙**: 내부 source-of-truth는 owner 결정 없이 silent override 안 됨.

#### No-Results 처리 (claim 중요도별 — degrade, escalate 아님; principle 1)

> 이 표는 `external_research[].no_results_handling`의 *결정적* 매핑이다 (claim_class → 처분 값). **M2 INV-M2-15**가 (a) `no_results_handling` present iff `result.status=='omitted'` (degrade/no-results finding일 때만 의미), (b) 값이 아래 claim_class 행과 일치함을 강제한다 (Measured result에 no_results_handling 동반, Omitted인데 부재, 또는 claim_class와 어긋난 값 = FAIL). 5개 claim_class enum 전부를 덮어 Omitted+claim_class 조합이 silent 0.

| Claim 분류 | 처리 |
|---|---|
| decision_critical | compatibility issue 등록 (blocks_flow 또는 requires_user) → `no_results_handling=compat_issue` |
| version_sensitive | risk_surface 항목 + follow-up flag → `no_results_handling=risk_surface` |
| conflict_with_internal | compatibility issue 등록 (외부 확인 실패 → 내부 사실과의 충돌 미해소가 차단/사용자 결정 요인) → `no_results_handling=compat_issue` |
| background_context | 진행, unknown disposition=defer → `no_results_handling=defer` |
| feasibility_critical (Spike) | *negative signal*로 명시 — "no evidence found" 자체가 사실 → `no_results_handling=negative_signal` |

#### Failure Recovery
| Failure | 처리 |
|---|---|
| Rate limit | 우선순위 fallback (Context7 한도→WebFetch→WebSearch caveat) |
| Network error | 1 재시도 → unknown[external_inaccessible] |
| Auth required | unknown[external_inaccessible: auth] → escalate or skip |
| Paywall | unknown[external_inaccessible: paywall] |
| 모든 source 실패 | claim 중요도별 No-Results 처리 (degraded — verdict 계속 산출) |

> 이 모든 외부-리서치 실패는 **degraded branch**다 (principle 1: enhancement 도구). verdict 산출을
> 막지 않으며, 해당 claim만 unknown/risk/compat-issue로 강등한다. ED MCP(primary) 부재의 escalate와 구별됨.

#### A2A External Auth
| 상황 | 처리 |
|---|---|
| user_session: auth 필요 | user에 credential 요청 (NEEDS_CONTEXT) |
| A2A: caller가 credential payload 포함 | 그대로 사용 (provenance: caller-supplied) |
| A2A: credential 없음 | unknown[external_inaccessible: auth] — caller 알림 (INTENT_INCOMPLETE 가능) |
| CI: secret manager 통합 | 사전 설정 secret 사용 (config 지정) |

Auth 자체는 Investigate 책임 아님 — 외부 도구가 credential 받음. Investigate는 graceful 처리.

---

## 닫은 홀 요약 (traceability)

| Hole (investigate entry) | 닫은 방법 | 태그 |
|---|---|---|
| 빈/degenerate Ground(entry_nodes 0) → V1 자동 proceed 고무도장 (**worst**) | PC1이 V1보다 선행; V0/V1 보강 ("빈 issues→proceed"는 entry_nodes 비어있지 않을 때만); 빈-합법 vs 빈-결손 구분 | P7, principle 3 |
| `request_upstream_deepen`이 유일 방어인데 verdict 미연결 + Decide 전용 신호인데 오용 우려 | Investigate는 그 신호 emit 안 함; failure_origin escalate 경로로 라우팅 명시 | principle 2 |
| triage_mismatch production rule + 동반 verdict + proceed 공존 미정의 | production rule(구조적 모순 시 emit) + 동반 result 규칙(무효화→needs_clarification / 권고적→proceed 공존 / no_op·blocked 자동유발 금지) + reclassify는 surface-only | P6, P8, principle 2 |
| Compound no-op 행 누락 (aggregate 조건) | Validity 표에 Compound 행 + V14(sub_flow_verdicts 전부 no_op) | P7, principle 3 |
| no_op_details.suggested_action 매핑 미정의 | flow별 suggested_action 매핑 표 + 선택 규칙(abandon/wait_for_change/reframe_request) | P6 |
| 필수 Ground 필드 부재 vs present-but-empty 미구분 | PC4 (필드 존재 assert) + Validity 표 전제("필드 존재 시만 평가") | P8, principle 3 |
| silent fact-vs-fact contradiction 처분 경로 없음 | unknown matrix 보강: Investigate 발견 모순 → risk_surface(+needs_clarification 승격), 해소는 안 함 | principle 1·3 |
| STALE Ground intake 미방어 | PC2(hash 존재 assert) + stale *판정*은 Decide/Verify 위임 명시(boundary) | P8 (boundary 준수) |
| ED MCP(주요 도구) 부재 처리 없음 (P2 류) | Failure & degrade (1): ed_availability Omitted + mechanical error escalate | P2, principle 1 |
| proceed(success) 분기 미명시 | Result enum & branches 절: proceed/partial_proceed를 1급 success 분기로 선언 | P1 |
| (2nd-order) V2 unconditional이 V13 partial_proceed를 삼킴 + partial_proceed mechanical predicate 부재 | issue.scope_confined 필드 추가 + V2를 V2a(flow-wide→blocked)/V2b(scope-confined→partial_proceed)로 분기 + V13을 V2b 충족으로 mechanical 정의 + precedence(V2가 result 강제 아닌 scope 판정만) | P1 |
| (2nd-order) Compound mixed no_op/proceed sub-flow 출력 슬롯 없음 (no_op_set 부재) | partial_scope_handling.no_op_set 추가 + V14b(mixed: non-no_op이 result 결정, no_op sub-flow는 no_op_set/sub_flow_verdicts에 보존) | P7, principle 3 |
| (2nd-order) needs_clarification 재invoke 루프 무한 (5-FAIL cap이 합법 result 미카운트) | clarification_round cap 3 + 3회 미해소 시 RETRY_EXHAUSTED halt(기존 abandoned 메커니즘 재사용, 새 failure_origin 값 발명 안 함) | principle 3 |
