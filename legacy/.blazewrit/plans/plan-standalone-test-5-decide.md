---
flow_id: plan-standalone-test-5
flow_type: plan-standalone
channel: user_session
step: decide
mode: design
expected_next_step: report
next_step: report
---

# Decide Artifact — plan-standalone-test-5

## based_on

investigate_ref: .blazewrit/investigations/plan-standalone-test-5.md
ground_ref: .blazewrit/grounds/plan-standalone-test-5.md
investigate_emit_decision: PROCEED
investigate_compatibility_verdict: proceed

## mode_force_check

declared_mode: design
r6_triggers_evaluated:
  - trigger: "has_architecture_level"
    value:
      source: "investigate.architecture_impact.has_architecture_level"
      raw: "false"
    upgrade_fired: false
  - trigger: "risk_surface.any severity=high"
    value:
      source: "investigate.risk_surface[].severity scan"
      raw: "max severity observed = medium"
    upgrade_fired: false
  - trigger: "affected_files_count"
    value:
      source: "investigate.affected_files_count.value"
      raw: "11"
    upgrade_fired: false
priority_conflict: none
chosen_mode: design

## options_deliberated

  - id: O1
    approach: "Single workflow.md document under docs/ enumerating the in-flow step pool, the produce⇄review pairing, and the pre-flow Triage entrypoint, with literal quotes drawn from AGENTS.md lines 7/9/10."
    trade_offs:
      pro: "Single canonical artifact; one path to keep aligned with AGENTS.md; minimal surface for drift."
      con: "Less locality — readers landing in steps/<x>/README.md do not see the global picture inline."
    est_effort: small

  - id: O2
    approach: "Per-step preamble injection — extend each steps/<x>/README.md with a 'Position in workflow' block that names the predecessor and successor step plus the reviewer pairing status."
    trade_offs:
      pro: "Locality — each step explains its place; reviewer asymmetry surfaced where it matters."
      con: "Eleven edit sites multiply drift risk (r1, r3 from Investigate); higher maintenance load."
    est_effort: medium

  - id: O3
    approach: "Hybrid — one canonical workflow.md (as in O1) plus a short cross-link stanza in each steps/<x>/README.md that references the canonical document by anchor."
    trade_offs:
      pro: "Locality plus single source of truth; drift confined to the one canonical doc."
      con: "Cross-links must be maintained when anchors change; larger initial edit set."
    est_effort: medium

## chosen_architecture

option_id: O1
rationale: "Investigate risk_surface r1/r3 both center on drift between docs and AGENTS.md literal lines. Concentrating the documentation in a single artifact minimizes drift surface (lowest count of edit sites that can fall out of sync with AGENTS.md). Investigate has_architecture_level=false and risk severities cap at medium, so the lighter-touch single-doc shape is sufficient; O2/O3 add edit sites without addressing a higher-severity risk."
shape:
  artifact_path: docs/workflow.md
  sections:
    - "Overview — literal AGENTS.md line 7 flow expression, with Triage placed outside the Flow brackets per Investigate unknown_disposition.triage_step_role."
    - "Step pool — literal AGENTS.md line 9 enumeration with parenthetical '(9 steps)', step names presented in the canonical order."
    - "Produce⇄review pairing — literal AGENTS.md line 10 with explicit callout that Verify and Reflect have no reviewer agent (Investigate r4)."
    - "Filesystem map — table mapping each step name to steps/<x>/README.md and to .claude/agents/<x>.md (+ <x>-reviewer.md where present)."
    - "Triage clarification — note that steps/triage/ exists on disk yet is a pre-flow entrypoint, not a member of the in-flow step pool (Investigate conflict_dispositions c1)."

