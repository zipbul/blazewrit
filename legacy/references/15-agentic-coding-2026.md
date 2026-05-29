# Agentic Coding Patterns & Claude Code Features (2026)

Research date: 2026-04-01. Sources: Anthropic docs, HuggingFace trends report, MIT Missing Semester, builder.io, GitHub repos.

## Claude Code 2026 Features (New since late 2025)

### Agent Teams (v2.1.32+, Feb 2026, research preview)

Multiple Claude Code instances coordinating as a team with direct peer messaging.

- One session acts as **team lead** (orchestrator), assigns tasks, synthesizes results
- **Teammates** work independently, each in its own context window
- Teammates can message each other directly (unlike subagents which report only to parent)
- Shared task list with self-claiming capabilities
- Enable: `export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`

**Navigation**:
- `Shift+Down` -- cycle through teammates
- `Ctrl+T` -- toggle task list view
- `Enter` -- view teammate's session
- `Escape` -- interrupt teammate's turn
- `Shift+Tab` -- toggle delegate mode (lead only)

**Constraints**: No session resumption for teammates, one team per session, token costs scale linearly, split panes require tmux/iTerm2.

### /batch Command

Decomposes large changes into 5-30 independent units, one agent per unit in isolated worktrees.

**Three-phase flow**:
1. Research & plan (awaits user approval)
2. Parallel execution: implement -> simplify -> test -> commit -> PR (per unit)
3. Progress tracking

Requires git repo. Units must be independent. Specific prompts outperform vague ones.

### Git Worktrees (Built-in)

Each session/subagent gets isolated codebase copy via git worktree. Three integration levels:
- CLI sessions (`claude --worktree [name]`)
- Agent frontmatter (`isolation: "worktree"`)
- Automatic desktop app isolation

### Session Teleportation

Move sessions bidirectionally between local terminal and Anthropic cloud:
- Terminal -> Cloud: `claude --remote "task"`
- Cloud -> Terminal: `/teleport` or `claude --teleport [session-id]`
- Clean git state required, same repo checkout, branch must be pushed

### Remote Control

Continue sessions from phones/tablets via encrypted bridge. Code remains local; only chat messages flow through Anthropic relay.
- `/rc` command or `claude remote-control` CLI
- Max plan only (not API keys), ~10 minute network timeout

### Skills System

User-defined commands in `.claude/skills/*/SKILL.md` with frontmatter:
- `name`, `description`
- `disable-model-invocation` -- pure template execution
- `context` -- `fork` for isolated contexts (only summaries return to parent)
- `agent` -- delegate to specific agent file
- `allowed-tools` -- wildcard support (e.g., `Bash(gh *)`)

Dynamic context injection: `` `!`command`` `` syntax runs preprocessing shell commands before Claude sees the prompt.

### Custom Agents

Agent files in `.claude/agents/` with:
- Per-agent model selection
- Tool restrictions
- Hook definitions
- Can be delegated from skills via `agent:` frontmatter field

### Hook System (Comprehensive, 2026)

Event-driven handlers. Four handler types:
1. **Command hooks** (`type: "command"`) -- shell scripts receive JSON stdin, communicate via exit codes/stdout
2. **HTTP hooks** (`type: "http"`) -- POST event data to URL endpoint
3. **Prompt hooks** (`type: "prompt"`) -- single-turn LLM evaluation (Haiku by default, configurable model)
4. **Agent hooks** (`type: "agent"`) -- multi-turn verification with tool access, up to 50 tool-use turns

**All Hook Events (24 events)**:

