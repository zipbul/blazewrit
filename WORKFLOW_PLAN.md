# Workflow Plan

Status: Architecture finalized. Final design: 8 steps, 6 reviewers, 16 flows, produce ⇄ review loop pattern, Analyze + 기획 + Spec separation. Execution model: script orchestrator (orchestrator.ts) — see EXECUTION_PLAN.md.

## Architecture

```
None (자유 대화/논의) ↔ Triage → Flow[Analyze → 기획? → Spec? → Core Steps → Verify → Reflect]
```

- **None**: Free conversation state. 사용자가 뭘 할지 모를 때 에이전트와 대화/논의. Actionable signal이 나오면 Triage가 Flow로 전환. 논의 중 결정된 내용은 Flow 진입 시 context로 상속.
- **Triage**: **Stateless classification function** — `(input) → (output)`. 입력을 16 flow 중 하나로 분류 (또는 none/ambiguous/error). 코드 분석 안 함. flow 상태 안 봄. 루프 안 돔. persistence 없음. 한 invocation = 한 출력. Output 4종: `proceed(flow_type)` / `none` / `ambiguous(question)` / `error`. Ask cycle은 Triage 밖 — 호출자가 답 받아 clarifications와 재invoke. Active flow 충돌 / cycle cap / 충돌 해결 / preempt 등은 모두 orchestrator/caller 책임.
- **Analyze**: 이해 단계. 전용 에이전트 + 리뷰어. 코드 분석, 의존성 매핑, 영향 범위, 제약 조건. 깊이는 플로우 정의가 결정 (Feature=깊음, P0=최소, Chore=최소).
- **기획**: 기획서 생산. 서비스 architecture + 정책/비즈니스 룰 + 유저 플로우 + 요구사항 포함. 방향 불명확 시 pyreez ideation 선행. emberdeck intent card 생성. 플로우에 따라 포함/생략.
- **Spec**: 기획서에서 AC 추출 + 코드 architecture(디렉토리/파일 설계) + task 분해. emberdeck spec card + codeLinks. 플로우에 따라 포함/생략.
- **Core Steps**: Test, Implement, Report (from step pool).
- **Verify**: Mandatory on every flow. 플로우 전체 목적 달성 확인. All 16 flows end with Verify → Reflect. On FAIL, diagnoses failure origin and routes back to responsible step.
- **Reflect**: Mandatory on every flow completion and abandonment. Does NOT run on suspension.
- **Step Execution**: All steps except Verify and Reflect run as produce ⇄ review loop with dedicated reviewer agent (Ralph Loop pattern).
- **Flow State**: Persisted in `.blazewrit/flow-state.yaml`. Updated on every step transition. Read at session start. Survives context loss.

## Step Pool (8)

| Step | Description |
|------|-------------|
| Analyze | 이해. 코드 분석, 의존성 매핑, 영향 범위, 제약 조건, 리서치. 깊이는 플로우 정의가 결정. **입력은 orchestrator가 전달하는 (request_text + conversation_context + clarifications + Triage classification)** — 의도 분류는 Triage 책임. |
| 기획 | 기획서 생산. 서비스 architecture(제품/시스템/정보/비즈니스 구조) + 정책/비즈니스 룰(조건부 로직, 예외 처리, 권한, 상태 전이) + 유저 플로우 + 요구사항 포함. 방향 불명확 시 pyreez ideation 선행. emberdeck intent card 생성. |
| Spec | 기획서에서 AC 추출(번호, 측정 가능, 정책 룰 포함) + 코드 architecture(디렉토리/파일 설계, 모듈 경계, 의존 관계) + task 분해 + 의존성 + 순서. emberdeck spec card + codeLinks. Plan-as-prompt: Spec 출력이 곧 downstream 실행 프롬프트. |
| Test | Write failing tests (RED). Reproduce bugs. Add coverage. Profile/measure (Performance flow). Validate migration scripts (Migration flow). |
| Implement | Write code (GREEN). Sub-activities: setup (deps, config, infrastructure), code, commit. firebat scan after every change. emberdeck validate_code_links. Atomic commits per logical unit. |
| Report | Synthesize analysis, investigation, or review results into a deliverable output. Used by: Review, Retro, Exploration, Spike, 기획(standalone) flow. |
| Verify | Flow-level goal verification. 플로우 전체 목적 달성 확인 (코드/비코드 모두). Internal multi-pass: mechanical/completeness → goal-backward → adversarial. pyreez for high-risk. On FAIL, diagnoses failure origin and routes back. |
| Reflect | Post-flow learning. Internal multi-pass: fact collection → pattern extraction → prior comparison. Records: what worked, what failed, unexpected, patterns. Writes to instruction files. Runs on completion and abandonment (not suspension). |

## Step Execution Pattern

Every step (except Verify and Reflect) runs as a produce ⇄ review loop (Ralph Loop pattern). Each step agent is paired with a dedicated reviewer agent. The reviewer runs in fresh context and receives only the step's output — never the producer's reasoning.

```
Step Agent → output
  → Mechanical gates (if applicable: typecheck, test, firebat)
    → FAIL → error feedback to Step Agent, retry
    → PASS → Step Reviewer Agent (fresh context, output only)
      → PASS → next step
      → FAIL + feedback → Step Agent retries with feedback
      → max iterations → DONE_WITH_CONCERNS, proceed
```

### Step-Reviewer Pairs

| Step | Reviewer | Reviewer checks |
|------|----------|----------------|
| Analyze | Analyze-Reviewer | 분석 범위가 충분한가, 의존성 누락 없는가, 제약 조건이 식별됐는가 |
| 기획 | 기획-Reviewer | 유저 플로우 완전한가, 정책 빠진 게 없는가, 서비스 architecture 적절한가, 상태 전이 정의됐는가, 성공 기준 측정 가능한가 |
| Spec | Spec-Reviewer | 모든 정책이 AC로 변환됐는가, AC 측정 가능한가, 코드 architecture(디렉토리/파일) 명확한가, task 분해 빠짐없는가 |
| Test | Test-Reviewer | 테스트가 행위를 검증하는가 (smoke test 아닌가), AC traceability, 엣지 케이스 커버리지 |
| Implement | Implement-Reviewer | 코드가 spec을 충족하는가, deviation rules 준수, stub/hollow 없는가 |
| Report | Report-Reviewer | findings에 severity + 증거가 있는가, action items 존재, claims이 검증됐는가 |

### Steps Without Reviewers

| Step | Why no reviewer | Quality guaranteed by |
|------|----------------|----------------------|
| Verify | Verify IS the flow-level evaluator. Adding a reviewer creates infinite recursion | Internal multi-pass (mechanical → goal-backward → adversarial) + pyreez cross-verification |
| Reflect | Output quality is structurally guaranteed | Structure check hook (4 sections) + 3-tier distillation filter + append-only |

### Verify: Flow-Level Goal Verification

Verify is not a step reviewer — it checks whether the ENTIRE FLOW achieved its PURPOSE. Runs on all 16 flows without exception.

**Internal multi-pass (per invocation):**

For code-producing flows:
1. Mechanical: typecheck + all tests pass + firebat blockers=0 + emberdeck drift=0
2. Goal-backward: original request → plan → tests → code, traces "what must be TRUE"
3. Adversarial: "how could this still fail? what did I miss?"
4. pyreez cross-verification for Pass 2-3 (high-risk flows)

For non-code flows:
1. Completeness: required items present, evidence cited, measurements exist
2. Goal-backward: original request → output, does output answer the request
3. Adversarial: "this conclusion could be wrong because..."
4. pyreez cross-verification for Pass 2-3 (high-risk flows)

**Failure routing — Verify diagnoses WHERE the problem is:**

```
Verify FAIL →
  failure_origin: analyze | 기획 | spec | test | implement | report
  reason: specific issue description
  evidence: file:line or artifact reference

Host reads failure_origin → routes back to that step's produce ⇄ review loop
  → analyze: Analyze ⇄ Analyze-Reviewer re-enters
  → 기획: 기획 ⇄ 기획-Reviewer re-enters
  → spec: Spec ⇄ Spec-Reviewer re-enters
  → test: Test ⇄ Test-Reviewer re-enters
  → implement: Implement ⇄ Implement-Reviewer re-enters
  → report: Report ⇄ Report-Reviewer re-enters
  → multiple: earliest problematic step first
```

### Reflect: Internal Multi-Pass

```
Pass 1: Fact collection — what happened at each step, what results
Pass 2: Pattern extraction — recurring themes, surprises, what worked/failed
Pass 3: Prior learning comparison — read .blazewrit/flow-history/, compare with past
→ max 3 iterations until 4 required sections are substantive
```

## Triage — Stateless Classification Function

### Definition

