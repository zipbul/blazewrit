# Report — Deliverable Synthesis

## Definition

> **Report은 분석·조사·리뷰 결과를 deliverable로 합성한다.** 비코드 flow의 terminal artifact 산출.

사용 flow: Review, Retro, Exploration, Spike, plan-standalone, Compound (top-level summary).

**경계 재확인 (principle/boundary)**: Report는 *합성만* 한다. upstream artifact를 *게이팅*하지 않고(그것은 Investigate의 compatibility_verdict 일), flow-level 실패를 *라우팅*하지 않는다(그것은 Verify 일). Report가 sound deliverable을 만들 수 없으면 *오직* 자기 result enum의 escalate 분기로 신호할 뿐이며, 어느 step이 문제인지 진단하거나 followup flow를 큐잉하지 않는다.

## Inputs

- Investigate 출력 (findings 원천: impact_map, constraints, risk_surface, compatibility_verdict)
- Decide 출력 (mode별 결정/옵션/설계: decision_record, followup_flows?, design 산출물)
- Ground 출력 (fact 근거 — evidence_ref의 provenance 대상)
- Flow-specific 추가 입력:
  - **Spike**: Implement(prototype) 결과 (prototype 산출물 ref + 관찰된 feasibility 신호) — GO/NO-GO/CONDITIONAL verdict의 입력 (P1: success object 참조)
  - **Compound**: sub-flow 결과 (아래 "Compound input shape" 정의)

### Compound input shape (P6/P8: 입력 모양 정의 — 닫음: Compound input 무정의)

`report_type=compound`에서 Report가 받는 sub-flow 결과는 다음 모양으로 *정형 가정* 한다 (입력 precondition으로 assert — "Input preconditions" 절 참조):

```yaml
sub_flow_results:                              # Compound 전용. 각 sub-flow가 자체 flow로 종료된 결과
  - sub_flow_id                                # 식별자 (Decide.sub_flow 분해의 id와 동일)
    sub_flow_type                              # 16 정규 flow-file stem 중 하나 (아래 enumerated)
    terminal_result                            # completed | abandoned | suspended (Reflect 분류 동일 enum 재사용)
    verdict_ref?                               # sub-flow가 자체 Report를 냈으면 그 row ref (Spike sub-flow의 GO/NO-GO 등)
    finding_refs: [<investigate/report finding ref>]   # 집계 대상 finding의 provenance ref
```

**sub_flow_type 정규 16 flow-file stem (닫음: '16 flow id' dangling reference — contract_hole)**: `sub_flow_type`의 합법 값 집합은 다음 16개 hyphenated flow-file stem이다 (cross-cutting decision 1; underscore 없음) — 이 닫힌 집합 멤버십을 compound input precondition x-m2-validator-contract("sub_flow_results (compound INPUT precondition)")가 terminal_result와 *나란히* 실제로 강제(out-of-set/malformed → escalate, failure_origin=upstream)하므로 sub_flow_type well-formedness가 *falsifiable* 해진다. (sub_flow_type은 INPUT 필드이고 OUTPUT schema에 없으므로 M1 grammar로는 표현 불가 — input precondition M2 check가 유일 강제 지점이다.):

```
feature | bugfix | bugfix-p0 | bugfix-unreproducible | refactor | performance | migration | test | chore | plan-standalone | review | release | retro | spike | exploration | compound
```

(이 16개는 *전체* flow stem 집합이다. report_type 매핑 6개(review/retro/exploration/spike/plan-standalone/compound, "report_type assignment rule")는 비코드 flow의 부분집합이며, sub-flow는 코드 flow stem(feature/bugfix/… )도 합법적으로 가질 수 있다 — Compound는 코드·비코드 sub-flow를 모두 집계하므로.)

→ `based_on`에 **sub_flow_refs** 필드를 추가로 carry 한다 (아래 Output). README 원본은 investigate_ref/decide_ref/ground_ref만 carry했고 compound source를 추적할 자리가 없었음 — 닫음. 추가로 Output은 machine-consumable **`sub_flow_summaries`** 객체({ sub_flows: [{ flow_ref, outcome, terminal_result, source_tool, verdict_ref? }], sub_flow_count })를 carry 한다 — `body.summary`(human-readable) + `based_on.sub_flow_refs`(provenance)와 *공존* 하며 어느 쪽도 다른 쪽을 대체하지 않는다 (cross-cutting decision 5).

## Activities

1. **report_type assignment** — flow_type → report_type 매핑 (아래 "report_type assignment rule"). *결정이 아니라 mechanical 매핑* (boundary: Decide 일 침범 아님).
2. **Synthesize** — Investigate/Decide 산출물을 narrative로 합성. Spike이면 prototype 결과를 읽어 feasibility verdict 산출 (P1: Spike verdict).
3. **Severity 분류** — Review/Retro의 findings에 severity 부여. severity 척도 = Investigate.risk_surface의 단일 척도 재사용 (P6/principle: ONE risk scale).
4. **Action items** — Decide.followup_flows 연결 (Decide가 이미 낸 것을 *참조*; Report가 새 flow를 만들지 않음 — boundary: Verify/orchestrator 일).
5. **검증 trail** — 모든 claim에 evidence_ref. evidence를 추적할 수 없으면 "Failure & degrade handling"의 dangling-evidence 분기 적용 (asserting away 금지).

## report_type assignment rule (닫음: report_type 매핑 무정의 — P6/P8)

`report_type`은 *결정이 아니라* flow_type에서 mechanical 파생된다. orchestrator가 active flow의 flow_type을 주입하고 Report는 다음 1:1 테이블로 set 한다:

