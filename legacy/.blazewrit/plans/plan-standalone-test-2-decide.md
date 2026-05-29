---
flow_id: plan-standalone-test-2
flow_type: plan-standalone
channel: user_session
captured_at: 2026-05-17T02:25:43+09:00
schema_version: 1
mode: design
ground_ref: .blazewrit/grounds/plan-standalone-test-2.md
investigate_ref: .blazewrit/investigations/plan-standalone-test-2.md
provenance_basis: per-file sha256 in ground.verification_proof.read_files (emberdeck absent — see ground.unknowns[ed_query])
emberdeck_status: absent (intent_card_id field omitted per R12 degrade policy + R13 placeholder ban)
---

# Decide (Design) — plan-standalone-test-2

Triage intent (verbatim): *Document the 9-step workflow architecture used in this blazewrit repo (see WORKFLOW_PLAN.md, steps/ directory).*

Mode = `design` (orchestrator-supplied per R6 + Mode hierarchy: declared=design wins; affected_files_count=4 < 5 → no Plan force; has_architecture_level=false → no Design force from R6; declared_default for plan-standalone is `design`).

---

## options_deliberated

### Option A — Single consolidated `WORKFLOW_ARCHITECTURE.md`
- approach: one long narrative file that renders the full 9-step taxonomy, agent matrix, flow catalog, and execution-model summary inline (self-contained, ~600–900 lines).
- trade_offs:
  - (+) one-stop read; no link-chasing.
  - (−) duplicates content already present in `WORKFLOW_PLAN.md` (god node, 1027 lines) and the 9 per-step READMEs; high divergence risk (RS-1, RS-4 amplified).
  - (−) violates Investigate `constraints.policy[0]` ("any workflow description must be consistent with [WORKFLOW_PLAN.md] or surface its divergences") by re-stating rather than citing.
- est_effort: large.

### Option B — Layered doc set under `docs/workflow/`
- approach: `docs/workflow/overview.md` + 9 per-step appendices + `docs/workflow/flows.md` + `docs/workflow/agents.md`. Each appendix mirrors a `steps/<name>/README.md` with prose embellishment.
- trade_offs:
  - (+) granular; readers can deep-link to a single step page.
  - (−) introduces a *second* per-step surface that drifts from the canonical `steps/*/README.md`; multiplies RS-1/RS-6/RS-7 (compound-recursion, failure-routing, compatibility-verdict sub-policies must be re-surfaced in two places).
  - (−) doubles the maintenance contract without adding new edges.
- est_effort: large.

### Option C — Diagram-anchored portal doc with deep-links to canonical sources *(chosen)*
- approach: one slim artifact (target ~250–400 lines) anchored by a state-machine diagram of the 9 steps + Triage classifier. The doc renders only the *integrative* content (diagram, agent matrix, flow catalog index, taxonomy reconciliation, provenance footer). Per-step semantics, sub-policies, and execution-model detail are linked, not duplicated.
- trade_offs:
  - (+) zero duplication of `WORKFLOW_PLAN.md` content → low divergence risk.
  - (+) every reconciliation surfaced by Investigate (RS-1 triage status, RS-2 reviewer asymmetry, RS-3 orchestrator byte-identity, RS-4 ED-absent provenance, RS-5 flow layer, RS-6/RS-7 sub-policy nodes) lands in a single dedicated section.
  - (−) requires readers to follow links for per-step depth; portal must keep link integrity (mitigated by R10 link-check gate below).
- est_effort: medium.

## chosen

option_id: **C**

rationale: Option C is the only option that satisfies Investigate `constraints.policy[0]` (consistency-with-or-surface-divergence-from `WORKFLOW_PLAN.md`) without duplicating its 1027 lines, and it concentrates Investigate's ten risk-surface items into the smallest set of explicit disclosure callouts. Options A and B both re-render canonical content and therefore amplify RS-1/RS-4/RS-6/RS-7 by creating a second source of truth that may drift.

---

## chosen_architecture