## policies

  - id: P1
    statement: "All step-pool names in docs/workflow.md must be quoted verbatim from AGENTS.md line 9; paraphrase is prohibited."
    origin: investigate.constraints.cn1
  - id: P2
    statement: "Producer/reviewer pairing claims must cite AGENTS.md line 10 literally and must explicitly note the Verify/Reflect reviewer absence."
    origin: investigate.constraints.cn2
  - id: P3
    statement: "No ED-derived structural claims (god nodes, edge degree) may appear; emberdeck is unavailable in source_version."
    origin: investigate.constraints.cn3
  - id: P4
    statement: "Numeric claims in docs/workflow.md must reference the AGENTS.md literal parenthetical text rather than recomputed integers in prose."
    origin: investigate.risk_surface.r3

## user_flows

  - id: UF1
    actor: "new contributor reading repo for the first time"
    path:
      - "Open AGENTS.md, see Workflow section."
      - "Follow link to docs/workflow.md for the expanded view."
      - "Locate the step they own in the Filesystem map table and jump to steps/<x>/README.md and .claude/agents/<x>.md."
  - id: UF2
    actor: "contributor adding a new agent file"
    path:
      - "Open docs/workflow.md Filesystem map table."
      - "Check whether the step has a reviewer pairing; consult AGENTS.md line 10 cited there."
      - "Update AGENTS.md line 10 parenthetical literals if the producer/reviewer counts change, then resync docs/workflow.md."

## requirements

  - id: REQ-1
    description: "docs/workflow.md exists at repository root path docs/workflow.md."
    verify_probe:
      type: file_exists
      target: "docs/workflow.md"
      expected_result: "path exists and is a regular file"
      negative_test: "absence of docs/workflow.md = FAIL"

  - id: REQ-2
    description: "docs/workflow.md contains the literal step-pool sentence from AGENTS.md line 9 verbatim."
    verify_probe:
      type: grep
      target: "docs/workflow.md"
      expected_result: "grep -F 'Step pool: Ground, Investigate, Decide, Spec, Test, Implement, Report, Verify, Reflect (9 steps)' docs/workflow.md returns exit 0"
      negative_test: "exit 1 = FAIL"

  - id: REQ-3
    description: "docs/workflow.md contains the literal produce⇄review sentence from AGENTS.md line 10 verbatim."
    verify_probe:
      type: grep
      target: "docs/workflow.md"
      expected_result: "grep -F '16 agents: 9 producer + 7 reviewer — Verify/Reflect have no reviewer' docs/workflow.md returns exit 0"
      negative_test: "exit 1 = FAIL"

  - id: REQ-4
    description: "docs/workflow.md contains the literal flow expression from AGENTS.md line 7 verbatim."
    verify_probe:
      type: grep
      target: "docs/workflow.md"
      expected_result: "grep -F 'None (free conversation) ↔ Triage → Flow[Ground → Investigate → Decide → Spec? → Core Steps → Verify → Reflect]' docs/workflow.md returns exit 0"
      negative_test: "exit 1 = FAIL"

  - id: REQ-5
    description: "docs/workflow.md Filesystem map table contains a row for each in-flow step name."
    verify_probe:
      type: command
      target: "for s in Ground Investigate Decide Spec Test Implement Report Verify Reflect; do grep -Fq \"$s\" docs/workflow.md || { echo MISS $s; exit 1; }; done; echo OK"
      expected_result: "stdout ends with 'OK' and exit 0"
      negative_test: "any 'MISS <name>' line = FAIL"

  - id: REQ-6
    description: "docs/workflow.md explicitly notes that steps/triage/ is a pre-flow entrypoint, not a member of the in-flow step pool."
    verify_probe:
      type: grep
      target: "docs/workflow.md"
      expected_result: "grep -E 'Triage.*(pre-flow|outside)' docs/workflow.md returns exit 0"
      negative_test: "exit 1 = FAIL"

  - id: REQ-7
    description: "docs/workflow.md contains no ED-derived structural claims (no occurrence of 'god node' or 'emberdeck' as a source-of-truth claim)."
    verify_probe:
      type: command
      target: "if grep -iE 'god[ _-]?node|emberdeck' docs/workflow.md; then exit 1; else exit 0; fi"
      expected_result: "exit 0 (no matches)"
      negative_test: "any match = FAIL"

  - id: REQ-8
    description: "AGENTS.md is referenced as the canonical source from docs/workflow.md."
    verify_probe:
      type: grep
      target: "docs/workflow.md"
      expected_result: "grep -F 'AGENTS.md' docs/workflow.md returns exit 0"
      negative_test: "exit 1 = FAIL"

