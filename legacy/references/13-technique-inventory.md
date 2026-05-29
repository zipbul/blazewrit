# Technique Inventory — Full Source Extraction

Compiled: 2026-03-30. Source: direct file-by-file reading of all 638 files across 3 repos.

## Extraction Summary

| Source | Files Read | Techniques Extracted |
|--------|-----------|---------------------|
| GSD agents (16 files) | 18 agent .md files | 141 unique techniques |
| GSD commands (44+ files) | 57 command .md files | 201 unique techniques |
| GSD workflows/hooks/SDK | 50+ files (hooks, SDK src, workflows, templates, scripts, docs) | 200+ techniques |
| gstack skills | 34 files (17 SKILL.md + 17 SKILL.md.tmpl) | 153 unique techniques |
| gstack core/scripts | 40+ files (CLAUDE.md, ETHOS.md, resolvers, bin/, hooks) | 150+ techniques |
| spec-kit | 50+ files (commands, templates, scripts, extensions, presets, docs) | 585 indexed items |

Total raw extraction: ~1400+ technique items across all sources (with significant overlap between repos).

## A. Prompt Structure Techniques

### XML Tag Patterns (GSD)
- Top-level sections: `<role>`, `<execution_flow>`, `<step>`, `<deviation_rules>`, `<constraints>`, `<success_criteria>`, `<structured_returns>`, `<anti_patterns>`
- Plan structure: `<objective>`, `<context>` with @-references, `<tasks>` with `<action>`, `<verify>`, `<done>` blocks
- Context injection: `<files_to_read>` block with mandatory "MUST read before any action"
- Output wrapping: `<analysis>` tags for reliable JSON extraction (user-profiler)
- Interfaces block: `<interfaces>` for executor context about key types/exports

### Frontmatter Fields (gstack)
- `preamble-tier` (1-4): controls boilerplate depth (T1=minimal, T4=full)
- `benefits-from`: prerequisite skill dependency declaration
- `sensitive: true`: prevents auto-invocation, context leaking
- `hooks`: scoped PreToolUse hook definitions in YAML
- `allowed-tools`: tool whitelist per skill

### Template Resolution (gstack + spec-kit)
- `{{PLACEHOLDER}}` tags resolved by TypeScript resolvers (gstack: 37 resolvers)
- 4-level resolution stack: project-local > presets > extensions > core (spec-kit)
- Multi-host generation: `--host claude/codex/factory/all` (gstack)
- Marker-based preservation: `<!-- blazewrit:start/end -->` for user additions (spec-kit)
- `.tmpl` = source of truth, `.md` = generated output, never hand-edit (gstack)

### Dynamic Context Injection
- `` !`<command>` `` shell execution before prompt delivery (Claude Code skills)
- `$ARGUMENTS`, `$N`, `${CLAUDE_SESSION_ID}`, `${CLAUDE_SKILL_DIR}` substitutions
- `@file:` prefix protocol for large JSON IPC (GSD SDK)

## B. Behavioral Control Techniques

### Anti-Sycophancy (gstack)
- Banned phrases: "That's an interesting approach", "There are many ways...", "You might want to consider..."
- Enforced behaviors: take a position, state what evidence would change it, challenge strongest version
- Pushback patterns with concrete good/bad examples (office-hours)

### Anti-Hallucination (GSD + gstack)
- Zero tool calls = rejected as hallucinated (GSD-2 auto engine)
- Mandatory initial read before any action (all GSD agents)
- Orient step read-only via `allowed-tools` excluding Edit/Write (spec-kit /analyze)
- "Training data = hypothesis — 6-18 months stale" (GSD project-researcher)
- Confidence levels: HIGH (official docs), MEDIUM (verified), LOW (unverified) — never present LOW as authoritative

