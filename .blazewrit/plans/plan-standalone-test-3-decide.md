---
flow_id: plan-standalone-test-3
flow_type: plan-standalone
step: decide
mode: design
schema_version: 1
captured_at: 2026-05-17T05:18:00Z
ground_ref: .blazewrit/grounds/plan-standalone-test-3.md
investigate_ref: .blazewrit/investigations/plan-standalone-test-3.md
# intent_card_id: OMITTED (emberdeck unavailable per Ground verification_proof — R13/R14 fail-loud, no placeholder)
# pyreez_deliberation_ref: OMITTED (pyreez binary absent per Ground `which pyreez` exit 1) — deliberation surfaced inline below
next_step: report
---

# Decide(Design) Artifact — plan-standalone-test-3

## based_on

- investigate_ref: .blazewrit/investigations/plan-standalone-test-3.md (compatibility_verdict=needs_clarification with 3 blocking questions; risk_surface 5 items)
- ground_ref: .blazewrit/grounds/plan-standalone-test-3.md (git HEAD 68157b0; AGENTS.md sha256 126e38c1…1afea)

## clarification_resolution

Investigate emitted `compatibility_verdict.result: needs_clarification` with 3 blocking questions
(q1 terminology, q2 audience/format, q3 relation to WORKFLOW_PLAN.md/EXECUTION_PLAN.md).
Per R15, scope/audience/format choices are *decisions*, not facts — Decide territory. Resolutions:

