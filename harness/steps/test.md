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
7. **firebat scan** (agents/test.md L22) — test 코드 작성 후 firebat scan 실행, `firebat_scan`에 findings 수(R23 CountClaim) 기록. test 코드를 작성한 flow(primary 행위-test 블록 비어있지 않음)에서는 scan이 **의무**이므로 `firebat_scan`은 **조건부 필수**다 (schema root allOf) — 부재/실패/timeout이어도 *field를 생략하는 게 아니라* `firebat_scan.status: omitted` 분기로 surface한다 (M3 Measured|Omitted, R22 first-class absence). 이 의무는 **escalate-부재에 guard되지 않는다**: `cap_exceeded` escalate 경로도 caps가 터지기 전 **partial `tests_added`(실측 실행된 실제 test 코드)** 를 작성하므로 그 경로에서도 scan이 필수다 (실제 test 코드를 작성·실행한 flow가 scan을 건너뛰는 것은 Activity 7 의무 위반이므로 면제하지 않는다). precondition/runner-부재 escalate와 measured/no_op는 test 코드를 작성하지 않으므로 trip되지 않는다. firebat은 MCP-backed degradable. scan 결과는 degrade로 표기될 뿐 행위 test 진행을 막지 않는다.

## Run polarity derivation rule (P1: success branch — run-polarity 도출)

각 작성된 test는 *실제 실행 결과*로부터 polarity를 도출한다 (LLM 자기단언이 아니라 실행). 그 실행 증거는 per-test `red_confirmation` (M3 Measured|Omitted)에 carry되며 **`tests_added`·`coverage_added` 두 primary 블록의 모든 항목에 필수**다 (둘 다 status가 항상 RED|unexpected_green이므로 생략 불가; coverage_added도 result 도출에 1급 참여하는 primary 블록이라 동일 floor를 carry) — M2가 그 `command`/`raw_stdout_sha256`를 anchor로 재실행·re-hash하여 polarity를 재도출하고, `red_confirmed_count`의 RED-count denominator(아래 L165)는 *두 블록 모두*의 이 per-item anchor에서 RED 항목을 재도출한다. 실행 불가면 `red_confirmation.status: omitted` 분기로 surface(field 생략 금지). per-test `status`:

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
| `measured` | **Performance/Migration**: primary 산출이 RED/GREEN 행위 test가 아니라 *측정·검증*이다. `profile.baseline.status: measured`로 성공 측정됐거나 `migration_validation.dry_run_result.value.outcome: ok` 일 때. (`result=measured ⇒ profile.baseline.status=measured`는 M2 x-validator-contract — baseline이 omitted면 measured로 갈 수 없다; 아래 degrade 절 라우팅.) | **정상 발생** — Implement에 turn-green 대상 없음(행위 test 아님). **Verify에게 신호** — Verify가 "측정값이 target을 충족하는가 / migration이 valid한가"를 판정 (목표 달성 판정은 Verify의 일 — STAY IN LANE). orchestrator는 Test⇄Implement 루프 skip하고 Verify로 진행. |
| `no_op` | **작성·측정할 산출이 정당하게 0개** (아래 "빈 AC"·"Decide-driven 0-도출" 정당-빔 케이스). escalate가 아니라 verdict. | `no_op_details` 동반. orchestrator는 Reflect 실행 (abandonment 분류). |

(`red`와 `unexpected_green`이 섞인 경우 = 적어도 하나 RED → `result: red` (Implement가 그 RED들을 처리). `unexpected_green` test들은 산출에 그대로 보고되어 Verify가 본다. 한 flow가 행위 test(tests_added/coverage_added)와 measurement(profile/migration)를 *둘 다* 산출하는 일은 통상 없으나, 섞이면 **행위 test 존재가 measured를 outrank**하는 3-way로 도출한다: (1) `tests_added`/`coverage_added`에 **하나라도** `status: RED` ⇒ `red`; (2) else 행위-test/coverage 항목이 **하나라도 존재**(전부 `unexpected_green`) ⇒ `unexpected_green` (Verify-신호를 버리지 않는다 — `else measured` 폴백이 unexpected_green 신호를 삼키지 않도록); (3) else (행위-test/coverage 0개, profile/migration만) ⇒ `measured`. 즉 행위-test 존재는 measured보다 우선하며, 채워진 행위 test가 전부 unexpected_green이어도 result는 `measured`가 아니라 `unexpected_green`이다.)