| flow_type | report_type |
|---|---|
| Review | `review` |
| Retro | `retro` |
| Exploration | `exploration` |
| Spike | `spike` |
| plan-standalone | `plan_standalone` |
| Compound | `compound` |

- 위 6개 외의 flow_type에서 Report step이 호출되면(코드 flow는 Report step이 없음 — "Constraint" 절) → 그 자체가 입력 precondition 위반 → `result=escalate, failure_origin=upstream` (P8: garbage-in detect). Report는 임의로 report_type을 *추측하지 않는다*.
- flow_type이 주입되지 않았거나(missing) 위 enum 밖 값이면(malformed) → escalate (principle 3: missing/malformed ≠ legitimately empty).

## Result enum & branches (닫음: 성공/실패 출력 미정의 — P1, principle 1, principle 3)

Report는 Investigate.compatibility_verdict와 *동일한 형태*(discriminated result enum + orchestrator 라우팅 테이블)로 **성공 분기까지** 선언한다. 실패만 정의하던 README 원본을 보강.

```yaml
report:
  result: synthesized | empty_clean | escalate     # discriminant (P1)
  report_type: review | retro | exploration | spike | plan_standalone | compound   # result≠escalate일 때
```

> **envelope/correlation (cross-cutting decision 4)**: Report structured_output은 `flow_id`/`schema_version`/`produced_at`/`verified_at`를 *자유 기입하지 않는다*. §5에 따라 cross-step/flow correlation은 RowRef 기반(`based_on`)이며, row id·timestamp는 orchestrator/persistence layer가 주입한다. `result=escalate`는 *유효한 report_type 없이도* 산출 가능하다(code flow / flow_type missing·malformed precondition 위반 → escalate, failure_origin=upstream).

| result | 의미 | 산출 | Orchestrator 처리 |
|---|---|---|---|
| `synthesized` | sound deliverable 합성됨 (정상 성공) | 아래 **Success terminal-artifact object** 전체 | Verify step 진입 (terminal artifact가 row로 존재) |
| `empty_clean` | 보고할 내용이 *합법적으로* 없음 (principle 3: legitimately empty — verdict이지 error 아님) | minimal artifact(`empty_details` 중심) — report_type별 minimum-content bar는 *면제*(그 bar는 `synthesized`만 게이팅). 따라서 `body.summary`가 비거나 부재해도 됨 | Verify 진입 (Exploration "no minimum structure" 충족) |
| `escalate` | Report 자기 scope 내에서 sound deliverable 합성 *불가* (principle 1: 보조 입력이 아니라 합성 자체가 막힘) | `escalate_details` (아래) | **NEEDS_CONTEXT** — 기존 경로로 user/caller escalate. Report는 failure_origin을 *진단*하지 않고 `failure_origin=upstream`(또는 입력별 구체 origin)만 신호; orchestrator가 5-누적-fail halt cap 안에서 producer⇄reviewer 재진입 라우팅 |

> **principle 1 (tool-absence)**: Report의 PRIMARY 입력은 도구가 아니라 *upstream artifact*다(Report는 MCP 도구에 의존하지 않는 순수 합성 step). 따라서 P2(자기 도구 부재) 분기는 Report에 해당 없음 — Report에는 escalate-할 "주요 도구"가 없다. upstream artifact 부재/기형이 Report의 escalate 트리거다("Input preconditions"). **(boundary: Report는 Verify식 failure_origin *라우팅*을 갖지 않는다 — escalate를 *신호*만 하고 orchestrator의 기존 NEEDS_CONTEXT 경로로 위임한다.)**

### Success terminal-artifact object (P1: 성공 객체 *전체* 선언)

`result=synthesized`일 때 산출되는 terminal artifact의 전체 모양. README 원본의 success-shape를 보존·확장 (Spike verdict + sub_flow_refs 추가):

```yaml
body:                                          # deliverable 본문 (free-form narrative). report_type별 minimum-bar의 "content/summary/design+next step"가 담기는 *유일* slot. 아래 "body 생산 규칙"
  summary                                       # required when result=synthesized — top-level narrative (모든 report_type)
  sections?: [{ heading, content }]             # 선택적 구조화 본문 (plan_standalone의 design document 등)
  next_step?                                    # report_type=plan_standalone일 때 *필수* (minimum-bar "next step 명시")

findings:                                      # report_type별 minimum은 "Empty/degenerate input" 절
  - id                                         # invocation-scoped unique
    statement                                  # narrative claim
    severity: low | med | high | critical      # (P6/principle: Investigate.risk_surface 단일 척도. 아래 "Severity & priority")
    evidence_ref:                              # required. 판별 oneOf 객체 (bare string 아님). 추적 불가 시 dangling-evidence 분기
      # { kind: row_ref, row_ref } (ground/investigate row — decide row는 evidence_ref 대상 아님)
      # | { kind: source_manifest, source_manifest } (직접 읽은 file:line, R36 재읽기)
      # | { kind: reproduction_steps, reproduction_steps: [<string>] }
    impact?                                    # finding 무시 시 결과 (agent.md L25)
    verify_probe                               # required (R20 — 기계 재실행 가능 probe; M2가 재실행)
    source_tool                                # required (R26 provenance floor — 무출처 finding은 reject)
    unverified: <bool>                         # required (R13 KEEP polarity — persist; Verify가 단일 게이트)

action_items:                                  # Decide.followup_flows에서 파생 (Report가 새 flow 생성 안 함)
  - description
    priority: low | med | high | critical      # (P6/principle: 동일 단일 척도. 출처: origin finding/risk severity 재투영. 아래 "Severity & priority")
    owner?
    followup_flow_ref?                          # Decide.followup_flows 항목 ref (orchestrator가 큐잉)

feasibility_verdict?:                          # report_type=spike일 때 *필수* (P1: Spike go/no_go 자리 — worst hole 닫음)
  verdict: go | no_go | conditional            # lowercase enum (harness style, cross-cutting decision 3)
  rationale                                    # required — prototype 관찰 → verdict 근거
  conditions?: [<string>]                      # verdict=conditional일 때 필수 + 비어있지 않음 (minItems:1 — 빈 list로 vacuous-pass 금지; 충족돼야 할 조건)
  evidence_ref: <implement(prototype) result row ref>   # required — verdict의 prototype 근거 (§5 RowRef)

based_on:
  investigate_ref                              # required (Report 입력 = Investigate+Decide+Ground; 셋 다 RowRef)
  decide_ref                                   # required
  ground_ref                                   # required
  sub_flow_refs?: [<row_ref>]                  # report_type=compound일 때 필수 (Compound source 추적 — 닫음). 각 item은 sub-flow row를 가리키는 §5 RowRef(provenance), 입력의 sub_flow_id가 아니다(cross-cutting decision 4: based_on은 RowRef 기반). sub_flow_summaries(아래)와 공존
```

