---
flow_id: plan-standalone-test-1
flow_type: plan-standalone
channel: user_session
mode: design
schema_version: 1
produced_at: 2026-05-17
based_on:
  ground_ref: .blazewrit/grounds/plan-standalone-test-1.md
  ground_sha256_basis: "Ground.verification_proof.read_files (17 sha256 rows)"
  investigate_ref: .blazewrit/investigations/plan-standalone-test-1.md
  workflow_plan_sha256: 653462267b0d78a4b12210e473643be713ff5da16f8a1f5b097c64bcc4ff8aff
  agents_md_sha256: 126e38c164ae47a2cc6ab167e54cefb7041294680a6f7ac7d730a79b7491afea
  flows_readme_sha256: 7b0838f7a2ce26bbafb5b3b6d8f8c237c0be9ffa66ad196a2a7cedc5b0af037d
  git_head_start: 2dda139a8b93c14d10a9c30b77155980c2252768
mode_force_basis:
  declared_default: design                  # flows/README.md:187 — plan-standalone Default Mode = Design
  r6_evaluation:
    investigate_compatibility_issues_len: 0       # → no Plan force
    investigate_high_risk_count: 0                # risk_surface[*].severity has no 'high' → no Plan force
    investigate_affected_files_count: 22          # ≥ 5 (Plan force threshold), but declared=design supersedes (Design ⊇ Plan)
    investigate_has_architecture_level: false     # → no Design force from R6
  resolution: "declared=design satisfies and dominates the R6 ≥5 affected_files Plan force; Design mode proceeds."
triage_mismatch_check: not_present              # Investigate confirms classification; no reclassify
upstream_deepen_request: not_required           # Ground+Investigate output sufficient for synthesis; ED absence accepted via Investigate r2 + ground_unknowns_addressed.ed_query
intent_card_id: "PENDING-emberdeck-unavailable" # see provenance.tool_availability — placeholder, must be created by emberdeck when MCP returns
---

# Decide (Design) — plan-standalone-test-1

**Request**: "Document the 9-step workflow architecture used in this blazewrit repo (see WORKFLOW_PLAN.md, steps/ directory)."

This Design artifact answers two designs at once:

1. **Documentation design** — how the plan-standalone synthesis output is *structured* (options_deliberated, sequencing).
2. **Architecture-being-documented** — the *content* of the architecture itself (chosen_architecture, policies, user_flows, requirements).

The plan-standalone flow's terminal artifact is `.blazewrit/plans/<flow-id>-plan.md` (flows/README.md:282). This Decide document is the immediate predecessor (`-decide.md`) consumed by the downstream Report step to produce that terminal artifact.

---

## options_deliberated

Three documentation-shape options were considered. pyreez `deliberate` was **not** invoked (MCP unavailable per Ground.unknowns.pyreez_baseline); deliberation was performed inline against Investigate constraints c1–c6 and risks r1–r6.

```yaml
- id: opt-A
  name: linear-chain-narrative
  approach: |
    Walk the canonical chain `None ↔ Triage → Flow[Ground → Investigate →
    Decide → Spec? → Core Steps → Verify → Reflect]` step-by-step. Each
    step gets one section: responsibility, I/O artifact, tools, reviewer,
    adaptive-depth caps. Concludes with the Flow-by-Type table.
  trade_offs:
    pro: |
      Mirrors AGENTS.md:7 and WORKFLOW_PLAN.md:16 verbatim — easiest to
      verify against source-of-truth chain. Linear reading order.
    con: |
      Cross-cutting policies (Step Depth, Active Safety / Data Discipline /
      Learning split, Compound recursion, P0 precedence, RETRY_EXHAUSTED,
      Triage reclassify cap) get *fragmented* across step sections.
      Triggers risk r1 (god-node WORKFLOW_PLAN.md coverage omission).
  est_effort: low

- id: opt-B
  name: layered-architecture           # CHOSEN
  approach: |
    Four documentation layers, each layer is a self-contained section:
      L1 Chain & Step Pool (the 9 + classifier shape)
      L2 Execution Pattern (produce ⇄ review, reviewer pairing, fail caps)
      L3 Cross-cutting Policies (depth, safety/discipline/learning,
         flow-state, hooks, tool restrictions per agent)
      L4 Flow Catalog (16 flow types + Decide Mode by Flow + volatile
         profile by flow + reclassification rules)
    Each layer cites concrete WORKFLOW_PLAN.md / flows/README.md / AGENTS.md
    line ranges. Constraint c3 (pool=9, triage classifier) anchored in L1.
  trade_offs:
    pro: |
      Directly mitigates r1 (god-node coverage) by giving cross-cutting
      policy its own layer instead of fragmenting it. Directly mitigates
      r3 (9-vs-10 confusion) by anchoring "pool=9, triage=classifier" as
      the L1 opening contract. Compatible with c1 (universal profile),
      c3, c4, c5 simultaneously.
    con: |
      Slightly longer than opt-A. Reader must accept layer boundaries.
  est_effort: medium

- id: opt-C
  name: index-only-pointer
  approach: |
    Produce a one-page index that links to each source doc (WORKFLOW_PLAN.md,
    flows/README.md, steps/*/README.md) without synthesis. "Read these."
  trade_offs:
    pro: Lowest effort. Zero synthesis risk (cannot misquote).
    con: |
      Fails completion criterion (flows/README.md:282): "design document
      exists + next step explicitly named". An index is not a design
      document — it is a Read-list. Also fails the request's verb
      ("Document … architecture") which implies synthesis, not redirection.
      Triggers validity_check failure downstream.
  est_effort: trivial
```

