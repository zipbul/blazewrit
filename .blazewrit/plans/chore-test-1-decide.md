---
flow_id: chore-test-1
flow_type: chore
mode: record
decision: Abort chore at Decide — Investigate compatibility_verdict=needs_clarification with 2 must_resolve_before_decide unknowns (test runner choice, linter choice) that govern the script bodies; selecting any value here would be invention barred by R13.
rationale: Ground verified `package.json` has no test runner / linter in devDependencies, AGENTS.md is silent on test/lint policy (0 matches), and no eslint/biome config exists at repo root. Investigate marked runner choice, linter choice, real-vs-placeholder, and tsc-alias-vs-real-linter all as must_resolve_before_decide. R6 mode triggers do NOT fire (affected_files_count=1, no architecture_level, risk_surface = medium/low only) → declared mode `record` holds. Record mode cannot legitimately emit a one-line decision selecting script bodies when Investigate has explicitly flagged that selection as unresolvable from current facts; the only honest record-level decision is to abort and request the missing input via a follow-up Plan flow once the user picks runner + linter.
based_on:
  investigate_ref: .blazewrit/investigations/chore-test-1.md
  ground_ref: .blazewrit/grounds/chore-test-1.md
followup_flows:
  - type: plan
    scope: Choose test runner (vitest | node:test | jest) and linter (eslint | biome | oxlint | tsc-only) for blazewrit repo; output decision drives a follow-up chore that edits `package.json` scripts (and devDependencies if a non-builtin tool is selected).
---

# Decide — chore-test-1 (record mode, abort with followup)

## Mode resolution (R6 mechanical)

| Trigger | Value | Fires? |
|---|---|---|
| declared_default (chore) | record | — |
| affected_files_count | 1 | no (low) |
| risk_surface highs | 0 (all medium/low) | no |
| has_architecture_level | false (new_modules=[], public_api_changes=[]) | no |

→ mode = **record** (no upgrade).

## Why abort instead of pick a value

Investigate `compatibility_verdict.result = needs_clarification` with `unknown_disposition` listing four `must_resolve_before_decide` entries that *directly determine the script bodies*. R13 forbids invented values; R15 confines Decide to interpretation of captured facts, not authoring of script content for which no fact exists.

Candidates considered and rejected (each would be invention, not decision):
- `test: "tsc --noEmit"` — re-uses build toolchain but conflates test with typecheck (Investigate R3 risk).
- `test: "node --test"` — Investigate R2: vacuously passes (0 `.test.*` files under `src/`), false CI signal.
- `lint: "tsc --noEmit"` — same R3 conflation; pre-empts future real linter contract.
- `lint: "eslint ."` / `"biome check ."` — Investigate R1: tool absent from devDependencies, immediate failure on fresh clone.

None of these are derivable from Ground without selecting among absent facts → all are invention.

## Not an `request_upstream_deepen` case

Deepening Ground would not surface the missing facts: Ground already exhausted in-repo provenance (package.json, AGENTS.md, src/, eslint/biome glob, .research/ exclusion). The unknowns live outside the repo (user intent / project policy), not at deeper depth in already-scanned sources.

## Not a `triage_mismatch` either

Request *is* a chore-shaped task (additive, single file, no architecture). The mismatch is at the *content* layer (which tool), not at the *flow type* layer. Reclassifying to plan would be premature without the user's runner/linter selection that the followup Plan flow is designed to capture.

## intent_card_id

(omitted — emberdeck binary absent on PATH per Ground freshness / R12 degrade; R13 forbids placeholder.)

STATUS: DONE
ARTIFACT: .blazewrit/plans/chore-test-1-decide.md
