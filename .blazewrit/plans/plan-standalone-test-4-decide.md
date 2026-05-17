---
flow_id: plan-standalone-test-4
flow_type: plan-standalone
channel: user_session
step: decide
mode: design
expected_next_step: report
ground_ref: .blazewrit/grounds/plan-standalone-test-4.md
investigate_ref: .blazewrit/investigations/plan-standalone-test-4.md
---

# Decide(Design): plan-standalone-test-4

## mode

design

## based_on

investigate_ref: .blazewrit/investigations/plan-standalone-test-4.md
ground_ref: .blazewrit/grounds/plan-standalone-test-4.md

## options_deliberated

- id: O1
  approach: "Single-file workflow architecture doc at docs/workflow.md describing the 9-step pool + triage gate + 16-agent topology + tool coupling, with explicit reconciliation sections for c1/c2."
  trade_offs:
    pro: "One canonical location; downstream report step has a single target to summarize; readers find architecture at predictable path."
    con: "Adds a new top-level docs/ tree; project currently has none (Ground enumerated no docs/ directory)."
  est_effort: small

- id: O2
  approach: "Expand AGENTS.md in-place with full architecture section replacing the terse 'Workflow' bullet."
  trade_offs:
    pro: "No new files; matches AGENTS.md self-declared canonical role per Investigate.unknown_disposition.workflow_definitive_source."
    con: "AGENTS.md is the agent-instruction entry; bloating it with reference architecture mixes operational instructions with descriptive docs."
  est_effort: small

- id: O3
  approach: "Per-step README augmentation only — leave AGENTS.md untouched, add architecture context to each steps/<step>/README.md."
  trade_offs:
    pro: "Co-locates description with definition."
    con: "No single-page overview; c1 (triage asymmetry) and c2 (verify/reflect reviewer absence) cannot be reconciled in any one file; fragments the architectural narrative."
  est_effort: medium

## chosen_architecture

option_id: O1
rationale: "O1 produces a single addressable artifact that the next step (report) can consume verbatim. O2 mixes concerns; O3 fragments the c1/c2 reconciliation across 10 files. O1 also preserves AGENTS.md as the agent-instruction surface untouched, respecting C1 (prompts over static templates — the new doc is descriptive prose, not a template)."

target_artifact: docs/workflow.md

structure:
  - section: "Overview" — one-paragraph synopsis citing AGENTS.md Workflow line verbatim.
  - section: "Step Pool (9)" — enumerate Ground, Investigate, Decide, Spec, Test, Implement, Report, Verify, Reflect; one-line role per step sourced from steps/<step>/README.md.
  - section: "Triage Gate" — document the 10th directory (steps/triage/) as a pre-flow gate, reconciling c1 explicitly.
  - section: "Flow Topology" — quote AGENTS.md flow chain: "None (free conversation) ↔ Triage → Flow[Ground → Investigate → Decide → Spec? → Core Steps → Verify → Reflect]".
  - section: "Producer/Reviewer Pairing (16 agents)" — table of 9 producers + 7 reviewers; mark Verify and Reflect as reviewer-absent, reconciling c2 explicitly.
  - section: "Tool Coupling" — table of pyreez/firebat/emberdeck → step bindings, sourced verbatim from AGENTS.md Tools section.
  - section: "Source Provenance" — list AGENTS.md, steps/, .claude/agents/ as the grounding surfaces with git HEAD 99d63568 pin.

## policies

- P1: "Documentation is descriptive prose, not a template (C1 compliance)."
- P2: "All documentation prose in English (C2 compliance)."
- P3: "c1 (10 dirs vs 9 declared) reconciled by explicit Triage Gate section — triage is gate, not pool member."
- P4: "c2 (16 agents, 7 reviewers) reconciled by explicit pairing table marking Verify/Reflect as reviewer-absent."
- P5: "No claim about emberdeck-coupled runtime behavior beyond AGENTS.md verbatim quotes (R4 / C5 compliance)."
- P6: "Per-step one-line roles must be sourced from each steps/<step>/README.md (R3 mitigation — Implement step must read those READMEs before authoring lines)."

## user_flows

- F1 (reader-onboarding): New contributor opens docs/workflow.md → reads Overview → scans Step Pool table → consults Flow Topology to understand sequencing → checks Tool Coupling when configuring tools.
- F2 (drift-detection): Maintainer compares docs/workflow.md against `ls steps/` and `ls .claude/agents/`; mismatch triggers a new flow.

