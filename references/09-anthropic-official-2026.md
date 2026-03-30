# Anthropic Official Sources — 2026 Research Notes

Compiled: 2026-03-30

## A. Claude Code Documentation

### A1. Hooks

URL: https://code.claude.com/docs/en/hooks

Event-driven lifecycle system. 20+ events, 4 hook types, regex matchers, exit-code-based control.

**Hook Types:**
1. `command` — Shell commands with event JSON on stdin
2. `http` — POST requests to URL
3. `prompt` — Single-turn Claude evaluation
4. `agent` — Subagent spawned to verify conditions

**Key Events:**

| Event | Can Block? | Use Case |
|-------|-----------|----------|
| `PreToolUse` | Yes (exit 2 or `permissionDecision: "deny"`) | Block destructive commands, validate inputs |
| `PostToolUse` | Yes (but tool already ran) | Inject context, trigger follow-up |
| `UserPromptSubmit` | Yes | Pre-process user input |
| `SessionStart` | No (context injection) | Set env vars, inject initial context |
| `Stop` | Yes (`decision: "block"` forces continuation) | Auto-continue loops |
| `PreCompact` / `PostCompact` | No | Context compaction hooks |
| `PermissionRequest` | Yes (auto-allow/deny) | Automate permission decisions |

**Matcher patterns:** Regex strings. `PreToolUse` matcher = tool name (e.g., `Bash`, `Edit`, `mcp__*`). Omit or `"*"` for all.

**Exit codes:** 0 = success (parse JSON stdout), 2 = block (stderr as feedback), other = non-blocking error.

**Configuration priority:** Managed > user `~/.claude/settings.json` > project `.claude/settings.json` > local `.claude/settings.local.json` > plugin hooks > skill/agent frontmatter.

**Novel:** Hooks in skill/agent YAML frontmatter scoped to lifecycle. HTTP hooks support `$VAR` interpolation. `async: true` for background. `once: true` (skills) for one-time.

### A2. Skills (Slash Commands)

URL: https://code.claude.com/docs/en/slash-commands

Skills = SKILL.md files. Follows Agent Skills open standard (agentskills.io). Custom commands merged into skills.

**Bundled Skills:**
- `/batch` — Parallel changes, 5-30 units, one agent per unit in worktrees, each opens PR
- `/simplify` — 3 parallel review agents for code quality
- `/loop` — Recurring prompt on interval
- `/claude-api` — Auto-triggers on Anthropic SDK imports
- `/debug` — Session debug log analysis

**YAML Frontmatter Fields:**
- `name`, `description` (max 250 chars, front-load key use case)
- `allowed-tools` — Permission-free tools when skill active
- `model`, `effort` — Override per skill
- `context: fork` + `agent: Explore` — Run in subagent context
- `hooks` — Scoped lifecycle hooks
- `paths` — Glob patterns for auto-activation
- `disable-model-invocation: true` — Manual only
- `user-invocable: false` — Background knowledge only

**String Substitutions:** `$ARGUMENTS`, `$N`, `${CLAUDE_SESSION_ID}`, `${CLAUDE_SKILL_DIR}`

**Dynamic Context:** `` !`<command>` `` runs shell commands before skill content sent to Claude.

**Context Budget:** 1% of context window for all skill descriptions. Override: `SLASH_COMMAND_TOOL_CHAR_BUDGET`.

**Storage Priority:** Enterprise > Personal (`~/.claude/skills/`) > Project (`.claude/skills/`) > Plugin.

### A3. Settings & Rules

URL: https://code.claude.com/docs/en/settings

**5-Tier Scope (highest to lowest):** Managed → CLI args → Local → Project → User.

**Permission Rule Syntax:** `Tool(specifier)`. Deny evaluated first, then ask, then allow.
- `Bash(npm run *)`, `Read(./.env)`, `WebFetch(domain:example.com)`, `Agent(Explore)`, `Skill(deploy *)`

**Key Settings:**
- `permissions.allow/ask/deny` — Tool permission rules
- `hooks` — Lifecycle hooks
- `env` — Session environment variables
- `model`, `effortLevel` — Model and effort
- `autoMode` — Auto mode classifier rules
- `agent` — Run as named subagent
- `sandbox.*` — Filesystem/network sandboxing
- `autoMemoryEnabled/autoMemoryDirectory` — Memory control
- `claudeMdExcludes` — Skip specific CLAUDE.md files
- `outputStyle` — Adjust output style
- `worktree.symlinkDirectories/sparsePaths` — Worktree optimization

