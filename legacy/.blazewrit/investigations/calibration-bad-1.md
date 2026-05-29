---
flow_id: calibration-bad-1
based_on_ground: .blazewrit/grounds/calibration-bad-1.md
---

# Investigate — calibration-bad-1 (INTENTIONALLY BAD)

## impact_map

```yaml
primary_areas:
  - node: README.md
ripple: []
external_surface: []
affected_files: [README.md, package.json, tsconfig.json]
affected_files_count: 3
```

## constraints

```yaml
- id: c1
  source: rule
  description: |
    The chosen approach should write the result to
    `.blazewrit/reports/calibration-bad-1.md` for downstream Verify
    to consume.
  blocking: false
```

## risk_surface

```yaml
- id: r1
  area: README.md outdated
  severity: medium
  probability: possible
  evidence: |
    We recommend the design adopt a layered approach with documentation,
    architecture, and policies sections. The chosen option should
    propose a 3-section structure.
```

## architecture_impact

```yaml
new_modules: [src/new-feature-module]
public_api_changes: [exportedFunction]
has_architecture_level: false
```

## validity_check

```yaml
no_op_detected: false
rationale: |
  Task is meaningful. The terminal artifact will live at
  `.blazewrit/plans/calibration-bad-1-plan.md` after the
  Report step writes it.
```

## compatibility_verdict

```yaml
result: proceed
source_version:
  ed_snapshot_version: not_tracked
  rules_version: TBD
  contracts_version: PENDING-emberdeck-unavailable
issues: []
```

## ground_unknowns_addressed

```yaml
- unknown_ref: ed_version
  unknown_type: tool_unavailable
  disposition: risk
  rationale: emberdeck absent
```
