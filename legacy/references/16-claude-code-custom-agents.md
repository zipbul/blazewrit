# Claude Code Custom Agents Specification

Research date: 2026-04-01. Sources: code.claude.com/docs, GitHub anthropics/claude-code, Medium tracing analysis.

## `.claude/agents/*.md` Frontmatter Fields

Each agent file is a Markdown file with YAML frontmatter. Only `name` and `description` are required.

| Field | Required | Type | Description |
|---|---|---|---|
| `name` | **Yes** | string | Unique identifier, lowercase letters and hyphens |
| `description` | **Yes** | string | When Claude should delegate to this subagent |
| `tools` | No | comma-separated string | Allowlist of tools. Inherits all tools if omitted. Supports `Agent(worker, researcher)` syntax to restrict which subagents can be spawned |
| `disallowedTools` | No | comma-separated string | Tools to deny (removed from inherited/specified list) |
| `model` | No | string | `sonnet`, `opus`, `haiku`, a full model ID (e.g. `claude-opus-4-6`), or `inherit`. Defaults to `inherit` |
| `permissionMode` | No | string | `default`, `acceptEdits`, `dontAsk`, `bypassPermissions`, or `plan` |
| `maxTurns` | No | integer | Maximum agentic turns before subagent stops |
| `skills` | No | YAML list | Skills to preload (full content injected at startup, not just made available) |
| `mcpServers` | No | YAML list | Either string references to existing servers or inline definitions with full MCP config |
| `hooks` | No | object | Lifecycle hooks scoped to this subagent. Supports `PreToolUse`, `PostToolUse`, `Stop` events |
| `memory` | No | string | `user` (`~/.claude/agent-memory/<name>/`), `project` (`.claude/agent-memory/<name>/`), or `local` (`.claude/agent-memory-local/<name>/`) |
| `background` | No | boolean | `true` to always run as background task. Default: `false` |
| `effort` | No | string | `low`, `medium`, `high`, `max` (Opus 4.6 only). Overrides session effort |
| `isolation` | No | string | `worktree` to run in temporary git worktree. Auto-cleaned if no changes |
| `initialPrompt` | No | string | Auto-submitted as first user turn when agent runs as main session agent (via `--agent`). Commands and skills are processed. Prepended to user-provided prompt |

### Example: Read-Only Reviewer

```markdown
---
name: code-reviewer
description: Reviews code for quality and best practices
tools: Read, Glob, Grep
model: sonnet
---

You are a code reviewer. When invoked, analyze the code...
```

### Example: MCP Server Scoping

```yaml
---
name: browser-tester
description: Tests features in a real browser using Playwright
mcpServers:
  - playwright:
      type: stdio
      command: npx
      args: ["-y", "@playwright/mcp@latest"]
  - github
---
```

### Example: Scoped Hooks

```yaml
---
name: db-reader
description: Execute read-only database queries
tools: Bash
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/validate-readonly-query.sh"
---
```

## Storage Priority (Highest First)

1. `--agents` CLI flag (JSON, session only)
2. `.claude/agents/` (project)
3. `~/.claude/agents/` (user)
4. Plugin's `agents/` directory

## Tool Resolution

If both `tools` and `disallowedTools` are set, `disallowedTools` is applied first, then `tools` is resolved against the remaining pool.

## Model Resolution Order

1. `CLAUDE_CODE_SUBAGENT_MODEL` env var
2. Per-invocation `model` parameter (in Agent tool call)
3. Frontmatter `model` field
4. Main conversation model (inherit)

## Plugin Restrictions

Plugin subagents do NOT support `hooks`, `mcpServers`, or `permissionMode` fields (silently ignored).

## Subagent Nesting Limitation

Subagents CANNOT spawn other subagents. `Agent(agent_type)` syntax in `tools` only applies to agents running as the main thread with `--agent` flag.

---

## `.claude/rules/*.md` Files

### Always-Loaded Rules

Any `.md` file in `.claude/rules/` **without** a `paths` frontmatter field is loaded unconditionally at launch (same priority as `.claude/CLAUDE.md`).

### Path-Conditional Rules

Rules with `paths` frontmatter only load when Claude **reads** files matching the specified glob patterns.

```markdown
---
paths:
  - "src/api/**/*.ts"
---

# API Development Rules
- All API endpoints must include input validation
```

### Glob Pattern Syntax

