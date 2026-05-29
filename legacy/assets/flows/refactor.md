# Refactor Flow

Internal restructure. Coverage <80% → Test mandatory. Large scope → Decide Design upgrade.

```yaml
steps:
  - name: ground
    reviewer: ground-reviewer
  - name: investigate
    reviewer: investigate-reviewer
  - name: decide
    mode: plan
    reviewer: decide-reviewer
  - name: spec
    reviewer: spec-reviewer
  - name: test
    reviewer: test-reviewer
    condition: coverage_below_80
  - name: implement
    reviewer: implement-reviewer
    isolation: worktree
  - name: verify
    max_failures: 3
  - name: reflect
```