### Anti-Over-Engineering (spec-kit + gstack)
- Constitutional gates: Simplicity Gate, Anti-Abstraction Gate, Integration-First Gate (spec-kit)
- Complexity Tracking table for justified violations (spec-kit)
- Step 0 Scope Challenge with 6 checks including complexity smell >8 files (gstack eng-review)
- "Explicit over clever — 10-line obvious fix > 200-line abstraction" (gstack autoplan)

### Scope Control (GSD + spec-kit + gstack)
- Only auto-fix issues DIRECTLY caused by current task; pre-existing → deferred-items.md (GSD executor)
- Scope creep → deferred ideas, do not implement (GSD planner, spec-kit)
- Four scope modes: expand/selective/hold/reduce (gstack CEO review)
- Max 3 `[NEEDS CLARIFICATION]` markers — make informed guesses for rest (spec-kit specify)
- Phase boundary FIXED — discussion clarifies HOW, never WHETHER to add (GSD discuss)

### Analysis Paralysis Guards (GSD)
- 5+ consecutive Read/Grep/Glob without Edit/Write/Bash = stuck (GSD executor)
- Fix attempt limit: 3 per task, then document and move on (GSD executor)
- Max 3 self-validation iterations (spec-kit specify)
- Max 50 findings cap (spec-kit analyze)
- Max 3 debug iterations per failing test (GSD nyquist-auditor)

### Specificity Enforcement (GSD)
- "TOO VAGUE vs JUST RIGHT" comparison tables (GSD planner)
- Explicit "DON'T" sections with bad examples (GSD multiple agents)
- Ambiguity detection: flag "fast", "scalable", "robust" without numbers (spec-kit analyze)
- Specificity test: "Could a different Claude instance execute without asking clarifying questions?" (GSD planner)

### Voice Rules (gstack)
- "Direct, concrete, sharp, never corporate, never academic"
- No em dashes (use commas, periods, "...")
- 20+ banned AI vocabulary words: delve, crucial, robust, comprehensive, nuanced, leverage, utilize...
- Banned phrases: "here's the kicker", "let me break this down"...
- Short paragraphs, end with what to do
- Context-adaptive: YC partner for strategy, senior eng for code, best blog post for debugging

## C. Output Format Techniques

### Completion Status Protocol (gstack)
- DONE / DONE_WITH_CONCERNS / BLOCKED / NEEDS_CONTEXT — every skill reports one
- Evidence required for each claim
- Escalation format: STATUS, REASON, ATTEMPTED, RECOMMENDATION
- "Bad work is worse than no work. You will not be penalized for escalating."

### Structured Returns (GSD)
- Every agent has defined return format: PLANNING COMPLETE, RESEARCH COMPLETE, ROOT CAUSE FOUND, etc.
- Artifact chain: PROJECT.md → REQUIREMENTS.md → ROADMAP.md → CONTEXT.md → RESEARCH.md → PLAN.md → SUMMARY.md → VERIFICATION.md
- Return state routing: COMPLETE / CHECKPOINT REACHED / INCONCLUSIVE — orchestrator handles each differently

### Report Templates
- Two-pass review: Pass 1 CRITICAL, Pass 2 INFORMATIONAL (gstack review)
- Severity classification: CRITICAL > HIGH > MEDIUM > LOW (spec-kit analyze)
- Issue YAML: plan, dimension, severity, description, task, fix_hint (GSD plan-checker)
- Three-level verdicts: PASS/FLAG/BLOCK per dimension (gstack ui-checker)
- Comparison tables: 5 columns — Option, Pros, Cons, Complexity, Recommendation (GSD advisor-researcher)

### Checklist Patterns
- "Unit tests for English" — validate REQUIREMENTS quality, not implementation (spec-kit checklist)
- Tasks marked `[X]` as completed during implementation (spec-kit implement)
- Checklist status check before step — if incomplete, ask whether to proceed (spec-kit implement)
- Copy-and-check-off pattern in skill body (gstack pyreez skill)

## D. Verification Techniques

