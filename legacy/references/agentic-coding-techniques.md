# Agentic Coding Techniques — 2026 전수조사

조사일: 2026-03-30. 바이브코딩/에이전틱 코딩에서 사용되는 명명된 기법, 패턴, 방법론 전수조사.

**조사 현황**: 1차 완료. 추가 발견 기법 반영 (2차 확장).

## A. 워크플로우 방법론

### A1. Ralph Loop (Geoffrey Huntley, 2025 여름 → 2026 확산)
- **핵심**: `while :; do cat PROMPT.md | claude-code ; done` — 무한 루프, 매 반복 새 컨텍스트
- **상태 관리**: prd.json (태스크 추적), progress.txt (학습 누적), git (코드 보존)
- **종료 조건**: `<promise>COMPLETE</promise>` 문자열 매칭
- **Sign 시스템**: 실패 경험을 guardrails.md에 기록 → 미래 반복이 읽음
- **한계**: 그린필드 전용, 스펙 품질이 병목, 주관적 태스크 실패
- 출처: ghuntley.com/ralph, github.com/snarktank/ralph, ralph-wiggum.ai

### A2. RPI → QRSPI (Dex Horthy / HumanLayer, 2025 → 2026)
- **RPI**: Research → Plan → Implement — 브라운필드 코드베이스용 에이전틱 워크플로우
- **QRSPI**: Questioning → Research → Structure → Plan → Implement — RPI의 진화
  - **Q (Questioning)**: 멀티에이전트 질문으로 설계 결정을 옵션으로 표면화 (Q1: A or B or C?)
  - **S (Structure)**: 필수 단계화 — 에이전트가 단계별 분해를 강제 생성
- **핵심 철학**: "메가프롬프트를 진짜 분리된 에이전틱 스텝으로 쪼개라"
- 출처: betterquestions.ai, linearb.io/blog/dex-horthy-humanlayer-rpi-methodology-ralph-loop

### A3. Spec-Driven Development (SDD) (GitHub, AWS Kiro, 2025-2026)
- **원칙**: 스펙이 진실의 원천, 코드는 생성된 산출물
- **spec-kit**: /specify → /plan → /tasks → /implement (GitHub 공식)
- **Kiro**: requirements.md (EARS 표기) → design.md → tasks.md (AWS 공식 IDE)
- **EARS 표기법**: Easy Approach to Requirements Syntax — 자연어 → 구조화된 요구사항
- **3단계 엄격도**: spec-first, spec-anchored, spec-as-source
- 출처: github.com/github/spec-kit, kiro.dev, arxiv.org/abs/2602.00180

### A4. BMAD Method (Breakthrough Method for Agile AI-Driven Development)
- **핵심**: 명명된 AI 페르소나가 SDLC 전체를 담당
  - Mary (BA), Preston (PM), Winston (아키텍트), Sally (PO), Simon (SM), Devon (개발자)
- **워크플로우**: Analysis → Planning → Solutioning → Implementation
- **Party Mode**: 여러 페르소나를 한 세션에서 동시 호출 (다중 관점)
- **규모**: 34+ 워크플로우, 5개 모듈 (BMM, BMB, TEA, BMGD, CIS)
- 출처: github.com/bmad-code-org/BMAD-METHOD (37K+ 스타)

### A5. GSD (Get Shit Done by TÂCHES, 2025-2026)
- **v1**: 프롬프트 주입 프레임워크 (Command → Workflow → Agent 3계층)
  - discuss → plan → execute → verify → ship (6단계 순환)
- **v2**: Pi SDK 기반 독립 CLI, 상태 머신 + 워크트리 격리
  - Milestone → Slice → Task 계층, auto-loop 상태 머신
- **Dream Extraction**: "프로젝트 초기화는 요구사항 수집이 아니라 꿈의 추출"
- 출처: github.com/gsd-build/get-shit-done, github.com/gsd-build/gsd-2

### A6. gstack (Garry Tan / YC, 2026)
- **구조**: 29개 스킬 = Think → Plan → Build → Review → Test → Ship → Reflect
- **Boil the Lake**: AI가 있으면 완전한 버전을 만들어라 (지름길 금지)
- **Fix-First**: 리뷰에서 명확한 건 자동 수정, 모호한 것만 질문
- **Iron Law**: "근본 원인 조사 없이 수정 금지"
- **WTF Heuristic**: 리버트+15%, 3파일 이상 수정+5%, 무관 파일+20% → 20%에서 중단
- 출처: github.com/garrytan/gstack (50K+ 스타)

