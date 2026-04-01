# Execution Plan

Status: Architecture finalized.

## Core Decision: Script Orchestrator

오케스트레이터는 LLM이 아니라 TypeScript 스크립트(orchestrator.ts). 루프가 기계적으로 보장됨.

**기각된 대안:**

| 대안 | 기각 이유 |
|------|----------|
| Rules only (prompt-enforced) | 호스트 LLM이 스텝을 건너뛰거나 reviewer를 빼먹을 수 있음 |
| Standalone CLI (GSD 방식) | Claude Code가 제공하는 것을 재구축. 유지보수 비용 |
| Background process (유저 세션) | 유저 상호작용 어색. 파일 IPC. 프로세스 관리 복잡 |

**채택 근거:** Ralph Loop (114줄 bash)이 증명 — 루프는 스크립트가 돌고, AI는 각 스텝에서 작업만 한다.

## Input Channels

| 채널 | 성격 | Triage | 오케스트레이터 구동 |
|------|------|--------|-------------------|
| A2A | 풀자동. 요청→결과 | server.ts 기계 분류 → 실패 시 claude 호출 | `orchestrator.ts run` (전체 루프) |
| CI | 풀자동. 트리거→결과 | 트리거 설정에 flow type 명시 | `orchestrator.ts run` (전체 루프) |
| 유저 세션 | 대화형. 유저가 보고 있음 | 호스트 LLM이 signal table로 분류 | `orchestrator.ts next` (훅 구동) |

채널 간 개입 없음. A2A는 풀자동 — 유저 개입 불필요, 불가. 개입이 필요하면 유저 세션을 쓴다.

## Execution Flow: A2A / CI

```
server.ts (또는 CI) → orchestrator.ts run feature "요청"
  │
  for step in flow.steps:
  │  attempt = 0
  │  while attempt < 3:
  │    │
  │    ├─ [새 세션] claude --agent {step} --print --dangerously-skip-permissions
  │    │    읽는 것: 원래 요청 + 이전 산출물 + (재시도 시 feedback)
  │    │    쓰는 것: .blazewrit/{category}/{flow-id}-{step}.md
  │    │
  │    ├─ Mechanical gate (typecheck, test — exit code)
  │    │    FAIL → attempt++, continue
  │    │
  │    ├─ [새 세션] claude --agent {step}-reviewer --print --dangerously-skip-permissions
  │    │    읽는 것: 산출물만 (producer의 추론 과정 없음)
  │    │    쓰는 것: PASS 또는 FAIL + feedback
  │    │
  │    ├─ PASS → break
  │    ├─ FAIL → feedback 저장, attempt++
  │    └─ attempt >= 3 → DONE_WITH_CONCERNS, break
  │
  │  update flow-state.yaml
  │  next step
  │
  ▼
Verify → Reflect → 완료 → 결과 반환
```

NEEDS_CONTEXT 발생 시:
- A2A: task status → `input-required`, 질문을 클라이언트 에이전트에 반환
- CI: 알림 전송, 대기
- 응답 수신 후: `orchestrator.ts resume --flow-id {id} --context "응답"`

## Execution Flow: User Session

```
유저: "아바타 업로드 기능 추가해줘"
  │
  ▼
호스트 LLM (orchestration.md 규칙):
  Triage → Clear signal → Feature
  Bash("bun .blazewrit/orchestrator.ts start feature '아바타 업로드 기능 추가'")
    → flow-state.yaml 생성
    → 반환: "Agent(analyze) 실행. prompt: ..."
  │
  ▼
호스트 LLM: Agent(analyze, prompt="...")
  → analyze 에이전트 실행 (fresh session)
  → .blazewrit/analysis/feature-001.md 작성
  │
  [PostToolUse(Agent) 훅 자동 발동]  ← 기계적
  → bun .blazewrit/orchestrator.ts next
  → orchestrator: 산출물 확인 → gate 실행 → 다음 = analyze-reviewer
  → 반환: "Agent(analyze-reviewer) 실행. prompt: '읽어라: ...'"
  │
  ▼
호스트 LLM: Agent(analyze-reviewer, prompt="읽어라: ...")
  → PASS
  │
  [훅 발동] → orchestrator next → 기획
  │
  ▼
호스트 LLM: Agent(기획, prompt="...")
  ...연쇄 진행...
```

### 유저 개입

