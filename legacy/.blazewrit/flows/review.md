# Review Flow

Audit PR/diff. Findings → followup_flows array (auto-queued, not auto-executed).

```yaml
steps:
  - name: ground
    reviewer: ground-reviewer
  - name: investigate
    reviewer: investigate-reviewer
  - name: decide
    mode: record
    reviewer: decide-reviewer
  - name: report
    reviewer: report-reviewer
  - name: verify
    max_failures: 3
  - name: reflect
```
