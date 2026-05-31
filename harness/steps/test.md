# Test — Behavior Tests + Run Polarity Report

## Definition

> **Test는 Spec의 AC(또는 Spec-less chain에서 Decide의 결정)를 검증하는 행위 테스트를 *작성·실행*하고, 각 테스트의 *실행 극성(run polarity)* 을 보고한다.** Bug Fix flow에서는 reproduce. Performance flow에서는 profile/measure. Migration flow에서는 validate. Refactor/Test flow에서는 coverage 추가.

Test ⇄ Implement는 RED-GREEN-REFACTOR 루프 (Test가 작성, Implement가 GREEN으로). **중요**: 새로 작성한 행위 테스트가 *통상* RED로 시작하지만 항상 그렇지는 않다 — AC가 이미 충족됐거나, bug가 재현되지 않거나, 기존 GREEN 코드 위 coverage이거나, P0 retroactive(merge 후) 테스트는 처음부터 GREEN일 수 있다. 이는 *정상 발생*이며 Test의 산출 계약은 RED와 비-RED를 모두 1급으로 표현한다 (P1: success branch — `status: RED` 하드코딩 폐지).

**Test는 *극성을 보고*할 뿐, "목표 달성 여부"를 판정하지 않는다** (그건 Verify의 일 — STAY IN LANE). `unexpected_green`은 Verify에게 **신호**일 뿐, Test가 "할 일 없음/성공"이라고 스스로 결론짓지 않는다.

## Inputs

**Required (정확히 하나)** — flow-conditional:
- **Spec 출력** (`acceptance_criteria`, `tasks`, `code_architecture`) — flow에 Spec 단계 있을 시
- **또는 Decide 출력** — Spec 없는 chain (Bug Fix reproduce, Bug Fix Unreproducible hypothesis, Migration validate, Test flow의 Decide(Plan) 등). Decide의 실제 schema에서 읽는다 (decide/README.md):
  - mode=record → `decision`, `rationale`
  - mode=plan → `options_considered`, `chosen: {option_id, rationale}`, `sequencing?`
  - mode=design → `chosen_architecture`, `requirements`, `policies`
  - (P3/P8: 이전 계약이 input으로 명명했던 `option_selection`/`decision_record`는 Decide schema에 **존재하지 않는 필드**였다 — 위 실재 필드로 교정. Decide-driven Test는 *결정에 내재된 검증 가능 행위*(요구사항/선택된 접근/재현 가설)로부터 테스트를 도출한다.)

**Optional enrichment**:
- `Investigate.risk_surface` (edge case 우선순위; 단일 severity 척도 low|med|high|critical)
- `Ground.volatile_state` (현재 통과/실패 baseline)

**Input contract rule**: minimum=1 of (Spec | Decide). reviewer는 flow chain 명시 따라 검증. **Input precondition은 아래 "Input preconditions" 절에서 기계적으로 assert** (P8).

## Input preconditions (P8: garbage-in 방어 / principle 3: 결손 vs 정당-빔 구분)

Test는 자기 일을 시작하기 전에 *필수 upstream 입력이 존재하고 정형(well-formed)인지* 기계적으로 단언한다 (진실성 검증이 아니라 — 그건 Verify의 일 — shape·존재 검사). Ground의 active_flow_state mechanical-error 패턴을 일반화한 것이다.

- **둘 다 부재** (Spec 출력도 Decide 출력도 없음) → mechanical error → **escalate** (`failure_origin=spec` if Spec를 기대한 chain, 아니면 `failure_origin=decide`). request_upstream_deepen은 쓰지 않는다 (principle 2: Decide 전용 신호).
- **Spec 출력은 있으나 `acceptance_criteria` 키 자체가 missing/malformed** (list가 아님) → mechanical error → **escalate** (`failure_origin=spec`). 이것은 "빈 AC"(아래 no_op 후보)와 *구별*된다 (principle 3): malformed=결손=escalate, `acceptance_criteria: []`=정당하게-빔 가능성→아래 no_op 평가.
- **Decide 출력은 있으나 mode에 맞는 핵심 필드가 missing** (예: mode=plan인데 `chosen` 없음) → mechanical error → **escalate** (`failure_origin=decide`).
- **escalate ping-pong 안전**: 이 precondition escalation은 (flow_id, step) **5-누적-fail halt cap** (decide/failure-routing.md)으로 bounded되므로 무한 loop 불가.

precondition 통과 후에만 Activities로 진입한다.

