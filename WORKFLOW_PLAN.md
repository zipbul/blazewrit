# Workflow Plan

Status: Architecture finalized. Orient decomposed into Triage + flow-owned Prepare. Flow state persistence, lifecycle rules, and execution protocol added.

## Architecture

```
Input → Triage(classification logic)
  ├─ Suspended flow exists → prompt: resume or new?
  ├─ Flow signal detected → Flow[Prepare → Core Steps → Reflect]
  └─ No flow signal (None) → Free conversation (no workflow overhead)
       → signal detected at any point → Triage re-evaluates → Flow entry
```

- **Triage**: Not a step. Classification logic runs on every input. Outputs: flow type, None, or resume prompt.
  - First: check `.blazewrit/flow-state.yaml` for suspended flows.
  - Clear signal → immediate routing to flow.
  - Ambiguous → minimal scan then route.
  - Multi-concern → Compound.
  - No actionable signal → None (free conversation, no flow).
- **None → Flow transition**: When free conversation shifts to actionable intent, Triage reclassifies. Prepare inherits conversation context — does not re-analyze what was already discussed.
- **Prepare**: Each flow's tailored entry analysis. Inline in flow definition, not in step pool. Rule: skip analysis for anything already established in prior conversation.
- **Core Steps**: Dialogue, Test, Implement, Verify (from step pool).
- **Reflect**: Mandatory on every flow completion and abandonment. Does NOT run on suspension (state file handles it).
- **Flow State**: Persisted in `.blazewrit/flow-state.yaml`. Updated on every step transition. Read at session start. Survives context loss.

## Step Pool (6)

