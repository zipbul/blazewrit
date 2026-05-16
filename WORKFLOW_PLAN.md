# Workflow Plan

Status: Architecture finalized. Final design: **9 steps, 7 reviewers, 16 flows**, produce ⇄ review loop pattern, Ground + Investigate + Decide chain. Execution model: script orchestrator (orchestrator.ts) — see EXECUTION_PLAN.md. Naming evolution (Analyze→Investigate, Plan→Decide) recorded in CHANGELOG.md.

## Index

- **Step details**: [steps/triage/](./steps/triage/) · [steps/ground/](./steps/ground/) · [steps/investigate/](./steps/investigate/) · [steps/decide/](./steps/decide/) · [steps/spec/](./steps/spec/) · [steps/test/](./steps/test/) · [steps/implement/](./steps/implement/) · [steps/report/](./steps/report/) · [steps/verify/](./steps/verify/) · [steps/reflect/](./steps/reflect/)
- **Flow chains (16)**: [flows/README.md](./flows/README.md)
- **Compound recursion**: [steps/decide/compound-recursion.md](./steps/decide/compound-recursion.md)
- **Validation history**: [CHANGELOG.md](./CHANGELOG.md)

이 문서는 *cross-cutting policy* (Step Depth, Execution Protocol, Quality Assurance, Delivery, Hook 정책)을 담는다. 각 step의 책임/입출력/도구는 위 step 디렉토리 README를 참조.

## Architecture

```
None (자유 대화/논의) ↔ Triage → Flow[Ground → Investigate → Decide → Spec? → Core Steps → Verify → Reflect]
```

- **None**: 자유 대화. Triage가 actionable signal 감지 시 Flow 전환. 논의 결과는 Flow 진입 시 context 상속.
- **Triage**: Stateless classification — 입력 → 16 flow 중 1개 / none / ambiguous / error. 코드·flow state 안 봄. → [steps/triage/](./steps/triage/)
- **Ground**: Evidence boundary — bounded·sourced·current 사실 + 불확실성. → [steps/ground/](./steps/ground/)
- **Investigate**: Task-specific interpretation — Impact/Constraints/Risk/Compatibility/Validity/Unknown disposition. → [steps/investigate/](./steps/investigate/)
- **Decide**: Decision ownership (universal, mode = Record / Plan / Design). → [steps/decide/](./steps/decide/)
- **Spec / Test / Implement / Report**: core steps, flow-conditional. → [steps/](./steps/)
- **Verify**: 모든 flow 필수 — flow-level goal check + failure routing. → [steps/verify/](./steps/verify/)
- **Reflect**: completion + abandonment에서 실행, suspension 미실행. → [steps/reflect/](./steps/reflect/)
- **Step Execution**: Verify/Reflect 제외 모두 produce ⇄ review (Ralph Loop).
- **Flow State**: `.blazewrit/flow-state.yaml` — step transition마다 update, session start에 read.

## Step Pool (9)

각 step의 상세 (책임 / 입출력 / 도구 / Reviewer criteria / Adaptive Depth caps)는 [steps/](./steps/) 디렉토리 README 참조.

| Step | 한 줄 요약 |
|------|-------------|
| Ground | Evidence boundary — Triage된 의도 → bounded·sourced·current 사실 + 불확실성. 해석/판단 없음. |
| Investigate | Task-specific interpretation — Ground 사실을 설계 가능한 문제 정의로 해석. 결정·옵션·설계 안 함. |
| Decide | Decision ownership (universal) — Investigate 위에서 결정. 3 mode (Record/Plan/Design). |
| Spec | design document에서 AC 추출 + 코드 architecture + task 분해. (flow 조건부) |
| Test | RED tests + reproduce + coverage + profile/validate. |
| Implement | GREEN code + setup + atomic commits. firebat scan every change. |
| Report | 분석/리뷰 결과 합성 (비코드 flow terminal artifact). |
| Verify | Flow-level goal verification (모든 flow). Internal multi-pass + failure routing. |
| Reflect | Post-flow learning (completion + abandonment). 3-tier distillation. |

