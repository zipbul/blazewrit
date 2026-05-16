# Investigate — Task-Specific Interpretation

## Definition

> **Investigate는 Ground 사실을 *설계 가능한 문제 정의*로 해석한다.** 영향·제약·위험·호환성. *옵션 안 만듦, 결정 안 함* (Decide 책임). 새 사실 캡처 안 함 (Ground 책임).

## Inputs

- Ground 출력 (task_subgraph, volatile_state, unknowns, conflicts, provenance, freshness)
- Triage 출력 (flow_type, classification_metadata, clarifications)
- request_text, conversation_context

## Activities

```
1. Impact 추적          ED traversal from entry_nodes — callers/callees/data flow
2. Constraint 식별       정책·컨트랙트·보안 자세에서 도출
3. Risk surface         실패 모드 (impact × Ground concerns) — severity + probability + evidence
4. Validity 검사         Ground 사실 vs Triage 의도 target 비교 — task가 진짜 의미 있나? (no-op 감지)
5. Compatibility 판정    명백 호환성 + Validity 결과 → proceed | blocked | needs_clarification | no_op | partial_proceed
                        (도달 가능성·옵션 의존 판단은 Decide 영역)
6. Unknown disposition   Ground unknowns 각각 → 7 disposition 중 1 분류 (matrix 기반, 명시 rationale)
```

## Validity 검사 — Flow별 No-op 조건

| Flow | No-op 검출 |
|---|---|
| Performance | Ground.volatile.perf_baseline ≤ Triage 요청 target |
| Migration | Ground.dependency_audit이 이미 target version 보여줌 |
| Bug Fix | Ground 또는 reproduce 시도에서 bug 재현 불가 (이미 fix됨) |
| Refactor | 코드가 이미 target 패턴 준수 |
| Chore | 변경 target이 이미 원하는 상태 (typo 없음 등) |
| Feature | Ground.task_subgraph에 기능 이미 구현 표시 |
| Test | Ground.coverage가 이미 target 충족 |
| Release | git log에 신규 commits 없음 |

No-op 감지 시 → `compatibility_verdict.result = no_op` + `no_op_details` 필수. [compatibility-verdict.md 참조](./compatibility-verdict.md).

## Output 구조

핵심 output 필드:
- `impact_map`
- `constraints`
- `risk_surface`
- `compatibility_verdict` → 별도 파일 [compatibility-verdict.md](./compatibility-verdict.md)
- `ground_unknowns_addressed` → matrix 별도 파일 [unknown-disposition.md](./unknown-disposition.md)
- `sub_flow_identification` (Compound 전용)
- `triage_mismatch?` (Triage 오류 의심 시 surface — reclassify 트리거)
- `verification_proof`

### impact_map / constraints / risk_surface 스키마

```yaml
flow_id: ...
based_on_ground: <ground 산출물 hash>

impact_map:
  primary_areas: [{ node, change_kind, source: ed_traversal }]
  ripple: [{ node, distance, why }]
  external_surface: [{ contract, consumers, breaking?: bool }]

constraints: [{ source: rule|contract|security|domain, description, blocking?: bool }]

risk_surface: [{ area, severity: low|med|high|critical, probability: likely|possible|unlikely, evidence }]
```

### ground_unknowns_addressed 스키마

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

### Compound + triage_mismatch + verification_proof

```yaml
(Compound only) sub_flow_identification: [{ flow_type, scope, rationale }]   # 식별만, 분해/순서는 Decide

triage_mismatch?: { suspected_flow_type, evidence }   # Triage 오류 의심 시 surface (reclassify 트리거)

verification_proof: { ed_queries, web_fetches?, file_reads }
```

## Tools 허용

- ED MCP query (graph traversal — read only)
- 외부 리서치 (WebFetch / WebSearch / Context7) — [external-research.md](./external-research.md) 정책 준수
- Read (path-restricted): CLAUDE.md, AGENTS.md, .claude/rules/** 만 (project rules)

**Bash 도구 제거**: Investigate는 Bash 사용 안 함. git log 같은 commit history 필요 시 → Ground의 volatile_capture에서 미리 수집 (Ground 책임).

**프로젝트 내부 코드 read 금지**: Ground가 미흡한 detail이 필요하면 `request_upstream_deepen` 신호로 Ground deep 재invoke. 직접 코드 read = boundary 위반. Mechanical 강제: agent frontmatter `tools: [WebFetch, WebSearch, Read]` + Read의 path hook 제한.

## Reviewer (investigate-reviewer)

- impact_map이 Ground entry_nodes 모두 커버
- risk_surface가 god_nodes_in_scope 각각에 대해
- compatibility_verdict 명시 (V1-V13 통과)
- validity 검사 결과 명시 (no_op 시 no_op_details + evidence ref)
- ground_unknowns_addressed 매 항목 disposition + rationale + follow_up_ref 명시 (silent 미처리 0)
- matrix 권장 벗어난 경우 rationale 강화 확인
- 옵션·설계 prose 없음 (Decide 영역 침범 금지)

## Adaptive Depth

Step Depth Policy 참조. Investigate default shallow:
- **shallow**: compatibility check + unknown_disposition. caps: wall_s=20, tokens=4k
- **deep**: 전체 6 activities. caps: wall_s=180, tokens=20k

**deepen triggers (OR)**:
- Ground.depth = deep (cascade)
- flow_type ∈ {Migration, Feature, Performance, Compound, Bug Fix Unreproducible}
- Ground.unknowns.length ≥ 3
- Ground.task_subgraph.entry_nodes.length > 5
- prior_evidence with depth_upgrade=true (reclassify path)

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

**Boundary clarification**: Investigate의 외부 리서치 (WebFetch / WebSearch / Context7)는 *프로젝트 내부 사실 캡처*가 아닌 *외부 검증을 위한 read* — Investigate의 해석 활동에 필요한 *외부 가설 확인*. 프로젝트 내부 ED·코드·빌드는 Ground 책임. 외부는 Investigate가 *해석 보조*로 read. 경계 명확.

## Sub-policies

- [compatibility-verdict.md](./compatibility-verdict.md) — 5-state result + scoped issues + V1-V13 validation + stale 검출 + result별 flow 처리
- [unknown-disposition.md](./unknown-disposition.md) — 7 disposition matrix + Ground unknown 유형별 권장
- [external-research.md](./external-research.md) — 외부 리서치 trigger·source·tool·stop·conflict·no-results·failure recovery
