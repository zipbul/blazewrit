# Coding Agent Rules

Research on rules and instructions across major AI coding tools. Last updated: 2026-03-03.

## 1. Claude Code

**Source:** https://github.com/Piebald-AI/claude-code-system-prompts (v2.1.63, Feb 2026)
**Source:** https://rastrigin.systems/blog/claude-code-part-2-system-prompt/
**Source:** https://arize.com/blog/claude-md-best-practices-learned-from-optimizing-claude-code-with-prompt-learning/

### Architecture
- Two-block system: 12-word identity + 15k+ token instruction manual
- Dynamic context injection (git status, OS, branch, date) at conversation start
- Subagent system: Explore (Haiku, read-only), Task (general-purpose), Plan (read-only)

### Key Rules
- **Read-only reconnaissance**: Plan mode — "You MUST NOT make any edits. This supercedes any other instructions."
- **Anti-over-engineering**: "Three similar lines of code is better than a premature abstraction."
- **Tool hierarchy**: Read > cat, Edit > sed, Write > echo. Parallel for independent, sequential for dependent.
- **Professional objectivity**: No excessive validation ("You're absolutely right!"), terse CLI-optimized responses
- **Security review**: CRITICAL / HIGH / MEDIUM / LOW severity classification

### CLAUDE.md Best Practices
- Under 150 lines
- Only include rules where removing them would cause mistakes
- Treat like code — prune regularly
- 6% SWE-bench accuracy boost from optimized rules (Arize AI research)

## 2. Cursor Rules

**Source:** https://cursor.com/docs/context/rules
**Source:** https://github.com/PatrickJS/awesome-cursorrules
**Source:** https://www.prompthub.us/blog/top-cursor-rules-for-coding-agents

### Structure
- `.cursorrules` deprecated → `.mdc` files in `.cursor/rules/`
- One concern per file with explicit globs for file matching

### Common Categories (from 130+ rules analysis)
1. Functional programming & modularity
2. Consistent naming (lowercase-dashes for directories)
3. Type safety (interfaces > types, const objects > enums)
4. Error handling & early returns (guard clauses first)
5. Testing as mandatory
6. Performance & security (Core Web Vitals, input validation)
7. Git conventions (Conventional Commits)

### What Works
- One concern per rule, small and actionable
- Anchor with concrete code samples and explicit globs
- Write like internal docs with clear do/don't directives

## 3. OpenAI Codex CLI (AGENTS.md)

**Source:** https://developers.openai.com/codex/guides/agents-md/
**Source:** https://developers.openai.com/codex/rules/

### AGENTS.md Convention
"A README for the agent." Read before any work begins.

Cascading discovery: Global → Project root → Subdirectory → Merge (closer overrides earlier). Size limit: 32 KiB.

What to include: Working agreements, repo expectations, service-specific rules, behavioral guardrails, test commands, lint rules, security protocols.

Rules system: Starlark with `prefix_rule()`. Decisions: allow / prompt / forbidden. Most restrictive match wins.

## 4. GitHub Copilot Agent Mode

**Source:** https://github.blog/ai-and-ml/github-copilot/agent-mode-101-all-about-github-copilots-powerful-mode/
**Source:** https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent

- `.github/copilot-instructions.md` + `.github/instructions/**/*.instructions.md` with `applyTo` frontmatter
- "Short, self-contained statements" since sent with every message
- Deterministic enforcement via hooks — zero chance the model ignores policy

## 5. Amp (Sourcegraph)

**Source:** https://ampcode.com/manual

- AGENTS.md as primary convention
- Sub-agents handle specialized tasks, report back
- Persistent memory tracks conventions, library usage, architecture decisions
- Auto-allowed: common dev commands. Requires confirmation: destructive commands

## 6. Cline

**Source:** https://cline.bot/blog/cline-rules
**Source:** https://docs.cline.bot/features/cline-rules

- `.clinerules/` directory
- Three prompt sections: Tools, System Information, User Preferences
- Rules should contain what you'd tell a new developer in their first week
- Rules must evolve with the project

## 7. Windsurf

**Source:** https://docs.windsurf.com/windsurf/cascade/cascade

- `.windsurfrules` file in project root + global rules in user settings
- Cascade: Planning → Execution → Validation phases
- Rules as "constitutional framework" preventing "AI drift"

## 8. Roo Code

**Source:** https://docs.roocode.com/advanced-usage/prompt-structure
**Source:** https://docs.roocode.com/features/custom-instructions

- Role definitions per mode (Code, Ask, Debug)
- AGENTS.md support (with AGENT.md fallback)
- Rules loading: mode-specific > .rooignore > AGENTS.md > global > workspace
- Custom modes with mode-specific system prompts (identity switching per step)