| Event | When | Matcher |
|---|---|---|
| `SessionStart` | Session begins/resumes | startup, resume, clear, compact |
| `UserPromptSubmit` | Prompt submitted, before processing | none |
| `PreToolUse` | Before tool call, can block | tool name |
| `PermissionRequest` | Permission dialog appears | tool name |
| `PostToolUse` | After tool call succeeds | tool name |
| `PostToolUseFailure` | After tool call fails | tool name |
| `Notification` | Notification sent | permission_prompt, idle_prompt, auth_success, elicitation_dialog |
| `SubagentStart` | Subagent spawned | agent type (Bash, Explore, Plan, custom) |
| `SubagentStop` | Subagent finishes | agent type |
| `TaskCreated` | Task created via TaskCreate | none |
| `TaskCompleted` | Task marked completed | none |
| `Stop` | Claude finishes responding | none |
| `StopFailure` | Turn ends due to API error | rate_limit, authentication_failed, billing_error, etc. |
| `TeammateIdle` | Agent team teammate going idle | none |
| `InstructionsLoaded` | CLAUDE.md/.claude/rules loaded | session_start, nested_traversal, path_glob_match, include, compact |
| `ConfigChange` | Config file changes during session | user/project/local/policy_settings, skills |
| `CwdChanged` | Working directory changes | none |
| `FileChanged` | Watched file changes on disk | filename pattern |
| `WorktreeCreate` | Worktree being created | none |
| `WorktreeRemove` | Worktree being removed | none |
| `PreCompact` | Before context compaction | manual, auto |
| `PostCompact` | After compaction completes | manual, auto |
| `Elicitation` | MCP server requests user input | MCP server name |
| `ElicitationResult` | User responds to MCP elicitation | MCP server name |
| `SessionEnd` | Session terminates | clear, resume, logout, prompt_input_exit, etc. |

**Hook Input** (JSON on stdin):
```json
{
  "session_id": "abc123",
  "cwd": "/path/to/project",
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": { "command": "npm test" },
  "agent_id": "...",
  "agent_type": "..."
}
```

**Hook Output**:
- Exit 0: proceed. stdout text added to context (for SessionStart, UserPromptSubmit)
- Exit 2: block. stderr becomes Claude's feedback
- Other exit: proceed, stderr logged but not shown
- Structured JSON output for fine-grained control (allow/deny/ask decisions)

**Hook Scoping**:
| Location | Scope |
|---|---|
| `~/.claude/settings.json` | All projects (user-global) |
| `.claude/settings.json` | Single project (committable) |
| `.claude/settings.local.json` | Single project (gitignored) |
| Managed policy settings | Organization-wide |
| Plugin `hooks/hooks.json` | When plugin enabled |
| Skill/agent frontmatter | While skill/agent active |

**Advanced features**:
- `if` field (v2.1.85+): permission rule syntax filtering (`Bash(git *)`)
- `once: true`: fires exactly once then auto-removes
- `matcher`: regex pattern matching on tool/event-specific field
- `stop_hook_active` field prevents infinite Stop hook loops
- PreToolUse hooks fire before permission-mode checks (can enforce policy even in bypassPermissions mode)
- `updatedInput` for rewriting tool arguments (last hook wins, parallel = nondeterministic)
- `CLAUDE_ENV_FILE` for persisting environment variables
- `additionalContext` for injecting text into Claude's context from any hook

**Key Patterns**:
- Auto-format after edits (PostToolUse + Edit|Write matcher + prettier)
- Block protected files (PreToolUse + exit 2)
- Re-inject context after compaction (SessionStart + compact matcher)
- Desktop notifications (Notification event)
- Audit logging (ConfigChange)
- Environment reload on directory change (CwdChanged + direnv)
- Auto-approve specific permissions (PermissionRequest + JSON decision output)
- Test verification before stopping (Stop + agent hook)

### Other March 2026 Updates

- MCP elicitation support
- Transcript search
- Subprocess credential scrubbing
- Session display names
- Sparse worktree paths
- `agent_id` and `agent_type` fields in hook events (distinguish top-level from subagents)
- Computer use support
- Auto mode
- Significantly increased limits

### Built-in Variables & Commands

- `${CLAUDE_SESSION_ID}` -- current session ID
- `$ARGUMENTS` -- user input passed to skills
- `$CLAUDE_PROJECT_DIR` -- project root
- `/save-task-list` -- persist task lists across sessions
- `/triage` -- apply GitHub issue labels
- `/rulecheck` -- autonomous rule validation
- `/config` -- toggle settings
- `/rename` -- name sessions before teleporting
- `/tasks` -- view active background tasks
- `/simplify` -- reduce code complexity
- `/batch` -- parallel independent changes
- `/loop` -- recurring interval execution
- `/hooks` -- browse configured hooks (read-only)
- `claude --permission-mode plan` -- read-only planning mode

## 2026 Agentic Coding Trends (Industry-Wide)

### Trend 1: Agentic SDLC

