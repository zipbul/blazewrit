# harness/steps — defect-free step contracts (DESIGN)

> **Status: DESIGN, not implemented.** These are the corrected successor contracts for the
> 10 blazewrit harness steps. The reviewed-with-holes originals are `legacy/steps/<step>/README.md`;
> these close every hole the per-step soundness review found (HARNESS_FLOW_REVIEW.md →
> "스텝 단위 독립 완전성 검토", 0 complete / 8 major / 2 minor) by applying the P1–P8
> remediation + the 3 cross-cutting principles, with each step kept in its lane.

## How these were produced

10 authored + adversarially verified + a cross-step consistency critic. Each contract closes
its inventoried holes; every fix is tagged inline with the pattern/principle it uses
(`(P6: …)`, `(principle 1: …)`) so a reader can trace it back to the review.

## The 3 cross-cutting principles (applied uniformly across all 10)

1. **Tool-absence routing by role.** A step's PRIMARY tool absent/error/timeout → **escalate**
   (the step cannot do its job). An ENHANCEMENT tool absent → a defined **degraded** branch.
   (Ground/Investigate ED, Implement/Verify firebat+emberdeck = escalate; Verify pyreez,
   Decide pyreez, external research = degrade.) An enhancement that returns a *contradictory*
   signal (pyreez disagree) escalates rather than degrades.
2. **Control-signal ownership.** `request_upstream_deepen` is **Decide-only**; every other
   consumer routes a degenerate/missing upstream via the existing `failure_origin` escalate.
3. **Legitimately-empty vs missing/malformed.** Empty-because-the-change-is-clean = a real
   **verdict** (`no_op`/`proceed`/`empty_clean`); empty-because-upstream-is-broken = a
   **mechanical error → escalate**. No step silently rubber-stamps the second as the first.

## What each contract adds over its legacy original

- A full discriminated **result enum incl. the SUCCESS branch** (legacy defined only the
  failure/specific branch) + a per-result orchestrator routing table — modelled on
  Investigate's `compatibility_verdict`.
- A **Failure & degrade handling** section (tool-absence per principle 1).
- An **Input preconditions** section: assert required upstream fields are present + well-typed
  (not *true* — that's Verify) → malformed/missing escalates via `failure_origin`. The
  `(flow_id, step)` 5-accumulated-fail halt cap bounds any escalation ping-pong.
- Every previously-open **enum / production rule / undefined field** closed (no `…`, no TBD,
  nothing referenced-but-undefined).

No new subsystem, no new state, no new validator family — every fix reuses a mechanism the
harness already had.

## Honest limits

- These are **M1 / contract-level**: they close "the contract is silent / contradictory /
  over-reaching," NOT self-asserted truth (a forged `tool_status=present`, an LLM
  `goal_satisfied=true`). That residual is mitigated by the existing M2 re-execute / pyreez
  cross-verify, not eliminated (the §16 irreducible floor).
- **Prose ↔ schema reconciliation pending.** `harness/schemas/` (set aside) already encodes
  some of these shapes; a few prose decisions here (e.g. Spec `investigate_ref` conditional;
  Ground's new `ground_result` discriminator + `omitted_fields`) are newer than the schemas
  and should be reflected into them in a later pass. Flagged, not yet done.
- This is the **design**; wiring these contracts into the running harness is a separate step.