**feasibility_verdict 생산 규칙 (P1: Activities가 verdict를 *실제로* 만들도록)**: Activity 2(Synthesize)에서 report_type=spike이면 Report는 Implement(prototype) 결과(Inputs)를 읽어 go/no_go/conditional 중 하나를 *반드시* 산출한다. prototype 결과가 명확한 feasibility 신호를 주면 go 또는 no_go, 부분 충족·미해결 조건이 남으면 conditional(+conditions). prototype 결과가 *부재/기형*이면(precondition fault) verdict을 *추측하지 않고* `result=escalate, failure_origin=implement` (principle 3: missing ≠ 합법적 verdict). 이는 flows/README.md "Non-Implementation Flow Completion Criteria" 표(Spike = "Report exists + feasibility verdict (go/no_go/conditional)")를 만족시키는 유일 산출 경로.

**body 생산 규칙 (P1: minimum-bar deliverable를 담는 slot — 닫음: content/summary/design+next-step 무자리)**: `result=synthesized`이면 Activity 2(Synthesize)는 narrative 합성 산출을 *항상* `body.summary`에 담는다 (모든 report_type 공통 top-level). report_type별 추가 요건은 같은 slot 안에서 충족된다 — *별도 출력 채널을 만들지 않는다* (boundary: 본문은 Report 합성물, findings/action_items와 동일 객체):
- `report_type=exploration` minimum-bar "content 존재" = `body.summary` 비어있지 않음 (findings/action_items 0이어도 충족; "Empty/degenerate input" 절).
- `report_type=compound` minimum-bar "top-level summary" = `body.summary`(요약) + `based_on.sub_flow_refs`(provenance). 둘 다 필수. **Cardinality 불변식**: compound의 세 평행 표현 — `sub_flow_summaries.sub_flows`, `sub_flow_summaries.sub_flow_count`, `based_on.sub_flow_refs` — 의 cardinality가 *반드시* 일치한다: `sub_flow_count == len(sub_flows) == len(sub_flow_refs)`. (마찬가지로 plan_standalone은 `task_count == len(task_list.tasks)`.) M1 grammar는 cross-field cardinality를 표현 불가하므로 x-m2-validator-contract("task_list.task_count / sub_flow_summaries.sub_flow_count")가 강제한다 — 예: sub_flows 3개인데 sub_flow_count=7, sub_flow_refs 2개면 FAIL.
- `report_type=plan_standalone` minimum-bar "design document + next step" = `body.sections`(design document) + `body.next_step`(다음 단계) 둘 다 필수 *그리고* machine-consumable **`task_list`**({ tasks: [R19 task], task_count: cross-checked int — `task_count == len(tasks)` }) 필수. `task_count`는 CountClaim이 *아니다*: 측정 명령의 stdout이 아니라 모델이 합성한 task array를 세는 값이므로(CountClaim을 강요하면 비-도구-측정 수량에 대해 command+sha를 *날조*하게 만든다 — CountClaim이 막으려던 바로 그것). 대신 sibling array 길이와의 cross-check(아래 cardinality 불변식)로 진실을 보증한다. 두 모양은 *공존* 한다 (cross-cutting decision 5): `task_list`는 Spec/Implement 없이 직접 consume 가능한 기계 산출(R19 verbatim/정제, deferral 금지), `body.sections`/`body.next_step`는 human-readable 설계 narrative — 어느 쪽도 다른 쪽을 대체하지 않는다. Decide(Design) 산출을 narrative+task로 옮길 뿐 *새 설계를 만들지 않는다* (boundary: 설계 *생성*은 Decide). Decide(Design) 산출이 부재/기형이면 `result=escalate, failure_origin=decide` (verdict 추측 금지와 동일 원칙).
- review/retro/spike는 본문이 findings/action_items/feasibility_verdict로 충분하므로 `body.summary`만 채우고 sections/next_step은 생략 가능.