(escalate는 result enum 값이 *아니다* — in-scope 실패(precondition, runner 부재, migration dry_run failed|partial, caps)는 별도 `escalate` 블록(`failure_origin` ∈ {spec, decide, test, cap_exceeded})으로 라우팅하며 성공 result 분기와 배타적이다.)

**Migration dry-run 실패는 result로 도출되지 않고 escalate** (P-residual / principle 3: Test 자기 in-scope 실패 = mechanical error → escalate, 고무도장 verdict 금지): `migration_validation.dry_run_result.value.outcome: failed | partial` 는 *측정 성공*이 아니라 **migration script 자체가 깨진 Test의 in-scope 실패**다. → `result`에 매핑하지 않고 **escalate** (`failure_origin=test`). **진단 위치 (hole 해소)**: failed|partial 경로에서 step은 *둘 다* 산출한다 — (1) `migration_validation.dry_run_result.value`에 `outcome: failed|partial` + `dry_run_detail`(진단 텍스트가 사는 곳), 그리고 (2) `escalate(failure_origin=test)`. 진단(`dry_run_detail`)은 measured 블록 안에 살고 escalate가 그것을 동반한다. 이것은 **escalate-배타성의 유일하게 허용된 co-occurrence**다 (measured-but-failed 블록): escalate가 있을 때 success result 분기·primary-block 의무는 suppressed되지만, 이 *진단을 담은* migration_validation 블록의 동반은 금지되지 않으며 오히려 요구된다. **이 "둘 다" 동반 의무는 grammar가 강제하지 않는다** (grammar는 escalate(failure_origin=test)에 migration_validation 블록을 require하지 못한다 — `failure_origin=test`는 migration 외에 runner-부재 등 다른 in-scope 실패도 carry하므로 root allOf로 migration_validation을 묶을 수 없다). 동반은 **오직 named M2 dry_run_result x-validator-contract**(아래 schema `dry_run_result` annotation: `outcome ∈ {failed,partial} ⇒ escalate(failure_origin=test) + dry_run_detail 존재`)로만 강제되며, 그 contract가 진단 carrier(`dry_run_detail`의 집)인 migration_validation 블록의 존재를 보장한다 — grammar가 강제한다고 가장하지 않는다. `measured`는 `outcome: ok`일 때만 (그 경우 escalate 없음). (`failed|partial`을 `measured`로 고무도장하지 않는다 — "측정이 됐다"와 "검증이 통과했다"는 다르다; 후자만 Verify로 넘긴다. dry-run 도구 자체가 부재/실패/timeout이면 `dry_run_result.status: omitted` degrade-분기 — M3 Measured|Omitted.)

**provenance / 산출 source** — `based_on`은 입력계약(min-1-of Spec|Decide)에 **맞춰 조건부 선언** (P3: based_on 조건부; 한 모양 하드코딩 폐지):
- Spec-driven chain → `based_on: { spec_ref }`
- Decide-driven (Spec-less) chain → `based_on: { decide_ref }`
- (정확히 하나가 존재. Input precondition이 둘 다 부재면 이미 escalate했으므로 `based_on`은 항상 채워진다.)

## Output