### A7. Open Spec (Ralph + SDD 통합)
- Ralph Loop의 반복 실행력 + SDD의 구조적 스펙을 결합
- 2026년 최상위 팀은 둘 중 하나가 아닌 통합 워크플로우 사용
- 출처: redreamality.com/blog/ralph-wiggum-loop-vs-open-spec

## B. 컨텍스트 엔지니어링 기법

### B1. Fresh Context / Context Reset (Ralph Loop 핵심)
- 매 반복마다 에이전트를 종료하고 새로 시작 — 컨텍스트 오염 방지
- "malloc/free 문제": LLM은 malloc만 있고 free가 없다 → 프로세스를 죽여라
- 상태는 디스크(파일, git)에 보존

### B2. Frequent Intentional Compaction / FIC (HumanLayer ACE)
- 컨텍스트 활용률 40-60% 유지가 최적
- 연구 → 계획 → 구현 각 단계에서 다음 단계에 필요한 컨텍스트만 전달
- "2000줄 코드 대신 200줄 스펙 + 200줄 계획을 리뷰"
- 출처: github.com/humanlayer/advanced-context-engineering-for-coding-agents

### B3. Layered Memory Architecture (GSD v2)
- L1: Working Context (8-25k) — 현재 태스크 + 관련 파일
- L2: Session/Episodic — 압축된 히스토리 + 최근 결정
- L3: Project Semantic — 코드베이스 요약, 의존성 그래프, ADR
- L4: Ground Truth — 실제 파일, git 히스토리, 테스트 결과 (프롬프트에 0 토큰)

### B4. Context Pressure Monitor (GSD)
- 35% 남음: WARNING ("복잡한 새 작업 시작하지 마라")
- 25% 남음: CRITICAL ("즉시 중단, 상태 저장")
- 70% 사용 시 wrap-up 신호 (v2)

### B5. Sub-Agent Context Isolation (Anthropic, Claude Code)
- 서브에이전트 = 새 컨텍스트 윈도우에서 검색/분석 실행
- 부모 컨텍스트를 오염시키지 않고 압축된 요약만 반환
- 출처: simonwillison.net/guides/agentic-engineering-patterns/subagents

### B6. Context Packet (GSD v1)
- 각 워크플로우 단계가 생산하는 아티팩트를 다음 단계에 정확히 전달
- `gsd-tools.cjs init <workflow>` — 관련 컨텍스트를 JSON 페이로드로 로드

### B7. Preamble Tiers (gstack)
- preamble-tier 1-4로 스킬별 컨텍스트 양을 조절
- 가벼운 스킬(browse=1) vs 무거운 스킬(ship=4)

### B8. ELI16 Mode (gstack)
- 3+ 세션 동시 실행 감지 시 활성화
- 모든 질문에 프로젝트, 브랜치, 컨텍스트를 재확인

### B9. Steering Files (Kiro)
- `.kiro/steering/` — 프로젝트 지식을 마크다운으로 영속화
- 기술 스택, 파일 구조, 코딩 패턴 — 세션 간 생존

## C. 하네스 엔지니어링 기법

### C1. Sign System / Guardrails.md (Ralph Loop)
- 에이전트가 실패를 경험하면 "Sign"을 guardrails.md에 기록
- 구조: Trigger (언제), Instruction (어떻게 방지), Reason (왜), Provenance (언제 추가)
- 미래 반복이 먼저 읽어서 같은 실수 방지

### C2. Backpressure Engineering (Ralph + GSD)
- typecheck, lint, test를 게이트로 사용 — 에이전트가 깨진 코드를 커밋 불가
- 결정적 피드백 루프가 자율성을 가능하게 함

### C3. PreToolUse Hooks (gstack, Claude Code)
- Bash 호출 가로채기: rm -rf, DROP TABLE, force-push 경고 (/careful)
- Edit/Write 가로채기: 지정 디렉토리 외 수정 차단 (/freeze)
- JSON stdin → JSON stdout (permissionDecision: ask/deny/allow)

### C4. Agent Hooks (Kiro)
- 파일 저장/생성/삭제 이벤트에 자동 에이전트 액션 트리거
- 이벤트 기반 자동화 — 수동 요청 없이 일관성 유지