artifact_path: `docs/WORKFLOW_ARCHITECTURE.md` (single file; new path under existing `docs/`-style convention if present, else repo root sibling to `WORKFLOW_PLAN.md`).

structure (top-to-bottom):

1. **Frontmatter** — flow_id (n/a for doc), `provenance_basis` citing `ground.verification_proof.read_files`, explicit `emberdeck_status: absent` line so the ED-unavailable posture is visible at the head.
2. **§1 Hero diagram** — Mermaid (or equivalent ASCII) state-machine: nodes = `Triage → Ground → Investigate → Decide → Spec → Test → Implement → Report → Verify → Reflect`; edges include Compound/failure-routing arrows that link out to `steps/decide/compound-recursion.md` and `steps/decide/failure-routing.md`. Triage rendered as a *classifier* shape distinct from step shapes.
3. **§2 Step Pool (9 + 1 classifier)** — a 10-row table: 1 classifier row (Triage) + 9 step rows (Ground … Reflect). Columns: name, one-line responsibility (verbatim from `steps/<name>/README.md` first responsibility line), canonical spec link. A standing callout immediately under the table reconciles `WORKFLOW_PLAN.md:31` ("Step Pool (9)") with the filesystem 10-directory enumeration (RS-1 resolution).
4. **§3 Agent Matrix (16 = 9 producer + 7 reviewer)** — table keyed by step, with two columns *producer agent* and *reviewer agent*; `Verify` and `Reflect` rows show `—` in the reviewer column, with an inline note citing `AGENTS.md:10` verbatim (RS-2 resolution). The matrix lists 16 cell entries to match `.claude/agents/` count exactly.
5. **§4 Flow Catalog (16 definitions)** — index table listing all 16 entries from `.blazewrit/flows/` (`bugfix-p0`, `bugfix-unreproducible`, `bugfix`, `chore`, `compound`, `exploration`, `feature`, `migration`, `performance`, `plan-standalone`, `refactor`, `release`, `retro`, `review`, `spike`, `test`), each row linking to its definition file and to `flows/README.md` for the universal verification profile binding (RS-5 resolution).
6. **§5 Sub-policy nodes** — short subsection enumerating: Decide → `compound-recursion.md`, `failure-routing.md`; Investigate → `compatibility-verdict.md`, `external-research.md`, `unknown-disposition.md`. Links only; no inline summary (avoids drift). (RS-6, RS-7 resolution.)
7. **§6 Execution Model** — one paragraph identifying `src/orchestrator.ts` and `.blazewrit/orchestrator.ts` as the runtime referent; a line states the sha256 byte-identity at the captured head and notes that the install-mechanism provenance is undetermined per `ground.unknowns[orchestrator_installed_provenance]` (RS-3 resolution). Links to `EXECUTION_PLAN.md` for state-machine detail.
8. **§7 Provenance footer** — three sub-blocks:
   - `emberdeck_status: absent` with the consequence statement: link-and-edge claims rest on filesystem sha256 + mtime, not on ED-graph traversal (RS-4 resolution).
   - sha256/mtime citation block reusing the 17 rows from `ground.verification_proof.read_files`.
   - Volatile-state disclosure: typecheck=success; tests and lint = `skipped-with-reason` (no `test` / `lint` script in `package.json`); git head `778eca4…b571`; `.blazewrit/.step-status` is **not** a live indicator for this flow (RS-8, RS-10 resolution).

Mermaid styling: Triage drawn as `[/Triage/]` (parallelogram, stateless classifier); the 9 steps drawn as rounded rectangles; the produce/review loop drawn as a self-loop on each step except Verify and Reflect.

Boundary note (R15 compliance): this `chosen_architecture` block specifies *the artifact's structure*; it does not re-derive facts. Every fact-bearing row in the resulting doc cites Ground or links to a sha256-verified path enumerated by Ground.

---

## policies

