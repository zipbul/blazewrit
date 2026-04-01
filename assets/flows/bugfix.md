# Bug Fix Flow

## Steps

```yaml
steps:
  - name: analyze
    depth: focused
    reviewer: analyze-reviewer

  - name: test
    mode: reproduce
    reviewer: test-reviewer

  - name: implement
    mode: fix
    reviewer: implement-reviewer

  - name: verify
    on_fail: route_to_origin
    max_failures: 3

  - name: reflect
```

## Analyze Depth: Focused

- Symptom location (file, line, error message)
- Related code (callers, dependencies of the broken area)
- Reproduction path (steps to trigger the bug)
- Root cause hypothesis (data flow tracing)

## Test: Reproduce Mode

Write a test that reproduces the bug. It MUST fail (RED). This test becomes the proof that the fix works when it turns GREEN.

## Implement: Fix Mode

- Identify root cause before applying fix. Never fix symptoms.
- Data flow trace → hypothesis → verification → fix.
- If 3 fix attempts fail with same approach → STOP, escalate.

## Conditional Steps

기획 and Spec are skipped — bug fixes go directly from Analyze to Test.

## Verify Failure Routing

```yaml
verify_fail_routing:
  analyze: "Root cause analysis was wrong"
  test: "Reproduction test doesn't cover the real issue"
  implement: "Fix doesn't address root cause"
```

## Gate Policy

Default: `auto`.