```yaml
result: red | unexpected_green | measured | no_op   # P1+P-residual: 전체 result enum (top-level; 행위-test success + measurement success 분기 포함), status:RED 하드코딩 폐지. in-scope 실패는 result 값이 아니라 별도 escalate 분기로 라우팅. **escalate가 존재하면 result는 생략된다** (escalate와 성공 result 분기는 배타적 — grammar: escalate 부재일 때만 result required, escalate 존재 시 primary-block 의무도 suppressed).

input:                                            # P3: 입력계약 exactly-one-of (grammar-enforced via input_kind discriminant)
  input_kind: spec | decide                       # 어느 단일 입력이 Test를 구동했는가
  spec_ref | decide_ref                           # input_kind에 맞는 RowRef (spec→spec_ref, decide→decide_ref)

tests_added:                                       # 행위-test flow에서 result ∈ {red, unexpected_green}일 때 비어있지 않음
  - file_path
    test_name
    ac_ref?                                        # optional. Spec-driven: 대응 AC id; Decide-driven: 도출 근거 ref. unexpected_green/no_op은 AC id 없을 수 있음
    bug_ref?                                        # optional JOIN KEY (Bug Fix reproduce test). 짝 reproduction.bug_ref와 동일 RowRef — reproduction↔tests_added 짝을 이 키로 join (M2). reproduce test 아니면 부재
    status: RED | unexpected_green                 # per-test run polarity (실행에서 도출)
    unexpected_green_reason?:                       # status=unexpected_green일 때 필수
      already_satisfied | not_reproducible | coverage_over_existing | p0_retroactive
    red_confirmation                                # **필수** (per-item if/then: status∈{RED,unexpected_green} ⇒ 필수, 즉 항상). M3 Measured|Omitted — 실제 실행 증거이자 M2가 재실행·re-hash할 per-test anchor. value.failed: true=RED, false=unexpected_green; value.command; value.raw_stdout_sha256 (**필수** — R23/M2 re-hash provenance — runner stdout sha256, M2가 anchor로 re-hash 후 polarity 재도출; CountClaim과 동일하게 required라 self-assertion floor가 무너지지 않는다). 실행 불가 시 *field 생략이 아니라* omitted 분기로 surface (R22). status가 실행에서 도출된다는 계약이 self-assertion으로 무너지지 않도록 증거 carrier를 강제한다.
    source_tool                                     # R26 provenance floor (필수) — RED 증거 생성 runner (예: 'bun', 'firebat'). 이 item-level source_tool은 `red_confirmation`의 Measured 분기가 상속한 source_tool과 **동일 runner**여야 한다 — 둘은 같은 실행을 가리킨다 (M2 contract: red_confirmation.status=measured면 tests_added[].source_tool == red_confirmation.source_tool; item에 'bun', red_confirmation에 'firebat'처럼 갈리면 reject). status=omitted면 cross-check할 measured source_tool이 없다 (item floor만 적용).
    unverified                                      # R13 KEEP-polarity floor (필수) — Verify로 전파될 미검증 주장 플래그

reproduction?:                                     # Bug Fix — *metadata*, primary 결과 블록 아님 (result 도출에 참여 안 함)
  test_path
  bug_ref
  reproduced: true | false                         # false = bug 재현 안 됨 → 대응 test status=unexpected_green(not_reproducible)
  # 모든 reproduction(true·false)은 항상 *짝지어진 tests_added 항목*(reproduce test)으로 carry되며 result는 그 tests_added 항목의 status에서 도출된다 — reproduction은 메타데이터일 뿐. **짝은 `bug_ref`로 join**: 짝 tests_added 항목은 그 `bug_ref`가 이 reproduction의 `bug_ref`와 동일한 항목이다 (여러 bug/reproduction이면 validator가 reproduction.bug_ref ⇔ tests_added[].bug_ref로 매칭 — join key 제공). reproduced:true→짝 tests_added.status=RED, reproduced:false→짝 tests_added.status=unexpected_green(not_reproducible). 이 reproduction↔tests_added 짝 의무·join은 M2 validator_contract (grammar 미강제).
  # **reproduction 부재 의무 (hole 해소)**: reproduction은 *반드시* 짝 tests_added 항목과 join되어야 하므로, tests_added가 빈/부재인 경로에는 reproduction이 올 수 없다. → `result=no_op`(작성 0개)·`result=measured`(Performance/Migration, 행위 test 아님)·escalate-only(test 코드 없음) 경로에서는 reproduction이 **부재여야** 한다 (join할 짝이 없음). M2 pairing contract는 join 가능한 tests_added[].bug_ref가 없는 reproduction을 reject한다.

coverage_added?:                                   # Activity 3 (Refactor, Test flow) — coverage 산출 home (이전엔 부재)
  - file_path                                      # coverage-only flow의 primary 산출: tests_added와 동일하게 result 도출에 참여 (no_op 아님)
    area                                           # 커버된 영역
    status: RED | unexpected_green                 # 기존 GREEN 코드 위면 unexpected_green(coverage_over_existing) 정상
    unexpected_green_reason?:                       # status=unexpected_green일 때 필수
      already_satisfied | coverage_over_existing    # coverage flow(Refactor/Test) reachable 사유만. not_reproducible/p0_retroactive는 Bug-Fix 전용이라 coverage에 안 옴
    red_confirmation                                # **필수** (tests_added와 동일 M3 Measured|Omitted) — coverage_added는 1급 primary result-도출 블록이므로 per-item 실행 증거 carrier가 동일하게 필수다 (status가 항상 RED|unexpected_green이라 생략 불가). value.failed: true=RED, false=unexpected_green; value.command; value.raw_stdout_sha256 (**필수** — M2 re-hash provenance이자 red_confirmed_count RED-count denominator가 coverage_added portion을 재도출하는 anchor). 실행 불가 시 omitted 분기로 surface (R22)
    source_tool                                     # R26 provenance floor (필수) — tests_added와 동일. coverage_added는 1급 primary 블록이므로 동일 floor를 carry
    unverified                                      # R13 KEEP-polarity floor (필수) — tests_added와 동일. Verify로 전파될 미검증 주장 플래그

profile?:                                          # Performance — primary 산출; baseline measured면 result=measured 도출 (행위 test 아님)
  metric                                           # 무엇을 측정 (예: p95_latency_ms, peak_rss_mb)
  unit                                             # 측정 단위 (ms, MB, ops/s 등) — 필수
  baseline:                                        # M3 Measured|Omitted union (R22/R23). measured면 value=CountClaim (측정 number + command/raw_stdout); omitted면 perf 도구 부재/실패/timeout
    status: measured | omitted
    value?                                         # measured일 때 CountClaim
  target:                                          # 목표값 — R20 VerifyProbe (command + expected_result), 측정 아님
    command
    expected_result
  comparator: lte | gte | lt | gt | eq             # baseline→target 방향 (필수)

migration_validation?:                             # Migration — primary 산출
  script_path
  dry_run_result:                                  # M3 Measured|Omitted union. measured면 value.outcome 산출; omitted면 dry-run 도구 부재/실패/timeout
    status: measured | omitted
    value?:                                        # measured일 때
      outcome: ok | failed | partial               # ok → result=measured 도출; failed|partial → escalate(failure_origin=test) (result로 매핑 안 함)
      command
      raw_stdout_sha256                            # **필수** R23/M2 re-hash provenance — dry-run stdout sha256 (M2가 anchor로 re-hash 후 outcome 재도출; measured 분기의 outcome이 항상 hash anchor를 가지도록 required)
      reversible?                                  # dry-run이 rollback-safety(가역성) 확인했는가 — boolean
      dry_run_detail?                              # failed|partial 시 진단 텍스트 (escalate에 동반)

no_op_details?:                                    # result=no_op일 때 필수 (Investigate no_op_details 형태 재사용)
  reason                                           # 왜 작성할 test가 정당하게 0인가
  evidence                                         # upstream fact ref (정당-빔 근거)
  suggested_action: abandon | reframe_request

escalate?:                                         # in-scope 실패 (mechanical error) 캐리어 — result 성공 분기 대신 산출
  failure_origin: spec | decide | test | cap_exceeded   # 공유 _defs FailureOrigin 중 Test-reachable subset
  reason
  evidence?                                        # ref 또는 file:line
  remaining_targets?                               # failure_origin=cap_exceeded 전용 — caps로 못 붙인 남은 AC/target 목록 (partial tests_added와 동반). 다른 origin엔 부재

tests_written_count                                # 필수, M3 Measured|Omitted(CountClaim). behavior-test runner를 *호출한* flow면 measured(stdout에서 센 R23 CountClaim: command + raw_stdout sha256) — result∈{red,unexpected_green} 및 cap_exceeded escalate(partial suite를 실행함) 포함; runner를 호출 안 한 flow(no_op/measured/migration-failed|partial escalate/runner-부재 escalate)면 omitted (아래 "Count provenance")
red_confirmed_count                                # 필수, M3 Measured|Omitted(CountClaim). behavior suite를 *실행한* flow면 measured(RED 확인 count; cap_exceeded는 partial suite); 실행 안 한 flow면 omitted (아래 "Count provenance")
firebat_scan?                                      # M3 Measured|Omitted — test 코드 작성 후 firebat scan (agents/test.md L22). measured면 findings_count CountClaim. **조건부 필수**: primary 행위-test 블록(tests_added/coverage_added)이 비어있지 않으면(=test 코드 작성됨) 필수 — escalate-부재에 guard되지 않으므로 cap_exceeded escalate(partial tests_added 작성·실행)에서도 필수. 미실행은 field 생략이 아니라 omitted 분기로 surface (agent rule이 scan을 의무화)
declared_next_step?                                # R16 advisory — Test의 후속(통상 implement). 권위값은 orchestrator가 expected_next_step으로 주입
unverified                                         # R13 KEEP-polarity floor (step level, 필수)

based_on:                                          # §5 RowRef bundle. 구동 입력(spec_ref XOR decide_ref, input과 mirror) + optional enrichment(investigate_ref, ground_ref)
  spec_ref | decide_ref                            # input.input_kind와 일치 (정확히 하나; exactly-one-of는 input에서 grammar-enforce)
  investigate_ref?                                 # optional enrichment — risk_surface edge-case 우선순위
  ground_ref?                                      # optional enrichment — volatile_state pass/fail baseline
```