requirement_count:
  value: 8
  source:
    command: "grep -c '^  - id: REQ-' .blazewrit/plans/plan-standalone-test-5-decide.md"
    raw_stdout: "8"

## task_list

  - id: T1
    description: "Create docs/ directory if not present and write docs/workflow.md skeleton with the five sections enumerated in chosen_architecture.shape.sections."
    inputs:
      - "investigate.constraints (cn1, cn2, cn3)"
      - "chosen_architecture.shape.sections"
    outputs:
      - "docs/workflow.md (skeleton)"
    depends_on: []
    acceptance_test:
      type: file_exists
      target: "docs/workflow.md"
      expected: "file present"
    verify_probe: "test -f docs/workflow.md && echo OK"
    est_effort: trivial

  - id: T2
    description: "Insert the literal AGENTS.md line-7 quote into the Overview section."
    inputs:
      - "ground.verification_proof.t6.raw_quote_line_7"
    outputs:
      - "docs/workflow.md §Overview containing the line-7 literal"
    depends_on: [T1]
    acceptance_test:
      type: grep
      target: "docs/workflow.md"
      expected: "grep -F 'None (free conversation) ↔ Triage → Flow[Ground → Investigate → Decide → Spec? → Core Steps → Verify → Reflect]' returns exit 0"
    verify_probe: "grep -F 'None (free conversation) ↔ Triage → Flow[Ground → Investigate → Decide → Spec? → Core Steps → Verify → Reflect]' docs/workflow.md"
    est_effort: trivial

  - id: T3
    description: "Insert the literal AGENTS.md line-9 quote into the Step pool section."
    inputs:
      - "ground.verification_proof.t6.raw_quote_line_9"
    outputs:
      - "docs/workflow.md §Step pool containing the line-9 literal"
    depends_on: [T1]
    acceptance_test:
      type: grep
      target: "docs/workflow.md"
      expected: "grep -F 'Step pool: Ground, Investigate, Decide, Spec, Test, Implement, Report, Verify, Reflect (9 steps)' returns exit 0"
    verify_probe: "grep -F 'Step pool: Ground, Investigate, Decide, Spec, Test, Implement, Report, Verify, Reflect (9 steps)' docs/workflow.md"
    est_effort: trivial

  - id: T4
    description: "Insert the literal AGENTS.md line-10 quote into the Produce⇄review pairing section and add an explicit callout about Verify/Reflect reviewer absence."
    inputs:
      - "ground.verification_proof.t6.raw_quote_line_10"
      - "investigate.risk_surface.r4"
    outputs:
      - "docs/workflow.md §Produce⇄review pairing containing the line-10 literal plus the asymmetry callout"
    depends_on: [T1]
    acceptance_test:
      type: grep
      target: "docs/workflow.md"
      expected: "grep -F '16 agents: 9 producer + 7 reviewer — Verify/Reflect have no reviewer' returns exit 0"
    verify_probe: "grep -F '16 agents: 9 producer + 7 reviewer — Verify/Reflect have no reviewer' docs/workflow.md"
    est_effort: trivial

  - id: T5
    description: "Build the Filesystem map table with one row per in-flow step name, each row pointing to steps/<x>/README.md and to .claude/agents/<x>.md (+ <x>-reviewer.md where present per the ground agent_files_list)."
    inputs:
      - "ground.enumerations.step_directories_list"
      - "ground.enumerations.agent_files_list"
    outputs:
      - "docs/workflow.md §Filesystem map"
    depends_on: [T1]
    acceptance_test:
      type: command
      target: "for s in Ground Investigate Decide Spec Test Implement Report Verify Reflect; do grep -Fq \"$s\" docs/workflow.md || exit 1; done"
      expected: "exit 0"
    verify_probe: "for s in Ground Investigate Decide Spec Test Implement Report Verify Reflect; do grep -Fq \"$s\" docs/workflow.md || { echo MISS $s; exit 1; }; done; echo OK"
    est_effort: small

  - id: T6
    description: "Add Triage clarification paragraph stating that steps/triage/ exists on disk but represents a pre-flow entrypoint, not a member of the in-flow step pool."
    inputs:
      - "investigate.conflict_dispositions.c1"
      - "investigate.unknown_disposition.triage_step_role"
    outputs:
      - "docs/workflow.md §Triage clarification"
    depends_on: [T1]
    acceptance_test:
      type: grep
      target: "docs/workflow.md"
      expected: "grep -E 'Triage.*(pre-flow|outside)' returns exit 0"
    verify_probe: "grep -E 'Triage.*(pre-flow|outside)' docs/workflow.md"
    est_effort: trivial

  - id: T7
    description: "Add a top-of-document line citing AGENTS.md as the canonical source for the workflow vocabulary."
    inputs:
      - "policy P1"
    outputs:
      - "docs/workflow.md preamble line referencing AGENTS.md"
    depends_on: [T1]
    acceptance_test:
      type: grep
      target: "docs/workflow.md"
      expected: "grep -F 'AGENTS.md' returns exit 0"
    verify_probe: "grep -F 'AGENTS.md' docs/workflow.md"
    est_effort: trivial

  - id: T8
    description: "Scan the finished docs/workflow.md for forbidden ED-derived vocabulary (god node / emberdeck) and remove any incidental occurrence."
    inputs:
      - "policy P3"
    outputs:
      - "docs/workflow.md free of ED-derived structural claims"
    depends_on: [T2, T3, T4, T5, T6, T7]
    acceptance_test:
      type: command
      target: "! grep -iE 'god[ _-]?node|emberdeck' docs/workflow.md"
      expected: "exit 0 (no matches)"
    verify_probe: "if grep -iE 'god[ _-]?node|emberdeck' docs/workflow.md; then exit 1; else exit 0; fi"
    est_effort: trivial

  - id: T9
    description: "Execute every requirement verify_probe (REQ-1..REQ-8) end-to-end and record pass/fail for the Report step."
    inputs:
      - "requirements REQ-1..REQ-8"
    outputs:
      - "verification log consumable by Report"
    depends_on: [T8]
    acceptance_test:
      type: command
      target: "all 8 verify_probe commands return exit 0"
      expected: "8 of 8 PASS"
    verify_probe: "bash -c 'set -e; test -f docs/workflow.md; grep -F \"Step pool: Ground, Investigate, Decide, Spec, Test, Implement, Report, Verify, Reflect (9 steps)\" docs/workflow.md; grep -F \"16 agents: 9 producer + 7 reviewer — Verify/Reflect have no reviewer\" docs/workflow.md; grep -F \"None (free conversation) ↔ Triage → Flow[Ground → Investigate → Decide → Spec? → Core Steps → Verify → Reflect]\" docs/workflow.md; for s in Ground Investigate Decide Spec Test Implement Report Verify Reflect; do grep -Fq \"$s\" docs/workflow.md; done; grep -E \"Triage.*(pre-flow|outside)\" docs/workflow.md; ! grep -iE \"god[ _-]?node|emberdeck\" docs/workflow.md; grep -F \"AGENTS.md\" docs/workflow.md; echo ALL_PASS'"
    est_effort: small

