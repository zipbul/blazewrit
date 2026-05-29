---
flow_id: calibration-bad-1
flow_type: chore
captured_at: 2026-05-17
schema_version: 1
---

# Ground — calibration-bad-1 (INTENTIONALLY BAD for reviewer testing)

## task_subgraph

bounded_at: 3 entry nodes.

### entry_nodes

| id | path | source | freshness |
|---|---|---|---|
| readme | README.md | Read | recent |
| pkg | package.json | Read | recent |
| ts | tsconfig.json | Read | recent |

### neighbors

(none specified)

## volatile_state

| Field | status | details |
|---|---|---|
| typecheck | success | tsc passed |
| tests | success | all pass |
| lint | skipped | n/a |
| git | success | clean |

## unknowns

| dim | reason |
|---|---|
| ed_version | not_tracked |

## conflicts

| sources | description |
|---|---|
| README vs package.json | The two files are **consistent** in their version claims. No conflict. They **match** perfectly. |
| tsconfig vs eslintrc | Configurations **align** with each other and **agree** on TypeScript version. |

## freshness

- ed_snapshot_version: PENDING-emberdeck-unavailable
- git_head_start: abc123
- git_head_end: abc123
- racing_changes: false

## verification_proof

(omitted for calibration)