### chosen

```yaml
option_id: opt-B
rationale: |
  Layered-architecture is the only option that simultaneously satisfies:
    - c1 (plan-standalone universal profile — Spec/Test/Implement/Report
      semantics described as catalog facts, not presumed-executable)
    - c3 (pool=9, triage=classifier — pinned in L1 first paragraph)
    - c4 (16 agents = 9 producer + 7 reviewer; Verify/Reflect no reviewer
      — anchored in L2)
    - c5 (canonical chain order including Spec? optionality — L1 + L4)
    - r1 mitigation (god-node coverage — L3 owns cross-cutting policy)
    - r3 mitigation (9-vs-10 confusion — L1 explicit contract)
  opt-A fragments r1 mitigation; opt-C fails completion criterion.
```

---

## chosen_architecture

The blazewrit 9-step workflow architecture, as documented from the Ground-captured sources. All claims below trace to a cited document; nothing is invented (Investigate c2 — "Surface, do not interpret" propagation).

### Canonical Chain

```
None (free conversation) ↔ Triage → Flow[ Ground → Investigate → Decide
                                          → Spec? → Core Steps
                                          → Verify → Reflect ]
```

Source: AGENTS.md:7, WORKFLOW_PLAN.md:16.

- **None**: free conversation / ideation. Triage transitions to Flow when actionable signal is detected. Discussion context inherits into the Flow.
- **Triage**: stateless classifier. Maps input → 1 of 16 flow types | `none` | `ambiguous` | `error`. Does not inspect code or flow state. *Not a member of the 9-step pool.* (WORKFLOW_PLAN.md:21, AGENTS.md:9)
- **Spec?**: optional — included only by flow types whose chain declares it (flows/README.md per-flow chains).
- **Verify**: mandatory across **all** flow types — flow-level goal check + failure routing.
- **Reflect**: runs on completion + abandonment; **not** on suspension.

### Step Pool (canonically 9 — Investigate c3)

| # | Step | One-line role | Source |
|---|------|--------------|--------|
| 1 | Ground | Evidence boundary — `Triaged intent → bounded · sourced · current facts + uncertainty`. No interpretation. | WORKFLOW_PLAN.md:37, steps/ground/README.md |
| 2 | Investigate | Task-specific interpretation — turns Ground facts into a designable problem definition. Does not decide or design. | WORKFLOW_PLAN.md:38, steps/investigate/README.md |
| 3 | Decide | Decision ownership (universal). 3 modes: Record / Plan / Design. | WORKFLOW_PLAN.md:39, steps/decide/README.md |
| 4 | Spec | AC extraction + code architecture + task decomposition. Flow-conditional. | WORKFLOW_PLAN.md:40, steps/spec/README.md |
| 5 | Test | RED tests + reproduce + coverage + profile/validate. | WORKFLOW_PLAN.md:41, steps/test/README.md |
| 6 | Implement | GREEN code + setup + atomic commits. firebat scan after every change. | WORKFLOW_PLAN.md:42, steps/implement/README.md |
| 7 | Report | Synthesis / analysis / review artifact (terminal output for non-code flows). | WORKFLOW_PLAN.md:43, steps/report/README.md |
| 8 | Verify | Flow-level goal verification (mandatory all-flows). Internal multi-pass + failure routing. | WORKFLOW_PLAN.md:44, steps/verify/README.md |
| 9 | Reflect | Post-flow learning (completion + abandonment). 3-tier distillation. | WORKFLOW_PLAN.md:45, steps/reflect/README.md |

**Filesystem note (Investigate r3)**: `steps/` directory contains **10 subdirectories** = 9 pool members + the `steps/triage/` classifier. Ten is a filesystem artifact, not a semantic step count.