### Goal-Backward Verification (GSD)
- "What must be TRUE" not "what was done"
- Derive Observable Truths (user perspective) → Required Artifacts → Required Wiring → Key Links
- Must-haves YAML: truths, artifacts (path/provides/min_lines/exports/contains), key_links (from/to/via/pattern)
- Task completion ≠ Goal achievement (GSD plan-checker, verifier)

### Multi-Level Artifact Check (GSD verifier)
- Level 1: Exists
- Level 2: Substantive (not stub — detect TODO, FIXME, placeholder, empty returns, hardcoded empty data)
- Level 3: Wired (imported AND used, not just imported)
- Level 4: Data-Flowing (trace upstream to verify real data flows)
- Statuses: VERIFIED, HOLLOW, ORPHANED, STUB, MISSING

### Stub Detection (GSD verifier + executor)
- React stubs: `return <div>Component</div>`, `return null`, empty handlers
- API stubs: returning static "Not implemented" or empty arrays without DB query
- Wiring red flags: fetch without await/assignment, query result not returned, handler only prevents default
- Nuance: grep match is STUB only when value flows to rendering AND no other code path populates it

### Self-Validation Loops (spec-kit)
- Write → check against quality criteria → iterate (max 3 rounds)
- Executor self-check: verify created files exist and commits exist before proceeding (GSD)
- Re-verification mode: focus on failed items, quick regression on passed (GSD verifier)

### Plan Quality Verification (GSD plan-checker — 10 dimensions)
1. Requirement Coverage (every requirement has tasks)
2. Task Completeness (Files + Action + Verify + Done per task)
3. Dependency Correctness (valid, acyclic graph)
4. Key Links Planned (artifacts wired together)
5. Scope Sanity (2-3 tasks/plan target)
6. Verification Derivation (must-haves trace to goal)
7. Context Compliance (locked decisions have tasks)
8. Nyquist Compliance (automated verify presence)
9. Cross-Plan Data Contracts (shared data compatible)
10. CLAUDE.md Compliance (project conventions respected)

### Cross-Artifact Consistency (spec-kit analyze — 6 passes)
A. Duplication Detection
B. Ambiguity Detection (vague adjectives without metrics)
C. Underspecification
D. Constitution Alignment
E. Coverage Gaps (requirements with zero tasks)
F. Inconsistency (terminology drift, entity mismatches)

## E. Interaction Techniques

### Question-Asking (spec-kit + gstack)
- Impact × Uncertainty heuristic for prioritization (spec-kit clarify)
- ONE question at a time, progressive disclosure (spec-kit clarify)
- Recommendation-first: "Recommended: X. Accept? [yes/no]" (spec-kit clarify)
- AskUserQuestion format: re-ground (project/branch/task) → simplify (16-year-old) → recommend → lettered options (gstack)
- One issue = one AskUserQuestion, never batch (gstack eng-review)
- Completeness score per option: 10 = all edge cases, 7 = happy path, 3 = shortcut (gstack)
- Effort dual-scale: human time AND CC time per option (gstack)

### Decision Classification (gstack autoplan)
- Mechanical: one clearly right answer, auto-decide silently
- Taste: reasonable people disagree, surface at gate
- User Challenge: both models disagree with user, NEVER auto-decided
- Context-dependent tiebreakers: CEO phase (completeness dominates), Eng (explicit dominates), Design (explicit+completeness)
- Decision audit trail: append row per decision with classification, principle, rationale

### Escalation Patterns (GSD + gstack)
- 3 failures with same approach → STOP, escalate (GSD deviation rule 4, gstack)
- Architectural changes → STOP, ask user (GSD executor rule 4)
- Security uncertainty → STOP (gstack)
- Scope exceeds verifiable range → STOP (gstack)
- Auth gates as normal flow, not failures (GSD executor)

### Handoff Chain (spec-kit)
- Explicit next-step offers: specify → plan/clarify, plan → tasks/checklist, tasks → analyze/implement
- Each answer in /clarify immediately integrated into spec (atomic overwrite)
- Checkpoint return format with completed tasks table for continuation (GSD executor)

