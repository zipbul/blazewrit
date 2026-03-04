# Structural Gaps — Deep Research

Research on identified structural gaps in the playbook. Last updated: 2026-03-04.

## A. Cyclical Loop Design

### Reflexion Structure (Shinn et al., NeurIPS 2023)

Three components: Actor (generates code) → Evaluator (runs tests) → Self-Reflection (verbal critique stored in episodic memory) → Actor retries with memory.

Result: 91% pass@1 on HumanEval vs 80% GPT-4 zero-shot.

Memory: Two-tier — short-term (current trajectory) + long-term (accumulated reflections, bounded to 1-3 experiences).

**Sources:** https://arxiv.org/abs/2303.11366, https://blog.langchain.com/reflection-agents/

### Retry Limits Across Systems

| System | Limit | Context |
|---|---|---|
| Reflexion (LangChain) | 5 trials | Coding with test feedback |
| Oh My OpenCode Boulder | 5 consecutive failures + 5-min pause | Exponential backoff |
| Oh My OpenCode Ralph Loop | 100 max (configurable 1-1000) | Autonomous completion detection |
| Devin | ~10 ACUs before degradation | Session-level budget |
| Playbook (current) | 3 | Arbitrary |

Key insight: Devin — "Starting over is the right answer a lot more often with agents than with humans."

### Backward Transitions

| From | To | Trigger |
|---|---|---|
| Implement | Test | Tests fail, implementation issue |
| Implement | Dialogue | Plan was wrong/incomplete |
| Implement | Orient | Discovered unexpected codebase state |
| Test | Dialogue | Test design reveals ambiguity |

Playbook already has implicit transitions in step rules. Need to make explicit in workflow.md.

## B. Context Management

### Anthropic — Three Core Strategies
1. **Compaction** — Summarize at 75% capacity. Preserve decisions, bugs, implementation details. Discard redundant tool outputs.
2. **Structured notes** — Write progress/notes to files outside context. Pull back when relevant.
3. **Sub-agent isolation** — Clean context windows, return condensed summaries (1-2K tokens from 10K+ exploration).

### Claude Code Specifics
- Subagents: Explore (Haiku, read-only), Plan (read-only), Task (full)
- Each runs in isolated context. Only result flows back to main agent.
- Auto-compact at 75% capacity (tightened from 95%)

### Oh My OpenCode Specifics
- Context Window Monitor hook at 70%: reminds agents there is still headroom (prevents "Context Window Anxiety")
- State persistence: `.sisyphus/boulder.json`, `.sisyphus/notepads/`, `.sisyphus/drafts/`
- Session recovery: `/start-work` always resumes from boulder state

### Long-Running State Persistence (Industry Convergence)
- Progress files (progress.md, NOTES.md) — structured state outside context
- Plan files with checkbox tracking
- Git commits as checkpoints with descriptive messages
- Session start reads: progress file + plan files + git log

**Sources:** https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents, https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents

## C. Cycle Scope Bounding

### Definitions of "One Bounded Unit"

| Source | Definition | Metric |
|---|---|---|
| Anthropic Harness | One complete feature (end-to-end) | Feature-level |
| Playbook (current) | 1 module/concern = 1-3 files | File count |
| SmartBear/Cisco | 200-400 LOC, 60-90 min review | LOC + time |
| Anthropic 2026 | ~20 autonomous actions before human input | Action count |

### Scope Constraints (All Must Apply)
1. **Testable** — Has clear pass/fail criteria
2. **Completable** — Can be finished in one session/cycle
3. **Reviewable** — Small enough to understand the diff
4. **Atomic** — Can be committed/reverted as a unit

### Chunking Large Features
- Osmani: Design doc → well-defined tasks → tight iteration loops
- JetBrains: Requirements → Plan → Task list → Execute in phases, review between phases
- Devin: Plan → Implement → Test → Fix → Checkpoint review → Next segment

**Sources:** https://addyosmani.com/blog/agentic-engineering/, https://blog.jetbrains.com/junie/2025/10/how-to-use-a-spec-driven-approach-for-coding-with-ai/

## D. Rule Rationale for Arbitrary Numbers

### Evidence Summary

| Rule | Current | Industry | Evidence | Verdict |
|---|---|---|---|---|
| Retry limit | 3 | 5 (Reflexion, OMOC) | No empirical study validates any specific number | 3 is conservative. 5 has more precedent. Key: distinguish same-approach vs different-approach failure. |
| Questions/turn | 1-2 | Not commonly prescribed | Cowan (2001): ~4 chunks, possibly ~2 | Defensible from cognitive load theory. |
| P3 cap/round | 3 | 2-5 major issues (SmartBear) | Review fatigue at 20-50 total notes | Spirit supported. Number is reasonable default. |
| Review rounds | 3 | Not commonly prescribed | No evidence | Reasonable heuristic. 3-5 range. |
| Extra suggestions | 2 | Not commonly prescribed | Scope creep is well-documented | Number arbitrary but sufficiently small as friction. |

### Recommendation
- Present numbers as **defaults** with rationale
- Distinguish **safety ceilings** (prevent catastrophe) from **quality heuristics** (optimize outcomes)
- Allow per-project adjustment

**Sources:** https://static0.smartbear.co/support/media/resources/cc/book/code-review-cisco-case-study.pdf, https://en.wikipedia.org/wiki/The_Magical_Number_Seven,_Plus_or_Minus_Two

## E. playbook-init.md vs playbook.md

### Both Should Be Kept — Different Purposes

| Dimension | playbook-init.md | playbook.md |
|---|---|---|
| Target | Claude Code only | Multi-tool (10+) |
| Dependencies | None (self-contained) | Requires npm package assets |
| Harness detection | None | Full (3 levels) |
| Use case | Quick start, small projects | Full deployment, production |
| Output | CLAUDE.md + agents + skills | Tool-appropriate files |

### Recommendation
1. Make the relationship explicit: init = zero-dependency quick start, playbook = full deployment
2. Keep both synchronized with core workflow definition
3. Consider progressive enhancement: init detects npm package → delegates to playbook