### Execution Pattern (Ralph Loop — produce ⇄ review)

Every step **except Verify and Reflect** runs as a produce ⇄ review loop. The reviewer runs in a fresh context and receives only the step's output artifact (never the producer's reasoning). Source: WORKFLOW_PLAN.md:108–148.

```
Step Agent → output
  → Mechanical gates (typecheck / test / firebat, where applicable)
    → FAIL → feedback to Step Agent, retry
    → PASS → Step Reviewer (fresh context, output only)
      → PASS → next step
      → FAIL + feedback → producer retries with feedback
      → 3rd cycle fail → HALT (RETRY_EXHAUSTED — flow halt + escalate)
```

- **Cross-cycle fail cap**: 3 producer⇄reviewer fails within a single cycle = HALT. A reclassify resets the cycle counter, but `(flow_id, step_name)` cumulative fails ≥ 5 → flow-level halt.
- **Triage reclassify cap**: 3 per flow_id. flow_id is preserved across reclassify.
- **`DONE_WITH_CONCERNS` is abolished** — RETRY_EXHAUSTED now halts instead of silently proceeding. Source: WORKFLOW_PLAN.md:122.

### Step ⇄ Reviewer Pairing (16 agents total — Investigate c4)

| Step | Has Reviewer? | Reviewer agent | Quality mechanism |
|------|---------------|----------------|-------------------|
| Ground | Yes | Ground-Reviewer | Ralph Loop |
| Investigate | Yes | Investigate-Reviewer | Ralph Loop |
| Decide | Yes | Decide-Reviewer | Ralph Loop |
| Spec | Yes | Spec-Reviewer | Ralph Loop |
| Test | Yes | Test-Reviewer | Ralph Loop |
| Implement | Yes | Implement-Reviewer | Ralph Loop |
| Report | Yes | Report-Reviewer | Ralph Loop |
| Verify | **No** | — | Verify *is* the flow-level evaluator. A reviewer would create infinite recursion. Quality via internal multi-pass + pyreez cross-verification. |
| Reflect | **No** | — | Structurally guaranteed: 4-section hook check + 3-tier distillation + append-only. |

Total: **9 producer + 7 reviewer = 16**. Confirmed by Ground Bash-ls of `.claude/agents/` (16 files). Source: WORKFLOW_PLAN.md:130–148, AGENTS.md:9, Ground.neighbors `claude_agents_dir`.

### Decide Modes (universal step — no skip)

| Mode | Output | When used |
|------|--------|-----------|
| Record | 1-line decision + rationale | Trivial / single-obvious-fix flows (Chore, Bug Fix simple, Review, Release) |
| Plan | N options compared + 1 chosen + sequencing | Multi-option flows (Bug Fix Unreproducible, Refactor, Migration, Test, Retro, Spike, Exploration) |
| Design | Plan + architecture + policy + user flows + requirements + emberdeck intent card | Architectural flows (Feature, Performance, plan-standalone, Compound; Refactor/Migration on broad-scope upgrade) |

Decide is **universal across all 16 flows** (flows/README.md:3). The mode differs; the step never skips.

### Tool Scoping (firebat / emberdeck / pyreez per step)

| Tool | Used by | Purpose |
|------|---------|---------|
| **firebat** | Implement (after every change), Verify (full scan), Investigate (Migration query-dependencies) | Mechanical code scan, blockers, regression |
| **emberdeck** | Ground (graph query), Decide-Design (intent card), Spec (spec card + codeLinks), Implement (validate links), Verify (regression_guard) | Knowledge graph / intent cards |
| **pyreez** | Decide-Plan/Design (deliberation), Verify (review mode, high-risk) | Architecture deliberation / cross-verification |

Source: AGENTS.md:12–15.

### Artifact Chain (Plan-as-Prompt)

Each step produces a defined artifact. Artifacts are **maps, not summaries** — they include `files_to_read`, and the next agent reads source directly rather than trusting summaries. Missing artifact = natural failure (spec-kit pattern).

| Step | Produces | Consumed by |
|------|----------|-------------|
| Ground | `.blazewrit/grounds/<flow-id>.md` (task_subgraph + volatile_state + unknowns/conflicts + provenance + freshness) | Investigate |
| Investigate | `.blazewrit/investigations/<flow-id>.md` (impact_map + constraints + risk_surface + compatibility_verdict + ground_unknowns_addressed) | Decide |
| Decide | `.blazewrit/plans/<flow-id>-plan.md` (Record/Plan/Design output) + (Design) emberdeck intent card | Spec | Test | Implement (per flow chain) |
| Spec | `.blazewrit/plans/<flow-id>-spec.md` (AC + code architecture + tasks) + emberdeck spec card | Test, Implement |
| Test | test file paths + RED/GREEN status | Implement |
| Implement | changed file paths + commit refs | Verify |
| Report | `.blazewrit/reports/<flow-id>.md` | Verify |
| Verify | PASS/FAIL + failure_origin + details | Reflect (or back to failed step) |
| Reflect | learnings appended to instruction files | next session (auto-load) |