Shift from sequential handoffs to fluid agent-driven workflow.

**State Machine**: INTENT -> SPEC -> PLAN -> IMPLEMENT -> VERIFY -> DOCS -> REVIEW -> RELEASE -> MONITOR -> ITERATE

**Key enablers**:
- Architecture Decision Records (ADRs) in `/docs/adr/`
- Golden path templates for services/modules
- Standardized build entrypoints (`make test`, `make lint`, `make ci`)
- Machine-readable CODEOWNERS + ownership maps
- "Agent lane" in CI: fast preflight -> full suite on PR -> canary + auto-rollback

### Trend 2: Multi-Agent Coordination

**Coordination patterns** (ranked):
1. **Hierarchical orchestration** (recommended): orchestrator assigns subtasks to specialists
2. **Router + specialists**: classify requests -> invoke experts
3. **Blackboard**: agents post to shared store; coordinator merges
4. **Debate/consensus**: multiple proposals -> judge agent selects

**Task Graph (DAG)**: Nodes represent steps, edges represent dependencies. Parallel execution where possible. Content-addressed artifacts (hash IDs) for audit trails.

**Merge Strategy**: Each specialist works on topic branch -> orchestrator composes via rebase -> conflict resolution -> re-run minimal verification per merged chunk -> stacked diffs where possible.

**Frameworks**: LangGraph, Microsoft AutoGen / Agent Framework.

### Trend 3: Long-Running Agents

Agents working for hours/days building complete systems with periodic checkpoints.

**Durable Job Schema** includes: jobId, repo, baseRef, objective, constraints, checkpoints, budgets (wall clock, CI minutes, model cost USD), permissions.

**State Persistence**: Event-sourced log + derived state. Persist: plan (DAG), tool calls, workspace snapshots (diffs), evaluation results.

**Failure Recovery**: Retry with jitter, circuit breakers, "reduce scope" fallback (ship smallest safe increment), escalate when uncertainty high.

**Environment Isolation**: Container-per-job, restricted egress, scoped secrets (short-lived credentials), allowlist tool access.

### Trend 4: Scaled Human Oversight

**Risk-Based Escalation Policy**:
- Low risk: auto-merge after gates + lightweight spot-check
- Medium risk: required human approval + security agent review
- High risk: 2-person review + threat modeling + staged rollout

**Risk Factors**: Surface area, security sensitivity, production blast radius, novelty.

**Verification Lattice** (5 layers):
1. Deterministic: build, unit tests, lint, typecheck
2. Semantic: contract tests, golden tests, snapshot tests
3. Security: SAST/DAST, dep scan, secret scan
4. Agentic: review agents for style/consistency + spec adherence
5. Human: escalations + final acceptance of risky changes

**"Ask-for-Help" Triggers**: Ambiguous requirements, failing tests with low-confidence root cause, architectural decisions impacting multiple services, new dependency introduction, access to sensitive data.

### Trend 5: New Surfaces & Non-Technical Users

- Terminal/IDE agent (developer-first)
- ChatOps agent (Slack/Teams) for ops + incidents
- Web portal for non-engineers: guided templates + guardrails
- Ticket-to-PR automation: issue + acceptance criteria -> PRs
- Legacy language enablement (COBOL/Fortran/DSLs)

### Trend 6: Economics & Instrumentation

**Minimum Viable Metrics per job**:
- Lead time (intent -> merged)
- Cycle time per state
- Rework rate (failed gates, retries)
- Defect density post-merge
- Cost (model + compute + CI)
- Human time (review minutes + escalations)

**Cost Controls**: Hard budgets per job/team, early stopping on low confidence, cheap models for low-risk steps, strongest models for high-stakes reasoning.

### Trend 7: Security-First Architecture

**Threat Model**: Prompt injection + tool hijacking, data exfiltration, supply chain attacks, excessive agency, overreliance.

**Guardrails**:
1. Least privilege: split read/write tools; explicit elevation for destructive actions
2. Network egress allowlists
3. Secrets hygiene: short-lived tokens, masked logs, CI secret scans
4. Policy-as-code: centralized policy decisions
5. Auditability: immutable logs (tool calls, diffs, approvals)

**Agent Tool Gateway**: All tools through gateway enforcing input/output validation, redaction, rate limits, policy checks, audit logging.