## F. Context Management Techniques

### Mandatory Initial Read (GSD)
- `<files_to_read>` block in agent prompts listing exact file paths
- First instruction: "MUST use the Read tool to load every file listed before any action"

### Context Budget (GSD)
- Plans target ~50% context usage (0-30% PEAK, 30-50% GOOD, 50-70% DEGRADING, 70%+ POOR)
- 2-3 tasks max per plan
- TDD plans target ~40% (lower budget)
- Context monitor hook: PostToolUse reads bridge file, warns at 35% remaining (WARNING), 25% (CRITICAL)

### Phase-Aware Context Loading (GSD context-engine)
- Execute: STATE.md + config only (minimal)
- Plan: STATE.md + ROADMAP.md + CONTEXT.md + RESEARCH.md + REQUIREMENTS.md
- Verify: STATE.md + ROADMAP.md + PLAN.md + SUMMARY.md
- Discuss: STATE.md + ROADMAP.md + CONTEXT.md

### Fresh Context Spawning (GSD)
- Every Task() call = clean context window
- Thin orchestrators: load context, spawn agents, collect results — never do heavy lifting themselves
- Orchestrator ~15% budget, subagent gets 100% fresh

### History Digest Protocol (GSD planner)
- Two-step: generate digest index → select 2-4 most relevant for full reads
- Anti-pattern: reflexive chaining (02 refs 01, 03 refs 02...) unless genuinely needed

### Discovery Levels (GSD planner)
- Level 0: Skip (pure internal work)
- Level 1: Quick (single library, Context7 only)
- Level 2: Standard (choosing between options)
- Level 3: Deep Dive (architectural decisions, novel problems)

### Debug File as Persistent Brain (GSD debugger)
- Sections: Current Focus (OVERWRITE), Symptoms (IMMUTABLE), Eliminated (APPEND), Evidence (APPEND), Resolution (OVERWRITE)
- Update file BEFORE taking action — survives context resets
- Status transitions: gathering → investigating → fixing → verifying → resolved

## G. Quality Gate Techniques

### Deviation Rules (GSD executor)
- Rule 1: Auto-fix bugs (no permission)
- Rule 2: Auto-add critical missing functionality (no permission)
- Rule 3: Auto-fix blocking issues (no permission)
- Rule 4: Architectural changes → STOP, user decision required
- Priority: Rule 4 first (stop), then 1-3 (fix), unsure → Rule 4
- Scope boundary: only fix issues DIRECTLY caused by current task
- Fix attempt limit: 3 per task, then document and move on

### Fix-First Review (gstack)
- Classify: AUTO-FIX (mechanical) or ASK (judgment)
- Auto-fix all AUTO-FIX items silently, batch-ask about ASK items
- Self-regulation: risk heuristic + 30-fix hard cap (gstack QA)
- Risk calculation: 0% base, +15% per revert, +5% per JSX change, +20% unrelated files → STOP at 20%

### Cognitive Bias Guards (GSD debugger)
- Confirmation bias: actively seek disconfirming evidence
- Anchoring: generate 3+ hypotheses before investigating any
- Availability bias: treat each bug as novel
- Sunk cost: every 30 min reassess if current path is right

### Confidence Calibration (gstack)
- 9-10: Verified by reading code. Show normally.
- 7-8: High confidence pattern match. Show normally.
- 5-6: Moderate, possible FP. Show with caveat.
- 3-4: Low. Suppress from main report. Appendix only.
- 1-2: Speculation. Only if severity = P0.
- Learning: if confidence < 7 and user confirms real → log corrected pattern

### Completeness Principle (gstack ETHOS)
- "Boil the Lake" — AI makes marginal cost of completeness near-zero
- Lake (boilable: 100% coverage) vs Ocean (not boilable: full rewrite)
- Approach A (full, ~150 LOC) > Approach B (90%, ~80 LOC) — always choose complete
- "Defer tests to follow-up" = anti-pattern (tests are cheapest lake)