> `?` 표기는 "optional (flow-conditional)" 의미 (프로젝트 schema 규약). result=red|unexpected_green이면 해당 flow의 primary 행위-test 블록(`tests_added` 또는 coverage flow의 `coverage_added`)이 비어있지 않다; result=measured이면 `profile`(Performance, baseline measured) 또는 `migration_validation`(Migration, `dry_run_result.value.outcome: ok`) 중 하나가 채워져 있다; result=no_op이면 산출 블록 생략·`no_op_details` 필수. **exactly-one-of (Spec XOR Decide)** 입력계약은 `input`/`input_kind` discriminant에서 grammar-enforce되며 `based_on`은 거기에 더해 enrichment ref(investigate_ref/ground_ref)도 carry할 수 있다. `red_confirmed_count`/`tests_written_count`는 behavior-test runner 실행에서 도출된 R23 측정 count(measured 분기)다 — **단 모든 flow가 runner를 돌리는 건 아니다**. **두 count의 denominator는 다르다** (mixed red/unexpected_green flow에서 갈린다 — 위 L72): `tests_written_count.value`는 **작성된 전체 behavior-test 항목 수**(`tests_added` + `coverage_added`, 모든 status 포함)이고, `red_confirmed_count.value`는 **그 중 `status: RED`인 항목 수**(runner stdout에서 재도출한 RED-confirmed subset)다. 어느 쪽도 `tests_added.length`와 동일시하지 않는다 — unexpected_green 항목이 섞이면 `red_confirmed_count < tests_written_count`이며, coverage_added 항목도 둘 다의 합산에 포함된다.

