# Failure Origin Routing

Verify가 변경 후 *어느 step에서 잘못됐는지* 진단하고 해당 step으로 reclassify/재실행.

## failure_origin Enum

```
failure_origin: triage | ground | investigate | decide | spec | test | implement | report | verify | cap_exceeded
```

`verify`와 `cap_exceeded`는 R2·R3 (Robustness Hardening) 참조 — orchestrator-level halt 트리거.

## Routing Rules

Verify FAIL 시 출력:

```
Verify FAIL →
  failure_origin: <enum>
  reason: specific issue description
  evidence: file:line or artifact reference
```

Host (orchestrator)가 failure_origin 읽고 해당 step의 produce ⇄ review loop 재진입:

| failure_origin | 처리 |
|---|---|
| `triage` | Triage 재invoke with prior_evidence (reclassify) — `reclassify_count` cap 3 |
| `ground` | Ground ⇄ Ground-Reviewer re-enters |
| `investigate` | Investigate ⇄ Investigate-Reviewer re-enters |
| `decide` | Decide ⇄ Decide-Reviewer re-enters |
| `spec` | Spec ⇄ Spec-Reviewer re-enters |
| `test` | Test ⇄ Test-Reviewer re-enters |
| `implement` | Implement ⇄ Implement-Reviewer re-enters |
| `report` | Report ⇄ Report-Reviewer re-enters — *비코드 flow (Review/Retro/Exploration/Spike/plan-standalone)에서만 유효*. 코드 flow에서 failure_origin=report는 invalid (Verify가 거부) |
| multiple origins | earliest problematic step first |

## Cap (무한 routing 방지)

- producer⇄reviewer 3-fail cap은 *단일 cycle*. reclassify로 재진입 시 fail counter reset
- (flow_id, step_name) **total fail count 5회 누적** → flow-level halt (reclassify 무한 loop 방지)
- Triage 재invoke (reclassify 트리거)는 **flow 당 최대 3회**. `reclassify_count` 추적. flow_id는 reclassify 시 *유지*. 3회 초과 시 flow halt + user/caller escalate
- Upstream deepen (Decide → Ground/Investigate): 1회만
- Compound pivot: 2회/Compound. Compound retry: 1회/sub_flow

## RETRY_EXHAUSTED → Reflect 분류

RETRY_EXHAUSTED → Reflect 분류는 **abandoned** (의도 외 termination). Reflect 실행 (학습 누적).

## Reflect 분류 종합

- `completed`: 모든 step 정상 종료
- `abandoned`: blocked / no_op / user abandonment / RETRY_EXHAUSTED
- `suspended`: NEEDS_CONTEXT 또는 active flow preempted

→ Reflect는 completed + abandoned에서 실행, suspended에서는 미실행.

## Stale ED 2nd Attempt Failure

cycle cap=1 후 2nd 재invoke에서도 stale 발견 시 → `failure_origin=ground` 신호로 Verify 위임 또는 flow halt + escalate (config). 무한 진행 금지.
