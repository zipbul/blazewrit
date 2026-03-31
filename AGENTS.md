# Playground

This is the development workspace for @zipbul/blazewrit — a prompt-driven agentic workflow package.

## Workflow

Triage(classification) → Flow[Prepare(tailored) → Core Steps → Reflect]

Step pool: Dialogue, Test, Implement, Verify, Report, Reflect
Execution: subagent-per-step + allowed-tools + transition scripts + hooks (~70% mechanical)

## Tools

- pyreez: Dialogue (approach comparison), Verify (review mode, high-risk)
- firebat: Implement (after every change), Verify (full scan), Migration Prepare (query-dependencies)
- emberdeck: Feature Prepare (card query), Dialogue (save plan), Implement (validate links), Verify (regression_guard)

## Rules

- Respond in Korean for conversation, English for documents and code
- Prompts over finished products — generate project-specific content, don't ship static templates
