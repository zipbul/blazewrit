# Harness coverage gaps — entry-point exhaustion (2026-05-31)

> Simulated 3 ENTRY POINTS (human-UI / autonomous-AI / monitoring) loop-until-dry. **Dry was
> NOT reached** — 3×7 rounds produced **200 scenarios and were still generating** (53 from the
> earlier lifecycle sim was hopelessly short). Of 200, **~90 (45%) are UNCOVERED** by the
> 7-shape model, forming ~11 coherent clusters. Verdict: **MAJOR_GAPS, coverage NOT guaranteed.**

## The structural finding (root cause)

The harness models **only WORK FLOWS.** Shapes A–G all assume the shape is already chosen and
no flow is running. Two whole planes are missing, plus several cross-cutting layers:

1. **CONTROL PLANE** (missing entirely). Abort / undo an in-flight flow · amend scope of a
   running flow · resume · dedup a duplicate request · attach-as-context to a running flow.
   Blocked because **Triage is STATELESS** (no `active_flow_state` input) — it cannot target or
   even know about a running flow.
2. **NON-FLOW / CONVERSE plane** (Shape H). Pure brainstorming with zero deliverable · pedagogy
   /tutoring · advisory verbal verdict · deictic chit-chat. This is the None↔Triage region; no
   work shape runs.

## The ~11 uncovered clusters

| cluster | examples |
|---|---|
| Pre-flow / non-flow conversation | pure brainstorm (0 artifact), pedagogy, debate |
| Read-only / advisory terminals | instant Postgres state-query; "just tell me Postgres or Dynamo" (investigate, no artifact) |
| Flow control-plane on EXISTING flows | abort/undo in-flight, mid-flight scope amend, approval revocation |
| Triage statefulness | dedup against own active-flow registry, already-satisfied duplicate, attach-as-context |
| Decline-to-act variants | won't-fix (record), risk-acceptance, governance/constitution violation — each a different terminal |
| Authority / governance / policy | escalate-to-human go/no-go gate, credential/capability wall, change-embargo |
| Self-as-operand (autonomous) | self-throttle/cadence, self-token-tuning, self-cron, amputate own capability |
| Cross-agent / fleet (A2A) | protocol-version negotiation, leader-election/work-claim, inbound-advice vetting |
| Reconcile / two-sources-of-truth | drift where authority is ambiguous (revert vs ratify vs both-wrong-redesign) |
| External boundary terminals | vendor down (comms-only incident), vendor slow-but-up (dead-ends outside our control) |
| Verify-oracle pathologies | subjective/aesthetic → route to human; AI self-defines the oracle; un-auditable-by-requester |

## New shapes / parameters the simulation forces

- **Triage must become STATEFUL** — take an `active_flow_state` / flow-registry input so it can
  dedup, attach, resume, abort. (Single biggest change; the legacy Triage README explicitly
  says "no flow state" — that premise is wrong for blazewrit's UI-driven multi-flow reality.)
- **Shape H — Converse** (non-flow): brainstorm, pedagogy, advisory-verbal-verdict, deictic.
- **Decline-to-act terminal spectrum**: durable-record (won't-fix / risk-accept / governance).
- **Authority / gate parameter layer** across all shapes: escalate-to-human go/no-go, gate-waiver,
  change-embargo precheck.
- **Self-as-operand action class**: terminals whose subject is the agent's own runtime
  policy/schedule/capability/ledger.
- **A2A interaction shape**: two-sided negotiation, leader-election/work-claim, advice vetting,
  outbound handoff.
- **RECONCILE disposition**: resolve two-sources-of-truth and DECIDE authority.
- **Signal-admission layer** at the monitoring entry: reject malformed/contract-violating
  triggers; treat absence-as-signal; meta-monitoring.
- **Verify-mode extensions**: human-subjective oracle, self-authored oracle, deferred/future
  oracle with auto-rollback.
- **followup_flows extensions**: cross-project/peer routing target; suspended-until-EXTERNAL-event
  (opaque, un-pollable) park.

## The two challenges answered

- **feature vs bugfix vs hotfix — same steps?** feature ≈ bugfix walk the SAME Shape-A spine
  (diverge only in Ground profile + Decide mode). **HOTFIX DIVERGES** — emergency + ops-mitigation
  (rollback/restart) puts it in **D/E**, not A. So no, they are not all one path.
- **ideation / brainstorming?** PARTIAL. Artifact-producing ideation (roadmap, ADR, build-vs-buy)
  → **B** with report_type=ideation. **Pure open-ended brainstorming with zero deliverable is
  UNCOVERED** — it is the Converse (Shape H) non-flow state, which does not exist yet.

## Honest status

- Scenario-level exhaustion did NOT terminate and likely won't — an autonomous, multi-agent,
  UI-driven AI system has an effectively unbounded request space. The meaningful convergence
  target is **CLUSTER/category exhaustion** (no new *category* emerges), not scenario count.
- The flow model is not "7 shapes + 2 more." It needs an **architecture**: a work plane (A–G) +
  a **control plane** + a **Converse plane** + cross-cutting **authority / self-operand / A2A /
  reconcile** layers, and a **stateful Triage**. That is a larger redesign than the flow set.
