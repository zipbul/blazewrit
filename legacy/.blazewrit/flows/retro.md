# Retro Flow

Postmortem. Investigate git log/history. Report → Verify.

```yaml
steps:
  - name: ground
    reviewer: ground-reviewer
  - name: investigate
    reviewer: investigate-reviewer
  - name: decide
    mode: plan
    reviewer: decide-reviewer
  - name: report
    reviewer: report-reviewer
  - name: verify
    max_failures: 3
  - name: reflect
```
