# Workflow Plan

Status: Architecture finalized. Final design: 8 steps, 6 reviewers, 16 flows, produce ⇄ review loop pattern, Analyze + 기획 + Spec separation.

## Architecture

```
None (자유 대화/논의) ↔ Triage → Flow[Analyze → 기획? → Spec? → Core Steps → Verify → Reflect]
```

- **None**: Free conversation state. 사용자가 뭘 할지 모를 때 에이전트와 대화/논의. Actionable signal이 나오면 Triage가 Flow로 전환. 논의 중 결정된 내용은 Flow 진입 시 context로 상속.
- **Triage**: Not a step. Pure classification — signal table matching + suspended flow check. 분석 안 함. Clear signal → 즉시 라우팅. Implied/Ambiguous → Analyze에게 위임. Multi-concern → Compound. No signal → None 유지.
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
| Analyze | 이해. 코드 분석, 의존성 매핑, 영향 범위, 제약 조건, 리서치. 깊이는 플로우 정의가 결정. Triage에서 Implied/Ambiguous signal 분류도 담당. |
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

## Triage — Classification Logic

Signal table for flow routing. Not a step — executed as entry logic.

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

| Strength | Criteria | Action |
|----------|----------|--------|
| Clear | Input contains explicit action verb + target ("fix the NPE in auth.py", "add avatar upload") | Immediate routing, no scan |
| Implied | Input describes problem/goal without explicit action ("auth is slow", "we need better caching") | Route to Analyze for investigation → Analyze returns classification |
| Ambiguous | Input has no actionable target ("something feels off", "let's think about this") | None. Free conversation (논의) until signal strengthens |

### None ↔ Flow Transition Rules

| Transition | Trigger | Action |
|------------|---------|--------|
| None → Flow | User states actionable intent ("let's do it", "make this", "fix that") | Triage classifies. Analyze inherits conversation context — skips re-analysis of discussed topics |
| None → Flow | Conversation naturally produces spec-level detail (files named, approach decided, scope defined) | Triage suggests flow entry. User confirms |
| Flow → None | User explicitly abandons ("never mind", "let's talk about something else") | Reflect(abandoned, reason) → update flow state → None |
| Flow → None | No flow-related input for 3+ consecutive exchanges | Triage suggests: continue flow or suspend? |

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

When transitioning None → Flow, Analyze inherits:
- **Inherit**: decisions made, constraints identified, scope discussed, files mentioned, approach agreed
- **Do not inherit**: abandoned ideas, rejected approaches, tangential discussion
- **Rule**: if information was established in conversation, Analyze references it rather than re-discovering it via scan

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

### Design Rationale

blazewrit is a **workflow rule set** installed into a project. The **host agent** (Claude Code main context, A2A server session, or user session) reads these rules and becomes the orchestrator. Each step is a **custom agent** (subagent) spawned by the host. blazewrit is not an agent itself — it is the operating system that governs how agents work in the project.

Not a CLI binary (GSD-2), not a tool collection (gstack), not a fixed pipeline (spec-kit), not an agent (it IS the rules).

Constraints:
- No subprocess exit codes (not a binary)
- Dynamic flow routing (16 flow types, not a fixed pipeline)
- Fully autonomous operation via A2A (no human-in-the-loop required)
- Human can intervene at any time (but is not required)

Enforcement is designed from blazewrit's constraints, not copied from reference systems. Where reference patterns are adopted, the reason is noted.

### Execution Model

