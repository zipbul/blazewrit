# Playbook

You are configuring an agentic workflow for this project. The playbook assets are located at `node_modules/@zipbul/playbook/assets/`.

## Step 1: Detect Environment

### Tool Detection

Detect which coding tool you are running in (Claude Code, Cursor, Codex, GitHub Copilot, Amp, Roo Code, Gemini CLI, Windsurf, Cline, etc.)

### Harness Level

| Level | Signs |
|-------|-------|
| **Full harness** | Custom agents/skills with behavioral rules, hooks, quality gates |
| **Basic rules** | Built-in system prompt rules, but no enforced workflow |
| **Bare agent** | LLM with tool access only, no default rules |

## Step 2: Analyze Project

- Language, runtime, package manager
- Test framework and commands
- Project structure (monorepo/single package/library/application)
- CI configuration (source of truth for build/test/lint)
- Existing instruction files (CLAUDE.md, AGENTS.md, .cursor/rules/, etc.)

## Step 3: Deploy

### 3a. Add workflow to instruction file

Add to the project's primary instruction file (CLAUDE.md, AGENTS.md, or equivalent):

```markdown
## Workflow
Orient → Dialogue → Test ⇄ Implement
```

### 3b. Generate skills from step files

Read step files from `assets/steps/`. Each has YAML frontmatter with `name`, `description`, and `allowed-tools`.

Generate native skill files for the detected tool:

| Tool | Skill Format | Skill Path |
|------|-------------|------------|
| Claude Code | YAML frontmatter + markdown | `.claude/skills/{name}/SKILL.md` |
| Cursor | `.mdc` files with frontmatter | `.cursor/rules/{name}.mdc` |
| Codex | Sections in AGENTS.md | AGENTS.md |
| GitHub Copilot | `.instructions.md` | `.github/instructions/{name}.instructions.md` |
| Gemini CLI | Markdown rule files | `.gemini/rules/{name}.md` |
| Other | Sections in AGENTS.md or equivalent | AGENTS.md |

**Harness adaptation**:
- **Full harness**: Deploy workflow section only. Skip skills (would conflict).
- **Basic rules**: Deploy workflow + skills.
- **Bare agent**: Deploy workflow + skills.

### 3c. Project-specific adaptation

- Replace generic references with actual test framework, linter, type checker
- Reference actual directory paths and file patterns
- Add project-specific build/test commands to instruction file
- Add code style deviations from defaults (only non-obvious conventions)
- Add architectural decisions the agent cannot discover from code

### 3d. MCP tool recommendations

If the project uses @zipbul MCP tools, add WHEN hints (not HOW) to the instruction file:

```markdown
## Tools
- Use pyreez when judgment or multi-perspective comparison is needed.
- Use firebat when code quality verification is needed.
- Use emberdeck when spec or plan management is needed.
```

Only include tools that are actually installed. Each tool self-describes through its MCP schema.

## Step 4: Report

After deployment, report:
- Detected harness level and what was deployed
- Skills created and their locations
- Recommendations for additional setup (hooks, linters, CI)
- How to update (re-run after `npm update @zipbul/playbook`)
