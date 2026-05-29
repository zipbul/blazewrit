---
flow_id: plan-standalone-test-3
flow_type: plan-standalone
step: report
artifact_kind: terminal_plan
schema_version: 1
captured_at: 2026-05-17T05:25:00Z
ground_ref: .blazewrit/grounds/plan-standalone-test-3.md
investigate_ref: .blazewrit/investigations/plan-standalone-test-3.md
decide_ref: .blazewrit/plans/plan-standalone-test-3-decide.md
git_head: 68157b052c89351d8530461368d4101c623c8b29
source_files:
  - { path: AGENTS.md, sha256: 126e38c164ae47a2cc6ab167e54cefb7041294680a6f7ac7d730a79b7491afea }
  - { path: flows/README.md, sha256: 7b0838f7a2ce26bbafb5b3b6d8f8c237c0be9ffa66ad196a2a7cedc5b0af037d }
  - { path: steps/ground/README.md, sha256: 143616a6722386ba5244d51267e3296befe11bc01575988ee3b0f891cf86f0f6 }
expected_next_step: verify
---

# Terminal Plan — plan-standalone-test-3

> **Plan-standalone terminal artifact.** Per `flows/README.md`, the plan-standalone
> flow ends here: Report synthesizes Decide(Design) into a consumable plan; Spec/
> Implement are not in this chain. The `task_list` below is verbatim from Decide
> §task_list (R19) — downstream consumers (any future Spec/Implement reflow, or a
> human executor) treat it as terminal, not deferred.

## Summary

User requested documentation of the "9-step workflow architecture" of this blazewrit
repo. Ground established the factual surface (AGENTS.md:9 enumerates 9 core steps;
`ls steps/` returns 10 directories with Triage as the 10th; `.claude/agents/` holds
17 entries reconciling to 16 agent files + README.md; emberdeck/pyreez/firebat all
absent so ED-derived fields were omitted per R14 fail-loud). Investigate confirmed
upstream facts (sha256 match on AGENTS.md content claims), surfaced 5 risks
(terminology-mismatch, agent-count-drift, doc-overlap, clean-worktree-uncertainty,
ed-absent) and emitted needs_clarification on 3 scoping questions. Decide(Design)
resolved all three as design decisions (R15): scope = "9 core steps + Triage
pre-flow gate"; audience = contributor reference; format = single Markdown reference
doc at `docs/workflow-architecture.md` complementing (not superseding)
WORKFLOW_PLAN.md / EXECUTION_PLAN.md. Decide chose Option O1 over O2 (per-step
files, redundant with `steps/*/README.md`) and O3 (inline AGENTS.md bloat).
Conclusion: design is ready for execution; this plan is the terminal artifact.

## Findings

### F1 — Terminology conflict between AGENTS.md:9 and filesystem [HIGH]
- **Evidence**: AGENTS.md:9 declares "Step pool: …(9 steps)"; `ls steps/ | wc -l` = 10
  (Ground volatile_state, verification_proof tool_calls).
- **Impact**: Any documentation that says "9 steps" or "10 steps" without qualification
  miscommunicates the gate/core distinction; readers may chase a missing 10th step
  or fail to invoke Triage.
- **verify_probe**: `grep -n "9 steps" AGENTS.md && [ "$(ls steps/ | wc -l)" = "10" ]` → both exit 0.

