# Spike Flow

Feasibility prototype. Implement(prototype) → Report (GO/NO-GO/CONDITIONAL verdict).

```yaml
steps:
  - name: ground
    reviewer: ground-reviewer
  - name: investigate
    depth: shallow
    reviewer: investigate-reviewer
  - name: decide
    mode: plan
    reviewer: decide-reviewer
  - name: implement
    reviewer: implement-reviewer
    isolation: worktree
  - name: report
    reviewer: report-reviewer
  - name: verify
    max_failures: 3
  - name: reflect
```