> **Triage는 입력을 flow type으로 분류하는 stateless 함수다.**  
> `(input) → (output)`. 코드 분석 안 함. flow state 안 봄. 루프 안 돔. persistence 없음. 한 invocation = 한 출력.

**Triage가 하는 것**: 입력을 이해해서 16 flow 중 하나로 분류, 또는 분류 불가/모호하면 명시 출력.  
**Triage가 안 하는 것**: 코드 보기 / flow 상태 관리 / 충돌 해결 / cycle 운영 / 설계 / 검증 / persistence — 전부 다른 step 또는 orchestrator의 일.

### Inputs

| 필드 | 필수 | 설명 |
|---|---|---|
| `primary_input` | ✓ | Channel-typed: UserMessage \| A2ARequest \| CIConfig |
| `channel` | ✓ | `user_session` \| `a2a` \| `ci` |
| `conversation_context` | optional | None-state turns (user 세션) |
| `clarifications` | optional | 이전 invocation의 Q&A 누적 `[{q, a}]` |
| `prior_evidence` | optional | reclassify용 `{prior_flow_type, evidence}` |

**입력에 `active_flow_state` 없음.** Triage는 flow 상태 모름 — orchestrator의 일.

### Outputs (4 type — exhaustive)

```
proceed {
  flow_type,                              // feature | bugfix | ... | compound
  classification_metadata: {
    matched_rows: [signal_row_id],
    confidence: high | medium | low
  }
}

none {
  reasoning                               // 왜 actionable 아닌지
}

ambiguous {
  question                                // 1 routing-blocking 질문
}

error {
  reason: GIBBERISH | INTERNAL
}
```

### Activities (single-pass, 루프 없음)

```
1. Comprehend
   primary_input + clarifications + conversation_context + prior_evidence
   → verb / target / concern_count 추출

2. Classify Decision (단일 출력)
   ├─ verb/target 추출 못함            → none(reasoning)
   ├─ 입력 무의미 (parse 실패)          → error(GIBBERISH)
   ├─ signal table 단일 row 매치       → proceed(flow_type, confidence)
   │  (또는 strict superset, P0 over Bug Fix)
   │  └─ verb/target ≥ 2 → flow_type=Compound
   ├─ 다중 row 매치, superset 없음     → ambiguous(question)
   │  question priority: verb > target > urgency > concern_count
   └─ Triage 자체 실패                 → error(INTERNAL)
```

**Ask cycle은 Triage 안에 없음.** 호출자가 답변 받으면 clarifications에 추가하고 *재invoke*. 포기 결정도 호출자.

### Confidence

- **high**: signal table 정확히 1 row 매치 (또는 strict superset)
- **medium**: 1 row 매치하지만 입력에 약간 모호 (clarifications 사용됨)
- **low**: 거의 출력되지 않음 — Triage는 우세 row 없으면 ambiguous 출력

### 채널별 동작

| 채널 | none | ambiguous | error |
|---|---|---|---|
| user_session | 호스트 LLM이 자유 대화 계속 | 호스트 LLM이 user에 질문 → 답 받아 재invoke | (rare; Comprehend 실패 시) |
| a2a | INTENT_NOT_ACTIONABLE 반환 | INTENT_INCOMPLETE + question 반환 | GIBBERISH/INTERNAL 반환 |
| ci | trigger config 에러 | trigger config 에러 (config 부족) | trigger config 에러 |

### Properties

- **Stateless**: pure function. 호출 간 상태 없음.
- **Idempotent**: 같은 입력 → 같은 출력 (LLM 비결정성 modulo).
- **Single-pass**: 한 invocation = 한 출력. 루프 없음.
- **No flow state**: active/suspended 모름.
- **No code analysis**: 코드 read 금지 (도구 영역).
- **No persistence**: 디스크 안 씀 (artifact 없음).

### Boundary — Triage가 안 하는 것 (다른 책임자)

| 항목 | 책임자 |
|---|---|
| Active flow 검사, 충돌 해결, preempt | Orchestrator + caller |
| Suspended flow 유사도 / 재개 제안 | Orchestrator |
| Cycle cap, 포기 결정 | Host LLM / caller |
| Reframe count, 회복 정책 | Orchestrator |
| 코드 분석, 의존성, 영향 범위 | Analyze |
| 서비스 architecture, 정책, 요구사항 | 기획 |
| Sub-flow 분해 (Compound) | 기획 |
| AC, 코드 architecture, task | Spec |
| 검증 | Verify |
| 학습 | Reflect |
| flow-state 관리 / persistence | Orchestrator |
| 도구 권한, hook | Mechanical 영역 (셸/코드) |

### Signal Table

| Signal | Flow |
|--------|------|
| New capability + 2+ affected cards or 5+ files | Feature |
| Error, crash, failing test, regression | Bug Fix |
| Error + P0/production down | Bug Fix P0 |
| Error + intermittent/unreproducible | Bug Fix Unreproducible |
| No behavior change + structural improvement | Refactor |
| Profiling, benchmark, latency, throughput, memory target | Performance |
| Dependency upgrade, API migration, framework change | Migration |
| Coverage gap, missing tests, test strategy | Test |
| Config, CI, docs, dependencies | Chore |
| Planning, design, research, spec writing with concrete target | 기획 (standalone) |
| PR review, code audit, diff analysis, security audit | Review |
| Version bump, changelog, deploy | Release |
| Retrospective, postmortem, analysis of past work | Retro |
| Feasibility check, prototype, proof of concept | Spike |
| Understanding, investigation, learning | Exploration |
| Multiple blockers requiring different flows, or multi-phase task | Compound |
| No actionable signal, no concrete target (discussion, open brainstorming, casual exchange) | None (free conversation) |

### Signal Strength Rules

Signal strength는 *Triage 출력 분기*를 결정.

| Strength | Criteria | Triage 출력 |
|----------|----------|-------------|
| Clear | Input has explicit verb + target ("fix the NPE in auth.py", "add avatar upload") | `proceed(flow_type, confidence=high)` |
| Implied | Input describes problem/goal without explicit action ("auth is slow") | `ambiguous(question)` 1개 — 호출자가 답 받아 재invoke → `proceed` (medium) |
| Ambiguous | No actionable target ("something feels off") | `none(reasoning)` — user 세션은 자유 대화, A2A/CI는 INTENT_NOT_ACTIONABLE |

### None ↔ Flow Transition Rules

None ↔ Flow 전이는 *호스트 LLM*의 책임이지 Triage의 책임이 아니다. 호스트 LLM이 conversation 누적을 보다가 actionable signal 감지 시 Triage invoke. 결과에 따라 처리:

| Trigger | Host LLM 행동 |
|---------|---------------|
| User states actionable intent | Triage invoke → `proceed`면 orchestrator.start, `ambiguous`면 user에 질문 후 재invoke, `none`이면 자유 대화 계속 |
| Conversation produces spec-level detail | Host LLM이 conversation_context와 함께 Triage invoke → 결과 처리 |
| User explicitly abandons | Host LLM이 orchestrator.abandon 호출 (Triage 미관여) |
| No flow-related input for 3+ exchanges | Host LLM이 user에 "continue or suspend?" 질문 (Triage 미관여) |

### Flow Lifecycle Rules

| Event | Action | State file update |
|-------|--------|-------------------|
| **Start** | Triage classifies → Analyze → begin core steps | Write: flow type, step, status=active |
| **Suspend** (user switches topic) | Save progress to state file (no Reflect) | Write: status=suspended, current step, completed work, pending items |
| **Suspend** (P0 preemption) | Pause immediately → new Bug Fix P0 flow starts | Write: status=suspended, preempted_by=P0, resume point |
| **Resume** | Read state file → skip completed steps → continue from suspension point | Write: status=active |
| **Complete** | Reflect → record learnings | Write: status=completed |
| **Abandon** | Reflect(abandoned, reason) | Write: status=abandoned |

Resume priority: P0 preemption always resumes after P0 completes. User-suspended flows resume only on explicit request.

### User Override

User can override Triage classification at any point:
- "This isn't a refactor, it's a feature" → reclassify, restart Analyze for new flow type
- "Skip the tests, just implement" → follow user directive, Reflect records deviation
- "I don't want a flow for this" → None, even if signal was clear

### Context Inheritance Rules

호스트 LLM이 Triage invoke 시 `conversation_context`로 None-state turns를 전달. Triage의 Comprehend가 이를 통합 이해.

- **Inherit**: decisions made, constraints identified, scope discussed, files mentioned, approach agreed
- **Do not inherit**: abandoned ideas, rejected approaches, tangential discussion (호스트 LLM이 필터)
- **Rule**: Triage는 `conversation_context`를 *Comprehend의 입력*으로 사용. 별도 결박 artifact 생산 안 함 — 분류 결과만 출력. 다음 step (Analyze)도 같은 conversation_context를 orchestrator로부터 받음.

