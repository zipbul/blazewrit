---
flow_id: plan-standalone-test-2
flow_type: plan-standalone
channel: user_session
captured_at: 2026-05-17T02:25:43+09:00
schema_version: 1
input_refs:
  request_text: "Document the 9-step workflow architecture used in this blazewrit repo (see WORKFLOW_PLAN.md, steps/ directory)."
  triage_output: { flow_type: plan-standalone, channel: user_session, source: orchestrator-supplied }
  conversation_context: null
  scope_hint: "blazewrit repo workflow documentation (WORKFLOW_PLAN.md + steps/ + flows/ + agent/orchestrator surface)"
active_flow_state: { active: null, suspended: [], preempted: null, source: orchestrator-supplied }
---

# Ground — plan-standalone-test-2

## task_subgraph

ED MCP graph query was **not executed** — the `emberdeck` MCP server is absent from this Ground session (verified by inspecting available tool surface; no emberdeck-prefixed tools registered). Substitute corpus: filesystem-based bounded subgraph rooted on the request referents (`WORKFLOW_PLAN.md`, `steps/`). The substitute is documented per-node by `sha256` + `mtime` in `verification_proof.read_files` rather than by an ED snapshot id.

bounded_at:
  entry_nodes: 4
  neighbors: 21
  god_nodes_in_scope: 2
  approximate_corpus_size_lines: 2826 (sum of `wc -l` over the 16 enumerated files in verification_proof; remaining neighbors stat-only)
  token_budget_profile: shallow

ed_snapshot_version: *field omitted* (emberdeck absent — per R12 degrade policy, no placeholder emitted; see `unknowns[ed_query]`).

### entry_nodes

| id | path | source_tool | freshness (mtime epoch / ISO) | size | verified |
|---|---|---|---|---|---|
| workflow_plan | `WORKFLOW_PLAN.md` | Read | 1778952234 / 2026-05-17 | 1027 lines | true |
| flows_readme | `flows/README.md` | Read | 1778948990 / 2026-05-17 | 282 lines | true |
| step_ground | `steps/ground/README.md` | Read | 1778946585 / 2026-05-17 | 168 lines | true |
| steps_dir | `steps/` (directory) | Bash ls | n/a (directory) | 10 subdirectories enumerated below | true |

### neighbors — step pool README set

| id | path | source_tool | freshness (mtime epoch) | size (lines) | verified |
|---|---|---|---|---|---|
| step_triage | `steps/triage/README.md` | Bash stat+wc | 1778949033 | 182 | true |
| step_investigate | `steps/investigate/README.md` | Bash stat+wc | 1778949007 | 157 | true |
| step_decide | `steps/decide/README.md` | Bash stat+wc | 1778948662 | 141 | true |
| step_spec | `steps/spec/README.md` | Bash stat+wc | 1778938408 | 64 | true |
| step_test | `steps/test/README.md` | Bash stat+wc | 1778948543 | 63 | true |
| step_implement | `steps/implement/README.md` | Bash stat+wc | 1778948527 | 73 | true |
| step_report | `steps/report/README.md` | Bash stat+wc | 1778938093 | 62 | true |
| step_verify | `steps/verify/README.md` | Bash stat+wc | 1778946548 | 91 | true |
| step_reflect | `steps/reflect/README.md` | Bash stat+wc | 1778949877 | 68 | true |
| sub_decide_compound | `steps/decide/compound-recursion.md` | Bash ls | n/a (size 5.7K) | — | true |
| sub_decide_failure | `steps/decide/failure-routing.md` | Bash ls | n/a (size 2.6K) | — | true |
| sub_investigate_compat | `steps/investigate/compatibility-verdict.md` | Bash ls | n/a (size 6.3K) | — | true |
| sub_investigate_external | `steps/investigate/external-research.md` | Bash ls | n/a (size 4.8K) | — | true |
| sub_investigate_unknown | `steps/investigate/unknown-disposition.md` | Bash ls | n/a (size 3.0K) | — | true |

### neighbors — operational surface