**priority 생산 규칙 (닫음: action_items.priority 무출처 — boundary)**: `action_items[].priority`는 Decide가 *결정*하는 값이 아니다 (Decide.followup_flows는 `{type, scope_ref, scope_hash}`만 carry — priority 필드 없음). Report는 새 우선순위를 *발명하지 않고*, Activity 3(Severity 분류)의 *동일한 classification 행위*로 priority를 부여한다: 각 action_item의 priority = 그 action_item을 발생시킨 **origin finding/risk의 severity를 재투영** (동일 `low|med|high|critical` 척도). origin finding이 없는 action_item(followup-only)은 연결된 `followup_flow_ref`(→ Decide.followup_flows.scope_ref가 가리키는 Investigate finding/risk_surface row)의 `severity`를 재사용한다 (Decide가 새 severity를 만드는 게 아니라 Investigate의 단일 척도 row를 따라감). 둘 다 추적 불가하면 priority를 *추측하지 않고* 그 action_item은 evidence 없는 claim과 동일 처리("Dangling/missing evidence_ref" 분기). 이는 Activity 3(Report의 classification lane)에 머물며 Decide의 *결정·sequencing 우선순위*(decide.md "옵션 비교 + 선택 + sequencing")를 침범하지 않는다 — Report는 *triage 라벨*만 재투영하고 *순서를 정하지 않는다* (boundary: Activity 4가 명시한 "Decide가 낸 것을 *참조*"와 일관).

**outcome 생산 규칙 (닫음: sub_flow_summaries.sub_flows[].outcome 무출처 — contract_hole)**: `sub_flow_summaries.sub_flows[].outcome`는 Compound input shape에 *없는* 필드다 (입력은 sub_flow_id/sub_flow_type/terminal_result/verdict_ref?/finding_refs[]만 carry). Report가 *발명하지 않고* Activity 2(Synthesize)에서 각 sub-flow의 입력으로부터 *합성*한다 — one-line outcome = 그 sub-flow의 `verdict_ref`(있으면 그 verdict 결론, 예: Spike sub-flow의 go/no_go) + `finding_refs`(집계된 finding 요지) + `terminal_result`(completed|abandoned|suspended)를 한 줄로 합성. verdict_ref/finding_refs가 *둘 다 부재*해 합성할 내용이 terminal_result뿐이면 outcome은 terminal_result 재진술로 degrade 한다(예: "abandoned, no findings" — 합법적 빈 요약이지 결손 아님). 그러나 그 sub-flow의 `terminal_result` *자체가* missing/malformed면(요약의 최소 입력조차 부재) → `result=escalate, failure_origin=upstream`(빈-결손; 빈-합법으로 도장 금지 — principle 3, "Input preconditions" sub_flow_results 행과 일관). 이 missing/malformed terminal_result 검사는 OUTPUT schema의 `sub_flow_summaries.sub_flows[].terminal_result`(required+enum)로는 *표현 불가능* 하므로(garbage-in은 input 쪽에만 존재) M1 grammar가 아니라 INPUT precondition x-m2-validator-contract("sub_flow_results (compound INPUT precondition)")로 실제 강제된다 — 산문만 narration하고 grammar가 잡는 척하지 않는다.

**source_tool 생산 규칙 (닫음: sub_flow_summaries.sub_flows[].source_tool 무출처 — contract_hole)**: `sub_flow_summaries.sub_flows[].source_tool`(R26 provenance floor, OUTPUT required)도 outcome과 *동일하게* Compound input shape에 *없는* 필드다 (입력 row는 sub_flow_id/sub_flow_type/terminal_result/verdict_ref?/finding_refs[]만 carry — source_tool 없음). Report가 *발명하지 않고*(R26 위반 — 무출처 provenance 날조 금지) Activity 2(Synthesize)에서 각 sub-flow 입력 row로부터 *파생*한다: 각 `sub_flows[].source_tool` = 그 sub-flow의 집계된 row를 *실제로 생산한* upstream step 식별자다 — 즉 sub-flow가 자체 Report를 냈으면(`verdict_ref` 존재) 그 sub-flow의 **terminal Report step**, Report 없이 종료됐으면(verdict_ref 부재) `finding_refs`가 가리키는 row를 낸 sub-flow의 **terminal step**(예: Investigate/Reflect)을 source_tool로 기록한다. source_tool은 Report 자신(top-level Compound)이 아니라 *aggregated sub-flow의 출처 step*을 가리킨다 — Report는 그 row의 provenance를 *전달(propagate)*할 뿐 자기 자신을 출처로 도장하지 않는다(boundary: Report는 sub-flow를 합성만 함). source_tool을 가리킬 upstream row(verdict_ref도 finding_refs도)가 *없어* 출처를 파생할 수 없으면 → `result=escalate, failure_origin=upstream`(무출처 sub-flow를 fabricate된 source_tool로 도장 금지 — R26 provenance floor, principle 3). 이 source_tool 추적 가능성(파생할 upstream provenance row 존재) 역시 OUTPUT schema의 `sub_flow_summaries.sub_flows[].source_tool`(required) M1 grammar로는 *표현 불가능* 하므로(원천 row는 input 쪽에만 존재) INPUT precondition x-m2-validator-contract("sub_flow_results (compound INPUT precondition)")가 terminal_result/sub_flow_type과 *나란히* 강제한다 — grammar가 잡는 척하지 않는다.

### Severity & priority — 단일 척도 (닫음: severity/priority enum 무정의 — P6, principle 6)

`findings[].severity`와 `action_items[].priority`는 **둘 다** Investigate.risk_surface가 이미 쓰는 *그 하나의* 척도를 재사용한다:

```
low | med | high | critical
```

- **두 번째 척도를 발명하지 않는다** (principle 6). 코드베이스에 존재하는 또 다른 척도(compatibility-verdict.md의 `fatal|high|medium|low`)는 *issue 분류용*이며 Report가 인용하지 않는다 — Report는 risk_surface 척도 하나로 통일. 이로써 reviewer의 "severity가 있는가"가 *falsifiable* 해짐(legal value 집합이 명시됨).
- `severity`/`priority` 값이 위 enum 밖이거나 비어 있으면(finding은 있는데 severity 미부여) → reviewer FAIL(기계 강제). default 없음 — Report가 *반드시* 명시적으로 부여한다(Activity 3).

