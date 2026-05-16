# Implement — Code Changes (GREEN)

## Definition

> **Implement는 Test의 RED를 GREEN으로 만든다.** Spec architecture에 따라 코드 작성. Sub-activities: setup (deps, config, infrastructure), code, commit.

## Inputs

- Spec 출력 (acceptance_criteria, code_architecture, tasks)
- Test 출력 (failing tests — must pass)
- Decide 출력 (chosen approach)

## Activities

1. **Setup** — deps install, config 변경, infra 셋업 (필요 시)
2. **Code** — Spec architecture에 따른 변경
3. **firebat scan** — 매 change 후
4. **emberdeck validate_code_links** — card↔code drift 검출
5. **Atomic commit** — logical unit 단위

## Output

```yaml
changes:
  - file_path, change_type: create|modify|delete
commits:
  - sha, message, files
firebat_results: { blockers, warnings }
emberdeck_drift: 0  # 강제
based_on: { spec_ref, test_ref }
```

## Step Depth Policy

| Depth | 활동 | Caps |
|---|---|---|
| Shallow | minimal patch (single concern) | wall_s=120, tokens=15k |
| Deep | full implementation + setup + 다중 commits | wall_s=900, tokens=60k |

**Deepen triggers**: flow_type ∈ {Feature, Migration, Performance, Compound} | Spec.tasks.length ≥ 3 | Spec.code_architecture.files.length ≥ 5

## Reviewer (implement-reviewer)

- 코드가 spec을 충족하는가
- deviation rules 준수 (deviation_rules에 명시된 항목)
- stub/hollow 없는가 (실제 동작)
- firebat blockers = 0
- emberdeck drift = 0
- atomic commits (한 commit = 한 logical change)

## Boundary

| 항목 | 책임 |
|---|---|
| Test 작성 | Test |
| 코드 architecture 결정 | Spec |
| 옵션 결정 | Decide |
| Flow-level 검증 | Verify |

## P0 Emergency Mode

`flow_type=bugfix-p0` 시 Implement은 *emergency mode*:
- Test 우회 (Test는 Verify 후 retroactive)
- shallow 강제
- 빠른 fix 우선
- Verify PASS 후 post-stabilization follow-up (Test 추가 + 정상 Bug Fix flow) 자동 큐잉