**Sandbox:** `filesystem.allowWrite/denyWrite/denyRead/allowRead`, `network.allowedDomains`, `autoAllowBashIfSandboxed: true`.

### A4. Memory

URL: https://code.claude.com/docs/en/memory

**Dual System:**

| | CLAUDE.md | Auto Memory |
|---|-----------|-------------|
| Author | Human | Claude |
| Contains | Instructions, rules | Learnings, patterns |
| Scope | Project/user/org | Per working tree |
| Loaded | Every session (full) | First 200 lines / 25KB |

**CLAUDE.md Locations:** Managed policy (`/etc/claude-code/`) > Project (`./CLAUDE.md`) > User (`~/.claude/CLAUDE.md`). Walks up directory tree. Subdirectory files load on demand.

**Import Syntax:** `@path/to/file` in CLAUDE.md. Max 5 recursive hops. HTML comments stripped (save tokens).

**`.claude/rules/` Directory:** Modular instruction files. Path-specific rules via `paths` frontmatter load conditionally.

**Auto Memory:** Storage at `~/.claude/projects/<project>/memory/`. MEMORY.md + topic files. First 200 lines/25KB at session start. Toggle: `/memory` command.

**Best Practices:** Under 200 lines per CLAUDE.md. Use headers/bullets. Specific over vague. Remove conflicts periodically.

### A5. Sub-agents

URL: https://code.claude.com/docs/en/sub-agents

**Built-in Agents:**

| Agent | Model | Tools | Purpose |
|-------|-------|-------|---------|
| Explore | Haiku | Read-only | Codebase exploration (quick/medium/very thorough) |
| Plan | Inherits | Read-only | Research during plan mode |
| General-purpose | Inherits | All | Complex multi-step tasks |
| Bash | Inherits | Terminal | Commands in separate context |

**Custom Agent Frontmatter:**
- `name`, `description` (routing key)
- `tools` / `disallowedTools` — Tool allow/deny lists
- `model` — `sonnet`/`opus`/`haiku`/`inherit`/full ID
- `permissionMode` — `default`/`acceptEdits`/`dontAsk`/`bypassPermissions`/`plan`
- `maxTurns` — Turn limit
- `skills` — Preloaded skills
- `mcpServers` — Scoped MCP servers (connect on start, disconnect on finish)
- `hooks` — Scoped lifecycle hooks
- `memory` — `user`/`project`/`local` persistent memory
- `isolation: worktree` — Isolated git worktree
- `initialPrompt` — Auto-submitted first turn

**Scope Priority:** `--agents` CLI flag > `.claude/agents/` > `~/.claude/agents/` > Plugin.

**Tool Restriction:** `tools: Agent(worker, researcher)` — Only allows spawning specific subagents. Subagents cannot spawn other subagents.

**Invocation:** Natural language, `@"agent-name (agent)"`, `claude --agent name`, or `agent` in settings.

**Background Execution:** Pre-approves permissions upfront. Auto-denies unapproved. `Ctrl+B` to background running task.

**Novel:** Subagent transcripts persist independently, survive compaction. Auto-compaction at ~95%. Plugin subagents restricted (no hooks/mcpServers/permissionMode).

## B. Anthropic Engineering Blog (2026)

### B1. Context Engineering for AI Agents

URL: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents

**Core Definition:** Strategic curation of optimal token sets for LLM inference. Beyond prompt engineering — addresses what information should be available when.

**Fundamental Principle:** "Find the smallest set of high-signal tokens that maximize the likelihood of your desired outcome."

**Context Rot:** Quality degrades as context grows. n² pairwise attention. Less training data for long sequences.

**Four Components:**
1. **System Prompts** — Right altitude: specific enough to guide, flexible for heuristics. Avoid brittle if-else. Start minimal, add based on failure modes.
2. **Tools** — Self-contained, minimal overlap. Descriptive parameters. Token-efficient returns.
3. **Examples** — Diverse, canonical. "Pictures worth a thousand words."
4. **Message History** — Cyclically refine. Maintain only necessary working memory.

**Retrieval Strategies:**
- Just-in-time: Lightweight identifiers, dynamically load at runtime. Mirrors human cognition.
- Hybrid: Upfront retrieval for speed + autonomous exploration for discovery.

**Long-Horizon Techniques:**
1. **Compaction** — Summarize history, preserve decisions/details, discard redundant outputs. "Maximize recall first, iterate precision."
2. **Structured Note-Taking** — Agents write notes outside context window. Track progress across complex tasks.
3. **Sub-Agent Architectures** — Focused tasks, return condensed summaries (1-2K tokens).