## Activities

1. **행위 test 작성** — AC(또는 Decide 결정에서 도출한 검증 가능 행위) 별 행위 test. 통상 RED 의도.
2. **Reproduce** (Bug Fix) — bug 재현 test. 재현 안 되면(이미 fix됨 등) `unexpected_green`으로 보고 (아래 Result enum).
3. **Coverage 추가** (Refactor, Test flow) — 기존 미커버 영역. 기존 GREEN 코드 위의 coverage test는 처음부터 GREEN일 수 있다 (`unexpected_green` 정상).
4. **Profile/Measure** (Performance) — baseline + target metric.
5. **Validate** (Migration) — migration script dry-run.
6. **각 작성 test를 실행하여 run polarity 도출** — 아래 production rule에 따라 `RED | unexpected_green` 판정. (RED 의도였으나 실제 통과 = `unexpected_green`.)

## Run polarity derivation rule (P1: success branch — run-polarity 도출)

각 작성된 test는 *실제 실행 결과*로부터 polarity를 도출한다 (LLM 자기단언이 아니라 실행). per-test `status`:

- test 실행 시 **fail** → `status: RED` (의도대로 실패; Implement가 GREEN으로 만들 대상).
- test 실행 시 **pass** → `status: unexpected_green` (RED 의도였으나 통과). 정상 발생 사유: (a) AC가 이미 충족됨, (b) reproduce가 bug를 재현 못 함(이미 fix됨), (c) 기존 GREEN 코드 위 coverage test, (d) **Bug Fix P0 retroactive** — Implement(emergency)+Verify PASS *후* 별도 follow-up flow로 실행되므로 코드가 이미 merge·GREEN인 상태에서 작성·실행됨 → retroactive test는 **본질적으로 GREEN이 정상 산출**이며 escalate가 아니다.

`unexpected_green`은 **Verify에게 신호**일 뿐이다 (Test는 목표 달성을 판정하지 않음 — STAY IN LANE). Test⇄Implement 루프는 `unexpected_green` test를 "turn green할 대상"으로 큐잉하지 않는다 (이미 green).

## Result enum & branches (P1: 전체 result enum — success 분기 포함)

Investigate의 `compatibility_verdict`(proceed|blocked|… 5-state + 라우팅 테이블)와 *동일한 형태*로, Test도 실패 분기만이 아니라 **success 분기를 포함한 전체 result enum**을 선언한다. 새 메커니즘 발명 없음 — Investigate 패턴 백포트.

`test_result.result` enum:

**도출 대상 명시 (P-residual: result는 tests_added 만이 아니라 *해당 flow의 primary 산출 블록*에서 도출)** — flow category마다 primary 산출이 다르다: 행위 test flow는 `tests_added`, coverage flow(Refactor/Test)는 `coverage_added`, Performance flow는 `profile`, Migration flow는 `migration_validation`. result는 **그 flow가 실제로 채운 primary 블록**에서 도출한다 (tests_added 단독 도출 아님). `tests_added`와 `coverage_added`는 둘 다 per-test `status: RED | unexpected_green`를 carry하므로 **동일 규칙으로 합산**한다 (둘 중 어디에 있든 하나라도 `status: RED`면 `red`; 채워진 test/coverage 항목이 전부 `unexpected_green`이면 `unexpected_green`). Performance/Migration은 RED/GREEN 행위 test를 산출하지 않으므로 별도 `measured` 분기로 도출한다 (아래).

| result | 의미 | Orchestrator 라우팅 |
|---|---|---|
| `red` | `tests_added` **또는** `coverage_added`에 1개 이상 작성·실행, 적어도 하나 `status: RED` | **정상 — Test⇄Implement 루프 진입** (Implement가 RED를 GREEN으로). RED인 test들이 turn-green 대상. |
| `unexpected_green` | `tests_added`/`coverage_added`에 test 작성·실행했으나 채워진 항목이 **전부** `status: unexpected_green` (작성된 RED 의도 test가 하나도 실패하지 않음) | **정상 발생** — Implement에 turn-green 대상 없음. **Verify에게 신호** (failure 아님, escalate 아님). orchestrator는 Test⇄Implement 루프를 skip하고 Verify로 진행. Verify가 "목표가 실제 충족됐는가/재현 불가가 맞는가"를 판정. P0 retroactive에서 이 분기가 *기대값*. |
| `measured` | **Performance/Migration**: primary 산출이 RED/GREEN 행위 test가 아니라 *측정·검증*이다. `profile` 가 성공 측정(`tool_status: measured`)됐거나 `migration_validation.dry_run_result: pass` 일 때. | **정상 발생** — Implement에 turn-green 대상 없음(행위 test 아님). **Verify에게 신호** — Verify가 "측정값이 target을 충족하는가 / migration이 valid한가"를 판정 (목표 달성 판정은 Verify의 일 — STAY IN LANE). orchestrator는 Test⇄Implement 루프 skip하고 Verify로 진행. |
| `no_op` | **작성·측정할 산출이 정당하게 0개** (아래 "빈 AC"·"Decide-driven 0-도출" 정당-빔 케이스). escalate가 아니라 verdict. | `no_op_details` 동반. orchestrator는 Reflect 실행 (abandonment 분류). |

