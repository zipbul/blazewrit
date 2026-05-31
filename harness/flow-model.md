# Harness Flow Model — needs-derived (rebuilt 2026-05-31)

> Rebuilt TOP-DOWN from a 53-scenario lifecycle simulation (구상/기획/개발/수정/운영/유지보수),
> NOT bottom-up from the legacy 16. A **flow = a chain SHAPE** (which steps, what terminal,
> what Verify means); a **step = a fixed unit of work**. The legacy 16 named flows
> (feature/bugfix/migration/test/…) are mostly **parameter presets** on these shapes — they
> survive as Triage *labels*, not as separate pipeline definitions.
>
> **Honest limit:** the simulation synthesis returned `guaranteed=False` — this model is far
> better grounded than the legacy 16 or the earlier "5 shapes", but it is not a proof of
> exhaustive coverage. Two shapes (E incident, F greenfield) are borderline (composite /
> parameter-like).

## The 7 shapes

### A — Code change (dev-time) ✅ solid
`Triage → Ground → Investigate → Decide → (Spec?) → (Test?) → Implement → Verify(tests) → Reflect`
- **Distinct**: terminal = changed source, committed, verified by typecheck/tests/firebat.
- **Covers**: new feature · reproducible bugfix · refactor · performance tuning · code/API
  migration · adding test coverage · config/chore code edits · SDK/library integration ·
  CVE security *code* patch.
- **Params**: Decide mode (Record|Plan|Design) · Spec on/off · Test on/off · `terminal_step`
  (Implement|Test) · Ground profile (perf_baseline|dependency_audit|observability) · depth ·
  `emergency` (P0: minimal Investigate, Implement-before-Test, retroactive test).
- **Legacy labels collapsed here**: feature, bugfix, bugfix-p0, bugfix-unreproducible,
  refactor, performance, migration(code), test, chore.

### B — Deliverable / document (no code) ✅ solid
`Triage → Ground → Investigate → Decide → Report → Verify(completeness) → Reflect`
- **Distinct**: terminal = a document/decision; zero source change.
- **Covers**: feasibility study · build-vs-buy · architecture/API design · PR review ·
  security/threat-model review · postmortem/retro · codebase exploration/learning · ADR
  **including durable rejected-decision records** · deprecation PLAN · secret-rotation
  runbook · capacity/scaling PLAN · monitoring/SLO design.
- **Params**: Decide mode (Plan|Design) · `report_type` · Ground profile · depth ·
  output-content (`rollback_criteria`, `phased_sequencing/gates`) — the last two were the
  parameters the simulation caught the model missing.
- **Legacy labels**: plan-standalone, review, retro, exploration.

### C — Spike (throwaway prototype) ✅ solid
`… → Implement(prototype) → Report(GO/NO-GO/CONDITIONAL verdict)`
- **Distinct**: `code_disposition = discard` — the code is intentionally thrown away; terminal
  is a verdict doc, not shipped code.
- **Covers**: feasibility prototype · proof-of-concept · "can lib X do Y" · risk-reduction
  experiment before committing to a plan.
- **Legacy labels**: spike.

### D — Operational / state-change 🆕 (NEW — legacy had nothing)
`Triage → Ground(live state) → Investigate → Decide → Implement(sequenced ops action) → Verify(live observability) → Reflect`
- **Distinct**: Implement = executing a **sequenced infra/config/ops action** — often **zero
  source diff, zero unit tests**. Verify = **live metrics/thresholds**, sometimes
  **NEGATIVE-assert** (prove the OLD state is gone). Frequently irreversible → carries a
  rollback plan + abort criteria.
- **Covers**: deploy a release · **roll back** a bad deploy · scale/capacity change
  (replicas/autoscaler/pool) under a cost constraint · **secret/credential rotation** across
  N environments · feature-flag flip · **data migration / data-repair backfill** on live
  tables (backup → dry-run-on-copy → idempotent batched apply) · DNS/cert/infra change.
- **Params**: `reversibility` · `verify_mode` (positive|negative-assert|soak) ·
  `backup_required` · `env_fanout` (N environments).
- **Legacy labels**: none — release(deploy) and migration(data) were misfiled under code flows.