| id | policy | enforces | maps_to_risk |
|---|---|---|---|
| P1 | Cite-by-link to canonical sources; no inline re-rendering of `WORKFLOW_PLAN.md` or `steps/*/README.md` content beyond a single one-line responsibility extract per step. | Investigate constraints.policy[0]; consistency-or-divergence rule. | RS-1, RS-4 |
| P2 | Triage's status as *classifier* (not step) must appear in §2 inline callout citing `WORKFLOW_PLAN.md:21` + `AGENTS.md:9`. | Investigate ground_unknowns_addressed[step_pool_directory_count]=resolved. | RS-1 |
| P3 | §3 must state "16 agents = 9 producer + 7 reviewer; Verify and Reflect have no reviewer" verbatim and show `—` in the matrix. | AGENTS.md:10 verbatim binding. | RS-2 |
| P4 | §6 must state the orchestrator sha256 byte-identity and the install-mechanism unknown. Doc must not assert authority over the install mechanism. | Investigate constraints.contracts[0]; ground.unknowns[orchestrator_installed_provenance]. | RS-3 |
| P5 | §7 must lead with `emberdeck_status: absent` and the substitution-basis sentence. No ED-derived edge claim is permitted in any section. | R13 placeholder ban; Investigate compatibility_verdict.source_version (field omitted). | RS-4 |
| P6 | §4 must list all 16 flow definitions; partial enumeration is not allowed. | Investigate constraints.contracts[1] (hard count). | RS-5 |
| P7 | §5 must link to all 5 sub-policy nodes (2 under Decide + 3 under Investigate). | Investigate impact_map[step pool spec] + risk_surface RS-6/RS-7. | RS-6, RS-7 |
| P8 | §7 must disclose that `tests` and `lint` are `skipped-with-reason`, not green. | Ground volatile_state rows. | RS-10 |
| P9 | Doc must not cite `CHANGELOG.md` for historical claims without an explicit re-stat in the same flow. | ground.unknowns[changelog_freshness]=verified:false. | RS-9 |
| P10 | Doc must not cite `.blazewrit/.step-status` as live state. | Ground conflicts row 3. | RS-8 |

---

## user_flows

| id | persona | entry | path | exit |
|---|---|---|---|---|
| UF1 | New contributor wants to understand the step pool | §1 hero diagram | clicks a step node → arrives at `steps/<name>/README.md` | reads canonical per-step spec |
| UF2 | Reader wants to know which flow uses what | §4 flow catalog | clicks a flow row → arrives at `.blazewrit/flows/<flow>.md` | reads flow definition + universal profile binding via `flows/README.md` |
| UF3 | Reader wants state-transition / Compound semantics | §1 hero diagram (Compound edge) or §5 sub-policy index | follows link to `steps/decide/compound-recursion.md` or `failure-routing.md` | reads sub-policy in canonical location |
| UF4 | Reviewer/auditor wants provenance | §7 footer | reads sha256/mtime block + ED-absent disclosure | accepts substitute provenance or re-verifies via `sha256sum` |
| UF5 | Reader wants execution-model detail | §6 paragraph | follows link to `EXECUTION_PLAN.md` and/or `src/orchestrator.ts` | reads runtime contract |
| UF6 | Reader wants taxonomy reconciliation (9 vs 10) | §2 table + standing callout | reads inline citation of `WORKFLOW_PLAN.md:21` + `AGENTS.md:9` | leaves with reconciled mental model |

---

## requirements