## requirements

- id: REQ-1
  description: "Artifact docs/workflow.md exists at repo root."
  verify_probe:
    type: file_exists
    target: docs/workflow.md
    expected_result: "file present"
    negative_test: "absence of docs/workflow.md fails REQ-1"

- id: REQ-2
  description: "Artifact enumerates all 9 step names from AGENTS.md pool verbatim."
  verify_probe:
    type: grep
    target: "docs/workflow.md"
    expected_result: "all of {Ground, Investigate, Decide, Spec, Test, Implement, Report, Verify, Reflect} appear at least once each"
    negative_test: "missing any one of the 9 names fails REQ-2"

- id: REQ-3
  description: "Artifact contains a Triage Gate section that explicitly distinguishes triage from the 9-step pool, reconciling Ground conflict c1."
  verify_probe:
    type: grep
    target: "docs/workflow.md"
    expected_result: "section heading containing 'Triage' AND prose containing both 'gate' and a reference to '9 step' / '9-step' / 'pool'"
    negative_test: "no Triage section, OR section present but does not state triage is a gate distinct from the pool — fails REQ-3"

- id: REQ-4
  description: "Artifact contains a 16-agent pairing table that marks Verify and Reflect as reviewer-absent, reconciling Ground conflict c2."
  verify_probe:
    type: grep
    target: "docs/workflow.md"
    expected_result: "table or list enumerating 9 producer rows; Verify row and Reflect row each annotate 'no reviewer' (or equivalent literal)"
    negative_test: "Verify or Reflect row missing the reviewer-absent annotation — fails REQ-4"

- id: REQ-5
  description: "Artifact quotes the AGENTS.md flow chain verbatim."
  verify_probe:
    type: grep
    target: "docs/workflow.md"
    expected_result: "literal substring 'Triage → Flow[Ground → Investigate → Decide → Spec? → Core Steps → Verify → Reflect]' present"
    negative_test: "substring absent — fails REQ-5"

- id: REQ-6
  description: "Artifact reproduces the AGENTS.md Tools section coupling (pyreez/firebat/emberdeck → steps) without inventing new tool→step bindings."
  verify_probe:
    type: grep
    target: "docs/workflow.md"
    expected_result: "rows for pyreez, firebat, emberdeck each list only the steps named in AGENTS.md Tools section (pyreez: Decide+Verify; firebat: Implement+Verify+Investigate; emberdeck: Ground+Decide+Spec+Implement+Verify)"
    negative_test: "any tool row lists a step not in AGENTS.md, or any AGENTS.md-listed step is dropped — fails REQ-6"

- id: REQ-7
  description: "Artifact pins source provenance to git HEAD 99d63568f6d6a688e4b4d40f47562792f28082e9 (from Ground)."
  verify_probe:
    type: grep
    target: "docs/workflow.md"
    expected_result: "literal substring '99d63568' present in provenance section"
    negative_test: "substring absent — fails REQ-7"

- id: REQ-8
  description: "Artifact is written entirely in English (C2)."
  verify_probe:
    type: grep
    target: "docs/workflow.md"
    expected_result: "no Hangul/CJK characters in body prose"
    negative_test: "Hangul codepoints (U+AC00–U+D7A3) detected — fails REQ-8"

## task_list

- id: T1
  description: "Read each steps/<step>/README.md for the 9 pool steps and extract a single-sentence role statement per step."
  inputs:
    - steps/ground/README.md
    - steps/investigate/README.md
    - steps/decide/README.md
    - steps/spec/README.md
    - steps/test/README.md
    - steps/implement/README.md
    - steps/report/README.md
    - steps/verify/README.md
    - steps/reflect/README.md
  outputs:
    - "9 one-line role statements (in-memory for T3)"
  depends_on: []
  acceptance_test:
    type: line_count
    target: "extracted-roles.tmp (or inline in T3 draft)"
    expected: "exactly 9 lines, one per pool step"
  verify_probe: "test $(grep -cE '^- (Ground|Investigate|Decide|Spec|Test|Implement|Report|Verify|Reflect):' docs/workflow.md) -eq 9"
  est_effort: small

