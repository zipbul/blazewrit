# Spec — Acceptance Criteria + Code Architecture

## Definition

> **Spec은 Decide(Design)의 design document에서 *구현 가능한 형식*을 추출한다.** AC + 코드 architecture (디렉토리/파일 설계, 모듈 경계, 의존 관계) + task 분해 + 의존성 + 순서.

Plan-as-prompt: Spec 출력이 곧 downstream(Test/Implement) 실행 프롬프트.

## Inputs

- Decide 출력 (mode=Design일 때 design document, mode=Plan일 때 옵션·sequencing, mode=Record일 때 결정·rationale)
- Investigate 출력 (constraints, risk_surface, compatibility_verdict.issues)
- Ground 출력 (task_subgraph, volatile_state)

## Activities

1. **AC 추출** — 모든 정책/요구사항을 측정 가능한 acceptance criterion으로 변환 (번호, 측정 단위, edge case 포함)
2. **코드 architecture 설계** — 디렉토리/파일 배치, 모듈 경계, 의존 그래프
3. **Task 분해** — implementable 단위로 쪼개기 (single concern per task)
4. **순서·의존** — task ordering, blocking relation
5. **emberdeck spec card + codeLinks** — Design mode design document의 intent card에 연결

## Output

```yaml
acceptance_criteria:
  - id, statement, measurement, edge_cases
code_architecture:
  directories: [...]
  files: [{ path, purpose, exports }]
  module_boundaries: [...]
  dependencies: [...]
tasks:
  - id, description, depends_on, ac_refs
spec_card_id: <emberdeck card>
based_on: { decide_ref, investigate_ref, ground_ref }
```

## Step Depth Policy

| Depth | 활동 | Caps |
|---|---|---|
| Shallow | AC list만 (각 line max, no architecture detail) | wall_s=30, tokens=5k |
| Deep | AC + 코드 architecture + task decomposition + codeLinks | wall_s=240, tokens=25k |

**Deepen triggers**: flow_type ∈ {Feature, Migration, Performance, Compound} | Decide.mode=Design | Investigate.compatibility_verdict.issues.length ≥ 2

## Reviewer (spec-reviewer)

- 모든 정책이 AC로 변환됐는가
- AC 측정 가능한가 (mechanical assertion 가능)
- 코드 architecture (디렉토리/파일) 명확한가
- task 분해 빠짐없는가
- emberdeck spec card 생성 + codeLinks 매핑

## Boundary — Spec이 안 하는 것

| 항목 | 책임 |
|---|---|
| 결정·옵션 deliberation | Decide |
| 사실 캡처 | Ground |
| 해석·영향 분석 | Investigate |
| Test 작성 | Test |
| 코드 작성 | Implement |