## H. Script/Mechanical Techniques

### Prerequisite Checking (spec-kit)
- `check-prerequisites.sh` with modes: `--require-tasks`, `--include-tasks`, `--paths-only`
- Feature directory validation, plan.md existence, tasks.md existence
- JSON output for reliable parsing

### Agent Context Update (spec-kit — 838 lines)
- Parse plan.md for language/framework/database/project type
- Update 27+ agent config files
- Preserve manual additions between markers
- Dedup for agents sharing same file

### Hook Implementations
- PreToolUse Bash guard: pattern match destructive commands, safe exceptions list (gstack careful)
- PreToolUse Edit/Write guard: directory boundary check with symlink resolution (gstack freeze)
- PostToolUse context monitor: bridge file pattern, debounce, severity escalation (GSD)
- Prompt injection guard: 12 regex patterns + invisible Unicode detection (GSD)
- Workflow guard: advisory warning for edits outside workflow context (GSD)

### Security Patterns
- Path traversal prevention: resolve symlinks, null byte rejection, containment check (GSD security.cjs)
- Prompt injection detection: 15+ patterns covering override, role manipulation, extraction (GSD)
- Sanitize for prompt: strip zero-width chars, neutralize system/assistant/human tags (GSD)
- Forbidden files: never read .env, credentials, keys — note existence only (GSD codebase-mapper)
- Git staging: NEVER `git add .` or `git add -A` — stage individually (GSD executor, gstack)
- Registry safety vetting: inspect third-party component source, scan for suspicious patterns (gstack ui-researcher)

## I. Orchestration Techniques

### Benefits-From (gstack)
- Frontmatter: `benefits-from: [office-hours]`
- Resolver generates offer to run prerequisite if artifacts missing
- AskUserQuestion: run prerequisite now vs skip

### Wave-Based Execution (GSD)
- Plans grouped by wave via dependency analysis
- Wave 1 = independent roots (parallel), Wave N = max(deps) + 1
- File ownership declared to prevent overlap in parallel execution
- `Promise.allSettled()` within wave, sequential between waves

### Continuation Agents (GSD)
- Checkpoint → spawn fresh agent with state via `<files_to_read>`
- Continuation inherits completed tasks, starts from resume point
- Three checkpoint types: human-verify (auto-approve), decision (auto-select first), human-action (STOP)

### Plans Are Prompts (GSD)
- PLAN.md IS the execution prompt — no transformation needed
- Dialogue output directly consumable as Implement input
- Frontmatter contains: phase, plan, wave, depends_on, files_modified, requirements, must_haves

### Auto-Loop State Machine (GSD-2)
- Read state → determine next unit → classify complexity → select model → build prompt → fresh session → execute → verify → persist → loop
- Stuck detection, timeout recovery, hallucination guards, budget pressure

## J. Cross-Cutting Patterns

### Search Before Building (gstack ETHOS)
- Layer 1: Tried and true (standard patterns)
- Layer 2: New and popular (scrutinize — humans subject to mania)
- Layer 3: First principles (most valuable — prize above all)
- EUREKA moment: first-principles reasoning reveals conventional wisdom wrong

### User Sovereignty (gstack ETHOS)
- AI recommends, users decide — overrides all other rules
- Cross-model agreement = strong signal, not mandate
- Generation-verification loop: AI generates, user verifies, AI never skips verification

### Downstream Consumer Awareness (GSD all agents)
- Every agent specifies how its output is consumed by next agent
- Interface context embedded in `<interfaces>` block for executors
- Wave 0 skeleton step for contracts consumed by later plans
- ROADMAP.md headers parsed by downstream tools — format matters

### Prescriptive Not Descriptive (GSD + gstack)
- "Use X because Y" not "Options are X, Y, Z"
- "Use 16px body at 1.5 line-height" not "Consider 14-16px"
- Synthesized, not concatenated (GSD research-synthesizer)
- Surgeon, not architect in revision mode — minimal targeted changes (GSD planner)
