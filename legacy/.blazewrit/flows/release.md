# Release Flow

Version bump. release_state volatile profile. confirm gate (CI/A2A pre_approved 필요).

```yaml
steps:
  - name: ground
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
