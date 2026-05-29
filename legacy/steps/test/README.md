# Test — RED Tests + Coverage

## Definition

> **Test은 failing tests (RED)를 작성한다.** Spec의 AC를 검증하는 행위 테스트. Bug Fix flow에서는 reproduce. Performance flow에서는 profile/measure. Migration flow에서는 validate.

Test ⇄ Implement는 RED-GREEN-REFACTOR 루프 (Test가 RED, Implement가 GREEN).

## Inputs

**Required (정확히 하나)** — flow-conditional:
- Spec 출력 (acceptance_criteria, tasks, code_architecture) — flow에 Spec 단계 있을 시
- 또는 Decide 출력 (option_selection / decision_record) — Bug Fix (reproduce), Bug Fix Unreproducible (hypothesis), Migration (validate), Test flow의 Decide(Plan) 등 (Spec 없는 chain)

**Optional enrichment**:
- Investigate.risk_surface (edge case 우선순위)
- Ground.volatile_state (현재 통과/실패 baseline)

**Input contract rule**: minimum=1 of (Spec | Decide). reviewer는 flow chain 명시 따라 검증.

## Activities

1. **RED test 작성** — AC 별 failing test
2. **Reproduce** (Bug Fix) — bug 재현 test
3. **Coverage 추가** (Refactor, Test flow) — 기존 미커버 영역
4. **Profile/Measure** (Performance) — baseline + target metric
5. **Validate** (Migration) — migration script dry-run

## Output

```yaml
tests_added:
  - file_path, test_name, ac_ref, status: RED
reproduction?: { test_path, bug_ref }    # Bug Fix
profile?: { metric, baseline, target }   # Performance
migration_validation?: { script_path, dry_run_result }  # Migration
based_on: { spec_ref }
```

## Step Depth Policy

| Depth | 활동 | Caps |
|---|---|---|
| Shallow | targeted (단일 RED test) | wall_s=60, tokens=10k |
| Deep | full coverage (multi-test + edge cases + profile) | wall_s=600, tokens=40k |

**Deepen triggers**: flow_type ∈ {Feature, Performance, Migration, Compound} | Spec.acceptance_criteria.length ≥ 5 | Investigate.risk_surface contains severity=high

## Reviewer (test-reviewer)

- 테스트가 행위를 검증하는가 (smoke test 아닌가)
- AC traceability (모든 AC에 대응 test)
- 엣지 케이스 커버리지
- Bug Fix: reproduction test가 실제 bug 재현
- Performance: profile metric이 측정 가능

## Boundary

| 항목 | 책임 |
|---|---|
| AC 정의 | Spec |
| 코드 작성 (test 외) | Implement |
| 결과 의미 판단 | Verify |