| id | requirement | source | acceptance signal |
|---|---|---|---|
| REQ-1 | Single artifact at `docs/WORKFLOW_ARCHITECTURE.md` (or, if `docs/` does not exist at write-time, a sibling path next to `WORKFLOW_PLAN.md` decided by Spec). | Option C choice. | File exists at one canonical path. |
| REQ-2 | §2 lists exactly 10 rows: 1 Triage classifier + 9 steps named `Ground, Investigate, Decide, Spec, Test, Implement, Report, Verify, Reflect`. | AGENTS.md:9 verbatim. | Row count = 10; step-name set matches the AGENTS.md:9 sequence. |
| REQ-3 | §2 standing callout cites `WORKFLOW_PLAN.md:21` and `AGENTS.md:9` for the triage-as-classifier reconciliation. | P2. | Both citations present. |
| REQ-4 | §3 agent matrix shows `Verify` and `Reflect` reviewer cells as `—`; total agent-cell count = 16. | P3. | Cell count and dash placement match. |
| REQ-5 | §4 flow catalog enumerates all 16 entries from `.blazewrit/flows/`. | P6. | 16 rows; names match Ground neighbor `flow_defs_dir` list. |
| REQ-6 | §5 links to 5 sub-policy files: `steps/decide/compound-recursion.md`, `steps/decide/failure-routing.md`, `steps/investigate/compatibility-verdict.md`, `steps/investigate/external-research.md`, `steps/investigate/unknown-disposition.md`. | P7. | 5 distinct links; all paths exist per Ground neighbors. |
| REQ-7 | §6 states the sha256 byte-identity `cf9f06ce2a18df3f00c2ab7d10e7f28fa110162fea0379c6058567f9399c0882` between `src/orchestrator.ts` and `.blazewrit/orchestrator.ts` and the install-provenance unknown. | P4. | Both sentences present. |
| REQ-8 | §7 emits `emberdeck_status: absent` and the substitute-provenance sentence; no claim references an ED snapshot id. | P5; R13. | String present; ED-id grep finds zero hits. |
| REQ-9 | §7 sha256/mtime block lists at least the 17 paths from `ground.verification_proof.read_files`. | P1, P5. | Path count ≥ 17; hashes match. |
| REQ-10 | §7 explicitly states `tests=skipped-with-reason`, `lint=skipped-with-reason`. | P8. | Both strings present. |
| REQ-11 | Doc contains zero `CHANGELOG.md` citations OR contains a re-stat block dated within this flow's capture window. | P9. | Grep audit. |
| REQ-12 | Doc contains zero references to `.blazewrit/.step-status` as live state. | P10. | Grep audit. |
| REQ-13 | All internal links in the doc resolve to paths enumerated in `ground.verification_proof.read_files` or in `.blazewrit/flows/` (the 16 flow defs). No fabricated paths. | P1, P6. | Link-check passes. |
| REQ-14 | No `intent_card_id`, no ED snapshot id, no placeholder string of the form `PENDING-*`, `TBD`, `not_tracked`, `unavailable` anywhere in the doc. | R13. | Grep audit on these tokens returns zero hits. |

---

## gate_rules

```yaml
- condition: { "==": [ { "var": "verify.linkcheck.failed" }, 0 ] }
  action: proceed
- condition: { ">": [ { "var": "verify.linkcheck.failed" }, 0 ] }
  action: retry
- condition: { "and": [
    { "==": [ { "var": "verify.grep.placeholders" }, 0 ] },
    { "==": [ { "var": "verify.grep.changelog_unverified" }, 0 ] },
    { "==": [ { "var": "verify.grep.step_status_as_live" }, 0 ] }
  ] }
  action: proceed
- condition: { "or": [
    { ">": [ { "var": "verify.grep.placeholders" }, 0 ] },
    { ">": [ { "var": "verify.grep.changelog_unverified" }, 0 ] },
    { ">": [ { "var": "verify.grep.step_status_as_live" }, 0 ] }
  ] }
  action: pivot
```

Note: the `verify.*` JsonLogic vars are intended bindings for the Verify step's grep/link-check output; their concrete shape is Spec's responsibility, not Decide's.

---

## based_on

- investigate_ref: `.blazewrit/investigations/plan-standalone-test-2.md`
- ground_ref: `.blazewrit/grounds/plan-standalone-test-2.md`
- compatibility_verdict: `proceed` (Investigate §compatibility_verdict)
- has_architecture_level: `false` (Investigate §architecture_impact) → no Design force from R6; declared_default `design` governs per orchestrator-supplied mode resolution.
- affected_files_count: 4 (< 5) → no Plan force from R6.
- emberdeck mcpServer: absent → `intent_card_id` field omitted per R12 degrade policy + R13 placeholder ban.

## followup_flows

(none — single doc artifact; downstream Spec → Test → Implement → Report → Verify → Reflect proceed in this flow.)