## Input preconditions (닫음: garbage-in 맹신 — P8, principle 1·3)

> 횡단 input-precondition 절(전 소비자 동일 문구의 Report판). Report는 합성을 시작하기 전에 *필수 upstream 필드의 존재+정형*을 assert 한다. 진실성은 assert하지 않는다(그건 Verify 일 — boundary). 결손/기형이면 `result=escalate, failure_origin=upstream`(또는 입력별 구체 origin). 이 escalate는 안전하다 — orchestrator의 `(flow_id, step)` **5-누적-fail halt cap**(decide/failure-routing.md)이 producer⇄reviewer ping-pong을 bound 하므로.

| 입력 | precondition (존재+정형) | 위반 시 |
|---|---|---|
| `flow_type` (주입) | 6개 비코드 flow_type 중 하나로 존재 | escalate, failure_origin=upstream (report_type 추측 금지) |
| Investigate findings 원천 | report_type이 findings를 요구하는 경우(review/retro) 정형 risk_surface/impact 존재 | escalate, failure_origin=investigate |
| Decide 산출 | report_type이 결정/followup을 요구하는 경우 decision_record 정형 존재 | escalate, failure_origin=decide |
| Implement(prototype) 결과 | report_type=spike일 때 prototype 결과 row 존재+정형 | escalate, failure_origin=implement (verdict 추측 금지) |
| sub_flow_results | report_type=compound일 때 위 "Compound input shape"대로 존재 — 각 row의 `terminal_result` ∈ {completed,abandoned,suspended} *그리고* `sub_flow_type` ∈ 16 flow-file stem 정형 *그리고* output `source_tool`을 파생할 provenance row(verdict_ref 또는 finding_refs) 존재 (x-m2-validator-contract "sub_flow_results (compound INPUT precondition)"가 세 조건 모두 강제 — "source_tool 생산 규칙" 참조) | escalate, failure_origin=upstream |

**principle 3 구분 강제**: "필드는 존재하나 내용이 비었다"(예: Investigate.findings가 빈 list — Exploration/Retro의 *합법적* 결과)는 **escalate 아님** → `result=empty_clean` 또는 `synthesized`(verdict). "필드 자체가 missing/malformed/upstream broken"만 escalate. *절대로* 두 번째를 첫 번째로 silent rubber-stamp 하지 않는다.

## Failure & degrade handling (닫음: 내부 실패/escalate 출력 부재 + dangling evidence — P1, P8)

### result=escalate 산출 모양

```yaml
escalate_details:
  reason                                       # 왜 sound deliverable 합성 불가
  failure_origin: upstream | investigate | decide | implement | self   # 입력별 (Report는 진단 책임 없음 — 입력 precondition이 가리키는 가장 가까운 origin). self = Report 자기 active depth-cap(wall_s/tokens) 소진 — Shallow(wall_s=30/tokens=5k) 또는 Deep(wall_s=180/tokens=15k) 중 *활성* cap; 입력은 정형이나 budget 내 합성 미완("Step Depth Policy" self-cap 분기). cross-cutting decision 4의 shared FailureOrigin 'cap_exceeded'(Verify flow-level cap)와 구분된 Report-local origin
  evidence: <missing/malformed field ref>      # 무엇이 결손/기형인지
based_on?: { investigate_ref?, decide_ref?, ground_ref?, sub_flow_refs? }   # 선택. escalate 전에 *실제로 소비한* upstream row들의 §5 RowRef provenance. 입력이 부분적/부재일 수 있으므로 어느 key도 required 아님(synthesized|empty_clean 분기와 달리 셋 다 강제하지 않는다). partial-input escalate(예: spike에서 prototype은 부재지만 Investigate/Decide row는 존재, failure_origin=implement) 또는 self-cap escalate(모든 입력 정형, failure_origin=self)에서 *어느 upstream row를 소비했는지* 기계-추적 가능하게 한다 — orchestrator의 NEEDS_CONTEXT 라우팅 + 5-누적-fail cap이 prose string이 아닌 RowRef로 escalate provenance를 해소
```

- orchestrator는 이 신호를 **기존 NEEDS_CONTEXT 경로**로 처리한다(Report가 routing 테이블을 소유하지 않음 — boundary). failure_origin=report로 *Report 자신*이 재진입되는 것은 Verify의 failure-routing(failure-routing.md: 비코드 flow에서만 유효)이며 *그것도 Verify가 트리거*함 — Report는 자기 escalate만 낸다.
- **R16 chain-match는 escalate에 적용되지 않는다**: escalate 분기는 `declared_next_step`을 carry하지 않는다(escalate object는 `result`+`escalate_details`[+ 선택적 `based_on` provenance]만 산출하고 `declared_next_step`은 없다 — 정상 successor 'verify'를 선언할 수 없음). chain-match(declared_next_step == expected_next_step)는 `result ∈ {synthesized, empty_clean}` 산출에만 적용되며, escalate일 때 orchestrator는 declared successor가 아니라 NEEDS_CONTEXT로 라우팅한다.
- **request_upstream_deepen 금지 (principle 2)**: Report는 `request_upstream_deepen`을 *발행하지 않는다* — 그 신호는 Decide 전용(1-cycle cap). degenerate/missing upstream은 위 `failure_origin` escalate 경로로만 라우팅.

### Dangling/missing evidence_ref (닫음: assert away 대신 처리)

Activity 5는 "모든 claim에 evidence_ref"를 *불변식*으로 요구한다. 그 불변식을 만족할 수 없을 때의 동작을 정의한다(asserting away 금지):

