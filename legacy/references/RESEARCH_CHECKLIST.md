# Research Checklist

조사 기준: 2026 소스 우선, 부족 시 2025-12부터 역순 확장. 기초 과학(Miller 1956 등)만 예외.

## A. 레포 전수조사

- [x] **GSD (Get Shit Done)** — github.com/gsd-build/get-shit-done + gsd-2
  - Meta-prompting, context engineering, spec-driven development
  - TÂCHES 시스템, auto-loop, context-packet
  - → references/05-repo-audit-gsd.md
- [x] **gstack** — github.com/garrytan/gstack
  - Garry Tan (YC CEO) Claude Code 설정, 28 skills
  - Think → Plan → Build → Review → Test → Ship → Reflect 워크플로우
  - → references/06-repo-audit-gstack.md
- [x] **spec-kit** — github.com/github/spec-kit
  - GitHub 공식 spec-driven development toolkit
  - /specify → /plan → /tasks 워크플로우, AGENTS.md
  - → references/07-repo-audit-speckit.md

## B. Ralph Loop

- [x] Ralph Loop 정확한 명세 (무한 루프 + 가드레일 + spec-driven)
- [x] Ralph Loop 실제 적용 사례 (case studies)
- [x] Ralph Loop vs Reflexion vs Test⇄Implement 비교
- [x] snarktank/ralph 레포 분석
- [x] guardrails.md 패턴 (Sign 시스템) — 공식 Sign 시스템 없음, 분산 암묵적 가드레일
- → references/08-ralph-loop.md

## C. 1단계 — Anthropic 공식 소스 (최우선)

### Claude Code 공식 문서
- [x] Claude Code hooks (pre/post hook 메커니즘) — 20+ events, 4 hook types
- [x] Claude Code skills (스킬 작성 베스트 프랙티스) — Agent Skills 표준, YAML frontmatter
- [x] Claude Code rules (룰 시스템) — 5-tier scope, permission syntax
- [x] Claude Code memory (메모리 시스템) — CLAUDE.md + auto memory dual system
- [x] Claude Code sub-agents (Explore, Plan, Task 등) — custom agents, isolation, persistent memory

### Anthropic Engineering Blog (2026)
- [x] Context Engineering for AI Agents (최신 버전) — 4 components, just-in-time retrieval, compaction
- [x] Harness Engineering / Effective Harnesses — 3-agent arch, sprint contracts, Opus 4.6 simplification
- [x] Building Effective Agents (2026 업데이트 여부) — 5 workflow patterns
- [x] Claude 4.6 Best Practices — adaptive thinking, effort parameter, overtriggering

### Anthropic Cookbook
- [x] 에이전트 패턴 예제 — 5 patterns implemented as notebooks
- [x] 프롬프트 엔지니어링 가이드 — research_lead_agent.md
- → references/09-anthropic-official-2026.md

## D. 2단계 — 학술/공식 교차 검증 (2026 기준)

### arXiv 2026 (2601~2603)
- [x] 프롬프트 엔지니어링 논문 — Diffusion prompt opt (2602.18449), RL-ZVP (2509.21880), ACE context eng (2510.04618)
- [x] 에이전트 아키텍처 논문 — 6-dim taxonomy (2601.12560), 329-paper survey (2503.21460), Agent Skills (2602.12430, 26.1% 취약점)
- [x] 컨텍스트 관리 논문 — Memory vs long-context (2603.04814, 10-turn crossover), ACON compression (2510.00615), AgeMem (2601.01885)
- [x] 하네스/가드레일 논문 — AgentSpec DSL (2503.18666, ICSE 2026), Guardrails-as-Infrastructure (2603.18059)

### 학회 2026
- [x] ICLR 2026 proceedings — FeatureBench (Claude 4.5 Opus 11%), ABC-Bench, SwingArena
- [x] ACL 2026 — 미발표, SURGeLLM workshop 승인

### 타 벤더 공식 (교차 검증용)
- [x] OpenAI GPT-5 Prompting Guide / Agents SDK 2026 — 3 primitives (Agent/Handoff/Guardrail), MCP 통합
- [x] Google Gemini 3 Prompting Guide / ADK 2026 — Workflow agents, graph-based orchestration
- → references/10-academic-vendor-2026.md

## E. 3단계 — 주요 인물 포스트 (보충)

### 최우선
- [x] Andrej Karpathy — AutoResearch loop, 80% agent coding, Karpathy Loop 패턴
- [x] Harrison Chase — "Everything's context engineering", harness > model, Deep Agents
- [x] Simon Willison — Context taxonomy (quarantine/pruning/summarization/plumbing), Grep Tax

### 높음
- [x] Lilian Weng — 2026 신규 포스트 없음 (2023 agent survey 여전히 참조)
- [x] Alex Albert / Amanda Askell — Initiative inversion, Claude constitution 30K words, virtue ethics
- [x] Addy Osmani — Conductor→Orchestrator, 80% problem, Factory Model, testing = differentiator
- [x] Hamel Husain — 2-phase eval, transition failure matrices, first failure = highest ROI

### 보통
- [x] Eugene Yan — Anthropic 합류, MCP servers as power-ups
- [x] Chip Huyen — AI Engineering 책 (2025), agent failure taxonomy
- [x] Jason Liu — Context engineering series, context pollution, subagent isolation
- [x] swyx / Latent Space — "Scaling without Slop", AI Kino
- [x] Ethan Mollick — Models/Apps/Harnesses framework, managing AIs
- [x] Shreya Rajpal — Guardrails AI, minimal 2026 content
- [x] Nathan Lambert — Multi-model workflow, "don't micromanage agents"
- → references/11-key-figures-2026.md

## F. pyreez 기존 자료 재감사

- [x] WORKER_PROMPTING_DEPTH.md — 7 2026 sources (harness eng, OPENDEV, caching, vendor guides)
- [x] PROMPT_ENGINEERING_REFERENCE.md — 10 2026 sources (Instruction Gap, skill authoring, hooks)
- [x] ADVANCED_OPTIMIZATION_REFERENCE.md — 3 2026 sources (Dunning-Kruger, cache opt, ACE)
- [x] INTERACTION_TECHNIQUE_RESEARCH.md — 6 2026 sources (MAD debate cluster, CHI 2026)
- [x] MULTI_MODEL_INTERACTION_REFERENCE.md — 6 2026 sources (DAR, AdaptOrch, biased agents)
- → references/12-pyreez-2026-extract.md

## G. 조사 영역 매트릭스

| 영역 | 소스 카테고리 | 상태 |
|------|-------------|------|
| 프롬프트 엔지니어링 | C, D, E, F | **완료** |
| 컨텍스트 엔지니어링 | C, D, E, F | **완료** |
| 하네스 엔지니어링 | C, D, E, F | **완료** |
| 스킬/룰 설계 | A, C | A+C 완료 |
| 워크플로우 패턴 | A, B, C | A+B+C 완료 |
| Ralph Loop | B | B 완료 |
