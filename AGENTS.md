# Playground

This is the development workspace for @zipbul/blazewrit — a prompt-driven agentic workflow package.

## Workflow

None (free conversation) ↔ Triage → Flow[Ground → Investigate → Decide → Spec? → Core Steps → Verify → Reflect]

Step pool: Ground, Investigate, Decide, Spec, Test, Implement, Report, Verify, Reflect (9 steps)
Execution: produce ⇄ review loop per step (16 agents: 9 producer + 7 reviewer — Verify/Reflect have no reviewer) + hooks (mechanical)

## Tools

- pyreez: Decide(Plan/Design — ideation, architecture deliberation), Verify (review mode, high-risk)
- firebat: Implement (after every change), Verify (full scan), Investigate (query-dependencies for Migration)
- emberdeck: Ground (graph query), Decide(Design — intent card), Spec (spec card + codeLinks), Implement (validate links), Verify (regression_guard)

## Rules

- Respond in Korean for conversation, English for documents and code
- Prompts over finished products — generate project-specific content, don't ship static templates
