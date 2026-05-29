# Report — Deliverable Synthesis

## Definition

> **Report은 분석·조사·리뷰 결과를 deliverable로 합성한다.** 비코드 flow의 terminal artifact 산출.

사용 flow: Review, Retro, Exploration, Spike, plan-standalone, Compound (top-level summary).

## Inputs

- Investigate 출력 (findings, impact, risk)
- Decide 출력 (mode별 결정/옵션/설계)
- Ground 출력 (fact 근거)
- Flow-specific 추가 입력 (Spike: prototype 결과, Compound: sub-flow 결과)

## Activities

1. **Synthesize** — Investigate/Decide 산출물을 narrative로 합성
2. **Severity 분류** — Review/Retro의 findings에 severity 부여
3. **Action items** — followup_flows 추출 (Decide.followup_flows 연결)
4. **검증 trail** — 모든 claim에 evidence ref

## Output

```yaml
report_type: review | retro | exploration | spike | plan_standalone | compound
findings:
  - id, statement, severity, evidence_ref
action_items:
  - description, priority, owner?, followup_flow_ref?
based_on: { investigate_ref, decide_ref, ground_ref }
```

## Step Depth Policy

| Depth | 활동 | Caps |
|---|---|---|
| Shallow | summary (key findings 1-page) | wall_s=30, tokens=5k |
| Deep | full structured report (severity 분류 + action items + 검증 trail) | wall_s=180, tokens=15k |

**Deepen triggers**: flow_type ∈ {Compound, plan-standalone} | Investigate.findings.length ≥ 5 | Decide.mode=Design

## Reviewer (report-reviewer)

- findings에 severity + 증거가 있는가
- action items 존재 (Review/Retro: findings → followup_flows 매핑)
- claims이 검증됐는가 (evidence_ref 추적 가능)
- 비코드 flow terminal artifact 요건 충족

## Boundary

| 항목 | 책임 |
|---|---|
| 사실 캡처 | Ground |
| 해석·findings 생성 | Investigate |
| 결정·옵션 | Decide |
| 코드 변경 | Implement (Report은 비코드) |
| Flow-level 목표 검증 | Verify |

## Constraint — 코드 flow에서의 Report

코드 flow (Feature/Bug Fix/Refactor/Performance/Migration/Test/Chore/Release)에서는 *Report 단계 없음*. `failure_origin=report`도 코드 flow에선 invalid (Verify가 거부).
