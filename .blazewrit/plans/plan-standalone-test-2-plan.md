---
flow_id: plan-standalone-test-2
flow_type: plan-standalone
channel: user_session
schema_version: 1
artifact_kind: plan-standalone-terminal
mode: design
ground_ref: .blazewrit/grounds/plan-standalone-test-2.md
investigate_ref: .blazewrit/investigations/plan-standalone-test-2.md
decide_ref: .blazewrit/plans/plan-standalone-test-2-decide.md
provenance_basis: per-file sha256 in ground.verification_proof.read_files
emberdeck_status: absent
---

# Plan — plan-standalone-test-2

## Summary

The Decide(Design) step selected **Option C — a diagram-anchored portal doc with deep-links to canonical sources** for the request *"Document the 9-step workflow architecture used in this blazewrit repo."* The plan synthesizes that design into an actionable artifact specification: a single new document at `docs/WORKFLOW_ARCHITECTURE.md` (~250–400 lines) whose role is *integrative* (state-machine diagram, agent matrix, flow catalog index, taxonomy reconciliation, provenance footer) rather than reproductive. The portal cites and links the existing god node `WORKFLOW_PLAN.md` and the 9 per-step `steps/<name>/README.md` files instead of duplicating them, which keeps divergence risk low and concentrates Investigate's ten risk-surface items (RS-1…RS-10) into the smallest set of explicit disclosure callouts. The next step explicitly named: **Spec (steps/spec)**, which finalizes the artifact path decision (`docs/WORKFLOW_ARCHITECTURE.md` vs sibling-of-`WORKFLOW_PLAN.md`) and binds the 14 acceptance requirements into a writable spec.

## Design Document

### Chosen option

**Option C — diagram-anchored portal doc with deep-links to canonical sources.**

Rationale: Option C is the only deliberated option that satisfies Investigate `constraints.policy[0]` (consistency-with-or-surface-divergence-from `WORKFLOW_PLAN.md`) without duplicating its 1027 lines. Options A (single consolidated narrative) and B (layered doc set under `docs/workflow/`) both re-render canonical content and therefore amplify RS-1/RS-4/RS-6/RS-7 by creating a second source of truth that may drift.

### Artifact

- **path**: `docs/WORKFLOW_ARCHITECTURE.md` (single file; final path arbitration between `docs/WORKFLOW_ARCHITECTURE.md` and a sibling next to `WORKFLOW_PLAN.md` deferred to Spec per REQ-1)
- **target length**: 250–400 lines
- **format**: Markdown with Mermaid (or equivalent ASCII) state-machine diagram

### Structure (top-to-bottom)

