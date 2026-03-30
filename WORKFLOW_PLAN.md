# Workflow Plan

Status: Architecture finalized. Validated via 48-scenario simulation (36 round 1 + 12 round 2).

## Step Pool (6)

| Step | Description |
|------|-------------|
| Orient | Four-phase entry step: (1) Context gathering — codebase scan, emberdeck card/spec query, firebat dependency analysis. (2) Blocking point identification — technical constraints, missing dependencies, architectural conflicts, external service requirements. (3) Feasibility assessment — HIGH/MEDIUM/LOW with reasoning based on blockers. (4) Flow classification — selects flow type reflecting feasibility result. **Active investigation mode**: when runtime behavior understanding is needed, Orient may execute the system, collect logs/metrics/profiles, and form diagnostic hypotheses. |
| Dialogue | Decision-making and planning. Modes: ideation, research, roadmap, product, architecture, spec, analysis. pyreez for complex decisions, emberdeck for plan/card persistence. |
| Test | Write failing tests (RED). Reproduce bugs. Add coverage. Profile/measure (Performance flow). Validate migration scripts (Migration flow). |
| Implement | Write code (GREEN). Sub-activities: setup (deps, config, infrastructure), code, commit. firebat scan after every change. emberdeck drift check. Atomic commits per logical unit. |
| Verify | Quality gate. emberdeck regression_guard (drift=0), firebat full scan, end-to-end execution path tracing. Variant: Verify(measure) for Performance flow compares metrics against target. |
| Reflect | Post-flow learning. Runs after EVERY flow completion. Records: what worked, what failed, what was unexpected, patterns discovered. Writes directly to project instruction files (CLAUDE.md, .claude/rules/, skills, or tool equivalent). No separate loading needed — host tool reads these files at every session start. Detail TBD. |

## Flows (14)

```
Orient (context + blockers + feasibility → flow classification → approval)
  │
  ├─ Decision ──────────────────────────────────────────────
  │  └→ Dialogue:      Dialogue(mode) → Report → Reflect
  │                     modes: ideation / research / roadmap / product / architecture / spec
  │
  ├─ Implementation ────────────────────────────────────────
  │  ├→ Feature:       Dialogue → [Test ⇄ Implement] → Verify → Reflect
  │  ├→ Bug Fix:       [Test(reproduce) → Implement(fix)] → Verify → Reflect
  │  │                  P0/urgent:    Implement(emergency) → Verify → Test(retroactive) → Reflect
  │  │                  Unreproducible: [Implement(hypothesis) → Verify(extended)] → Reflect
  │  ├→ Refactor:      [Dialogue]? → [Test(coverage<80%)]? → [Implement → Verify]* → Reflect
  │  ├→ Performance:   [Test(profile)]? → [Implement → Verify(measure)]* → Reflect
  │  ├→ Migration:     Dialogue → [Test(validate) → Implement → Verify]* → Reflect
  │  ├→ Test:          Test → Verify → Reflect
  │  ├→ Chore:         Implement → Verify → Reflect
  │
  ├─ Delivery ──────────────────────────────────────────────
  │  ├→ Review:        Report → Reflect
  │  ├→ Release:       Implement(version/changelog) → Verify → Reflect
  │  └→ Retro:         Dialogue(analysis) → Report → Reflect
  │
  ├─ Experiment ────────────────────────────────────────────
  │  └→ Spike:         Implement(prototype, disposable) → Report → Reflect
  │
  ├─ Discovery ─────────────────────────────────────────────
  │  └→ Exploration:   Report → Reflect
  │
  └─ Composition ───────────────────────────────────────────
     └→ Compound:      [Flow A → Decision Gate → Flow B → Gate → ...] → Report → Reflect
```

**Reflect runs after EVERY flow — success or failure.** No exceptions. When a flow is abandoned (escalation, abort, infeasible), Reflect records WHY it failed. Learnings are written directly to project instruction files — the host tool loads them automatically at session start.

## Orient Phases

### Phase 1: Context Gathering

Codebase scan (grep, glob, git log), emberdeck `pre_change_check` and `get_card_context`, firebat `query-dependencies`.

### Phase 2: Blocking Point Identification

