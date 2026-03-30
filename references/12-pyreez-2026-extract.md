# pyreez 기존 자료 재감사 — 2026 소스 추출

Audited: 2026-03-30
Source: /home/revil/projects/zipbul/pyreez/docs/ (5 files)

## Audit Summary

| File | 2026 Sources | Pre-2026 (skipped) |
|------|-------------|-------------------|
| WORKER_PROMPTING_DEPTH.md | 7 | ~10 |
| PROMPT_ENGINEERING_REFERENCE.md | 10 | ~8 |
| ADVANCED_OPTIMIZATION_REFERENCE.md | 3 | ~14 |
| INTERACTION_TECHNIQUE_RESEARCH.md | 6 | ~25 |
| MULTI_MODEL_INTERACTION_REFERENCE.md | 6 | ~12 |

## NEW Sources (Not Already in blazewrit references/)

### HIGH Priority

**1. The Instruction Gap** (arXiv 2601.03269)
- Instruction repetition recovers compliance 20-35%
- Structural separation of instructions from content improves adherence
- Structured templates improve compliance ~25%
- *Directly relevant to skill/prompt authoring*

**2. Don't Break the Cache** (arXiv 2601.06007)
- Prompt caching yields 41-80% cost reduction, 13-31% TTFT improvement
- Naive full-context caching can INCREASE latency
- Static content must go at prompt top, dynamic at bottom
- *Cost/latency critical for production agents*

**3. OPENDEV: Building AI Coding Agents for the Terminal** (arXiv 2603.05344)
- ReAct loop design for terminal coding agents
- Event-based reminders for long sessions
- Progressive compaction
- Plan-mode tool removal pattern

**4. NxCode Harness Engineering: Complete Guide** (2026)
URL: https://www.nxcode.io/resources/news/harness-engineering-complete-guide-ai-agent-codex-2026
- Constraining/Informing/Verifying/Correcting middleware framework
- LangChain Terminal Bench: 52.8% → 66.5% with harness
- Practical harness patterns for coding agents

**5. Martin Fowler: Harness Engineering** (2026)
URL: https://martinfowler.com/articles/exploring-gen-ai/harness-engineering.html
- Harness has 2x more impact than model itself (42% → 78% on same model)
- Cross-validated by OpenAI's harness engineering post

### MEDIUM Priority — Multi-Agent Debate/Deliberation Cluster

**6. AceMAD: Breaking the Martingale** (arXiv 2603.06801)
- Standard MAD cannot improve beyond majority voting
- Requires submartingale drift: diversity + calibrated confidence + asymmetric weighting

**7. DCI: From Debate to Deliberation** (arXiv 2603.11781)
- Structured deliberation > unstructured debate (+0.95 on non-routine tasks)
- Goal specification helps, process prescription HARMS

**8. Demystifying MAD** (arXiv 2601.19921)
- Diversity + calibrated confidence are the actual drivers, not debate technique

**9. DynaDebate** (arXiv 2601.05746)
- Initial diversity matters, not fixed technique assignment
- Adaptive strategies per model

**10. DAR: Hear Both Sides** (arXiv 2603.20640)
- Diversity-Aware Retention: share most DIVERGENT responses, not all
- "What agents hear is as important as what agents say"

**11. Dynamic Role Assignment for MAD** (arXiv 2601.17152)
- Dynamic role switching > fixed roles
- Reduces argument repetition

**12. AdaptOrch** (arXiv 2602.16873)
- Coupling density determines optimal topology
- High coupling → sequential/hierarchical, low coupling → parallel

**13. From Biased Chatbots to Biased Agents** (arXiv 2602.12285)
- Task-irrelevant persona assignment causes up to 26.2% degradation
- *Critical warning for identity/role design in skills*

### LOW-MEDIUM Priority

**14. Dunning-Kruger in LLMs** (arXiv 2603.09985)
- LLMs overconfident in weak areas, underconfident in strong areas
- Relevant to confidence calibration in agent outputs

**15. Anthropic Skill Authoring Best Practices** (2026)
URL: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
- Checklist pattern for multi-step workflows
- Feedback loops, freedom-degree matching
- Plan-validate-execute pattern
- 500-line limit, one-level-deep references
- *Partially covered in 09 but skill authoring specifics are new*

**16. LLM-as-Judge Biases** (Label Your Data, 2026)
- Position bias: 40% inconsistency in GPT-4
- Verbosity bias, self-enhancement bias

**17. Agents at Work: 2026 Playbook** (Prompt Engineering Org)
URL: https://promptengineering.org/agents-at-work-the-2026-playbook-for-building-reliable-agentic-workflows/

## Key Techniques Extracted

### Prompt Compliance
- Instruction repetition recovers 20-35% compliance
- Exclusion constraints + positive directives = near-100% format compliance
- Knowledge input BEFORE task instruction for optimal ordering
- "You can reject if..." framing yields up to 94% rejection rate

### Caching Optimization
- Static content at top, dynamic at bottom
- Cache blocks yield 41-80% cost reduction
- Naive full-context caching increases latency — must be strategic

### Confidence Calibration
- Third-person framing reduces sycophancy 13.6%
- Explicit rejection permission as anti-sycophancy measure
- LLMs exhibit Dunning-Kruger: overconfident in weak areas

### Multi-Agent Design Rules (from Debate/Deliberation papers)
1. Standard MAD cannot beat majority voting without submartingale drift
2. Diversity + calibrated confidence are the real drivers
3. Goal specification > process prescription for deliberation
4. Share DIVERGENT responses selectively, not broadcast all
5. Dynamic role switching > fixed roles
6. Task-irrelevant personas actively harmful (up to 26.2% degradation)
7. Coupling density determines optimal topology (sequential vs parallel)

### Output Optimization
- Chain of Draft: 7.6% tokens of CoT for equivalent accuracy
- 2-step structured output: free-form reasoning → format (48% → 61%)
- SLOT: separate formatting from NL tasks
- Observation Masking > LLM Summarization for compaction

## Already Covered in blazewrit references/

The following pyreez 2026 sources overlap with existing references and were not duplicated:
- Anthropic Claude 4 Best Practices → `09-anthropic-official-2026.md`
- Claude Code Hooks/Skills/Memory → `09-anthropic-official-2026.md`
- ACE Framework (2510.04618) → `10-academic-vendor-2026.md`
- Agentic AI Taxonomy (2601.12560) → `10-academic-vendor-2026.md`
- Agent Skills (2602.12430) → `10-academic-vendor-2026.md`
- Memory vs Long-Context (2603.04814) → `10-academic-vendor-2026.md`
- AgentSpec (2503.18666) → `10-academic-vendor-2026.md`
- Guardrails papers → `10-academic-vendor-2026.md`
- FeatureBench / ABC-Bench → `10-academic-vendor-2026.md`
- Karpathy/Chase/Willison/Osmani/Husain → `11-key-figures-2026.md`
- OpenAI/Google vendor guides → `10-academic-vendor-2026.md`
