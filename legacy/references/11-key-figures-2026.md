# Key AI/ML Figures: 2026 Posts on Agentic Coding & Context Engineering

Research conducted: 2026-03-30
Coverage period: January--March 2026

---

## HIGHEST PRIORITY

### 1. Andrej Karpathy

**2026 Content Found: Yes (significant)**

#### Posts & Content

- **X/Twitter thread on coding workflow shift** (early 2026)
  URL: https://x.com/karpathy/status/2015883857489522876
  Karpathy went from 80% manual coding / 20% agents (Nov 2025) to 80% agent coding / 20% edits+touchups. Tab-completion (Cursor) remains ~75% of daily LLM assistance; writing concrete code/comments yourself is "high-bandwidth task specification" to the LLM.

- **X/Twitter thread on diversifying LLM workflows** (2025-12 / early 2026)
  URL: https://x.com/karpathy/status/1959703967694545296
  Rather than one perfect tool, usage is diversifying across workflows stitched together by pros/cons.

- **AutoResearch project** (March 2026)
  GitHub: https://github.com/karpathy/autoresearch
  Fortune coverage: https://fortune.com/2026/03/17/andrej-karpathy-loop-autonomous-ai-agents-future/
  A 630-line Python script that runs an autonomous agent loop: edit training script -> run time-boxed experiment -> measure metric -> keep or discard -> repeat. Ran 700 experiments in 2 days, found 20 optimizations, achieved 11% training speed improvement on a larger model.

- **2025 Year in Review / 2026 predictions** (blog)
  URL: https://karpathy.bearblog.dev/year-in-review-2025/
  Predicts 2026 as year of the "slopacolypse" -- AI-generated slop across GitHub, arXiv, Twitter, all digital media.

#### Key Insights

- **The Karpathy Loop**: Agent + modifiable code + single measurable metric + fixed time limit per iteration. The three essential elements for autonomous research agents.
- **Agent swarms**: Vision of "asynchronously massively collaborative" agent swarms exploring parallel optimizations -- emulating a research community, not a single researcher.
- **Phase shift**: LLM agent capabilities (Claude & Codex) crossed a "threshold of coherence" around Dec 2025, causing a fundamental shift in software engineering.
- **Role bifurcation**: LLM coding splits engineers into those who primarily liked coding vs. those who primarily liked building.

---

### 2. Harrison Chase (LangChain)

**2026 Content Found: Yes**

#### Posts & Content

- **Sequoia podcast: "Context Engineering Our Way to Long-Horizon Agents"** (2026)
  URL: https://sequoiacap.com/podcast/context-engineering-our-way-to-long-horizon-agents-langchains-harrison-chase/
  Deep dive on how context engineering -- not just better models -- is fundamental to agent success.

- **Deep Agents announcement** (2026)
  URL: https://opendatascience.com/harrison-chase-on-deep-agents-the-next-evolution-in-autonomous-ai/
  "LangGraph is the runtime. LangChain is the abstraction. Deep Agents are the harness."

- **Interrupt 2026 conference** -- May 13-14, 2026
  URL: https://interrupt.langchain.com/

#### Key Insights

- **"Everything's context engineering"**: Agents running in loops create unpredictable context at each step; visibility into what the agent sees at each decision point is critical.
- **Compaction strategies**: Summarize interactions while storing full details in file systems for later retrieval.
- **File system integration**: Give agents persistent storage to manage context without flooding the LLM's immediate window.
- **Subagent orchestration**: Requires hundreds of lines of careful prompt engineering to ensure subagents communicate results back to parent agents effectively.
- **Harness > model**: "Harnesses are as important as model quality for agent reliability."
- **LLM self-directed context**: The trend is giving the LLM itself more control over its own context engineering -- letting it decide what it sees and what it doesn't.

---

### 3. Simon Willison

**2026 Content Found: Yes (significant)**

#### Posts & Content