Identify all blockers preventing direct execution:
- Technical constraints (framework limitations, unsupported features)
- Missing dependencies (libraries, services, infrastructure)
- Architectural conflicts (incompatible patterns, tight coupling)
- External requirements (API keys, third-party services, permissions)
- Knowledge gaps (unfamiliar technology, unclear requirements)

### Phase 3: Feasibility Assessment

| Feasibility | Criteria | Action |
|-------------|----------|--------|
| HIGH | No blockers, or trivially resolvable | Proceed with classified flow |
| MEDIUM | Blockers exist but all resolvable | Small blockers → incorporate in Dialogue plan. Large blockers → upgrade to Compound (blocker-resolution flows → original flow) |
| LOW | Blockers with uncertain resolution | Spike (hands-on verification), Dialogue (explore alternatives), or abort with explanation |

### Phase 4: Flow Classification

Orient Report: target files, affected spec cards, risk level (P0-P3), blocking points, feasibility (HIGH/MEDIUM/LOW), constraints.

| Signal | Flow |
|--------|------|
| New capability + 2+ affected cards or 5+ files | Feature |
| Error, crash, failing test, regression | Bug Fix |
| No behavior change + structural improvement | Refactor |
| Profiling, benchmark, latency, throughput, memory target | Performance |
| Dependency upgrade, API migration, framework change | Migration |
| Coverage gap, missing tests, test strategy | Test |
| Config, CI, docs, dependencies | Chore |
| Brainstorming, planning, design, research, spec writing | Dialogue (mode auto-selected) |
| PR review, code audit, diff analysis, security audit | Review |
| Version bump, changelog, deploy | Release |
| Retrospective, postmortem, analysis of past work | Retro |
| Feasibility check, prototype, proof of concept | Spike |
| Understanding, investigation, learning | Exploration |
| Multiple blockers requiring different flows, or multi-phase task | Compound |

## Gate Policy

```yaml
gate_policy:
  confirm: [migration, release]
  auto: [*]
```

Configurable per project. `auto: []` = fully manual. `confirm: [migration, release]` = mostly automated.

## Compound Flow Rules

- Sub-flows execute sequentially, each running its full step sequence
- **Decision gate** between each sub-flow: proceed / pivot / abort
- Gate criteria defined during Orient's flow classification
- Dynamic sub-flow count allowed (e.g., Review finds N bugs → N Bug Fix sub-flows)
- State carries between sub-flows within the same session
- If a sub-flow fails, the compound flow pauses for decision

## Chunking Rule

When Orient identifies scope exceeding bounds (5+ files, 3+ modules), Dialogue MUST produce a chunking plan:
- Split into bounded cycles, each covering one concern/module
- Each cycle is a complete mini-flow (Test → Implement → Verify)
- Dependency order between cycles defined in the plan

## Bug Fix Paths

| Condition | Path |
|-----------|------|
| Normal (reproducible) | Test(reproduce RED) → Implement(fix GREEN) → Verify |
| P0/production down | Implement(emergency fix) → Verify → Test(retroactive, mandatory within 24h) |
| Unreproducible (intermittent) | Implement(hypothesis fix, documented) → Verify(extended observation) |

## Refactor Guards

- If Orient identifies target code has <80% test coverage → Test step mandatory before Implement to establish baseline
- Large scope (5+ files) → Dialogue mandatory for design/chunking plan
- Breaking changes (public API) → reclassify as Migration

## Migration Test-First Rule

Migration flow includes Test before each Implement cycle:
```
Dialogue → [Test(validate migration) → Implement(apply migration) → Verify]*
```
Test validates: migration scripts are reversible, data integrity preserved, rollback works.

## Tool Integration

### Per-Step Tool Mapping

| Step | emberdeck | firebat | pyreez |
|------|-----------|---------|--------|
| Orient | `pre_change_check`, `get_card_context` | `query-dependencies` | — |
| Dialogue | `create_card` (intent+spec) | — | `deliberate` (conditional) |
| Test | — | `scan` (after test code) | — |
| Implement | `validate_code_links`, `write_spec_annotations` | `scan` (every change, expandAffected) | — |
| Verify | `regression_guard` (threshold=0) | `scan` (full project) | `deliberate` (review mode, high-risk) |

### Decision Flow Tool Mapping