### E — Incident response 🆕 (NEW; most composite)
`mitigate-first  ‖  CONCURRENT comms Report (live timeline)  →  mandatory spawned: postmortem(B) + permanent-fix(A)`
- **Distinct**: the only shape with a **concurrent** (not sequential) Report channel — live
  incident comms/status running *alongside* mitigation. Mitigate-first (rollback/restart
  before diagnosis). Mandatory auto-spawned follow-ups.
- **Covers**: production-down P0 · 3am outage · SLO-burn alert response · active security
  breach response.
- **Note**: borderline — = mitigation (D or A) + concurrent comms + spawned postmortem +
  permanent fix. Could be modeled as a compound preset rather than a primitive shape.

### F — Greenfield / bootstrap 🟠 (borderline)
`Ground(bootstrap — no baseline) → Decide(Design: stack/arch) → Spec → Implement → Verify(ESTABLISH baseline) → Reflect`
- **Distinct**: **inverts** Ground (no volatile profile exists yet — it gets *created*) and
  Verify (establishes a baseline rather than comparing to one). Empty-repo precondition.
- **Covers**: new project init · scaffolding a new service/package · bootstrapping the
  build/test harness itself.
- **Note**: borderline — may be a "bootstrap parameter" on A/C rather than a full shape;
  earns shapehood only via the Ground/Verify inversion.

### G — Compound / orchestration ✅ solid
`Decide(Design) → sub_flow_sequence + gate_rules → orchestrate sub-flows of ANY shape`
- **Distinct**: meta — bundles other shapes with gates. `execution_mode` = plan-only (emit
  the orchestration design as a doc) **or** execute.
- **Covers**: multi-phase epics · multi-repo changes · **deprecation lifecycle** (announce
  now → time/metric-gated removal later = suspended-until-condition) · anything needing
  several flows sequenced with gates.
- **Legacy labels**: compound.

## Cross-cutting parameters (NOT shapes — apply across shapes)

These were the recurring axes the simulation confirmed; the legacy "flows" were largely just
points in this parameter space:

- `emergency / urgency` (P0) — applies to A, D, E (NOT bugfix-only as legacy assumed)
- Decide mode: Record | Plan | Design
- optional Spec · optional Test
- Ground volatile profile: perf_baseline | dependency_audit | observability | secret_inventory | incident_telemetry | bootstrap
- depth: shallow | deep
- `verify_mode`: tests | live-observe | negative-assert | soak | baseline-establish
- `code_disposition`: keep | discard  (distinguishes A from C)
- `reversibility` + `rollback_criteria` (D, E)
- `followup_flows` emission — a **universal** output channel (legacy documented it for Review
  only; spike/exploration/incident/operational all legitimately queue downstream flows)

## Consequence for the STEP contracts (must follow)

Shape D/E break two step definitions that were written **dev-time-only**:
- **Implement** is defined as "write code to GREEN." Shape D's Implement is "execute a
  sequenced infra/config/ops action (possibly zero source diff)." → Implement's contract must
  generalize its terminal from *code+commit* to *applied state change* (code OR ops action),
  with the ops branch carrying the rollback/abort + env-fanout.
- **Verify** is defined as "typecheck + tests + firebat=0." Shape D/E's Verify is "live
  observability within thresholds / negative-assert / soak." → Verify's mechanical pass must
  add a `verify_mode` branch beyond the tests-only mechanical pass.

This is the real reason the legacy harness "missed operations": its Implement/Verify *step*
definitions assume a code terminal. Fixing the flow model is incomplete without extending
those two steps.

## Legacy 16 → this model (nothing lost; labels become presets)

| legacy label | becomes |
|---|---|
| feature / bugfix / refactor / chore / test / performance / migration(code) | **A** + preset |
| bugfix-p0 | **A** + `emergency` (mitigation half may be **D/E**) |
| bugfix-unreproducible | **A** + `observability` profile |
| release | **D** (deploy) — was misfiled as code |
| plan-standalone / review / retro / exploration | **B** + `report_type` |
| spike | **C** |
| compound | **G** |
| greenfield (proposed) | **F** |
| — (uncovered) | **D** ops, **E** incident — newly added |