### C5. Verification 4-Level (GSD)
- Exists → Substantive → Wired → Functional
- 스텁 탐지: React 컴포넌트, API 라우트, DB 스키마, 훅/유틸리티별 패턴

### C6. Constitution Pattern (spec-kit)
- 불변 원칙을 모든 단계의 게이트로 강제
- 단순성 게이트, 반추상화 게이트, 통합 우선 게이트
- 설계 전후로 2회 체크

### C7. Stuck Detection (GSD v2)
- 슬라이딩 윈도우 패턴 분석 (단순 카운터가 아님)
- 같은 파일 반복 수정, 같은 에러 반복 등 감지

### C8. Completion Signal Pattern (Ralph)
- `<promise>COMPLETE</promise>` — 정확한 문자열 매칭으로 완료 판단
- LLM의 자기 평가가 아닌 외부 검증으로 완료 확인

### C9. Max-Iterations Safety Valve (Ralph, GSD)
- 무한 루프 방지: 소규모 10, 중규모 20-30, 대규모 30-50
- 반드시 상한 설정

### C10. Crash Recovery (GSD v2)
- 락파일 기반 상호 배제, 세션 파일, 헤드리스 자동 재시작
- 프로바이더 에러 복구 (rate limit → 자동 재개, 서버 에러 → 자동 재개, 영구 에러 → 일시정지)

## D. 프롬프트 엔지니어링 기법

### D1. Dream Extraction (GSD)
- "프로젝트 초기화 = 인터뷰가 아닌 꿈의 추출"
- 열린 질문으로 시작, 에너지를 따라가고, 모호함에 도전, 추상을 구체화
- 반패턴: 체크리스트 순회, 정형화된 질문, 기술 경험 질문

### D2. Anti-Sycophancy Rules (gstack /office-hours)
- "interesting approach" 금지, 항상 입장을 취하라, 가장 강한 버전에 도전하라
- 구체적 반박 패턴을 worked example로 제공

### D3. Confidence Calibration (gstack)
- 모든 발견에 1-10 신뢰도 점수 부여
- 7+: 정상 표시, 5-6: 경고와 함께, <5: 억제

### D4. Fix-First Methodology (gstack /review)
- 리뷰에서 명확한 기계적 이슈는 자동 수정
- 진짜 모호한 것만 질문 — AUTO-FIX vs ASK 분류

### D5. Iron Law of Investigation (gstack /investigate)
- "근본 원인 조사 없이 수정 금지"
- 데이터 흐름 추적 → 가설 수립 → 검증
- 3번 실패 시 중단 (3-strike rule)

### D6. WTF Heuristic (gstack /qa)
- 위험도 누적: 리버트+15%, 3파일 이상+5%, 무관 파일+20%
- 50 수정 하드캡, 20%에서 중단 후 질문

### D7. Boil the Lake (gstack)
- "AI가 있으면 완전한 버전을 만들어라"
- Lake (100% 커버리지, 달성 가능) vs Ocean (다분기 마이그레이션, 불가)
- "지름길이 사람-시간만 절약하고 AI-시간은 분 단위면, 완전판을 만들어라"

### D8. Forced Uncertainty Marking (spec-kit)
- `[NEEDS CLARIFICATION: 구체적 질문]` — LLM이 모르는 건 추측 대신 마킹
- 최대 3개 제한으로 과도한 질문 방지

### D9. Ultrathink (Claude Code)
- "ultrathink" 키워드로 ~32K 토큰 추론 공간 부여
- Phase 1: ultrathink로 고수준 계획 → Phase 2: think/think hard로 실행

### D10. Persona Consistency (gstack, BMAD)
- 스킬별 특정 페르소나 + 보이스 지침
- "지금 일어나는 일을 서술하라", "질문 전에 이유를 설명하라"

### D11. Escape Hatch (gstack)
- 다중 질문 스킬에서 조급한 사용자를 위한 탈출구
- 첫 번째 거부: "두 개만 더", 두 번째 거부: 즉시 진행

### D12. Single-Task Constraint (Ralph)
- "한 번에 하나의 태스크만" — 스코프 폭발 방지
- 각 반복이 PRD에서 하나의 스토리만 선택

### D13. Embedded Promise Pattern (Ralph)
- 에이전트에게 "완료 시 <promise>COMPLETE</promise> 출력하라"고 명시
- 도구 출력 파싱이 아닌 정확한 문자열 매칭

## E. 품질 게이트 기법

