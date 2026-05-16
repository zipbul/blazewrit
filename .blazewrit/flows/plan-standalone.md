# Plan-Standalone Flow

Design document output only (no code). Decide(Design) → Report → Verify.

```yaml
steps:
  - name: ground
    reviewer: ground-reviewer
  - name: investigate
    reviewer: investigate-reviewer
  - name: decide
    mode: design
    reviewer: decide-reviewer
  - name: report
    reviewer: report-reviewer
  - name: verify
    max_failures: 3
  - name: reflect
```