- claim의 근거가 *합법적으로 unverified* (Investigate가 unverified 플래그로 전달한 사실): finding은 유지하되 evidence_ref에 그 unverified 원천 ref를 달고 propagate 한다 — *drop 하지 않는다*(enforcement.md L41: `[UNVERIFIED]`는 설계상 persist, Verify가 단일 게이트). Report는 unverified를 *지우는* 게이트가 아니다(boundary).
- claim에 추적 가능한 evidence_ref가 *아예 없고* 그것이 합성의 핵심 claim이면: 그 claim은 합성에서 *제외*하거나(보조 claim일 때), 핵심이라 제외하면 deliverable이 무의미해지면 → `result=escalate, failure_origin=<해당 upstream>`(근거 없는 claim을 사실로 도장 금지 — principle 3).

## Empty/degenerate input — minimum-content rules (닫음: 빈 findings/followup 동작 미정의 — P7/principle 3)

Investigate.findings가 비었거나(Exploration/Retro의 *합법적* outcome) Decide가 followup_flows를 안 냈을 때의 동작. 여기서 핵심은 **"빈-합법(verdict) vs 빈-결손(escalate)" 구분**(principle 3) + **report_type별 최소 완료 바**(flows/README.md "Non-Implementation Flow Completion Criteria" 표 권위 인용).

### report_type별 최소 완료 바 (단일 flat schema가 아니라 분기별 minimum)

> **이 minimum-content bar는 `result=synthesized`만 게이팅한다.** `result=empty_clean`은 이 bar에서 *면제* — empty_clean은 `empty_details` 중심 minimal artifact로 충족되며 per-report_type minimum(예: exploration의 `body.summary` 비어있지 않음)을 만족할 필요가 없다. 아래 표의 "최소 완료 바" 칸은 *synthesized* 산출에 적용되고, "빈 입력 시" 칸이 empty_clean/escalate 분기를 정의한다.

| report_type | 최소 완료 바 (권위: flows/README.md 표) | 빈 입력 시 |
|---|---|---|
| `review` | **≥1 finding** (각 finding에 severity tag). finding이 *합법적으로* 0개 = clean review → synthesized 아님 | findings 0 + upstream 정형 → `result=empty_clean`, empty_details(reason="clean: no issues found", evidence). 즉 `result=synthesized` review는 findings minItems:1 (0-findings는 empty_clean으로 라우팅되지 summary-only synthesized가 아니다 — synthesized-only allOf의 review 분기로 기계 강제) |
| `retro` | **≥1 action_item** | 두 경우 구분: (a) upstream(Decide/Investigate) 산출은 *정형 존재*하나 그로부터 합성할 학습/action_item이 합법적으로 0개 → `result=empty_clean`, empty_details(reason="clean: no actionable learnings", evidence=정형 upstream row ref). 이 minimum-bar(≥1 action_item)는 *synthesized만* 게이팅하므로 empty_clean은 면제. (b) upstream 자체가 *부재/기형*(학습거리를 낼 입력이 broken) → `result=escalate, failure_origin =` *broken된 입력의 origin* (Investigate-missing이면 `investigate`, Decide-missing이면 `decide` — "Input preconditions" 표 L159-160의 입력별 origin을 따름; decide로 hardcode 금지). 빈-결손(b)을 빈-합법(a)으로 도장 금지 |
| `exploration` | content 존재 = `body.summary` 비어있지 않음 (no minimum structure) | findings/action_items 0이어도 `body.summary` 있으면 `synthesized`. `body.summary`조차 없으면 `empty_clean`(suggested: reframe_request) |
| `spike` | Report 존재 + feasibility_verdict (go/no_go/conditional) | findings 0이어도 verdict는 *필수* — verdict 없으면 `escalate`(failure_origin=implement). verdict 있으면 `synthesized`. **report_type=spike는 empty_clean 케이스가 없다** (verdict-or-escalate): verdict이 있으면 synthesized, 없으면 escalate이다 (empty_clean 면제 상태가 존재하지 않으므로 "synthesized에만 게이팅" 단서는 적용 대상이 없다 — review/retro/exploration/compound에만 해당) |
| `plan_standalone` | `task_list`(machine) + design document(`body.sections`) + next step(`body.next_step`) 모두 존재 | Decide(Design) 산출이 정형 존재 → `synthesized`; 부재면 `escalate, failure_origin=decide`. **report_type=plan_standalone도 spike처럼 empty_clean 케이스가 없다** (design-or-escalate): Decide(Design)이 있으면 synthesized, 없으면 escalate이다 (empty_clean 면제 상태가 존재하지 않으므로 "synthesized에만 게이팅" 단서는 적용 대상이 없다 — review/retro/exploration/compound에만 해당) |
| `compound` | top-level summary(`body.summary`) + `sub_flow_summaries`(machine 집계) + sub_flow_refs(`based_on.sub_flow_refs`) | 세 경우 구분: (a) sub_flow_results 부재/기형 → `escalate, failure_origin=upstream`. (b) sub_flow_results는 *정형 존재*하나 집계할 sub-flow가 합법적으로 0개(예: Decide.sub_flow 분해가 빈 list로 종료 — broken이 아니라 빈-합법) → `result=empty_clean`, empty_details(reason="clean: no sub-flows to aggregate", evidence=정형 sub_flow_results row ref). minimum-bar는 *synthesized만* 게이팅하므로 면제. (c) sub-flow가 ≥1 존재하면 — 모두 abandoned/suspended이어도 그 사실 자체가 합법적 summary → `body.summary`에 명시하고 `synthesized` |

### empty_clean 산출 모양