### E1. Red-Green TDD for Agents (Simon Willison, alexop.dev)
- "테스트 먼저 작성 → 실패 확인 → 구현 → 통과 확인"
- 에이전트에 TDD 강제 시 별도 컨텍스트 필요 (하나의 윈도우에서 TDD 불가)
- Claude Code Skills + Hooks로 엄격한 Red-Green-Refactor 순환 강제
- 출처: simonwillison.net/guides/agentic-engineering-patterns/red-green-tdd

### E2. Two-Pass Review (gstack /review)
- Pass 1 (Critical): SQL 안전, 레이스 컨디션, LLM 신뢰 경계, enum 완전성
- Pass 2 (Informational): 나머지 모든 것

### E3. Review Readiness Dashboard (gstack /ship)
- 어떤 리뷰가 실행되었는지 추적 (review-log)
- 선적 전 모든 리뷰 상태를 대시보드로 표시

### E4. Quality Gates 8-Question (GSD v2)
- Q3: 위협 표면 (악용 시나리오, 데이터 노출)
- Q4: 요구사항 영향 (재검증 필요 항목)
- Q5: 실패 모드 (에러/타임아웃 처리)
- Q6: 부하 프로파일 (10x 중단점 보호)
- Q7: 네거티브 테스트 (잘못된 입력, 에러 경로)

### E5. Checklist Gate (spec-kit)
- 각 단계 완료 전 checklists/ 파일 스캔
- 불완전하면 STOP → 사용자 확인 요청

### E6. 3-Tier Test System (gstack)
- Tier 1: 정적 검증 (무료, <5초)
- Tier 2: E2E via `claude -p` (~$3.85, ~20분)
- Tier 3: LLM-as-judge (>=4/5 필요, ~$0.15, ~30초)

### E7. Plan Verification Loop (GSD v1)
- Plan checker가 8차원 검증, 최대 3회 반복
- 교차 단계 회귀 게이트: 이전 단계 테스트 스위트 재실행

## F. Git/격리 기법

### F1. Worktree Isolation (GSD v2, Cursor)
- git worktree로 에이전트별 격리된 작업 공간
- 병렬 에이전트가 서로 간섭하지 않음

### F2. Branch-per-Feature (spec-kit)
- 기능별 브랜치 + 자동 번호 매기기
- 깔끔한 격리 + 추적성

### F3. Atomic Commits (Ralph, gstack)
- 태스크 하나 = 커밋 하나: `feat: [Story ID] - [Story Title]`
- bisectable 히스토리 유지

## G. 학습/메모리 기법

### G1. Learnings JSONL (gstack /learn)
- 유형: pattern, pitfall, preference, architecture, tool
- 신뢰도 1-10, 프로젝트 간 검색 opt-in
- 중복 제거: 같은 key+type의 최신 항목 우선

### G2. Progress.txt Codebase Patterns (Ralph)
- 파일 상단에 "Codebase Patterns" 섹션 통합
- 반복 간 누적 학습 전달

### G3. Self-Improving Skills (GSD v2 계획)
- SkillRL-inspired: 실행 결과에서 스킬 자동 개선
- `/improve-skill`, `/heal-skill` 명령

## H. 테스팅 기법

### H1. JiTTests — Just-in-Time Tests (Meta, 2026-02)
- **핵심**: PR 제출 시 LLM이 해당 변경에 맞춤형 테스트를 즉석 생성 → 실행 → 폐기
- 코드베이스에 상주하지 않음 → 유지보수 비용 제로
- 변경 내용을 알고 생성하므로 "변경되어야 할 행동 vs 변경되지 않아야 할 행동" 추론 가능
- 인간 리뷰 부하 70% 감소 (Meta 내부 데이터)
- 출처: engineering.fb.com/2026/02/11/developer-tools/the-death-of-traditional-testing-agentic-development-jit-testing-revival

### H2. Mutation Testing with LLM (Meta, 2025-09 → 2026)
- LLM으로 코드 변이 생성 → 기존 테스트가 변이를 잡는지 검증
- 컴플라이언스 커버���지 개선에 활용
- 출처: engineering.fb.com/2025/09/30/security/llms-are-the-key-to-mutation-testing-and-better-compliance

## I. 멀티에이전트/병렬 기법

