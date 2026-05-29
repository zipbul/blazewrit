# Investigation — chore-test-1

flow_id: chore-test-1
flow_type: chore
depth: shallow

## impact_map

primary_areas:
- `package.json` scripts block — adding two keys (`test`, `lint`) where both are currently absent

ripple:
- none discovered. `package.json` scripts are consumed by humans / CI; no in-repo file imports or references `npm test`/`npm run lint` (Ground reports no eslint/biome config, no `*.test.*` files under `src/`, AGENTS.md has 0 matches for `test|lint`).
- `tsconfig.json`: consumed only if a future `lint` script aliases `tsc --noEmit`; static relationship, no edit required.

external_surface:
- npm script contract: keys `scripts.test` and `scripts.lint` become invocable via `npm test` / `npm run lint`. Breaking: false (additive only; both keys currently absent per Ground `absent_keys`).

affected_files:
- `package.json`

affected_files_count: 1

architecture_impact:
- new_modules: []
- public_api_changes: []

## constraints

- Repo declares no test runner and no linter in devDependencies (Ground verified). Any script body referencing an uninstalled binary will fail at invocation time.
- Only verified static-analysis tool present: `tsc` (typescript ^5.7.0 in devDependencies; `npx tsc --noEmit` succeeds per Ground volatile_state).
- AGENTS.md (root) is silent on test/lint policy — no project-level mandate to pick a specific runner/linter.
- flow_type=chore → shallow depth; no architecture redesign in scope.

## risk_surface

- id: R1
  failure_mode: Script body references a tool family (jest/vitest/eslint/biome) that is not in devDependencies → `npm test` / `npm run lint` fails immediately on fresh clone.
  severity: medium
  probability: high-if-runner-chosen-without-install
  evidence: Ground `absent dependency families` — no runner, no linter declared.

- id: R2
  failure_mode: Placeholder script (e.g. `echo "no tests"` exiting 0) masks the absence of real coverage, giving false CI signal.
  severity: low
  probability: medium
  evidence: Ground reports 0 `.test.*` files under `src/`; any non-failing placeholder claims success vacuously.

- id: R3
  failure_mode: `lint` aliased to `tsc --noEmit` conflates typecheck with lint; future addition of a real linter would require renaming or contract change.
  severity: low
  probability: medium
  evidence: `tsc` is the only verified static checker; Ground typecheck status = success.

- id: R4 (omission risk)
  failure_mode: Chore proceeds without resolving runner/linter unknowns → script body becomes arbitrary, divorced from any project standard.
  severity: medium
  probability: high
  evidence: Ground `unknowns` lists runner choice, linter choice, placeholder-vs-real intent — all unspecified by request and absent from AGENTS.md.

## validity_check

- Ground fact: `package.json` scripts block = `{ "build": "tsc", "prepublishOnly": "tsc" }`; `absent_keys: ["test", "lint"]`.
- Triage intent target: add `test` and `lint` scripts.
- Alignment: target keys are genuinely absent → task is non-no-op at the key-presence level.
- Caveat: request specifies *which keys* to add but not *what they should run*. The factual gap (which tool) is real and unresolved in Ground.

## compatibility_verdict

- result: needs_clarification
- rationale: Two of three Ground `unknowns` (runner choice, linter choice) directly determine the script body that this chore must write. Without resolution, any script value is invention. Architecture/contract layer is clean (additive, no breakage), so the block is purely at the content-of-script level.
- source_version:
  - rules_version: (omitted — not tracked in repo)
  - contracts_version: (omitted — not tracked in repo)
  - (ed_snapshot_version omitted per Ground R12 degrade — emberdeck absent)

## unknown_disposition

- unknown: Test runner choice (vitest / node:test / jest)
  disposition: must_resolve_before_decide
  rationale: directly determines `scripts.test` body; no project default exists to fall back on.

- unknown: Linter choice (eslint / biome / oxlint / tsc-only)
  disposition: must_resolve_before_decide
  rationale: directly determines `scripts.lint` body; no config file in repo to infer from.

- unknown: Whether `test` should be real runner vs placeholder (`node --test`)
  disposition: must_resolve_before_decide
  rationale: governs whether failure-on-missing-tests is desired CI behavior or not.

- unknown: Whether `lint` should alias `tsc --noEmit` or invoke a not-yet-installed linter
  disposition: must_resolve_before_decide
  rationale: determines whether chore is package.json-only or also requires devDependency addition.

- unknown: Source of "discovered during plan-standalone-test runs" claim (`.blazewrit/flow-history/plan-standalone-test-2.json`)
  disposition: defer_to_runtime
  rationale: provenance trivia; does not affect script content. Inspecting is out-of-bounds for shallow chore depth.

- unknown: ED snapshot version (emberdeck binary absent)
  disposition: accept_as_unknown
  rationale: tooling unavailable on host (R12 degrade); does not gate chore correctness — no ED traversal needed for a single-file additive script change.

STATUS: DONE
ARTIFACT: .blazewrit/investigations/chore-test-1.md