## Flow State Persistence

Flow state is file-based, not context-dependent. Survives session boundaries, compaction, and context loss.

### State File

Location: `.blazewrit/flow-state.yaml` (list of active/suspended flows)

```yaml
# List structure — supports multiple suspended flows + one active
flows:
  - id: feature-avatar-upload
    flow: feature
    status: active          # active | suspended | completed | abandoned
    step: implement         # current step
    started: 2026-03-31T14:00:00
    summary: "Adding avatar upload to user profile"
    completed_steps:
      - analyze: "impact scope: 3 files, S3 연동, no blockers"
      - 기획:
          status: DONE
          artifact: ".blazewrit/plans/feature-avatar-upload-기획.md"
      - spec:
          status: DONE
          artifact: ".blazewrit/plans/feature-avatar-upload-spec.md"
      - test:
          status: DONE
          artifact: "src/__tests__/avatar-upload.test.ts"
    pending:
      - "implement cycle 1: resize logic"
      - "verify"

  - id: bugfix-p0-auth
    flow: bugfix-p0
    status: suspended
    step: verify
    started: 2026-03-31T13:00:00
    suspended_at: 2026-03-31T13:45:00
    suspend_reason: "User switched to feature work"
    completed_steps:
      - analyze: "symptom: auth token expiry not refreshed"
      - implement:
          status: DONE
          artifact: "src/auth/token-refresh.ts (commit abc123)"
    pending:
      - "verify"
      - "test (retroactive)"

# Compound flow tracks sub-flows internally
  - id: compound-payment-overhaul
    flow: compound
    status: active
    step: sub-flow-2
    sub_flows:
      - { flow: migration, status: completed, summary: "DB schema migrated" }
      - { flow: feature, status: active, summary: "New payment API" }
      - { flow: test, status: pending }
```

### State File Rules

1. **Write on every step transition** — host updates after each step agent (producer or reviewer) returns
2. **Read at session start** — Triage checks for active/suspended flows before classifying new input
3. **Single active flow** — only one flow can be active at a time. Starting a new flow requires suspending or completing the current one
4. **Suspended flows persist** — no automatic expiry. User chooses which to resume (not LIFO stack)
5. **P0 preemption** — auto-prompts resume after P0 completes
6. **Completed/abandoned flows are archived** — moved to `.blazewrit/flow-history/` with timestamp for Retro flow access
7. **Compound sub-flows** — tracked within the compound entry, not as separate list items

## Execution Protocol

Full execution architecture in EXECUTION_PLAN.md. This section covers the design rationale and mechanisms that integrate with the workflow.

### Design Rationale

blazewrit의 오케스트레이터는 TypeScript 스크립트(orchestrator.ts)다. LLM이 아니다. 루프가 기계적으로 보장된다.

Not a CLI binary (GSD-2), not a tool collection (gstack), not a fixed pipeline (spec-kit), not prompt-enforced rules (host LLM이 루프를 빼먹을 수 있음). **스크립트가 루프를 돌고, AI는 각 스텝에서 작업만 한다** (Ralph Loop 패턴).

채택 근거: Ralph Loop (114줄 bash)이 증명. GSD/gstack/spec-kit은 호스트 LLM에 루프를 맡겨 prompt-enforced 한계를 가짐.

입력 채널별 구동:
- **A2A/CI**: orchestrator.ts가 전체 루프를 직접 구동 (`claude --agent X --print`). 풀자동.
- **유저 세션**: PostToolUse(Agent) 훅이 orchestrator.ts next를 자동 호출. 호스트 LLM은 훅의 지시를 따라 Agent tool 실행.

### Execution Model

```
orchestrator.ts (TypeScript 스크립트 — 상태 머신, 루프 보장)
  │
  ├─ Triage: 호출자가 분류 후 flow type 전달
  │   A2A: server.ts 기계 분류 → 실패 시 claude 호출
  │   유저: 호스트 LLM이 signal table로 분류
  │   CI: 트리거 설정에 명시
  │
  ├─ Step execution → Produce ⇄ Review loop
  │   ├─ [새 세션] claude --agent {step} --print (producer)
  │   ├─ Mechanical gates (typecheck, test — exit code)
  │   ├─ [새 세션] claude --agent {step}-reviewer --print (reviewer, 산출물만 수신)
  │   ├─ PASS → next step / FAIL → retry with feedback / attempt >= 3 → DONE_WITH_CONCERNS
  │   ├─ Step Agent = custom agent (.claude/agents/<step>.md)
  │   ├─ tools/disallowedTools: per agent frontmatter (mechanical)
  │   ├─ mcpServers: scoped per agent (firebat, emberdeck, pyreez)
  │   ├─ maxTurns: runaway prevention per agent
  │   ├─ isolation: worktree (for high-risk Implement)
  │   └─ return: completion status + output artifact (sentinel pattern)
  │
  ├─ Verify → Flow-level goal verification (internal multi-pass, no reviewer)
  │   ├─ On FAIL: diagnoses failure_origin → orchestrator routes back to responsible step
  │   └─ Verify 3회 실패 → BLOCKED
  │
  ├─ Step transition → orchestrator.ts updates flow-state.yaml, determines next step
  │
  ├─ Crash recovery → flow-state.yaml은 스텝 사이에만 업데이트
  │   → 재개 시 현재 스텝 산출물 확인 → 미완성이면 revert + 재실행
  │
  └─ Hooks (유저 세션 전용)
      ├─ PostToolUse(Agent): orchestrator.ts next 자동 호출
      └─ Stop: 미완료 flow 존재 시 세션 종료 차단

에이전트 내부 훅 (모든 채널):
  ├─ PostToolUse(Edit|Write): firebat scan
  ├─ PostToolUse(Read|Grep|Glob): stuck detection counter
  ├─ PreToolUse(Bash(git commit*)): regression_guard
  └─ Conditional: coverage gate, Reflect structure check
```

### Why Custom Agents, Not Skills

| Capability | Skill | Custom Agent | blazewrit needs |
|------------|-------|-------------|-----------------|
| Fresh context | Shared with host | **Isolated** | Yes — prevents context rot across steps |
| mcpServers scoping | Not supported | **Supported** | Yes — firebat/emberdeck/pyreez per step |
| permissionMode | Not supported | **Supported** | Yes — acceptEdits for Implement |
| maxTurns | Not supported | **Supported** | Yes — runaway prevention |
| worktree isolation | Not supported | **Supported** | Yes — high-risk Implement |
| hooks scoping | Supported | **Supported** | Yes |
| Transcript survival | Lost on compaction | **Persists independently** | Yes — long workflows |

Custom agents get fresh context and return condensed results. This matches the "fresh context per step" principle (Ralph Loop, GSD, Anthropic 4.6 best practice).

### Enforcement by Consequence

Enforcement strength is matched to the consequence of violation:

| Consequence of violation | Enforcement | Mechanism | Examples |
|---|---|---|---|
| **Dangerous** (bad code ships, data loss) | **Hook — mechanical** | Runs regardless of agent behavior | firebat scan, regression_guard, blocker check |
| **Role violation** (step does wrong thing) | **allowed-tools — mechanical** | Host tool blocks restricted tools | Verify can't Edit, Reflect can't Edit |
| **Order violation** (step skipped) | **File dependency — natural failure** | Next step fails without previous artifact | Implement can't run without plan file |
| **Conditional skip** (optional step wrongly skipped) | **Hook — conditional check** | Script validates condition before allowing skip | Coverage < 80% → Test mandatory |
| **Completion skip** (Reflect skipped) | **Hook — Stop gate** | Session can't end with unreflected completed flow | Stop hook checks state file |
| **Quality issue** (poor analysis, weak learning) | **Prompt + structure check** | Instructions guide, script checks structure | Reflect must have required sections |
| **Judgment error** (wrong classification) | **Prompt only** | Clear rules, tables, examples | Triage signal table, decision classification |

### Tool Restrictions Per Step Agent

Each step agent defines `tools` (allow list) or `disallowedTools` (deny list) in its frontmatter. Path restrictions use hooks (gstack `/freeze` pattern).