| Step | Description |
|------|-------------|
| Dialogue | Decision-making and planning. Modes: ideation, research, roadmap, product, architecture, spec, analysis. pyreez for complex decisions, emberdeck for plan/card persistence. Output = plan file (next step's execution prompt). |
| Test | Write failing tests (RED). Reproduce bugs. Add coverage. Profile/measure (Performance flow). Validate migration scripts (Migration flow). |
| Implement | Write code (GREEN). Sub-activities: setup (deps, config, infrastructure), code, commit. firebat scan after every change. emberdeck drift check. Atomic commits per logical unit. |
| Verify | Quality gate. emberdeck regression_guard (drift=0), firebat full scan, end-to-end execution path tracing. Variant: Verify(measure) for Performance flow compares metrics against target. |
| Report | Synthesize analysis, investigation, or review results into a deliverable output. Used by: Review, Retro, Exploration, Spike. Also output phase in Dialogue flow when producing reports rather than plans. |
| Reflect | Post-flow learning. Runs on completion and abandonment (not suspension). Records: what worked, what failed, what was unexpected, patterns discovered. Writes directly to project instruction files (CLAUDE.md, .claude/rules/, skills, or tool equivalent). No separate loading needed — host tool reads these files at every session start. |

## Triage — Classification Logic

Signal table for flow routing. Not a step — executed as entry logic.

### Signal Table

| Signal | Flow |
|--------|------|
| New capability + 2+ affected cards or 5+ files | Feature |
| Error, crash, failing test, regression | Bug Fix |
| Error + P0/production down | Bug Fix P0 |
| Error + intermittent/unreproducible | Bug Fix Unreproducible |
| No behavior change + structural improvement | Refactor |
| Profiling, benchmark, latency, throughput, memory target | Performance |
| Dependency upgrade, API migration, framework change | Migration |
| Coverage gap, missing tests, test strategy | Test |
| Config, CI, docs, dependencies | Chore |
| Planning, design, research, spec writing with concrete target | Dialogue (mode auto-selected) |
| PR review, code audit, diff analysis, security audit | Review |
| Version bump, changelog, deploy | Release |
| Retrospective, postmortem, analysis of past work | Retro |
| Feasibility check, prototype, proof of concept | Spike |
| Understanding, investigation, learning | Exploration |
| Multiple blockers requiring different flows, or multi-phase task | Compound |
| No actionable signal, no concrete target (discussion, open brainstorming, casual exchange) | None (free conversation) |

### Signal Strength Rules

| Strength | Criteria | Action |
|----------|----------|--------|
| Clear | Input contains explicit action verb + target ("fix the NPE in auth.py", "add avatar upload") | Immediate routing, no scan |
| Implied | Input describes problem/goal without explicit action ("auth is slow", "we need better caching") | Minimal scan (grep target area, check git log) → classify |
| Ambiguous | Input has no actionable target ("something feels off", "let's think about this") | None. Free conversation until signal strengthens |

### None ↔ Flow Transition Rules

| Transition | Trigger | Action |
|------------|---------|--------|
| None → Flow | User states actionable intent ("let's do it", "make this", "fix that") | Triage classifies. Prepare inherits conversation context — skips re-analysis of discussed topics |
| None → Flow | Conversation naturally produces spec-level detail (files named, approach decided, scope defined) | Triage suggests flow entry. User confirms |
| Flow → None | User explicitly abandons ("never mind", "let's talk about something else") | Reflect(abandoned, reason) → update flow state → None |
| Flow → None | No flow-related input for 3+ consecutive exchanges | Triage suggests: continue flow or suspend? |

### Flow Lifecycle Rules

| Event | Action | State file update |
|-------|--------|-------------------|
| **Start** | Triage classifies → Prepare → begin core steps | Write: flow type, step, status=active |
| **Suspend** (user switches topic) | Save progress to state file (no Reflect) | Write: status=suspended, current step, completed work, pending items |
| **Suspend** (P0 preemption) | Pause immediately → new Bug Fix P0 flow starts | Write: status=suspended, preempted_by=P0, resume point |
| **Resume** | Read state file → skip completed steps → continue from suspension point | Write: status=active |
| **Complete** | Reflect → record learnings | Write: status=completed |
| **Abandon** | Reflect(abandoned, reason) | Write: status=abandoned |

Resume priority: P0 preemption always resumes after P0 completes. User-suspended flows resume only on explicit request.

### User Override

User can override Triage classification at any point:
- "This isn't a refactor, it's a feature" → reclassify, restart Prepare for new flow type
- "Skip the tests, just implement" → follow user directive, Reflect records deviation
- "I don't want a flow for this" → None, even if signal was clear

### Context Inheritance Rules

When transitioning None → Flow, Prepare inherits:
- **Inherit**: decisions made, constraints identified, scope discussed, files mentioned, approach agreed
- **Do not inherit**: abandoned ideas, rejected approaches, tangential discussion
- **Rule**: if information was established in conversation, Prepare references it rather than re-discovering it via scan

## Flow State Persistence

Flow state is file-based, not context-dependent. Survives session boundaries, compaction, and context loss.

### State File

Location: `.blazewrit/flow-state.yaml` (list of active/suspended flows)

```yaml
# List structure — supports multiple suspended flows + one active
flows:
  - id: feature-avatar-upload
    flow: feature
    status: active          # active | suspended | completed | abandoned
    step: implement         # current step
    started: 2026-03-31T14:00:00
    summary: "Adding avatar upload to user profile"
    completed_steps:
      - prepare: "impact scope: 3 files, no blockers, feasibility HIGH"
      - dialogue:
          status: DONE
          artifact: ".blazewrit/plans/feature-avatar-upload.md"
      - test:
          status: DONE
          artifact: "src/__tests__/avatar-upload.test.ts"
    pending:
      - "implement cycle 1: resize logic"
      - "verify"

  - id: bugfix-p0-auth
    flow: bugfix-p0
    status: suspended
    step: verify
    started: 2026-03-31T13:00:00
    suspended_at: 2026-03-31T13:45:00
    suspend_reason: "User switched to feature work"
    completed_steps:
      - prepare: "symptom: auth token expiry not refreshed"
      - implement:
          status: DONE
          artifact: "src/auth/token-refresh.ts (commit abc123)"
    pending:
      - "verify"
      - "test (retroactive)"

# Compound flow tracks sub-flows internally
  - id: compound-payment-overhaul
    flow: compound
    status: active
    step: sub-flow-2
    sub_flows:
      - { flow: migration, status: completed, summary: "DB schema migrated" }
      - { flow: feature, status: active, summary: "New payment API" }
      - { flow: test, status: pending }
```

### State File Rules

1. **Write on every step transition** — orchestrator updates after each subagent returns
2. **Read at session start** — Triage checks for active/suspended flows before classifying new input
3. **Single active flow** — only one flow can be active at a time. Starting a new flow requires suspending or completing the current one
4. **Suspended flows persist** — no automatic expiry. User chooses which to resume (not LIFO stack)
5. **P0 preemption** — auto-prompts resume after P0 completes
6. **Completed/abandoned flows are archived** — moved to `.blazewrit/flow-history/` with timestamp for Retro flow access
7. **Compound sub-flows** — tracked within the compound entry, not as separate list items

## Execution Protocol

### Design Rationale

blazewrit is a **workflow rule set** installed into a project. The **host agent** (Claude Code main context, A2A server session, or user session) reads these rules and becomes the orchestrator. Each step is a **custom agent** (subagent) spawned by the host. blazewrit is not an agent itself — it is the operating system that governs how agents work in the project.

Not a CLI binary (GSD-2), not a tool collection (gstack), not a fixed pipeline (spec-kit), not an agent (it IS the rules).

Constraints:
- No subprocess exit codes (not a binary)
- Dynamic flow routing (16 flow types, not a fixed pipeline)
- Fully autonomous operation via A2A (no human-in-the-loop required)
- Human can intervene at any time (but is not required)

Enforcement is designed from blazewrit's constraints, not copied from reference systems. Where reference patterns are adopted, the reason is noted.

### Execution Model

```
Host Agent (main context — reads blazewrit rules, becomes orchestrator)
  │
  ├─ Triage + Prepare (host internal — needs conversation/request context)
  │
  ├─ Step execution → Custom agent spawn
  │   ├─ Each step = Claude Code custom agent (.claude/agents/<step>.md)
  │   ├─ tools/disallowedTools: tool restriction per agent (mechanical)
  │   ├─ mcpServers: scoped tool access (firebat, emberdeck, pyreez per step)
  │   ├─ hooks: scoped safety hooks per agent
  │   ├─ maxTurns: runaway prevention
  │   ├─ isolation: worktree (for high-risk Implement)
  │   ├─ files_to_read: previous step artifacts (file dependency)
  │   └─ return: completion status + output artifact
  │
  ├─ Step transition → Host reads return, updates state, spawns next agent
  │
  └─ Global Hooks (safety + enforcement, in .claude/settings.json)
      ├─ PostToolUse(Edit|Write): firebat scan
      ├─ PostToolUse(Read|Grep|Glob): stuck detection counter
      ├─ PreToolUse(Bash(git commit*)): regression_guard
      ├─ Stop: blocker check + Reflect completion check
      └─ Conditional: coverage gate, Reflect structure check
```

### Why Custom Agents, Not Skills

| Capability | Skill | Custom Agent | blazewrit needs |
|------------|-------|-------------|-----------------|
| Fresh context | Shared with host | **Isolated** | Yes — prevents context rot across steps |
| mcpServers scoping | Not supported | **Supported** | Yes — firebat/emberdeck/pyreez per step |
| permissionMode | Not supported | **Supported** | Yes — acceptEdits for Implement |
| maxTurns | Not supported | **Supported** | Yes — runaway prevention |
| worktree isolation | Not supported | **Supported** | Yes — high-risk Implement |
| hooks scoping | Supported | **Supported** | Yes |
| Transcript survival | Lost on compaction | **Persists independently** | Yes — long workflows |

Custom agents get fresh context and return condensed results. This matches the "fresh context per step" principle (Ralph Loop, GSD, Anthropic 4.6 best practice).

### Enforcement by Consequence

Enforcement strength is matched to the consequence of violation:

| Consequence of violation | Enforcement | Mechanism | Examples |
|---|---|---|---|
| **Dangerous** (bad code ships, data loss) | **Hook — mechanical** | Runs regardless of agent behavior | firebat scan, regression_guard, blocker check |
| **Role violation** (step does wrong thing) | **allowed-tools — mechanical** | Host tool blocks restricted tools | Verify can't Edit, Reflect can't Edit |
| **Order violation** (step skipped) | **File dependency — natural failure** | Next step fails without previous artifact | Implement can't run without plan file |
| **Conditional skip** (optional step wrongly skipped) | **Hook — conditional check** | Script validates condition before allowing skip | Coverage < 80% → Test mandatory |
| **Completion skip** (Reflect skipped) | **Hook — Stop gate** | Session can't end with unreflected completed flow | Stop hook checks state file |
| **Quality issue** (poor analysis, weak learning) | **Prompt + structure check** | Instructions guide, script checks structure | Reflect must have required sections |
| **Judgment error** (wrong classification) | **Prompt only** | Clear rules, tables, examples | Triage signal table, decision classification |

### Tool Restrictions Per Step Agent

Each step agent defines `tools` (allow list) or `disallowedTools` (deny list) in its frontmatter. Path restrictions use hooks (gstack `/freeze` pattern).

| Agent | tools | mcpServers | Rationale |
|-------|-------|------------|-----------|
| dialogue | Read, Grep, Glob, Bash, Write | emberdeck, pyreez | Produces plans. No code edits (Edit blocked) |
| test | Read, Grep, Glob, Bash, Edit, Write | firebat | Writes test code |
| implement | Read, Grep, Glob, Bash, Edit, Write | firebat, emberdeck | Full access. firebat scans every change |
| verify | Read, Grep, Glob, Bash | firebat, emberdeck, pyreez | Read-only. Cannot modify code or files |
| report | Read, Grep, Glob, Bash, Write | — | Produces reports. No code edits (Edit blocked) |
| reflect | Read, Grep, Glob, Write | — | Writes instruction files. No code edits (Edit blocked) |

### Orchestrator Protocol

The host agent reads blazewrit rules (`.claude/rules/blazewrit/`) and becomes the orchestrator. Triage and Prepare execute in the host context (need conversation/request context). Core steps are delegated to custom agents.

Host agent responsibilities (governed by blazewrit rules):
- Run Triage classification (signal matching + state file check)
- Execute Prepare (flow-specific analysis, inline)
- Spawn step agents in flow-defined order with files_to_read
- Read agent return (completion status + artifact)
- Update state file after each step
- Handle lifecycle events (suspend, resume, abandon)
- NEVER do step work directly — always delegate to step agents

Why Prepare is in host (not a step agent): Prepare needs conversation/request context. Step agents get fresh context. If user discussed requirements for 30 minutes then says "build it," or an A2A request includes detailed specifications, Prepare must reference that context. Running Prepare as a step agent would lose it.

### Completion Status Protocol

Every step agent returns one of (gstack pattern — adopted because it covers all terminal states):

| Status | Meaning | Orchestrator action |
|--------|---------|-------------------|
| DONE | Step completed. Artifact produced | Write to state file. Next step |
| DONE_WITH_CONCERNS | Completed with issues | Write to state file. Next step, flag for Verify |
| BLOCKED | Cannot proceed | Write to state file. Escalate to user |
| NEEDS_CONTEXT | Missing information | Write to state file. Ask user |

### Artifact Chain

Each step produces a defined artifact. Next step's files_to_read points to it. Missing artifact = natural failure (spec-kit pattern — adopted because it enforces order without extra machinery).

| Step | Produces | Consumed by |
|------|----------|-------------|
| Prepare | prepare-summary (in state file) | First core step (via orchestrator prompt) |
| Dialogue | Plan file (`.blazewrit/plans/<flow-id>.md`) | Test, Implement |
| Test | Test file paths + RED/GREEN status | Implement |
| Implement | Changed file paths + commit refs | Verify |
| Verify | Verification result (PASS/FAIL + details) | Reflect |
| Report | Report file (`.blazewrit/reports/<flow-id>.md`) | Reflect |
| Reflect | Learnings in instruction files | Next session (auto-loaded by host tool) |

Plans-as-prompts (GSD pattern — adopted because it eliminates plan-to-prompt transformation): Dialogue output IS the execution prompt for downstream steps.

### Hooks

#### Safety Hooks (always active)

| Hook | Trigger | Action | Why |
|------|---------|--------|-----|
| firebat scan | PostToolUse(Edit\|Write) | Scan changed files. Error → block | Catches bad code immediately |
| regression_guard | PreToolUse(Bash(git commit*)) | emberdeck regression check | Prevents spec drift from being committed |
| stuck detection | PostToolUse(Read\|Grep\|Glob) | Count consecutive read-only calls. 5 → warn, 8 → force escalate | GSD analysis paralysis guard |
| blocker check | Stop | firebat blockers > 0 → block session end | Prevents leaving broken state |

#### Enforcement Hooks

| Hook | Trigger | Action | Why |
|------|---------|--------|-----|
| Reflect gate | Stop | Check state file: any flow completed without reflect_completed=true → block | Prevents skipping Reflect |
| Reflect structure | PostToolUse(Write) on instruction files | Check Reflect output has required sections (what_worked, what_failed, patterns) → warn if missing | Ensures Reflect isn't hollow |
| Coverage gate | PreToolUse(Edit\|Write) in Implement context | If flow=refactor and coverage < 80% and Test not in completed_steps → block | Enforces conditional Test requirement |

### Self-Validation Protocol

Within-step quality loop (prompt-enforced, iteration-capped):

```
Do work → Check against step criteria → Pass? → DONE
                                       → Fail? → Fix (iteration++)
                                       → iteration >= 3? → Force DONE_WITH_CONCERNS
```

Iteration count tracked within step agent execution. Not in flow-state.yaml.

### Decision Classification

Within any step (gstack pattern — adopted because it prevents both over-automation and unnecessary blocking):

| Type | Criteria | Action |
|------|----------|--------|
| Mechanical | One clearly correct answer | Auto-decide silently |
| Taste | Reasonable people disagree | Surface to user at next gate |
| User Challenge | High risk or irreversible | STOP immediately, ask user |

Prompt-enforced. Classification itself is judgment — cannot be mechanically forced.

### What Cannot Be Mechanically Enforced

Only items that are **pure judgment with no structural proxy**:

| Item | Why it's irreducible | Mitigation |
|------|---------------------|-----------|
| Triage classification | Interpreting user intent is judgment | Signal table with concrete examples. Ambiguity → minimal scan |
| Decision classification | Assessing risk/reversibility is judgment | Decision type table with examples per step |
| Self-validation content quality | Evaluating "good enough" is judgment | Criteria checklist per step. Max 3 iterations |
| Reclassification detection | Recognizing flow mismatch is judgment | Trigger list with concrete conditions. 3-failure rule is hookable |

## Flows (16)

```
Feature:
  Prepare: impact scope + card query + blockers + feasibility
  → Dialogue → [Test ⇄ Implement] → Verify → Reflect

Bug Fix:
  Prepare: error logs + related code search
  → Test(reproduce) → Implement(fix) → Verify → Reflect

Bug Fix P0:
  Prepare: symptom location only
  → Implement(emergency) → Verify → Test(retroactive) → Reflect

Bug Fix Unreproducible:
  Prepare: logs + history analysis
  → Implement(hypothesis) → Verify(extended observation) → Reflect

Refactor:
  Prepare: coverage + dependency search
  → [Dialogue]? → [Test(<80%)]? → [Implement → Verify]* → Reflect

Performance:
  Prepare: profile target identification + baseline measurement
  → [Test(profile)]? → [Implement → Verify(measure)]* → Reflect

Migration:
  Prepare: full dependency audit + compatibility matrix
  → Dialogue → [Test(validate) → Implement → Verify]* → Reflect

Test:
  Prepare: coverage gap analysis
  → Test → Verify → Reflect

Chore:
  Prepare: change target identification
  → Implement → Verify → Reflect

Dialogue:
  Prepare: existing cards + docs query
  → Dialogue(mode) → Report → Reflect

Review:
  Prepare: diff + related code load
  → Report → Reflect

Release:
  Prepare: version + changelog + CI status check
  → Implement(version) → Verify → Reflect

Retro:
  Prepare: git log + history collection
  → Dialogue(analysis) → Report → Reflect

Spike:
  Prepare: minimal scan
  → Implement(prototype, disposable) → Report → Reflect

Exploration:
  Prepare: none
  → Report → Reflect

Compound:
  Prepare: sub-flow identification + dependency ordering
  → [Flow → Gate]* → Report → Reflect
```

## Reclassification Rules

Any step can trigger reclassification:

- Bug Fix discovers design flaw → Refactor or Compound
- Refactor requires public API change → Migration
- Spike confirms feasibility → Feature
- Any flow: 3 failures with same approach → stop, escalate
- Any flow: scope exceeds bounds → Compound or chunking

## Compound Flow Rules

- Sub-flows execute sequentially, each running its full step sequence
- **Decision gate** between each sub-flow: proceed / pivot / abort
- Gate criteria defined during Triage classification
- Dynamic sub-flow count allowed (e.g., Review finds N bugs → N Bug Fix sub-flows)
- State carries between sub-flows within the same session
- If a sub-flow fails, the compound flow pauses for decision

## Chunking Rule

When Prepare identifies scope exceeding bounds (5+ files, 3+ modules), Dialogue MUST produce a chunking plan:
- Split into bounded cycles, each covering one concern/module
- Each cycle is a complete mini-flow (Test → Implement → Verify)
- Dependency order between cycles defined in the plan

## Bug Fix Paths

| Condition | Path |
|-----------|------|
| Normal (reproducible) | Prepare → Test(reproduce RED) → Implement(fix GREEN) → Verify → Reflect |
| P0/production down | Prepare → Implement(emergency fix) → Verify → Test(retroactive, mandatory within 24h) → Reflect. Enforcement: scheduled trigger checks `retroactive_test_due` in flow-state.yaml every 6h, auto-creates Test flow if overdue. Fallback: SessionStart hook warns on next session. |
| Unreproducible (intermittent) | Prepare → Implement(hypothesis fix, documented) → Verify(extended observation) → Reflect |

## Refactor Guards

- If Prepare identifies target code has <80% test coverage → Test step mandatory before Implement to establish baseline
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
| Dialogue | `create_card` (intent+spec) | — | `deliberate` (conditional) |
| Test | — | `scan` (after test code) | — |
| Implement | `validate_code_links`, `write_spec_annotations` | `scan` (every change, expandAffected) | — |
| Verify | `regression_guard` (threshold=0) | `scan` (full project) | `deliberate` (review mode, high-risk) |

### Per-Flow Prepare Tool Mapping

| Flow | Tools in Prepare |
|------|-----------------|
| Feature | emberdeck `pre_change_check`, `get_card_context` |
| Migration | firebat `query-dependencies` |
| Dialogue | emberdeck card query |
| All others | codebase tools only (grep, glob, git log) |

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
- emberdeck absent → code-only analysis, text-only plans, no drift check
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

## Gate Policy

```yaml
gate_policy:
  confirm: [migration, release]
  auto: [*]
```

Configurable per project in `.blazewrit/config.yaml`. `auto: []` = fully manual. `confirm: [migration, release]` = mostly automated.

## Hook Enforcement

See Execution Protocol > Hooks for complete hook specification. Summary:

**Safety**: firebat scan (PostToolUse Edit/Write), regression_guard (PreToolUse commit), stuck detection (PostToolUse Read/Grep/Glob), blocker check (Stop)

**Enforcement**: Reflect gate (Stop), Reflect structure check (PostToolUse Write), coverage gate (PreToolUse Edit/Write in Refactor)

### Hook Failure Policy

| Hook category | On crash/timeout | Rationale |
|---------------|-----------------|-----------|
| **Safety** (firebat, regression_guard, blocker check) | **fail-closed** — wrapper script catches crash → exit 2 (deny) | Violation consequence is dangerous (bad code ships). AgentSpec: >90% unsafe code prevention requires mechanical enforcement |
| **Enforcement** (Reflect gate, coverage gate) | **fail-open** (Claude Code default: non-0/non-2 exit = continue) | Violation consequence is quality issue. Guardrails-as-Infrastructure: stricter policies reduce task success rates |

### Hook Context Detection

Hooks that need flow context (e.g., coverage gate checking if current flow is Refactor) read `.blazewrit/flow-state.yaml` directly. The active flow's `flow` and `step` fields provide the needed context. No environment variables or separate mechanisms required.

## Delivery Form Factor

### What blazewrit Is

blazewrit is a **workflow rule set**, not an agent, not a CLI, not a framework. It is installed into a project and governs how agents work in that project. The host agent reads blazewrit's rules and becomes the orchestrator. Step executors are custom agents spawned by the host.

### Why This Form

| Alternative | Why rejected |
|-------------|-------------|
| **Standalone CLI** (GSD-2 model) | Rebuilds what Claude Code already provides (hooks, agents, mcpServers). Maintenance cost of TypeScript+Rust SDK vs markdown files |
| **Claude Code plugin** | "Plugin subagents restricted (no hooks/mcpServers/permissionMode)" — blazewrit needs all three |
| **MCP server** | MCP exposes individual tools, not orchestrated workflows. firebat/emberdeck/pyreez are MCP servers; blazewrit orchestrates them |
| **Skill collection** (gstack model) | Skills share host context (context rot), no mcpServers scoping, no maxTurns, no worktree isolation. Step agents need all of these |
| **Agent** | blazewrit is not an agent — it is the rules that make the host agent behave as orchestrator. Making blazewrit an agent would add an unnecessary indirection layer |

### Bun Package — Setup Tool (No Runtime Dependency)

blazewrit is a setup tool, not a runtime dependency. It copies rules, agents, hooks, and scripts into the project, then exits. Nothing remains in `dependencies`.

```
bunx @zipbul/blazewrit init
```

Deploys into the project:

```
├── .claude/rules/blazewrit/
│   ├── orchestration.md          ← Triage + state management protocol (always loaded, kept concise)
│   └── enforcement.md            ← deviation rules, gate policy, decision classification
│
├── .claude/agents/
│   ├── dialogue.md               ← tools, mcpServers:[emberdeck,pyreez], maxTurns
│   ├── test.md                   ← tools, mcpServers:[firebat], maxTurns
│   ├── implement.md              ← tools, mcpServers:[firebat,emberdeck], maxTurns, isolation:worktree
│   ├── verify.md                 ← tools(read-only), mcpServers:[firebat,emberdeck,pyreez], maxTurns
│   ├── report.md                 ← tools, maxTurns
│   └── reflect.md                ← tools, maxTurns
│
├── .claude/settings.json          ← global hooks (blocker check, stuck detection, Reflect gate)
│
├── .blazewrit/
│   ├── config.yaml                ← gate_policy, flow settings
│   ├── flows/                     ← flow definitions (on-demand read, NOT context-resident)
│   │   ├── feature.md
│   │   ├── bugfix.md
│   │   ├── bugfix-p0.md
│   │   └── ...                    ← 16 flow files
│   ├── scripts/                   ← state utilities, validators, hook wrapper scripts
│   └── a2a/
│       └── server.ts              ← reference A2A server (thin entry point)
└──
```

**Context budget**: `.claude/rules/blazewrit/` (always loaded) is kept concise — Triage signal table + orchestration protocol only. Flow definitions live in `.blazewrit/flows/` and are read on-demand after Triage classifies. This follows GSD's phase-aware context loading pattern: load only what the current phase needs.

### A2A Integration

blazewrit is input-channel agnostic. The project's A2A server receives external requests and spawns a host agent session in the project directory. The host agent loads blazewrit rules (via `.claude/rules/`) and executes the workflow.

```
External Agent ──A2A──→ Project's A2A Server (.blazewrit/a2a/server.ts)
                              │
                              ↓
                        Host agent session (reads .claude/rules/blazewrit/)
                              │
                              ├─ Triage (classify request → read .blazewrit/flows/<type>.md)
                              ├─ Prepare (analyze scope)
                              ├─ Agent(dialogue) → plan
                              ├─ Agent(test) → tests
                              ├─ Agent(implement) → code (in worktree)
                              ├─ Agent(verify) → quality gate
                              ├─ Agent(reflect) → learnings
                              │
                              ↓
                        Result ──A2A──→ External Agent
```

blazewrit provides a reference A2A server implementation (`.blazewrit/a2a/server.ts`). Minimal thin layer: receive request → spawn `claude` session in project directory → return result. Projects can customize or replace with their own A2A infrastructure.

### Input Channels

| Channel | Example | Human required |
|---------|---------|---------------|
| Human direct | User types request in Claude Code session | Yes |
| Agent (A2A) | Product agent sends feature request to project's A2A server | No — pyreez + self-validation |
| Auto trigger | CI failure → Bug Fix, scheduled cron → Retro | No |

## Quality Assurance Mechanisms

| Mechanism | What it solves | Source |
|-----------|---------------|--------|
| Emberdeck card-unit decomposition | Agent capability limits (FeatureBench 11%) | GSD context budget |
| File-based state (cards, reports, git) | Context degradation over long sessions | Ralph Loop, GSD context-packet |
| Mechanical verification (5/6 checks) | LLM self-evaluation unreliable | Anthropic evaluator research |
| Multi-model cross-verification (pyreez) | Single model bias | gstack dual-voice, AceMAD |
| Goal-backward verification | "exists" ≠ "works" | GSD verifier |

## Validation Status

- 48 scenarios simulated across 14 flows (pre-decomposition) + structural review of 3 Bug Fix variants and Exploration
- Orient decomposed into Triage + flow-owned Prepare
- Step pool: 6 (Dialogue, Test, Implement, Verify, Report, Reflect)
- Flow count: 16 (Bug Fix split into 3 paths)
- Reclassification rules added (any step can trigger)
- Tool mapping updated (firebat removed from Prepare except Migration)
- Triage classification logic added (signal table, strength rules, None classification)
- Flow lifecycle rules added (start, suspend, resume, complete, abandon)
- Flow state persistence added (flow-state.yaml, list structure, archive)
- Execution protocol: step=custom agent, host agent reads rules and orchestrates, Prepare inline
- Enforcement by consequence: dangerous→hook, role violation→allowed-tools, order→file dependency, conditional skip→hook gate, completion→Stop hook, quality→prompt+structure check, judgment→prompt only
- Design rationale documented: why each reference pattern was adopted or rejected
- Implementability verified against Claude Code capabilities: no nonexistent features assumed
- Design decisions 9-12 resolved: Reflect 3-tier distillation, non-impl completion criteria, worktree rollback, hook context detection
- Hook failure policy added: safety=fail-closed, enforcement=fail-open
- P0 retroactive test enforcement: scheduled trigger (mechanical) + SessionStart fallback (advisory)
- Gate policy storage location defined: `.blazewrit/config.yaml`
- Execution model changed: step = custom agent (not skill). Fresh context, scoped mcpServers/hooks/permissionMode/maxTurns/isolation
- blazewrit identity clarified: workflow rule set, not an agent. Host agent reads rules and orchestrates
- Delivery form factor defined: npm package deploys rules (.claude/rules/) + step agents (.claude/agents/) + hooks + scripts
- A2A integration: reference server provided, host agent session governed by blazewrit rules
- Delivery: bunx setup tool (no runtime dependency), not npm install
- Context budget: rules (always loaded, concise) vs flows (on-demand read) split
- Flow definitions moved from .claude/rules/ to .blazewrit/flows/ (phase-aware context loading)

## Reflect Detail

### 3-Tier Progressive Knowledge Distillation

Adopted from Ralph Loop's 3-tier pattern. ACE (arXiv 2510.04618) warns against "brevity bias" (removing domain insights for conciseness) and "context collapse" (detail erosion through iterative rewrites).

| Tier | Location | Content | Lifecycle |
|------|----------|---------|-----------|
| **Raw** | `.blazewrit/flow-history/<id>.yaml` | Full Reflect output: what_worked, what_failed, unexpected, patterns_discovered | Auto-archived on flow completion/abandonment |
| **Curated** | `.claude/rules/<topic>.md` | Patterns observed 3+ times across flows. Append-only updates — never rewrite existing content | Promoted from Tier 1 when pattern repeats. Pruned when contradicted by evidence |
| **Permanent** | CLAUDE.md (manual) | Battle-tested rules the user chooses to enshrine | User decision only. Reflect never writes here directly |

### Reflect Required Sections

Every Reflect output must contain (enforced by Reflect structure check hook):

1. **what_worked** — techniques, tools, approaches that succeeded
2. **what_failed** — what didn't work and why
3. **unexpected** — surprises, edge cases, assumptions proven wrong
4. **patterns_discovered** — recurring observations worth tracking

### Dedup Rule

Before writing to Tier 2 (`.claude/rules/`), Reflect searches existing rule files for the same pattern. If found: append new evidence to existing file. If not found: create new file. Never create duplicate rules.

## Non-Implementation Flow Completion Criteria

Flows without code output (Review, Retro, Exploration, Spike, Dialogue) complete when their terminal artifact exists and is substantive (GSD verifier Level 1 + Level 2: exists and not stub).

| Flow | Terminal artifact | Completion = |
|------|------------------|--------------|
| Review | `.blazewrit/reports/<flow-id>.md` | Report exists + every finding has severity tag |
| Retro | `.blazewrit/reports/<flow-id>.md` | Report exists + at least 1 action item |
| Exploration | `.blazewrit/reports/<flow-id>.md` | Report exists with content (no minimum structure) |
| Spike | `.blazewrit/reports/<flow-id>.md` | Report exists + feasibility verdict (GO / NO-GO / CONDITIONAL) |
| Dialogue | `.blazewrit/plans/<flow-id>.md` | Plan exists + next step explicitly named |

## Rollback and Failure Recovery

### Worktree Isolation (High-Risk Flows)

High-risk flows (Feature, Migration, Refactor) run Implement in a git worktree. Verify checks the worktree. Merge to main only on Verify PASS. On failure, delete worktree — zero rollback cost, zero main branch contamination.

```
Feature/Migration/Refactor:
  Implement → runs in git worktree (Claude Code isolation: worktree)
    → Verify PASS → merge worktree to main
    → Verify FAIL → iteration++ (fix in same worktree)
    → iteration >= 3 with same approach → STOP, escalate
    → User chooses: different approach | fresh restart | abandon

Low-risk flows (Bug Fix, Chore, Test, Release):
  Implement → runs on main branch directly
    → Verify FAIL → git revert last commit, retry
    → 3 failures → BLOCKED, escalate
```

**Fresh restart option**: When stuck, starting over in a new worktree with fresh context is often better than debugging accumulated state (Devin insight, Ralph Loop pattern, Anthropic 4.6 best practice: fresh context > compaction).

### Escalation on Failure

| Failure count | Same approach? | Action |
|---------------|---------------|--------|
| 1-2 | Yes | Retry with fix |
| 3 | Yes | STOP — same approach exhausted (GSD deviation rule 4) |
| 1-2 | No (different approach) | Continue |
| 3 | No | BLOCKED — present options: fresh restart, user intervention, abandon |

## Remaining Work (Implementation Phase)

### Step Agents
1. Step agents (dialogue.md, test.md, implement.md, verify.md, report.md, reflect.md) — custom agent frontmatter (tools, mcpServers, hooks, maxTurns, isolation) + prompt body (output contract, self-validation criteria, files_to_read)

### Orchestration Rules
2. Orchestration rules (.claude/rules/blazewrit/orchestration.md) — Triage + Prepare + agent invocation + state file management protocol
3. Enforcement rules (.claude/rules/blazewrit/enforcement.md) — deviation rules, gate policy, decision classification

### Flow Definitions
4. Flow definition files (.claude/rules/blazewrit/flows/) — Prepare content, step order, artifact chain per flow

### Hooks
5. Safety hooks: firebat scan, regression_guard, stuck detection, blocker check
6. Enforcement hooks: Reflect gate (Stop), Reflect structure check, coverage gate
7. Hook wrapper scripts (fail-closed for safety hooks)

### Scripts
8. flow-state read/write utilities
9. Reflect structure validator (check required sections)
10. Coverage checker (for Refactor conditional Test gate)

### Design Decisions (Resolved)
9. ~~Reflect detail~~ → See "Reflect Detail" section (3-tier distillation, required sections, dedup rule)
10. ~~Non-implementation flow completion criteria~~ → See "Non-Implementation Flow Completion Criteria" section
11. ~~Rollback guidance~~ → See "Rollback and Failure Recovery" section (worktree isolation + escalation)
12. ~~Hook context detection~~ → See "Hook Enforcement > Hook Context Detection" (read flow-state.yaml)
