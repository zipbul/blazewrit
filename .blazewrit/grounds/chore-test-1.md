# Ground — chore-test-1

flow_id: chore-test-1
flow_type: chore
channel: user_session

## task_subgraph

entry_nodes:
- path: `package.json`
  - verified: true
  - provenance: `Read package.json @ HEAD 1948632712c3fd4b9e2f1878eb349f43d053c0a0`
  - raw_scripts_block: `{ "build": "tsc", "prepublishOnly": "tsc" }`
  - absent_keys: ["test", "lint"]

neighbors:
- path: `tsconfig.json`
  - verified: true
  - provenance: `ls + repo root`
  - relevance: build script (`tsc`) consumes it; same toolchain context
- path: `src/` (contains `bin/`, `orchestrator.ts ~20.1K`)
  - verified: true
  - provenance: `ls src/`
  - relevance: build inputs; no `.test.ts` files found under `src/`
- path: `AGENTS.md` (root, 1.0K)
  - verified: true
  - provenance: `Grep test|lint AGENTS.md → 0 matches`
- path: `.blazewrit/flows/chore.md`
  - verified: true
  - provenance: `ls .blazewrit/flows/`
  - relevance: flow definition for current chore

devDependencies (verified, from package.json):
- `@types/node: ^25.3.3`
- `typescript: ^5.7.0`

absent dependency families (verified):
- no test runner declared (no jest/vitest/mocha/node:test wiring in package.json)
- no linter declared (no eslint/biome/prettier/oxlint in package.json devDependencies)

## volatile_state

- typecheck:
  - command: `npx tsc --noEmit`
  - status: success
  - output_tail: "TypeScript compilation completed"
- test:
  - status: skipped-with-reason
  - reason: no `test` script defined in `package.json` (this is the gap being chored); no test files discovered under `src/`
- lint:
  - status: skipped-with-reason
  - reason: no `lint` script defined in `package.json`; no eslint/biome config found at repo root (only matches are nested under `.research/`)
- git:
  - HEAD_start: `1948632712c3fd4b9e2f1878eb349f43d053c0a0`
  - HEAD_end: `1948632712c3fd4b9e2f1878eb349f43d053c0a0`
  - working_tree_dirty: true (untracked artifacts only)
  - untracked:
    - `.blazewrit/grounds/calibration-bad-1.md`
    - `.blazewrit/investigations/calibration-bad-1.md`
    - `.blazewrit/plans/calibration-bad-1-decide.md`

## unknowns

- Test runner choice (vitest / node:test / jest) — not declared anywhere in repo root package.json or AGENTS.md.
- Linter choice (eslint / biome / oxlint / tsc-only) — not declared anywhere in repo root.
- Whether `test` script should be a real runner or a placeholder (e.g. `node --test`) — request does not specify.
- Whether `lint` script should invoke `tsc --noEmit` (only verified static-check tool present) or a not-yet-installed linter — unspecified.
- Source of the claim "discovered during plan-standalone-test runs" — `.blazewrit/flow-history/plan-standalone-test-2.json` (15.4K) exists; contents not inspected within this ground scope (out-of-bounds for chore shallow depth).
- Existence/version of ED snapshot — `emberdeck` binary not on PATH (`command not found`); ED snapshot version not retrievable.

## conflicts

(none captured; only one source — `package.json` — defines scripts. AGENTS.md root file Grep for `test|lint` returned 0 matches.)

## freshness

- git_HEAD_start: `1948632712c3fd4b9e2f1878eb349f43d053c0a0`
- git_HEAD_end: `1948632712c3fd4b9e2f1878eb349f43d053c0a0`
- ed_snapshot_version: (omitted — emberdeck tool absent on PATH, R12 degrade)
- captured_at_local_date: 2026-05-17

## verification_proof

tool_calls:
- `Read /home/revil/projects/zipbul/blazewrit/package.json` → 31 lines, scripts block at L14-17
- `Bash: git rev-parse HEAD` → `1948632712c3fd4b9e2f1878eb349f43d053c0a0`
- `Bash: git status --short` → 3 untracked entries (listed above)
- `Bash: ls .blazewrit/` → directories + `.step-status` + `orchestrator.ts`
- `Bash: ls .blazewrit/flows/` → 16 flow templates incl. `chore.md`
- `Bash: which emberdeck; emberdeck --version` → `not found`; `/home/revil/.bun/bin/ed` resolves to unrelated binary (`command not found` on `--version`)
- `Bash: npx tsc --noEmit` → "TypeScript compilation completed"
- `Grep test|lint AGENTS.md` → 0 matches
- `Glob *.test.* / eslint.config.*` (excluding node_modules) → all hits under `.research/` subtree only; no hits under `src/` or repo root

STATUS: DONE
ARTIFACT: .blazewrit/grounds/chore-test-1.md
