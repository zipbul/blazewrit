---
flow_id: plan-standalone-test-1
flow_type: plan-standalone
channel: user_session
captured_at: 2026-05-17
schema_version: 1
input_refs:
  request_text: "Document the 9-step workflow architecture used in this blazewrit repo (see WORKFLOW_PLAN.md, steps/ directory)."
  triage_output: { flow_type: plan-standalone, channel: user_session, source: orchestrator-supplied }
  conversation_context: null
  scope_hint: "blazewrit repo workflow documentation (WORKFLOW_PLAN.md + steps/ + flows/ + agent/orchestrator surface)"
---

# Ground — plan-standalone-test-1

## task_subgraph

ED MCP graph query was **not executed** — the `emberdeck` MCP server is not available in this Ground session (see `unknowns`). Substitute: filesystem-based bounded subgraph rooted on the request referents (`WORKFLOW_PLAN.md`, `steps/`).

bounded_at: 16 entry/neighbor nodes, ~1539 lines of step-pool README + 952 lines WORKFLOW_PLAN + 293 lines EXECUTION_PLAN + 282 lines flows/README (token-budget within shallow profile target).

ed_snapshot_version: `unavailable` (emberdeck not in session) — substituted with filesystem-content hashes per node (see `verification_proof.read_files`).

### entry_nodes

| id | path | source | freshness (mtime epoch) | size |
|---|---|---|---|---|
| workflow_plan | `WORKFLOW_PLAN.md` | Read | 1778949913 | 952 lines, 59.8K |
| flows_readme | `flows/README.md` | Read | 1778948990 | 282 lines |
| step_ground | `steps/ground/README.md` | Read | 1778946585 | 168 lines |
| step_triage | `steps/triage/README.md` | Read | 1778949033 | 182 lines |

### neighbors (step pool — 9 + triage classifier)

| id | path | source | freshness (mtime epoch) | size |
|---|---|---|---|---|
| step_investigate | `steps/investigate/README.md` | filesystem_stat | 1778949007 | 157 lines |
| step_decide | `steps/decide/README.md` | filesystem_stat | 1778948662 | 141 lines |
| step_spec | `steps/spec/README.md` | filesystem_stat | 1778938408 | 64 lines |
| step_test | `steps/test/README.md` | filesystem_stat | 1778948543 | 63 lines |
| step_implement | `steps/implement/README.md` | filesystem_stat | 1778948527 | 73 lines |
| step_report | `steps/report/README.md` | filesystem_stat | 1778938093 | 62 lines |
| step_verify | `steps/verify/README.md` | filesystem_stat | 1778946548 | 91 lines |
| step_reflect | `steps/reflect/README.md` | filesystem_stat | 1778949877 | 68 lines |
| sub_decide_compound | `steps/decide/compound-recursion.md` | filesystem_stat | — | 5.7K |
| sub_decide_failure | `steps/decide/failure-routing.md` | filesystem_stat | — | 2.6K |
| sub_investigate_compat | `steps/investigate/compatibility-verdict.md` | filesystem_stat | — | 6.3K |
| sub_investigate_external | `steps/investigate/external-research.md` | filesystem_stat | — | 4.8K |
| sub_investigate_unknown | `steps/investigate/unknown-disposition.md` | filesystem_stat | — | 3.0K |

### neighbors (operational surface)

| id | path | source | freshness (mtime epoch) | size |
|---|---|---|---|---|
| execution_plan | `EXECUTION_PLAN.md` | Read | 1778948990 | 293 lines |
| agents_md | `AGENTS.md` | Read | 1778938408 | 22 lines, 1.0K |
| changelog | `CHANGELOG.md` | filesystem_stat | 1778938185 | 54 lines, 20.6K |
| orchestrator_src | `src/orchestrator.ts` | filesystem_stat | 1778949135 | 49 lines, 20568 bytes (long-line file) |
| prompts_blazewrit | `prompts/blazewrit.md` | filesystem_stat | — | 85 lines, 3.1K |
| claude_agents_dir | `.claude/agents/` | Bash ls | — | 16 agent files (9 producer + 7 reviewer) |
| flow_defs_dir | `.blazewrit/flows/` | Bash ls | — | 16 flow definition files |
| assets_dir | `assets/{agents,flows,hooks,rules,tools}/` | Bash ls | — | 5 subdirs |

### god_nodes_in_scope

- `WORKFLOW_PLAN.md` — 952 lines, central cross-cutting policy doc (graph degree: referenced by every step README and flows/README per WORKFLOW_PLAN.md:7 index)
- `src/orchestrator.ts` — central runtime state machine (referenced by WORKFLOW_PLAN.md:3, AGENTS.md, EXECUTION_PLAN.md)

Provenance: god-node classification by *cross-reference count* observable via grep — not by ED degree (ED unavailable).

## volatile_state

flow_type=plan-standalone → universal profile only (flows/README.md:166).

