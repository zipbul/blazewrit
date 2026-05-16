# Compatibility Verdict — Schema + Validation + Routing

## Schema

```yaml
compatibility_verdict:
  result: proceed | blocked | needs_clarification | no_op | partial_proceed
  schema_version: 1
  checked_at: ISO8601
  source_version:                                            # freshness (canonical: ed_snapshot_version 단일 명칭)
    ed_snapshot_version: <hash>                              # Ground 출력의 task_subgraph.ed_snapshot_version과 동일 field name
    rules_version: <hash>
    contracts_version: <hash>

  issues:                                                    # cap 50, dedup, most-severe-wins
    - id                                                     # invocation-scoped unique
      type: missing_referent | policy_violation | stack_incompatibility
          | breaking_change | deprecated_usage | resource_constraint
          | security_violation | compliance_violation | license_conflict
          | contract_violation | environment_mismatch | timing_constraint
          | circular_dependency | platform_unsupported | other
      custom_type?: <string>                                 # type=other일 때 필수
      severity: fatal | high | medium | low
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
      blocks_flow?: bool                                     # true → blocked 유발
      suggested_followup

  reason                                                     # result 결정 근거
  blockers?: [issue_id]                                      # result=blocked일 때 필수
  open_questions?: [issue_id]                                # result=needs_clarification일 때 필수

  sub_flow_verdicts?:                                        # Compound only
    - sub_flow_id
      result
      issue_refs: [issue_id]

  issues_overflow?:                                          # 50개 초과 시
    total_found: N
    captured: 50
    summary: <string>

  no_op_details?:                                            # result=no_op일 때 필수
    reason                                                   # 왜 no-op인가
    evidence: <ground/investigate fact ref>                  # Ground/Triage 비교 근거
    current_state: <캡처된 사실>                              # baseline/version/coverage 등
    target_state: <Triage 의도 추출>                          # 요청 목표
    suggested_action: abandon | wait_for_change | reframe_request

  partial_scope_handling?:                                   # result=partial_proceed일 때 필수
    proceed_set: [scope refs]
    blocked_set: [scope refs]
    followup_required: bool
```

## Validation Rules (mechanical)

```
V1.  issues 빈 list → result=proceed 강제
V2.  어느 issue.blocks_flow=true → result=blocked
V3.  V2 없고 어느 issue.requires_user=true → result=needs_clarification
V4.  V2/V3 모두 미충족 → result=proceed
V5.  issue dedup: (root_cause hash + scope hash) 같으면 1 issue, max(severity) 채택
V6.  issues.length ≤ 50, 초과 시 issues_overflow 필수
V7.  type=other → custom_type 필수
V8.  result=blocked → blockers 비어있지 않음
V9.  result=needs_clarification → open_questions 비어있지 않음
V10. 모든 issue에 evidence 필수 (provenance)
V11. result=no_op → no_op_details 필수 (reason + evidence + current_state + target_state + suggested_action)
V12. result ∈ {proceed, blocked, needs_clarification, no_op, partial_proceed} — enum 무효값 reject
V13. Partial-proceed result: Migration 등에서 일부 dependents accept + 일부 reject 시 — `result=partial_proceed` 별도 enum. `issues`는 `scope.target_set` per 영향 범위 분리. `partial_scope_handling: {proceed_set, blocked_set, followup_required}`. Decide는 partial_proceed에서 *실행* (proceed_set 처리), blocked_set은 followup_flows로 큐잉. all-or-nothing 강제 제거.
```

## Stale 검출 책임

| 누가 | 언제 | 어떻게 |
|---|---|---|
| Decide | Investigate 출력 수신 시 | `source_version.ed_snapshot_version` vs 현재 ED snapshot — mismatch면 Investigate 재invoke 요청 (최대 1회 재invoke = 총 2 attempts) |
| Verify | 최종 검증 시 | source_version + V1-V13 + race detection (verdict checked_at vs current 시점) |
| Mid-flow ED 변경 | ED background incremental update가 flow 도중 발생 | source_version mismatch 자동 trigger → re-evaluation. Cycle cap이 무한 막음. |

**2nd attempt도 stale일 때**: 2nd attempt (= 1회 재invoke 후)도 stale 발견 시 → `failure_origin=ground` 신호로 Verify에 위임 또는 flow halt + escalate (config 설정). 무한 진행 금지. cycle cap=1의 정확한 의미: *원본 + 재invoke 1회 = 총 2 attempts*.

## Result별 Flow 처리

| result | Orchestrator 처리 |
|---|---|
| proceed | Decide step 진입 (mode upgrade trigger 허용) |
| blocked | **Flow halt 강제** — Decide 미실행. blockers를 user/caller에 surface |
| needs_clarification | **Decide 미실행** — NEEDS_CONTEXT → user/caller 응답 후 Investigate 재invoke (clarifications 누적) |
| no_op | **Flow halt 강제** — Decide 미실행. Reflect 실행 (abandonment 분류). no_op_details 학습 |
| **partial_proceed** | Decide 진입 — `partial_scope_handling.proceed_set` 처리. `blocked_set`은 followup_flows로 큐잉. 부분 작업 완료 + 후속 flow 생성 |

**중요 (halt 강제 메커니즘)**: Decide의 mode upgrade trigger는 *compatibility_verdict.result=proceed 또는 partial_proceed인 경우에만* 평가됨. result가 그 외 (blocked/needs_clarification/no_op)이면 *Decide 자체 미실행* — upgrade trigger가 halt 명령을 override 불가. Orchestrator가 mechanical 강제.

**Reflect 분류**:
- `completed`: 모든 step 정상 종료
- `abandoned`: blocked / no_op / user abandonment / RETRY_EXHAUSTED
- `suspended`: NEEDS_CONTEXT 또는 active flow preempted

→ Reflect는 completed + abandoned에서 실행, suspended에서는 미실행.
