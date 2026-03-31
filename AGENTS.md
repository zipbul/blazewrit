# Playground

This is the development workspace for @zipbul/blazewrit — a prompt-driven agentic workflow package.

## Workflow

None (논의) ↔ Triage → Flow[Analyze → 기획? → Spec? → Core Steps → Verify → Reflect]

Step pool: Analyze, 기획, Spec, Test, Implement, Report, Verify, Reflect
Execution: produce ⇄ review loop per step (14 agents: 8 producer + 6 reviewer) + hooks (~70% mechanical)

## Tools

- pyreez: 기획 (ideation, architecture deliberation), Verify (review mode, high-risk)
- firebat: Implement (after every change), Verify (full scan), Analyze (query-dependencies for Migration)
- emberdeck: Analyze (card query), 기획 (intent card), Spec (spec card + codeLinks), Implement (validate links), Verify (regression_guard)

## Rules

- Respond in Korean for conversation, English for documents and code
- Prompts over finished products — generate project-specific content, don't ship static templates