## Step Depth Policy (Adaptive)

모든 step이 *default = shallow*. 명시 mechanical trigger 발동 시 *deepen*. 비용 ↓ + 안전 ↑ (다층). Step-specific shallow/deep activities + caps + deepen triggers는 각 step README의 "Adaptive Depth" 섹션 참조 — 이 섹션은 cross-cutting policy만 다룬다.


### Upstream Deepen Request

Decide가 shallow Ground/Investigate 출력으로 결정 불가 시 → `request_upstream_deepen` 신호 → orchestrator가 해당 step 재invoke with depth=deep.

**Cycle cap**: upstream deepen 1회 (무한 cycle 방지). 그래도 부족 시 Verify가 final safety (`failure_origin=ground|investigate` → reclassify with depth=deep 강제).

### P0 Depth Precedence

P0 (Bug Fix P0) flow는 *시간 critical* → 빠른 fix 우선. complexity_signal=high 같은 다른 deepen trigger와 충돌 시:

```
Phase 1 (Emergency Pass): P0 emergency 진행 — depth=shallow 강제 (다른 trigger 무시)
  → Ground shallow → Investigate shallow → Decide(Record) → Implement(emergency) → Verify
  
Phase 2 (Post-Stabilization): Verify PASS 후 *자동 후속 flow 생성*
  → 만약 P0 진입 시 complexity_signal=high였거나 god_node 검출됐다면
  → 자동 Bug Fix (Normal) flow with depth=deep 큐잉
  → 또는 Retro flow로 분석
```

**P0 override 규칙**: flow_type=bugfix-p0이면 *모든 다른 deepen trigger 무시*. P0 자체가 최우선 precedence. Verify가 emergency fix 후 *post-stabilization follow-up* 자동 트리거.

### Shallow → Deep Transition

단일 invocation 내 escalation 허용:
1. Shallow 활동 실행 (wall_s 한도 내)
2. Trigger 발동 감지 → deep 활동 추가, wall_s 연장
3. Shallow 캡처 fact는 deep input 재사용 (폐기 안 함)

또는 분리 invocation: orchestrator가 shallow 완료 후 trigger 평가 → deep invocation 재호출 (shallow 출력 입력).

### Safety + Data Discipline + Learning

이전 "7 safety layer"는 정직하지 않음 — provenance/freshness는 *data discipline*이지 active safety 아니고, Reflect는 *post-hoc learning*이지 current-flow protection 아님. 솔직히 재분류:

**Active Safety (4 layer)** — 단일 flow 실행 중 실수 catch:
| Layer | 잡는 것 |
|---|---|
| Orchestrator triggers | mechanical depth 결정, halt 강제 |
| Step caps | 무한 실행 방지 (wall_s + tokens) |
| Step reviewer checklist | 출력 일관성 (mechanical 가능한 한) |
| Verify | 변경 후 누락 catch (`failure_origin` 라우팅) |

**Data Discipline (2)** — audit·재현·stale 검출:
| 메커니즘 | 역할 |
|---|---|
| Provenance | 모든 fact/issue/unknown에 source_tool, audit 추적 |
| Freshness | ed_snapshot_version + git_HEAD + source_version, stale 검출 |

**Learning (1)** — flow 종료 후 시스템 개선:
| 메커니즘 | 역할 |
|---|---|
| Reflect | 패턴 학습 → trigger·default depth·matrix 조정 |

→ 단일 active layer 실수도 다른 active layer가 catch. Data discipline + Learning은 *long-term* 보조.

## Step Execution Pattern

Every step (except Verify and Reflect) runs as a produce ⇄ review loop (Ralph Loop pattern). Each step agent is paired with a dedicated reviewer agent. The reviewer runs in fresh context and receives only the step's output — never the producer's reasoning.

```
Step Agent → output
  → Mechanical gates (if applicable: typecheck, test, firebat)
    → FAIL → error feedback to Step Agent, retry
    → PASS → Step Reviewer Agent (fresh context, output only)
      → PASS → next step
      → FAIL + feedback → Step Agent retries with feedback
      → max iterations (3) → **HALT** (flow suspend, user/caller에 escalate)
```

