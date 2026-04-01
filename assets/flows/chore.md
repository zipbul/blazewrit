# Chore Flow

## Steps

```yaml
steps:
  - name: analyze
    depth: minimal
    reviewer: analyze-reviewer

  - name: implement
    reviewer: implement-reviewer

  - name: verify
    on_fail: route_to_origin
    max_failures: 3

  - name: reflect
```

## Analyze Depth: Minimal

- Change target identification (which files, which config)
- No dependency tracing, no impact scope
- Quick confirmation that the change is safe

## Conditional Steps

기획, Spec, Test all skipped. Chore = config, CI, docs, dependencies.

## Verify Failure Routing

```yaml
verify_fail_routing:
  analyze: "Change target was wrong"
  implement: "Implementation incorrect"
```

## Gate Policy

Default: `auto`.