- q1 → scope = full 10-directory step pool, framed as "9 core steps + Triage pre-flow gate"
  (reconciles AGENTS.md:9 enumeration with `ls steps/` = 10 by making the gate/core distinction
  explicit; preserves user's "9-step" phrasing while disclosing Triage).
- q2 → audience = contributor reference; format = single Markdown reference doc with one §
  per step + chain diagram block; not onboarding tutorial, not operator runbook.
- q3 → relation = *complement*, not supersede. New doc is a normative architecture reference;
  WORKFLOW_PLAN.md / EXECUTION_PLAN.md retain planning-history role. Cross-link both ways.

No `request_upstream_deepen` issued: all three questions are scoping decisions, not fact gaps.

## options_deliberated

- id: O1
  approach: Single reference doc `docs/workflow-architecture.md` with explicit
    "9 core steps + Triage pre-flow gate" framing, per-step section, chain diagram,
    agent-count reconciliation note (16 producer+reviewer agents vs 17 `.claude/agents/`
    entries including README.md).
  trade_offs:
    pro: One canonical landing page; addresses terminology conflict head-on;
      low coordination cost with existing AGENTS.md (links, not duplicates).
    con: Single file grows if step content expands; per-step depth bounded.
  est_effort: small

- id: O2
  approach: Per-step doc pages under `docs/workflow/<step>.md` (10 files) + index page.
  trade_offs:
    pro: Granular; each step page can deepen independently; aligns with
      `steps/<name>/README.md` already-existing layout.
    con: Duplicates step READMEs without clear delta; 11 new files for documentation
      that already lives in `steps/*/README.md`; high redundancy risk
      (Investigate risk_surface#doc-overlap).
  est_effort: medium

- id: O3
  approach: Inline expansion of AGENTS.md §"Step pool" into full architecture section.
  trade_offs:
    pro: Zero new files; readers find architecture at the canonical entry doc.
    con: AGENTS.md is contract-style and short by design; bloating it dilutes its role
      as agent-instruction surface; modifies a sha256-pinned file Ground anchored on.
  est_effort: trivial

## chosen

option_id: O1
rationale: O1 best addresses Investigate risk_surface#terminology-mismatch (explicit
  9-core+1-gate framing) and #agent-count-drift (reconciliation note) without
  incurring O2's redundancy-with-steps/*/README.md or O3's contract-doc bloat.
  Effort=small matches plan-standalone scope (no Spec/Implement steps in chain).

## chosen_architecture

doc_path: docs/workflow-architecture.md
structure:
  - § 1 Overview — what "workflow" means here (flow_type → step composition rule from flows/README.md).
  - § 2 Chain shape — `Triage → Flow[Ground → Investigate → Decide → Spec? → Core Steps → Verify → Reflect]` block, lifted verbatim from AGENTS.md:7.
  - § 3 The 9 core steps — one subsection per step (Ground, Investigate, Decide, Spec, Test, Implement, Report, Verify, Reflect). Each subsection: (a) one-line purpose, (b) input artifact, (c) output artifact path under `.blazewrit/<step-area>/`, (d) reviewer presence (Verify/Reflect = none), (e) link to `steps/<name>/README.md`.
  - § 4 Triage as pre-flow gate — explains why Triage sits outside the 9 and what it dispatches on (flow_type classification).
  - § 5 Agent layer — 9 producer + 7 reviewer = 16 agent files; note that `.claude/agents/` directory listing returns 17 due to README.md. Link to `.claude/agents/README.md`.
  - § 6 Flow types — pointer to flows/README.md (do not duplicate the 16+ flow definitions).
  - § 7 Cross-references — back-links to AGENTS.md, WORKFLOW_PLAN.md (history/rationale), EXECUTION_PLAN.md (delivery sequencing).

front_matter:
  - Title, captured_at, git_head anchor (68157b0), source_files block listing AGENTS.md sha256 + flows/README.md sha256 from Ground.

constraints_honored:
  - English-only document body (AGENTS.md:21).
  - Prose generated specific to this repo, not template (AGENTS.md:22).
  - Step count claims grounded in AGENTS.md:9 + `ls steps/` reconciliation; no invented numbers.

## policies

- P1 (terminology): doc uses phrase "9 core steps + Triage pre-flow gate" everywhere step count is mentioned. Plain "10 steps" or plain "9 steps" without qualifier is disallowed in this doc.
- P2 (agent count): every mention of agent count must use form "16 agents (9 producer + 7 reviewer)" and reference that `.claude/agents/` listing contains 16 agent files + 1 README.md = 17 entries.
- P3 (no duplication): per-step subsection MUST link to `steps/<name>/README.md` rather than restating its body.
- P4 (verifiability): every numeric claim (9, 7, 16, 17) appears at least once near a path the reader can run `ls` / `grep` against.
- P5 (provenance): front-matter records git HEAD sha and source-file sha256s consumed; no claim without a pin.

## user_flows

- UF1 contributor-first-day: reader opens AGENTS.md → follows link to docs/workflow-architecture.md → reads § 2 chain shape → drills into a specific step via § 3 subsection link → lands on `steps/<name>/README.md`.
- UF2 reviewer-audit: reader greps for "9 core steps" or "16 agents" → finds doc → verifies counts against `ls steps/` and `ls .claude/agents/` → confirms reconciliation notes match observed filesystem.
- UF3 historical-context: reader reaches doc → § 7 cross-reference → opens WORKFLOW_PLAN.md for design history.

## requirements

- id: REQ-1
  description: docs/workflow-architecture.md exists at repo root-relative path.
  verify_probe:
    type: file_exists
    target: docs/workflow-architecture.md
    expected_result: file present, non-empty
    negative_test: absent file → FAIL

- id: REQ-2
  description: Document contains a chain-shape block matching AGENTS.md:7 (Triage → Flow[…]).
  verify_probe:
    type: grep
    target: docs/workflow-architecture.md
    expected_result: "regex `Triage\\s*[→-]>?\\s*Flow\\[` matches ≥1 line"
    negative_test: no match → FAIL

- id: REQ-3
  description: Document enumerates all 9 core step names verbatim.
  verify_probe:
    type: command
    target: "for s in Ground Investigate Decide Spec Test Implement Report Verify Reflect; do grep -qw \"$s\" docs/workflow-architecture.md || { echo MISS $s; exit 1; }; done; echo OK"
    expected_result: stdout final line == "OK"
    negative_test: any "MISS <name>" line → FAIL

- id: REQ-4
  description: Document discusses Triage as pre-flow gate (separate from the 9).
  verify_probe:
    type: grep
    target: docs/workflow-architecture.md
    expected_result: "regex `(?i)triage.*(pre-flow|gate)` matches ≥1 line"
    negative_test: no match → FAIL

- id: REQ-5
  description: Document reconciles 16 vs 17 agents-directory entry count.
  verify_probe:
    type: command
    target: "grep -E '16 agents' docs/workflow-architecture.md && grep -E '17( entries| files)' docs/workflow-architecture.md"
    expected_result: both greps exit 0
    negative_test: either grep exit ≠ 0 → FAIL

- id: REQ-6
  description: Document records git HEAD anchor 68157b0 (or full sha) in front matter.
  verify_probe:
    type: grep
    target: docs/workflow-architecture.md
    expected_result: "regex `68157b0` matches ≥1 line within first 40 lines"
    negative_test: no match in head-40 → FAIL

- id: REQ-7
  description: Document body is English (per AGENTS.md:21).
  verify_probe:
    type: command
    target: "perl -CSD -ne 'print if /\\p{Hangul}/' docs/workflow-architecture.md | wc -l"
    expected_result: stdout == "0"
    negative_test: nonzero count → FAIL

- id: REQ-8
  description: Each per-step subsection links to steps/<name>/README.md.
  verify_probe:
    type: command
    target: "for s in ground investigate decide spec test implement report verify reflect; do grep -q \"steps/$s/README.md\" docs/workflow-architecture.md || { echo MISS $s; exit 1; }; done; echo OK"
    expected_result: stdout final line == "OK"
    negative_test: any MISS → FAIL

- id: REQ-9
  description: Document cross-references AGENTS.md, flows/README.md, WORKFLOW_PLAN.md, EXECUTION_PLAN.md.
  verify_probe:
    type: command
    target: "grep -q AGENTS.md docs/workflow-architecture.md && grep -q flows/README.md docs/workflow-architecture.md && grep -q WORKFLOW_PLAN.md docs/workflow-architecture.md && grep -q EXECUTION_PLAN.md docs/workflow-architecture.md"
    expected_result: combined exit 0
    negative_test: any link missing → FAIL

- id: REQ-10
  description: Document length is non-trivial (≥ 80 lines) to ensure substance over template.
  verify_probe:
    type: line_count
    target: docs/workflow-architecture.md
    expected_result: line count ≥ 80
    negative_test: < 80 → FAIL

## task_list

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

## sequencing

T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 (strict linear; each task appends one
section so acceptance is locally testable). No parallelism warranted at this size.

## gate_rules

- condition: { "==": [ { "var": "T9.acceptance_test.result" }, "fail" ] }
  action: pivot
  note: rerun failing REQ probes; remediate inside existing § 1–§ 7 boundary only.
- condition: { ">": [ { "var": "affected_files_outside_docs_dir" }, 0 ] }
  action: abort
  note: this design touches `docs/workflow-architecture.md` only; any other file modification is out of scope and must be queued as followup_flow.

## risk_handling

Mapping Investigate risk_surface → mitigation:
- terminology-mismatch → P1 + REQ-3/REQ-4 + T4.
- agent-count-drift → P2 + REQ-5 + T6.
- doc-overlap → § 7 cross-link strategy (T8); doc positions itself as reference, not plan.
- clean-worktree-uncertainty → unaffected (documentation-only change; commit-time verification deferred to Verify step convention).
- ed-absent → doc avoids edge-claims requiring ED; sticks to README-derived facts only.

## followup_flows

- type: investigate-only
  scope: "Read WORKFLOW_PLAN.md and EXECUTION_PLAN.md to determine whether any content in this new doc should instead retire or supersede sections there. Queued because Ground did not inspect those files' contents."
- type: record
  scope: "If/when emberdeck is reinstalled, capture an intent_card for this architecture-reference doc so future Decide runs can attach to it."

## next_step

report