- id: T2
  description: "Read steps/triage/README.md and extract the gate-vs-pool distinction language for the Triage Gate section."
  inputs:
    - steps/triage/README.md
    - AGENTS.md (Workflow line)
  outputs:
    - "Triage Gate section draft prose"
  depends_on: []
  acceptance_test:
    type: grep
    target: "docs/workflow.md"
    expected: "Triage Gate section contains both the word 'gate' and explicit non-membership statement"
  verify_probe: "grep -A5 '## Triage Gate' docs/workflow.md | grep -qi gate && grep -A5 '## Triage Gate' docs/workflow.md | grep -qE '(not (a|in) (member|the) (of the )?(9|nine)|distinct from the (9|nine)|pre-?flow)'"
  est_effort: trivial

- id: T3
  description: "Author docs/workflow.md with all 7 sections from chosen_architecture.structure, embedding T1 role statements, T2 triage prose, AGENTS.md verbatim quotes for flow chain and tool table, and git HEAD pin."
  inputs:
    - T1 outputs
    - T2 outputs
    - AGENTS.md
    - Ground (verification_proof.tool_calls.t6 for AGENTS.md verbatim content)
  outputs:
    - docs/workflow.md
  depends_on: [T1, T2]
  acceptance_test:
    type: file_exists
    target: docs/workflow.md
    expected: "file present with all 7 section headings (Overview, Step Pool, Triage Gate, Flow Topology, Producer/Reviewer Pairing, Tool Coupling, Source Provenance)"
  verify_probe: "test -f docs/workflow.md && test $(grep -cE '^## (Overview|Step Pool|Triage Gate|Flow Topology|Producer/Reviewer Pairing|Tool Coupling|Source Provenance)' docs/workflow.md) -eq 7"
  est_effort: medium

- id: T4
  description: "Add 16-agent pairing table to Producer/Reviewer Pairing section; explicitly annotate Verify and Reflect rows as reviewer-absent."
  inputs:
    - Ground.verification_proof.tool_calls.t3 (16-agent enumeration)
  outputs:
    - "Producer/Reviewer Pairing section populated in docs/workflow.md"
  depends_on: [T3]
  acceptance_test:
    type: grep
    target: "docs/workflow.md"
    expected: "9 producer rows; Verify and Reflect rows contain 'no reviewer' literal"
  verify_probe: "grep -A30 '## Producer/Reviewer Pairing' docs/workflow.md | grep -E '^\\| (Verify|Reflect) ' | grep -c 'no reviewer' | grep -q '^2$'"
  est_effort: small

- id: T5
  description: "Run final verification: execute every REQ-* verify_probe against docs/workflow.md and confirm all pass."
  inputs:
    - docs/workflow.md
  outputs:
    - "verification log (pass/fail per REQ)"
  depends_on: [T3, T4]
  acceptance_test:
    type: command
    target: "all REQ-1..REQ-8 probes"
    expected: "8/8 pass"
  verify_probe: "test -f docs/workflow.md && grep -q 'Ground' docs/workflow.md && grep -q 'Investigate' docs/workflow.md && grep -q 'Decide' docs/workflow.md && grep -q 'Spec' docs/workflow.md && grep -q 'Test' docs/workflow.md && grep -q 'Implement' docs/workflow.md && grep -q 'Report' docs/workflow.md && grep -q 'Verify' docs/workflow.md && grep -q 'Reflect' docs/workflow.md && grep -q 'Triage → Flow\\[Ground → Investigate → Decide → Spec? → Core Steps → Verify → Reflect\\]' docs/workflow.md && grep -q '99d63568' docs/workflow.md && ! grep -qP '[\\x{AC00}-\\x{D7A3}]' docs/workflow.md"
  est_effort: trivial

## gate_rules

- condition: { "==": [ { "var": "T5.acceptance_test.result" }, "pass" ] }
  action: proceed
- condition: { "!=": [ { "var": "T5.acceptance_test.result" }, "pass" ] }
  action: retry

## next_step

report

## notes

- intent_card_id field omitted per R13/R14: emberdeck unavailable in session (Ground t11: `command -v emberdeck` empty); placeholder emission prohibited.
- ed_snapshot_version / rules_version / contracts_version omitted: not tracked (Investigate.compatibility_verdict.source_version).
- R6 mode-force check: declared=design; no mechanical trigger upgrade/downgrade required (architecture-level artifact creation is appropriate for Design mode per Investigate.architecture_impact and risk_surface R1–R3 mandating explicit reconciliation policy).