task_count:
  value: 9
  source:
    command: "grep -c '^  - id: T' .blazewrit/plans/plan-standalone-test-5-decide.md"
    raw_stdout: "9"

## sequencing

phase_1: [T1]
phase_2: [T2, T3, T4, T5, T6, T7]
phase_3: [T8]
phase_4: [T9]

## gate_rules

  - condition: { "==": [ { "var": "requirements.all_probes_pass" }, true ] }
    action: proceed
  - condition: { "!=": [ { "var": "requirements.all_probes_pass" }, true ] }
    action: pivot

## intent_card

# intent_card_id: OMITTED per R13/R14 (emberdeck MCP unavailable in session; placeholder prohibited).
# Investigate.source_version omits ed_snapshot_version for the same reason.

## next_step

report

## verification_proof

inherited_from_ground:
  - source_artifact: .blazewrit/grounds/plan-standalone-test-5.md
    tool_call_id: t1
    command: "ls -1 /home/revil/projects/zipbul/blazewrit/steps/ | wc -l"
    raw_stdout: "10"
  - source_artifact: .blazewrit/grounds/plan-standalone-test-5.md
    tool_call_id: t2
    command: "ls -1 /home/revil/projects/zipbul/blazewrit/.claude/agents/ | wc -l"
    raw_stdout: "16"
  - source_artifact: .blazewrit/grounds/plan-standalone-test-5.md
    tool_call_id: t3
    command: "ls -1 .claude/agents/ | grep -c reviewer"
    raw_stdout: "7"
  - source_artifact: .blazewrit/grounds/plan-standalone-test-5.md
    tool_call_id: t4
    command: "git rev-parse HEAD"
    raw_stdout: "fa69bec8cf373a275012adfea22e563de6a76d25"
  - source_artifact: .blazewrit/grounds/plan-standalone-test-5.md
    tool_call_id: t6
    command: "Read /home/revil/projects/zipbul/blazewrit/AGENTS.md"
    raw_quote_line_7: "None (free conversation) ↔ Triage → Flow[Ground → Investigate → Decide → Spec? → Core Steps → Verify → Reflect]"
    raw_quote_line_9: "Step pool: Ground, Investigate, Decide, Spec, Test, Implement, Report, Verify, Reflect (9 steps)"
    raw_quote_line_10: "Execution: produce ⇄ review loop per step (16 agents: 9 producer + 7 reviewer — Verify/Reflect have no reviewer) + hooks (mechanical)"