(`red`와 `unexpected_green`이 섞인 경우 = 적어도 하나 RED → `result: red` (Implement가 그 RED들을 처리). `unexpected_green` test들은 산출에 그대로 보고되어 Verify가 본다. 한 flow가 행위 test(tests_added/coverage_added)와 measurement(profile/migration)를 *둘 다* 산출하는 일은 통상 없으나, 섞이면 행위 test의 RED 우선 — 적어도 하나 RED면 `red`, 아니면 `measured`.)

**Migration dry-run 실패는 result로 도출되지 않고 escalate** (P-residual / principle 3: Test 자기 in-scope 실패 = mechanical error → escalate, 고무도장 verdict 금지): `migration_validation.dry_run_result: fail | error` 는 *측정 성공*이 아니라 **migration script 자체가 깨진 Test의 in-scope 실패**다. → `result`에 매핑하지 않고 **escalate** (`failure_origin=test`), `dry_run_detail`에 진단. `measured`는 `dry_run_result: pass`일 때만. (`fail|error`를 `measured`로 고무도장하지 않는다 — "측정이 됐다"와 "검증이 통과했다"는 다르다; 후자만 Verify로 넘긴다.)

**provenance / 산출 source** — `based_on`은 입력계약(min-1-of Spec|Decide)에 **맞춰 조건부 선언** (P3: based_on 조건부; 한 모양 하드코딩 폐지):
- Spec-driven chain → `based_on: { spec_ref }`
- Decide-driven (Spec-less) chain → `based_on: { decide_ref }`
- (정확히 하나가 존재. Input precondition이 둘 다 부재면 이미 escalate했으므로 `based_on`은 항상 채워진다.)

## Output

```yaml
test_result:
  result: red | unexpected_green | measured | no_op   # P1+P-residual: 전체 enum (행위-test success + measurement success 분기 포함), status:RED 하드코딩 폐지
  schema_version: 1

  tests_added:                                   # 행위-test flow에서 result ∈ {red, unexpected_green}일 때 비어있지 않음
    - file_path
      test_name
      ac_ref?                                    # Spec-driven: 대응 AC id; Decide-driven: 도출 근거 ref
      status: RED | unexpected_green             # per-test run polarity (실행에서 도출)
      unexpected_green_reason?:                   # status=unexpected_green일 때 필수
        already_satisfied | not_reproducible | coverage_over_existing | p0_retroactive

  reproduction?:                                 # Bug Fix
    test_path
    bug_ref
    reproduced: true | false                     # false = bug 재현 안 됨 → 대응 test status=unexpected_green(not_reproducible)

  coverage_added?:                               # Activity 3 (Refactor, Test flow) — coverage 산출 home (이전엔 부재)
    - file_path                                  # coverage-only flow의 primary 산출: tests_added와 동일하게 result 도출에 참여 (no_op 아님)
      area                                       # 커버된 영역
      status: RED | unexpected_green             # 기존 GREEN 코드 위면 unexpected_green(coverage_over_existing) 정상

  profile?:                                       # Performance — primary 산출; tool_status:measured면 result=measured 도출 (행위 test 아님)
    metric                                       # 무엇을 측정 (예: p95_latency_ms, peak_rss_mb)
    unit                                         # 측정 단위 (ms, MB, ops/s 등) — 필수
    baseline:                                    # 현재 측정값
      value
      measurement_method                         # 어떻게 측정 (도구/명령)
    target:                                      # 목표값 (Triage/Spec 의도)
      value
      comparator: lte | gte | lt | gt | eq       # baseline→target 방향
    tool_status: measured | omitted              # M3 degrade 분기 (아래 tool-absence 참조)

  migration_validation?:                          # Migration — primary 산출
    script_path
    dry_run_result: pass | fail | error          # pass → result=measured 도출; fail|error → escalate(failure_origin=test) (result로 매핑 안 함)
    dry_run_detail?                              # error/fail 시 진단 텍스트 (escalate에 동반)
    tool_status: measured | omitted              # M3 degrade 분기

  no_op_details?:                                 # result=no_op일 때 필수 (Investigate no_op_details 형태 재사용)
    reason                                       # 왜 작성할 test가 정당하게 0인가
    evidence                                     # upstream fact ref (정당-빔 근거)
    suggested_action: abandon | reframe_request

  based_on: { spec_ref } | { decide_ref }         # P3: 입력계약 조건부 (정확히 하나)
```