- **"Agentic Engineering Patterns" guide** (February 23, 2026)
  URL: https://simonwillison.net/2026/Feb/23/agentic-engineering-patterns/
  Substack: https://simonw.substack.com/p/agentic-engineering-patterns
  A living guide (updated over time) collecting coding practices for agents like Claude Code and OpenAI Codex.

- **"Structured Context Engineering for File-Native Agentic Systems"** (February 9, 2026)
  URL: https://simonwillison.net/tags/context-engineering/
  Reviews a paper with 9,649 experiments across 11 models and 4 file formats with schemas from 10 to 10,000 tables.

- **Agent definition post**
  URL: https://simonw.substack.com/p/i-think-agent-may-finally-have-a
  "An LLM agent is one that runs tools in a loop to achieve a goal."

#### Key Insights

- **Context taxonomy**: Willison defined a precise vocabulary for context management:
  - **Context Quarantine**: Isolating contexts in dedicated threads (used by Claude Code, Anthropic multi-agent research).
  - **Context Pruning**: Removing irrelevant information from context.
  - **Context Summarization**: Condensing accrued context into summaries.
  - **Context Plumbing**: Engineering to move context where it needs to be at the right time.
- **The Grep Tax**: Unfamiliar formats (e.g., TOON) cause models to consume 740% more tokens than YAML at 10K tables. Format selection matters enormously for token efficiency.
- **Agentic engineering vs. vibe coding**: Professional practitioners amplify expertise with agents; vibe coding skips design, specs, and architecture.
- **Red/Green TDD**: Test-first development as a pattern for improving agent-generated code quality with minimal additional prompting.
- **"Writing code is cheap now"**: The cost of initial working code has dropped to near zero, shifting the value to architecture, specification, and review.

---

## HIGH PRIORITY

### 4. Lilian Weng

**2026 Content Found: No new 2026 posts identified**

Her foundational 2023 post "LLM Powered Autonomous Agents" (Agent = LLM + memory + planning + tool use) at https://lilianweng.github.io/posts/2023-06-23-agent/ remains the most-cited reference. No new 2026 survey or blog post found on lilianweng.github.io as of this research date.

---

### 5. Alex Albert & Amanda Askell (Anthropic)

**2026 Content Found: Yes**

#### Alex Albert

- **"Boundary between prompting model and model prompting you going to get blurry in 2026"** (early 2026)
  URL: https://officechai.com/ai/boundary-between-you-prompting-model-and-the-model-prompting-you-going-to-get-blurry-in-2026-anthropics-alex-albert/
  AI systems running 24/7, coming to humans only when they need assistance or subjective decisions. The model prompts; humans decide. The model suggests; humans choose. It acts within boundaries humans set.

- **Signaling "Claude Code experience for all knowledge workers"** (2026)
  URL: https://x.com/daniel_mac8/status/2005698996749090867

#### Amanda Askell

- **Claude's Constitution / "Soul" document** (January 2026)
  URL: https://www.resultsense.com/news/2026-02-10-anthropic-philosopher-amanda-askell-teaches-claude-morals
  Published a ~30,000-word manual -- Claude's "soul" -- the latest version of Claude's constitution addressing growing capabilities and emerging risks.

- **Medium analysis of constitution and persona selection** (March 2026)
  URL: https://medium.com/@izayohi/anthropics-constitution-amanda-askell-and-the-problem-the-persona-selection-model-can-t-solve-f4b0cd33d32a

#### Key Insights

- **Inversion of initiative**: Moving from human-prompts-model to model-prompts-human. Agents run continuously; humans provide oversight on demand.
- **Virtue ethics over rules**: Rather than prohibitions, train character traits (curiosity, honesty, intellectual humility) via RLHF.
- **Prompt caching for examples**: Examples are the #1 prompting technique; prompt caching solves the cost/latency problem of including many examples.

---

### 6. Addy Osmani

**2026 Content Found: Yes (prolific)**

#### Posts & Content