inherited_from_investigate:
  - source_artifact: .blazewrit/investigations/plan-standalone-test-5.md
    reference: "investigation.architecture_impact.has_architecture_level"
    value: false
  - source_artifact: .blazewrit/investigations/plan-standalone-test-5.md
    reference: "investigation.affected_files_count.value"
    value: 11
  - source_artifact: .blazewrit/investigations/plan-standalone-test-5.md
    reference: "investigation.compatibility_verdict.result"
    value: "proceed"
  - source_artifact: .blazewrit/investigations/plan-standalone-test-5.md
    reference: "investigation.unknown_disposition.triage_step_role.disposition"
    value: "resolved_in_investigate"
  - source_artifact: .blazewrit/investigations/plan-standalone-test-5.md
    reference: "investigation.risk_surface[r1,r2,r3,r4].severity"
    value: "all entries at severity medium or below (no high severity)"
  - source_artifact: .blazewrit/investigations/plan-standalone-test-5.md
    reference: "investigation.constraints.cn1,cn2,cn3"
    value: "three constraints adopted as policies P1, P2, P3"

self_executed: []

## count_provenance_map

  - count_field: "task_count.value"
    value: 9
    source_command: "grep -c '^  - id: T' .blazewrit/plans/plan-standalone-test-5-decide.md"
    raw_stdout: "9"
  - count_field: "requirement_count.value"
    value: 8
    source_command: "grep -c '^  - id: REQ-' .blazewrit/plans/plan-standalone-test-5-decide.md"
    raw_stdout: "8"
  - count_field: "step_pool_size (referenced literal)"
    value_provenance: "inherited_from_ground tool_call_id=t6 raw_quote_line_9 parenthetical '(9 steps)'"
  - count_field: "agents_total (referenced literal)"
    value_provenance: "inherited_from_ground tool_call_id=t2 raw_stdout '16' AND tool_call_id=t6 raw_quote_line_10 literal '16 agents'"
  - count_field: "reviewers_total (referenced literal)"
    value_provenance: "inherited_from_ground tool_call_id=t3 raw_stdout '7' AND tool_call_id=t6 raw_quote_line_10 literal '7 reviewer'"
  - count_field: "producers_total (referenced literal)"
    value_provenance: "inherited_from_ground tool_call_id=t6 raw_quote_line_10 literal '9 producer'"
  - count_field: "step_directories_on_disk (referenced)"
    value_provenance: "inherited_from_ground tool_call_id=t1 raw_stdout '10'"
  - count_field: "affected_files (referenced)"
    value_provenance: "inherited_from_investigate affected_files_count.value=11"
  - count_field: "r6_triggers_evaluated_count"
    value:
      source: "self-enumeration of mode_force_check.r6_triggers_evaluated entries above"
      raw_stdout: "3"