## 9. Oh My OpenCode

**Source:** https://github.com/code-yeongyu/oh-my-opencode
**Source:** https://deepwiki.com/code-yeongyu/oh-my-opencode/4.6.3-agent-prompts-and-system-directives

### What It Is
Batteries-included OpenCode plugin. Wraps official OpenCode runtime with opinionated agents, hooks, MCPs, and configuration. Turns single agent into coordinated team.

### Multi-Agent Architecture (Three Tiers)

**Primary:** Sisyphus (orchestrator, Opus/Kimi), Hephaestus (autonomous deep worker, GPT-5.3-codex, "Do NOT Ask"), Prometheus (strategic planner, interview-mode), Atlas (plan reader, multi-agent execution)

**Execution:** Sisyphus-Junior (delegation), 8 category-based workers

**Specialist:** Oracle (architecture), Librarian (docs), Explore (search), Multimodal-looker (vision)

### Critical Innovation: Hashline
Every line tagged with content hash. If file changed since last read, edit rejected before corruption. Improved success rate: **6.7% → 68.3%** on code modification tasks.

### Model-Family-Specific Prompts
- Claude-optimized (Mechanics-Driven): ~1,100 lines, detailed checklists
- GPT-optimized (Principle-Driven): ~300 lines, XML structure, equivalent results

### Hard Behavioral Blocks
- Never suppress type errors with `@ts-ignore`
- Never delete/modify tests to pass them
- Never fabricate file paths or signatures
- Never commit without explicit user request

### Anti-Patterns
- Shotgun debugging, premature stopping, scope creep, AI slop, context-free edits

### Hook Tiers
Session (23) > Tool-Guard (10) > Transform (4) > Continuation (7) > Skill (2)

## Industry Convergence Patterns

**Source:** https://gist.github.com/0xdevalias/f40bc5a6f84c4c5ad862e314894b2fa6

Seven convergence patterns:
1. **Hierarchical discovery**: Global > Project root > Subdirectory > File-level
2. **Markdown as universal format**: All tools use markdown
3. **AGENTS.md as emerging standard**: Codex, Amp, Roo Code, Oh My OpenCode
4. **Ignore-file standardization**: `.aiignore`, `.cursorignore` following `.gitignore` syntax
5. **MCP integration layer**: Consistent JSON for tool connections
6. **Scoped instructions**: Frontmatter-based, glob-based, or path-matching
7. **Dual-mode configuration**: Team-shared (checked-in) + personal (user-local)

## Cross-Tool Rule Comparison with Playbook Golden Rules

| Playbook Golden Rule | Claude Code | Cursor | Codex | Copilot | Oh My OpenCode |
|---|---|---|---|---|---|
| Read-only reconnaissance | Plan Mode (enforced) | N/A | N/A | N/A | Prometheus interview-mode |
| Intent classification | Dynamic context injection | N/A | AGENTS.md pre-read | Instructions pre-read | Prometheus planning |
| Test-first | Encouraged | Mandatory (rules) | Encouraged | N/A | Enforced (no test deletion) |
| Plan-before-implement | Plan Mode | N/A | AGENTS.md | Boundary setting | Prometheus → Atlas pipeline |
| Mechanical verification | Hooks + security review | N/A | Starlark rules | Hooks | Hashline + Hook tiers |
| Severity-classified review | CRITICAL/HIGH/MEDIUM/LOW | N/A | N/A | N/A | Hook priority ordering |
| Identity switching per step | Explore/Plan/Task subagents | N/A | N/A | N/A | Multi-tier agent personas |
| Failure escalation | TodoWrite + hooks | N/A | Forbidden rules | Hooks | Ralph Loop + hashline rejection |

## Thought Leadership

- **Simon Willison**: Red/Green TDD as core agentic pattern. Context engineering > prompt engineering. https://simonwillison.net/2026/Feb/23/agentic-engineering-patterns/
- **Addy Osmani**: "Testing is the single biggest differentiator." Plan before prompting. https://addyosmani.com/blog/agentic-engineering/
- **Devin AI**: Plan > Implement > Test > Review > Next. Cut losses early. https://devin.ai/agents101
- **CodeScene**: Pull Risk Forward. Coverage as Behavioral Guardrail. https://codescene.com/blog/agentic-ai-coding-best-practice-patterns-for-speed-with-quality
- **MIT Missing Semester**: Manager-intern model. Feedback loop architecture. https://missing.csail.mit.edu/2026/agentic-coding/
- **tedivm**: AGENTS.md should use "must" not "should". Agents lack cross-session learning. https://blog.tedivm.com/guides/2026/03/beyond-the-vibes-coding-assistants-and-agents/
