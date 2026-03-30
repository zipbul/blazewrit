# GSD (Get Shit Done) — Repo Audit

Source: github.com/gsd-build/get-shit-done (v1.30.0) + github.com/gsd-build/gsd-2 (v2.52.0)
Audited: 2026-03-30

## Overview

GSD exists as two codebases:
- **GSD-1**: Prompt injection framework — installs as markdown files (agents, commands, workflows) into AI coding tools. npm: `get-shit-done-cc`.
- **GSD-2**: Standalone CLI built on Pi SDK (TypeScript + Rust N-API). npm: `gsd-pi`. Programmatic context window management, model routing, session control.

Both share the same author (TACHES). GSD-2 is the future; GSD-1 will sunset.

## Architecture

### GSD-1: Five Layers

```
USER (/gsd:command)
  → COMMAND LAYER (commands/gsd/*.md) — 44 commands
    → WORKFLOW LAYER (workflows/*.md) — 46 workflows
      → AGENT LAYER (agents/*.md) — 16 specialized agents
        → CLI TOOLS LAYER (bin/gsd-tools.cjs) — 17 modules
          → FILE SYSTEM (.planning/)
```

Core design decisions:
- **Fresh context per agent**: Every spawned subagent gets a clean context window. Primary defense against "context rot."
- **Thin orchestrators**: Workflows never do heavy lifting — load context, spawn agents, collect results, route.
- **File-based state**: All state in `.planning/` as human-readable Markdown + JSON.
- **Plans are prompts**: PLAN.md files ARE execution prompts, not documents that become prompts.

### GSD-2: SDK-Based

```
gsd CLI → loader → cli.ts
  → Extensions (16+)
  → Bundled Agents (Scout, Researcher, Worker)
  → Native Rust Engine (grep, glob, git, AST, diff)
  → Auto-mode state machine
  → Model router (complexity + capability scoring)
```

Key additions over GSD-1: SQLite state, worktree isolation, dynamic model routing, crash recovery, cost tracking, web UI.

## Agents (16)

### Core Pipeline

| Agent | Role | Key Pattern |
|-------|------|-------------|
| **planner** | Creates PLAN.md (task breakdown, dependency graphs, wave assignment) | Goal-backward, discovery levels 0-3, context budget ~50% |
| **executor** | Executes plans atomically, per-task commits | 4 deviation rules, analysis paralysis guard (5+ reads without write = stuck) |
| **verifier** | Goal-backward verification | 4-level artifact check (exists, substantive, wired, data-flowing) |
| **debugger** | Scientific method debugging | Hypothesis testing, knowledge base protocol, cognitive bias guards |
| **plan-checker** | Pre-execution plan quality | 6 verification dimensions |

### Research & Discovery

project-researcher, phase-researcher, research-synthesizer, advisor-researcher, assumptions-analyzer, codebase-mapper, roadmapper

### UI-Specific

ui-researcher (UI-SPEC.md), ui-checker (quality validation), ui-auditor (visual audit)

### Other

integration-checker (cross-phase wiring), nyquist-auditor (test gap detection), user-profiler (behavioral analysis)

## Commands (44)

**Project Lifecycle:** new-project, new-milestone, new-workspace, complete-milestone
**Planning:** plan-phase, discuss-phase, research-phase, add-phase, remove-phase, insert-phase
**Execution:** execute-phase, do, fast, quick, autonomous
**Verification:** verify-work, validate-phase, audit-milestone, audit-uat
**Navigation:** next, progress, resume-work, pause-work, health
**Shipping:** ship, pr-branch, review
**Utility:** thread, note, debug, forensics, map-codebase, manager, stats, settings, help

## Key Patterns

### 1. Meta-Prompting (Prompts that Generate Prompts)

Three levels of prompt generation:
1. **Command prompts** (user-facing) → reference workflow prompts
2. **Workflow prompts** (orchestration) → spawn agent prompts with injected context
3. **Agent prompts** (execution) → produce PLAN.md files that ARE prompts for executor agents

The planner creates PLAN.md containing `<objective>`, `<context>` with `@-references`, `<tasks>` with `<action>`, `<verify>`, `<done>` blocks. The executor reads PLAN.md as its execution prompt.

### 2. Context Engineering

**a) Fresh context per agent**: Each `Task()` call = clean 200K-token window.

**b) Context budget management**: Plans target ~50% usage, 2-3 tasks max per plan.
Quality degradation model: 0-30% PEAK → 30-50% GOOD → 50-70% DEGRADING → 70%+ POOR.

**c) Context monitor hook** (`gsd-context-monitor.js`): PostToolUse hook reads metrics from bridge file, injects warnings at 35% (WARNING) and 25% remaining (CRITICAL).

