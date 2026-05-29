# gstack — Repo Audit

Source: github.com/garrytan/gstack (v0.13.8.0)
Audited: 2026-03-30

## Overview

gstack is a collection of SKILL.md files (Claude Code skills) plus a headless browser binary and design image generation CLI. Turns Claude Code into a "virtual engineering team" with 28+ specialist roles. By Garry Tan (YC President/CEO).

## Architecture

| Layer | Files | Purpose |
|-------|-------|---------|
| Project instructions | `CLAUDE.md` | Dev instructions for working ON gstack |
| Agent definitions | `AGENTS.md` | User-facing skill listing + build commands |
| Philosophy | `ETHOS.md` | 3 builder principles |
| Design system | `DESIGN.md` | Visual design for community site |
| Architecture | `ARCHITECTURE.md` | Technical decisions (daemon, refs, security) |
| Root skill | `SKILL.md` / `SKILL.md.tmpl` | `/browse` entry point |
| Per-skill dirs | `qa/SKILL.md.tmpl`, etc. | Individual skill definitions |
| Template system | `scripts/gen-skill-docs.ts` + resolvers/ | Generates SKILL.md from .tmpl + code metadata |
| Browse binary | `browse/src/` | Headless Chromium daemon (Bun/Playwright) |
| Design binary | `design/src/` | AI mockup generation (GPT Image API) |
| CLI utilities | `bin/` | Config, analytics, telemetry |

### Skill File Structure

Each skill = own directory with:
- `SKILL.md.tmpl` — human-authored template (source of truth)
- `SKILL.md` — auto-generated output (never hand-edited)

YAML frontmatter: `name`, `preamble-tier` (1-4), `version`, `description`, `allowed-tools`, `hooks`, `sensitive`, `benefits-from`

### Template Resolver System

35+ resolvers in `scripts/resolvers/` process `{{PLACEHOLDER}}` tags:
- `preamble.ts`: PREAMBLE, TEST_FAILURE_TRIAGE
- `browse.ts`: COMMAND_REFERENCE, SNAPSHOT_FLAGS, BROWSE_SETUP
- `design.ts`: DESIGN_METHODOLOGY, DESIGN_HARD_RULES, etc.
- `testing.ts`: TEST_BOOTSTRAP, TEST_COVERAGE_AUDIT_*
- `review.ts`: REVIEW_DASHBOARD, SPEC_REVIEW_LOOP, ADVERSARIAL_STEP, etc.
- `utility.ts`: SLUG_EVAL, BASE_BRANCH_DETECT, DEPLOY_BOOTSTRAP, etc.
- `learnings.ts`: LEARNINGS_SEARCH, LEARNINGS_LOG
- `confidence.ts`: CONFIDENCE_CALIBRATION

Multi-host generation: `--host claude`, `--host codex`, `--host factory`, `--host all`

### Browse Subsystem

```
Claude Code → CLI (Bun binary) → HTTP POST → Server (Bun.serve) → Chromium (CDP)
```

- Daemon model: first call ~3s startup, subsequent ~100-200ms
- Persistent state (cookies, localStorage, tabs)
- Ref system: `@e1`, `@e2` map to Playwright Locators
- Security: localhost-only, bearer token, 0o600 state file
- Cookie import from real Chrome/Arc/Brave via PBKDF2+AES decryption

## The Sprint Workflow

**Think → Plan → Build → Review → Test → Ship → Reflect**

| Phase | Skills |
|-------|--------|
| Think | `/office-hours` |
| Plan | `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/autoplan` |
| Design | `/design-consultation`, `/design-shotgun`, `/design-review` |
| Build | (user builds with Claude Code) |
| Review | `/review`, `/codex`, `/cso` |
| Test | `/qa`, `/qa-only`, `/benchmark`, `/canary` |
| Ship | `/ship`, `/land-and-deploy`, `/document-release` |
| Reflect | `/retro` |
| Safety | `/careful`, `/freeze`, `/guard`, `/unfreeze`, `/investigate` |
| Meta | `/browse`, `/connect-chrome`, `/setup-browser-cookies`, `/setup-deploy`, `/gstack-upgrade`, `/learn` |

## Skills (28+) — Summary

### Think Phase

**`/office-hours`** — YC partner / design thinking collaborator. Two modes: Startup (6 forcing questions) and Builder (generative brainstorm). Anti-sycophancy rules. Three-layer synthesis with "EUREKA" detection. Codex/Claude dual voice. Founder signal tracking (8 signals).

### Plan Phase

**`/plan-ceo-review`** — CEO/founder strategic reviewer. 18 cognitive patterns (Bezos doors, Munger inversion, Jobs subtraction). 9 Prime Directives. Four scope modes (expand/selective/hold/reduce). Dual voices (Codex + Claude subagent). `benefits-from: [office-hours]`.

**`/plan-eng-review`** — Engineering manager. 15 cognitive patterns (boring by default, blast radius instinct). Step 0 Scope Challenge. Completeness check. ASCII diagrams mandatory. Test diagram mapping.

**`/plan-design-review`** — Senior designer. 12 cognitive patterns (empathy as simulation, subtraction default). 9 Design Principles. Rate 0-10, fix to reach 10. AI mockup generation.

**`/autoplan`** — Automated pipeline: CEO → Design → Eng sequentially. 6 Decision Principles. Decision classification: Mechanical (auto), Taste (surface at gate), User Challenge (never auto). Decision audit trail.