| Field | status | details | source_command | captured_at | duration_ms |
|---|---|---|---|---|---|
| typecheck | success | `tsc --noEmit` exit 0, 0 diagnostics on src/ | `./node_modules/.bin/tsc --noEmit` | 2026-05-17 | <2000 (interactive, not metered) |
| tests | skipped-with-reason | `package.json` declares no `test` script. No `__tests__/`, `*.test.ts`, `*.spec.ts` discovered in src/. Test runner not configured at repo root. | inspect `package.json`, Bash ls src/ | 2026-05-17 | n/a |
| lint | skipped-with-reason | `package.json` declares no `lint` script. No eslint/biome/prettier config at repo root. | inspect `package.json` | 2026-05-17 | n/a |
| git | success | branch=main, head_start=`2dda139a8b93c14d10a9c30b77155980c2252768`, head_end=`2dda139a8b93c14d10a9c30b77155980c2252768`, dirty=false (only untracked `.blazewrit/` + `.claude/` — both ignored at workflow level). Recent commits: 10 commits visible, top = "Round 3 closure — installer refactor + agent contract alignment" | `git rev-parse HEAD`, `git status --short`, `git log --oneline -10` | 2026-05-17 | <500 |

racing_changes: false (head_start == head_end).

## unknowns

| dim | reason | source_tool | attempted_at |
|---|---|---|---|
| ed_query | emberdeck MCP server not connected to this Ground session — graph query (`query_graph`, `get_neighbors`) not invokable. Substituted with filesystem stat + Read on documented entry/neighbor paths. | emberdeck (absent) | 2026-05-17 |
| ed_snapshot_version | Cannot obtain ED snapshot hash without emberdeck — substituted with per-file `sha256sum` (see verification_proof.read_files). | emberdeck (absent) | 2026-05-17 |
| firebat_baseline | firebat MCP not invoked in Ground (Ground does not normally run firebat; recorded here so Investigate sees absence rather than assumes pass). | firebat (not invoked) | 2026-05-17 |
| pyreez_baseline | pyreez MCP not invoked. (Same disposition as firebat.) | pyreez (not invoked) | 2026-05-17 |
| test_suite_definition | No test script / runner found. Cannot determine whether "no tests" is *intentional* (docs-only repo phase) or *missing config*. Surfaced as unknown rather than judged. | package.json read | 2026-05-17 |
| lint_definition | Same as above for lint. | package.json read | 2026-05-17 |
| step_pool_directory_count | `steps/` directory contains **10 subdirectories**, while WORKFLOW_PLAN.md:31 declares "Step Pool (9)". Documents resolve this: triage is the *classifier* not part of the 9-step pool (WORKFLOW_PLAN.md:21, AGENTS.md:9). Flagged for downstream confirmation that no document treats triage as the 10th step. | Bash ls + Read | 2026-05-17 |

## conflicts

| sources | description | source_tool |
|---|---|---|
| `AGENTS.md:9` ↔ `WORKFLOW_PLAN.md:31, 130-141` | AGENTS.md says "16 agents: 9 producer + 7 reviewer — Verify/Reflect have no reviewer". WORKFLOW_PLAN.md Step-Reviewer Pairs table lists 7 reviewer rows (Ground, Investigate, Decide, Spec, Test, Implement, Report) which matches "7 reviewer", and "Steps Without Reviewers" lists Verify+Reflect. `.claude/agents/` contains exactly 16 agent files. **Numerically consistent**, recorded here only because the two docs phrase the count differently and a downstream reader might double-count if triage is included. | Read + Bash ls | 
| `AGENTS.md:7` ↔ `WORKFLOW_PLAN.md:16` | Both express the same chain `None ↔ Triage → Flow[Ground → Investigate → Decide → Spec? → Core Steps → Verify → Reflect]`. **No conflict** — recorded as fact alignment. | Read |

(No active contradictions detected; both rows are alignment notes, kept here per Ground’s "surface, do not interpret" rule.)

## freshness

- ed_snapshot_version: `unavailable` (emberdeck absent — see unknowns)
- git_head_start: `2dda139a8b93c14d10a9c30b77155980c2252768`
- git_head_end:   `2dda139a8b93c14d10a9c30b77155980c2252768`
- racing_changes: false
- substitute_provenance: per-file sha256 (read_files below)

## verification_proof

### tool_calls

| tool | args_hash (informal) | output_hash | exit_code |
|---|---|---|---|
| Bash `git rev-parse HEAD` | n/a | head=`2dda139…2768` | 0 |
| Bash `git status --short` | n/a | `?? .blazewrit/\n?? .claude/` | 0 |
| Bash `git log --oneline -10` | n/a | 10 lines, top `2dda139 Round 3 closure …` | 0 |
| Bash `./node_modules/.bin/tsc --noEmit` | tsconfig.json:`target=ES2022, module=Node16, strict=true, rootDir=src` | (empty stdout) | 0 |
| Bash `wc -l` (entry nodes) | see neighbors table | aggregated 1539 lines step-pool | 0 |
| Bash `stat -c %Y` (entry nodes) | see freshness mtimes | epoch list above | 0 |
| Bash `ls .claude/agents/` | n/a | 16 file names | 0 |
| Bash `ls .blazewrit/flows/` | n/a | 16 flow definitions | 0 |

### read_files

| path | sha256 | mtime epoch |
|---|---|---|
| WORKFLOW_PLAN.md | `653462267b0d78a4b12210e473643be713ff5da16f8a1f5b097c64bcc4ff8aff` | 1778949913 |
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

### ed_queries

(none — emberdeck unavailable; see unknowns)