### I1. Claude Code Agent Teams (Anthropic, 2026)
- 팀 리드 + 팀메이트 구조, 각자 독립 컨텍스트 윈도우
- 공유 태스크 리스트: 상태 추적, 의존성, 파일 락킹
- 팀메이트는 직접 P2P 메시징, 태스크 자기 claim
- 최적 팀 크기: 3-5
- 워크트리 격리: 에이전트별 독립 브랜치, 완료 후 순차 병합
- 출처: code.claude.com/docs/en/agent-teams

### I2. Dependency Wave Execution (GSD v1)
- 태스크를 의존성 기반 "파도"로 그룹화
- 같은 파도의 태스크는 병렬 실행, 파도 간은 순차
- 각 executor에 fresh 200k 컨텍스트

### I3. Vertical Slice Decomposition
- 수평 분할 (라우트만, 컨트롤러만) 대신 수직 분할 (전체 엔드포인트)
- "두 에이전트가 같은 파일을 수정해야 하면, 분할이 잘못된 것"
- 입출력 계약 명시, 공유 가변 상태 최소화

### I4. Coordinator-Specialist-Verifier Pattern
- Coordinator: 태스크 분해 + 할당
- Specialist: 독립 구현 (각자 컨텍스트)
- Verifier: 자동 검증 후 병합 승인

## J. 추론/생성 패턴 (LLM 내부)

### J1. ReAct (Reasoning + Acting)
- Thought → Action → Observation 순환
- 실시간 Q&A, 동적 태스크에 적합

### J2. Reflexion (NeurIPS 2023, 여전히 유효)
- 실행 → 테스트 → 실패 → 반성 → 재시��
- 91% pass@1 on HumanEval
- 단일 세션 내 자기 수정

### J3. Plan-and-Execute
- 전체 전략을 먼저 계획 → 순차 실행
- ReAct의 반대: 매 스텝 추론 대신 사전 계획

### J4. Tree of Thoughts (ToT)
- 여러 추론 분기를 병렬 탐색
- 각 분기를 자체 평가 후 최선 선택

### J5. Self-Refine
- 출력 → 자기 비평 → 수정 → 반복
- 에러 포착, 약점 식별, 강점 강화

### J6. Ultrathink / Extended Thinking (Claude Code)
- "ultrathink" 키워드 → ~32K 추론 토큰
- Phase 1: ultrathink로 계획 → Phase 2: think/think hard로 실행
- Claude Code CLI 전용

## K. 프롬프트 캐싱 기법

### K1. Prompt Caching (Anthropic, OpenAI)
- KV 텐서 재사용 — TTFT 최대 80% 감소, 입력 비용 최대 90% 감소
- **정적 내용을 앞에, 동적 내용을 뒤에** 배치
- Anthropic: 개발자 제어 캐시 브레이크포인트 (cache_control)
- OpenAI: 자동 프리픽스 매칭
- 도구 정의 변경 시 캐시 무효화 → 고정 범용 도구 + 동적은 코드 생성으로
- 출처: arxiv.org/html/2601.06007v1, platform.claude.com/docs/en/build-with-claude/prompt-caching

### K2. TTL 전략
- 5분 또는 1시간 TTL (Claude Haiku/Sonnet/Opus 4.5+)
- 에이전틱 루프에서 30-50 도구 호출 시 캐시 활용 극대화

## L. 메모리 ��크 패턴

### L1. Cline Memory Bank
- 구조화된 파일 세트가 프로젝트의 장기 기억 역할
- 코딩 컨벤션, 스펙, 프로젝트 상태 저장
- 변형: cursor-memory-bank, cursor-bank, roo-code-memory-bank
- **한계**: 파일일 뿐이라 에이전트가 무시할 수 있음 (강제 아님)

### L2. Rulebook AI (botingw)
- 크로스 도구 규칙 템플릿 (Copilot, Cursor, Roo Code, Cline, Claude Code 등)
- 메모리 뱅크 + 베스트 프랙티스를 통합 관리

### L3. claude-progress.txt (Anthropic 하네스)
- 에이전트가 fresh 컨텍스트로 시작할 때 작업 상태를 ���르게 파악
- git 히스토리와 함께 사용

## M. 하네스 엔지니어링 심화

### M1. 4 메커니즘 (NxCode 2026)
- Constraining (제한), Informing (정보 제공), Verifying (검증), Correcting (교정)
- 하네스만 변경으로 52.8% → 66.5% 성능 향상 (Terminal Bench)

### M2. Progressive Disclosure (스킬 시스템)
- 에이전트가 필요할 때만 특정 지시/지식/���구에 접근
- 기본 컨텍스트를 가볍게 유지