```yaml
empty_details:                                 # result=empty_clean일 때 필수
  reason                                       # 왜 보고할 내용이 합법적으로 없는가
  evidence:                                    # required. 판별 oneOf 객체 (bare string 아님 — findings[].evidence_ref와 동일 spell). "clean"이 결손이 아니라 사실임을 가리키는 근거
    # { kind: row_ref, row_ref } (ground/investigate row)
    # | { kind: source_manifest, source_manifest } (직접 읽은 file:line)
  suggested_action?: none | reframe_request    # exploration 등 후속 제안 (선택)
```

> **principle 3 한 줄 요약**: 구분 기준은 *upstream 입력이 정형 존재하나 합성할 내용이 0*(=빈-합법, `empty_clean`) 대 *upstream 자체가 부재/기형*(=빈-결손, `escalate`)이다 — report_type 이름이 아니라 입력 상태가 결정한다. **empty_clean 가능 report_type**: review(clean review)·exploration(빈 탐색)·retro(upstream 정형이나 학습 0)·compound(sub_flow_results 정형이나 집계 대상 0) — 넷 다 정형 upstream + 빈 내용이면 `empty_clean`이고, 그 minimum-bar 의무는 `synthesized`에만 게이팅된다. **empty_clean이 절대 없는 report_type**: spike·plan_standalone (verdict/design-or-escalate) — verdict/design이 있으면 synthesized, 없으면(=입력 부재) escalate이므로 빈-합법 중간 상태가 존재하지 않는다. 따라서 schema는 report_type ∈ {spike, plan_standalone}일 때만 result=empty_clean을 금지(synthesized 강제)한다. 어느 경우든 빈-결손(upstream broken)을 빈-합법으로 둔갑시키지 않는다.

## Output

```yaml
report:
  result: synthesized | empty_clean | escalate          # discriminant (P1) — 최상위 oneOf

  # result=synthesized | empty_clean (성공/빈-합법 분기) — report_type required
  report_type: review | retro | exploration | spike | plan_standalone | compound
  body:                                                  # required (result=synthesized | empty_clean). deliverable 본문 slot
    summary                                              # required — 모든 report_type 공통 top-level narrative (synthesized면 비어있지 않음)
    sections?: [{ heading, content }]                    # plan_standalone design document 등 (plan_standalone면 필수)
    next_step?                                           # plan_standalone일 때 필수
  findings:                                              # required array (빈 array 허용). report_type별 minimum 적용
    - id, statement, severity, evidence_ref{kind…}, impact?, verify_probe, source_tool, unverified
  action_items:                                          # required array. floor: retro만 ≥1 (그 외 0 허용)
    - description, priority, owner?, followup_flow_ref?
  feasibility_verdict?:                                  # report_type=spike일 때 필수
    verdict: go | no_go | conditional
    rationale, conditions?, evidence_ref
  task_list?:                                            # report_type=plan_standalone일 때 필수 (R19 machine-consumable; body.sections/next_step와 공존)
    tasks: [{ id, description, target_files, acceptance_test, verify_probe, parallel_marker, … }]
    task_count                                           # cross-checked int (== len(tasks)) — NOT CountClaim (모델-합성 array, 측정 명령 stdout 아님)
  sub_flow_summaries?:                                   # report_type=compound일 때 필수 (machine-consumable; body.summary+based_on.sub_flow_refs와 공존)
    sub_flows: [{ flow_ref, outcome, terminal_result, source_tool, verdict_ref? }]   # source_tool required (R26 provenance floor — Finding.source_tool와 동일)
    sub_flow_count                                       # cross-checked int (== len(sub_flows) == len(based_on.sub_flow_refs)) — NOT CountClaim (모델-조립 array, 측정 명령 stdout 아님)
  based_on: { investigate_ref, decide_ref, ground_ref, sub_flow_refs? }   # 셋 다 required; sub_flow_refs는 compound
  empty_details?: { reason, evidence, suggested_action? }   # result=empty_clean일 때 필수
  declared_next_step                                     # required (R16 — 보통 'verify'. orchestrator가 expected_next_step 주입, chain match는 M2)

  # result=escalate (실패 분기) — report_type/body 등 없이 산출 가능
  escalate_details?: { reason, failure_origin, evidence }   # result=escalate일 때 필수
  based_on?: { investigate_ref?, decide_ref?, ground_ref?, sub_flow_refs? }   # escalate 분기에서 *선택*(partial 허용) — 소비한 upstream row provenance; 어느 key도 required 아님
```

## Step Depth Policy

| Depth | 활동 | Caps |
|---|---|---|
| Shallow | summary (key findings 1-page) | wall_s=30, tokens=5k |
| Deep | full structured report (severity 분류 + action items + 검증 trail) | wall_s=180, tokens=15k |

**Deepen triggers**: flow_type ∈ {Compound, plan-standalone} | Investigate.findings.length ≥ 5 | Decide.mode=Design