| Pattern | Matches |
|---|---|
| `**/*.ts` | All TypeScript files in any directory |
| `src/**/*` | All files under `src/` |
| `*.md` | Markdown files in project root only |
| `src/components/*.tsx` | React components in specific directory |

### Multiple Patterns and Brace Expansion

```yaml
---
paths:
  - "src/**/*.{ts,tsx}"
  - "lib/**/*.ts"
  - "tests/**/*.test.ts"
---
```

### Loading Behavior

- Path-scoped rules trigger when Claude **reads** files matching the pattern, NOT on write/create operations
- User-level rules (`~/.claude/rules/`) apply to every project, loaded before project rules
- Project rules have higher priority than user rules
- Symlinks supported; circular symlinks detected and handled gracefully
- Only `paths` (YAML list of glob strings) is documented as a frontmatter field for rules files

---

## Agent Tool (Spawning Subagents from Host)

The `Agent` tool spawns subagents. Parameters:

| Parameter | Required | Type | Description |
|---|---|---|---|
| `description` | Yes | string | Short (3-5 word) summary shown in UI |
| `prompt` | Yes | string | Full task description for the subagent |
| `subagent_type` | Yes | string | `Explore`, `Plan`, `general-purpose`, or any custom agent name |
| `model` | No | string | `sonnet`, `opus`, `haiku` — overrides agent definition |
| `run_in_background` | No | boolean | Run asynchronously |
| `isolation` | No | string | `worktree` for git worktree isolation |

### Result Handling

The subagent's text output response plus an `agentId` field are returned to the parent. The result is NOT visible to the user — the parent must send a text message with a concise summary.

### No `files_to_read` Parameter

There is no dedicated `files_to_read` parameter in the Agent tool schema. Context passes through the `prompt` field. The agent must be instructed to read specific files in the prompt text.

### SendMessage (Agent Teams only)

Used to resume a stopped subagent by its agent ID. Only available when `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` or `--agent-teams` flag is set.

---

## Skills vs Subagents vs Rules

| Aspect | Rules (`.claude/rules/`) | Skills (`.claude/skills/`) | Subagents (`.claude/agents/`) |
|---|---|---|---|
| **Purpose** | Persistent instructions/context | Reusable prompt-based workflows | Isolated task delegation |
| **Context** | Loaded into main conversation | Runs inline OR in forked subagent | Own context window |
| **When loaded** | Always (or on path match) | On invocation (description always in context) | When Claude delegates |
| **Isolation** | None (main context) | Optional via `context: fork` | Always isolated |
| **Can spawn subagents** | N/A | Yes (via `context: fork` + `agent` field) | No (cannot nest) |
| **Tool restrictions** | N/A | `allowed-tools` field | `tools` / `disallowedTools` fields |
| **Custom model** | No | `model` field | `model` field |
| **Hooks** | No | `hooks` field | `hooks` field |
| **Memory** | No | No | `memory` field (user/project/local) |

### Key Interactions

- Skills `context: fork` makes the skill content become the prompt for a subagent. The `agent` field picks which subagent type executes it.
- Subagents `skills` field injects full skill content at startup (inverse of `context: fork`).

---

## WORKFLOW_PLAN.md Implications

### Confirmed Capabilities

| WORKFLOW_PLAN Assumption | Confirmed? | Detail |
|---|---|---|
| Custom agent frontmatter with tools | **Yes** | `tools` field, comma-separated |
| mcpServers scoping per agent | **Yes** | `mcpServers` field, inline or reference |
| permissionMode per agent | **Yes** | `permissionMode` field |
| maxTurns per agent | **Yes** | `maxTurns` field |
| Worktree isolation | **Yes** | `isolation: worktree` field |
| Hooks per agent | **Yes** | `hooks` field with PreToolUse/PostToolUse/Stop |
| files_to_read parameter | **No** | Must pass via prompt text, not a dedicated field |
| Subagent spawning subagents | **No** | Subagents cannot nest (only main thread with --agent) |

### Critical Design Impact

**Subagent nesting limitation**: WORKFLOW_PLAN assumes the host orchestrator spawns step agents. This works. But step agents CANNOT spawn reviewer agents as subagents. The host must manage the entire produce ⇄ review loop — spawn producer, collect result, spawn reviewer, collect result, decide next action.

**No files_to_read**: The `<files_to_read>` pattern from GSD must be implemented as prompt text injection, not a tool parameter. The host includes file paths in the prompt string when spawning each agent.