**Key Insight:** "Smarter models require less prescriptive engineering."

### B2. Harness Design for Long-Running Applications

URL: https://www.anthropic.com/engineering/harness-design-long-running-apps (March 2026)

**Three-Agent Architecture:**
1. **Planner** — 1-4 sentence prompts → comprehensive specs. Ambitious scope, no granular details.
2. **Generator** — Incremental implementation via sprints. Self-evaluates. Git version control.
3. **Evaluator** — QA via Playwright MCP. Tests like a user. Assigns grades.

**Sprint Contracts:** Agreements between generator and evaluator defining completion criteria.

**Context Management Evolution:**
- Opus 4.5: "Context anxiety" — prematurely wrapping up. Context resets > compaction.
- Opus 4.6: Context anxiety eliminated. Continuous sessions with auto-compaction. Sprint construct removed entirely.

**Cost:** 6h $200 (Opus 4.5) → 3h50m $124.70 (Opus 4.6). 40% cost reduction.

**Evaluator Finding:** Initially **praised mediocre work confidently**. Required multiple tuning iterations vs human judgment.

**Key Insight:** "The space of interesting harness combinations doesn't shrink as models improve. Instead, it moves."

### B3. Building Effective Agents

URL: https://www.anthropic.com/research/building-effective-agents

**Five Workflow Patterns:**
1. **Prompt Chaining** — Sequential steps with programmatic gates
2. **Routing** — Classify → dispatch to specialists
3. **Parallelization** — Sectioning (independent) or Voting (diverse)
4. **Orchestrator-Workers** — Central LLM decomposes, delegates, synthesizes
5. **Evaluator-Optimizer** — Generate → evaluate → iterate

**Agents vs Workflows:** Workflows = predefined paths, predictable. Agents = dynamic self-direction, open-ended.

**Tool Design:** "Spent more time optimizing tools than the overall prompt." Use poka-yoke principles.

**Core Advice:** Start with API directly, not frameworks. Build simplest viable solution.

### B4. Claude 4.6 Best Practices

URL: https://platform.claude.com/docs/en/docs/build-with-claude/prompt-engineering/claude-4-best-practices

**System Prompt Sensitivity:** Opus 4.5/4.6 more responsive. Old aggressive prompts may overtrigger. Dial back: "Use this tool when..." not "CRITICAL: You MUST use..."

**Adaptive Thinking:** `thinking: {type: "adaptive"}` replaces `budget_tokens`. Effort parameter (`low`/`medium`/`high`/`max`) as primary control lever.

**Parallel Tool Calling:** Near-100% compliance with explicit instruction.

**Subagent Tendency:** Opus 4.6 overuses subagents. Add: "For simple tasks, work directly."

**Autonomy/Safety Balance:** "Consider reversibility and impact. Local reversible = freely. Hard-to-reverse = ask first."

**Overthinking Prevention:** Replace blanket defaults with targeted instructions. Remove over-prompting. Use lower effort.

**Long-Horizon:** Fresh context window > compaction. Models effective at discovering state from filesystem. Use git for state tracking.

**Prefilled Responses:** Deprecated starting 4.6.

## C. Anthropic Cookbook

URL: https://github.com/anthropics/anthropic-cookbook/tree/main/patterns/agents

Reference implementations for all five workflow patterns:
- `basic_workflows.ipynb` — Chaining, routing, parallelization
- `orchestrator_workers.ipynb` — Task delegation
- `evaluator_optimizer.ipynb` — Quality loops
- `prompts/research_lead_agent.md` — Planning agent for complex queries

## Cross-Cutting Themes

### 1. Model Improvement → Harness Simplification
Sprint decomposition removed. Context anxiety eliminated. Engineering challenge moves, doesn't shrink.

### 2. Context > Prompts
"What information should be available when" supersedes "what words to use." Just-in-time retrieval, compaction, note-taking, sub-agents = all context strategies.

### 3. Skills + Subagents = Composable Architecture
Skills with `context: fork` run in subagent contexts. Subagents with `skills` preload content. Both support scoped hooks.

### 4. Hooks = Full Event Bus
20+ events, 4 execution types, permission decisions, context injection, environment management.

### 5. Effort Parameter as Primary Lever
Replaces manual thinking budgets. `low`/`medium`/`high`/`max` balances quality, latency, cost.

### 6. Evaluation Remains Hard
AI self-evaluation starts confidently wrong. Multiple human-comparison iterations required.

### 7. Fresh Context > Compaction
Both harness design post and Claude 4.6 best practices recommend fresh context windows over compaction. Models discover state from filesystem effectively.