**Self-cap exhaustion (닫음: depth cap/budget 소진 분기 부재 — self_failure)**: 어느 depth로 실행하든 Report는 자기 active cap을 소진할 수 있다 — Deepen triggers(Compound, Investigate.findings.length ≥ 5 등)가 발화하면 Deep cap(wall_s=180, tokens=15k), 아무 trigger도 발화하지 않으면 Shallow cap(wall_s=30, tokens=5k)이 활성이다. Report가 *입력 precondition을 모두 만족한 채로*(upstream/investigate/decide/implement 결손 아님) synthesis 도중 자기 *활성 depth cap*(Shallow든 Deep이든)을 초과하면 — synthesized(불완전 deliverable을 sound로 도장 금지), empty_clean(합법적으로 빈 게 아님), 기존 upstream-origin escalate(어느 입력도 결손 아님) 중 어느 것도 정직하게 산출할 수 없다. 이때 Report는 `result=escalate, failure_origin=self`(자기-budget 소진 전용 origin — EscalateDetails enum)를 산출한다: `escalate_details.reason`에 "depth cap exhausted mid-synthesis"(활성 cap 명시 — Shallow/Deep), `evidence`에 소진된 active cap(wall_s/tokens) 명시. orchestrator는 이를 다른 escalate와 동일하게 NEEDS_CONTEXT로 라우팅하며, `(flow_id, step)` **5-누적-fail halt cap**(input-precondition escalate와 동일 cap)이 self-cap escalate의 재진입도 bound 한다(무한 재합성 방지). `failure_origin=self`는 `failure_origin=report`와 다르다 — 후자는 코드 flow에서 Verify가 거부하는 *라우팅 타깃*("Constraint" 절)이고, 전자는 Report가 자기 budget 소진을 *신호*하는 escalate origin이다(Report는 여전히 자신을 라우팅하지 않는다 — boundary).

## Reviewer (report-reviewer)

- `result` discriminant이 명시됐는가 (synthesized | empty_clean | escalate) — 산출 모양이 분기와 일치 (P1)
- findings에 severity(low|med|high|critical 단일 척도) + evidence_ref가 있는가 — severity 미부여/enum 밖 = FAIL (P6)
- action items의 priority가 동일 단일 척도인가 + origin finding/risk severity에서 재투영됐는가 (Report가 새 priority를 *발명*하지 않음 — "priority 생산 규칙"; 무출처면 FAIL)
- `result=synthesized`이면 `body.summary`가 존재+비어있지 않은가 (모든 report_type 공통; 없으면 FAIL — deliverable 본문 미충족)
- report_type별 최소 완료 바 충족 — *필드로 검사*, **`result=synthesized`에만 적용** (이 minimum-bar는 synthesized만 게이팅 — L184 gating note + schema의 synthesized-only allOf; `result=empty_clean`은 *면제*이며 대신 `empty_details`(reason+evidence)를 검사한다. empty_clean 가능 report_type(review·retro·exploration·compound)에서 이 행을 무조건 적용하면 합법적 empty_clean을 FAIL시키므로 금지): review=≥1 finding(각 severity tag; 0-findings는 synthesized 아님 → empty_clean), retro=≥1 action item, spike=feasibility_verdict 존재, plan_standalone=`task_list`(machine) + `body.sections` + `body.next_step` 존재, exploration=`body.summary` 비어있지 않음, compound=`body.summary` + `sub_flow_summaries` + `based_on.sub_flow_refs` 존재. (spike·plan_standalone은 empty_clean 케이스가 없으므로 항상 synthesized로 검사 — L191/L192.)
- 각 finding이 verify_probe(R20) + source_tool(R26) + unverified(R13) 필드를 갖는가 — 누락 시 FAIL
- `declared_next_step`이 orchestrator의 expected_next_step과 일치하는가 (R16 chain match — 불일치 시 FAIL). **result ∈ {synthesized, empty_clean}에만 적용** — `result=escalate`는 `declared_next_step`을 carry하지 않으므로(escalate 분기는 escalate_details[+ 선택적 based_on provenance]만 산출하고 declared_next_step은 없다) R16 chain-match를 적용하지 않는다; orchestrator가 정상 successor가 아니라 NEEDS_CONTEXT 경로로 라우팅한다
- **Spike**: feasibility_verdict.verdict ∈ {go, no_go, conditional} 존재 (없으면 FAIL — terminal artifact 미충족)
- claims이 검증됐는가 (evidence_ref 추적 가능; unverified는 propagate된 채 허용 — Verify가 단일 게이트)
- `result=empty_clean`이 *합법적 빔*인가 *결손 도장*인가 검사 (empty_details.evidence 추적) — principle 3
- `result=escalate`가 request_upstream_deepen을 *발행하지 않았는가* (principle 2) — escalate_details(+ 선택적 based_on provenance)만 산출하고 request_upstream_deepen/report_type/body 등은 산출하지 않았는가
- 비코드 flow terminal artifact 요건 충족

## Boundary

| 항목 | 책임 |
|---|---|
| 사실 캡처 | Ground |
| 해석·findings 생성 | Investigate |
| 결정·옵션·followup_flows *생성* + sequencing/결정 우선순위 | Decide (Report는 action_item priority를 *origin severity 재투영*만 — 새 순서·결정 안 함) |
| 설계 *생성* (design document 내용) | Decide(Design) (Report는 plan_standalone에서 그 산출을 `body.sections`로 *옮길* 뿐) |
| 코드 변경 | Implement (Report은 비코드) |
| Flow-level 목표 검증 + failure 라우팅 | Verify (Report는 escalate를 *신호*만, 라우팅 안 함 — principle/boundary) |
| 후속 flow 큐잉 | Orchestrator (Report는 followup_flow_ref를 *참조*만) |
| upstream artifact 게이팅 (proceed/blocked) | Investigate (Report는 게이트 아님 — boundary) |

## Constraint — 코드 flow에서의 Report

코드 flow (Feature/Bug Fix/Refactor/Performance/Migration/Test/Chore/Release)에서는 *Report 단계 없음*. `failure_origin=report`도 코드 flow에선 invalid (Verify가 거부 — failure-routing.md). 코드 flow의 flow_type으로 Report가 호출되면 → 입력 precondition 위반 → `result=escalate, failure_origin=upstream` (report_type 추측 금지 — "report_type assignment rule").