> `?` 표기는 "optional (flow-conditional)" 의미 (프로젝트 schema 규약). result=red|unexpected_green이면 해당 flow의 primary 행위-test 블록(`tests_added` 또는 coverage flow의 `coverage_added`)이 비어있지 않다; result=measured이면 `profile`(Performance) 또는 `migration_validation`(Migration, `dry_run_result: pass`) 중 하나가 채워져 있다; result=no_op이면 산출 블록 생략·`no_op_details` 필수.

## Failure & degrade handling

**자기 주요 실패모드 — "RED가 안 나옴"** (P1 / principle 3): 이전 계약의 치명 홀. 작성한 test가 실패하지 않는 것은 *실패가 아니라 정상 결과*다. → `status: unexpected_green` + `result: unexpected_green` (또는 RED와 섞이면 `result: red`)로 **1급 표현**. escalate하지 않는다. Verify가 의미를 판정한다.

**빈/degenerate 입력** (P7 / principle 3: 정당-빔 vs 결손 구분) — Spec-driven과 Decide-driven 둘 다 0-도출 정당-빔 trigger를 enumerate한다 (P-residual: 이전엔 Spec-driven `acceptance_criteria: []`만 다뤘다):
- **Spec-driven** — `acceptance_criteria: []` (well-formed empty list) — **두 케이스 구분**:
  - *정당하게 빔* (upstream이 의도적으로 0 AC — 예: Investigate가 이미 no-op 가능성을 surface했으나 flow가 여기까지 옴): `result: no_op` + `no_op_details` (verdict). escalate 아님.
  - 단, 빈 AC가 *결손/기형*(`acceptance_criteria` 키가 malformed/missing)이면 → **Input precondition**에서 이미 escalate (`failure_origin=spec`). 절대 no_op로 고무도장 하지 않는다.
- **Decide-driven** — Decide 출력이 *well-formed*(precondition 통과: mode별 핵심 필드 존재)이면서도 *검증 가능 행위가 정당하게 0개 도출*되는 경우 (예: mode=record `decision`이 순수 비-코드 결정이라 도출할 행위 test가 없음 — 통상 non-code flow): `result: no_op` + `no_op_details` (verdict). escalate 아님.
  - 단, Decide 출력이 *결손/기형*(mode별 핵심 필드 missing)이면 → **Input precondition**에서 이미 escalate (`failure_origin=decide`). 절대 no_op로 고무도장 하지 않는다 (정당-빔=0-도출 verdict vs 결손=escalate 구분; principle 3).
- (참고: Test flow의 "coverage 이미 충족" no-op은 통상 Investigate Validity 테이블 + Decide halt에서 *상류 차단*되나, 여기 도달한 경우의 안전망으로 `no_op` verdict를 둔다.)

**도구 부재 / 환경 처리** (P2 / principle 1: tool-role 라우팅):
Test의 *주요* 산출은 행위 test 작성·실행이다. Profile/Measure(Activity 4)와 Migration dry-run(Activity 5)에 쓰이는 도구의 역할에 따라 라우팅:
- **테스트 러너(test runner) 부재/error** — 작성한 test를 *실행*해 polarity를 도출하는 것은 Test의 **주요 능력**이다. runner 부재면 Test는 자기 일을 못 한다 → mechanical error → **escalate** (`failure_origin=test`) (principle 1: primary tool → escalate). 절대 polarity를 추측·자기단언하지 않는다.
- **Profiler / Migration dry-run runner 부재** — 이들은 *해당 flow에 한정된* 측정·검증 도구다. 부재 시 해당 sub-output을 `tool_status: omitted`로 degrade-분기 표기 (M3 Measured|Omitted, R12 failure_modes 재사용)하고, omit 사유를 남긴 채 *행위 test 부분은 정상 진행*. 단, 그 flow의 *유일한* 산출이 그 도구에 전적으로 의존하면(예: Migration flow에서 dry-run runner가 죽음 = Test의 그 invocation에서 할 일이 없음) → mechanical error → **escalate** (`failure_origin=test`). enhancement-degrade는 *행위 test가 따로 존재할 때만* 적용.