| 상황 | 동작 |
|------|------|
| NEEDS_CONTEXT | 훅이 "유저에게 질문: ..." 반환 → 호스트 LLM이 유저에게 질문 → 응답 수집 → `orchestrator.ts resume` |
| 유저가 끼어듦 | Escape로 중단 → 유저와 대화 → "계속 진행해" → 호스트가 `orchestrator.ts next` 호출 |
| 재분류 | "이건 Refactor야" → 호스트가 `orchestrator.ts reclassify` 호출 |
| 취소 | "그만해" → 호스트가 `orchestrator.ts abandon` 호출 → Reflect 실행 |
| 비작업 요청 | "이 코드 설명해줘" → Triage: None → orchestrator 무관, 그냥 대화 |

### 호스트 LLM의 역할 (prompt-enforced 범위)

호스트 LLM이 하는 것은 3가지뿐:
1. Triage (signal table로 분류)
2. 훅이 반환한 지시를 실행 (Agent 호출)
3. NEEDS_CONTEXT 시 유저와 대화 후 resume

14 스텝 루프 관리가 아니라 단순 지시 따르기. prompt-enforced 위험 최소.

### Hook 구성

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Agent",
      "command": "bun .blazewrit/orchestrator.ts next"
    }],
    "Stop": [{
      "command": "bun .blazewrit/orchestrator.ts check-incomplete"
    }]
  }
}
```

- PostToolUse(Agent): 매 Agent 호출 후 자동으로 orchestrator.ts next 실행. active flow 없으면 no-op.
- Stop: 미완료 flow가 있으면 세션 종료 차단.

## Session Model

**항상 새 세션. 유지하는 경우 없음.**

| 컴포넌트 | 세션 | 이유 |
|----------|------|------|
| orchestrator.ts | 상태 유지 (스크립트) | 파일 기반, context rot 없음 |
| Producer agent | 매번 새 세션 | PEAK 품질, 이전 추론 앵커링 방지 |
| Reviewer agent | 매번 새 세션 | 독립 평가 필수 (self-consistency bias 방지) |
| 재시도 producer | 매번 새 세션 | 이전 시도의 사고방식에 갇히지 않기 위해 |

**근거:**
- Ralph Loop: "malloc/free problem — LLM has malloc but no free, so kill the process"
- Anthropic: "Fresh context > compaction"
- Anthropic: "Models consistently show positive bias when grading their own work" → reviewer는 반드시 fresh

**레퍼런스 비교:**

| 시스템 | 오케스트레이터 | 워커 |
|--------|-------------|------|
| Ralph Loop | bash 스크립트 | fresh per iteration |
| GSD | 호스트 LLM (세션 유지) | 서브에이전트 fresh |
| gstack | 호스트 LLM (세션 유지) | 공유 컨텍스트 |
| **blazewrit** | **스크립트** | **fresh per step** |

## Artifact Model: Map, Not Summary

산출물은 요약이 아니라 **지도**. 다음 에이전트가 뭘 읽어야 하는지 알려준다.

```yaml
# .blazewrit/analysis/feature-001.md
request: "아바타 업로드 기능 추가"
flow: feature

findings:
  - 파일 업로드 기존 구현이 src/api/upload.ts에 있음. 이 패턴을 따라야 함
  - JWT refresh가 커스텀 로직 (src/auth/token.ts:45-78). 세션 갱신 시 주의
  - 세션 미들웨어가 req.session에 직접 쓰는 패턴 (src/middleware/session.ts:23)

constraints:
  - S3 연동 필요 (기존 config: src/config/storage.ts)
  - 이미지 리사이즈는 서버사이드 (sharp 이미 설치됨)

blockers: none

files_to_read:
  - src/api/upload.ts
  - src/auth/token.ts:45-78
  - src/middleware/session.ts
  - src/config/storage.ts
```

**다음 에이전트는:**
1. 산출물(지도) 읽기
2. files_to_read의 소스 코드 직접 읽기
3. 요약을 맹신하지 않고 코드를 직접 확인

근거: GSD `<files_to_read>` 패턴 — "MUST use Read tool to load EVERY file listed before any action."

## Orchestrator State Machine

단순 for 루프가 아니라 상태 머신. Verify 실패 시 역방향 전이, 조건부 스텝, 반복 카운트 추적.

```
orchestrator.ts 내부:

  상태: flow-state.yaml
    - current_step
    - completed_steps (각 스텝의 산출물 경로)
    - attempt_count (현재 스텝의 시도 횟수)
    - verify_failures (Verify 실패 횟수)
    - status: active | suspended | completed | abandoned

  전이 규칙:
    step DONE         → flow-state 업데이트 → 다음 스텝
    step BLOCKED      → flow-state: suspended → 호출자에 반환
    step NEEDS_CONTEXT → flow-state: suspended → 호출자에 질문 반환
    attempt >= 3      → DONE_WITH_CONCERNS → 다음 스텝
    Verify PASS        → Reflect → completed
    Verify FAIL        → failure_origin 스텝으로 복귀
    Verify 3회 실패    → BLOCKED → 호출자에 반환

  플로우 정의: .blazewrit/flows/{type}.md에서 읽음
    - 스텝 순서
    - 조건부 스텝 (기획: 일부 플로우에서 생략)
    - 루프 조건 (Test⇄Implement 반복)
    - Verify 실패 라우팅
