# Prompt Engineering for Coding Agent Systems

Research on prompt engineering techniques relevant to coding agent system prompts. Last updated: 2026-03-03.

## 1. Anthropic — Claude 4.6 Prompting Best Practices

**Source:** https://platform.claude.com/docs/en/docs/build-with-claude/prompt-engineering/claude-4-best-practices

### Core Techniques
- **Be clear and direct.** "Think of Claude as a brilliant but new employee who lacks context."
- **Add context/motivation.** Explain WHY a rule exists, not just the rule. Claude generalizes from explanations.
- **Use examples.** 3-5 diverse examples in `<example>` tags. "One of the most reliable ways to steer output."
- **Structure with XML tags.** `<instructions>`, `<context>`, `<input>`. Consistent, descriptive tag names. Nest for hierarchy.
- **Give Claude a role.** Even one sentence focuses behavior.
- **Positive over negative framing.** Instead of "Do not use markdown" → "Your response should be composed of smoothly flowing prose."

### Agentic-Specific
- Claude 4.6 proactively delegates to subagents — add guidance on when warranted vs. working directly
- Aggressive language ("CRITICAL: You MUST") may cause overtriggering on Claude 4.6. Normal language works.
- Queries placed at end of long documents can improve response quality by up to 30%
- Explicitly classify reversible vs. irreversible actions for safety

## 2. OpenAI — GPT-4.1 / GPT-5 / Codex Prompting

### GPT-4.1
**Source:** https://developers.openai.com/cookbook/examples/gpt4-1_prompting_guide

- **Three system-prompt reminders increased SWE-bench Verified by ~20%**: (1) Persistence, (2) Tool-calling ("do NOT guess"), (3) Planning
- API-based tool definitions outperform manual injection by ~2%
- Explicit planning prompts improve pass rate by ~4%
- **Literal instruction following** is key — vague prompts fail, explicit specs succeed
- Contradictions damage performance (model burns reasoning tokens reconciling conflicts)
- Markdown is best starting format; XML for nesting; JSON least effective for docs

### GPT-5
**Source:** https://developers.openai.com/cookbook/examples/gpt-5/gpt-5_prompting_guide

- Define explicit exploration criteria, fixed tool-call budgets, escape hatches
- XML-based prompt organization: `<context_gathering>`, `<persistence>`, `<code_editing_rules>`
- **Metaprompting**: Ask the model to improve the prompt — yielded production-ready revisions
- GPT-5.2 removes personality padding: "Take a deep breath" and "You are a world-class expert" treated as noise

### Codex
**Source:** https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide/

- Agents as "autonomous senior engineers" who "bias to action"
- Avoid "AI slop" with specific aesthetic directives
- Batch operations and parallel execution for exploration
- Remove preamble/plan prompting (can cause premature stops)

## 3. Google/DeepMind — Gemini Prompt Strategies

**Source:** https://ai.google.dev/gemini-api/docs/prompting-strategies

- **Always include few-shot examples**
- **Positive framing over anti-patterns**: "Using examples to show a pattern to follow is more effective than showing an anti-pattern to avoid." Directly contradicts WRONG/RIGHT pairs.
- 2-5 diverse, high-quality examples covering edge cases
- Precision over persuasion; remove rhetorical language; XML tags; temperature 1.0
- "Tell the model what to do rather than what not to do" (68-page 2025 whitepaper)

## 4. Identity/Persona Techniques — Evidence

**Sources:**
- https://www.prompthub.us/blog/role-prompting-does-adding-personas-to-your-prompts-really-make-a-difference
- https://aclanthology.org/2024.acl-long.554.pdf
- https://arxiv.org/html/2311.10054v3

| Factor | Finding |
|---|---|
| Factual accuracy | Persona does NOT improve performance |
| Open-ended/creative | Persona IS highly effective for tone/style |
| Generic vs. specific | Generic ("helpful assistant") ineffective. Specific, detailed, domain-aligned shows improvement |
| Zero-shot reasoning | Role-play prompting: 53.5% → 63.8% (two-stage role-setting + feedback) |
| Newer models | Performance gaps from persona are minimal on newer, more capable models |
| Risk | Demographic personas can surface stereotypes and degrade reasoning |

