# Test Flow

Coverage augmentation. Test alone (no Implement).

```yaml
steps:
  - name: ground
    reviewer: ground-reviewer
  - name: investigate
    reviewer: investigate-reviewer
  - name: decide
    mode: plan
    reviewer: decide-reviewer
  - name: test
    reviewer: test-reviewer
  - name: verify
    max_failures: 3
  - name: reflect
```
