# Compound Flow

Multiple sub-flow orchestration. Top-level Decide(Design)이 sub_flow_sequence + gate_rules (JsonLogic) 정의. Sub-flow는 자체 full chain.

```yaml
steps:
  - name: ground
    reviewer: ground-reviewer
  - name: investigate
    reviewer: investigate-reviewer
  - name: decide
    mode: design
    reviewer: decide-reviewer
  - name: _sub_flows
  - name: report
    reviewer: report-reviewer
  - name: verify
    max_failures: 3
  - name: reflect
```

Sub-flow execution: `_sub_flows` 단계가 Decide(Design) 출력의 `sub_flow_sequence`를 읽고 각 sub-flow를 *자체 full chain*으로 실행 (orchestrator.ts `runCompound`). Gate evaluation = JsonLogic predicate ([steps/decide/compound-recursion.md](../../steps/decide/compound-recursion.md)).