### F2 — Agent-count drift between AGENTS.md:10 and `.claude/agents/` listing [MEDIUM]
- **Evidence**: AGENTS.md:10 says "16 agents: 9 producer + 7 reviewer"; `ls .claude/agents/`
  returns 17 entries (Ground conflict#3).
- **Impact**: Future reader counting directory entries gets 17, contradicting the
  doc-stated 16. Reconciliation note required (README.md is the 17th).
- **verify_probe**: `[ "$(ls .claude/agents/ | wc -l)" = "17" ] && grep -n "16 agents" AGENTS.md`.

### F3 — emberdeck / pyreez / firebat all absent in this environment [MEDIUM]
- **Evidence**: Ground verification_proof: `which emberdeck pyreez firebat` exit 1.
- **Impact**: `ed_snapshot_version`, `intent_card_id`, `pyreez_deliberation_ref`
  fields omitted per R13/R14 fail-loud; AMBIGUOUS/INFERRED graph edges between steps
  and agents are not surfaced. Decide accepted residual risk (no edge-claims in doc).
- **verify_probe**: `which emberdeck pyreez firebat; echo $?` → nonzero.

### F4 — Potential documentation redundancy with WORKFLOW_PLAN.md / EXECUTION_PLAN.md [MEDIUM]
- **Evidence**: Ground neighbors lists `WORKFLOW_PLAN.md` (70.7K) and
  `EXECUTION_PLAN.md`; neither was read during Ground or Investigate.
- **Impact**: New `docs/workflow-architecture.md` may duplicate content; Decide's
  mitigation = position as reference (complement), not plan; cross-link in § 7.
  Followup investigate-only flow queued.
- **verify_probe**: `test -f WORKFLOW_PLAN.md && test -f EXECUTION_PLAN.md && wc -l WORKFLOW_PLAN.md`.

### F5 — `git status --short` returned literal "ok" instead of expected empty stdout [LOW]
- **Evidence**: Ground volatile_state.git.dirty: `false (… stdout contained literal
  token "ok", not standard empty output)`.
- **Impact**: Tooling-trust risk; cleanliness not definitively confirmed. HEAD start
  == HEAD end (68157b0) so no racing change.
- **verify_probe**: `git status --short | od -c | head` → inspect for unexpected wrapper output.

### F6 — Decide chose Option O1 (single reference doc) with reasoned rejection of O2/O3 [INFO]
- **Evidence**: Decide §chosen.option_id=O1; rationale cites Investigate
  risk_surface#doc-overlap (O2) and contract-doc bloat (O3).
- **Impact**: Confirms terminal artifact path = `docs/workflow-architecture.md`;
  9 tasks T1–T9 are strict-linear with locally testable acceptance per section.
- **verify_probe**: `grep -E "option_id: O1" .blazewrit/plans/plan-standalone-test-3-decide.md`.

### F7 — All 10 requirements (REQ-1…REQ-10) carry mechanical verify_probes [INFO]
- **Evidence**: Decide §requirements: 10 entries each with type ∈ {file_exists,
  grep, command, line_count} and explicit negative_test (R20-compliant).
- **Impact**: Verify step (next) can run the probe set unmodified.
- **verify_probe**: `grep -cE "^\\s*verify_probe:" .blazewrit/plans/plan-standalone-test-3-decide.md` → ≥ 19 (10 REQ + 9 task).

## Action Items

Priority order (P0 = blocking next step, P1 = soon, P2 = followup):

- **[P0] AI-1**: Hand this terminal plan to the Verify step; Verify executes the
  REQ-1…REQ-10 verify_probes from Decide against the produced
  `docs/workflow-architecture.md`. (No code is written by this plan-standalone
  flow; doc authoring happens when a future flow consumes this `task_list`.)
- **[P0] AI-2**: When the doc is authored, enforce Decide policies P1 (terminology
  qualifier "9 core steps + Triage pre-flow gate") and P2 (agent count phrasing
  "16 agents (9 producer + 7 reviewer)" with `.claude/agents/` 17-entries note).
- **[P1] AI-3**: Queue followup investigate-only flow to read WORKFLOW_PLAN.md and
  EXECUTION_PLAN.md and decide whether any sections should retire/supersede in
  light of the new reference doc (Decide §followup_flows).
- **[P2] AI-4**: When emberdeck is reinstalled, capture an intent_card for this
  architecture-reference design so future Decide runs can attach to it
  (Decide §followup_flows; lifts R13 OMITTED field).
- **[P2] AI-5**: Investigate the literal "ok" stdout from `git status --short`
  (likely shell-wrapper artifact); confirm worktree-cleanliness signal is
  trustworthy in this environment.

## task_list (verbatim from Decide §task_list — R19)

> Per R19, Decide's task_list is reproduced here unchanged. Spec/Implement are
> not in the plan-standalone chain; any future flow that resumes execution
> consumes this list directly. Deferral is prohibited.

- id: T1
  description: Create `docs/` directory if absent and add empty `docs/workflow-architecture.md` skeleton with YAML front matter (title, captured_at, git_head=68157b0, source AGENTS.md sha256, flows/README.md sha256).
  inputs:
    - .blazewrit/grounds/plan-standalone-test-3.md (sha256 anchors)
  outputs:
    - docs/workflow-architecture.md (front matter + empty body)
  depends_on: []
  acceptance_test:
    type: file_exists
    target: docs/workflow-architecture.md
    expected: present
  verify_probe: "test -f docs/workflow-architecture.md && head -1 docs/workflow-architecture.md | grep -q '^---$'"
  est_effort: trivial

- id: T2
  description: Write § 1 Overview (≥10 lines) defining "workflow" via flow_type → step composition rule, citing flows/README.md.
  inputs:
    - flows/README.md
  outputs:
    - docs/workflow-architecture.md (§ 1 added)
  depends_on: [T1]
  acceptance_test:
    type: grep
    target: docs/workflow-architecture.md
    expected: "^## 1\\. Overview" matches
  verify_probe: "grep -q '^## 1\\. Overview' docs/workflow-architecture.md && awk '/^## 1\\./,/^## 2\\./' docs/workflow-architecture.md | wc -l | awk '$1>=10{exit 0}{exit 1}'"
  est_effort: trivial

- id: T3
  description: Write § 2 Chain shape — include verbatim chain block from AGENTS.md:7 inside a fenced code block.
  inputs:
    - AGENTS.md (line 7)
  outputs:
    - docs/workflow-architecture.md (§ 2 added)
  depends_on: [T2]
  acceptance_test:
    type: grep
    target: docs/workflow-architecture.md
    expected: "regex `Triage.*Flow\\[Ground` matches inside ``` fenced block"
  verify_probe: "grep -q 'Triage' docs/workflow-architecture.md && grep -q 'Flow\\[Ground' docs/workflow-architecture.md"
  est_effort: trivial

- id: T4
  description: Write § 3 with 9 subsections (one per core step, in canonical order Ground→Reflect). Each subsection: purpose line, input artifact, output path under `.blazewrit/<area>/`, reviewer-present flag, link to `steps/<name>/README.md`.
  inputs:
    - steps/ground/README.md, steps/investigate/README.md, steps/decide/README.md, steps/spec/README.md, steps/test/README.md, steps/implement/README.md, steps/report/README.md, steps/verify/README.md, steps/reflect/README.md
  outputs:
    - docs/workflow-architecture.md (§ 3 with 9 subsections)
  depends_on: [T3]
  acceptance_test:
    type: command
    target: "grep -cE '^### 3\\.[1-9]' docs/workflow-architecture.md"
    expected: stdout == "9"
  verify_probe: "[ \"$(grep -cE '^### 3\\.[1-9]' docs/workflow-architecture.md)\" = 9 ] && for s in ground investigate decide spec test implement report verify reflect; do grep -q \"steps/$s/README.md\" docs/workflow-architecture.md || exit 1; done"
  est_effort: small

- id: T5
  description: Write § 4 Triage pre-flow gate (≥6 lines). Must contain phrase "pre-flow gate" and explain dispatch role (flow_type classification).
  inputs:
    - AGENTS.md, steps/triage/README.md
  outputs:
    - docs/workflow-architecture.md (§ 4 added)
  depends_on: [T4]
  acceptance_test:
    type: grep
    target: docs/workflow-architecture.md
    expected: "regex `(?i)pre-flow gate` matches AND `flow_type` appears in same section"
  verify_probe: "awk '/^## 4\\./,/^## 5\\./' docs/workflow-architecture.md | grep -qi 'pre-flow gate' && awk '/^## 4\\./,/^## 5\\./' docs/workflow-architecture.md | grep -q 'flow_type'"
  est_effort: trivial

- id: T6
  description: Write § 5 Agent layer. Must state "16 agents (9 producer + 7 reviewer)" and note that `.claude/agents/` directory listing returns 17 entries because of README.md; note Verify and Reflect have no reviewer.
  inputs:
    - AGENTS.md:10, `ls .claude/agents/` (from Ground)
  outputs:
    - docs/workflow-architecture.md (§ 5 added)
  depends_on: [T5]
  acceptance_test:
    type: command
    target: "awk '/^## 5\\./,/^## 6\\./' docs/workflow-architecture.md | grep -E '16 agents' | grep -E '9 producer' | grep -E '7 reviewer'"
    expected: exit 0
  verify_probe: "awk '/^## 5\\./,/^## 6\\./' docs/workflow-architecture.md | grep -q '16 agents' && awk '/^## 5\\./,/^## 6\\./' docs/workflow-architecture.md | grep -q '17' && awk '/^## 5\\./,/^## 6\\./' docs/workflow-architecture.md | grep -qE 'Verify.*Reflect|Reflect.*Verify'"
  est_effort: trivial

- id: T7
  description: Write § 6 Flow types — single paragraph + link to flows/README.md. Do not duplicate the flow definitions.
  inputs:
    - flows/README.md
  outputs:
    - docs/workflow-architecture.md (§ 6 added)
  depends_on: [T6]
  acceptance_test:
    type: grep
    target: docs/workflow-architecture.md
    expected: "^## 6\\. Flow types" matches AND `flows/README.md` link appears within section
  verify_probe: "grep -q '^## 6\\. Flow types' docs/workflow-architecture.md && awk '/^## 6\\./,/^## 7\\./' docs/workflow-architecture.md | grep -q 'flows/README.md'"
  est_effort: trivial

- id: T8
  description: Write § 7 Cross-references (bulleted list) linking AGENTS.md, flows/README.md, WORKFLOW_PLAN.md, EXECUTION_PLAN.md, prompts/blazewrit.md.
  inputs: []
  outputs:
    - docs/workflow-architecture.md (§ 7 added)
  depends_on: [T7]
  acceptance_test:
    type: command
    target: "awk '/^## 7\\./,0' docs/workflow-architecture.md | grep -E 'AGENTS.md|flows/README.md|WORKFLOW_PLAN.md|EXECUTION_PLAN.md|prompts/blazewrit.md' | wc -l"
    expected: stdout ≥ 5
  verify_probe: "[ \"$(awk '/^## 7\\./,0' docs/workflow-architecture.md | grep -cE 'AGENTS.md|flows/README.md|WORKFLOW_PLAN.md|EXECUTION_PLAN.md|prompts/blazewrit.md')\" -ge 5 ]"
  est_effort: trivial

- id: T9
  description: Run all REQ-1…REQ-10 verify_probes end-to-end as a single sanity script; fix any failures by editing the doc (no new sections beyond § 1–§ 7).
  inputs:
    - docs/workflow-architecture.md (current state after T1–T8)
  outputs:
    - docs/workflow-architecture.md (final pass)
  depends_on: [T8]
  acceptance_test:
    type: command
    target: "bash -c 'test -f docs/workflow-architecture.md && [ $(wc -l < docs/workflow-architecture.md) -ge 80 ] && perl -CSD -ne \"print if /\\p{Hangul}/\" docs/workflow-architecture.md | wc -l | grep -q ^0$'"
    expected: exit 0
  verify_probe: "test -f docs/workflow-architecture.md && [ $(wc -l < docs/workflow-architecture.md) -ge 80 ] && [ \"$(perl -CSD -ne 'print if /\\p{Hangul}/' docs/workflow-architecture.md | wc -l)\" = 0 ]"
  est_effort: trivial

## sequencing (verbatim from Decide)

T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 (strict linear; each task appends one
section so acceptance is locally testable). No parallelism warranted at this size.

## gate_rules (verbatim from Decide)

- condition: { "==": [ { "var": "T9.acceptance_test.result" }, "fail" ] }
  action: pivot
  note: rerun failing REQ probes; remediate inside existing § 1–§ 7 boundary only.
- condition: { ">": [ { "var": "affected_files_outside_docs_dir" }, 0 ] }
  action: abort
  note: this design touches `docs/workflow-architecture.md` only; any other file modification is out of scope and must be queued as followup_flow.

## next_step

verify
