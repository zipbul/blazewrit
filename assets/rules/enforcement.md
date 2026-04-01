## Deviation Rules

1. firebat severity=error → auto-fix attempt
2. firebat severity=warning → fix if task-related, skip otherwise
3. emberdeck drift detected → update spec card, confirm, proceed
4. 3 failures with same approach → STOP, escalate to user
5. P0 severity → skip Test, fix first, retroactive test mandatory

## Decision Classification

| Type | Criteria | Action |
|------|----------|--------|
| Mechanical | One clearly correct answer | Auto-decide silently |
| Taste | Reasonable people disagree | Surface to user at next gate |
| User Challenge | High risk or irreversible | STOP immediately, ask user |

## Gate Policy

Configurable in `.blazewrit/config.yaml`:

```yaml
gate_policy:
  confirm: [migration, release]
  auto: [*]
```

`confirm` flows require user approval at designated gates. `auto` flows proceed without confirmation.

## Fact Verification

Training data is hypothesis. Verify by reading code or executing. Evidence requires direct observation.

| Claim type | Verification | If unverified |
|------------|-------------|---------------|
| External API/library spec | Read docs/README or execute | `[UNVERIFIED]` tag |
| Implementation feasibility | Prototype code + run | `[UNVERIFIED]` tag |
| Performance numbers | Benchmark/profile | `[UNMEASURED]` tag |
| Existing code behavior | Read code or run test | `[UNVERIFIED]` tag |
| Compatibility/dependency | Install + import | `[UNVERIFIED]` tag |

All producers and reviewers apply this. `[UNVERIFIED]`/`[UNMEASURED]` items cannot serve as decision basis. Verify finds them → FAIL + route to responsible step.

## Completion Status Protocol

Every step agent ends output with:

```
STATUS: DONE
ARTIFACT: {path}

STATUS: DONE_WITH_CONCERNS
ARTIFACT: {path}
CONCERNS: {description}

STATUS: BLOCKED
REASON: {description}

STATUS: NEEDS_CONTEXT
QUESTION: {specific question}
```

## Self-Validation Protocol

Within-step quality loop (prompt-enforced, iteration-capped):

```
Do work → Check against step criteria → Pass? → DONE
                                       → Fail? → Fix (iteration++)
                                       → iteration >= 3? → Force DONE_WITH_CONCERNS
```

Iteration count tracked within step agent execution.

## Escalation on Failure

| Failure count | Same approach? | Action |
|---------------|---------------|--------|
| 1-2 | Yes | Retry with fix |
| 3 | Yes | STOP — same approach exhausted |
| 1-2 | No (different approach) | Continue |
| 3 | No | BLOCKED — present options: fresh restart, user intervention, abandon |

## Chunking Rule

When Analyze identifies scope exceeding 5+ files or 3+ modules, 기획 produces a chunking plan: bounded cycles, each a mini-flow (Test → Implement → Verify), with dependency ordering.

## Reclassification Triggers

Any step can trigger reclassification:
- Bug Fix discovers design flaw → Refactor or Compound
- Refactor requires public API change → Migration
- Spike confirms feasibility → Feature
- 3 failures with same approach → STOP, escalate
- Scope exceeds bounds → Compound or chunking

## Worktree Isolation

High-risk flows (Feature, Migration, Refactor) run Implement in a git worktree. Merge to main only on Verify PASS. On Verify FAIL, fix in same worktree. After 3 failures with same approach, escalate.

Low-risk flows (Bug Fix, Chore, Test, Release) run on main branch directly.

## Hook Failure Policy

| Hook category | On crash/timeout | Rationale |
|---------------|-----------------|-----------|
| Safety (firebat, regression_guard, blocker check) | fail-closed — exit 2 (deny) | Bad code ships |
| Enforcement (Reflect gate, coverage gate) | fail-open (continue) | Quality issue, not dangerous |

## Forced Uncertainty Marking

Unknown = explicit `[NEEDS CLARIFICATION: specific question]`. Max 3 markers per step — make informed guesses for the rest.