### M3. Anthropic 하네스 원칙 (2026)
- Constrain → Inform → Verify → Correct → Human-in-the-Loop
- 장기 실행 에이전트: fresh 컨텍스트에서 작업 상태 빠르게 파악하는 메커니즘 필수
- 출처: anthropic.com/engineering/effective-harnesses-for-long-running-agents

### M4. 에이전트 태스크 지속시간 법칙 (2026 데이터)
- AI 태스크 지속시간 7개월마다 2배 증가
- 35분 후 성공률 하락, 지속시간 2배 → 실패율 4배
- 에러 복구가 장기 태스크의 핵심

## N. Anthropic 공식 하네스 패턴 (2026 NEW)

### N1. Three-Agent System (Anthropic, 2026-03-24)
- **Planner**: 1-4 문장 프롬프트를 종합 제품 스펙으로 확장
- **Generator**: 기능을 반복 구현 + 자기 평가
- **Evaluator**: Playwright MCP로 테스트, 하드 임계값으로 채점
- **핵심 발견**: "모델은 자기 작업을 채점할 때 일관되게 긍정 편향" → Generator와 Evaluator 분리 필수
- 비용: 단일 에이전트 $9 (20분) vs 전체 하네스 $200 (6시간) — 20x 비용으로 극적 품질 향상
- 출처: anthropic.com/engineering/harness-design-long-running-apps

### N2. Sprint Contract Pattern (Anthropic, 2026)
- Generator와 Evaluator가 구현 전 "계약" 협상
- 구체적 "완료" 기준 + 테스트 가능한 성공 메트릭 (예: 한 스프린트에 27개 기준)
- **Opus 4.6에서 불필요해짐**: 스프린트 분해 자체가 불필요 → 단일 패스 QA로 대체

### N3. Feature List File as JSON (Anthropic)
- 구조화된 JSON: 카테고리, 다단계 설명, acceptance criteria, boolean `passes`
- JSON > Markdown: "모델이 JSON 파일을 부적절하게 변경하거나 덮어쓸 가능성이 낮음"

### N4. Session Startup Sequence (Anthropic)
1. `pwd`로 디렉토리 확인
2. git 로그 + progress 파일 읽기
3. feature list 읽기 + 다음 기능 선택
4. init.sh로 개발 서버 시작
5. 기본 e2e 검증 실행
6. 집중 기능 작업 시작

### N5. One-Feature-Per-Session (Anthropic)
- 세션당 정확히 하나의 기능만 구현
- 컨텍스트 고갈 방지 → "mid-implementation 컨텍스트 소진"이 주요 실패 원인

### N6. Writer/Reviewer Pattern (Claude Code)
- 세션 A가 구현 → 세션 B가 fresh 컨텍스트로 리뷰
- "자기가 작성한 코드에 대한 편향 없이" 리뷰

### N7. Fan-out Pattern (Claude Code)
- 태스크 리스트 생성 → `claude -p` 루프로 파일별 병렬 실행
- `--allowedTools`로 권한 범위 지정

### N8. Claude Code Auto Mode (2026-03-25 NEW)
- 2계층 방어: 입력(프롬프트 주입 탐지) + 출력(Sonnet 4.6 트랜스크립트 분류기)
- 분류기는 사용자 메시지 + 도구 호출만 봄 (Claude 자체 메시지 제거 → 합리화 방지)
- 3티어: T1 자동(읽기/검색), T2 자동(프로젝트 파일 쓰기), T3 분류기 결정(쉘, 외부)
- FPR 0.4%, FNR 17%, 사용자 수동 승인률 93%

### N9. Delta Debugging with Oracle (Anthropic, 2026-02)
- 16개 병렬 Claude로 C 컴파일러 구축 (100K줄 Rust)
- GCC를 "정답 오라클"로 사용: 파일별로 GCC vs Claude 컴파일러 비교 → 실패 범위 축소
- `current_tasks/` 디렉토리에 git 기반 파일 락킹으로 태스크 조율
- 2B 입력 토큰, 140M 출력 토큰, ~$20,000, 2주

## O. Anthropic 컨텍스트 엔지니어링 공식 5대 기법

### O1. Compaction (압축)
- 컨텍스트 한도 접근 시 대화 히스토리 요약
- 아키텍처 결정, 미해결 버그, 구현 세부사항 보존 / 중복 도구 출력 폐기
- Claude Code: "압축된 컨텍스트 + 최근 접근 5개 파일"로 계속