```

## Crash Recovery

**별도 메커니즘 불필요.** 기존 설계가 자동으로 해결.

| 항목 | 강제 종료 시 | 이유 |
|------|------------|------|
| 이전 스텝 산출물 | **안전** | 디스크에 파일로 확정 |
| 이전 스텝 커밋 | **안전** | git history |
| flow-state.yaml | **안전** | 스텝 사이에만 업데이트 → 마지막 완료 스텝을 가리킴 |
| 현재 스텝 산출물 | 없거나 미완성 | 에이전트가 끝까지 못 씀 |
| 현재 스텝 미커밋 변경 | 있을 수 있음 | 에이전트가 코드 쓰다 죽음 |

**재개:**
```
orchestrator.ts resume:
  1. flow-state.yaml 읽기 → 현재 스텝 확인
  2. 현재 스텝 산출물 존재 + STATUS 유효? → 완료로 판단, 다음 스텝
  3. 산출물 없거나 미완성 → 미커밋 변경 정리 (git checkout -- .) → 스텝 처음부터 재실행
```

worktree 격리 중이었다면: worktree 삭제 → 새로 생성 → 재실행.

매 스텝이 새 세션이고 이전 산출물만 읽으므로 재실행이 자연스럽다. 스텝은 idempotent.

## Orchestrator Interface

```
orchestrator.ts:

  [실행]
  run(flow, request)        A2A/CI: 전체 루프 실행
  next()                    유저 세션: 훅이 호출, 다음 스텝 반환
  start(flow, request)      flow 생성, 첫 스텝 반환

  [생명주기]
  resume(flow_id, context)  NEEDS_CONTEXT 후 재개 / crash 후 재개
  abandon(flow_id)          중단 + Reflect 실행
  reclassify(flow_id, new_flow)  플로우 재분류

  [조회]
  status(flow_id?)          상태 조회
  check-incomplete()        미완료 flow 존재 여부 (Stop 훅용)
```

A2A 중단: A2A 프로토콜의 `CancelTask` → server.ts가 orchestrator 프로세스에 SIGTERM → orchestrator가 현재 subprocess kill → 미커밋 변경 revert → flow-state: suspended.

## Verified Assumptions

| 가정 | 검증 | 근거 |
|------|------|------|
| `--print` multi-turn tool use | **검증됨** | Ralph Loop이 이 방식으로 코드 읽기/쓰기/테스트/커밋 수행 |
| `--dangerously-skip-permissions` | **검증됨** | Ralph Loop 프로덕션 사용 |
| 에이전트 출력 파싱 | **검증됨** | Ralph sentinel 패턴 (`<promise>COMPLETE</promise>` grep) |
| PostToolUse 훅 stdout → 대화 주입 | **검증됨** | GSD `gsd-context-monitor.js`가 이 방식으로 경고 주입 |
| mcpServers in CLI `--print` 모드 | **미검증** | 우회 가능: gate에서 CLI로 직접 실행. graceful degradation |
| PostToolUse 훅의 Agent 파라미터 접근 | **미검증** | 우회 가능: flow-state.yaml + 산출물 파일 존재 여부로 판단 |

미검증 2개 모두 우회 가능. 아키텍처 블로커 없음.

## Remaining Work

- [ ] orchestrator.ts 구현 (상태 머신, CLI, claude 호출, gate 실행)
- [ ] flow-state.yaml 스키마 확정
- [ ] 각 에이전트 산출물 스키마 (지도 포맷) 확정
- [ ] Triage 기계 분류 로직 (server.ts용)
- [ ] server.ts A2A 프로토콜 구현
- [ ] orchestration.md (호스트 LLM 규칙: Triage + 훅 지시 따르기)
- [ ] 14개 에이전트 프롬프트 작성
- [ ] 16개 플로우 정의 파일 작성