**RETRY_EXHAUSTED policy**: 이전 정의는 max iterations 후 `DONE_WITH_CONCERNS, proceed` — *품질 실패가 silent 통과*. 변경: max iterations 도달 시 **flow halt + escalate**. proceed 안 함. `DONE_WITH_CONCERNS` 출력 type 폐지.

**Cross-cycle fail cap**: producer⇄reviewer 3-fail cap은 *단일 cycle*. reclassify로 재진입 시 fail counter reset. 그러나 *(flow_id, step_name) total fail count*도 추적 — 5회 누적 시 flow-level halt (reclassify 무한 loop 방지).

**Triage reclassify cap**: Triage 재invoke (reclassify 트리거)는 **flow 당 최대 3회**. `reclassify_count` 추적. flow_id는 reclassify 시 *유지* (변경 X) — counter 의미 보존. 3회 초과 시 flow halt + user/caller escalate ("intent 결정 불가"). A2A/CI도 동일 cap.

**RETRY_EXHAUSTED Reflect 분류**: RETRY_EXHAUSTED → Reflect 분류는 **abandoned** (의도 외 termination). Reflect 실행 (학습 누적).

### Step-Reviewer Pairs

| Step | Reviewer | Reviewer criteria |
|------|----------|---|
| Ground | Ground-Reviewer | [steps/ground/README.md § Reviewer](./steps/ground/README.md) |
| Investigate | Investigate-Reviewer | [steps/investigate/README.md § Reviewer](./steps/investigate/README.md) |
| Decide | Decide-Reviewer | [steps/decide/README.md § Reviewer](./steps/decide/README.md) |
| Spec | Spec-Reviewer | [steps/spec/README.md § Reviewer](./steps/spec/README.md) |
| Test | Test-Reviewer | [steps/test/README.md § Reviewer](./steps/test/README.md) |
| Implement | Implement-Reviewer | [steps/implement/README.md § Reviewer](./steps/implement/README.md) |
| Report | Report-Reviewer | [steps/report/README.md § Reviewer](./steps/report/README.md) |

### Steps Without Reviewers