**d) Context engine** (SDK): Resolves which `.planning/` files to load per workflow type. Execute needs STATE.md + config. Plan needs STATE.md + ROADMAP.md + CONTEXT.md + RESEARCH.md + REQUIREMENTS.md.

**e) History digest protocol**: Two-step — generate digest index first, then select 2-4 most relevant phases for full reads.

### 3. Context-Packet Pattern (`<files_to_read>`)

Primary context injection mechanism when spawning subagents:

```xml
<files_to_read>
.planning/STATE.md
.planning/ROADMAP.md
.planning/phases/01-auth/01-01-PLAN.md
</files_to_read>
```

Agent's first instruction: "If the prompt contains a `<files_to_read>` block, you MUST use the Read tool to load every file listed there before performing any other actions."

### 4. Spec-Driven Development Pipeline

```
new-project (questioning → research → requirements → roadmap)
  → discuss-phase (decisions, gray areas → CONTEXT.md)
    → research-phase (domain investigation → RESEARCH.md)
      → plan-phase (decompose → PLAN.md files)
        → plan-checker (verify plans achieve goals)
          → execute-phase (wave-based parallel → SUMMARY.md)
            → verify-work (goal-backward → VERIFICATION.md)
              → ship (PR creation, review)
```

Artifacts chain: PROJECT.md → REQUIREMENTS.md → ROADMAP.md → CONTEXT.md → RESEARCH.md → PLAN.md → SUMMARY.md → VERIFICATION.md → UAT.md

### 5. TACHES System (State Management)

State in `.planning/STATE.md` — tracks current phase/plan, decisions, blockers, metrics, sessions. Updated via `gsd-tools.cjs state` commands.

### 6. Auto-Loop

**GSD-1 (`/gsd:autonomous`)**: Reads ROADMAP.md, iterates remaining phases (discuss → plan → execute). Checkpoint types: human-verify (auto-approve), decision (auto-select first), human-action (STOP).

**GSD-2 (Auto Engine)**: Full state machine — read state → determine next unit → classify complexity → select model → build prompt → fresh session → execute → verify → persist → loop. Includes stuck detection, timeout recovery, hallucination guards.

### 7. Wave-Based Parallel Execution

Plans assigned to waves by dependency analysis. Wave 1 (no deps) runs in parallel. Wave 2 depends on Wave 1, etc. File ownership declared in frontmatter prevents overlap.

### 8. Multi-Layer Verification

1. **Plan-checker** (pre): 6-dimension quality check
2. **Self-check** (during): Executor verifies own claims
3. **Verifier** (post): 4-level artifact verification
4. **UAT** (human): Conversational testing
5. **Integration checker**: Cross-phase wiring
6. **Nyquist auditor**: Test gap detection

### 9. Deviation Rules (During Execution)

- Rule 1: Auto-fix bugs (no permission)
- Rule 2: Auto-add critical missing functionality (no permission)
- Rule 3: Auto-fix blocking issues (no permission)
- Rule 4: Architectural changes → STOP, ask user
- Fix attempt limit: 3 per task, then document and move on

### 10. Guardrails

- Prompt injection guard hook (scans `.planning/` writes)
- Workflow guard hook (detects edits outside GSD workflow)
- Analysis paralysis guard: 5+ consecutive reads without write = stuck
- Hallucination guard (GSD-2): Zero tool calls = rejected
- Scope boundary: Only auto-fix issues caused by current task

## Prompt Engineering Techniques

1. **XML-structured instructions**: `<role>`, `<execution_flow>`, `<step>`, `<deviation_rules>`
2. **Mandatory initial read**: `<files_to_read>` block + explicit "MUST read before any action"
3. **Specificity tables**: "TOO VAGUE vs JUST RIGHT" comparison tables
4. **Anti-pattern lists**: Explicit "DON'T" sections with bad examples
5. **Structured return contracts**: Every agent has defined output format
6. **Goal-backward methodology**: "What must be TRUE" not "what was done"
7. **Discovery levels**: 4-tier (Skip, Quick, Standard, Deep Dive)
8. **Quality degradation curve**: Explicit context usage → quality mapping
9. **Cognitive bias awareness**: Debugger guards against confirmation bias, anchoring, availability bias, sunk cost
10. **Calibration tiers**: full_maturity, standard, minimal_decisive controlling output depth

## GSD-2 Advanced Patterns

- **Dynamic model routing**: complexity classification + capability scoring, downgrade-only
- **Single-writer state**: SQLite with machine guards, actor identity, audit log
- **Worktree isolation**: Git worktrees for parallel milestone execution
- **TTSR (Tool-Triggered System Rules)**: Conditional context injection based on active tools
- **Frontier research**: SkillRL-inspired self-improving skills, DAG-based parallel tool execution, speculative tool execution, MCTS-based planning
