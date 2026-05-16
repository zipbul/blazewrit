# Unknown Disposition Matrix

Ground unknown은 *반드시* 다음 7 disposition 중 하나로 처분. matrix는 *기본 권장*이며 벗어날 시 rationale 강제.

## 7 Dispositions

| Disposition | 의미 | 후속 처리 |
|---|---|---|
| `resolved` | Investigate가 *완전히* 해결 (외부 리서치·도구 호출) | unknown 제거, 사실로 승격 (verification_proof 동반) |
| `partially_resolved` | 일부만 해결됨 — 부분 사실 확보 + 잔여 부분은 다른 disposition으로 sub-처리 | 해결된 부분: resolved로. 잔여: risk/constraint/clarification 등 sub_disposition 명시 |
| `risk` | 불확실성을 risk로 변환 | risk_surface에 항목 추가 (severity + probability) |
| `constraint` | 사실 부재가 제약으로 작용 | constraints에 항목 추가 (blocking 표기) |
| `clarification` | user/caller 응답 필요 | NEEDS_CONTEXT (Investigate halt + 질문) — compatibility_verdict.result=needs_clarification으로 *자동 연결*, follow_up_ref가 가리키는 compat issue 생성 |
| `defer` | 다음 step에서 해결 가능 | deferred_decisions 기록 (defer_to: decide \| spec \| test \| implement) |
| `escalate` | flow halt — 도구/시스템 문제 | compatibility_verdict=blocked + blocker 기록 |

## 기본 Matrix (Ground unknown 유형 → 권장 disposition)

| Ground unknown 유형 | 권장 disposition |
|---|---|
| `capture_failed: timeout` | risk |
| `capture_failed: tool_error` | escalate |
| `inaccessible: permission_denied` | constraint (기본) / clarification (권한 요청 가능 시) |
| `tool_unavailable` (ED/firebat/pyreez 부재) | escalate |
| `referent_unresolved` (request entity 그래프 부재) | clarification |
| ED `AMBIGUOUS` edge | risk |
| ED `INFERRED` edge (low confidence) | risk |
| ED `drift` (card↔code 불일치) | constraint |
| 외부 lib/API 미상 | resolved (WebFetch/Context7 시도) / 실패 시 risk |
| 사실 간 `contradiction` | clarification |
| `racing_changes` (Ground 재시도 후 잔존) | risk |

## ground_unknowns_addressed 출력 schema

```yaml
ground_unknowns_addressed:
  - unknown_ref               # Ground unknown 항목 ID/index
    unknown_type              # matrix 매칭용 (capture_failed/inaccessible/...)
    disposition               # resolved | partially_resolved | risk | constraint | clarification | defer | escalate
    rationale                 # 왜 이 disposition
    matrix_default            # optional bool — matrix 권장 따랐는지 (false면 rationale 강화)
    follow_up_ref             # optional — risk_id | constraint_id | compat_issue_id | deferred_decision_id | blocker_id
    sub_dispositions          # optional, partially_resolved일 때 필수 — [{ part: <description>, disposition: <enum>, follow_up_ref }]
```

## Reviewer 검증

- 매 항목 disposition + rationale + follow_up_ref 명시 (silent 미처리 0)
- matrix 권장 벗어난 경우 rationale 강화 확인
- `clarification` disposition은 자동으로 compat issue 생성, follow_up_ref가 그 compat issue 가리킴