### Review Phase

**`/review`** — Staff engineer PR review. Two-pass: Pass 1 CRITICAL (SQL safety, LLM trust boundary, race conditions), Pass 2 INFORMATIONAL. Fix-first (mechanical fixes auto-applied). Scope drift detection.

**`/codex`** — OpenAI Codex CLI wrapper. Three modes: Review, Challenge (adversarial chaos engineer), Consult. Filesystem boundary instruction. Cross-model analysis.

**`/cso`** — Chief Security Officer. 14-phase audit (OWASP Top 10 + STRIDE). Two modes: daily (8/10 confidence gate) and comprehensive (2/10 bar). 22 hard exclusion rules. Anti-manipulation instruction.

### Test Phase

**`/qa`** — QA lead. Three tiers: Quick/Standard/Exhaustive. Diff-aware scoping. Atomic commits per fix. Before/after screenshots. Self-regulation: fix-risk heuristic, 30-fix cap.

**`/qa-only`** — Same methodology, report only, no code changes.

**`/benchmark`** — Performance engineer. Real `performance.getEntries()` data. Regression thresholds. Core Web Vitals.

**`/canary`** — SRE. Post-deploy monitoring loop (60s intervals). Alert persistence filter (2+ consecutive checks).

### Ship Phase

**`/ship`** — Release engineer. Non-interactive by default. Review readiness dashboard. Test bootstrap (creates framework from scratch if none). Auto-invokes `/document-release`.

**`/land-and-deploy`** — Post-ship: merge PR, wait CI/deploy, verify production. Deploy platform detection (Fly.io, Render, Vercel, etc.). Rollback on failure.

**`/document-release`** — Technical writer. Cross-reference diff vs docs. CHANGELOG voice polish. TODOS.md cleanup.

### Design Phase

**`/design-consultation`** — Design partner. Competitive research via browse. Complete design system from scratch. Font blacklist + overused font list. AI slop anti-patterns.

**`/design-shotgun`** — Design explorer. Taste memory from prior `approved.json`. Parallel variant generation. Comparison board.

**`/design-review`** — Designer who codes. Visual audit of live sites, then fix with atomic commits. Design-fix risk heuristic.

### Reflect Phase

**`/retro`** — Eng manager retrospective. Per-person breakdowns. Shipping streaks. Session detection from timestamps. Hotspot analysis. Global cross-project mode.

### Safety Skills

**`/careful`** — PreToolUse hook on Bash for destructive patterns. Returns `permissionDecision: "ask"`.
**`/freeze`** — PreToolUse hooks on Edit/Write. File path boundary check. Returns `permissionDecision: "deny"`.
**`/guard`** — Combines careful + freeze.
**`/investigate`** — Systematic debugger. Auto-freeze on affected module. 3-strike rule. Regression test required.

### Meta Skills

**`/learn`** — Manages `learnings.jsonl` per project. Show, search, prune, export.
**`/browse`**, **`/connect-chrome`**, **`/setup-browser-cookies`** — Browser control.

## Design Philosophy (ETHOS.md)

### Three Principles

1. **Boil the Lake** — AI makes marginal cost of completeness near-zero. Always do the complete thing. "Lake" (boilable: 100% coverage) vs "ocean" (not boilable: full rewrite). Approach A (full, ~150 LOC) > Approach B (90%, ~80 LOC).

2. **Search Before Building** — Three layers: Layer 1 (tried and true), Layer 2 (new and popular, scrutinize), Layer 3 (first principles, prize above all). "EUREKA moment" = first-principles reasoning reveals conventional wisdom is wrong.

3. **User Sovereignty** — AI recommends, users decide. Cross-model agreement is signal, not mandate. Generation-verification loop: AI generates, user verifies.

## Key Prompt Engineering Patterns

### 1. Preamble System
Every skill starts with `{{PREAMBLE}}`: update check, session tracking (3+ sessions = ELI16 re-grounding), contributor mode, proactive toggle, telemetry opt-in, completeness principle.

### 2. Voice Rules
"Direct, concrete, sharp, never corporate, never academic." No em dashes. No AI vocabulary (delve, crucial, robust, comprehensive). Short paragraphs. End with what to do.

### 3. Completion Status Protocol
Every skill reports: DONE, DONE_WITH_CONCERNS, BLOCKED, or NEEDS_CONTEXT.

### 4. Dual Voices / Cross-Model Review
Multiple skills spawn independent Codex + Claude subagent reviews, produce consensus tables. Filesystem boundary prevents Codex from reading skill files.

### 5. Hook-Based Safety
SKILL.md YAML `hooks` for PreToolUse enforcement. Shell scripts return permission decisions.

### 6. Benefits-From System
`benefits-from: [office-hours]` in frontmatter. Resolver generates offer to run prerequisites if artifacts missing.

### 7. Learnings System
Skills log + search per-project `learnings.jsonl`. Cross-session institutional memory.

### 8. Cognitive Pattern Libraries
CEO (18 patterns), Eng Manager (15), Designer (12) — embedded as permanent context in respective review skills.

### 9. Decision Classification
Mechanical (auto-decide silently), Taste (surface at gate), User Challenge (never auto-decided).

### 10. AI Slop Detection
Explicit anti-patterns: purple gradients, 3-column feature grids, stock photo aesthetics. Font blacklist + overused font list.