Source: WORKFLOW_PLAN.md:360–378.

### Runtime Substrate (citation-depth limited — Investigate c6)

The orchestrator is **`src/orchestrator.ts`** — a TypeScript script, *not* an LLM. The script mechanically guarantees the loop; AI does the work at each step. Interface surface (WORKFLOW_PLAN.md:332–340): `run`, `next`, `start`, `resume`, `abandon`, `reclassify`, `status`, `check-incomplete`. Channel split: A2A/CI uses `run` (full loop); user sessions use `start` + PostToolUse(Agent) hook calling `next`.

This synthesis intentionally does **not** describe `orchestrator.ts` internals — Investigate is forbidden from reading project source (steps/investigate/README.md:114, captured as constraint c6 and risk r4). Source above is purely from WORKFLOW_PLAN.md.

---

## policies

Cross-cutting policies anchoring the architecture. Each is a load-bearing rule that downstream Report must preserve verbatim or by faithful summary.

```yaml
- id: pol-1
  name: step-depth-adaptive
  rule: |
    Every step defaults to `shallow`. Mechanical triggers escalate to
    `deep` (per-step trigger lists in each step README). Single
    invocation may escalate mid-execution OR orchestrator may re-invoke
    with deepen.
  source: WORKFLOW_PLAN.md:47-83
  applies_to: all steps

- id: pol-2
  name: upstream-deepen-request
  rule: |
    Decide may signal `request_upstream_deepen` when shallow Ground/
    Investigate output is insufficient. Cycle cap = 1 per flow.
    Beyond cap, Verify is final safety: `failure_origin=ground|
    investigate` forces reclassify with depth=deep.
  source: WORKFLOW_PLAN.md:52-56

- id: pol-3
  name: p0-depth-precedence
  rule: |
    `flow_type=bugfix-p0` overrides all other deepen triggers — Phase 1
    runs depth=shallow regardless. Verify auto-queues Phase 2 follow-up
    flow (Bug Fix Normal depth=deep, or Retro) when post-stabilization
    needed.
  source: WORKFLOW_PLAN.md:58-72

- id: pol-4
  name: safety-discipline-learning-split
  rule: |
    Honest reclassification of the prior "7 safety layer" claim:
      Active Safety (4): orchestrator triggers / step caps / reviewer
        checklist / Verify failure routing.
      Data Discipline (2): provenance / freshness.
      Learning (1): Reflect.
    Provenance/freshness audit and Reflect learning are NOT active
    safety; they are long-term aids.
  source: WORKFLOW_PLAN.md:84-106

- id: pol-5
  name: retry-exhausted-halts
  rule: |
    3 producer⇄reviewer fails in one cycle = RETRY_EXHAUSTED → flow halt
    + escalate. Never silent proceed. `DONE_WITH_CONCERNS` is abolished.
    Cumulative (flow_id, step) ≥ 5 fails = flow-level halt (reclassify
    loop guard).
  source: WORKFLOW_PLAN.md:122-128

- id: pol-6
  name: triage-reclassify-cap
  rule: |
    Triage reclassify is capped at 3 per flow_id (flow_id preserved
    across reclassify so counter is meaningful). Excess → flow halt +
    escalate ("intent decidable failure"). Same cap for A2A/CI.
  source: WORKFLOW_PLAN.md:126

- id: pol-7
  name: flow-state-file
  rule: |
    Authoritative state lives in `.blazewrit/flow-state.json` (list of
    flows: active/suspended/completed/abandoned). Written on every step
    transition. Read at session start (Triage check). Single active
    flow at a time. Completed/abandoned flows archive to
    `.blazewrit/flow-history/`. Compound sub-flows nest inside the
    compound entry, not as separate items.
  source: WORKFLOW_PLAN.md:150-218

- id: pol-8
  name: enforcement-by-consequence
  rule: |
    Enforcement mechanism is matched to consequence severity:
      Dangerous (data loss / bad code ships) → Hook (mechanical, agent-
        independent): firebat scan, regression_guard, blocker check.
      Role violation → allowed-tools / disallowedTools per agent (host
        tool blocks; e.g. Verify cannot Edit, Reflect cannot Edit).
      Order violation → File-dependency natural failure (missing
        artifact = next step fails; spec-kit pattern).
      Conditional skip → Hook conditional check (coverage gate).
      Completion skip → Hook Stop gate (cannot end session with
        unreflected completed flow).
      Quality issue → prompt + structure check.
      Judgment error → prompt only (rules, tables, examples).
  source: WORKFLOW_PLAN.md:292-303

- id: pol-9
  name: tool-restrictions-per-agent
  rule: |
    Each .claude/agents/<step>.md frontmatter declares `tools` (allow
    list) and `mcpServers` (scoped MCP). Key restrictions:
      ground: Read + Bash + Write to .blazewrit/grounds/** only. Source
        code Write forbidden (hook-enforced).
      investigate: NO project source Read (path-restricted to docs +
        prior artifacts + .blazewrit/**); Write to .blazewrit/
        investigations/** only. WebFetch/WebSearch allowed.
      decide: Write to .blazewrit/plans/** only; emberdeck for Design
        intent card; pyreez for deliberation.
      report: No code Edit (blocked).
      verify: Read-only (Bash for execution, but no Edit/Write).
      reflect: Write instruction files only. No reviewer.
  source: WORKFLOW_PLAN.md:307-326, AGENTS.md:12-15

- id: pol-10
  name: fact-verification-protocol
  rule: |
    Training-data knowledge is hypothesis. Claims must be verified by
    direct Read or Bash execution. Unverified claims get `[UNVERIFIED]`
    / `[UNMEASURED]` tags and cannot be used as decision basis. Verify
    routes back to the responsible step when it discovers an
    `[UNVERIFIED]` tag.
  source: WORKFLOW_PLAN.md:423-437

- id: pol-11
  name: completion-criteria-non-code-flows
  rule: |
    Non-code flows (Review, Retro, Exploration, Spike, plan-standalone)
    complete when terminal artifact exists AND is substantive (GSD
    verifier Level 1 + 2: exists + not stub). plan-standalone specific:
    `.blazewrit/plans/<flow-id>-plan.md` exists + design document
    present + next step explicitly named.
  source: flows/README.md:272-282
```