- **"Agentic Engineering"** (2026)
  URL: https://addyosmani.com/blog/agentic-engineering/

- **"The Future of Agentic Coding: Conductors to Orchestrators"** (2026)
  URL: https://addyosmani.com/blog/future-agentic-coding/
  Also published via O'Reilly Radar: https://www.oreilly.com/radar/conductors-to-orchestrators-the-future-of-agentic-coding/

- **"The 80% Problem in Agentic Coding"** (2026)
  URL: https://addyo.substack.com/p/the-80-problem-in-agentic-coding

- **"The Factory Model: How Coding Agents Changed Software Engineering"** (2026)
  URL: https://addyosmani.com/blog/factory-model/

#### Key Insights

- **Conductor vs. Orchestrator paradigm**:
  - Conductor: Tight feedback loops with one agent (synchronous, micro-scope, IDE-based).
  - Orchestrator: Dispatch multiple autonomous agents concurrently (asynchronous, macro-scope, persistent branches/PRs).
- **Testing as the differentiator**: "The single biggest differentiator between agentic engineering and vibe coding is testing. With a solid test suite, an AI agent can iterate in a loop until tests pass."
- **The Factory Model**: You're no longer writing code -- you're building the factory that builds your software (fleets of agents).
- **The 80% Problem**: 90% accuracy is fine for non-critical work but nowhere close for the parts that actually matter. The last 10% is where human expertise remains essential.
- **Virtuous cycle**: Better specs -> better AI output -> cleaner architecture -> fewer hallucinations -> better specs.
- **Fundamentals matter more**: Deep understanding of system design, security, and performance becomes essential to review and guide AI output.

---

### 7. Hamel Husain

**2026 Content Found: Yes**

#### Posts & Content

- **"LLM Evals: Everything You Need to Know" (FAQ)** (January 15, 2026)
  URL: https://hamel.dev/blog/posts/evals-faq/
  PDF: https://hamel.dev/blog/posts/evals-faq/evals-faq.pdf

- **"Evals Skills for Coding Agents"** (2026)
  URL: https://hamelhusain.substack.com/p/evals-skills-for-coding-agents
  A plugin distilling lessons from helping 50+ companies and teaching 4,000+ students build evaluation systems.

#### Key Insights

- **Two-phase agent evaluation**:
  1. End-to-end task success: Treat agent as black box, measure "did we meet user's goal?"
  2. Step-level diagnostics: Diagnose tool selection, parameter extraction, error recovery, context retention.
- **Transition failure matrices**: Map last successful state vs. first failure to prioritize high-impact debugging.
- **Six critical eval skills**: Error analysis, synthetic data generation, judge prompt design, evaluator validation (TPR/TNR), RAG evaluation, review interfaces.
- **Start with `eval-audit`**: Diagnostic checks across error analysis, evaluator design, judge validation, human review, labeled data, pipeline hygiene.
- **Domain-specific over generic**: A chatbot claiming "your plan includes free returns" (factual hallucination) differs from "I've canceled your order" (action hallucination). Generic scores obscure critical failures.
- **First failure = highest ROI**: In any trace, the first failure point is typically the most impactful fix.

---

## NORMAL PRIORITY

### 8. Eugene Yan

**2026 Content Found: Partial (role at Anthropic, limited new blog posts)**

Eugene Yan is now a Member of Technical Staff at Anthropic. His most relevant recent content is from late 2025, covering:
- MCP servers as "power-ups" via `.mcp.json` so the whole team gets the same agentic capabilities.
- Git + GitHub ergonomics: install `gh` and let Claude draft commit messages, open PRs, resolve rebases.
- Automating simple agentic workflows with Amazon Q CLI, Anthropic MCP, and tmux.

No major new 2026 blog post identified on eugeneyan.com as of this research.

---

### 9. Chip Huyen

**2026 Content Found: Indirect (book published late 2025, still top resource in 2026)**