1. **Frontmatter** — `provenance_basis` citing `ground.verification_proof.read_files`; explicit `emberdeck_status: absent` line at the head.
2. **§1 Hero diagram** — State-machine: `Triage → Ground → Investigate → Decide → Spec → Test → Implement → Report → Verify → Reflect`. Compound/failure-routing edges link out to `steps/decide/compound-recursion.md` and `steps/decide/failure-routing.md`. Triage rendered as a *classifier* shape distinct from step shapes (parallelogram `[/Triage/]`); the 9 steps as rounded rectangles; produce/review loop as a self-loop on each step except Verify and Reflect.
3. **§2 Step Pool (9 + 1 classifier)** — 10-row table: 1 classifier row (Triage) + 9 step rows (Ground … Reflect). Columns: name, one-line responsibility (verbatim from `steps/<name>/README.md` first responsibility line), canonical spec link. Standing callout immediately under the table reconciles `WORKFLOW_PLAN.md:31` ("Step Pool (9)") with the filesystem 10-directory enumeration (RS-1 resolution).
4. **§3 Agent Matrix (16 = 9 producer + 7 reviewer)** — table keyed by step, columns *producer agent* / *reviewer agent*; `Verify` and `Reflect` reviewer cells show `—`, with inline note citing `AGENTS.md:10` verbatim (RS-2 resolution). Matrix cell count = 16, matching `.claude/agents/` exactly.
5. **§4 Flow Catalog (16 definitions)** — index table listing all 16 entries from `.blazewrit/flows/` (`bugfix-p0`, `bugfix-unreproducible`, `bugfix`, `chore`, `compound`, `exploration`, `feature`, `migration`, `performance`, `plan-standalone`, `refactor`, `release`, `retro`, `review`, `spike`, `test`), each row linking to its definition file and to `flows/README.md` for the universal verification profile binding (RS-5 resolution).
6. **§5 Sub-policy nodes** — links-only subsection enumerating: Decide → `compound-recursion.md`, `failure-routing.md`; Investigate → `compatibility-verdict.md`, `external-research.md`, `unknown-disposition.md`. No inline summary (avoids drift). (RS-6, RS-7 resolution.)
7. **§6 Execution Model** — one paragraph naming `src/orchestrator.ts` and `.blazewrit/orchestrator.ts` as the runtime referent. One line states the sha256 byte-identity `cf9f06ce2a18df3f00c2ab7d10e7f28fa110162fea0379c6058567f9399c0882` at the captured head; one line names the install-mechanism provenance as undetermined per `ground.unknowns[orchestrator_installed_provenance]` (RS-3 resolution). Link to `EXECUTION_PLAN.md` for state-machine detail.
8. **§7 Provenance footer** — three sub-blocks:
   - `emberdeck_status: absent` with the consequence sentence: link-and-edge claims rest on filesystem sha256 + mtime, not on ED-graph traversal (RS-4 resolution).
   - sha256/mtime citation block reusing the 17 rows from `ground.verification_proof.read_files`.
   - Volatile-state disclosure: typecheck=success; tests=`skipped-with-reason`; lint=`skipped-with-reason` (no `test` / `lint` script in `package.json`); git head `778eca4db6f980c1396309449631db18d968b571`; `.blazewrit/.step-status` is **not** a live indicator for this flow (RS-8, RS-10 resolution).

### Policies

| id | policy | maps_to_risk |
|---|---|---|
| P1 | Cite-by-link to canonical sources; no inline re-rendering of `WORKFLOW_PLAN.md` or `steps/*/README.md` beyond a single one-line responsibility extract per step. | RS-1, RS-4 |
| P2 | Triage's status as *classifier* (not step) must appear in §2 inline callout citing `WORKFLOW_PLAN.md:21` + `AGENTS.md:9`. | RS-1 |
| P3 | §3 must state "16 agents = 9 producer + 7 reviewer; Verify and Reflect have no reviewer" verbatim and show `—` in the matrix. | RS-2 |
| P4 | §6 must state the orchestrator sha256 byte-identity and the install-mechanism unknown. Doc must not assert authority over the install mechanism. | RS-3 |
| P5 | §7 must lead with `emberdeck_status: absent` and the substitution-basis sentence. No ED-derived edge claim is permitted in any section. | RS-4 |
| P6 | §4 must list all 16 flow definitions; partial enumeration is not allowed. | RS-5 |
| P7 | §5 must link to all 5 sub-policy nodes (2 under Decide + 3 under Investigate). | RS-6, RS-7 |
| P8 | §7 must disclose that `tests` and `lint` are `skipped-with-reason`, not green. | RS-10 |
| P9 | Doc must not cite `CHANGELOG.md` for historical claims without an explicit re-stat in the same flow. | RS-9 |
| P10 | Doc must not cite `.blazewrit/.step-status` as live state. | RS-8 |

### Requirements (acceptance signals)

