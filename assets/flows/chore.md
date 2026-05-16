# Chore Flow

Trivial change (typo, config). Minimal pipeline.

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
  - name: verify
    max_failures: 3
  - name: reflect
```