**Count provenance (P-residual / hole 해소 — count 채우는 법을 모든 경로에 명시)**: `tests_written_count`/`red_confirmed_count`는 항상 top-level 필수지만 **bare CountClaim이 아니라 M3 Measured|Omitted(CountClaim) union**이다. **분기 판별자는 "result 값이 설정됐는가"가 아니라 "behavior-test runner를 실제로 호출했는가"다.** runner가 돈 경로는 measured(CountClaim: command + raw_stdout sha256)로, runner를 돌리지 않은 경로는 **omitted 분기**로 채운다 (R22 first-class absence — null·0·placeholder 금지):
> - **runner가 돈 경로 → measured**:
>   - **`result ∈ {red, unexpected_green}`** — behavior suite 작성·실행됨 → 두 count 모두 measured.
>   - **`escalate(failure_origin=cap_exceeded)`** (Caps mid-activity hit) — caps가 터지기 전에 partial `tests_added`를 *작성·실행*하여 per-test RED status를 도출했으므로 **runner가 실제로 돌았다** → 두 count 모두 measured(CountClaim)로, **partial suite에서 센 실측 count**다. (result 값은 escalate path라 설정되지 않지만 — runner는 돌았으므로 omitted가 아니다.)
> - **runner를 안 돌린 경로 → omitted** (result 설정 여부와 무관):
>   - **`result: no_op`** (작성·실행한 test 0개) → 두 count 모두 omitted (`reason: not_applicable`).
>   - **`result: measured`** (Performance/Migration — behavior-test runner 미호출) → 두 count 모두 omitted (`reason: not_applicable`).
>   - **`escalate(failure_origin=test)` from Migration `outcome: failed|partial`** — Migration flow라 behavior-test runner는 애초에 돌지 않았다 (dry-run *도구 자체는* 정상 실행됐고 깨진 건 migration script다). runner-부재 escalate가 *아니므로* `tool_*` 사유는 부적격 → 두 count 모두 omitted (`reason: not_applicable`). 즉 `not_applicable`은 "result가 있다/없다"가 아니라 **"behavior-test runner가 호출되지 않았다"**에 묶인다.
>   - **precondition/runner-부재 escalate** (Activities 진입 전 escalate, 또는 runner 부재 escalate — test 코드/실행 없음) → 두 count 모두 omitted (`reason: tool_absent | tool_failed | timeout`).
> 즉 "측정할 command가 없었다"는 omitted로 1급 표현된다 (CountClaim은 그걸 표현 못 하므로 union으로 감싼다).