| Agent | tools | mcpServers | Rationale |
|-------|-------|------------|-----------|
| analyze | Read, Grep, Glob, Bash | emberdeck | Read-only + bash for git log. 코드 분석, 의존성 매핑 |
| analyze-reviewer | Read, Grep, Glob | — | Read-only. 분석 범위/깊이 검증 |
| 기획 | Read, Grep, Glob, Bash, Write | emberdeck, pyreez | 기획서 생산. emberdeck intent card. pyreez ideation |
| 기획-reviewer | Read, Grep, Glob | — | Read-only. 기획서 품질 검증 (유저플로우, 정책, architecture) |
| spec | Read, Grep, Glob, Bash, Write | emberdeck | AC 추출 + 코드 architecture + task 분해. emberdeck spec card + codeLinks |
| spec-reviewer | Read, Grep, Glob | — | Read-only. AC 완전성, 코드 architecture 명확성 검증 |
| test | Read, Grep, Glob, Bash, Edit, Write | firebat | Writes test code |
| test-reviewer | Read, Grep, Glob | — | Read-only. 테스트 품질, AC traceability 검증 |
| implement | Read, Grep, Glob, Bash, Edit, Write | firebat, emberdeck | Full access. firebat scans every change. emberdeck validate_code_links |
| implement-reviewer | Read, Grep, Glob | — | Read-only. spec 충족, stub detection |
| report | Read, Grep, Glob, Bash, Write | — | Produces reports. No code edits (Edit blocked) |
| report-reviewer | Read, Grep, Glob | — | Read-only. findings severity, evidence, action items 검증 |
| verify | Read, Grep, Glob, Bash | firebat, emberdeck, pyreez | Read-only. Flow-level goal verification. No reviewer |
| reflect | Read, Grep, Glob, Write | — | Writes instruction files. No reviewer. Structural guarantee |

### Orchestrator Protocol

orchestrator.ts가 오케스트레이터. Triage만 호출자(호스트 LLM 또는 server.ts)가 수행.

orchestrator.ts 인터페이스:
- `run(flow, request)` — A2A/CI: 전체 루프 실행
- `next()` — 유저 세션: 훅이 호출, 다음 스텝 반환
- `start(flow, request)` — flow 생성, 첫 스텝 반환
- `resume(flow_id, context)` — NEEDS_CONTEXT/crash 후 재개
- `abandon(flow_id)` — 중단 + Reflect 실행
- `reclassify(flow_id, new_flow)` — 플로우 재분류
- `status(flow_id?)` — 상태 조회
- `check-incomplete()` — 미완료 flow 존재 여부 (Stop 훅용)

유저 세션에서 호스트 LLM의 역할 (orchestration.md):
- Triage 분류 (signal table)
- `orchestrator.ts start` 호출
- PostToolUse 훅이 반환한 지시에 따라 Agent tool 실행
- NEEDS_CONTEXT 시 유저와 대화 후 `orchestrator.ts resume`
- 유저 개입 시 `reclassify` / `abandon` 호출

### Completion Status Protocol

Every step agent returns one of (gstack pattern — adopted because it covers all terminal states):

| Status | Meaning | Orchestrator action |
|--------|---------|-------------------|
| DONE | Step completed. Artifact produced | Write to state file. Next step |
| DONE_WITH_CONCERNS | Completed with issues | Write to state file. Next step, flag for Verify |
| BLOCKED | Cannot proceed | Write to state file. Escalate to user |
| NEEDS_CONTEXT | Missing information | Write to state file. Ask user |

### Artifact Chain

Each step produces a defined artifact. Artifacts are **maps, not summaries** — findings + constraints + files_to_read. 다음 에이전트는 산출물(지도)을 읽고, files_to_read의 소스 코드를 직접 읽는다. 요약을 맹신하지 않고 코드를 직접 확인. (GSD `<files_to_read>` 패턴)

Missing artifact = natural failure (spec-kit pattern — adopted because it enforces order without extra machinery).

| Step | Produces | Consumed by |
|------|----------|-------------|
| Analyze | Analysis map (`.blazewrit/analysis/<flow-id>.md`) — findings, constraints, files_to_read | 기획, Spec, or first core step |
| 기획 | 기획서 (`.blazewrit/plans/<flow-id>-기획.md`) + emberdeck intent card | Spec |
| Spec | AC list + 코드 architecture + task decomposition (`.blazewrit/plans/<flow-id>-spec.md`) + emberdeck spec card + codeLinks | Test, Implement |
| Test | Test file paths + RED/GREEN status | Implement |
| Implement | Changed file paths + commit refs | Verify |
| Report | Report file (`.blazewrit/reports/<flow-id>.md`) | Verify |
| Verify | Verification result (PASS/FAIL + failure_origin + details) | Reflect (or back to failed step) |
| Reflect | Learnings in instruction files | Next session (auto-loaded by host tool) |

Plan-as-prompt (GSD pattern): Spec output IS the execution prompt for downstream steps (Test, Implement).

### Hooks

#### Safety Hooks (always active)

| Hook | Trigger | Action | Why |
|------|---------|--------|-----|
| firebat scan | PostToolUse(Edit\|Write) | Scan changed files. Error → block | Catches bad code immediately |
| regression_guard | PreToolUse(Bash(git commit*)) | emberdeck regression check | Prevents spec drift from being committed |
| stuck detection | PostToolUse(Read\|Grep\|Glob) | Count consecutive read-only calls. 5 → warn, 8 → force escalate | GSD analysis paralysis guard |
| blocker check | Stop | firebat blockers > 0 → block session end | Prevents leaving broken state |

#### Enforcement Hooks

| Hook | Trigger | Action | Why |
|------|---------|--------|-----|
| Reflect gate | Stop | Check state file: any flow completed without reflect_completed=true → block | Prevents skipping Reflect |
| Reflect structure | PostToolUse(Write) on instruction files | Check Reflect output has required sections (what_worked, what_failed, patterns) → warn if missing | Ensures Reflect isn't hollow |
| Coverage gate | PreToolUse(Edit\|Write) in Implement context | If flow=refactor and coverage < 80% and Test not in completed_steps → block | Enforces conditional Test requirement |

### Self-Validation Protocol

Within-step quality loop (prompt-enforced, iteration-capped):

```
Do work → Check against step criteria → Pass? → DONE
                                       → Fail? → Fix (iteration++)
                                       → iteration >= 3? → Force DONE_WITH_CONCERNS
```

Iteration count tracked within step agent execution. Not in flow-state.yaml.

### Decision Classification

Within any step (gstack pattern — adopted because it prevents both over-automation and unnecessary blocking):

| Type | Criteria | Action |
|------|----------|--------|
| Mechanical | One clearly correct answer | Auto-decide silently |
| Taste | Reasonable people disagree | Surface to user at next gate |
| User Challenge | High risk or irreversible | STOP immediately, ask user |

Prompt-enforced. Classification itself is judgment — cannot be mechanically forced.

### Fact Verification Protocol

에이전트의 학습 데이터에서 나온 지식은 가설이다 (GSD: "Training data = hypothesis — 6-18 months stale"). 가설은 검증해야 사실이 된다. 검증 = 직접 읽거나 직접 실행. "그럴 것 같다"는 근거가 아니다.

| 주장 유형 | 검증 방법 | 미검증 시 |
|-----------|----------|----------|
| 외부 API/라이브러리 스펙 | Read로 docs/README 직접 확인 또는 Bash로 실행 확인 | `[UNVERIFIED]` 태그 |
| 구현 가능성 | 프로토타입 코드 작성 + 실행 | `[UNVERIFIED]` 태그 |
| 성능 수치 | benchmark/profile 직접 측정 | `[UNMEASURED]` 태그 |
| 기존 코드 동작 | Read로 코드 직접 확인 또는 test 실행 | `[UNVERIFIED]` 태그 |
| 호환성/의존성 | 직접 설치 + import 확인 | `[UNVERIFIED]` 태그 |

적용 대상: 모든 producer + 모든 reviewer. 예외 없음.
`[UNVERIFIED]`/`[UNMEASURED]` 태그가 있는 항목은 의사결정 근거로 사용 불가.
Verify가 `[UNVERIFIED]` 항목을 발견하면 FAIL + 해당 스텝으로 라우팅하여 검증 요구.

### What Cannot Be Mechanically Enforced

Only items that are **pure judgment with no structural proxy**:

| Item | Why it's irreducible | Mitigation |
|------|---------------------|-----------|
| Triage classification | Interpreting user intent is judgment | Signal table + LLM classification. Ambiguity → `ambiguous(question)` 출력으로 호출자가 명시적 처리. 잘못된 분류는 Verify가 발견 시 `failure_origin: triage` → reclassify로 회복 |
| Decision classification | Assessing risk/reversibility is judgment | Decision type table with examples per step |
| Self-validation content quality | Evaluating "good enough" is judgment | Criteria checklist per step. Max 3 iterations |
| Reclassification detection | Recognizing flow mismatch is judgment | Trigger list with concrete conditions. 3-failure rule is hookable |

## Quality Assurance

How blazewrit guarantees output quality in fully autonomous A2A operation with no human in the loop. Organized by enforcement domain: harness (mechanical), context (information management), prompt (behavioral rules). Every mechanism cites evidence level and source.

### Harness — Mechanical Quality Enforcement

