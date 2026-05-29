# Agent Workflow Patterns

Research on established agentic workflow patterns. Last updated: 2026-03-03.

## 1. Anthropic — Building Effective Agents (Dec 2024)

**Source:** https://www.anthropic.com/research/building-effective-agents

Core distinction: **workflows** (predefined code paths) vs **agents** (LLM directs its own process).

Five workflow patterns (increasing complexity):

| Pattern | Structure | Use When |
|---|---|---|
| Prompt Chaining | Sequential steps with gates | Task decomposes into fixed subtasks |
| Routing | Classify input, route to handler | Distinct categories need different handling |
| Parallelization | Sectioning or Voting | Speed or confidence gains justify it |
| Orchestrator-Workers | Central LLM delegates dynamically | Subtask requirements are unpredictable |
| Evaluator-Optimizer | Generate + evaluate in loop | Clear evaluation criteria exist |

Three principles: Simplicity, Transparency, ACI (Agent-Computer Interface) Design.

Decision rule: "Add complexity only when it demonstrably improves outcomes."

## 2. Anthropic — Context Engineering (2025)

**Source:** https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents

Context engineering > prompt engineering for agents. Strategies:
- Just-in-time retrieval over pre-loading everything
- Compaction — summarize history, discard redundant tool outputs
- Structured note-taking — persistent memory files outside context window
- Sub-agent architectures — specialized agents with clean context returning condensed summaries

## 3. Anthropic — Harnesses for Long-Running Agents (2025)

**Source:** https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents

Agent session lifecycle for coding:
1. Environment assessment (pwd, git logs, feature review)
2. Development server initialization
3. Basic functionality verification
4. Single feature implementation (one at a time)
5. Comprehensive testing and commit

Key: Two-agent architecture — Initializer Agent (setup) + Coding Agent (incremental progress per session).

## 4. OpenAI Agents SDK

**Source:** https://openai.github.io/openai-agents-python/

Three primitives: Agents (LLMs + instructions + tools), Handoffs (agent-to-agent delegation), Guardrails (input/output validation in parallel).

Orchestration patterns:
- Manager (centralized) — one agent coordinates via tool calls
- Decentralized (handoff) — agents transfer control directly

Design methodology: Start simple → validate → evolve to multi-agent only when necessary.

**Source:** https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/

## 5. Andrew Ng's Four Agentic Patterns (2024)

**Source:** https://www.analyticsvidhya.com/blog/2024/10/agentic-design-patterns/

1. **Reflection** — AI critiques its own output, refines iteratively
2. **Tool Use** — interact with external APIs, databases, services
3. **Planning** — decompose complex tasks into executable steps
4. **Multi-Agent Collaboration** — specialized agents with different roles

Performance: GPT-3.5 improved from 48.1% to 95.1% accuracy in agentic workflows vs. zero-shot.

## 6. ReAct (Yao et al., 2023)

**Source:** https://www.ibm.com/think/topics/react-agent

Interleave Reasoning with Acting: Thought → Action → Observation → Thought → ...

Strength: Reduces hallucinations by grounding in tool outputs.
Weakness: Incremental only — no global planning perspective.

## 7. Plan-and-Execute

**Source:** https://dev.to/jamesli/react-vs-plan-and-execute-a-practical-comparison-of-llm-agent-patterns-4gh9

Planner creates full task list upfront. Executors carry out steps (often using ReAct internally). Dynamic adjustment based on feedback.

Strength: Global perspective before execution.
Weakness: Plan may become stale as execution reveals new information.

## 8. Reflexion (Shinn et al., NeurIPS 2023)

**Source:** https://arxiv.org/abs/2303.11366

Act → Evaluate → Reflect (verbal self-critique) → Store in episodic memory → Act again.

Performance: 91% pass@1 on HumanEval (vs. 80% for GPT-4 zero-shot). Specifically designed for coding tasks where test feedback drives self-correction.

## 9. Google ADK (Agent Development Kit)

**Source:** https://google.github.io/adk-docs/

Three foundational execution patterns: Sequential, Parallel, Loop. Supports shared session states, model-driven delegation, and explicit invocation between agents.

**Source:** https://docs.cloud.google.com/architecture/choose-design-pattern-agentic-ai-system

## 10. Practitioner Workflows

### Addy Osmani (Google, 2025-2026)

**Source:** https://addyosmani.com/blog/agentic-engineering/

Phases: Planning → Chunked Implementation → Testing-Integrated Development → Review & Verification → Ownership.

Key: "Testing is the single biggest differentiator between agentic engineering and vibe coding."

### JetBrains Junie Spec-Driven (2025)

**Source:** https://blog.jetbrains.com/junie/2025/10/how-to-use-a-spec-driven-approach-for-coding-with-ai/

Four phases: Requirements Definition → Strategic Planning → Task Breakdown → Controlled Execution.

Principles: Clarity precedes implementation, bounded scope, external documentation over conversation memory, human remains decision-maker.

### CodeScene (2025)

**Source:** https://codescene.com/blog/agentic-ai-coding-best-practice-patterns-for-speed-with-quality

Six patterns: Pull Risk Forward, Safeguard Generated Code, Expand AI-Ready Surface, Encode Principles, Coverage as Behavioral Guardrail, Automate End-to-End.

## Comparison with Playbook Workflow

```
Playbook:       Orient → Dialogue → Test → Implement  (+ Verify, Review)
Anthropic:      [Choose pattern by complexity] → Simplest to most autonomous
Reflexion:      Act → Evaluate → Reflect → Memory → Act (cyclical)
Plan-Execute:   Plan (global) → Execute step → Re-plan if needed
Osmani:         Spec → Plan → Chunk → Implement+Test → Review → Commit
JetBrains:      Requirements → Plan → Tasks → Execute (phased)
CodeScene:      Assess → Safeguard → Generate → Validate → Iterate
```

### Alignment

| Playbook Phase | Established Equivalent | Alignment |
|---|---|---|
| Orient | Environment assessment, reconnaissance, Plan-and-Execute "Plan" phase | Strong |
| Dialogue | Human-in-the-loop, checkpoint reviews, Prometheus interview-mode | Supported but typically embedded in phases, not standalone |
| Test | TDD, Reflexion test-driven feedback, coverage gates | Strongly supported |
| Implement | ReAct "Act", Plan-and-Execute "Execute" | Universal |
| Verify | Reflection, Evaluator-Optimizer, three-tier safeguards | Very strongly supported |
| Review | Multi-agent critic, secondary AI review | Well supported |

### Gaps to Consider

1. **Explicit cyclical loop** — Reflexion loop (implement → test → fail → reflect → retry) is the most empirically validated pattern. Playbook reads as linear.
2. **Orient vs Plan split** — Most sources distinguish understanding (Orient) from decomposition/planning (producing a plan artifact). Dialogue partially covers this but the boundary is unclear.
3. **Context management** — No explicit strategy for compaction, structured notes, or scope bounding per cycle.
4. **Scope bounding** — How large is one pass through Orient → Implement? Best practice is to keep each cycle small.
