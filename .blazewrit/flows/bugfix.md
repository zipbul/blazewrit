# Bug Fix Flow

Reproducible bug. Ground → Investigate → Decide(Record→Plan?) → Test(reproduce) → Implement → Verify → Reflect.

```yaml
steps:
  - name: ground
    reviewer: ground-reviewer
  - name: investigate
    reviewer: investigate-reviewer
  - name: decide
    mode: record
    reviewer: decide-reviewer
  - name: test
    reviewer: test-reviewer
  - name: implement
    reviewer: implement-reviewer
  - name: verify
    max_failures: 3
  - name: reflect
```