### O2. Structured Note-Taking (구조화된 메모)
- 에이전트가 컨텍스트 외부에 영속 메모 작성 → 나중에 필요 시 불러옴
- Claude Code: todo-lists, NOTES.md, auto memory

### O3. Sub-Agent Architectures
- 서브에이전트: 수만 토큰 탐색 → 1,000-2,000 토큰 요약 반환
- 메인 에이전트는 종합만

### O4. Just-In-Time Context Retrieval
- 경량 식별자(파일 경로, URL, 쿼리) 유지 → 런타임에 동적 로드
- Claude Code: bash 명령 (head, tail, grep, glob)으로 구현

### O5. Hybrid Strategy
- 일부 데이터 사전 로드 (속도) + 모델 재량으로 자율 탐색
- Claude Code: CLAUDE.md 초기 로드 + just-in-time 파일 검색

### O6. Right Altitude Principle (적정 고도 원칙)
- 너무 경직된 로직 ❌, 너무 모호한 가이드 ❌
- "행동을 효과적으로 안내할 만큼 구체적이지만, 강력한 휴리스틱을 제공할 만큼 유연한" 적정 수준

### O7. Context Rot (컨텍스트 부패)
- 토큰 증가 → 모델 정확도 하락 (하드 클리프가 아닌 성능 그래디언트)
- 트랜스포머 n² 어텐션 → 유한한 "어텐션 예산"

## P. Claude Code 확장 시스템 상세

