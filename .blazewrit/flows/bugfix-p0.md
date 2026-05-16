# Bug Fix P0 Flow

Production down. Emergency mode — shallow forced. Ground → Investigate(min) → Decide(Record) → Implement(emergency) → Verify → Test(retroactive — queued follow-up) → Reflect.

```yaml
steps:
  - name: ground
    depth: shallow
    reviewer: ground-reviewer
  - name: investigate
    depth: shallow
    reviewer: investigate-reviewer
  - name: decide
    mode: record
    reviewer: decide-reviewer
  - name: implement
    reviewer: implement-reviewer
    isolation: worktree
  - name: verify
    max_failures: 3
  - name: reflect
```

**Post-stabilization follow-up**: Verify PASS 후 orchestrator가 `Test(retroactive)` flow를 자동 큐잉 (in-flow 아닌 *별도 follow-up flow*).