공유 `Omitted.reason` enum은 `tool_absent|tool_failed|timeout|unavailable|skipped|not_applicable` 전체를 grammar-허용하지만, 위 두 count(`tests_written_count`/`red_confirmed_count`)에서 **`unavailable`·`skipped`는 정당하지 않다** — 이 두 값은 runner-invocation coupling을 어긴다. 이 coupling(**runner가 돈 경로**[result∈{red,unexpected_green} 또는 cap_exceeded escalate] ⇒ measured; no_op|measured|migration-failed|partial-escalate ⇒ omitted `not_applicable`; runner-부재 escalate ⇒ omitted `tool_absent|tool_failed|timeout`)은 grammar가 표현 못 하는 cross-field 제약이므로 **named M2 x-validator-contract**(schema의 두 count 필드 annotation)로 강제된다 — `result=no_op` + `reason=skipped` 같은 stale/malformed producer 출력은 grammar는 통과하나 이 contract가 reject한다 (고무도장 방지).

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
- **Profiler / Migration dry-run runner 부재** — 이들은 *해당 flow에 한정된* 측정·검증 도구다. 부재 시 해당 sub-output을 `status: omitted`로 degrade-분기 표기 (M3 Measured|Omitted, R12 failure_modes 재사용)하고, omit 사유를 남긴 채 *행위 test 부분은 정상 진행*. 단, 그 flow의 *유일한* 산출이 그 도구에 전적으로 의존하면(예: Migration flow에서 dry-run runner가 죽음 = Test의 그 invocation에서 할 일이 없음) → mechanical error → **escalate** (`failure_origin=test`). enhancement-degrade는 *행위 test가 따로 존재할 때만* 적용.
- **`profile.baseline.status: omitted`일 때의 result 라우팅 (hole 해소 — Performance flow에서 baseline이 omitted면 무엇이 result를 구동하는가)**: profiler가 *omitted*면 `result=measured`로 갈 수 없다 (`measured`는 `baseline.status: measured`일 때만 — M2 x-validator-contract: `result=measured ⇒ profile.baseline.status=measured`). 두 경우로 분기:
  - profiler가 그 Performance flow의 **유일한 산출**이면 → 그 omit이 곧 "할 일 없음"이므로 위 규칙대로 **escalate** (`failure_origin=test`). `result`는 생략 (escalate 배타).
  - profiler가 **유일 산출이 아니고** 행위 test(`tests_added`)가 함께 존재하면 → result는 그 *행위 test*에서 도출(`red` 또는 `unexpected_green`)되고, `profile`(baseline omitted)은 enrichment 메타데이터로 동반된다. 이 경우 `result=measured`가 아니다.
  즉 grammar는 `result=measured` + `baseline.status=omitted`를 받아주지만 M2 contract가 그 고무도장을 reject한다.
