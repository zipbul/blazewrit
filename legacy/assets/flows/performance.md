# Performance Flow

Latency/throughput tuning. perf_baseline volatile profile. Decide(Design). Verify measures.

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