**Standards**: OWASP LLM App Top 10, NIST AI Risk Management Framework.

### Trend 8: Reference Architecture

| Component | Role |
|---|---|
| Agent Runtime | Ephemeral workspaces, tool access (git, build, linters, scanners) |
| Orchestrator | Decompose objectives -> subtasks -> assignments, shared plan + state machine |
| Context Layer | Repo indexing (AST), semantic search (vector DB), policy-limited doc access |
| Verification Layer | Deterministic + security + agentic checks |
| Delivery Layer | Branch/PR generation, review workflows, deployment automation |
| Observability | Tracing, cost/latency/success metrics, audit logs |

## MIT Missing Semester 2026: Agentic Coding

Key principles from the MIT course:

- **Agent = model + tools** (file ops, web search, shell commands)
- View agents as "a manager of an intern" -- guide, don't micromanage
- **TDD with agents**: write tests first, audit them, then request implementation
- **Context is finite**: clear sessions for new tasks, rewind instead of steering, compaction
- **llms.txt**: proposed standard for token-efficient documentation
- **AGENTS.md/CLAUDE.md**: pre-loaded guidance, cross-session advice
- **Parallel agents**: stochastic -- multiple runs yield better solutions
- **Git worktrees**: prevent interference between concurrent work
- **MCP**: open protocol connecting agents to external tools
- **Critical warning**: "Review AI output for correctness and security bugs." Agents make mistakes, enter debugging spirals, hallucinate. Don't treat as infallible.

## Best Practices Convergence (2026 Industry Consensus)

From CodeScene, Anthropic trends report, and practitioner consensus:

1. **Specification quality determines output quality** -- vague prompt = vague code, detailed spec = matching code
2. **Write real plan documents** -- goals, acceptance criteria, technical constraints, implementation notes (not 3-bullet Jira tickets)
3. **Review every diff before committing** -- prevents more bugs than prompt engineering
4. **Context as finite resource** -- fresh sessions for new tasks, summaries when sessions run long
5. **Git isolation always** -- never run agents on main branch, always feature branches
6. **Route all agent code through automated security + mandatory human review**
7. **Control as third pillar** (alongside autonomy and context) -- guardrails for safety/compliance
8. **Governance**: workflow authoring != execution != production deployment

## Relevance to blazewrit

New patterns applicable to the execution protocol:
- **Hook system** maps to blazewrit's produce-review loop (~70% mechanical)
- **Agent Teams** validates hierarchical orchestration (lead + specialists) already in blazewrit's 14-agent design
- **/batch** pattern similar to blazewrit's parallel independent step execution
- **Verification Lattice** (5 layers) could enhance blazewrit's Verify step
- **Risk-based escalation** could inform when to use pyreez (high-risk) vs. mechanical verification
- **Durable Job Schema** with budgets applicable to long-running blazewrit workflows
- **Ask-for-Help triggers** align with blazewrit's dialogue step and input-required states
- **A2A integration** possible via Agent Cards per blazewrit agent + Task lifecycle mapping

## Sources

- [Claude Code Hooks Guide](https://code.claude.com/docs/en/hooks-guide)
- [Claude Code 2026 Features Cheatsheet](https://github.com/coleam00/claude-code-new-features-early-2026/blob/main/CHEATSHEET.md)
- [2026 Agentic Coding Trends - HuggingFace](https://huggingface.co/blog/Svngoku/agentic-coding-trends-2026)
- [Anthropic 2026 Agentic Coding Trends Report](https://resources.anthropic.com/hubfs/2026%20Agentic%20Coding%20Trends%20Report.pdf)
- [MIT Missing Semester 2026 - Agentic Coding](https://missing.csail.mit.edu/2026/agentic-coding/)
- [Claude Code March 2026 Updates - builder.io](https://www.builder.io/blog/claude-code-updates)
- [CodeScene - Agentic AI Coding Best Practices](https://codescene.com/blog/agentic-ai-coding-best-practice-patterns-for-speed-with-quality)
- [Claude Code Agent Teams Guide](https://claudefa.st/blog/guide/agents/agent-teams)
- [Claude Code Hooks Reference - Pixelmojo](https://www.pixelmojo.io/blogs/claude-code-hooks-production-quality-ci-cd-patterns)
- [awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code)