**Caps mid-activity hit** (P1/P8 — 부분 산출·halt 규칙; Verify RETRY_EXHAUSTED→halt 일반화):
- Step Depth Policy caps(wall_s/tokens)가 모든 AC에 test를 붙이기 전에 소진되면: 지금까지 작성·실행한 test로 `tests_added`를 채우고, **남은 AC 목록**을 진단에 남긴 채 → mechanical error → **escalate** (`failure_origin=cap_exceeded`). silent partial proceed 금지 (DONE_WITH_CONCERNS 폐지된 것과 동일 원칙). orchestrator가 (flow_id, step) 5-누적-fail halt cap으로 bound.
- request_upstream_deepen은 쓰지 않는다 (principle 2: Decide 전용).

## Step Depth Policy

| Depth | 활동 | Caps |
|---|---|---|
| Shallow | targeted (단일 RED test) | wall_s=60, tokens=10k |
| Deep | full coverage (multi-test + edge cases + profile) | wall_s=600, tokens=40k |

**Deepen triggers**: flow_type ∈ {Feature, Performance, Migration, Compound} | Spec.acceptance_criteria.length ≥ 5 | Investigate.risk_surface contains severity ∈ {high, critical}

(severity는 Investigate.risk_surface의 단일 척도 low|med|high|critical를 그대로 사용 — 두 번째 척도 발명 없음.)

## Reviewer (test-reviewer)

- 테스트가 행위를 검증하는가 (smoke test 아닌가)
- AC traceability (Spec-driven: 모든 AC에 대응 test; Decide-driven: 결정의 검증 가능 행위에 대응 test)
- 엣지 케이스 커버리지 (Investigate.risk_surface 우선순위 반영)
- **run polarity 정합** — `status`가 *실행 결과*에서 도출됐는가 (`unexpected_green`이면 `unexpected_green_reason` 존재; RED 의도였다 추측만 한 게 아닌가)
- **result enum 정합** — result는 *해당 flow의 primary 산출 블록*에서 도출됐는가 (tests_added 단독 아님): `tests_added`/`coverage_added`에 적어도 하나 RED면 `result=red`; 채워진 행위-test/coverage 항목이 전부 unexpected_green이면 `result=unexpected_green`; Performance `profile` measured 또는 Migration `dry_run_result:pass`면 `result=measured`; 작성·측정할 산출이 정당하게 0개면 `result=no_op`+`no_op_details`. **coverage_added만 있고 tests_added 빈 flow를 `no_op`로 오분류하지 않았는가** (coverage 항목이 result 도출에 참여).
- **based_on 정합** — Spec-driven이면 `spec_ref`, Decide-driven이면 `decide_ref` (P3)
- Bug Fix: reproduction test가 실제 bug 재현 (재현 안 되면 `reproduced:false`+`unexpected_green` 정직 보고)
- Performance: `profile.metric`+`unit`+`baseline.measurement_method`로 *측정 가능*; measured면 `result=measured`
- Migration: `dry_run_result` enum 정합; `pass`면 `result=measured`, `fail|error`면 result로 매핑하지 않고 escalate(`failure_origin=test`)됐는가 (verdict 고무도장 아님)

## Boundary

| 항목 | 책임 |
|---|---|
| AC 정의 | Spec |
| 결정 / 옵션 선택 | Decide |
| 코드 작성 (test 외) | Implement |
| **결과 의미 판단 / 목표 달성 판정** (`unexpected_green`이 "성공"인지) | **Verify** |
| follow-up flow 큐잉 (예: P0 retroactive) | Orchestrator (Verify 신호 기반) |
| 학습 추출 | Reflect |

**STAY IN LANE 명시**: Test는 test를 *작성·실행*하고 *run polarity를 보고*한다. `unexpected_green`을 "goal met"으로 결론짓지 않으며 (Verify), follow-up flow를 스스로 만들지 않으며 (orchestrator), upstream 결손은 *failure_origin escalate*로만 라우팅한다 (request_upstream_deepen 안 씀 — Decide 전용, principle 2).