| id | requirement | acceptance signal |
|---|---|---|
| REQ-1 | Single artifact at `docs/WORKFLOW_ARCHITECTURE.md` (or, if `docs/` does not exist at write-time, a sibling path next to `WORKFLOW_PLAN.md` chosen by Spec). | File exists at one canonical path. |
| REQ-2 | §2 lists exactly 10 rows: 1 Triage classifier + 9 steps named `Ground, Investigate, Decide, Spec, Test, Implement, Report, Verify, Reflect`. | Row count = 10; step-name set matches the AGENTS.md:9 sequence. |
| REQ-3 | §2 standing callout cites `WORKFLOW_PLAN.md:21` and `AGENTS.md:9` for the triage-as-classifier reconciliation. | Both citations present. |
| REQ-4 | §3 agent matrix shows `Verify` and `Reflect` reviewer cells as `—`; total agent-cell count = 16. | Cell count and dash placement match. |
| REQ-5 | §4 flow catalog enumerates all 16 entries from `.blazewrit/flows/`. | 16 rows; names match Ground neighbor `flow_defs_dir` list. |
| REQ-6 | §5 links to 5 sub-policy files: `steps/decide/compound-recursion.md`, `steps/decide/failure-routing.md`, `steps/investigate/compatibility-verdict.md`, `steps/investigate/external-research.md`, `steps/investigate/unknown-disposition.md`. | 5 distinct links; all paths exist per Ground neighbors. |
| REQ-7 | §6 states the sha256 byte-identity `cf9f06ce2a18df3f00c2ab7d10e7f28fa110162fea0379c6058567f9399c0882` between `src/orchestrator.ts` and `.blazewrit/orchestrator.ts` and the install-provenance unknown. | Both sentences present. |
| REQ-8 | §7 emits `emberdeck_status: absent` and the substitute-provenance sentence; no claim references an ED snapshot id. | String present; ED-id grep finds zero hits. |
| REQ-9 | §7 sha256/mtime block lists at least the 17 paths from `ground.verification_proof.read_files`. | Path count ≥ 17; hashes match. |
| REQ-10 | §7 explicitly states `tests=skipped-with-reason`, `lint=skipped-with-reason`. | Both strings present. |
| REQ-11 | Doc contains zero `CHANGELOG.md` citations OR contains a re-stat block dated within this flow's capture window. | Grep audit. |
| REQ-12 | Doc contains zero references to `.blazewrit/.step-status` as live state. | Grep audit. |
| REQ-13 | All internal links resolve to paths enumerated in `ground.verification_proof.read_files` or in `.blazewrit/flows/`. No fabricated paths. | Link-check passes. |
| REQ-14 | No `intent_card_id`, no ED snapshot id, no placeholder string of the form `PENDING-*`, `TBD`, `not_tracked`, `unavailable` anywhere in the doc. | Grep audit returns zero hits. |

### User flows

| id | persona | entry | path | exit |
|---|---|---|---|---|
| UF1 | New contributor — step pool understanding | §1 hero diagram | step node → `steps/<name>/README.md` | reads canonical per-step spec |
| UF2 | Reader — flow-to-step mapping | §4 flow catalog | flow row → `.blazewrit/flows/<flow>.md` | reads flow definition + universal profile binding via `flows/README.md` |
| UF3 | Reader — Compound/failure-routing semantics | §1 hero diagram edge or §5 sub-policy index | link to `steps/decide/compound-recursion.md` or `failure-routing.md` | reads sub-policy in canonical location |
| UF4 | Reviewer/auditor — provenance | §7 footer | sha256/mtime block + ED-absent disclosure | accepts substitute provenance or re-verifies via `sha256sum` |
| UF5 | Reader — execution-model detail | §6 paragraph | link to `EXECUTION_PLAN.md` and/or `src/orchestrator.ts` | reads runtime contract |
| UF6 | Reader — taxonomy reconciliation (9 vs 10) | §2 table + standing callout | reads inline citation of `WORKFLOW_PLAN.md:21` + `AGENTS.md:9` | leaves with reconciled mental model |

### Gate rules (synthesized from Decide)

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

The `verify.*` JsonLogic vars are intended bindings for the Verify step's grep/link-check output; concrete shape is Spec's responsibility.

