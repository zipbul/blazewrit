# Compound Flow Recursion Contract

Compound flow는 *여러 sub-flow*를 묶어 처리. 각 sub-flow는 *자체 full chain* 실행.

## Recursion 구조

```
Compound (top-level)
  Ground → Investigate(sub_flow_identification) → Decide(Design: decomposition + ordering)
  ↓
  for each sub_flow in Decide.Design.sub_flow_sequence:
    [Sub-Flow self-execution]
      Triage(prior_evidence=parent compound) → Ground → Investigate → Decide → 
      [conditional Spec/Test/Implement] → Verify → Reflect (sub-flow level)
    ↓
    Gate (between sub-flows): proceed | pivot | abort | retry
  ↓
  Compound Report → Compound Verify → Compound Reflect (top-level)
```

## Sub-flow Identification 시점

- *식별*은 top-level Investigate (사실 기반: "이 작업이 N concerns")
- *분해/순서/gate criteria*는 top-level Decide(Design)
- *Dynamic N*: Review가 N bugs 발견 같은 경우 — Investigate가 N 식별 + Decide가 N 별 sub-flow 생성. Triage 시점 결정 안 함.

## Gate Criteria (sub-flow 사이 결정)

| Gate 결과 | 다음 |
|---|---|
| proceed | 다음 sub_flow 실행 |
| pivot | 잔여 sub_flow 재구성 (Compound Decide 재invoke) |
| abort | Compound flow halt, 부분 완료 sub-flow reflect |
| retry | 직전 sub_flow 재실행 (with deep upgrade) |

Gate criteria는 *top-level Decide(Design) 산출물*에 명시 (Triage 시점 아님).

## Gate Executor

Gate 평가 = **orchestrator 코드** (LLM 아님). top-level Decide(Design) 산출물의 `gate_rules: [{condition, action}]`를 mechanical 평가.

### Predicate DSL — JsonLogic 차용

새 DSL 만들지 않는다. **JsonLogic** (https://jsonlogic.com/) 형식 사용 — 검증된 mini-DSL, JS/TS/Python 라이브러리 존재 (`json-logic-js`).

**Condition 형식**:
```json
{ "operator": [operand1, operand2, ...] }
```

**허용 operator**: `==`, `!=`, `>`, `<`, `>=`, `<=`, `and`, `or`, `not`, `in`, `var` (path access)

**평가 컨텍스트** (orchestrator가 주입):
```json
{
  "sub_flow": {
    "id": "<sub_flow_id>",
    "type": "<flow_type>",
    "status": "completed|failed|aborted",
    "verify": { "result": "PASS|FAIL", "failure_origin": "<enum>" },
    "decide": { "mode": "record|plan|design" },
    "investigate": { "compatibility_verdict": { "result": "..." } }
  },
  "prior_sub_flows": [<sub_flow context list>]
}
```

**예시**:
```yaml
gate_rules:
  - condition: { "==": [{ "var": "sub_flow.verify.result" }, "PASS"] }
    action: proceed
  - condition:
      "and":
        - { "==": [{ "var": "sub_flow.verify.result" }, "FAIL"] }
        - { "==": [{ "var": "sub_flow.verify.failure_origin" }, "implement"] }
    action: retry
  - condition: { "==": [{ "var": "sub_flow.investigate.compatibility_verdict.result" }, "blocked"] }
    action: abort
```

### Validation

- `gate_rules` schema validate (R1): JsonLogic 문법 적합성 + action enum 검증
- Decide(Design) 산출 시 Decide-Reviewer가 gate_rules 평가 컨텍스트 매핑 검증 (var path가 실제 sub_flow output 구조에 존재)
- Invalid predicate → producer⇄schema 3-fail cap

LLM 호출 없음. 결정 deterministic. 단 *재invoke action* (pivot, retry)는 cap 적용.

## Pivot / Retry Cap

- `pivot` (Compound Decide 재invoke): Compound 당 **최대 2회** (무한 재분해 방지)
- `retry` (직전 sub_flow 재실행 with deep upgrade): sub_flow 당 **최대 1회** (cycle cap 적용)
- 초과 시: Compound flow halt + escalate.

## Compound State 추적

```yaml
flow_id: <compound_id>
type: compound
sub_flows:
  - sub_flow_id, type, status: pending|active|completed|failed|aborted
    parent: <compound_id>
    own_state: <link to sub_flow_id 자체 state>
    gate_result: proceed|pivot|abort|retry|null
sub_flow_sequence: [...]  # Decide(Design)이 정한 순서
current_position: index
```

## Sub-flow 자체 실행

각 sub-flow는 *full chain* 실행 (Triage→Ground→Investigate→Decide→...→Verify→Reflect). 자체 flow_state entry 가짐. parent compound와 linked.

### Sub-flow Triage 입력 — 명시 context inheritance

- `primary_input`: parent Compound의 request 또는 Decide(Design)에서 추출된 sub-task description
- `prior_evidence`: { parent_compound_id, prior_sub_flow_results, parent_classification_metadata }
- `channel`: parent와 동일 (user_session sub-flow는 user_session, A2A sub-flow는 A2A)
- `conversation_context`: parent의 conversation_context 상속 (user_session에서)
- `inherited_caller_credentials`: parent A2A의 credentials 상속 (A2A 자격 전달)
- `pre_approved`: parent에서 상속 (CI에서 sub-flow 자동 진행 허용)

### Sub-flow pre_approved scope re-check (security)

Sub-flow Triage가 *분류 직후*, **parent와 sub-flow 둘 다** `gate_policy.allow_pre_approval_flows`에 속해야 pre_approved 유지 (AND rule):

- Inherited `pre_approved=true` AND **parent.flow_type ∈ allow_list** AND **sub-flow.flow_type ∈ allow_list** → pre_approved 유지
- 위 셋 중 하나라도 false → **pre_approved 강제 false** + 로그 (privilege escalation 방지)

**의도**: parent든 sub-flow든 *둘 다* allowed flow 안에 있어야 우회 가능. 한쪽이라도 외면 차단.

예시:
- parent=Compound (allow list 외) → sub-flow=Release (allow list 내) → **차단** (parent가 list 외)
- parent=Release (allow list 내) → sub-flow=Release (allow list 내) → 유지
- parent=Release (allow list 내) → sub-flow=Feature (list 외) → **차단** (sub-flow가 list 외)

Compound parent가 Release sub-flow의 confirm gate 우회하려면 *직접 Release flow로 명시 진입* 필요.

## Completion Predicate

Compound 완료 조건:
- 모든 sub_flow.status ∈ {completed, aborted}
- 또는 명시 abort gate

Failure propagation: sub-flow status=failed → Compound flow pause for gate decision (retry/abort/pivot).