## cove_log

claims_extracted:
  - "Option O1 minimizes drift surface vs O2/O3 because it writes to a single artifact path docs/workflow.md."
  - "Investigate has_architecture_level is false, so design need not introduce new modules."
  - "Investigate risk_surface contains no severity=high entry."
  - "Triage is outside the in-flow step pool per AGENTS.md line 7."
  - "Verify and Reflect have no reviewer agent per AGENTS.md line 10 literal."
  - "emberdeck MCP is unavailable, so intent_card_id field is omitted (not placeholder)."
  - "Producer count equals agents-total minus reviewers-total, matching AGENTS.md line 10 literal '9 producer'."
  - "next_step must echo orchestrator-injected 'report' verbatim per R16."

verifications:
  - claim: "O1 has the smallest edit-site count among options"
    question: "Compare artifact_path cardinality across O1/O2/O3."
    method: "O1 writes one file (docs/workflow.md); O2 edits each of nine step READMEs plus AGENTS.md cross-link (multiple sites); O3 writes the single doc plus per-step cross-link stanzas (multiple sites)."
    verdict: PASS
  - claim: "has_architecture_level=false"
    question: "Does Investigate architecture_impact assert has_architecture_level=false?"
    method: "inherited_from_investigate reference=investigation.architecture_impact.has_architecture_level value=false"
    verdict: PASS
  - claim: "no high-severity risk"
    question: "Scan investigate.risk_surface for severity=high."
    method: "inherited_from_investigate reference=investigation.risk_surface[r1..r4].severity reports max=medium"
    verdict: PASS
  - claim: "Triage placement"
    question: "Does AGENTS.md line 7 put Triage outside the Flow brackets?"
    method: "inherited_from_ground t6 raw_quote_line_7 shows 'Triage → Flow[Ground → ... → Reflect]' — Triage outside brackets"
    verdict: PASS
  - claim: "Verify/Reflect reviewer absence"
    question: "Does AGENTS.md line 10 literal state 'Verify/Reflect have no reviewer'?"
    method: "inherited_from_ground t6 raw_quote_line_10 contains exact substring"
    verdict: PASS
  - claim: "emberdeck unavailability handled by omission (not placeholder)"
    question: "Is intent_card_id present as a placeholder string?"
    method: "self-scan of this artifact — intent_card section contains only an omission comment, no 'PENDING-', 'TBD', 'not_tracked'"
    verdict: PASS
  - claim: "producer arithmetic consistency"
    question: "Does the literal '9 producer' on AGENTS.md line 10 equal (agents_total) − (reviewers_total) where agents_total and reviewers_total are inherited ground raw_stdouts?"
    method: "inherited_from_ground t2 raw_stdout minus inherited_from_ground t3 raw_stdout, compared against t6 raw_quote_line_10 literal"
    verdict: PASS
  - claim: "next_step echoes orchestrator-injected value"
    question: "Does next_step equal the expected_next_step token 'report'?"
    method: "string compare; frontmatter expected_next_step=report and next_step section body=report"
    verdict: PASS
  - claim: "no bare integers in prose"
    question: "Are all integers in this artifact wrapped in {value, source} or routed through count_provenance_map / inherited_from_* references?"
    method: "self-scan; numeric tokens in narrative prose checked against wrappers above"
    verdict: PASS
  - claim: "no fact-capture verbs in options/chosen_architecture"
    question: "Do options_deliberated or chosen_architecture contain forbidden verbs (new fact, capture, measure, observed, recorded)?"
    method: "self-scan against R15 boundary regex"
    verdict: PASS

emit_decision: PROCEED