## Risk Coverage Map

Every risk-surface item from Investigate is bound to at least one design policy and at least one acceptance requirement.

| risk | policies | requirements |
|---|---|---|
| RS-1 (triage 9-vs-10 reconciliation) | P1, P2 | REQ-2, REQ-3 |
| RS-2 (reviewer asymmetry) | P3 | REQ-4 |
| RS-3 (orchestrator byte-identity) | P4 | REQ-7 |
| RS-4 (ED-absent provenance disclosure) | P1, P5 | REQ-8, REQ-9, REQ-14 |
| RS-5 (16 flow definitions) | P6 | REQ-5 |
| RS-6 (Decide sub-policies) | P7 | REQ-6 |
| RS-7 (Investigate sub-policies) | P7 | REQ-6 |
| RS-8 (.step-status not live) | P10 | REQ-12 |
| RS-9 (CHANGELOG freshness) | P9 | REQ-11 |
| RS-10 (tests/lint skipped-with-reason) | P8 | REQ-10 |

## Source Pedigree

- **Decide(Design)**: `.blazewrit/plans/plan-standalone-test-2-decide.md` (chosen option: C; mode: design; based_on chain: investigate_ref + ground_ref)
- **Investigate**: `.blazewrit/investigations/plan-standalone-test-2.md` (compatibility_verdict: proceed; affected_files_count: 4; has_architecture_level: false; 10 risk-surface items RS-1…RS-10)
- **Ground**: `.blazewrit/grounds/plan-standalone-test-2.md` (entry_nodes: 4; neighbors: 21; god_nodes: `WORKFLOW_PLAN.md`, `src/orchestrator.ts`; corpus ≈2826 lines verified by per-file sha256)
- **Provenance basis**: per-file sha256 in `ground.verification_proof.read_files` (17 paths). The `ed_snapshot_version`, `intent_card_id`, `rules_version`, and `contracts_version` fields are omitted per R12 degrade policy + R13 placeholder ban (emberdeck and rules/contracts versioning surfaces absent from the captured Ground session).

## Volatile-State Disclosure

- typecheck: success (`tsc --noEmit` exit 0 at capture)
- tests: skipped-with-reason — no `test` script in `package.json`; zero `*.test.ts`/`*.spec.ts` under `src/`
- lint: skipped-with-reason — no `lint` script in `package.json`; no root-level eslint/biome/prettier config
- git: head `778eca4db6f980c1396309449631db18d968b571`, branch `main`, racing_changes=false
- `.blazewrit/.step-status`: stale for this flow — points at `plan-standalone-test-1`; not a live indicator for `plan-standalone-test-2`

## Next Step

**Spec — `steps/spec`.**

Inputs to Spec:
- This plan artifact (`.blazewrit/plans/plan-standalone-test-2-plan.md`)
- The 14 acceptance requirements (REQ-1 … REQ-14) above
- The 10 design policies (P1 … P10) above
- The chosen artifact path (`docs/WORKFLOW_ARCHITECTURE.md`, with sibling-of-`WORKFLOW_PLAN.md` as the fallback) — Spec to finalize after verifying `docs/` existence

Spec's mandate:
1. Bind REQ-1 by selecting one canonical path (verify `docs/` directory existence; if absent, select sibling path adjacent to `WORKFLOW_PLAN.md`).
2. Translate the §1–§7 structure into a section-level writing spec (headings, table columns, link targets) consumable by Report (the doc author).
3. Encode the gate-rules `verify.*` JsonLogic var bindings into concrete grep/link-check probe definitions so Verify can mechanize them.

Downstream chain after Spec (per `flows/README.md:82–88` — plan-standalone): Report → Verify → Reflect. Implement and Test are not part of the plan-standalone chain.

STATUS: DONE
ARTIFACT: .blazewrit/plans/plan-standalone-test-2-plan.md
