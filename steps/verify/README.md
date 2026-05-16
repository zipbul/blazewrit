# Verify — Flow-Level Goal Verification

## Definition

> **Verify는 step reviewer가 아니다 — 플로우 전체가 목적을 달성했는지 검사한다.** 모든 16 flow에서 예외 없이 실행. Internal multi-pass (reviewer 없음 — 자체 검증).

## Inputs

- 전체 flow 산출물 (Triage → ... → 직전 step)
- 원래 request_text, conversation_context
- Spec.acceptance_criteria (코드 flow)

## Self-Misjudgment Detection (R2)

Verify가 자기 판단 의심하는 조건:
- pyreez cross-verify가 *반대 verdict* (PASS vs FAIL 불일치)
- Pass 3 adversarial이 Pass 1 mechanical 결과를 *뒤집을* 만한 증거 surface
- post-hoc 외부 신호 (사용자 reject, downstream failure 등)

→ `failure_origin=verify` 출력. orchestrator는 자동 재invoke 안 함, NEEDS_CONTEXT로 escalate.

## Internal Multi-Pass

### 코드 flow

1. **Mechanical**: typecheck + all tests pass + firebat blockers=0 + emberdeck drift=0
2. **Goal-backward**: original request → plan → tests → code, traces "what must be TRUE"
3. **Adversarial**: "how could this still fail? what did I miss?"
4. **pyreez cross-verification** for Pass 2-3 (high-risk flows)

### 비코드 flow

1. **Completeness**: required items present, evidence cited, measurements exist
2. **Goal-backward**: original request → output, does output answer the request
3. **Adversarial**: "this conclusion could be wrong because..."
4. **pyreez cross-verification** for Pass 2-3 (high-risk flows)

## Failure Routing

Verify FAIL 시:

```
Verify FAIL →
  failure_origin: triage | ground | investigate | decide | spec | test | implement | report
  reason: specific issue description
  evidence: file:line or artifact reference
```

→ Host (orchestrator)가 failure_origin 읽고 해당 step의 produce ⇄ review loop 재진입.

| failure_origin | 처리 |
|---|---|
| triage | Triage 재invoke with prior_evidence (reclassify) — reclassify_count cap 3 |
| ground | Ground ⇄ Ground-Reviewer re-enters |
| investigate | Investigate ⇄ Investigate-Reviewer re-enters |
| decide | Decide ⇄ Decide-Reviewer re-enters |
| spec | Spec ⇄ Spec-Reviewer re-enters |
| test | Test ⇄ Test-Reviewer re-enters |
| implement | Implement ⇄ Implement-Reviewer re-enters |
| report | Report ⇄ Report-Reviewer re-enters — 비코드 flow에서만 유효 |
| verify | Verify 자체 misjudgment 의심 (pyreez disagreement / post-hoc 증거). **자동 재invoke 안 함** — NEEDS_CONTEXT로 user/caller escalate 필수 (무한 self-route 방지) |
| cap_exceeded | global flow_caps (wall_s/tokens/llm_calls/compound_depth) 초과 — 즉시 halt + escalate |
| multiple | earliest problematic step first |

## RETRY_EXHAUSTED

Max iterations 도달 시 **flow halt + escalate**. silent proceed 금지. `DONE_WITH_CONCERNS` 출력 type 없음.

→ Reflect 분류: `abandoned` (학습 누적).

## Stale ED 2nd Attempt

source_version stale 검출 cycle cap=1. 2nd 재invoke에서도 stale 발견 시 → `failure_origin=ground` 신호 또는 flow halt + escalate (config).

## No Reviewer

Verify IS the flow-level evaluator. 별도 reviewer 추가 시 무한 recursion. 품질은 *internal multi-pass + pyreez cross-verification*으로 보장.

## P0 Post-Stabilization

P0 (bugfix-p0) Verify PASS 시 *자동 후속 flow 큐잉*:
- complexity_signal=high였거나 god_node 검출 시 → 자동 Bug Fix (Normal) flow with depth=deep
- 또는 Retro flow로 분석

## Boundary

| 항목 | 책임 |
|---|---|
| step 출력 review | 각 step의 reviewer |
| 학습 추출 | Reflect |
| 결정 변경 | Decide (Verify는 routing만, 결정은 안 함) |
