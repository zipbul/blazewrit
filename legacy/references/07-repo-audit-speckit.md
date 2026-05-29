# spec-kit — Repo Audit

Source: github.com/github/spec-kit (v0.2.0)
Audited: 2026-03-30

## Overview

GitHub's official spec-driven development (SDD) toolkit. Pure configuration/template/script toolkit — no compiled source in repo. Markdown command prompts + Bash scripts + extension/preset systems. Supports 27+ AI coding agents.

~71k stars, 6.4k forks as of Feb 2026.

## Architecture

| Component | Path | Purpose |
|-----------|------|---------|
| Commands | `templates/commands/*.md` | LLM prompt instructions for slash commands |
| Templates | `templates/*.md` | Scaffolds for specs, plans, tasks, constitution |
| Scripts | `scripts/bash/`, `scripts/powershell/` | Branch creation, prerequisites, agent context updates |
| Extensions | `extensions/` | Plugin architecture for 3rd-party integrations |
| Presets | `presets/` | Stackable template/command overrides |
| CLI | `specify` (Python/uv) | Bootstrap projects with the framework |
| Docs | `docs/` | DocFX documentation site |

Key insight: **the "code" is the markdown prompts themselves.** Scripts handle mechanical tasks, the LLM does intellectual work.

## Core Workflow: /specify → /plan → /tasks → /implement

### `/speckit.specify` — Create Feature Specification

1. Runs `create-new-feature.sh`: auto-detects next feature number, creates branch `NNN-short-name`, copies spec template
2. LLM fills spec focusing on WHAT and WHY, never HOW
3. Maximum 3 `[NEEDS CLARIFICATION]` markers — make informed guesses for rest
4. Creates quality checklist at `checklists/requirements.md`
5. Self-validates up to 3 iterations
6. Checks extension hooks (before_specify, after_specify)
7. Hands off to `/speckit.plan` or `/speckit.clarify`

### `/speckit.clarify` — Refine Spec (Optional)

1. 11-category ambiguity scan (Functional Scope, Domain & Data Model, Interaction & UX, Non-Functional, Integration, Edge Cases, Constraints, Terminology, etc.)
2. Up to 5 prioritized questions using `Impact * Uncertainty` heuristic
3. Questions asked ONE AT A TIME (progressive disclosure)
4. Each answer immediately integrated into spec (atomic overwrite)
5. LLM provides recommended answer for each question

### `/speckit.plan` — Create Implementation Plan

1. Copies `plan-template.md` to feature directory
2. Loads spec + constitution (`memory/constitution.md`)
3. **Phase 0 (Research)**: For each NEEDS CLARIFICATION in tech context, dispatch research. Output `research.md`
4. **Phase 1 (Design)**: Generate `data-model.md`, `contracts/`, `quickstart.md`
5. Runs `update-agent-context.sh` to update CLAUDE.md/AGENTS.md with new tech stack
6. Constitution Check with gates (Simplicity Gate, Anti-Abstraction Gate, Integration-First Gate)
7. Complexity Tracking table for justified violations

### `/speckit.tasks` — Generate Task List

1. Reads plan.md (required), spec.md (required for user stories)
2. Tasks organized by user story:
   - Phase 1: Setup
   - Phase 2: Foundational (blocking prerequisites)
   - Phase 3+: One per user story in priority order (P1, P2, P3)
   - Final: Polish & Cross-Cutting
3. Strict format: `- [ ] T001 [P] [US1] Description with file path`
   - `[P]` = parallelizable, `[US1]` = user story label
4. Tests OPTIONAL (only if explicitly requested)

### `/speckit.implement` — Execute Implementation

1. Checks checklists status — if incomplete, asks whether to proceed
2. Creates/verifies ignore files based on detected technology
3. Phase-by-phase execution respecting sequential/parallel markers
4. Marks tasks `[X]` as completed in tasks.md
5. Halts on non-parallel failures; continues past parallel failures
6. Final validation against original spec

### `/speckit.analyze` — Cross-Artifact Consistency

STRICTLY READ-ONLY. Six detection passes:
- A. Duplication
- B. Ambiguity (vague adjectives without metrics)
- C. Underspecification
- D. Constitution Alignment
- E. Coverage Gaps (requirements with zero tasks)
- F. Inconsistency (terminology drift, entity mismatches)

Max 50 findings. Severity: CRITICAL > HIGH > MEDIUM > LOW.

### `/speckit.checklist` — Quality Checklists

"Unit tests for English" — validate REQUIREMENTS quality, not implementation.
Items ask "Are requirements defined?" not "Does the button work?"

### `/speckit.constitution` — Project Constitution

Immutable project principles governing all specs/plans/tasks. Semantic versioning. Propagates changes to all templates.

### `/speckit.taskstoissues` — GitHub Issues