```
Host Agent (main context — reads blazewrit rules, becomes orchestrator)
  │
  ├─ Triage (host internal — pure classification, no analysis)
  │
  ├─ Step execution → Produce ⇄ Review loop (Ralph Loop pattern)
  │   ├─ Step Agent (producer) = custom agent (.claude/agents/<step>.md)
  │   ├─ Step Reviewer Agent = custom agent (.claude/agents/<step>-reviewer.md)
  │   ├─ Loop: produce → mechanical gates → reviewer → PASS or retry
  │   ├─ tools/disallowedTools: per agent (mechanical)
  │   ├─ mcpServers: scoped per agent (firebat, emberdeck, pyreez)
  │   ├─ hooks: scoped safety hooks per agent
  │   ├─ maxTurns: runaway prevention per agent
  │   ├─ isolation: worktree (for high-risk Implement)
  │   ├─ files_to_read: previous step artifacts (file dependency)
  │   └─ return: completion status + output artifact
  │
  ├─ Verify → Flow-level goal verification (internal multi-pass, no reviewer)
  │   ├─ On FAIL: diagnoses failure_origin (dialogue|test|implement|report)
  │   └─ Host routes back to responsible step's produce ⇄ review loop
  │
  ├─ Step transition → Host reads return, updates state, spawns next agent/loop
  │
  └─ Global Hooks (safety + enforcement, in .claude/settings.json)
      ├─ PostToolUse(Edit|Write): firebat scan
      ├─ PostToolUse(Read|Grep|Glob): stuck detection counter
      ├─ PreToolUse(Bash(git commit*)): regression_guard
      ├─ Stop: blocker check + Reflect completion check
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

The host agent reads blazewrit rules (`.claude/rules/blazewrit/`) and becomes the orchestrator. Triage executes in the host context (needs conversation/request context). All steps including Analyze are delegated to custom agents.

Host agent responsibilities (governed by blazewrit rules):
- Run Triage classification (signal table matching + state file check, no analysis)
- Spawn step agents in flow-defined order with files_to_read
- Manage produce ⇄ review loops (spawn producer, check gates, spawn reviewer, handle PASS/FAIL)
- Read agent return (completion status + artifact)
- Update state file after each step transition
- Handle Verify failure routing (read failure_origin, route back to responsible step)
- Handle lifecycle events (suspend, resume, abandon)
- NEVER do step work directly — always delegate to step agents
- Context inheritance: when transitioning None → Flow, pass conversation context to Analyze agent via files_to_read or prompt injection

### Completion Status Protocol

Every step agent returns one of (gstack pattern — adopted because it covers all terminal states):

| Status | Meaning | Orchestrator action |
|--------|---------|-------------------|
| DONE | Step completed. Artifact produced | Write to state file. Next step |
| DONE_WITH_CONCERNS | Completed with issues | Write to state file. Next step, flag for Verify |
| BLOCKED | Cannot proceed | Write to state file. Escalate to user |
| NEEDS_CONTEXT | Missing information | Write to state file. Ask user |

### Artifact Chain

Each step produces a defined artifact. Next step's files_to_read points to it. Missing artifact = natural failure (spec-kit pattern — adopted because it enforces order without extra machinery).

| Step | Produces | Consumed by |
|------|----------|-------------|
| Analyze | Analysis summary (`.blazewrit/analysis/<flow-id>.md`) | 기획, Spec, or first core step |
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

### What Cannot Be Mechanically Enforced

Only items that are **pure judgment with no structural proxy**:

| Item | Why it's irreducible | Mitigation |
|------|---------------------|-----------|
| Triage classification | Interpreting user intent is judgment | Signal table with concrete examples. Ambiguity → delegate to Analyze |
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
| **Crash recovery** | On unexpected termination, detect incomplete state (lockfiles, partial state), restart from last committed checkpoint. Rate limit → auto-retry | PRODUCTION-TESTED: GSD-2 lockfile-based recovery, provider error handling | GSD-2 |
| **Self-consistency bias prevention** | Verify agent receives plan + code only. Never receives Implement agent's reasoning/explanation. Prevents Verify from confirming Implement's logic instead of independently evaluating | MEASURED: Anthropic "models consistently show positive bias when grading their own work" | Anthropic harness |
| **Host context reset** | For compound flows (3+ sub-flows), host orchestrator resets context between sub-flows. Reads fresh state from flow-state.yaml instead of accumulating | MEASURED: Anthropic "fresh context > compaction"; "context anxiety eliminated" with resets | Anthropic 4.6 |

Already in WORKFLOW_PLAN.md (not repeated): hooks (firebat scan, regression_guard, stuck detection, blocker check, Reflect gate, coverage gate), hook failure policy, maxTurns, worktree isolation, fix attempt limit (3), artifact chain validation.

### Context — Information Management

What each agent sees, when, and how degradation is prevented.

| Mechanism | What | Evidence | Source |
|-----------|------|----------|--------|
| **Context budget model** | Quality degrades with usage: 0-30% PEAK, 30-50% GOOD, 50-70% DEGRADING, 70%+ POOR. Tasks sized to complete within GOOD zone | PRODUCTION-TESTED: GSD plans target ~50% usage, 2-3 tasks max per plan | GSD |
| **Context pressure monitor** | PostToolUse hook injects warnings: 35% remaining = WARNING, 25% = CRITICAL ("save state, stop new work"). Host orchestrator only — step agents have fresh context | PRODUCTION-TESTED: GSD `gsd-context-monitor.js` PostToolUse hook | GSD |
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

Quality mechanisms are not a separate chain — they are embedded in the workflow's step transitions and repetition cycles. The workflow's [Test ⇄ Implement]* loop, [Implement → Verify]* loop, and compound [Flow → Gate]* loop ARE the quality loops. Each iteration spawns fresh agents (Ralph Loop pattern), and each transition enforces gates.

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
| **Host orchestrator fidelity** | Host is an LLM reading rules. Could misclassify in Triage, skip steps, or spawn wrong agents. Prompt-enforced | Artifact dependency causes natural failure on skipped steps. Hooks catch dangerous actions. flow-state.yaml tracks completion. But ordering is ultimately prompt-enforced |

These are inherent to autonomous LLM systems. Every reference system (GSD, gstack, spec-kit, Anthropic harness) has the same gaps — they use humans to close them. blazewrit uses pyreez multi-model + structural separation + mechanical gates instead. This is the best achievable without a human, not perfection.

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

blazewrit is a **workflow rule set**, not an agent, not a CLI, not a framework. It is installed into a project and governs how agents work in that project. The host agent reads blazewrit's rules and becomes the orchestrator. Step executors are custom agents spawned by the host.

### Why This Form

| Alternative | Why rejected |
|-------------|-------------|
| **Standalone CLI** (GSD-2 model) | Rebuilds what Claude Code already provides (hooks, agents, mcpServers). Maintenance cost of TypeScript+Rust SDK vs markdown files |
| **Claude Code plugin** | "Plugin subagents restricted (no hooks/mcpServers/permissionMode)" — blazewrit needs all three |
| **MCP server** | MCP exposes individual tools, not orchestrated workflows. firebat/emberdeck/pyreez are MCP servers; blazewrit orchestrates them |
| **Skill collection** (gstack model) | Skills share host context (context rot), no mcpServers scoping, no maxTurns, no worktree isolation. Step agents need all of these |
| **Agent** | blazewrit is not an agent — it is the rules that make the host agent behave as orchestrator. Making blazewrit an agent would add an unnecessary indirection layer |

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
├── .claude/settings.json          ← global hooks (blocker check, stuck detection, Reflect gate)
│
├── .blazewrit/
│   ├── config.yaml                ← gate_policy, flow settings
│   ├── flows/                     ← flow definitions (on-demand read, NOT context-resident)
│   │   ├── feature.md
│   │   ├── bugfix.md
│   │   ├── bugfix-p0.md
│   │   └── ...                    ← 16 flow files
│   ├── scripts/                   ← state utilities, validators, hook wrapper scripts
│   └── a2a/
│       └── server.ts              ← reference A2A server (thin entry point)
└──
```