These work regardless of LLM behavior. The agent cannot bypass them.

| Mechanism | What | Evidence | Source |
|-----------|------|----------|--------|
| **Deterministic quality gates** | typecheck + lint + firebat + test suite run as exit-code gates between steps. Non-zero = step fails | MEASURED: "Testing is the single biggest differentiator between agentic engineering and vibe coding" — Osmani | GSD, gstack, spec-kit, Anthropic harness |
| **Spec-Test traceability** | Script checks that each acceptance criterion in plan has ≥1 corresponding test case. Missing coverage = Test step incomplete | PRODUCTION-TESTED: GSD plan-checker "Requirement Coverage" dimension; spec-kit analyze Pass E "Coverage Gaps" | GSD, spec-kit |
| **Completion signal** | Step agent outputs sentinel string for mechanical completion detection. Harness greps — not LLM self-assessment | PRODUCTION-TESTED: Ralph Loop `<promise>COMPLETE</promise>` grep | Ralph Loop |
| **Hallucination guard** | If step agent produces zero tool calls, reject output. Agent that only talks without acting = hallucinated response | PRODUCTION-TESTED: GSD-2 auto engine "zero tool calls = rejected" | GSD-2 |
| **Crash recovery** | flow-state.yaml은 스텝 사이에만 업데이트 → 재개 시 현재 스텝 산출물 확인 → 미완성이면 revert + 재실행. 별도 메커니즘 불필요 — 새 세션 + 파일 상태가 자동 해결 | PRODUCTION-TESTED: Ralph Loop fresh restart pattern | Ralph, GSD-2 |
| **Self-consistency bias prevention** | Reviewer agent receives artifact only. Never receives producer's reasoning. 매 스텝 새 세션이므로 이전 추론 오염 없음 | MEASURED: Anthropic "models consistently show positive bias when grading their own work" | Anthropic harness |
| **Fresh context per step** | 모든 스텝이 새 세션. orchestrator.ts가 `claude --agent X --print`로 매번 새 프로세스 spawn. Context rot 구조적 불가 | PRODUCTION-TESTED: Ralph Loop "malloc/free — kill the process"; Anthropic "fresh context > compaction" | Ralph, Anthropic 4.6 |

Already in WORKFLOW_PLAN.md (not repeated): hooks (firebat scan, regression_guard, stuck detection, blocker check, Reflect gate, coverage gate), hook failure policy, maxTurns, worktree isolation, fix attempt limit (3), artifact chain validation.

### Context — Information Management

What each agent sees, when, and how degradation is prevented.

| Mechanism | What | Evidence | Source |
|-----------|------|----------|--------|
| **Context budget model** | Quality degrades with usage: 0-30% PEAK, 30-50% GOOD, 50-70% DEGRADING, 70%+ POOR. Tasks sized to complete within GOOD zone | PRODUCTION-TESTED: GSD plans target ~50% usage, 2-3 tasks max per plan | GSD |
| **Context pressure monitor** | 유저 세션 호스트 LLM 전용. PostToolUse hook injects warnings: 35% remaining = WARNING, 25% = CRITICAL. 스텝 에이전트는 fresh context이므로 불필요. A2A/CI에서는 orchestrator.ts가 프로세스 단위로 관리하므로 불필요 | PRODUCTION-TESTED: GSD `gsd-context-monitor.js` PostToolUse hook | GSD |
| **Context packets** | Each step agent receives explicit `files_to_read` list. First instruction: "Read every listed file before any action." No more, no less | PRODUCTION-TESTED: GSD `<files_to_read>` XML blocks; spec-kit progressive loading | GSD, spec-kit |
| **Session startup sequence** | Every agent session: (1) verify working directory, (2) read git log + state files, (3) identify task, (4) baseline verification, (5) begin work | PRODUCTION-TESTED: Anthropic official pattern; Ralph Loop reads prd.json + progress.txt first | Anthropic, Ralph |
| **One-task-per-session** | Each step agent implements exactly one bounded task. Prevents scope creep and context exhaustion | PRODUCTION-TESTED: Ralph Loop "one story per iteration — critical constraint"; Anthropic "one-feature-per-session" | Ralph, Anthropic |
| **Prompt caching architecture** | Static content (rules, enforcement, tool definitions) at prompt top. Dynamic content (plan artifacts, state) at bottom. Preserves cache across sessions | MEASURED: arXiv 2601.06007 "41-80% cost reduction, 13-31% TTFT improvement" | Academic |
| **Instruction repetition** | Critical constraints repeated at key decision points within long-running agents, not just loaded at session start | MEASURED: arXiv 2601.03269 "instruction repetition recovers compliance 20-35%" | Academic |

Already in WORKFLOW_PLAN.md (not repeated): flow state persistence, artifact chain, plan-as-prompt, 3-tier knowledge distillation, flow definitions on-demand read.

### Prompt — Behavioral Rules in Agent Instructions

Embedded in step agent prompts. Prompt-enforced, not mechanical — but backed by evidence.

| Mechanism | What | Evidence | Source |
|-----------|------|----------|--------|
| **Goal-backward verification** | Verify checks "what must be TRUE for success" — not "what steps were taken." Traces observable truths → required artifacts → required wiring | PRODUCTION-TESTED: GSD verifier 4-level check (exists → substantive → wired → data-flowing) | GSD |
| **Structured return contracts** | Every agent returns fixed format: status (DONE/BLOCKED/etc) + artifact path + evidence. No free-form prose between steps | PRODUCTION-TESTED: GSD defined output format per agent; gstack completion protocol | GSD, gstack |
| **Forced uncertainty marking** | Unknown = explicit `[NEEDS CLARIFICATION: specific question]`. Max 3 markers — make informed guesses for rest | PRODUCTION-TESTED: spec-kit max 3 markers | spec-kit |
| **Root cause before fix** | Bug Fix: never apply fix without identifying root cause first. Data flow tracing → hypothesis → verification → fix | PRODUCTION-TESTED: gstack `/investigate` iron law; 3-strike limit | gstack |
| **Two-pass review** | Verify runs two passes: Pass 1 CRITICAL (security, race conditions, data loss) blocks. Pass 2 INFORMATIONAL (style, naming) is advisory | PRODUCTION-TESTED: gstack `/review` two-pass system | gstack |
| **Escalation limits** | Hard caps prevent infinite loops: max 3 uncertainty markers, max 5 clarification questions, max 3 validation iterations, max 50 analysis findings | PRODUCTION-TESTED: spec-kit across all commands | spec-kit |
| **Mandatory initial read** | First line of every agent prompt: "Read every file in files_to_read before any other action" | PRODUCTION-TESTED: GSD "MUST read before any action" | GSD |
| **Append-only progress** | State and progress files are append-only. Agents never overwrite previous entries — only add | PRODUCTION-TESTED: Ralph Loop "never replace progress.txt" | Ralph |
| **Stub detection criteria** | Verify checks for hollow implementations: `return null`, `TODO`, `FIXME`, empty handlers, fetch without await, query result not returned | PRODUCTION-TESTED: GSD verifier stub detection rules | GSD |
| **Anti-pattern examples** | Each agent prompt includes concrete "DON'T" examples. Specificity tables: "TOO VAGUE vs JUST RIGHT" | PRODUCTION-TESTED: GSD anti-pattern lists; gstack AI slop detection | GSD, gstack |

Already in WORKFLOW_PLAN.md (not repeated): self-validation loop (max 3), decision classification, deviation rules, chunking rule.

### How Quality Mechanisms Integrate with Workflow

Quality mechanisms are not a separate chain — they are embedded in the workflow's step transitions and repetition cycles. The workflow's [Test ⇄ Implement]* loop, [Implement → Verify]* loop, and compound [Flow → Gate]* loop ARE the quality loops. orchestrator.ts가 각 전환에서 gate를 기계적으로 실행하고, 매 스텝은 새 세션으로 spawn된다 (Ralph Loop pattern).

Quality mechanisms apply at three points:

1. **Step entry** — artifact validation (previous step output exists), context packet delivery (files_to_read), mandatory initial read, session startup sequence
2. **Within step** — self-validation loop (max 3), deviation rules, escalation limits, hallucination guard (zero tool calls = reject), instruction repetition at decision points
3. **Step exit / transition** — deterministic gates (typecheck + test + firebat), completion signal, structured return contract, flow-state update

### Known Limitations

Three gaps that cannot be closed with current technology:

