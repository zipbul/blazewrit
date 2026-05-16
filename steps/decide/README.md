# Decide — Decision Ownership (Universal)

## Definition

> **Decide는 Investigate 산출물 위에서 *결정의 책임자*다.** 모든 flow 필수 (skip 없음). 산출물 깊이는 flow별 *mode*로 선언. Mode = Record | Plan | Design.

## Inputs

- Investigate 출력 (impact_map, constraints, risk_surface, compatibility_verdict, ground_unknowns_addressed, sub_flow_identification?, triage_mismatch?)
- Ground 출력 (사실 근거)
- Triage 출력 (의도)
- request_text, conversation_context

## Mode 결정 방식 (Hybrid + Mechanical Force)

1. flow definition이 *기본 mode* 선언 (`decide_mode: record | plan | design`)
2. **Mechanical force (R6)** — orchestrator가 Decide 진입 전 강제:
   - `Investigate.compatibility_verdict.issues with severity ≥ medium ≥ 2` → **Plan** 강제
   - `Investigate.risk_surface contains severity=high` AND declared=record → **Plan** 강제
   - `Investigate.impact_map.affected_files.length ≥ 5` AND declared=record → **Plan** 강제
   - `Investigate output에 architecture-level 영향` (mechanical detect: 신규 module/디렉토리 제안 또는 public API 변경) → **Design** 강제
3. Decide LLM은 force된 mode로 진입. mode 발견 누락 hole 차단.
4. Decide 첫 활동 (force 없을 시): Investigate의 옵션 신호 검사
   - 옵션 1개 (자명) → declared mode 그대로
   - 옵션 N≥2 → declared가 record면 **plan으로 upgrade**
5. mode 확정 후 산출

**중요**: mode upgrade trigger는 *compatibility_verdict.result=proceed 또는 partial_proceed인 경우에만* 평가됨. result가 그 외 (blocked/needs_clarification/no_op)이면 *Decide 자체 미실행* — upgrade trigger가 halt 명령을 override 불가. Orchestrator가 mechanical 강제.

## Mode별 활동·산출

### Record mode (자명 결정)

**활동**: 결정 1개 + 근거 기록  

**산출**:
```yaml
mode: record
decision: <한 줄>
rationale: <Investigate 어느 사실에 근거>
based_on: { investigate_ref, ground_ref }
followup_flows?: [{ type: bugfix|refactor|feature, scope: <finding ref> }]   # Review 같은 audit flow 후속 처리
```

**flow 예**: Chore (typo fix), simple Bug Fix (single approach), Release (자명 version), Review (audit findings)

**Review followup**: Review flow의 Decide.Record가 review findings을 followup_flows array로 surface. `(type, scope_hash)` 기준 dedup 강제. Decide-Reviewer가 검증. 자동 실행은 안 함 — orchestrator가 queue.

### Plan mode (옵션 선택)

**활동**: 옵션 N개 비교 + 1 선택 + 우선순위/의존 ordering  

**산출**:
```yaml
mode: plan
options_considered: [{ id, approach, trade_offs, est_effort }]
chosen: { option_id, rationale }
sequencing?: [{ step, depends_on }]   # Compound sub-flow 순서, Migration cycle 순서 등
based_on: { investigate_ref, ground_ref }
```

**flow 예**: Bug Fix Unreproducible (hypothesis 우선순위), Refactor, Migration, Test, Spike, Retro, Exploration

### Design mode (전체 설계)

**활동**: 옵션 deliberation (pyreez) + architecture 결정 + policy/biz rule + 유저 플로우 + 요구사항 + intent card  

**산출**:
```yaml
mode: design
options_deliberated: [...]
chosen_architecture: { ... }
policies: [{ rule, scope, exceptions }]
user_flows: [...]
requirements: [...]
intent_card_id: <emberdeck card>
based_on: { investigate_ref, ground_ref }
gate_rules?: [{ condition, action }]   # Compound top-level 한정 — sub-flow 사이 gate 평가용
```

**flow 예**: Feature, Performance, plan-standalone, Compound (top-level)

## 도구 (mode별)

| Mode | emberdeck | pyreez | 외부 리서치 |
|---|---|---|---|
| Record | (기존 카드 read만) | — | — |
| Plan | (read), `create_card`(spec 단계로 미루어도 가능) | `deliberate` (옵션 비교) | optional |
| Design | `create_card` (intent), 기존 read | `deliberate` (architecture, ideation) | yes |

## Triage Mismatch 처리

Investigate가 `triage_mismatch`를 surface하면 Decide는:
- 즉시 reclassify trigger (orchestrator로 신호) — 새 flow type으로 Triage 재진입
- Decide 출력 = `reclassify_required` 특수 산출, 진행 안 함

Triage reclassify cap: flow 당 3회 (Triage README 참조).

## Upstream Deepen Request

Decide가 shallow Ground/Investigate 출력으로 결정 불가 시 → `request_upstream_deepen` 신호 → orchestrator가 해당 step 재invoke with depth=deep.

**Cycle cap**: upstream deepen 1회 (무한 cycle 방지). 그래도 부족 시 Verify가 final safety (`failure_origin=ground|investigate` → reclassify with depth=deep 강제).

## Adaptive Depth

Step Depth Policy 참조. Decide는 mode 자체가 depth (Record=shallow / Plan=medium / Design=deep):
- **Record**: wall_s=10, tokens=1k
- **Plan**: wall_s=60, tokens=10k
- **Design**: wall_s=300, tokens=30k

**Upgrade triggers** (Record → Plan, Plan → Design):
- → Plan: flow_type ∈ {Refactor, Test, Spike, Retro, Exploration} | Investigate.compatibility_verdict.issues.length ≥ 2 | Investigate.risk_surface contains severity=high
- → Design: flow_type ∈ {Feature, Performance, Migration, plan-standalone, Compound} | Investigate output에 architecture-level 영향 표시

## Reviewer (decide-reviewer)

- mode 일치 (declared vs 산출물)
- Record: 결정+근거 1쌍 이상
- Plan: 옵션 N≥2 비교 + 선택 이유 + 우선순위
- Design: design document (architecture+policy+userflow+req) + intent card 생성
- 모든 mode: decision_record + reason 필수
- ground·investigate 사실에 근거
- followup_flows dedup (`type` + `scope_hash`)
- Compound top-level: gate_rules 명시 + sub_flow_sequence 정의

## Boundary — Decide가 안 하는 것

| 항목 | 책임 |
|---|---|
| 새 사실 캡처 | Ground |
| 사실 해석 | Investigate |
| AC 추출 (구현 가능 형식) | Spec |
| 코드 변경 | Implement |
| 결정 *결과* 검증 | Verify |
| 학습 추출 | Reflect |

## Sub-policies

- [compound-recursion.md](./compound-recursion.md) — Compound flow recursion contract (sub-flow self-execution + gate executor + cap)
- [failure-routing.md](./failure-routing.md) — failure_origin enum + reclassify cap (Verify가 Decide 단계 결정 잘못 발견 시 라우팅)