**Practical recommendation:** Personas work best when (1) specific and domain-aligned, (2) detailed, (3) used for behavioral shaping not accuracy, (4) model is not already highly capable at the task.

**For playbook identity declarations ("You are a scout", "You are an inspector"):** Effective for behavioral shaping (directing attention, thoroughness expectations) but won't improve factual accuracy. Role should be specific and functional, not decorative.

## 5. Positive vs. Negative Instructions

**Sources:**
- https://eval.16x.engineer/blog/the-pink-elephant-negative-instructions-llms-effectiveness-analysis
- https://gadlet.com/posts/negative-prompting/

**Universal consensus (Anthropic, OpenAI, Google):** Positive framing outperforms negative framing.

Mechanism: Token generation selects what comes next, not what to avoid. Negative prompts make unwanted concepts more salient (Ironic Process Theory / "Pink Elephant").

Conversion examples:
- "Don't use mock data" → "Only use real-world data"
- "Avoid creating new files" → "Apply all fixes to existing files"

Exception: Negative constraints remain effective for hard safety limits.

## 6. Tables vs. Prose vs. Examples

**Source:** https://arxiv.org/html/2505.11701 (DMN-Guided Prompting)

| Format | Best For | Evidence |
|---|---|---|
| Decision tables | Complex, multi-criteria, rule-based tasks. 0.91 F1 vs 0.53 for CoT prose (GPT-4o) | Strong |
| Prose | Creative/open-ended tasks, one-off queries | No benchmarks |
| Examples (few-shot) | Format/tone alignment. 2-5 optimal. | Extensive |
| XML structure | Complex prompts with mixed content types | Recommended by all providers |
| Markdown | General-purpose delimiter | Confirmed by OpenAI GPT-4.1 |

Decision tables dramatically outperform prose for precision-critical, rule-based decisions.

## 7. WRONG/RIGHT Example Pairs

**Sources:**
- Google Gemini docs: "Using examples to show a pattern to follow is more effective than showing an anti-pattern to avoid."
- https://arxiv.org/abs/2509.13196 (Over-Prompting Dilemma)

- Risk: Model may pick up the wrong pattern rather than avoiding it
- WRONG examples make undesired patterns more salient
- Over-prompting: "Excessive examples lead to diminished performance"

**Recommendation:** Replace with RIGHT-only examples. If contrast essential, use minimal "Instead of X, prefer Y" where correct pattern dominates.

## 8. Multi-Agent/Multi-Role Prompting

**Sources:**
- https://arxiv.org/html/2502.02533v1 (Multi-Agent Design)
- https://arxiv.org/html/2601.12307v1 (Rethinking Multi-Agent Value)

Role specialization: ~6% average improvement from block-level prompt optimization.

| Task | Multi-Agent | Baseline |
|---|---|---|
| MATH | 84.67% | 71.67% |
| HotpotQA | 69.91% | 57.43% |
| HumanEval | 91.67% | 86.67% |

**Counter-evidence (OneFlow, 2025):** "Longer, more comprehensive system prompts for individual agents and fewer total agents" can match multi-agent systems while reducing cost.

**For playbook (same LLM taking different roles per step):** Role specialization works, but OneFlow suggests a unified prompt with multiple behavioral modes may be equally effective.

## Summary — Technique Validation Matrix

| Playbook Technique | Evidence | Action |
|---|---|---|
| Identity declarations per step | Mixed. Behavioral shaping yes, accuracy no. Newer models treat personality as noise. | Keep if specific/functional. Remove decorative language. |
| WRONG/RIGHT examples | Google advises against. Risk of priming undesired behavior. | Replace with RIGHT-only or "Instead of X, prefer Y". |
| Decision matrices in tables | Strongly supported. 0.91 F1 vs 0.53 for prose. | Keep. Best-evidenced technique. |
| Severity classification | Consistent with structured decision logic benefits. | Keep. |
| Explicit failure conditions | Supported by Anthropic and OpenAI. | Keep. All providers recommend. |
| "Golden rules" structure | Layered, hierarchical structure universally recommended. | Keep. Ensure no contradictions (costs reasoning tokens). |
| Negative instructions | Universal: positive framing outperforms. | Audit and convert to positive framing. |