---

## user_flows

The plan-standalone chain is one entry in a 16-flow catalog. Document layer L4 will present the full catalog; the immediately relevant flow chains are:

```yaml
- name: plan-standalone               # this flow's chain
  chain: |
    Ground(universal)
    → Investigate(existing cards, docs)
    → Decide(Design)              # this artifact
    → Report → Verify → Reflect
  default_decide_mode: Design
  upgrade_conditions: none
  volatile_profile: typecheck/test/lint/git
  terminal_artifact: .blazewrit/plans/<flow-id>-plan.md
  completion_criteria: design document exists + next step explicitly named
  source: flows/README.md:82-88, 187, 282

- name: feature
  chain: |
    Ground(universal)
    → Investigate(impact scope, card query, blockers, feasibility)
    → Decide(Design)              # design document + intent card
    → Spec → [Test ⇄ Implement]* → Verify → Reflect
  default_decide_mode: Design
  source: flows/README.md:10-16

- name: bug-fix-p0
  chain: |
    Ground(universal)
    → Investigate(minimal: symptom location only)
    → Decide(Record)
    → Implement(emergency) → Verify → Test(retroactive) → Reflect
  default_decide_mode: Record
  precedence: overrides all other deepen triggers (pol-3)
  source: flows/README.md:26-32

- name: compound
  chain: |
    Ground(universal)
    → Investigate(sub-flow identification)
    → Decide(Design)              # sub-flow decomposition + ordering + gate_rules
    → [Sub-Flow → Gate]* → Report → Verify → Reflect
    (each Sub-Flow runs its own Triage → Ground → Investigate → Decide → ...)
  default_decide_mode: Design
  recursion_doc: steps/decide/compound-recursion.md
  source: flows/README.md:130-139
```

Full 16-flow chain table (Feature, Bug Fix, Bug Fix P0, Bug Fix Unreproducible, Refactor, Performance, Migration, Test, Chore, plan-standalone, Review, Release, Retro, Spike, Exploration, Compound) is in flows/README.md:10–139. Report will reproduce the full table.

---

## requirements

Derived from Investigate constraints c1–c6. Each requirement is **traceable** to a constraint and a source citation. Report must satisfy each.