- **`measured` primary-block 선택 (hole 해소 — profile과 migration이 *둘 다* measured를 구동할 수 있을 때 무엇이 result를 도출하는가)**: 한 flow가 `profile`(Performance)과 `migration_validation`(Migration)을 *둘 다* carry하는 일은 통상 없으나, 섞이면 result=measured는 **그 flow의 실제 primary 블록** 하나에서만 도출한다 (Performance chain → `profile`, Migration chain → `migration_validation` — orchestrator chain이 어느 쪽이 primary인지 결정). 그리고 **선택된 primary 블록의 측정이 omitted/실패면 `result=measured`로 갈 수 없다** (고무도장 금지): primary가 `profile`인데 `baseline.status=omitted`거나 primary가 `migration_validation`인데 `dry_run_result.status=omitted`(또는 `outcome: failed|partial`)면 → 위 규칙대로 **escalate** (`failure_origin=test`), `result` 생략. 예: profile.baseline=omitted + migration.outcome=ok인 flow에서 primary가 Performance면 escalate(measured 아님)고, primary가 Migration이면 migration.outcome=ok에서 `result=measured`가 도출되며 omitted profile은 enrichment 메타데이터로 동반된다 (`measured`는 *선택된 primary*가 실제 측정됐을 때만). 이 "primary 선택 + 비-primary는 enrichment + omitted primary는 measured 불가" coupling은 M2 x-validator-contract.

**Caps mid-activity hit** (P1/P8 — 부분 산출·halt 규칙; Verify RETRY_EXHAUSTED→halt 일반화):
- Step Depth Policy caps(wall_s/tokens)가 모든 AC에 test를 붙이기 전에 소진되면: 지금까지 작성·실행한 test로 (partial) `tests_added`를 채우고, **남은 AC 목록을 `escalate.remaining_targets`에** 남긴 채 → mechanical error → **escalate** (`failure_origin=cap_exceeded`). silent partial proceed 금지 (DONE_WITH_CONCERNS 폐지된 것과 동일 원칙). orchestrator가 (flow_id, step) 5-누적-fail halt cap으로 bound. **이 partial tests_added + escalate 동반은 escalate-배타성의 두 번째 허용 co-occurrence**다 (migration failed|partial 블록과 동일 원리 — escalate path에서 `result`는 설정되지 않으므로 partial tests_added는 success result 블록이 아니라 진단·부분진척 carrier다). M2 contract: `failure_origin=cap_exceeded` ⇒ `remaining_targets` 존재 + partial tests_added 동반.
- request_upstream_deepen은 쓰지 않는다 (principle 2: Decide 전용).

## Step Depth Policy

| Depth | 활동 | Caps |
|---|---|---|
| Shallow | targeted (단일 RED test) | wall_s=60, tokens=10k |
| Deep | full coverage (multi-test + edge cases + profile) | wall_s=600, tokens=40k |

**Deepen triggers**: flow_type ∈ {feature, performance, migration, compound} | Spec.acceptance_criteria.length ≥ 5 | Investigate.risk_surface contains severity ∈ {high, critical}

(severity는 Investigate.risk_surface의 단일 척도 low|med|high|critical를 그대로 사용 — 두 번째 척도 발명 없음.)