| Gap | Why it's irreducible | Mitigation |
|-----|---------------------|-----------|
| **Test quality** | Script can count AC → test mapping. Cannot verify the test actually validates the criterion. LLM judgment | Test-Reviewer + pyreez multi-model review. Two-pass review in Verify (CRITICAL first) |
| **기획 quality** | 나쁜 기획서 → 완벽한 쓰레기. 기획의 서비스 architecture, 정책, 유저 플로우가 잘못되면 downstream 전부 잘못됨 | 기획-Reviewer + pyreez multi-model deliberation. Forced uncertainty marking. Anti-pattern examples |
| **Triage classification** | 유저 세션에서 호스트 LLM이 Triage 수행. 잘못 분류할 수 있음. A2A에서는 기계 분류 + LLM fallback | Signal table with concrete examples. Ambiguity → Analyze에 위임. 유저가 재분류 가능 (`orchestrator.ts reclassify`) |
| **유저 세션 훅 지시 따르기** | PostToolUse 훅이 다음 Agent 지시를 반환하지만 호스트 LLM이 따르지 않을 수 있음. A2A/CI에서는 해당 없음 (스크립트가 루프 구동) | 지시가 단순함 ("Agent(X) 실행"). Stop 훅이 미완료 flow 감지. prompt-enforced 범위가 최소 |

Note: 스텝 순서 보장, reviewer 실행 보장, state 업데이트는 더 이상 Known Limitation이 아님 — orchestrator.ts(스크립트)가 기계적으로 보장. GSD/gstack/spec-kit과 달리 호스트 LLM에 루프를 맡기지 않음.

## Flows (16)

```
Feature:
  Analyze(impact scope, card query, blockers, feasibility)
  → 기획 → Spec → [Test ⇄ Implement]* → Verify → Reflect

Bug Fix:
  Analyze(error logs, related code)
  → Test(reproduce) → Implement(fix) → Verify → Reflect

Bug Fix P0:
  Analyze(minimal: symptom location only)
  → Implement(emergency) → Verify → Test(retroactive) → Reflect

Bug Fix Unreproducible:
  Analyze(logs, history)
  → Implement(hypothesis) → Verify(extended observation) → Reflect

Refactor:
  Analyze(coverage, dependencies)
  → [기획(architecture+정책)]? → Spec → [Test(<80%)]? → [Implement → Verify]* → Reflect

Performance:
  Analyze(profile target, baseline measurement)
  → 기획(목표+정책+architecture) → Spec → [Test(profile) → Implement → Verify(measure)]* → Reflect

Migration:
  Analyze(full dependency audit, compatibility matrix)
  → 기획 → Spec → [Test(validate) → Implement → Verify]* → Reflect

Test:
  Analyze(coverage gap)
  → Test → Verify → Reflect

Chore:
  Analyze(minimal: change target)
  → Implement → Verify → Reflect

기획 (standalone):
  Analyze(existing cards, docs)
  → 기획 → Report → Verify → Reflect

Review:
  Analyze(diff, related code)
  → Report → Verify → Reflect

Release:
  Analyze(minimal: version, changelog, CI status)
  → Implement(version) → Verify → Reflect

Retro:
  Analyze(git log, history)
  → Report → Verify → Reflect

Spike:
  Analyze(minimal)
  → Implement(prototype) → Report → Verify → Reflect

Exploration:
  Analyze(관련 영역 탐색)
  → Report → Verify → Reflect

Compound:
  Analyze → 기획(sub-flow identification, dependency ordering)
  → [Sub-Flow → Gate]* → Report → Verify → Reflect
```

## Reclassification Rules

Any step can trigger reclassification:

- Bug Fix discovers design flaw → Refactor or Compound
- Refactor requires public API change → Migration
- Spike confirms feasibility → Feature
- Any flow: 3 failures with same approach → stop, escalate
- Any flow: scope exceeds bounds → Compound or chunking

## Compound Flow Rules

- Sub-flows execute sequentially, each running its full step sequence
- **Decision gate** between each sub-flow: proceed / pivot / abort
- Gate criteria defined during Triage classification
- Dynamic sub-flow count allowed (e.g., Review finds N bugs → N Bug Fix sub-flows)
- State carries between sub-flows within the same session
- If a sub-flow fails, the compound flow pauses for decision

## Chunking Rule

When Analyze identifies scope exceeding bounds (5+ files, 3+ modules), 기획 MUST produce a chunking plan:
- Split into bounded cycles, each covering one concern/module
- Each cycle is a complete mini-flow (Test → Implement → Verify)
- Dependency order between cycles defined in the plan

## Bug Fix Paths

| Condition | Path |
|-----------|------|
| Normal (reproducible) | Analyze → Test(reproduce RED) → Implement(fix GREEN) → Verify → Reflect |
| P0/production down | Analyze(minimal) → Implement(emergency fix) → Verify → Test(retroactive, mandatory within 24h) → Reflect. Enforcement: scheduled trigger checks `retroactive_test_due` in flow-state.yaml every 6h, auto-creates Test flow if overdue. Fallback: SessionStart hook warns on next session. |
| Unreproducible (intermittent) | Analyze → Implement(hypothesis fix, documented) → Verify(extended observation) → Reflect |

## Refactor Guards

- If Analyze identifies target code has <80% test coverage → Test step mandatory before Implement to establish baseline
- Large scope (5+ files) → 기획 mandatory for design/chunking plan
- Breaking changes (public API) → reclassify as Migration

## Migration Test-First Rule

Migration flow includes Test before each Implement cycle:
```
기획 → Spec → [Test(validate migration) → Implement(apply migration) → Verify]*
```
Test validates: migration scripts are reversible, data integrity preserved, rollback works.

## Tool Integration

### Per-Step Tool Mapping

| Step | emberdeck | firebat | pyreez |
|------|-----------|---------|--------|
| Analyze | `get_card_context`, `pre_change_check` | `query-dependencies` (Migration) | — |
| 기획 | `create_card` (intent) | — | `deliberate` (ideation, architecture) |
| Spec | `create_card` (spec), `codeLinks` | — | `deliberate` (complex spec) |
| Test | — | `scan` (after test code) | — |
| Implement | `validate_code_links`, `write_spec_annotations` | `scan` (every change, expandAffected) | — |
| Report | — | — | — |
| Verify | `regression_guard` (threshold=0) | `scan` (full project) | `deliberate` (review mode, high-risk) |
| Reflect | — | — | — |

### emberdeck Chain (Intent → Spec → Code → Verify)

```
기획: create intent card (의도 기록)
  → Spec: create spec card + codeLinks (명세 + 코드 연결)
    → Implement: validate_code_links (코드가 spec과 일치하는지)
      → Verify: regression_guard (drift=0, spec 대비 변화 없음)
```

### pyreez Trigger Criteria

Called only when:
- 5+ affected files, OR
- emberdeck card risk = high/critical, OR
- Explicit request from user/agent

Otherwise: agent plans independently.

### Tool Availability (Graceful Degradation)

All tools optional. Workflow degrades:
- emberdeck present → card query/save/validate/drift
- emberdeck absent → code-only analysis, text-only plans, no drift check
- firebat present → scan after every change, full project scan at Verify
- firebat absent → `test` + `typecheck` only
- pyreez present → multi-model deliberation for complex decisions
- pyreez absent → agent decides alone

## Deviation Rules

1. firebat severity=error → auto-fix attempt
2. firebat severity=warning → fix if task-related, skip otherwise
3. emberdeck drift detected → update spec card, confirm, proceed
4. **3 failures with same approach → stop, escalate**
5. P0 severity → skip Test, fix first, retroactive test mandatory

## Verify Checklist

All must PASS:
1. emberdeck `regression_guard` PASS (skip if no emberdeck)
2. firebat `scan` blockers = 0 (or test + typecheck pass if no firebat)
3. Most complex execution path traced end-to-end through actual code
4. Every Plan/Spec item mapped to code (file:line)

## Gate Policy

```yaml
gate_policy:
  confirm: [migration, release]
  auto: [*]
```

Configurable per project in `.blazewrit/config.yaml`. `auto: []` = fully manual. `confirm: [migration, release]` = mostly automated.

## Hook Enforcement

See Execution Protocol > Hooks for complete hook specification. Summary:

**Safety**: firebat scan (PostToolUse Edit/Write), regression_guard (PreToolUse commit), stuck detection (PostToolUse Read/Grep/Glob), blocker check (Stop)

**Enforcement**: Reflect gate (Stop), Reflect structure check (PostToolUse Write), coverage gate (PreToolUse Edit/Write in Refactor)

### Hook Failure Policy

| Hook category | On crash/timeout | Rationale |
|---------------|-----------------|-----------|
| **Safety** (firebat, regression_guard, blocker check) | **fail-closed** — wrapper script catches crash → exit 2 (deny) | Violation consequence is dangerous (bad code ships). AgentSpec: >90% unsafe code prevention requires mechanical enforcement |
| **Enforcement** (Reflect gate, coverage gate) | **fail-open** (Claude Code default: non-0/non-2 exit = continue) | Violation consequence is quality issue. Guardrails-as-Infrastructure: stricter policies reduce task success rates |