```yaml
- id: req-1
  source_constraint: c1
  requirement: |
    Document plan-standalone as universal-profile-only. Do not presume
    Spec/Test/Implement steps will execute in *this* flow. Mention them
    only as catalog facts for *other* flows.
  test: |
    Search the produced plan document for sentences asserting Spec/Test/
    Implement execution within plan-standalone — must be absent.

- id: req-2
  source_constraint: c2
  requirement: |
    Every architectural claim cites a Ground-verified source document.
    No invented semantics. "Surface, do not interpret" propagates from
    Ground rule through Investigate to this Design.
  test: |
    Every section in the plan document includes at least one line-cited
    source (file path + line range OR file path + sha256 from
    based_on).

- id: req-3
  source_constraint: c3      # BLOCKING
  requirement: |
    Step pool size = 9. Triage is a classifier, not the 10th step.
    The 10-subdirectory filesystem observation must be explicitly
    addressed (not silently ignored).
  test: |
    Plan document contains a sentence pinning "pool=9" and a sentence
    explaining the 10-directory artifact. Both in the same layer (L1).

- id: req-4
  source_constraint: c4      # BLOCKING
  requirement: |
    Reviewer count = 7. Total agents = 16 (9 producer + 7 reviewer).
    Verify and Reflect explicitly have no reviewer, with stated
    rationale.
  test: |
    Plan document shows the 7-reviewer pairing table AND names Verify +
    Reflect as "no reviewer" with rationale.

- id: req-5
  source_constraint: c5      # BLOCKING
  requirement: |
    Canonical chain order preserved verbatim:
      None ↔ Triage → Flow[Ground → Investigate → Decide → Spec? →
      Core Steps → Verify → Reflect]
    `Spec?` optionality is explicit (question mark or equivalent).
  test: |
    Plan document contains the chain string with `Spec?` (or
    "Spec (optional / flow-conditional)") and the None ↔ Triage prefix.

- id: req-6
  source_constraint: c6
  requirement: |
    Do not describe `src/orchestrator.ts` internals beyond what
    AGENTS.md / WORKFLOW_PLAN.md / EXECUTION_PLAN.md already state at
    document level. Stat-only citation (49 lines / 20568 bytes) is
    acceptable.
  test: |
    Plan document's runtime-substrate section limits itself to
    document-level facts (interface methods, channel split, script-
    not-LLM). No state-machine implementation prose.

- id: req-7
  source_risk: r1
  requirement: |
    Cross-cutting policies (Step Depth, Active Safety / Data Discipline /
    Learning split, Compound recursion, P0 precedence, RETRY_EXHAUSTED,
    Triage reclassify cap, Flow State persistence, Enforcement by
    consequence) receive their own dedicated layer (L3 of opt-B), not
    fragmented across step sections.
  test: |
    Plan document has an L3 section containing all 8 policy clusters
    above as distinct subsections.

- id: req-8
  source_risk: r2
  requirement: |
    Provenance section in the plan document acknowledges emberdeck
    absence and documents the per-file sha256 substitute (Ground's
    17 sha256 rows + Investigate's recorded based_on hashes).
  test: |
    Plan document contains a "Provenance" or "Sources" section that
    lists emberdeck as unavailable AND names the sha256-substitution
    chain.

- id: req-9
  source_risk: r3
  requirement: |
    Plan document explicitly states "triage = classifier, not 10th
    step" in L1 (not buried in a later layer).
  test: |
    First or second paragraph of L1 contains this disambiguation.

- id: req-10
  source_risk: r5
  requirement: |
    Adopt canonical phrasing "9 producer + 7 reviewer = 16; Verify and
    Reflect have no reviewer" verbatim or via faithful paraphrase.
  test: |
    Plan document agent-count statement matches this phrasing.

- id: req-11
  source_risk: r6
  requirement: |
    Stamp `git head_start` and `checked_at` in the plan document
    frontmatter so later-round readers can detect staleness.
  test: |
    Plan document frontmatter contains both fields.

- id: req-12
  source_completion_criterion: pol-11 (flows/README.md:282)
  requirement: |
    Plan document explicitly names the next step. For plan-standalone:
    "Next step: Report → Verify → Reflect" (or equivalent).
  test: |
    Plan document closing section names Report as the next step.

- id: req-13
  source_constraint: derived from based_on chain
  requirement: |
    Plan document references this Decide artifact's path
    (.blazewrit/plans/plan-standalone-test-1-decide.md) and its sha256
    in its based_on chain.
  test: |
    Plan document frontmatter includes a `based_on.decide_ref` field.
```

### Mandatory sections for the Report → terminal plan document

Report must produce `.blazewrit/plans/plan-standalone-test-1-plan.md` containing, at minimum:

