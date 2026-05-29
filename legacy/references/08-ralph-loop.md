# Ralph Loop — Research Notes

Source: github.com/snarktank/ralph (MIT, 2026 Ryan Carson)
Origin: Geoffrey Huntley's Ralph pattern (ghuntley.com/ralph/)
Audited: 2026-03-30

## Overview

Ralph is a minimalist autonomous agent loop — a 114-line bash script that repeatedly spawns fresh AI instances (Amp or Claude Code) to implement user stories from a PRD until all are complete. Not a library or framework.

## Architecture

```
Human → [PRD skill] → tasks/prd-feature.md
       → [Ralph skill] → prd.json (structured user stories)
       → ralph.sh (bash loop, max N iterations)
           → Iteration 1: fresh AI → implement story → commit → update status
           → Iteration 2: fresh AI (no memory except files)
           → ...
           → Iteration N or <promise>COMPLETE</promise>
```

### File Inventory

| File | Role |
|------|------|
| `ralph.sh` | Core loop (114 lines bash) |
| `prompt.md` | Prompt template for Amp |
| `CLAUDE.md` | Prompt template for Claude Code |
| `prd.json.example` | Example PRD in JSON format |
| `skills/ralph/SKILL.md` | Markdown-to-JSON PRD converter |
| `skills/prd/SKILL.md` | PRD generation from feature descriptions |
| `flowchart/` | React Flow interactive visualization |

## The Ralph Loop — Exact Specification

### Entry Conditions
1. `prd.json` exists with at least one story where `passes: false`
2. User runs `./ralph.sh [--tool amp|claude] [max_iterations]`
3. Default max iterations: 10

### Pre-Loop Setup
1. Archive detection: if `prd.json.branchName` differs from `.last-branch`, archive previous run
2. Branch tracking: save current branchName to `.last-branch`
3. Progress initialization: create `progress.txt` if missing

### Loop Body (each iteration)
1. **Spawn fresh AI** with zero conversational memory:
   - Amp: `cat prompt.md | amp --dangerously-allow-all`
   - Claude: `claude --dangerously-skip-permissions --print < CLAUDE.md`
2. Capture output via `tee /dev/stderr`
3. Check for `<promise>COMPLETE</promise>` in output
4. Sleep 2 seconds between iterations

### What Each AI Instance Does
1. Read `prd.json` and `progress.txt` (especially "Codebase Patterns" section at top)
2. Ensure correct git branch exists
3. Pick **highest priority** story where `passes: false`
4. **Implement that single story** (one story per iteration — critical constraint)
5. Run quality checks (typecheck, lint, test)
6. Commit: `feat: [Story ID] - [Story Title]`
7. Set `passes: true` in `prd.json`
8. Append structured progress entry to `progress.txt`
9. If ALL stories pass → output `<promise>COMPLETE</promise>`

### Exit Conditions
1. **Success**: `<promise>COMPLETE</promise>` detected → exit 0
2. **Exhaustion**: Max iterations reached → exit 1
3. **Crash**: `set -e` aborts on unexpected error (AI invocations wrapped with `|| true`)

## Memory and Context Management

### Fresh Context Per Iteration
Each iteration = completely new AI process with no conversational memory. Not a retry within the same session — a cold start.

### Three Persistence Channels

| Channel | What it Carries | Pattern |
|---------|----------------|---------|
| `prd.json` | Story status (`passes: true/false`), details, branch | Structured JSON |
| `progress.txt` | Append-only log: what happened, learnings, patterns | Free-text with curated patterns section |
| Git history | All code changes, commit messages | `git log`, diffs |

### Progressive Knowledge Distillation (3 tiers)
1. **Raw learnings** in progress.txt (per-iteration logs)
2. **Curated patterns** at TOP of progress.txt (promoted from raw logs)
3. **Permanent patterns** in AGENTS.md (survives beyond Ralph runs)

## Guardrails (Implicit, Distributed)

### Quality Gates
- Typecheck must pass (mandatory acceptance criterion)
- Tests must pass
- Never commit broken code
- Keep CI green

### Scope Guards
- **One story per iteration** — prevents context bloat and scope creep
- **Small story sizing** — each must fit in one context window ("2-3 sentences max")
- **Dependency ordering** — schema → backend → UI

### Behavioral Guards
- Read patterns first (explicit instruction)
- Commit message format enforced
- Append-only progress (never replace)
- Browser verification for UI stories

### Architectural Guards
- Fresh context per iteration (prevents runaway sessions)
- Max iterations (hard ceiling, default 10)
- Auto-archiving on branch switch (prevents stale state)

## Spec-Driven Pipeline

### Stage 1: PRD Generation (`skills/prd/SKILL.md`)
- Human provides feature description
- Skill asks 3-5 clarifying questions with lettered options
- Generates structured markdown PRD

### Stage 2: PRD to JSON (`skills/ralph/SKILL.md`)
- Converts markdown PRD to `prd.json`
- Enforces: single-context-window stories, dependency ordering, verifiable criteria

### Stage 3: Autonomous Execution
- `ralph.sh` executes stories one at a time

## Comparison: Ralph vs Reflexion vs Test⇄Implement

| Dimension | Ralph Loop | Reflexion (NeurIPS 2023) | Test⇄Implement |
|-----------|-----------|--------------------------|-----------------|
| Iteration target | Next incomplete task | Same task, better reflection | Same task, fix failures |
| Memory type | Files (JSON + text + git) | Verbal reflections | Test output |
| Context | Fresh per iteration | Fresh with reflections | Same session |
| Decomposition | Pre-decomposed (PRD→stories) | None | None |
| Quality gate | Typecheck + tests + browser | Pass/fail signal | Test pass/fail |
| Scope | Multi-task project | Single task | Single task |
| Knowledge transfer | Curated patterns + git | Accumulated reflections | Test error messages |

### Novel Aspects of Ralph
1. **Decomposition-first**: Problem broken down BEFORE any code runs
2. **Filesystem as shared memory**: No APIs, databases, vector stores — just files
3. **Progressive knowledge distillation**: Raw logs → curated patterns → permanent AGENTS.md

## Notable Techniques

1. **Sentinel-based IPC**: `<promise>COMPLETE</promise>` grep in stdout — pragmatic but fragile
2. **Prompt-as-stdin**: `cat prompt.md | amp` — prompt file IS the instruction set
3. **Dangerously permissive execution**: `--dangerously-allow-all` / `--dangerously-skip-permissions`
4. **Archive-on-branch-switch**: Prevents stale context pollution
5. **Dual-tool support**: Same system works with Amp and Claude Code

## Limitations

1. No intra-iteration retry (failed story just stays `passes: false`)
2. No parallelism (strictly sequential stories)
3. No rollback mechanism for subtle cross-story bugs
4. Fragile completion signal (grep for literal string)
5. No human-in-the-loop during execution
6. Story sizing is critical — too large = poor code, no runtime detection
