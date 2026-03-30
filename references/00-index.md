# Research Index

Cross-reference of research findings against playbook golden rules. Last updated: 2026-03-30.

## Reference Files

- [01-agent-workflow-patterns.md](./01-agent-workflow-patterns.md) — Anthropic, OpenAI, Andrew Ng, ReAct, Reflexion, practitioner workflows
- [02-coding-agent-rules.md](./02-coding-agent-rules.md) — Claude Code, Cursor, Codex, Copilot, Amp, Cline, Windsurf, Roo Code, Oh My OpenCode
- [03-prompt-engineering.md](./03-prompt-engineering.md) — Prompting best practices, identity/persona evidence, structured constraint techniques
- [04-structural-gaps.md](./04-structural-gaps.md) — Cyclical loops, context management, scope bounding, rule rationale, prompt relationship
- [05-repo-audit-gsd.md](./05-repo-audit-gsd.md) — GSD (Get Shit Done) full repo audit: meta-prompting, context engineering, auto-loop, TACHES
- [06-repo-audit-gstack.md](./06-repo-audit-gstack.md) — gstack full repo audit: 28 skills, sprint workflow, dual-voice review, ETHOS
- [07-repo-audit-speckit.md](./07-repo-audit-speckit.md) — spec-kit full repo audit: SDD workflow, constitution, extensions, 27+ agent support
- [08-ralph-loop.md](./08-ralph-loop.md) — Ralph Loop: fresh-context iteration, filesystem memory, PRD-driven autonomous execution
- [09-anthropic-official-2026.md](./09-anthropic-official-2026.md) — Anthropic 2026: hooks, skills, rules, memory, sub-agents, context/harness engineering, Claude 4.6 best practices
- [10-academic-vendor-2026.md](./10-academic-vendor-2026.md) — arXiv/ICLR 2026, AgentSpec, ACE, FeatureBench, OpenAI SDK, Google ADK
- [11-key-figures-2026.md](./11-key-figures-2026.md) — Karpathy, Chase, Willison, Osmani, Husain, Mollick, Lambert + 7 others
- [12-pyreez-2026-extract.md](./12-pyreez-2026-extract.md) — pyreez 재감사: 17 NEW 2026 sources, multi-agent debate cluster, caching, instruction compliance
- [13-technique-inventory.md](./13-technique-inventory.md) — 전수조사 기법 목록: 638파일 직접 읽기, 1400+ 기법 추출 (GSD/gstack/spec-kit)

## Applied Revisions (2026-03-04)

### Phase 1 — Prompt Technique Revisions

| Change | Files Affected | Status |
|---|---|---|
| WRONG/RIGHT → "Instead of / Prefer" format | test.md, implement.md, review.md | Done |
| Negative instructions → positive framing | All assets/ | Done |
| Identity declarations → specific and functional | orient.md, implement.md, verify.md | Done |
| Tool names removed from golden rule body | CLAUDE.md, review.md | Done |
| Failure conditions added | dialogue.md, implement.md | Done |

### Phase 2 — Structural Changes

| Change | Files Affected | Status |
|---|---|---|
| Test⇄Implement cyclical loop added to workflow | workflow.md | Done |
| Scope bounding definition added | workflow.md | Done |
| Context persistence principle added | workflow.md | Done |
| Backward transition diagram added | workflow.md | Done |
| Rationale added to numbered rules | implement.md, dialogue.md, review.md, verify.md | Done |
| Retry rule refined (same-approach vs multi-approach) | implement.md | Done |

### Phase 3 — Simulation-Driven Revisions (2026-03-04)

| Change | Files Affected | Status |
|---|---|---|
| Step transition protocols (entry/exit criteria) added | orient.md, dialogue.md, test.md, implement.md | Done |
| "Same approach" explicitly defined | implement.md | Done |
| Flaky test handling rule added | test.md | Done |
| Review iteration cap added (3 rounds) | review.md | Done |
| Self-contradictions resolved (verify self-assessment, dialogue Understand/Ideate, scope creep) | verify.md, dialogue.md | Done |
| Orient report template expanded (intent, codebase state, file list) | orient.md | Done |
| Orient→Dialogue handoff rule added | dialogue.md | Done |
| Plan rejection/revision protocol added | dialogue.md | Done |
| Implement Rule H compressed to Verify reference | implement.md | Done |
| Test Rule E split into TDD/tests-after modes | test.md | Done |
| Self-clearance checklist compressed (6→2 items) | dialogue.md | Done |
| Intent classification scoped to user messages | implement.md | Done |
| Delegation conditioned on tool capability | implement.md | Done |
| Verify/Review ordering defined | verify.md, workflow.md | Done |
| Review identity/table mismatch fixed | review.md | Done |
| Trigger files merged into single triggers.md | assets/triggers/ | Done |
| Redundancy removed (~570 tokens), rationale text removed | All files | Done |
| ASCII diagram removed (kept textual descriptions) | workflow.md | Done |
| LSP/AST dead reference removed | orient.md | Done |
| verify.md Rule G (trivially obvious) removed | verify.md | Done |
| Plan template compressed (4 required + 2 optional sections) | dialogue.md | Done |
| Pseudocode/code boundary defined | dialogue.md | Done |

### Not Yet Applied

| Item | Reason | Action Needed |
|---|---|---|
| Model-family adaptation (Claude ~1100 lines vs GPT ~300 lines) | Not recommended — maintain single universal version | No action |

## Golden Rules vs. Evidence (Updated)

### Validated and Applied

| Rule | Evidence | Confidence |
|---|---|---|
| Read-only reconnaissance (Orient) | Claude Code Plan Mode, Anthropic harness | High |
| Plan-before-implement (Dialogue) | Universal (Osmani, JetBrains, CodeScene, Devin, all tools) | High |
| Test-first development (Test) | Reflexion 91% pass@1, Osmani, CodeScene | High |
| Change only what is necessary (Implement) | Claude Code, industry anti-over-engineering consensus | High |
| Mechanical verification (Verify) | CodeScene, Copilot hooks, Oh My OpenCode hashline | High |
| Severity classification (Review) | Claude Code security review, DMN tables 0.91 F1 | High |
| Decision matrices in tables | DMN-Guided Prompting: 0.91 F1 vs 0.53 prose | High |
| Failure conditions per step | Anthropic, OpenAI stop conditions | High |
| Test⇄Implement loop | Reflexion (NeurIPS 2023), LangChain | High |
| Scope bounding | Anthropic harness, Osmani, JetBrains, SmartBear | High |
| "Instead of / Prefer" examples | Google Gemini docs, Over-Prompting paper | Moderate |
| Positive framing | Anthropic, OpenAI, Google universal consensus | High |

### Playbook Differentiation (Unique or Rare)

- **Identity switching per step** — Only Oh My OpenCode (multi-tier agents) and Roo Code (custom modes) do similar
- **Severity-classified review** — Only Claude Code security review does similar
- **Self-clearance checklist** (Dialogue) — Not found in other systems
- **Intent classification table** (Dialogue) — Not found in other systems
- **Structured orient report format** — Claude Code Plan Mode does similar but less structured

### Industry Convergence

All major tools converge on: plan before act, test before implement, verify mechanically, enforce via deterministic gates. AGENTS.md emerging as cross-tool standard. Markdown as universal format. Hierarchical rule discovery (global → project → directory).