**Context budget**: `.claude/rules/blazewrit/` (always loaded) is kept concise — Triage signal table + orchestration protocol only. Flow definitions live in `.blazewrit/flows/` and are read on-demand after Triage classifies. This follows GSD's phase-aware context loading pattern: load only what the current phase needs.

### A2A Integration

blazewrit is input-channel agnostic. The project's A2A server receives external requests and spawns a host agent session in the project directory. The host agent loads blazewrit rules (via `.claude/rules/`) and executes the workflow.

```
External Agent ──A2A──→ Project's A2A Server (.blazewrit/a2a/server.ts)
                              │
                              ↓
                        Host agent session (reads .claude/rules/blazewrit/)
                              │
                              ├─ Triage (classify request → read .blazewrit/flows/<type>.md)
                              ├─ Agent(analyze) ⇄ Agent(analyze-reviewer)
                              ├─ Agent(기획) ⇄ Agent(기획-reviewer) → 기획서
                              ├─ Agent(spec) ⇄ Agent(spec-reviewer) → AC + tasks
                              ├─ Agent(test) ⇄ Agent(test-reviewer) → tests
                              ├─ Agent(implement) ⇄ Agent(implement-reviewer) → code
                              ├─ Agent(verify) → goal verification
                              ├─ Agent(reflect) → learnings
                              │
                              ↓
                        Result ──A2A──→ External Agent
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
- Flow lifecycle rules added (start, suspend, resume, complete, abandon)
- Flow state persistence added (flow-state.yaml, list structure, archive)
- Execution protocol: step=custom agent, host reads rules and orchestrates, Triage pure classification
- Enforcement by consequence: dangerous→hook, role violation→allowed-tools, order→file dependency, conditional skip→hook gate, completion→Stop hook, quality→prompt+structure check, judgment→prompt only
- Design rationale documented: why each reference pattern was adopted or rejected
- Implementability verified against Claude Code capabilities: no nonexistent features assumed
- Design decisions 9-12 resolved: Reflect 3-tier distillation, non-impl completion criteria, worktree rollback, hook context detection
- Hook failure policy added: safety=fail-closed, enforcement=fail-open
- P0 retroactive test enforcement: scheduled trigger (mechanical) + SessionStart fallback (advisory)
- Gate policy storage location defined: `.blazewrit/config.yaml`
- Execution model changed: step = custom agent (not skill). Fresh context, scoped mcpServers/hooks/permissionMode/maxTurns/isolation
- blazewrit identity clarified: workflow rule set, not an agent. Host agent reads rules and orchestrates
- Delivery form factor defined: npm package deploys rules (.claude/rules/) + step agents (.claude/agents/) + hooks + scripts
- A2A integration: reference server provided, host agent session governed by blazewrit rules
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
- Known limitations: test quality, 기획 quality, host fidelity — with mitigations

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

### Step Agents + Reviewer Agents
1. Producer agents (analyze.md, 기획.md, spec.md, test.md, implement.md, report.md, verify.md, reflect.md) — 8 agents, custom agent frontmatter (tools, mcpServers, hooks, maxTurns, isolation) + prompt body (output contract, self-validation criteria, files_to_read)
2. Reviewer agents (analyze-reviewer.md, 기획-reviewer.md, spec-reviewer.md, test-reviewer.md, implement-reviewer.md, report-reviewer.md) — 6 agents, read-only tools, review criteria per output type, structured feedback format

### Orchestration Rules
2. Orchestration rules (.claude/rules/blazewrit/orchestration.md) — Triage + agent invocation + produce⇄review loop management + state file management protocol
3. Enforcement rules (.claude/rules/blazewrit/enforcement.md) — deviation rules, gate policy, decision classification

### Flow Definitions
4. Flow definition files (.blazewrit/flows/) — Analyze depth per flow, step order with reviewer pairs, loop conditions (repeat_when/stop_when/max), per-transition gates, Verify failure routing per flow

### Hooks
5. Safety hooks: firebat scan, regression_guard, stuck detection, blocker check
6. Enforcement hooks: Reflect gate (Stop), Reflect structure check, coverage gate
7. Hook wrapper scripts (fail-closed for safety hooks)

### Scripts
8. flow-state read/write utilities
9. Reflect structure validator (check required sections)
10. Coverage checker (for Refactor conditional Test gate)

### Design Decisions (Resolved)
9. ~~Reflect detail~~ → See "Reflect Detail" section (3-tier distillation, required sections, dedup rule)
10. ~~Non-implementation flow completion criteria~~ → See "Non-Implementation Flow Completion Criteria" section
11. ~~Rollback guidance~~ → See "Rollback and Failure Recovery" section (worktree isolation + escalation)
12. ~~Hook context detection~~ → See "Hook Enforcement > Hook Context Detection" (read flow-state.yaml)