Her book *AI Engineering* (O'Reilly, 2025) remains the most-read book on the O'Reilly platform. Key agent framework from the book:
- **Decouple planning from execution**: Generate plan -> validate -> execute -> reflect.
- **Control flow patterns**: Sequential, parallel, conditional (routing), loops.
- **Planning granularity trade-off**: High-level (natural language) vs. low-level (function-specific).
- **ReAct pattern**: Interleave reasoning, action, observation until completion.
- **Failure taxonomy**: Invalid tools, wrong parameters, goal failures, reflection errors, tool output errors.
- URL: https://huyenchip.com/2025/01/07/agents.html

No new 2026-specific blog post identified.

---

### 10. Jason Liu (jxnl)

**2026 Content Found: Indirect (context engineering series from late 2025, ongoing)**

#### Posts & Content

- **Context Engineering Series** (2025 Q3, still actively referenced)
  Index: https://jxnl.co/writing/2025/08/28/context-engineering-index/

- **"Beyond Chunks: Why Context Engineering is the Future of RAG"**
  URL: https://jxnl.co/writing/2025/08/27/facets-context-engineering/

- **"Slash Commands vs Subagents"**
  URL: https://jxnl.co/writing/2025/08/29/context-engineering-slash-commands-subagents/

- **"Rapid Agent Prototyping"**
  URL: https://jxnl.co/writing/2025/09/04/context-engineering-rapid-agent-prototyping/

#### Key Insights

- **Context engineering for agents**: Designing tool responses and interaction patterns that give agents situational awareness, not just data chunks.
- **Four levels of context richness**: Minimal chunks -> chunks with metadata -> multi-modal content -> facets with query refinement.
- **Context pollution**: When reasoning context gets flooded with irrelevant but computationally cheap information.
- **Subagents as context isolation**: Specialized workers handle messy token-intensive tasks in isolation, returning only distilled insights to the main reasoning thread.

---

### 11. swyx / Latent Space

**2026 Content Found: Yes**

#### Posts & Content

- **"Scaling without Slop"** (2026 outlook post)
  URL: https://www.latent.space/p/2026

#### Key Insights

- **Central thesis**: "The most important problem in media now is scaling without slop" -- maintaining quality while increasing output.
- **AI Kino**: If you creatively/skillfully wield AI as "a new brush," high-quality AI-assisted output is possible.
- **Curation at scale**: Success depends on "curating very well, then scaling one person's curation to many."
- **Changing the slope of slop**: Focus on improving the quality-to-quantity ratio, not accepting AI slop as inevitable.
- Expanding AI Engineer conference series to 7+ events globally in 2026.

---

### 12. Ethan Mollick

**2026 Content Found: Yes**

#### Posts & Content

- **"A Guide to Which AI to Use in the Agentic Era"** (2026)
  URL: https://www.oneusefulthing.org/p/a-guide-to-which-ai-to-use-in-the

- **"Real AI Agents and Real Work"** (2026)
  URL: https://www.oneusefulthing.org/p/real-ai-agents-and-real-work

#### Key Insights

- **Models / Apps / Harnesses framework**: Three distinct components to evaluate when choosing AI tools.
  - Models: The underlying intelligence (GPT-5.2/5.3, Claude Opus 4.6, Gemini 3 Pro).
  - Apps: The products you use (ChatGPT, Claude.ai, etc.).
  - Harnesses: Systems enabling multi-step autonomous tool use. Same model behaves differently in different harnesses.
- **"An AI that does things" > "an AI that says things"**: Fundamentally more useful.
- **Managing AIs, not working with AIs**: Late 2025 marked a shift to managing agents (Claude Code, Codex, OpenClaw) that return reasonable results in minutes.
- **Software Factories**: A three-person team at StrongDM built a Software Factory using AI agents to write, test, and ship production software without human involvement.

---

### 13. Shreya Rajpal

**2026 Content Found: Minimal**

Shreya Rajpal continues as CEO/Cofounder of Guardrails AI (11 employees as of Jan 2026). The open-source guardrails framework remains the #1 open-source generative AI guardrails framework. She published a DeepLearning.AI short course on "Safe and Reliable AI via Guardrails."

No specific 2026 blog post or article with novel techniques identified.

---

### 14. Nathan Lambert

**2026 Content Found: Yes**

#### Posts & Content

- **"Get Good at Agents"** (2026)
  URL: https://www.interconnects.ai/p/get-good-at-agents

- **"Use Multiple Models"** (2026)
  URL: https://www.interconnects.ai/p/use-multiple-models

- **Lex Fridman podcast appearance** (February 2026)

- **RLHF Book** (Manning, publication date: July 28, 2026)

#### Key Insights

- **Don't micromanage agents**: Give agents substantial, ambitious projects and let them work asynchronously. Micromanaging is counterproductive.
- **Multi-model workflow**: GPT 5 Pro for planning/strategy, Claude Code with Opus 4.5 for implementation, pass information between them when stuck.
- **"Agents push humans up the org chart"**: Every engineer needs to learn system design; every researcher needs to learn to run a lab.
- **Reshape work to fit the agent**: "I'd rather do my work if it fits the Claude form factor, and soon I'll modify my approaches so that Claude will be able to help."
- **Focus > hard work**: "Being good at using AI today is a better moat than working hard." Effectiveness requires cultivating focus and peaceful mental space for direction-setting.

---

## SYNTHESIS: Cross-Cutting Themes

### Theme 1: The Shift from Implementation to Orchestration

Nearly every figure describes the same fundamental role change:
- Karpathy: 80% agent coding, 20% touchups
- Osmani: "Implementer to orchestrator"
- Lambert: "Agents push humans up the org chart"
- Mollick: "Managing AIs, not working with them"
- Chase: Harness engineering as the new discipline

### Theme 2: Context Engineering as the Core Discipline

Context engineering has emerged as the successor to prompt engineering:
- Chase: "Everything's context engineering" -- agents create unpredictable context at each step
- Willison: Defined a taxonomy (quarantine, pruning, summarization, plumbing)
- Liu: Context pollution and subagent isolation as context management patterns
- Albert: The prompting/prompted boundary is dissolving

### Theme 3: Testing and Evaluation as the Critical Differentiator

- Osmani: Testing is "the single biggest differentiator between agentic engineering and vibe coding"
- Husain: Two-phase evaluation (end-to-end + step-level), transition failure matrices, domain-specific evals
- Karpathy: Single measurable metric + fixed time limits = autonomous improvement loops
- Willison: Red/green TDD as an agentic engineering pattern

### Theme 4: Multi-Agent and Asynchronous Workflows

- Osmani: Conductor (synchronous, single agent) vs. Orchestrator (asynchronous, multi-agent)
- Karpathy: Agent swarms for "asynchronously massively collaborative" research
- Chase: Subagent orchestration with careful context engineering between parent/child agents
- Lambert: Multi-model workflows (different models for different strengths)

### Theme 5: Specifications and Architecture Over Code

- Osmani: "Better specifications yield better AI output" -- virtuous cycle
- Willison: "Writing code is cheap now" -- value shifts to architecture and review
- Karpathy: Writing concrete code/comments = high-bandwidth task specification
- Huyen: Decouple planning from execution; validate plans before running them

### Theme 6: The Harness Is as Important as the Model

- Chase: "Harnesses are as important as model quality for agent reliability"
- Mollick: Models / Apps / Harnesses -- same model behaves differently in different harnesses
- Husain: Infrastructure-focused evaluation over solely model improvement
- Osmani: The factory model -- build the factory that builds your software

### Theme 7: Human Expertise Becomes More Important, Not Less

- Osmani: "Fundamentals matter more, not less" -- system design, security, performance
- Lambert: Decision-making capability in research/design/product is the differentiating skill
- Mollick: "An AI that does things" still requires human judgment on what to do
- Askell: Virtue ethics and character training require deep philosophical expertise