| Mode | emberdeck | pyreez |
|------|-----------|--------|
| Ideation | Existing card query (constraints) | **Primary**: multi-model divergent thinking |
| Research | Existing design intent query | Multi-model comparison/verification |
| Roadmap | Card hierarchy query | Priority deliberation |
| Product | Intent card creation | Product direction deliberation |
| Architecture | Intent card creation | **Primary**: structural deliberation |
| Spec | **Primary**: spec card + codeLinks | Complex spec deliberation |
| Analysis | Card status/drift query | Multi-perspective analysis |

### pyreez Trigger Criteria

Called only when:
- 5+ affected files, OR
- emberdeck card risk = high/critical, OR
- Explicit request from user/agent

Otherwise: agent plans independently.

### Tool Availability (Graceful Degradation)

All tools optional. Workflow degrades:
- emberdeck present → card query/save/validate/drift
- emberdeck absent → code-only Orient, text-only plans, no drift check
- firebat present → scan after every change, full project scan at Verify
- firebat absent → `test` + `typecheck` only
- pyreez present → multi-model deliberation for complex decisions
- pyreez absent → agent decides alone

## Deviation Rules

1. firebat severity=error → auto-fix attempt
2. firebat severity=warning → fix if task-related, skip otherwise
3. emberdeck drift detected → update spec card, confirm, proceed
4. **3 failures with same approach → stop, escalate**
5. P0 severity → skip Test, fix first, retroactive test mandatory

## Verify Checklist

All must PASS:
1. emberdeck `regression_guard` PASS (skip if no emberdeck)
2. firebat `scan` blockers = 0 (or test + typecheck pass if no firebat)
3. Most complex execution path traced end-to-end through actual code
4. Every Plan/Spec item mapped to code (file:line)

## Hook Enforcement (Planned)

```yaml
hooks:
  PostToolUse(Edit|Write):
    - firebat scan (changed files)
    - emberdeck validate_code_links
  PreToolUse(Bash(git commit*)):
    - emberdeck regression_guard
  Stop:
    - firebat scan result check (blockers > 0 → block)
```

## Input Channels

blazewrit is input-channel agnostic. Host tool handles input.

| Channel | Example |
|---------|---------|
| Human direct | `/feature add avatar upload` |
| Agent (A2A) | product-agent → "need avatar upload" |
| Auto trigger | CI failure → Bug Fix, schedule → Retro |

## Quality Assurance Mechanisms

| Mechanism | What it solves | Source |
|-----------|---------------|--------|
| Emberdeck card-unit decomposition | Agent capability limits (FeatureBench 11%) | GSD context budget |
| File-based state (cards, reports, git) | Context degradation over long sessions | Ralph Loop, GSD context-packet |
| Mechanical verification (5/6 checks) | LLM self-evaluation unreliable | Anthropic evaluator research |
| Multi-model cross-verification (pyreez) | Single model bias | gstack dual-voice, AceMAD |
| Goal-backward verification | "exists" ≠ "works" | GSD verifier |

## Validation Status

- 48 scenarios simulated across all 14 flows
- 10 MAJOR gaps found and resolved
- 21 MINOR gaps identified (acceptable, agent handles implicitly)
- Dialogue mode boundaries tested (5/7 clear, 2/7 resolved by Orient)
- Flow transitions and composition tested
- Reflect step added: mandatory post-flow learning on every flow
- Orient expanded: 4-phase (context → blockers → feasibility → classification)

## Remaining Work (Implementation Phase)

1. Step file content (orient.md, dialogue.md, test.md, implement.md, verify.md, reflect.md)
2. Reflect detail design: what to record, where to write (CLAUDE.md / rules / skills), format, dedup/pruning strategy
3. Flow transition rules and entry/exit criteria per step
4. Non-implementation flow completion criteria (when is Dialogue "done"? Exploration "sufficient"? Spike "success"?)
5. Orient self-check mechanism (validate own blocking point / feasibility / classification output)
6. ~~Context management~~ — Handled by file-based state (step artifacts survive context loss) + chunking rule (keeps each unit within context bounds) + host tool features (Claude Code compaction, etc.)
7. Rollback guidance for failed Implement/Verify
8. Classification error safeguards in gate policy
9. Tool failure graceful degradation specifics