**Decide-driven (Spec-less) chain의 depth 선택 (hole 해소)**: Test는 Spec-less chain(Bug Fix reproduce, Migration validate, Test flow의 Decide(Plan) 등 — Inputs §11)에서도 돈다. 이 chain들에는 `Spec.acceptance_criteria`가 없으므로 **`acceptance_criteria.length ≥ 5` 트리거는 inapplicable**(N/A)하며, depth는 **`flow_type`과 `Investigate.risk_surface` severity 두 트리거에서만** 도출한다. 둘 중 어느 것도 deepen을 걸지 않는 Spec-less chain(flow_type ∉ {feature, performance, migration, compound} 이고 risk_surface에 high/critical 없음)은 **의도적으로 Shallow**다 — silent fall-through가 아니라 명시적 기본값이다.

## Reviewer (test-reviewer)

- 테스트가 행위를 검증하는가 (smoke test 아닌가)
- AC traceability (Spec-driven: 모든 AC에 대응 test; Decide-driven: 결정의 검증 가능 행위에 대응 test)
- 엣지 케이스 커버리지 (Investigate.risk_surface 우선순위 반영)
- **run polarity 정합** — `status`가 *실행 결과*에서 도출됐는가 (`unexpected_green`이면 `unexpected_green_reason` 존재; RED 의도였다 추측만 한 게 아닌가)
- **result enum 정합** — result는 *해당 flow의 primary 산출 블록*에서 도출됐는가 (tests_added 단독 아님): `tests_added`/`coverage_added`에 적어도 하나 RED면 `result=red`; 채워진 행위-test/coverage 항목이 전부 unexpected_green이면 `result=unexpected_green`; Performance `profile` measured 또는 Migration `dry_run_result.value.outcome: ok`면 `result=measured`; 작성·측정할 산출이 정당하게 0개면 `result=no_op`+`no_op_details`. **coverage_added만 있고 tests_added 빈 flow를 `no_op`로 오분류하지 않았는가** (coverage 항목이 result 도출에 참여).
- **based_on 정합** — Spec-driven이면 `spec_ref`, Decide-driven이면 `decide_ref` (P3)
- Bug Fix: reproduction test가 실제 bug 재현 (재현 안 되면 `reproduced:false`+`unexpected_green` 정직 보고). **reproduction은 메타데이터** — 모든 reproduction(true·false)이 짝지어진 `tests_added` 항목으로 carry됐는가, 그리고 그 짝이 **`bug_ref` join key로 매칭**되는가 (reproduction.bug_ref == 짝 tests_added.bug_ref; 여러 bug여도 join 가능). **join 완전성** — reproduction이 있으면 매칭되는 tests_added 항목이 **정확히 하나** 존재하는가 (bug_ref가 tests_added에 optional이므로, 0개 또는 2개 이상 매칭되면 reject — stale/malformed 방어). **reproduction 부재** — `result=no_op`/`result=measured`/escalate-only(짝 tests_added 없음) 경로에 reproduction이 잘못 동반되지 않았는가. result는 그 tests_added.status에서 도출; reproduction 단독은 primary 결과 블록 아님
- Performance: `profile.metric`+`unit`+`baseline`(Measured CountClaim)+`comparator`로 *측정 가능*; `result=measured`면 `baseline.status: measured`인가 (M2: `result=measured ⇒ baseline.status=measured`); `baseline.status: omitted`면 result는 measured가 아니라 escalate(유일 산출) 또는 행위 test에서 도출(비-유일)됐는가
- Migration: `dry_run_result.value.outcome` enum 정합(ok|failed|partial); `ok`면 `result=measured`, `failed|partial`면 result로 매핑하지 않고 escalate(`failure_origin=test`)됐는가 (verdict 고무도장 아님). `value.reversible`(dry-run이 rollback-safety 확인) 및 `value.raw_stdout_sha256`(R23/M2 re-hash provenance)가 정직하게 기록됐는가 — `reversible`은 dry-run이 가역성을 확인한 결과일 뿐 Test가 자기단언하지 않는다 (STAY IN LANE: 검증 판정은 Verify)
- **escalate 정합** — in-scope 실패면 `escalate.failure_origin` ∈ {spec, decide, test, cap_exceeded} 존재하고 성공 result 분기와 배타적인가 (request_upstream_deepen 안 씀)

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