| id | path | source_tool | freshness (mtime epoch) | size | verified |
|---|---|---|---|---|---|
| execution_plan | `EXECUTION_PLAN.md` | Bash stat+wc | 1778948990 | 293 lines | true |
| agents_md | `AGENTS.md` | Read | 1778938408 | 21 lines | true |
| changelog | `CHANGELOG.md` | filesystem (size 20.6K) | (not stat'd this session) | — | false |
| orchestrator_src | `src/orchestrator.ts` | Bash stat+sha256 | 1778949135 | 49 reported lines (long-line file, 20568 bytes) | true |
| orchestrator_installed | `.blazewrit/orchestrator.ts` | Bash stat+sha256 | 1778950390 | 20568 bytes, sha256 equal to `src/orchestrator.ts` | true |
| prompts_blazewrit | `prompts/blazewrit.md` | Bash stat+sha256 | 1774838645 | 85 lines, 3.1K | true |
| package_json | `package.json` | Read | n/a (read) | 31 lines | true |
| flow_defs_dir | `.blazewrit/flows/` | Bash ls | n/a (16 files enumerated) | bugfix-p0.md, bugfix-unreproducible.md, bugfix.md, chore.md, compound.md, exploration.md, feature.md, migration.md, performance.md, plan-standalone.md, refactor.md, release.md, retro.md, review.md, spike.md, test.md | true |
| claude_agents_dir | `.claude/agents/` | Bash ls | n/a (16 files enumerated) | decide-reviewer.md, decide.md, ground-reviewer.md, ground.md, implement-reviewer.md, implement.md, investigate-reviewer.md, investigate.md, reflect.md, report-reviewer.md, report.md, spec-reviewer.md, spec.md, test-reviewer.md, test.md, verify.md | true |
| step_status_marker | `.blazewrit/.step-status` | Read | n/a | content quoted in `conflicts` row 1 below | true |

### god_nodes_in_scope

- `WORKFLOW_PLAN.md` — 1027 lines, declared the central cross-cutting policy doc by `WORKFLOW_PLAN.md:12` ("이 문서는 *cross-cutting policy* … 담는다") and by AGENTS.md’s structural reference. Cross-referenced from `flows/README.md` and every `steps/*/README.md` per the index `WORKFLOW_PLAN.md:7`.
- `src/orchestrator.ts` — runtime state machine. AGENTS.md and `WORKFLOW_PLAN.md:3` ("Execution model: script orchestrator (orchestrator.ts)") and EXECUTION_PLAN.md identify it as central; the installed copy at `.blazewrit/orchestrator.ts` shares the identical sha256.

Provenance: god-node classification by *self-declaration* in WORKFLOW_PLAN.md:12 and *cross-reference count* observable via Grep — not by ED degree (ED unavailable).

## volatile_state

flow_type=plan-standalone → universal profile only, per `flows/README.md:166` ("plan-standalone | typecheck/test/lint/git | —"). No conditional fields required.

| Field | status | details | source_command | captured_at | duration_ms | verified |
|---|---|---|---|---|---|---|
| typecheck | success | `tsc --noEmit` exit code 0, empty stdout; tsconfig.json declares `target=ES2022, module=Node16, strict=true, rootDir=src`. Compiles `src/orchestrator.ts` + `src/bin/`. | `./node_modules/.bin/tsc --noEmit` | 2026-05-17T02:25:43+09:00 | <2000 (interactive, not metered) | true |
| tests | skipped-with-reason | `package.json` declares no `test` script (only `build`, `prepublishOnly`). No `__tests__/`, `*.test.ts`, `*.spec.ts` under `src/` or anywhere outside `.research/get-shit-done/` (vendored research corpus, out of repo scope). Test runner not configured at repo root. | inspect `package.json`, `find . -path ./node_modules -prune -o -name '*.test.ts' -print -o -name '*.spec.ts' -print` | 2026-05-17T02:25:43+09:00 | n/a | true |
| lint | skipped-with-reason | `package.json` declares no `lint` script. No eslint/biome/prettier config file at repo root (`.eslintrc*`, `biome.json`, `.prettierrc*` absent — checked implicitly via repo root `ls`). | inspect `package.json`, root `ls` | 2026-05-17T02:25:43+09:00 | n/a | true |
| git | success | branch=`main`; head_start=`778eca4db6f980c1396309449631db18d968b571`; head_end=`778eca4db6f980c1396309449631db18d968b571`; dirty=false-against-tracked (only `.blazewrit/` + `.claude/` shown by `git status --short` as untracked, both excluded by workflow convention and `.gitignore`). Recent commits (10): `778eca4 Add R13/R14/R15 systemic enforcement + update agent prompts`, `2dda139 Round 3 closure — installer refactor + agent contract alignment`, `06c54d2 Round 3 — add 16 flow definitions + investigate Write tool`, `6de4f0a Spec ↔ implementation alignment (codex round 2 findings)`, `d29d05f Fix 6 root defects (D1, D5, D6, D8, D9, D14) from adversarial audit`, `a62110a Split workflow spec into per-step directories and add Robustness Hardening (R1-R12)`, `67c44ae Canonicalize ed_snapshot_version and implement NEW10`, `3bcc0a7 Close subagent-verification round: Bash, partial_proceed, NEW9, NEW10`, `8dacab0 Close subagent-found gaps: tool enforcement, Compound gate executor, partial-proceed, depth coverage`, `c863cc8 Close 8 self-found gaps after batch 2 fixes`. | `git rev-parse HEAD` (×2), `git status --short`, `git log --oneline -10`, `git rev-parse --abbrev-ref HEAD` | 2026-05-17T02:25:43+09:00 | <500 | true |

racing_changes: false (head_start == head_end == `778eca4…b571`, sampled at start and end of capture window).

## unknowns

| dim | reason | source_tool | attempted_at | verified |
|---|---|---|---|---|
| ed_query | emberdeck MCP server not connected to this Ground session — graph queries (`query_graph`, `get_neighbors`, etc.) not invokable; no emberdeck tool present in tool surface. Substituted with filesystem stat + Read on documented entry/neighbor paths. R14 fail-loud: surfaced rather than fabricated. | emberdeck (absent) | 2026-05-17T02:25:43+09:00 | true |
| ed_snapshot_version | Cannot obtain ED snapshot hash without emberdeck. Per R12 degrade policy + R13 placeholder ban, the `ed_snapshot_version` field is *omitted* from the freshness block (not set to a placeholder string). Substituted with per-file `sha256sum` (see `verification_proof.read_files`). | emberdeck (absent) | 2026-05-17T02:25:43+09:00 | true |
| firebat_baseline | firebat MCP not invoked. Ground does not normally run firebat; recorded so Investigate observes the absence rather than assumes a baseline pass. | firebat (not invoked) | 2026-05-17T02:25:43+09:00 | true |
| pyreez_baseline | pyreez MCP not invoked. Recorded with the same disposition as firebat — for Investigate awareness, not for Ground judgment. | pyreez (not invoked) | 2026-05-17T02:25:43+09:00 | true |
| test_suite_definition | `package.json` does not define a `test` script and no test runner config exists at the repo root. Whether this is *intentional* (docs-only repo phase) or *configuration absent* is not determined here. | Read `package.json` + Bash `find`; result surfaced, interpretation deferred to Investigate | 2026-05-17T02:25:43+09:00 | true |
| lint_definition | Same shape as `test_suite_definition` for lint. No `lint` script, no top-level config. | Read `package.json` + root `ls` | 2026-05-17T02:25:43+09:00 | true |
| step_pool_directory_count | `steps/` directory enumerates **10 subdirectories** (`decide`, `ground`, `implement`, `investigate`, `reflect`, `report`, `spec`, `test`, `triage`, `verify`). Documents elsewhere use the phrase "Step Pool (9)" (e.g. `WORKFLOW_PLAN.md:31`, `AGENTS.md:9`). The disposition of `triage` as a separate classifier or as a 10th step is described in the documents but not adjudicated here. | Bash `ls steps/`, Read `WORKFLOW_PLAN.md`, Read `AGENTS.md` | 2026-05-17T02:25:43+09:00 | true |
| changelog_freshness | `CHANGELOG.md` was *not* stat'd or hashed in this session — only its presence and approximate size are recorded. Investigate may need fresher data. | filesystem listing only | 2026-05-17T02:25:43+09:00 | false |
| orchestrator_installed_provenance | `.blazewrit/orchestrator.ts` has the same sha256 as `src/orchestrator.ts` but a later mtime. Whether the installed copy is an artifact of a `tsc`/install run or a manual copy is not determined here. | Bash `stat`, `sha256sum` | 2026-05-17T02:25:43+09:00 | true |

## conflicts

Raw quotes only — no comparative judgment is rendered in this section (Ground boundary R15).

| sources | raw_quotes | source_tool |
|---|---|---|
| `WORKFLOW_PLAN.md:31` ↔ `Bash ls steps/` ↔ `AGENTS.md:9` | `WORKFLOW_PLAN.md:31` says: "## Step Pool (9)". `Bash ls steps/` says: "decide/  ground/  implement/  investigate/  reflect/  report/  spec/  test/  triage/  verify/" (10 entries). `AGENTS.md:9` says: "Step pool: Ground, Investigate, Decide, Spec, Test, Implement, Report, Verify, Reflect (9 steps)". `WORKFLOW_PLAN.md:21` says: "Triage: Stateless classification — 입력 → 16 flow 중 1개 / none / ambiguous / error. 코드·flow state 안 봄." | Read + Bash ls |
| `AGENTS.md:10` ↔ `Bash ls .claude/agents/` | `AGENTS.md:10` says: "Execution: produce ⇄ review loop per step (16 agents: 9 producer + 7 reviewer — Verify/Reflect have no reviewer) + hooks (mechanical)". `Bash ls .claude/agents/` returns 16 files: "decide-reviewer.md, decide.md, ground-reviewer.md, ground.md, implement-reviewer.md, implement.md, investigate-reviewer.md, investigate.md, reflect.md, report-reviewer.md, report.md, spec-reviewer.md, spec.md, test-reviewer.md, test.md, verify.md". No `triage.md` agent file exists. | Read + Bash ls |
| `.blazewrit/.step-status` ↔ current `flow_id` | `.blazewrit/.step-status` says: `{ "status": "DONE", "artifact": ".blazewrit/grounds/plan-standalone-test-1.md" }`. Current capture's `flow_id` is `plan-standalone-test-2`. | Read |
| `WORKFLOW_PLAN.md:3` ↔ `EXECUTION_PLAN.md` ↔ `src/orchestrator.ts` ↔ `.blazewrit/orchestrator.ts` | `WORKFLOW_PLAN.md:3` says: "Execution model: script orchestrator (orchestrator.ts) — see EXECUTION_PLAN.md". `sha256sum src/orchestrator.ts` returns: `cf9f06ce2a18df3f00c2ab7d10e7f28fa110162fea0379c6058567f9399c0882`. `sha256sum .blazewrit/orchestrator.ts` returns: `cf9f06ce2a18df3f00c2ab7d10e7f28fa110162fea0379c6058567f9399c0882`. `stat -c %Y` returns `1778949135` for `src/orchestrator.ts` and `1778950390` for `.blazewrit/orchestrator.ts`. | Bash stat + sha256sum |

## freshness

- ed_snapshot_version: *field omitted* (emberdeck absent — see `unknowns[ed_query]`, `unknowns[ed_snapshot_version]`)
- git_head_start: `778eca4db6f980c1396309449631db18d968b571`
- git_head_end:   `778eca4db6f980c1396309449631db18d968b571`
- racing_changes: false
- branch: `main`
- substitute_provenance: per-file `sha256sum` recorded under `verification_proof.read_files`
- capture_window: 2026-05-17T02:25:43+09:00 (single-shot; capture wall-time < 1 minute)

## verification_proof

### tool_calls

| tool | args | output_hash_or_summary | exit_code |
|---|---|---|---|
| Bash `git rev-parse HEAD` | (twice — start + end of capture window) | both: `778eca4db6f980c1396309449631db18d968b571` | 0 |
| Bash `git status --short` | n/a | `?? .blazewrit/\n?? .claude/` | 0 |
| Bash `git log --oneline -10` | n/a | 10 lines; top `778eca4 Add R13/R14/R15 systemic enforcement + update agent prompts` | 0 |
| Bash `git rev-parse --abbrev-ref HEAD` | n/a | `main` | 0 |
| Bash `./node_modules/.bin/tsc --noEmit` | tsconfig.json:`{target: ES2022, module: Node16, strict: true, rootDir: src}` | empty stdout | 0 |
| Bash `wc -l` (16 files) | see read_files | aggregated 2826 lines | 0 |
| Bash `stat -c %Y` (16 files) | see read_files | epoch list as in tables | 0 |
| Bash `sha256sum` (17 files) | see read_files + `.blazewrit/orchestrator.ts` + `prompts/blazewrit.md` | hash list below | 0 |
| Bash `ls steps/` | n/a | 10 directory entries | 0 |
| Bash `ls .blazewrit/flows/` | n/a | 16 flow-definition file names | 0 |
| Bash `ls .claude/agents/` | n/a | 16 agent file names | 0 |
| Bash `ls .blazewrit/` | n/a | 6 directories + `.step-status` + `orchestrator.ts` | 0 |
| Bash `find . -path ./node_modules -prune -o -name '*.test.ts' -print -o -name '*.spec.ts' -print` | n/a | all matches under `./.research/get-shit-done/sdk/` (vendored, out of scope); zero matches under `src/` | 0 |
| Read `package.json` | n/a | 31 lines; no `test` or `lint` script | n/a |
| Read `AGENTS.md` | n/a | 21 lines (full file) | n/a |
| Read `flows/README.md` | n/a | 282 lines (full file) | n/a |
| Read `WORKFLOW_PLAN.md` | offset 0–360 | first 360 lines read | n/a |
| Read `steps/ground/README.md` | n/a | 168 lines (full file) | n/a |
| Read `.blazewrit/.step-status` | n/a | `{ "status": "DONE", "artifact": ".blazewrit/grounds/plan-standalone-test-1.md" }` (81 bytes) | n/a |

### read_files

| path | sha256 | mtime epoch |
|---|---|---|
| WORKFLOW_PLAN.md | `8747de03839979bd0304b3de14d66a011afb946b101f2dbb4f4f67adce5f195b` | 1778952234 |
| EXECUTION_PLAN.md | `1f9fa724a5c5cf6d8478e3228e58847b7d0db3478f90799263c68d42f1e1eac9` | 1778948990 |
| AGENTS.md | `126e38c164ae47a2cc6ab167e54cefb7041294680a6f7ac7d730a79b7491afea` | 1778938408 |
| flows/README.md | `7b0838f7a2ce26bbafb5b3b6d8f8c237c0be9ffa66ad196a2a7cedc5b0af037d` | 1778948990 |
| steps/ground/README.md | `143616a6722386ba5244d51267e3296befe11bc01575988ee3b0f891cf86f0f6` | 1778946585 |
| steps/triage/README.md | `3c21e1ca38734be11f57641541070af18a73e986f8301cdb1316f1865ce58dfb` | 1778949033 |
| steps/investigate/README.md | `7cf6c31c37ba1c1e07940590b06542859ad8f0fc39b2ae6e4d71f59b39c544d0` | 1778949007 |
| steps/decide/README.md | `26d9a66399d63fe0414ed7b7be124b9d9e1c4d9a6d18134bcf3620a0cccb7082` | 1778948662 |
| steps/spec/README.md | `0ac760f13fa230e9ab32fc632c5032e144b707ef078a6587f0fdaf9639b2d112` | 1778938408 |
| steps/test/README.md | `df463f1ce76ea4941b5106150770adbfb39f2b796c7d564c88d0f01827bfbd88` | 1778948543 |
| steps/implement/README.md | `cb7f94fa0b00a7fc577b9e5fb4f895756be2b7fc63ff13ad6f334f6798ca938d` | 1778948527 |
| steps/report/README.md | `d312bcac3d020fb7a33e029805ca196e2bf8ee0095c6a74e5ebc4becf93c98bf` | 1778938093 |
| steps/verify/README.md | `59e8a59b04e4bb0e9a234b9fac34fdc8b65d70c7a5765cbdba478254ad5f8b30` | 1778946548 |
| steps/reflect/README.md | `42db0240b4d0ea6b8e1c3a1c6b6ae2f68d1d105a1b6aa5ae1d0428f7ecdabe7f` | 1778949877 |
| src/orchestrator.ts | `cf9f06ce2a18df3f00c2ab7d10e7f28fa110162fea0379c6058567f9399c0882` | 1778949135 |
| .blazewrit/orchestrator.ts | `cf9f06ce2a18df3f00c2ab7d10e7f28fa110162fea0379c6058567f9399c0882` | 1778950390 |
| prompts/blazewrit.md | `01344a6a97c143c8ec38bac6e09daf520d56c6a03bf524683ac2ee381bcd7740` | 1774838645 |

### ed_queries

(none — emberdeck unavailable; see `unknowns[ed_query]`)