### Hook Context Detection

Hooks that need flow context (e.g., coverage gate checking if current flow is Refactor) read `.blazewrit/flow-state.yaml` directly. The active flow's `flow` and `step` fields provide the needed context. No environment variables or separate mechanisms required.

## Delivery Form Factor

### What blazewrit Is

blazewrit is a **workflow rule set + thin script orchestrator**. 규칙(에이전트 프롬프트, 플로우 정의, 훅)과 오케스트레이터 스크립트(orchestrator.ts)를 프로젝트에 설치한다. orchestrator.ts가 루프를 기계적으로 구동하고, 각 스텝은 custom agent로 실행된다.

### Why This Form

| Alternative | Why rejected |
|-------------|-------------|
| **Standalone CLI** (GSD-2 model) | Rebuilds what Claude Code already provides (hooks, agents, mcpServers). Maintenance cost |
| **Rules only** (prompt-enforced) | 호스트 LLM이 루프를 관리 → 스텝 건너뛰기, reviewer 누락 가능. 모든 레퍼런스 시스템의 한계 |
| **Claude Code plugin** | Plugin subagents restricted (no hooks/mcpServers/permissionMode) |
| **MCP server** | MCP exposes individual tools, not orchestrated workflows |
| **Skill collection** (gstack model) | Skills share host context (context rot), no mcpServers scoping, no maxTurns, no worktree isolation |

### Bun Package — Setup Tool (No Runtime Dependency)

blazewrit is a setup tool, not a runtime dependency. It copies rules, agents, hooks, and scripts into the project, then exits. Nothing remains in `dependencies`.

```
bunx @zipbul/blazewrit init
```

Deploys into the project:

```
├── .claude/rules/blazewrit/
│   ├── orchestration.md          ← Triage + state management protocol (always loaded, kept concise)
│   └── enforcement.md            ← deviation rules, gate policy, decision classification
│
├── .claude/agents/
│   ├── analyze.md                ← producer: read-only + bash, mcpServers:[emberdeck]
│   ├── analyze-reviewer.md       ← reviewer: read-only, checks analysis scope/depth
│   ├── 기획.md                    ← producer: tools, mcpServers:[emberdeck,pyreez], maxTurns
│   ├── 기획-reviewer.md           ← reviewer: read-only, checks 기획서 completeness (유저플로우, 정책, architecture)
│   ├── spec.md                   ← producer: tools, mcpServers:[emberdeck], maxTurns
│   ├── spec-reviewer.md          ← reviewer: read-only, checks AC completeness, 코드 architecture clarity
│   ├── test.md                   ← producer: tools, mcpServers:[firebat], maxTurns
│   ├── test-reviewer.md          ← reviewer: read-only, checks behavior testing, AC traceability
│   ├── implement.md              ← producer: tools, mcpServers:[firebat,emberdeck], maxTurns, isolation:worktree
│   ├── implement-reviewer.md     ← reviewer: read-only, checks spec fulfillment, stub detection
│   ├── report.md                 ← producer: tools, maxTurns
│   ├── report-reviewer.md        ← reviewer: read-only, checks severity, evidence, action items
│   ├── verify.md                 ← no reviewer: internal multi-pass + pyreez, mcpServers:[firebat,emberdeck,pyreez]
│   └── reflect.md                ← no reviewer: structural guarantee (hook + 3-tier + append-only)
│
├── .claude/settings.json          ← hooks (PostToolUse(Agent): orchestrator next, Stop: check-incomplete, 에이전트 내부 safety hooks)
│
├── .blazewrit/
│   ├── orchestrator.ts            ← 스크립트 오케스트레이터 (상태 머신, 루프 구동, gate 실행)
│   ├── config.yaml                ← gate_policy, flow settings
│   ├── flows/                     ← flow definitions (on-demand read, NOT context-resident)
│   │   ├── feature.md
│   │   ├── bugfix.md
│   │   ├── bugfix-p0.md
│   │   └── ...                    ← 16 flow files
│   ├── scripts/                   ← hook wrapper scripts, gate scripts
│   └── a2a/
│       └── server.ts              ← A2A server (프로토콜 처리 → orchestrator.ts run 호출)
└──
```

**Context budget**: `.claude/rules/blazewrit/` (always loaded) is kept concise — Triage signal table + orchestration protocol only. Flow definitions live in `.blazewrit/flows/` and are read on-demand after Triage classifies. This follows GSD's phase-aware context loading pattern: load only what the current phase needs.

### A2A Integration

blazewrit is input-channel agnostic. A2A는 풀자동 — 유저 개입 없음. CancelTask로 중단 가능.

```
External Agent ──A2A──→ server.ts (프로토콜 처리)
                              │
                              ├─ Triage: 기계 분류 → 실패 시 claude 호출
                              │
                              ↓
                        orchestrator.ts run (전체 루프, 기계적 보장)
                              │
                              ├─ claude --agent analyze --print
                              ├─ claude --agent analyze-reviewer --print
                              ├─ claude --agent 기획 --print
                              ├─ ...각 스텝 새 세션...
                              ├─ claude --agent verify --print
                              ├─ claude --agent reflect --print
                              │
                              ↓
                        Result ──A2A──→ External Agent

CancelTask → server.ts → SIGTERM → orchestrator가 subprocess kill → revert → suspended
NEEDS_CONTEXT → task status: input-required → 클라이언트 에이전트에 질문 반환
```

blazewrit provides a reference A2A server implementation (`.blazewrit/a2a/server.ts`). Minimal thin layer: receive request → spawn `claude` session in project directory → return result. Projects can customize or replace with their own A2A infrastructure.

### Input Channels

| Channel | Example | Human required |
|---------|---------|---------------|
| Human direct | User types request in Claude Code session | Yes |
| Agent (A2A) | Product agent sends feature request to project's A2A server | No — pyreez + self-validation |
| Auto trigger | CI failure → Bug Fix, scheduled cron → Retro | No |

## Quality Assurance Mechanisms

| Mechanism | What it solves | Source |
|-----------|---------------|--------|
| Emberdeck card-unit decomposition | Agent capability limits (FeatureBench 11%) | GSD context budget |
| File-based state (cards, reports, git) | Context degradation over long sessions | Ralph Loop, GSD context-packet |
| Mechanical verification (5/6 checks) | LLM self-evaluation unreliable | Anthropic evaluator research |
| Multi-model cross-verification (pyreez) | Single model bias | gstack dual-voice, AceMAD |
| Goal-backward verification | "exists" ≠ "works" | GSD verifier |

## Validation Status

