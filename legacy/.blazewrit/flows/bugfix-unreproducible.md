# Bug Fix Unreproducible Flow

Intermittent bug. observability profile + hypothesis 우선순위. Verify(extended observation).

```yaml
steps:
  - name: ground
    reviewer: ground-reviewer
  - name: investigate
    reviewer: investigate-reviewer
  - name: decide
    mode: plan
    reviewer: decide-reviewer
  - name: implement
    reviewer: implement-reviewer
    isolation: worktree
  - name: verify
    max_failures: 3
  - name: reflect
```
