# Feature Flow

Add new functionality. Full pipeline: Ground → Investigate → Decide(Design) → Spec → [Test ⇄ Implement] → Verify → Reflect.

```yaml
steps:
  - name: ground
    reviewer: ground-reviewer
  - name: investigate
    reviewer: investigate-reviewer
  - name: decide
    mode: design
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