- 48 scenarios simulated across 14 flows (pre-decomposition) + structural review of 3 Bug Fix variants and Exploration
- Orient decomposed into Triage + Analyze (dedicated step agent)
- Step pool: 8 (Analyze, 기획, Spec, Test, Implement, Report, Verify, Reflect)
- Flow count: 16 (Bug Fix split into 3 paths)
- Reclassification rules added (any step can trigger)
- Tool mapping updated (firebat in Analyze for Migration only)
- Triage classification logic added (signal table, strength rules, None classification)
- **Triage 최종 정의: Stateless classification function.** `(input) → (output)`. Inputs: primary_input + channel + optional(conversation_context, clarifications, prior_evidence). Outputs 4종: `proceed(flow_type, confidence)` / `none(reasoning)` / `ambiguous(question)` / `error(reason)`. Single-pass, 루프 없음, persistence 없음, flow state 안 봄, 코드 분석 안 함. Ask cycle은 Triage 밖 — 호출자가 답변 받으면 clarifications에 추가하여 재invoke. Active flow 충돌/cycle cap/preempt/conflict resolution은 모두 orchestrator/caller 책임. **스코프 엄격화 이유**: 이전 elaborate 설계 (Frame Intent 15필드, Active Check, conflict resolution table, state machine, similar_suspended, sub_flow_types 등)는 모두 다른 step의 책임을 Triage에 잘못 흡수한 over-reach였음. 진짜 Triage는 *분류만* — 의도 결박/캡처는 워크플로우 전체가 점진적으로 정밀화하는 일이지 첫 step의 일이 아님.
- Flow lifecycle rules added (start, suspend, resume, complete, abandon)
- Flow state persistence added (flow-state.yaml, list structure, archive)
- Execution protocol: orchestrator.ts (스크립트)가 루프 구동. A2A/CI는 전체 루프, 유저 세션은 PostToolUse 훅 구동
- Enforcement by consequence: dangerous→hook, role violation→allowed-tools, order→file dependency, conditional skip→hook gate, completion→Stop hook, quality→prompt+structure check, judgment→prompt only
- Design rationale documented: why each reference pattern was adopted or rejected
- Implementability verified against Claude Code capabilities: no nonexistent features assumed
- Design decisions 9-12 resolved: Reflect 3-tier distillation, non-impl completion criteria, worktree rollback, hook context detection
- Hook failure policy added: safety=fail-closed, enforcement=fail-open
- P0 retroactive test enforcement: scheduled trigger (mechanical) + SessionStart fallback (advisory)
- Gate policy storage location defined: `.blazewrit/config.yaml`
- Execution model changed: step = custom agent (not skill). Fresh context per step (`claude --agent X --print`), scoped mcpServers/hooks/permissionMode/maxTurns/isolation
- blazewrit identity: workflow rule set + thin script orchestrator. orchestrator.ts가 루프 구동, LLM은 각 스텝에서 작업만 수행
- Delivery form factor: bunx setup tool deploys rules + agents + orchestrator.ts + hooks + scripts + A2A server
- A2A integration: server.ts → orchestrator.ts run (풀자동). CancelTask → SIGTERM. NEEDS_CONTEXT → input-required
- Delivery: bunx setup tool (no runtime dependency), not npm install
- Context budget: rules (always loaded, concise) vs flows (on-demand read) split
- Flow definitions moved from .claude/rules/ to .blazewrit/flows/ (phase-aware context loading)
- Quality Assurance section: harness (7), context (7), prompt (10) — all with evidence level and source
- Step execution pattern: produce ⇄ review loop (Ralph Loop) for all steps except Verify and Reflect
- Step pool: 8 (Analyze, 기획, Spec, Test, Implement, Report, Verify, Reflect). Dialogue removed, replaced by 기획+Spec. Prepare removed, replaced by Analyze.
- 14 agents total: 8 producers + 6 reviewers (analyze, 기획, spec, test, implement, report + their reviewers)
- Verify: mandatory on ALL 16 flows. Internal multi-pass. Failure routing to origin step
- Reflect: internal multi-pass (fact collection → pattern extraction → prior comparison)
- 기획: 기획서 = 통합문서 (서비스 architecture + 정책/비즈니스 룰 + 유저 플로우 + 요구사항). ideation은 기획의 하위 활동. roadmap 제거.
- Spec: 기획서에서 AC 추출 + 코드 architecture(디렉토리/파일 설계) + task 분해
- Analyze: Prepare 흡수. 전용 에이전트. Triage의 Implied/Ambiguous signal도 처리
- None state: 자유 대화/논의. ideation이 아닌 탐색적 대화. Signal 나오면 Flow 전환
- Known limitations: test quality, 기획 quality, Triage 분류 정확도, 유저 세션 훅 지시 따르기 — 스텝 순서/reviewer 실행은 더 이상 limitation 아님 (스크립트 보장)

## Reflect Detail

### 3-Tier Progressive Knowledge Distillation

Adopted from Ralph Loop's 3-tier pattern. ACE (arXiv 2510.04618) warns against "brevity bias" (removing domain insights for conciseness) and "context collapse" (detail erosion through iterative rewrites).

| Tier | Location | Content | Lifecycle |
|------|----------|---------|-----------|
| **Raw** | `.blazewrit/flow-history/<id>.yaml` | Full Reflect output: what_worked, what_failed, unexpected, patterns_discovered | Auto-archived on flow completion/abandonment |
| **Curated** | `.claude/rules/<topic>.md` | Patterns observed 3+ times across flows. Append-only updates — never rewrite existing content | Promoted from Tier 1 when pattern repeats. Pruned when contradicted by evidence |
| **Permanent** | CLAUDE.md (manual) | Battle-tested rules the user chooses to enshrine | User decision only. Reflect never writes here directly |

### Reflect Required Sections

Every Reflect output must contain (enforced by Reflect structure check hook):

1. **what_worked** — techniques, tools, approaches that succeeded
2. **what_failed** — what didn't work and why
3. **unexpected** — surprises, edge cases, assumptions proven wrong
4. **patterns_discovered** — recurring observations worth tracking

### Dedup Rule

Before writing to Tier 2 (`.claude/rules/`), Reflect searches existing rule files for the same pattern. If found: append new evidence to existing file. If not found: create new file. Never create duplicate rules.

## Non-Implementation Flow Completion Criteria

Flows without code output (Review, Retro, Exploration, Spike, 기획 standalone) complete when their terminal artifact exists and is substantive (GSD verifier Level 1 + Level 2: exists and not stub).

| Flow | Terminal artifact | Completion = |
|------|------------------|--------------|
| Review | `.blazewrit/reports/<flow-id>.md` | Report exists + every finding has severity tag |
| Retro | `.blazewrit/reports/<flow-id>.md` | Report exists + at least 1 action item |
| Exploration | `.blazewrit/reports/<flow-id>.md` | Report exists with content (no minimum structure) |
| Spike | `.blazewrit/reports/<flow-id>.md` | Report exists + feasibility verdict (GO / NO-GO / CONDITIONAL) |
| 기획 (standalone) | `.blazewrit/plans/<flow-id>-기획.md` | 기획서 exists + next step explicitly named |

## Rollback and Failure Recovery

### Worktree Isolation (High-Risk Flows)

High-risk flows (Feature, Migration, Refactor) run Implement in a git worktree. Verify checks the worktree. Merge to main only on Verify PASS. On failure, delete worktree — zero rollback cost, zero main branch contamination.

```
Feature/Migration/Refactor:
  Implement → runs in git worktree (Claude Code isolation: worktree)
    → Verify PASS → merge worktree to main
    → Verify FAIL → iteration++ (fix in same worktree)
    → iteration >= 3 with same approach → STOP, escalate
    → User chooses: different approach | fresh restart | abandon

Low-risk flows (Bug Fix, Chore, Test, Release):
  Implement → runs on main branch directly
    → Verify FAIL → git revert last commit, retry
    → 3 failures → BLOCKED, escalate
```

**Fresh restart option**: When stuck, starting over in a new worktree with fresh context is often better than debugging accumulated state (Devin insight, Ralph Loop pattern, Anthropic 4.6 best practice: fresh context > compaction).

### Escalation on Failure

| Failure count | Same approach? | Action |
|---------------|---------------|--------|
| 1-2 | Yes | Retry with fix |
| 3 | Yes | STOP — same approach exhausted (GSD deviation rule 4) |
| 1-2 | No (different approach) | Continue |
| 3 | No | BLOCKED — present options: fresh restart, user intervention, abandon |

## Remaining Work (Implementation Phase)

Full execution architecture in EXECUTION_PLAN.md. Below is the implementation checklist.

### Orchestrator
1. orchestrator.ts 구현 — 상태 머신, CLI (run/next/start/resume/abandon/reclassify/status/check-incomplete), claude 호출, gate 실행
2. flow-state.yaml 스키마 확정

### Step Agents + Reviewer Agents
3. Producer agents (analyze.md, 기획.md, spec.md, test.md, implement.md, report.md, verify.md, reflect.md) — 8 agents, custom agent frontmatter (tools, mcpServers, hooks, maxTurns, isolation) + prompt body (output contract, self-validation criteria, artifact map format)
4. Reviewer agents (analyze-reviewer.md, 기획-reviewer.md, spec-reviewer.md, test-reviewer.md, implement-reviewer.md, report-reviewer.md) — 6 agents, read-only tools, review criteria, structured feedback format

### Orchestration Rules (유저 세션용)
5. orchestration.md (.claude/rules/blazewrit/) — Triage 호출 정책 (signal 감지 시 invoke, ambiguous 출력 시 user에 질문 후 재invoke, none 출력 시 자유 대화 유지) + Active flow 충돌 처리 (orchestrator/host LLM) + 훅 지시 따르기 규칙
6. enforcement.md (.claude/rules/blazewrit/) — deviation rules, gate policy, decision classification

### Flow Definitions
7. 16 flow definition files (.blazewrit/flows/) — step order, conditional steps, loop conditions, Verify failure routing

### Hooks + Scripts
8. .claude/settings.json — PostToolUse(Agent): orchestrator next, Stop: check-incomplete
9. 에이전트 내부 safety hooks: firebat scan, regression_guard, stuck detection
10. Hook wrapper scripts (fail-closed for safety)
11. A2A server.ts 구현

### Resolved Design Decisions
- ~~Execution model~~ → EXECUTION_PLAN.md (스크립트 오케스트레이터, 세션 모델, 아티팩트 모델, 채널별 구동, crash recovery)
- ~~Reflect detail~~ → See "Reflect Detail" section
- ~~Non-implementation flow completion criteria~~ → See "Non-Implementation Flow Completion Criteria" section
- ~~Rollback guidance~~ → See "Rollback and Failure Recovery" section
- ~~Hook context detection~~ → See "Hook Enforcement > Hook Context Detection"