Converts tasks.md to GitHub Issues via `gh` MCP tool. Safety: only if remote is GitHub.

## AGENTS.md Patterns

Developer guide for adding new agent support:
- **AGENT_CONFIG dictionary** (Python) as single source of truth
- **27+ supported agents**: Claude, Gemini, Copilot, Cursor, Qwen, opencode, Codex, Windsurf, Junie, Kilo Code, Auggie, Roo Code, CodeBuddy, Qoder, Kiro, Amp, SHAI, Tabnine, Kimi, Pi, iFlow, IBM Bob, Trae, Antigravity, Generic
- Two formats: Markdown (most) and TOML (Gemini, Tabnine)
- Argument placeholders: `$ARGUMENTS` (Markdown), `{{args}}` (TOML)

## Extension System

- Install to `.specify/extensions/<name>/`
- `extension.yml` manifest (schema v1.0)
- Command naming: `speckit.<extension-id>.<command-name>`
- Hook system: before/after for specify, plan, tasks, implement
- Hooks: mandatory (auto-execute) or optional (prompt user)
- Two catalogs: org-curated + community

Notable community extensions (35+):
- **AIDE**: 7-step alternative workflow
- **MAQA**: Multi-agent QA with parallel worktree implementation
- **Jira/Azure DevOps/Linear integrations**
- **Cognitive Squad**: Multi-agent with triadic model + backpropagation verification

## Preset System

Stackable, priority-ordered overrides:

Resolution stack (highest to lowest):
1. `.specify/templates/overrides/` — project-local
2. `.specify/presets/<preset-id>/templates/` — installed presets
3. `.specify/extensions/<ext-id>/templates/` — extension templates
4. `.specify/templates/` — core templates

Templates resolved at runtime; commands applied at install time.

## Scripts

### `create-new-feature.sh`
Auto-detects next number from specs/ + git branches. `--timestamp` mode for distributed teams. Smart branch name generation with stop-word filtering.

### `setup-plan.sh`
Copies plan template, outputs JSON with paths.

### `check-prerequisites.sh`
Unified prerequisite checking. Modes: `--require-tasks`, `--include-tasks`, `--paths-only`.

### `common.sh`
`find_specify_root()`, `get_repo_root()`, `resolve_template()` (4-level priority stack), `find_feature_dir_by_prefix()`.

### `update-agent-context.sh` (838 lines)
Parses plan.md for language/framework/database/project type. Updates 27+ agent config files. Preserves manual additions between markers. Deduplicates for shared-file agents.

## Templates

| Template | Key Features |
|----------|-------------|
| spec-template.md | User Stories (P1/P2/P3), Requirements (FR-###), Success Criteria (SC-###), Key Entities, Assumptions |
| plan-template.md | Technical Context, Constitution Check, 3 project layout options, Complexity Tracking |
| tasks-template.md | Strict checklist format, dependency graph, parallel examples, MVP strategy |
| constitution-template.md | Core Principles (configurable count), Governance, semantic versioning |
| agent-file-template.md | Active Technologies, Project Structure, Commands, Code Style, Recent Changes |

## Context Engineering Patterns

### 1. Template-as-Prompt
Templates are LLM behavioral constraints. Spec template forces "WHAT not HOW." Plan template enforces constitutional gates. Tasks template mandates strict checklist format.

### 2. Constitutional Enforcement
`constitution.md` defines immutable principles. Checked at plan time via phase gates (Simplicity Gate, Anti-Abstraction Gate, Integration-First Gate). Violations require justification in Complexity Tracking table.

### 3. Escalation Limits
Max 3 NEEDS CLARIFICATION markers. Max 5 clarify questions. Max 3 validation iterations. Max 50 analyze findings.

### 4. Self-Validation Loops
`/specify` writes spec → checks against quality checklist → iterates up to 3 times.

### 5. Hook System
Before/after hooks on every core command. Mandatory (auto-execute) or optional (prompt user).

### 6. Handoff Chain
Explicit next-step offers: specify → plan/clarify, plan → tasks/checklist, tasks → analyze/implement.

### 7. Script + LLM Separation
Mechanical tasks (branch creation, file copying, JSON) = deterministic scripts.
Intellectual tasks (spec writing, planning, analysis) = LLM.

### 8. Multi-Agent Universality
Same prompts work across 27+ agents via abstracted placeholders and format detection.

### 9. Progressive Context Loading
Commands load only necessary artifact portions. `/analyze` caps output at 50 findings.

### 10. Recommendation-First Interaction
`/clarify` provides LLM's recommended answer prominently, with "yes" shortcut for acceptance.

## SDD Ecosystem Context (from Newsletter)

- AWS Kiro: Design-First and Bugfix modes
- OpenSpec: ~29.3k stars
- Tessl: spec-as-source model (private beta)
- arXiv preprint categorizes SDD into: spec-first, spec-anchored, spec-as-source levels