| Step | Why no reviewer | Quality guaranteed by |
|------|----------------|----------------------|
| Verify | Verify IS the flow-level evaluator. Adding a reviewer creates infinite recursion | Internal multi-pass + pyreez cross-verification. 상세: [steps/verify/README.md](./steps/verify/README.md) |
| Reflect | Output quality is structurally guaranteed | Structure check hook (4 sections) + 3-tier distillation + append-only. 상세: [steps/reflect/README.md](./steps/reflect/README.md) |


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
      - decide:
          status: DONE
          artifact: ".blazewrit/plans/feature-avatar-upload-plan.md"
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
  │   ├─ PASS → next step / FAIL → retry with feedback / attempt >= 3 → **HALT** (RETRY_EXHAUSTED)
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
| ground | Read, Grep, Glob, Bash | emberdeck | Read-only + bash for typecheck/test/lint/git 실행. 사실 캡처 |
| ground-reviewer | Read, Grep, Glob | — | Read-only. 사실 완전성·provenance·freshness 검증 |
| investigate | **WebFetch, WebSearch (외부)** + Read 한정 (rules + 이전 step artifact) | emberdeck (query only), Context7 | 프로젝트 *소스 코드* read 금지 (Ground 책임). 외부 리서치 + 이전 artifact는 허용. Read 도구의 path restriction = `allowed_paths: [CLAUDE.md, AGENTS.md, .claude/rules/**, .blazewrit/grounds/**, .blazewrit/investigations/**, .blazewrit/plans/**, .blazewrit/reports/**, .blazewrit/flow-state.yaml, .blazewrit/flow-history/**]` — hook으로 강제. 소스 코드 (src/**, lib/**, app/** 등) 위반 시 mechanical block. |
| investigate-reviewer | Read, Grep, Glob | — | Read-only. 영향·제약·위험·호환성 검증, 옵션·설계 prose 금지 |
| decide | Read, Grep, Glob, Write | emberdeck, pyreez | Write 한정 — decision record / plan / design document(Design mode). emberdeck intent card (Design만). pyreez deliberation (Plan/Design) |
| decide-reviewer | Read, Grep, Glob | — | Read-only. mode 일치, decision+rationale, 옵션 비교 (Plan), design document 완전성 (Design) |
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

Every step agent returns one of:

| Status | Meaning | Orchestrator action |
|--------|---------|-------------------|
| DONE | Step completed. Artifact produced + reviewer PASS | Write to state. Next step |
| BLOCKED | Cannot proceed | Write to state. Flow halt + escalate to user/caller |
| NEEDS_CONTEXT | Missing information | Write to state. NEEDS_CONTEXT → user/caller → step 재invoke |
| RETRY_EXHAUSTED | producer⇄reviewer 3회 fail | Write to state. **Flow halt + escalate** |

### Artifact Chain

Each step produces a defined artifact. Artifacts are **maps, not summaries** — findings + constraints + files_to_read. 다음 에이전트는 산출물(지도)을 읽고, files_to_read의 소스 코드를 직접 읽는다. 요약을 맹신하지 않고 코드를 직접 확인. (GSD `<files_to_read>` 패턴)

Missing artifact = natural failure (spec-kit pattern — adopted because it enforces order without extra machinery).

| Step | Produces | Consumed by |
|------|----------|-------------|
| Ground | task_subgraph + volatile_state + unknowns/conflicts + provenance + freshness (`.blazewrit/grounds/<flow-id>.md`) | Investigate (모든 flow) |
| Investigate | impact_map + constraints + risk_surface + compatibility_verdict + ground_unknowns_addressed (`.blazewrit/investigations/<flow-id>.md`) | Decide (모든 flow) |
| Decide | mode별 산출 — Record: decision_record / Plan: option_selection / Design: design document(`.blazewrit/plans/<flow-id>-plan.md`) + emberdeck intent card | Spec (있을 시), Test/Implement (Spec 없는 flow) |
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
                                       → iteration >= 3? → return RETRY_EXHAUSTED (halt, no proceed)
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

## Robustness Hardening

추가 검증으로 surface된 *근본 hole* 12개에 대한 명시 정책. 각 항목은 cross-cutting이라 step README가 아닌 여기에 산다.

### R1. Strict Schema Validation (Untyped YAML hole)

이전엔 prose schema만 — consumer가 mechanical validate 불가. 모든 step 출력 artifact는 **JSON Schema** (`.blazewrit/schemas/<step>.schema.json`)에 적합해야 한다.

- 각 step (Ground/Investigate/Decide/Spec/Test/Implement/Report/Verify/Reflect) 출력은 schema validator 통과 필수
- Orchestrator가 step 종료 시 mechanical validation 실행 — fail 시 reviewer 진입 전 producer retry
- Schema cap 추가: producer⇄schema 3-fail cap. 초과 시 `failure_origin: <step>` (schema mismatch)
- LLM 판단 우회. mechanical gate.

### R2. failure_origin enum에 `verify` 추가

Verify 자체가 잘못 판단할 수 있다 (false PASS, false FAIL). 라우팅 없으면 silent ship 또는 무한 retry.

- failure_origin enum: `triage | ground | investigate | decide | spec | test | implement | report | verify`
- Verify가 자기 판단 의심 시 (pyreez disagreement, post-hoc 증거 surface 등) → `failure_origin=verify` + escalate to user/caller
- 자기 자신으로 재라우팅 무한 cycle 방지: `verify` 라우팅은 *user/caller 응답 필수* (NEEDS_CONTEXT), orchestrator가 자동 재invoke 안 함
- pyreez disagreement detect: Verify의 internal multi-pass에서 pyreez cross-verify가 *반대 verdict* → `failure_origin=verify` 자동

### R3. Cap Arithmetic Bound (Total Invocation Cap)

기존 cap (3-fail/cycle, 5-total/step, 3-reclassify, 2-pivot, 1-retry, 1-upstream-deepen)들은 각자 local. 곱하면 unbounded 가능.

**Global flow caps** — `.blazewrit/config.yaml`:

```yaml
flow_caps:
  max_wall_s: 7200             # 2시간/flow
  max_tokens: 2_000_000        # 2M token/flow
  max_llm_calls: 500           # 500 invocations/flow
  max_compound_depth: 2        # nested Compound 최대 2-level
```

- Orchestrator가 flow_id별 누적 추적
- 초과 시 즉시 `flow halt + escalate`, `failure_origin=cap_exceeded`
- 모든 sub-flow (Compound 내부)는 parent의 cap을 *공유* (independent budget 아님)

### R4. Compound Nesting Depth Cap

Nested Compound는 N^k 호출 폭발 위험. **max_compound_depth=2** 강제.

- Sub-flow 분류 시 flow_type=compound이면 nesting_depth+1
- nesting_depth > max_compound_depth → Decide(Design)이 reject + flat 분해 강제 또는 user escalate
- Reflect에 nesting_depth 기록 → 장기 패턴 학습

### R5. Reviewer SPOF — pyreez Cross-Verification for High-Stakes

7 step reviewer는 단일 LLM = single point of failure. *High-stakes 결정*에선 cross-verify 필수.

| Trigger | 추가 검증 |
|---|---|
| Decide(Design) — architecture 영향 | pyreez `deliberate` cross-review (2nd opinion) |
| Investigate.compatibility_verdict=blocked | pyreez `deliberate` cross-review |
| Investigate.risk_surface severity=critical | pyreez `deliberate` cross-review |
| Spec → Implement에서 deviation rules 검출 | pyreez `deliberate` cross-review |

Cross-verify 결과 disagreement → producer retry with both feedbacks (3-fail cap 동일). agreement = PASS.

### R6. Decide Mode Upgrade Mechanical Force

이전엔 "옵션 N≥2 발견" = LLM 판단. 옵션 못 찾으면 silent Record.

**Mechanical force rules** (orchestrator가 *Investigate 출력 필드*에 평가 — 모두 schema 필드, LLM judgment 우회):
- `count(Investigate.compatibility_verdict.issues where severity ≥ medium) ≥ 2` → Decide mode = **Plan** 강제 (declared가 record여도)
- `any(Investigate.risk_surface where severity = high)` AND declared=record → **Plan** 강제
- `Investigate.impact_map.affected_files_count ≥ 5` AND declared=record → **Plan** 강제
- `Investigate.architecture_impact.has_architecture_level == true` → **Design** 강제 (declared 무관)

Investigate가 derive하는 필드 (`affected_files_count`, `architecture_impact.has_architecture_level`)는 [steps/investigate/README.md schema](./steps/investigate/README.md) 참조. Decide LLM은 force된 mode로 진입.

### R7. Triage Classification Eval

Triage 분류 정확도 측정 메커니즘:

- 매 flow에서 `triage_classification: { flow_type, confidence, reclassify_count }` 기록
- Reflect가 reclassify_count ≥ 1 = "misclassification signal"로 집계
- 주간 aggregate: `.blazewrit/flow-history/triage-accuracy.yaml` (flow_type × reclassify_rate)
- 임계값 (reclassify_rate > 30%) → 자동 Retro flow 큐잉 (signal table 개선 제안)
- A/B for signal table 변경: 새 rule 추가 시 prior baseline 대비 회귀 검출

### R8. Parallel Execution Spec

`orchestrator.ts` interface:

```typescript
interface ParallelGate {
  invoke_parallel<T>(tasks: AgentInvocation[]): Promise<T[]>
}
```

명시 parallel 적용 지점:
- **Ground.activities 1·2** (ED graph query + Volatile capture) — independent. Surface는 둘 위에서 sequential.
- **Compound sub-flow가 dependency-free**일 때 — Decide(Design).gate_rules가 `parallel: true`로 명시. dependencies (sequencing field)가 비어있는 sub-flows는 fan-out.
- **Investigate.External Research** — claim 단위 fan-out (rate limit 내).

병렬 실행도 global flow_caps (R3) 합산에 포함 (concurrent ≠ free).

### R9. Learning Loop Closure

Reflect → Tier 2 (.claude/rules/) 만으론 학습 closure 미완. 다음 추가:

- **Trigger Auto-Propose**: Tier 2에 N=5+ 동일 패턴 누적 시 Reflect가 *deepen trigger 변경 제안* `.blazewrit/proposals/<topic>.md` 생성. User review gate에서 승인 시 trigger table 자동 update.
- **Matrix Auto-Adjust**: Unknown Disposition matrix의 권장 disposition이 *반복 reject* 되면 (matrix_default=false 누적) → matrix 갱신 제안
- **Default Depth Auto-Tune**: flow_type별 default mode가 *반복 upgrade* 시 declared mode 갱신 제안

모든 자동화는 *propose-only* — user 승인 필요. ACE-style continuous learning, brevity bias 방지 (raw evidence 보존).

### R10. External Research Project Budget

Investigate 당 cap만으론 부족. 프로젝트 누적 budget 추가:

`.blazewrit/config.yaml`:

```yaml
external_research:
  tokens_per_day: 500_000
  requests_per_hour: 100
  cost_per_day_usd: 10
```

- Orchestrator가 daily 누적 추적 (`.blazewrit/usage.yaml`)
- 초과 시 Investigate의 external research = `unknown[external_inaccessible: budget_exceeded]` 처리
- daily reset (UTC midnight)
- A2A/CI/user 채널 공유

### R11. Cross-Flow State Coherence

여러 suspended flow 가 각자 stale fact 보유 가능. Resume 시 invalidate 필요.

**Stale detection on resume**:
- Resume 시 orchestrator가 `git_HEAD` 비교 (suspend 시점 vs now)
- diff 존재 → suspended flow의 Ground 출력 invalidate (volatile_state 만, task_subgraph는 ED snapshot 비교)
- ED snapshot version 비교 (ed_snapshot_version) — 변경 시 task_subgraph도 invalidate
- Invalidated facts → 해당 step 재invoke (Ground/Investigate 자동 재실행)
- Mid-flow stale도 동일: Decide/Verify 진입 시점에 source_version 비교

**Cap**: 재invoke 2회. 초과 시 flow halt + user에 "stale persists" escalate.

### R12. Tool Integration Contracts

`pyreez`/`firebat`/`emberdeck` 통합 contract를 별도 명시:

- `assets/tools/pyreez.md` — invoke signature, input schema, output schema, timeout (default 60s), rate limit, failure modes (model_unavailable / disagreement / timeout)
- `assets/tools/firebat.md` — scan invocation, blocker/warning severity 정의, exit code semantics, expandAffected 의미
- `assets/tools/emberdeck.md` — query_graph / create_card / validate_code_links / regression_guard 각 signature, ED graph schema reference, freshness metadata 정의

각 tool 부재 시 graceful degrade (이미 정의된 M4 분리) — 부재 시 정확히 어느 step·activity가 skip되는지 contract에 명시.

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
| **Plan quality** | 나쁜 design document → 완벽한 쓰레기. Decide(Design)의 서비스 architecture, 정책, 유저 플로우가 잘못되면 downstream 전부 잘못됨 | Decide-Reviewer + pyreez multi-model deliberation. Forced uncertainty marking. Anti-pattern examples |
| **Triage classification** | 유저 세션에서 호스트 LLM이 Triage 수행. 잘못 분류할 수 있음. A2A에서는 기계 분류 + LLM fallback | Signal table with concrete examples. Ambiguity → Analyze에 위임. 유저가 재분류 가능 (`orchestrator.ts reclassify`) |
| **유저 세션 훅 지시 따르기** | PostToolUse 훅이 다음 Agent 지시를 반환하지만 호스트 LLM이 따르지 않을 수 있음. A2A/CI에서는 해당 없음 (스크립트가 루프 구동) | 지시가 단순함 ("Agent(X) 실행"). Stop 훅이 미완료 flow 감지. prompt-enforced 범위가 최소 |

Note: 스텝 순서 보장, reviewer 실행 보장, state 업데이트는 더 이상 Known Limitation이 아님 — orchestrator.ts(스크립트)가 기계적으로 보장. GSD/gstack/spec-kit과 달리 호스트 LLM에 루프를 맡기지 않음.



## Tool Integration

### Per-Step Tool Mapping

| Step | emberdeck | firebat | pyreez |
|------|-----------|---------|--------|
| Ground | `query_graph` (subgraph 추출, freshness metadata 포함) | `scan --baseline` (volatile lint 부분, flow별 profile에서) | — |
| Investigate | `get_card_context`, `pre_change_check` | `query-dependencies` (Migration) | — |
| Decide | `create_card` (intent, **Design mode만**); 기존 카드 read (모든 mode) | — | `deliberate` (Plan/Design mode: 옵션 비교 / ideation / architecture) |
| Spec | `create_card` (spec), `codeLinks` | — | `deliberate` (complex spec) |
| Test | — | `scan` (after test code) | — |
| Implement | `validate_code_links`, `write_spec_annotations` | `scan` (every change, expandAffected) | — |
| Report | — | — | — |
| Verify | `regression_guard` (threshold=0) | `scan` (full project) | `deliberate` (review mode, high-risk) |
| Reflect | — | — | — |

### emberdeck Chain (Intent → Spec → Code → Verify)

```
Plan: create intent card (intent record)
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

### Tool Availability

Tool 부재 처리는 *상황별 분리*:

**Pre-flow Degrade (시스템 설정 차원)**: 도구가 *프로젝트에 설치 안 됨*. 알려진 부재 → graceful degradation 자동 활성:
- emberdeck 부재 → code-only analysis, text-only plans, no drift check (ED graph는 graphify로 대체 또는 disable)
- firebat 부재 → `test` + `typecheck` only (scan/blocker hook 비활성)
- pyreez 부재 → agent 단독 결정 (deliberation 없음)

**Mid-flow Escalate (invocation 차원)**: 도구가 *invocation 중 실패* (network/timeout/rate limit). 알려진 가용성 위반:
- Disposition matrix: `tool_unavailable` → escalate (compatibility blocked)
- Investigate가 *예상한* 도구 실패 → flow halt

**경계 명확**: degrade는 *flow 시작 전* 시스템 capability, escalate는 *flow 진행 중* 가용성 실패. 둘은 *서로 다른 케이스*이므로 disposition matrix와 graceful degradation rule 모두 정당.

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
│   ├── ground.md                 ← producer: Read/Grep/Glob/Bash, mcpServers:[emberdeck]
│   ├── ground-reviewer.md        ← reviewer: read-only, checks evidence completeness/provenance/freshness
│   ├── investigate.md            ← producer: WebFetch/WebSearch + Read(rules-only), mcpServers:[emberdeck,Context7]
│   ├── investigate-reviewer.md   ← reviewer: read-only, checks impact/constraints/risk/compatibility verdict
│   ├── decide.md                 ← producer: Read+Write, mcpServers:[emberdeck,pyreez], maxTurns
│   ├── decide-reviewer.md        ← reviewer: read-only, checks mode-decision alignment + rationale + followup dedup
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
                              ├─ claude --agent ground --print
                              ├─ claude --agent ground-reviewer --print
                              ├─ claude --agent investigate --print
                              ├─ claude --agent investigate-reviewer --print
                              ├─ claude --agent decide --print
                              ├─ claude --agent decide-reviewer --print
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
3. **Producer agents (9)** — ground.md, investigate.md, decide.md, spec.md, test.md, implement.md, report.md, verify.md, reflect.md. Custom agent frontmatter (tools, mcpServers, hooks, maxTurns, isolation) + prompt body (output contract, self-validation criteria, artifact format).
4. **Reviewer agents (7)** — ground-reviewer.md, investigate-reviewer.md, decide-reviewer.md, spec-reviewer.md, test-reviewer.md, implement-reviewer.md, report-reviewer.md. Read-only tools, review criteria, structured feedback format.

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
