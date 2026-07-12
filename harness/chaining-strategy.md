# Workflow Chaining Strategy (DRAFT)

> Status: **DRAFT — parked.** 2라운드 멀티에이전트 리뷰(추론-조립 토너먼트)에서 수렴한 모델 기록. 구현 전 설계 동결본.

## 결정
**모델 = 그래머-제약 추론 조립 (H).** 에이전트가 태스크마다 *런타임 추론*으로 워크플로우를 조립하되, **고정 안전 그래머 안에서만**.
- 열거형 고정 flow(F) 아님 — `situation-space.md`가 "provably incomplete" 자체 증명.
- 자유 조립(R) 아님 — 실증 실패(멀티에이전트 실패율 41~86.7%, 비구조 fan-out 에러 17.2배).

## 두 층
### 불변 (기계강제 그래머 — 추론이 못 어김)
- spine: `ground → investigate → decide → ⟨core⟩ → verify → reflect`
- 필수 게이트 = 그래머 터미널: producing 스텝마다 producer⇄reviewer; mutation이면 verify 필수; reflect 종단.
- 순서 + 종료조건.

### 가변 (추론이 채우는 슬롯)
- `⟨core⟩` 선택: `(SPEC test_impl) | test_impl | REPORT | ε`
- test 위치: bugfix=TEST(재현) 먼저 / feature=TEST⇄IMPLEMENT / P0=IMPLEMENT 먼저+사후 TEST
- 스텝별 mode/depth (대부분 flow_type+risk에서 결정적)
- **의존성 호출 판단**: 의존 프로젝트를 A2A로 부를지 (contextId 유지)

## 그래머 (초안 EBNF)
```
work_flow      ::= GROUND INVESTIGATE DECIDE body REFLECT
body           ::= producing_core VERIFY?          (* mutation이면 VERIFY 필수 *)
producing_core ::= (SPEC test_impl) | test_impl | REPORT | ε
test_impl      ::= (TEST IMPLEMENT)* | IMPLEMENT | TEST
```

## 스텝 계약 (스텝마다 assembly_contract)
machine-readable: `requires{needs_fields}` · `produces{key_fields}` · `use_when`/`do_not_use_when` · `result_enum`+`result_routing` · `primary_tools`(부재→escalate)/`enhancement_tools`(부재→degrade) · `gate{mode,mandatory}` · `depth_policy` · `boundary_out`. → 기존 Boundary 표/schema의 *기계 투영*(발명 아님).

## 조립 흐름 (태스크당)
1. (전제) plane 라우팅 + stateful triage → work-shape plane만 R로
2. 태스크 분석 → flow_type **seed** (고정 선택 아님)
3. 후보 스코핑 → 결정점당 **3~7개** (전체 노출 시 7~85% 선택붕괴)
4. 합성 → StepDef[] (그래머-valid)
5. 유효성 검사 (G1~G5) → 통과 or degrade
6. **plan-then-execute**: UI에 plan 전모 렌더 → 승인(저위험 자동 / 고위험 drawer inbox)
7. generic executor 실행; result enum = 런타임 재라우팅

## 가드레일 G1~G5
- G1 골격 그래머 검사 (비순응 체인 reject)
- G2 계약 join 검사 (requires.needs_fields vs 선행 produces.key_fields)
- G3 필수 게이트 강제 (게이트=그래머 터미널 + schema-immutable)
- G4 후보 스코핑 (선택붕괴+pⁿ 동시 차단: 추론 결정 ≈2~3개 → 0.93³≈80%)
- G5 degrade 사다리 (조립/검사 실패 → 절대 침묵 실행 안 함)

## degrade 사다리
확신 조립 → 예시 차용(기존 flow base) → 보수 조립(최얕은 valid 골격) → 명료화(drawer inbox) → escalate/refuse

## 숫자 (선례)
결정점당 후보 3~7 · 체인 깊이 ≤10에서 인간 게이트 · fan-out ≤4 · 오류는 검출-후-강등(침묵 아님).

## 전제 (선행 필수)
- **stateful triage** (현재 stateless stub, 7개 중 4개만 라우팅)
- **plane 라우팅** (work-shape는 ~14 plane 중 1개)

## 이미 지어진 것 (~70%)
10 스텝 계약, `harness/schemas`, 캡/게이트, generic `StepDef[]` 실행기(flows=순수 data). 남은 것: 조립 가이드(그래머)·후보 스코핑·join 검사기·게이트 삽입 규칙.

## 자기개선 (나중, 선택)
reflect → 검증 통과한 합성 체인을 "승격 템플릿"으로 메모이제이션(전제 아님; 추론은 1일차부터 동작).
