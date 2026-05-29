# Migration Flow

Library/version upgrade. dependency_audit volatile profile. Test before each Implement cycle (test-first rule).

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
    loop_with: implement
  - name: implement
    reviewer: implement-reviewer
    isolation: worktree
  - name: verify
    max_failures: 3
  - name: reflect
```
