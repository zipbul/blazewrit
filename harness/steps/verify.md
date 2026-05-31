# Verify — Flow-Level Goal Verification

## Definition

> **Verify는 step reviewer가 아니다 — 플로우 전체가 목적을 달성했는지 검사하고 *flow-level verdict*를 낸다.** 모든 16 flow에서 예외 없이 실행. Internal multi-pass (전용 reviewer 없음 — 자체 검증 + cross-verify 완화). Verify는 *판정·라우팅 신호만* 내고, 후속 flow 큐잉·재invoke는 orchestrator가 한다 (경계: Verify는 flow를 만들지 않는다).

## Inputs

Verify가 받는 입력 (orchestrator가 주입). 필수 입력은 [Input preconditions](#input-preconditions)에서 존재+정형 assert.

- 전체 flow 산출물 (Triage → ... → 직전 step) — 각 step의 structured output
- 원래 `request_text`, `conversation_context`
- `Triage.flow_type` (16 정규 id 중 1), `Triage.complexity_signal` (high|medium|low|none)
- `Investigate.risk_surface` (severity: low|med|high|critical — **이 단일 척도만 사용**, 새 척도 발명 금지), `Investigate.architecture_impact.has_architecture_level`, `Investigate.impact_map.affected_files_count`
- `Ground.task_subgraph` (`ed_snapshot_version`, `god_nodes_in_scope`, `entry_nodes`) — freshness/race 재검 + P0 후속 신호 입력 (P8/P6: god_node는 Ground 생산 신호이므로 *받는다고 명시*)
- (코드 flow) `Spec.acceptance_criteria`, `Implement.firebat_results`, `Implement.emberdeck_drift`
- **`post_hoc_signal?`** (optional) — orchestrator가 *flow 완료 후* 외부에서 수신해 재invoke 시 주입하는 신호: `{ kind: user_reject | downstream_failure | external_regression, evidence }`. (P8: self-misjudgment trigger가 이 채널에 key를 걸므로 Inputs에 **명시 선언**. 없으면 trigger 미발화 — 정상.)
- **tool_status** — 하네스가 코드로 probe한 도구 가용성 (M2/G5): `{ firebat: present|absent|error, emberdeck: present|absent|error, pyreez: present|absent|error }`. Verify는 자기단언이 아니라 이 주입 fact로 분기 (M3 degrade-as-branch).

## Activities

```
1. Input precondition assert   필수 upstream 필드 존재+정형 검사 (P8) — 결손/기형이면 escalate
2. tool_status 분기 결정        firebat/emberdeck/pyreez 가용성 → mechanical/degraded/escalate 경로 선택 (P2, 원칙①)
3. Internal multi-pass          코드/비코드 flow별 3-4 pass 실행 (아래)
4. Multi-pass aggregation       pass 결과를 단일 verdict로 결합 (P1 집계규칙)
5. Goal-backward record 작성     모든 분기에서 "무엇이 TRUE여야 하나" 추적 기록 (P1: fail에서도 유지)
6. Result emit                  RESULT enum 1개 + 해당 분기 객체 출력 → orchestrator 라우팅
```

## Internal Multi-Pass

### 코드 flow

1. **Mechanical**: typecheck pass + all tests pass + `firebat blockers=0` + `emberdeck drift=0`. (firebat/emberdeck 부재·error 시 [Failure & degrade handling](#failure--degrade-handling) 참조 — 침묵 금지.)
2. **Goal-backward**: original request → plan → tests → code, "무엇이 TRUE여야 하나" 역추적. **이 기록은 PASS/FAIL/degraded 전 분기 출력에 포함** (P1: fail에서 빼지 말 것).
3. **Adversarial**: "어떻게 아직도 실패할 수 있나? 무엇을 놓쳤나?"
4. **pyreez cross-verification** — Pass 2-3 검증, **high-risk flow에서만 강제** ([high-risk flow 정의](#high-risk-flow-정의)). pyreez = enhancement 도구 (P5/P2): 부재 시 degraded_pass, 불일치 시 verify escalate.

### 비코드 flow (Review / Retro / Exploration / Spike / plan-standalone)

1. **Completeness**: required items present, evidence cited, measurements exist, terminal artifact 존재+substantive (Spike는 GO/NO-GO/CONDITIONAL verdict 포함 등 flow별 completion 기준 — flows/README §Non-Implementation 참조).
2. **Goal-backward**: original request → output, output이 요청에 답하는가. (기록 전 분기 유지 — P1.)
3. **Adversarial**: "이 결론이 틀릴 수 있는 이유는…"
4. **pyreez cross-verification** — Pass 2-3 검증, high-risk flow에서만 강제.

## Result enum & branches

> P1 (success branch): Investigate.compatibility_verdict의 discriminated-result 패턴을 재사용 — **성공 분기를 실패 분기와 동일하게 명시 선언**. Verify는 정확히 하나의 `result`를 내고, orchestrator가 라우팅 테이블로 분기한다.

```
result: pass | fail | degraded_pass | blocked | retry_exhausted
```

| result | 의미 | 동반 필수 객체 |
|---|---|---|
| `pass` | 모든 pass 통과, 목적 달성 | `pass_record` |
| `degraded_pass` | enhancement 도구(pyreez) 부재로 cross-verify 없이 internal multi-pass만으로 PASS 판정 (P2/P5, 원칙①) | `pass_record` + `degrade_note` |
| `fail` | 1개 이상 pass 미통과 → 특정 step에 귀착 | `failure_origin` 객체 |
| `blocked` | 자기 게이트 도구(firebat/emberdeck) mechanical error/timeout, 또는 stale-2nd, 또는 input-precondition fault — Verify가 자기 일을 못 함 (원칙①·③, 게이트 부재→escalate) | `escalation` 객체 |
| `retry_exhausted` | producer⇄reviewer 또는 (flow_id,step) 누적 fail cap 도달, 또는 cap_exceeded | `escalation` 객체 |

### `pass_record` (P1: PASS 출력 객체 — 이전엔 미정의)

`result ∈ {pass, degraded_pass}`일 때 필수. Reflect가 받는 `Verify 결과(PASS/...)`의 실체.

```yaml
pass_record:
  result: pass | degraded_pass
  flow_id
  flow_type
  schema_version: 1
  verified_at: ISO8601
  goal_satisfied: true                 # self-asserted truth — cross-verify로 완화만 (환원불가 residual)
  goal_backward:                        # Pass 2 산출 — 전 분기 유지 (P1)
    - assertion: <"무엇이 TRUE여야 하나">
      held: true
      evidence: <file:line | artifact ref>
  pass_results:                         # 집계 입력 — 투명성 (P1 aggregation 근거)
    mechanical: pass | n/a               # 비코드 flow면 completeness
    completeness: pass | n/a
    goal_backward: pass
    adversarial: pass                    # surface된 우려가 verdict를 뒤집지 않음을 명시
    cross_verify: pass | omitted         # pyreez 결과 (omitted = degraded)
  source_version:                       # freshness 재검 (race detection)
    ed_snapshot_version: <hash>          # Ground.task_subgraph.ed_snapshot_version과 동일
  signals:                              # orchestrator 행동 트리거 (Verify는 신호만 — 큐잉 안 함)
    post_stabilization?: <follow_up_signal>   # P0 전용, 아래 참조
```

### `degrade_note` (degraded_pass 전용)

```yaml
degrade_note:
  degraded_tool: pyreez
  reason: tool_unavailable | tool_timeout | mandatory_but_unavailable   # mandatory_but_unavailable = high-risk flow인데 강제 pyreez 부재 (verdict는 여전히 degraded_pass)
  mitigation: "internal multi-pass(mechanical+goal-backward+adversarial)로 verdict 도출 — cross-verify leg 부재"
  quality_floor: "verdict는 pyreez 없이도 well-defined; cross-verify 완화는 없음(약화)"   # P5 정직 강등
```

## Multi-pass aggregation rule (P1)

> 이전 README는 3-4 pass를 *나열*만 하고 결합 함수가 없었다. 결정 함수를 명시한다.

1. **any-fail → fail**: 어느 pass라도 명확한 결함을 surface하고 **그것이 특정 step(들)에 귀착 가능**하면 `result=fail`. `failure_origin`은 결함이 귀착하는 step (아래 [Failure routing](#failure-routing)). (귀착 불가한 diffuse 결함은 fail이 아니라 [Self-misjudgment](#self-misjudgment-detection-r2)의 `unattributable_goal_failure` → blocked.)
2. **all-pass → pass**: 모든 실행된 pass가 통과하면 `result=pass`.
3. **pyreez 부재로 cross-verify pass가 *생략*된 경우**(omitted) — 나머지 pass 전부 통과면 `result=degraded_pass` (fail 아님; P2 원칙①).
4. **Pass 3 adversarial이 Pass 1 mechanical을 *뒤집을* 만한 증거를 surface한 경우** — mechanical이 PASS여도 aggregation은 *fail로 본다*. 단 그 증거가 (a) 특정 step에 귀착하면 `result=fail` + 해당 `failure_origin`; (b) **Verify 자신의 판단을 의심**하게 만들면 (pyreez 불일치 또는 자기 mechanical 결과를 신뢰 못 함) → [Self-misjudgment](#self-misjudgment-detection-r2) 경로 = `result=blocked` + `escalation(failure_origin=verify)`. (P1: "self-suspicion의 결과 verdict"가 이전엔 미정의 — 여기서 blocked/verify-escalate로 확정.)
5. **Compound flow**: sub-flow별 verdict를 모으되 동일 any-fail/all-pass 규칙을 *전체*에 적용 — 어느 sub-flow fail이면 flow fail.

### Trigger precedence (P1: 동시-발화 결정성)

> 위 규칙은 *개별* 트리거만 정의했다. 한 invocation에서 result-결정 트리거가 *여럿 동시* 참일 수 있다 (예: mechanical이 `failure_origin=implement` 결함을 surface AND firebat=error AND pyreez=disagreement). 그때 emit할 단일 `result`를 **결정적으로** 고른다. 더 낮은 번호가 이긴다 (first-match wins) — Verify가 *자기 일을 못 하는* 조건이 *downstream에 귀착하는 깨끗한 판정*보다 우선한다 (원칙①·③: 자기 게이트가 깨졌으면 그 위에서 내린 fail 귀착 자체를 신뢰할 수 없으므로 producer step으로 misroute 금지).

1. **retry_exhausted** — producer⇄reviewer cycle cap / (flow_id,step) 5-누적-fail / global `cap_exceeded` 도달 → `result=retry_exhausted` (다른 어떤 트리거보다 우선; 이미 cap 소진이면 재진입 자체 무의미).
2. **blocked (input-precondition fault)** — [Input preconditions](#input-preconditions) 결손/기형 → `result=blocked`. (chain/입력이 malformed면 그 위 모든 pass 결과가 신뢰 불가.)
3. **blocked (gate-tool mechanical error)** — firebat/emberdeck `error`/timeout → `result=blocked` + `escalation(failure_origin=verify)`. (게이트가 verdict를 못 냄 → mechanical leg이 신뢰 불가 → 그 위 fail 귀착도 보류.)
4. **blocked (stale-2nd)** — [Stale ED 2nd Attempt](#stale-ed-2nd-attempt) 조건 → `result=blocked` + `escalation(failure_origin=ground)`.
5. **blocked (self-misjudgment)** — pyreez `disagreement` 또는 aggregation rule 4b 또는 `post_hoc_signal` → `result=blocked` + `escalation(failure_origin=verify)`.
6. **fail** — 위가 모두 거짓이고 어느 pass라도 step-귀착 결함 surface → `result=fail` (rule 1/4a).
7. **degraded_pass** — 위가 모두 거짓이고 pyreez만 부재(omitted)로 cross-verify leg 생략, 나머지 통과 → `result=degraded_pass` (rule 3).
8. **pass** — 위가 모두 거짓 → `result=pass` (rule 2).

(pyreez-부재 vs other-fail collision은 이 순서로 자동 해소: fail(6)이 degraded_pass(7)보다 우선이므로 "다른 pass가 fail이면 degraded_pass 아님"이 rule 3의 "나머지 pass 전부 통과면"과 정합.)

## Failure routing

`result=fail`일 때 출력하는 `failure_origin` 객체. (P1: `pass_record`처럼 self-describing envelope를 가진다 — orchestrator가 객체만으로 flow_id/version에 상관할 수 있게. PASS는 식별자를 들고 FAIL은 안 드는 비대칭 제거.)

```
failure_origin_obj →
  flow_id                                # pass_record와 동일 식별자
  flow_type
  schema_version: 1
  verified_at: ISO8601
  source_version: { ed_snapshot_version: <hash> }   # freshness 상관 (pass_record.source_version과 동형)
  failure_origin: triage | ground | investigate | decide | spec | test | implement | report | multiple
  reason: specific issue description
  evidence: file:line | artifact reference
```

→ Host(orchestrator)가 `failure_origin` 읽고 해당 step의 produce ⇄ review loop 재진입. (decide/failure-routing.md 재사용 — 새 메커니즘 0.)

| failure_origin | 처리 |
|---|---|
| `triage` | Triage 재invoke with prior_evidence (reclassify) — `reclassify_count` cap 3 |
| `ground` | Ground ⇄ Ground-Reviewer re-enters |
| `investigate` | Investigate ⇄ Investigate-Reviewer re-enters |
| `decide` | Decide ⇄ Decide-Reviewer re-enters |
| `spec` | Spec ⇄ Spec-Reviewer re-enters |
| `test` | Test ⇄ Test-Reviewer re-enters |
| `implement` | Implement ⇄ Implement-Reviewer re-enters |
| `report` | Report ⇄ Report-Reviewer re-enters — **비코드 flow에서만 유효** (코드 flow에서 `failure_origin=report`는 invalid → Verify가 거부) |
| `multiple` | **earliest problematic step first** (아래 ordering 정의) |

### "earliest" ordering 정의 (P8: 이전엔 모호)

`failure_origin=multiple`일 때 "earliest"는 **그 flow의 flows/README 체인 정의 상의 step 순서**로 결정 (chain order, 좌→우). 코드/비코드 flow가 체인이 다르므로 **해당 flow_type의 실제 체인**을 기준 source로 본다 (flows/README가 단일 source — M4). 예: 코드 flow는 `triage < ground < investigate < decide < spec < test < implement`; 비코드 flow(Review/Retro/Exploration/plan-standalone)는 `triage < ground < investigate < decide < report`. 가장 좌측(earliest) step을 `failure_origin`으로 단일 선택하고 나머지는 `reason`에 부기. (earliest부터 고치면 downstream 결함이 재생산되며 자연 해소 — re-entry cap이 ping-pong을 bound.)

## Self-Misjudgment Detection (R2)

Verify가 *자기 판단*을 의심하는 조건 (→ `result=blocked` + `escalation(failure_origin=verify)`):

- **pyreez cross-verify가 *반대 verdict*** (PASS vs FAIL 불일치) — pyreez *disagreement*. (P2: 이건 degrade가 아니라 *불일치* → `failure_origin=verify` escalate, NEEDS_CONTEXT. pyreez 부재와 구분.)
- Pass 3 adversarial이 Pass 1 mechanical을 *뒤집을* 만한데 특정 step에 귀착 안 됨 (aggregation rule 4b).
- **임의의 pass(goal-backward 포함)가 명확한 결함을 surface하나 (a) 특정 single step에 귀착 불가 *그리고* (b) `multiple`로 여러 step에 분해 불가** (diffuse goal-not-met — 전체 flow가 목적을 못 냈는데 어느 step 탓인지 Verify가 정당화 못 함). 이건 4b의 일반 case다: step locus 없는 결함은 Verify가 producer를 *추측*해 misroute하지 않고 → `result=blocked` + `escalation(failure_origin=verify, reason=unattributable_goal_failure)`로 user/caller escalate. (원칙: 귀착 못 할 결함을 임의 step에 떠넘기지 않음 — in-lane.)
- **`post_hoc_signal`** 수신 (Inputs에 선언된 채널): user_reject | downstream_failure | external_regression. flow가 이미 PASS였는데 외부 신호가 그 판정을 반박 → Verify가 자기 과거 판정을 의심.

→ orchestrator는 `failure_origin=verify`를 **자동 재invoke 하지 않음** — `NEEDS_CONTEXT`로 user/caller escalate (무한 self-route 방지). (제어신호 소유권 원칙②: Verify는 `request_upstream_deepen`을 *쓰지 않는다* — 그건 Decide 전용. 모든 degenerate/모호 upstream은 기존 `failure_origin` escalate로만 라우팅.)

## Failure & degrade handling

> P2 + 원칙①: 도구 역할로 갈린다. *게이트* 도구(firebat/emberdeck) mechanical 실패 → **escalate(blocked)**. *enhancement* 도구(pyreez) 부재 → **degraded_pass 분기**. M3 degrade-as-branch + R12 failure_modes 재사용 — 침묵 0.

### firebat (Mechanical gate — primary, 원칙①)

| tool_status.firebat | Verify 동작 |
|---|---|
| `present` | `blockers > 0` → mechanical FAIL → `failure_origin=implement`. `blockers = 0` → mechanical leg pass |
| `error` (exit 2 / MCP unreachable / timeout) | **게이트가 verdict를 못 냄 → `result=blocked` + `escalation(failure_origin=verify, reason=firebat_unavailable)`** (principle 1: primary gate → escalate; unknown-disposition.md `tool_unavailable→escalate`와 일치) |
| `absent` (프로젝트 미설치 — firebat.md degrade) | 문서화된 fallback: `typecheck + all tests pass`로 mechanical leg 판정. degrade이지 escalate 아님 (구성상 부재 ≠ 게이트 고장). `pass_record.pass_results.mechanical`에 fallback 표기 |

### emberdeck (Mechanical gate — primary, 원칙①)

| tool_status.emberdeck | Verify 동작 |
|---|---|
| `present` | `drift > 0` → mechanical FAIL → `failure_origin=implement` (card↔code drift). `drift = 0` → pass |
| `error` | **`result=blocked` + `escalation(failure_origin=verify, reason=emberdeck_unavailable)`** (principle 1) |
| `absent` (미설치 — emberdeck.md degrade) | codeLinks/drift check disabled — drift leg 생략, mechanical은 typecheck+test+firebat로 판정. degrade 표기 |

### pyreez (cross-verification — *enhancement*, 원칙①)

| 상황 | Verify 동작 |
|---|---|
| `present` + 결과 `consensus ∈ {agreement, mixed}` | cross_verify leg = pass, 정상 aggregation |
| `present` + 결과 `consensus = disagreement` | **pyreez 불일치 → `result=blocked` + `escalation(failure_origin=verify)`** = self-misjudgment (P2: disagreement는 degrade가 *아님*) |
| **high-risk flow** + `absent` / `error` / `timeout` | **degraded 분기**: cross_verify leg = omitted → `result=degraded_pass` (나머지 pass 통과 시) + `degrade_note`. (P2/P5 원칙①: pyreez는 *강제여도* enhancement다 — "강제"는 *시도 의무*이지 *성공 전제*가 아니다. 도구 부재는 escalate 아니라 degrade. `degrade_note.reason`에 `mandatory_but_unavailable` 표기해 low-risk-omitted와 *구분*은 하되 verdict는 동일 `degraded_pass`.) |
| **not high-risk flow** + `absent` / `error` / `timeout` | pyreez 미강제 — 처음부터 omitted 처리, `result=pass` 그대로 (degrade 아님; cross-verify가 애초 필수 아니므로). |

### "No reviewer / quality guaranteed" 강등 (P5)

Verify는 flow-level evaluator 자체다 — 별도 reviewer를 더하면 무한 recursion. **이전 README의 "품질은 internal multi-pass + pyreez cross-verification으로 *보장*된다"는 과장이었다 (pyreez 부재 시 그 보장이 조용히 붕괴).** 정직 강등:

- 품질은 **internal multi-pass(LLM 자기판정)** + **high-risk flow에서 cross-verify(pyreez)로 *완화*** 된다. *보장(guarantee)*이 아니라 *완화(mitigation)*.
- **verdict는 pyreez 없이도 well-defined** — pyreez 부재는 `degraded_pass` 분기로 명시 처리되며, mechanical + goal-backward + adversarial 3 pass만으로 결론을 낸다. cross-verify는 *추가 완화 leg*일 뿐 verdict 성립의 전제가 아니다.
- 환원불가 residual: `goal_satisfied: true`는 self-asserted truth — grammar/cross-verify가 *완화*하나 *제거*하지 못한다 (정직한 바닥).

## high-risk flow 정의

> 이전 README는 "high-risk flow"가 pyreez cross-verify(및 line-77 보장)를 gate하는데 *미정의*였다. 기존 신호만으로 닫는다 (새 척도·새 state 발명 금지 — Investigate.risk_surface 단일 척도 재사용).

flow는 다음 중 **하나라도** 참이면 high-risk (→ pyreez cross-verify 강제):

- `Investigate.risk_surface`에 `severity ∈ {high, critical}` 항목 존재, **또는**
- `Investigate.architecture_impact.has_architecture_level = true`, **또는**
- `Investigate.impact_map.affected_files_count ≥ 5` (pyreez.md "5+ affected files" 자율 trigger와 정합), **또는**
- `Triage.complexity_signal = high`, **또는**
- `Ground.task_subgraph.god_nodes_in_scope` 비어있지 않음, **또는**
- `flow_type ∈ {Migration, Performance, Compound}` (breaking surface / 측정 회귀 / 다-sub-flow — 본질적 고위험), **또는**
- P0 flow에서 위 god_node/complexity 조건 충족.

그 외 flow는 *not high-risk* — pyreez cross_verify는 omitted이며 이것은 degrade가 아니라 *정상 PASS* 경로다 (원칙③: legitimately-omitted ≠ missing).

## Input preconditions

> P8 (garbage-in 견고성, 횡단 절): Verify는 upstream이 항상 깨끗·존재·정형이라 가정하지 않는다. 필수 입력의 *존재+정형*을 assert (진실성은 assert 안 함 — 그게 Verify의 본업이지 precondition 아님). 결손/기형은 mechanical error → escalate.

Verify 진입 시 다음을 검사:

| precondition | 결손/기형 시 |
|---|---|
| 전체 flow 산출물 chain이 직전 step까지 존재 + 각 step의 result enum이 정형 | `result=blocked` + `escalation(failure_origin=verify, reason=upstream_chain_malformed)` |
| `Triage.flow_type`가 16 정규 id 중 하나 | 상동 (`reason=invalid_flow_type`) |
| (코드 flow) `Spec.acceptance_criteria` 존재 + non-empty | 상동 (`reason=missing_acceptance_criteria`) — **이것은 "정당하게 빔"이 아니라 "결손"이다 (원칙③). 빈 AC를 PASS로 고무도장 금지** |
| `Ground.task_subgraph.ed_snapshot_version` 존재 | 상동 (`reason=missing_freshness`) |
| (P0 후속 신호 키잉 시) `Ground.task_subgraph.god_nodes_in_scope` 필드 존재 (빈 list는 OK — "god node 없음"은 정당한 사실) | 필드 자체 부재면 `reason=missing_god_node_signal` |

**구분 (원칙③)**: 비코드 flow에서 `Spec.acceptance_criteria` *부재*는 결손이 아니다 (비코드 flow는 Spec 없음) — flow_type별 chain에 Spec이 있는 flow에서만 필수. *변경이 clean해서* mechanical이 깨끗한 것 = 정당한 PASS; *upstream이 깨져서* 빈 것 = escalate. 절대 후자를 전자로 rubber-stamp 안 함.

ping-pong 안전: input-precondition escalation은 `failure_origin` re-entry + **(flow_id, step) 5-누적-fail halt cap** (decide/failure-routing.md)이 bound하므로 무한 루프 불가.

## RETRY_EXHAUSTED

Max iterations(producer⇄reviewer cycle cap, 또는 (flow_id,step) 5-누적-fail, 또는 global `cap_exceeded`) 도달 시 → `result=retry_exhausted` + `escalation`. **flow halt + escalate. silent proceed 금지. `DONE_WITH_CONCERNS` 출력 type 없음.**

`escalation` 객체:

```yaml
escalation:
  flow_id                                # self-describing envelope (failure_origin 객체·pass_record와 동형 — escalate도 객체만으로 flow 상관 가능)
  flow_type
  schema_version: 1
  verified_at: ISO8601
  source_version: { ed_snapshot_version: <hash> }
  cause: verify_self_misjudgment | gate_tool_unavailable | stale_2nd_attempt | input_precondition_fault | retry_cap | cap_exceeded
  failure_origin?: verify | ground       # *step-id 도메인만* (verify=self-misjudgment, ground=stale_2nd_attempt). 자동 재invoke 안 함. **cap 계열(cause ∈ {retry_cap, cap_exceeded})은 단일 step에 귀착 안 되므로 failure_origin 생략** — cap 의미는 `cause`가 운반 (failure_origin enum을 cause 값으로 오염시키지 않음; field-type 일관).
  reason
  evidence
```

→ Reflect 분류: `cause ∈ {cap_exceeded, retry_cap}` (또는 `result=retry_exhausted`) → `abandoned` (학습 누적). `failure_origin=verify` self-misjudgment escalate(NEEDS_CONTEXT) → `suspended` (Reflect 미실행).

## Stale ED 2nd Attempt

`source_version` stale 검출 cycle cap=1 (원본 + 재invoke 1회 = 총 2 attempts). 2nd 재invoke에서도 stale 발견 시 → `result=blocked` + `escalation(failure_origin=ground, cause=stale_2nd_attempt)` 또는 flow halt + escalate (config). 무한 진행 금지. (compatibility-verdict.md stale 책임 표와 정합.)

## P0 Post-Stabilization (Verify SIGNALS, orchestrator queues)

> 경계 (P0 보강): **Verify는 후속 flow를 *만들지 않는다*. 신호만 낸다.** orchestrator가 신호를 읽고 큐잉. (Verify가 flow를 create하면 Report/Verify 경계 위반.)

P0(bugfix-p0) flow가 `result ∈ {pass, degraded_pass}`이고 다음 조건 충족 시 `pass_record.signals.post_stabilization` 신호 emit:

```yaml
post_stabilization:                         # Verify는 이 신호만 출력 — 큐잉은 orchestrator
  triggered_by: high_complexity | god_node   # Triage.complexity_signal=high 였거나 Ground.god_nodes_in_scope 비어있지 않음
  suggested_followup: bugfix_normal | retro   # 권고 — 실제 큐잉/실행 결정은 orchestrator
  suggested_depth: deep                       # bugfix_normal일 때
  evidence: <god_node ref | complexity ref>
```

- orchestrator가 `post_stabilization` 신호를 읽고 → Bug Fix (Normal) flow(depth=deep) 또는 Retro flow를 *자동 큐잉* (Review flow follow-up과 동일 메커니즘 재사용 — flows/README §Review follow-up). 자동 *실행*은 user/CI 결정.
- (입력 정합 P8: `god_node` 신호는 Inputs에 선언된 `Ground.task_subgraph.god_nodes_in_scope`에서만 읽는다 — Verify가 새로 캡처하지 않음.)

## Boundary

| 항목 | 책임 |
|---|---|
| step 출력 review | 각 step의 reviewer (Verify는 flow-level만) |
| 학습 추출 | Reflect |
| 결정 변경 | Decide (Verify는 routing 신호만, 결정 안 함) |
| 새 사실 캡처 (god_node, ed_snapshot) | Ground (Verify는 *받아서 읽기*만) |
| **후속 flow 생성/큐잉** | **Orchestrator** (Verify는 `signals.post_stabilization` *신호*만 — flow를 create/queue 하지 않음) |
| `request_upstream_deepen` 발행 | **Decide 전용** (원칙②: Verify는 절대 발행 안 함 — degenerate upstream은 `failure_origin` escalate로) |
| upstream 사실의 *진실성* 판단 외 *존재/정형* assert | Verify (input precondition, P8) — 단 *의미상 틀림*은 환원불가 residual |

## Depth

Verify는 flow의 risk에 따라 multi-pass 깊이를 조정:

- **shallow** (not high-risk flow): mechanical + goal-backward + adversarial 3 pass, pyreez 미강제(omitted=정상). caps: wall_s=30, tokens=6k.
- **deep** (high-risk flow): 3 pass + pyreez cross-verify 강제. Bug Fix Unreproducible는 extended observation 포함. caps: wall_s=180, tokens=20k.

deepen은 [high-risk flow 정의](#high-risk-flow-정의) 조건으로 mechanical 결정 (LLM 재량 아님).