### P1. Skills 시스템
- [Agent Skills](https://agentskills.io) 오픈 표준 (크로스 플랫폼)
- YAML frontmatter: name, description, allowed-tools, model, effort, context(fork), agent, hooks, paths
- `$ARGUMENTS`, `${CLAUDE_SKILL_DIR}`, `${CLAUDE_SESSION_ID}` 치환
- `` !`command` `` 동적 컨텍스트 주입
- 3단계 progressive disclosure: (1) 메타데이터 항상, (2) SKILL.md 호출 시, (3) 지원 파일 필요 시
- description 예산: 전체 스킬 설명이 컨텍스트 1% (기본 8,000자)
- 번들 스킬: /batch, /debug, /loop, /simplify, /claude-api

### P2. Hooks 시스템 — 25개 이벤트
- SessionStart, InstructionsLoaded, UserPromptSubmit, PreToolUse, PermissionRequest
- PostToolUse, PostToolUseFailure, Notification, SubagentStart, SubagentStop
- TaskCreated, TaskCompleted, Stop, StopFailure, TeammateIdle
- ConfigChange, CwdChanged, FileChanged, WorktreeCreate, WorktreeRemove
- PreCompact, PostCompact, Elicitation, ElicitationResult, SessionEnd
- 4 핸들러: Command (쉘), HTTP (POST), Prompt (LLM 판단), Agent (서브에이전트 검증)

### P3. Memory 시스템
- CLAUDE.md (사용자 작성) + Auto Memory (Claude 작성)
- 위치 우선순위: Managed policy > Project > User > Parent dirs
- `.claude/rules/`: paths frontmatter로 glob 기반 조건부 로딩
- Auto memory: `~/.claude/projects/<project>/memory/`, MEMORY.md + 토픽 파일
- CLAUDE.md는 /compact 후에도 디스크에서 재로드 (컴팩션 생존)

### P4. Agent Teams
- 팀 리드 + 팀메이트, 공유 태스크 리스트, P2P 메일박스 메시징
- 팀메이트는 리드 승인 전까지 read-only 계획 모드
- 훅으로 품질 게이트: TeammateIdle(exit 2로 계속 작업 강제), TaskCompleted(exit 2로 완료 차단)
- 최적: 3-5 팀메이트, 팀메이트당 5-6 태스크

## Z. 주요 출처

- [ghuntley.com/ralph](https://ghuntley.com/ralph/) — Ralph Loop 원본
- [github.com/snarktank/ralph](https://github.com/snarktank/ralph) — Ralph 참조 구현
- [github.com/gsd-build/get-shit-done](https://github.com/gsd-build/get-shit-done) — GSD v1
- [github.com/gsd-build/gsd-2](https://github.com/gsd-build/gsd-2) — GSD v2
- [github.com/garrytan/gstack](https://github.com/garrytan/gstack) — gstack
- [github.com/github/spec-kit](https://github.com/github/spec-kit) — spec-kit
- [github.com/bmad-code-org/BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD) — BMAD
- [github.com/humanlayer/advanced-context-engineering-for-coding-agents](https://github.com/humanlayer/advanced-context-engineering-for-coding-agents) — ACE/FIC
- [kiro.dev](https://kiro.dev/) — Kiro (AWS)
- [simonwillison.net/guides/agentic-engineering-patterns](https://simonwillison.net/guides/agentic-engineering-patterns/) — Simon Willison 가이드
- [addyosmani.com/blog/agentic-engineering](https://addyosmani.com/blog/agentic-engineering/) — Addy Osmani
- [betterquestions.ai](https://betterquestions.ai/the-necessary-evolution-of-research-plan-implement-as-an-agentic-practice-in-2026/) — QRSPI 진화
- [resources.anthropic.com/2026-agentic-coding-trends-report](https://resources.anthropic.com/2026-agentic-coding-trends-report) — Anthropic 2026 리포트
- [martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html) — Martin Fowler SDD 분석
- [arxiv.org/abs/2602.00180](https://arxiv.org/abs/2602.00180) — SDD 학술 논문
- [missing.csail.mit.edu/2026/agentic-coding](https://missing.csail.mit.edu/2026/agentic-coding/) — MIT Missing Semester 2026
- [code.claude.com/docs/en/agent-teams](https://code.claude.com/docs/en/agent-teams) — Claude Code Agent Teams
- [code.claude.com/docs/en/best-practices](https://code.claude.com/docs/en/best-practices) — Claude Code Best Practices
- [anthropic.com/engineering/effective-harnesses-for-long-running-agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) — Anthropic 하네스
- [engineering.fb.com — JiTTesting](https://engineering.fb.com/2026/02/11/developer-tools/the-death-of-traditional-testing-agentic-development-jit-testing-revival/) — Meta JiTTests
- [nxcode.io — Harness Engineering Guide](https://www.nxcode.io/resources/news/what-is-harness-engineering-complete-guide-2026) — NxCode 하네스 가이드
- [humanlayer.dev — Skill Issue](https://www.humanlayer.dev/blog/skill-issue-harness-engineering-for-coding-agents) — HumanLayer 하네스
- [arxiv.org/html/2601.06007v1](https://arxiv.org/html/2601.06007v1) — Don't Break the Cache (프롬프트 캐싱)
- [arxiv.org/html/2603.05344v2](https://arxiv.org/html/2603.05344v2) — Building AI Coding Agents for the Terminal
- [aitoolsclub.com — 15 Agentic AI Design Patterns](https://aitoolsclub.com/15-agentic-ai-design-patterns-you-should-know-research-backed-and-emerging-frameworks-2026/) — 에이전틱 디자인 패턴
- [addyosmani.com/blog/code-agent-orchestra](https://addyosmani.com/blog/code-agent-orchestra/) — Addy Osmani 멀티에이전트
- [addyosmani.com/blog/self-improving-agents](https://addyosmani.com/blog/self-improving-agents/) — 자기 개선 에이전트
- [guardrails.md](https://guardrails.md/) — 가드레일 안전 프로토콜 표준
- [anthropic.com/engineering/harness-design-long-running-apps](https://www.anthropic.com/engineering/harness-design-long-running-apps) — 3-Agent System (2026-03)
- [anthropic.com/engineering/building-c-compiler](https://www.anthropic.com/engineering/building-c-compiler) — 16 병렬 Claude (2026-02)
- [anthropic.com/engineering/claude-code-auto-mode](https://www.anthropic.com/engineering/claude-code-auto-mode) — Auto Mode (2026-03)
- [anthropic.com/engineering/infrastructure-noise](https://www.anthropic.com/engineering/infrastructure-noise) — Eval 인프라 노이즈 (2026)
- [anthropic.com/engineering/demystifying-evals-for-ai-agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) — Eval 로드맵 (2026-01)
- [claude.com/blog/building-agents-with-the-claude-agent-sdk](https://claude.com/blog/building-agents-with-the-claude-agent-sdk) — Agent SDK
- [claude.com/blog/equipping-agents-for-the-real-world-with-agent-skills](https://claude.com/blog/equipping-agents-for-the-real-world-with-agent-skills) — Agent Skills 표준
- [code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks) — Hooks (25 이벤트)
- [code.claude.com/docs/en/skills](https://code.claude.com/docs/en/skills) — Skills
- [code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory) — Memory
