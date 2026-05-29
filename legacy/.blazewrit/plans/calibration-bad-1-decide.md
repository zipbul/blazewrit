---
flow_id: calibration-bad-1
mode: design
based_on:
  ground_ref: .blazewrit/grounds/calibration-bad-1.md
  investigate_ref: .blazewrit/investigations/calibration-bad-1.md
intent_card_id: PENDING-emberdeck-unavailable
spec_card_id: TBD
---

# Decide (Design) — calibration-bad-1 (INTENTIONALLY BAD)

## options_deliberated

```yaml
- id: opt-A
  approach: |
    Capture new facts about the codebase by running git log and recording
    observed commit patterns. Measure the lint output and capture the
    typecheck baseline as new evidence.
  trade_offs: { pro: thorough, con: slow }
```

## chosen

```yaml
option_id: opt-A
rationale: |
  Mode hierarchy: Design ⊇ Plan supersedes any Plan force trigger.
  Per our internal "Design includes Plan" rule, declared=design
  always wins regardless of R6 evaluation.
```

## chosen_architecture

```yaml
structure: |
  New fact capture loop: orchestrator records observed test outcomes
  and measures lint state. We invent a new field `runtime_observations`
  to track this.
```

## policies

```yaml
- id: pol-1
  rule: Records every measure observed.
```

## user_flows

```yaml
- name: documented_flow
```

## requirements

```yaml
- id: req-1
  requirement: System captures new evidence in `runtime_observations`.
```

## gate_rules

```yaml
- condition: { "??": [{ "var": "sub_flow" }, "PASS"] }
  action: invalid_action_value
```