1. **L1 — Chain & Step Pool**: canonical chain string; "pool=9, triage=classifier" disambiguation; 9-step table (req-3, req-5, req-9).
2. **L2 — Execution Pattern**: Ralph Loop; step⇄reviewer pairing table; fail caps; reviewer absence for Verify/Reflect (req-4, req-10).
3. **L3 — Cross-cutting Policies**: pol-1 through pol-11 (req-7).
4. **L4 — Flow Catalog**: 16-flow chain table; Decide Mode by Flow; volatile-profile-by-flow; reclassification rules.
5. **Provenance**: emberdeck unavailable; sha256 chain; git head_start; checked_at (req-8, req-11).
6. **Constraint c6 boundary statement**: orchestrator.ts internals not described (req-6).
7. **Next step**: "Report → Verify → Reflect" (req-12).

---

## sequencing

```yaml
- step: 1
  who: Report agent
  action: |
    Consume this Decide artifact + Investigate artifact + Ground
    artifact. Produce .blazewrit/plans/plan-standalone-test-1-plan.md
    with the 7 mandatory sections above. Cite every claim.
  exit_criterion: |
    All 13 requirements (req-1 .. req-13) testable as pass.

- step: 2
  who: Report-Reviewer agent
  action: |
    Fresh context. Read only the produced plan document. Verify:
      - All 13 requirements satisfied
      - Findings have severity tags (per Report-Reviewer criteria)
      - No source citation broken
  exit_criterion: |
    PASS → flow advances to Verify. FAIL → return to Report with
    feedback (Ralph Loop cap = 3).

- step: 3
  who: Verify agent
  action: |
    Flow-level goal check:
      - Terminal artifact exists at expected path
      - Plan document is substantive (not stub) — GSD verifier L1 + L2
      - "Next step" explicitly named (pol-11)
      - emberdeck/firebat/pyreez absence noted is not a failure (these
        tools are not in plan-standalone's universal profile per
        flows/README.md:166 — confirms Investigate ground_unknowns_
        addressed.firebat_baseline + .pyreez_baseline deferrals)
  exit_criterion: |
    PASS → Reflect. FAIL → failure_origin routing (report | decide |
    investigate | ground per Verify diagnosis).

- step: 4
  who: Reflect agent
  action: |
    Append learnings:
      - "plan-standalone with emberdeck-unavailable" pattern (sha256
        substitution chain worked)
      - "9-step architecture documentation" template reuse note
      - Any drift between this synthesis and source docs (none
        expected per req-2)
  exit_criterion: |
    4-section structure check passes (what_worked, what_failed,
    patterns, ...). Flow status → completed.
```

---

## gate_rules

```yaml
# Compound gate_rules are a top-level Decide artifact concern primarily
# for Compound flows. plan-standalone is not Compound, so gate_rules are
# minimal — only stale-detection gating between this Decide and the
# downstream Report.

- id: gate-stale-detection
  condition:
    "!=":
      - { var: "current.workflow_plan_sha256" }
      - "653462267b0d78a4b12210e473643be713ff5da16f8a1f5b097c64bcc4ff8aff"
  action: retry
  retry_target: investigate
  rationale: |
    ed_snapshot_version unavailable (Ground.unknowns), so stale-detection
    uses per-file sha256 (pol-4 data discipline). If WORKFLOW_PLAN.md
    sha256 changed between this Decide and Report execution, Investigate
    must re-run to refresh impact_map and constraints.

- id: gate-agents-md-stale
  condition:
    "!=":
      - { var: "current.agents_md_sha256" }
      - "126e38c164ae47a2cc6ab167e54cefb7041294680a6f7ac7d730a79b7491afea"
  action: retry
  retry_target: investigate
  rationale: |
    AGENTS.md is the contracts_version anchor (Investigate.compatibility_
    verdict.source_version.contracts_version). Drift invalidates req-4 +
    req-5 traceability.

- id: gate-git-head-stale
  condition:
    "!=":
      - { var: "current.git_head" }
      - "2dda139a8b93c14d10a9c30b77155980c2252768"
  action: proceed
  warn: true
  rationale: |
    git head drift alone does not invalidate this Decide (documentation
    flow, no code race). Surface a warning in the plan document
    Provenance section per req-11; proceed otherwise. Hard-block only on
    the two sha256 gates above.
```

---

## ground_unknowns_addressed (forwarded resolution)

Investigate deferred 4 unknowns to Decide-or-later. This Decide resolves them as follows:

```yaml
- unknown_ref: firebat_baseline
  investigate_disposition: defer (to Verify)
  decide_resolution: confirmed_defer
  rationale: |
    firebat is not in plan-standalone universal profile (flows/README.md:
    166 — no `firebat` conditional). Verify step exit_criterion (above)
    explicitly notes this as expected absence, not failure.

- unknown_ref: pyreez_baseline
  investigate_disposition: defer (to Verify)
  decide_resolution: confirmed_defer
  rationale: |
    pyreez is not in plan-standalone universal profile. Decide-Design
    *may* invoke pyreez `deliberate` (per Decide contract), but absence
    is acceptable — inline deliberation against c1-c6 + r1-r6 served the
    same purpose. Recorded in options_deliberated preamble.

- unknown_ref: test_suite_definition
  investigate_disposition: defer (to Decide)
  decide_resolution: surface_to_reflect
  rationale: |
    No test/lint script absence is *not* a plan-standalone blocker
    (documentation flow). However, it is a repo-level observation worth
    propagating. Sequencing step 4 (Reflect) includes a learning note
    flagging this as a pattern for future code-producing flows in this
    Round 3 phase.
  follow_up: reflect-learning-note

- unknown_ref: lint_definition
  investigate_disposition: defer (to Decide)
  decide_resolution: surface_to_reflect
  rationale: same as test_suite_definition.
  follow_up: reflect-learning-note
```

---

## followup_flows

```yaml
# None required. plan-standalone is terminal-artifact-producing; the
# Report step produces the terminal artifact, Verify confirms, Reflect
# closes. No downstream flow is queued.
#
# (Review-flow-style followup_flows mechanism — flows/README.md:230-236 —
# does not apply to plan-standalone.)
```

---

## provenance

```yaml
based_on_chain:
  ground:
    path: .blazewrit/grounds/plan-standalone-test-1.md
    sha256_basis: "Ground.verification_proof.read_files (17 rows)"
  investigate:
    path: .blazewrit/investigations/plan-standalone-test-1.md
    sha256_basis: "Investigate.ground_artifact_provenance"

source_documents:
  WORKFLOW_PLAN.md: 653462267b0d78a4b12210e473643be713ff5da16f8a1f5b097c64bcc4ff8aff
  flows/README.md: 7b0838f7a2ce26bbafb5b3b6d8f8c237c0be9ffa66ad196a2a7cedc5b0af037d
  AGENTS.md: 126e38c164ae47a2cc6ab167e54cefb7041294680a6f7ac7d730a79b7491afea
  steps/ground/README.md: 143616a6722386ba5244d51267e3296befe11bc01575988ee3b0f891cf86f0f6
  steps/triage/README.md: 3c21e1ca38734be11f57641541070af18a73e986f8301cdb1316f1865ce58dfb
  steps/investigate/README.md: 7cf6c31c37ba1c1e07940590b06542859ad8f0fc39b2ae6e4d71f59b39c544d0
  steps/decide/README.md: 26d9a66399d63fe0414ed7b7be124b9d9e1c4d9a6d18134bcf3620a0cccb7082
  steps/spec/README.md: 0ac760f13fa230e9ab32fc632c5032e144b707ef078a6587f0fdaf9639b2d112
  steps/test/README.md: df463f1ce76ea4941b5106150770adbfb39f2b796c7d564c88d0f01827bfbd88
  steps/implement/README.md: cb7f94fa0b00a7fc577b9e5fb4f895756be2b7fc63ff13ad6f334f6798ca938d
  steps/report/README.md: d312bcac3d020fb7a33e029805ca196e2bf8ee0095c6a74e5ebc4becf93c98bf
  steps/verify/README.md: 59e8a59b04e4bb0e9a234b9fac34fdc8b65d70c7a5765cbdba478254ad5f8b30
  steps/reflect/README.md: 42db0240b4d0ea6b8e1c3a1c6b6ae2f68d1d105a1b6aa5ae1d0428f7ecdabe7f
  src/orchestrator.ts: cf9f06ce2a18df3f00c2ab7d10e7f28fa110162fea0379c6058567f9399c0882
                       # stat-only citation per Investigate c6 / r4

tool_availability:
  emberdeck: unavailable
    impact: |
      intent_card_id is a placeholder. When emberdeck MCP returns, an
      intent card should be created with this Decide artifact's contents
      and the card id back-filled into frontmatter.intent_card_id.
    substitute: per-file sha256 chain (pol-4 data discipline)
  pyreez: unavailable
    impact: deliberate() not invoked; inline deliberation against c1-c6 +
            r1-r6 substituted (see options_deliberated preamble).
  firebat: not_applicable
    impact: none — plan-standalone universal profile does not call firebat.

provenance_acknowledgement: |
  This Decide artifact's provenance is weakened (not invalidated) by
  emberdeck unavailability, exactly as Investigate r2 forecast. The
  sha256-chain substitute is sufficient for a documentation-synthesis
  flow per Investigate ground_unknowns_addressed.ed_query rationale.
```

---

STATUS: DONE
ARTIFACT: .blazewrit/plans/plan-standalone-test-1-decide.md
