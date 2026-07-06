# Spec — Acceptance Criteria + Code Architecture

## Definition

> **Spec은 Decide 출력에서 *구현 가능한 형식*을 추출한다.** Decide가 어느 mode로 냈든 — Design의 design document, Plan의 option_selection + sequencing + rationale, Record의 decision + rationale — 그 안에 *이미 담긴* 정책·요구사항·접근을 측정 가능한 AC + 코드 architecture (디렉토리/파일 설계, 모듈 경계, 의존 관계) + task 분해 + 의존성 + 순서로 변환한다. **(P4: Decide 3 mode 전체에 일반화 — 정체성을 Decide(Design)에 결박하지 않는다.)**

Plan-as-prompt: Spec 출력이 곧 downstream(Test/Implement) 실행 프롬프트.

**Spec은 결정·설계를 *다시 하지 않는다*.** AC는 Decide가 *이미 선택·결정한 것*을 implementable form으로 푸는 것이지, 새 정책·새 architecture 선택·새 옵션을 만드는 것이 아니다. Decide가 어떤 architecture를 골랐으면 Spec은 그것을 파일/모듈/의존으로 *기계적으로 전개*할 뿐, 다른 architecture를 제안하지 않는다. **(P4 / Boundary: Spec ≠ Decide. design re-derivation 금지.)**

## Inputs

- **Decide 출력 (필수, mode 무관)** — Spec은 셋 중 무엇이든 받아 AC를 추출한다 **(P4)**:
  - `mode=design`일 때: design document (chosen_architecture, policies, user_flows, requirements, intent_card_id)
  - `mode=plan`일 때: option_selection (`chosen`), `options_considered`, `sequencing`, rationale
  - `mode=record`일 때: `decision`(한 줄) + `rationale`
- Investigate 출력 (constraints, risk_surface, compatibility_verdict.issues) — *optional enrichment* (edge_case 우선순위·제약 출처). greenfield 등 Investigate degenerate 체인에서는 비어 있을 수 있다.
- Ground 출력 (task_subgraph, volatile_state) — 실재 path/심볼 근거.
- 모든 ref는 §5 RowRef (Postgres step_runs row id) — `based_on.{decide_ref, investigate_ref, ground_ref}`.

**Mode별 AC 추출 규칙 (P4: Design 전용 가정 제거)**:

| Decide mode | AC 추출 원천 | intent-card 링크 |
|---|---|---|
| design | `policies[]` + `requirements[]` + `user_flows[]` → 각각 1+ AC | `intent_card_id` 존재 → spec card가 link (조건부) |
| plan | `chosen.approach` + `sequencing[]` → 구현 단위별 AC; `options_considered`는 *맥락만* (재선택 금지) | intent card 없음 → spec card는 **degrade(omitted)** 가능 |
| record | `decision` 한 줄 → 그 결정을 만족시키는 최소 AC(들) | intent card 없음 → spec card **degrade(omitted)** 가능 |

> **intent-card 링크는 Design 조건부다.** `decide.intent_card_id`가 존재할 때만 spec card가 그 intent card에 codeLink로 연결된다. Plan/Record는 intent card가 없으므로 링크 활동 자체가 *없음* — 부재가 에러가 아니다. **(P4: intent-card linkage = Design-conditional)**

## Activities

1. **AC 추출** — Decide가 mode 무관하게 *결정·확정한* 정책/요구사항/접근을 측정 가능한 acceptance criterion으로 변환 (id, statement, measurement, edge_cases). 새 정책·설계를 만들지 않는다. **(P4)**
2. **코드 architecture 설계** — 디렉토리/파일 배치, 모듈 경계, 의존 그래프. 실재 path 사용 (`change_kind` ∈ create|modify|read). Decide가 architecture를 골랐으면 그것을 전개; 안 골랐으면(Plan/Record) chosen approach + Ground task_subgraph로부터 *전개*하되 새 architecture를 *선택*하지 않는다.
3. **Task 분해** — implementable 단위로 쪼개기 (single concern per task). id, description, depends_on, ac_refs, file_paths, parallel_marker.
4. **순서·의존** — task ordering, blocking relation (acyclic 강제 — M2 validator가 topological sort).
5. **(Design 조건부) emberdeck spec card + codeLinks** — `decide.intent_card_id`가 존재할 때만, spec card를 생성하고 design document의 intent card에 link. emberdeck 부재/실패 시 degrade. **(P4 조건부 + P2 enhancement degrade)**

## Result enum & branches (P1: 성공 분기를 실패 분기와 *함께* 선언)

> Spec 출력은 `result` discriminant 위의 **discriminated union**이다 — Investigate의 compatibility_verdict (proceed | blocked | needs_clarification | no_op) 패턴을 *그대로 재사용*한다 (새 메커니즘 발명 0). 한 branch만 채워진다(grammar 강제). **(P1: success branch를 first-class로 선언; P7/principle 3: 빈-합법 vs 빈-결손 구분)**

| result | 의미 | payload (필수 필드) | orchestrator 처리 |
|---|---|---|---|
| **proceed** | 정상 spec 산출 (유일하게 AC/architecture/tasks/spec_card_id를 담는 branch) | `acceptance_criteria` (≥1), `code_architecture`, `tasks` (≥1), `spec_card_id` | Spec → Test/Implement 진입 |
| **needs_clarification** | HITL 답 없이 finalize 불가 (legacy `[NEEDS CLARIFICATION]`, **per-invoke max 3**) | `clarifications: [{ question, blocked_decide_item, source_tool }]` (1–3) — `blocked_decide_item`은 forward AC id가 아니라 backward Decide-원천 ref다 (필드 정의는 ↓ "clarifications payload 정의") | NEEDS_CONTEXT → user 응답 후 Spec 재invoke. clarification은 *재invoke 시점에 새로 산출*되며 max 3은 **per-invoke(누적 아님)**: 매 invoke는 그 시점 미측정 distinct 항목을 ≤3개만 surface한다(↓ S5의 per-invoke maxItems:3). 재invoke ping-pong은 (flow_id, step) 5-누적-fail halt cap이 bound한다(↓ "Failure & degrade handling"). Reflect 분류 = suspended |
| **blocked** | upstream 계약이 불충족/상충/누락 (대개 Spec 자기 잘못 아님) — 단 decomposition_overflow는 Spec 자기 예산 소진 | `blocked_reason` ∈ {conflicting_policy, missing_upstream, compatibility_blocker, decomposition_overflow}, `detail`, `attributed_step` ∈ {decide, investigate, ground, cap_exceeded}, `overflow_subcode` ∈ {count_overflow, caps_exhausted, ambiguity_overflow} (decomposition_overflow일 때 **필수**, 그 외 부재 — 세 overflow trigger 구분; ↓ "AC/task 폭발") (decide/investigate/ground = Spec의 upstream producer만 — self/downstream/triage 금지; cap_exceeded = self/budget 제어값, decomposition_overflow 전용; StepName + FailureOrigin.cap_exceeded), `source_tool` (attributed_step의 도구 family — decide/investigate/ground일 때 **필수**; cap_exceeded는 생산 도구가 없어 *emit 자체를 생략* — ↓ "branch source_tool 값공간") | `failure_origin=<attributed_step>`로 escalate — orchestrator가 해당 step ⇄ reviewer 재진입; cap_exceeded는 halt+escalate(sub-flow 분할) (failure-routing) **(P8 / principle 2)** |
| **no_op** | spec 낼 게 *합법적으로* 없음 | `reason` ∈ {non_code_flow, no_implementable_surface}, `detail`(no_implementable_surface(S3)면 **필수** — zero-surface 확정의 감사 가능 증거; non_code_flow면 optional), `source_tool` (Decide 도구 family — S3(no_implementable_surface)면 **필수**(정형 Decide verdict이므로 실재 Decide 원천); S2(non_code_flow)면 **optional/emit-면제** — 비코드 flow는 Decide surface 없이 triage-routed될 수 있어 날조 방지; ↓ "branch source_tool 값공간"). **S2는 detail·source_tool이 모두 면제라 emit 페이로드만으로는 자가-감사 불가** — bare `{result, reason}` S2 no_op의 "비코드" 판정은 *emit된 Spec 증거 필드가 아니라 upstream Triage/Decide row에 대해* 감사된다(↓ x-validator-contract `result(no_op).reason=non_code_flow (S2 auditability)`): Triage가 비-구현 flow_type으로 라우팅했거나 Decide row가 코드-bearing surface를 갖지 않을 때만 합법 S2이고, upstream이 코드 surface를 담는데 S2를 낸 것은 코드 flow를 비코드로 조용히 punt한 S4 결손이다 → flag. | Spec → Test → Implement *skip*. Reflect 분류 = abandoned/completed (flow별) |

**branch source_tool 값공간** (blocked/no_op의 `source_tool` — open SourceTool floor지만 값공간은 *문서화*됨; AC/clarification의 닫힌 enum과 구분):
- **blocked** `source_tool` = `attributed_step`의 도구 family. `attributed_step=decide` → `{design-document, plan-chosen, record-decision}`; `attributed_step=investigate` → `{compatibility-verdict}` (Investigate compatibility/verdict 도구의 핀된 식별자); `attributed_step=ground` → `{ground-capture}` (Ground capture 도구의 핀된 식별자). 즉 세 attribution 모두 Decide의 세 닫힌 값과 동형으로 *구체 값공간이 핀*된다 — 자유 문자열이 아니다. `attributed_step=cap_exceeded`(decomposition_overflow) → 생산 도구가 없으므로 `source_tool`을 *emit하지 않는다*(grammar if/then이 cap_exceeded일 때 source_tool 부재를 강제 — 정의된 값공간 없는 값을 날조하지 않는다). (즉 decide/investigate/ground 귀속에서는 막은 producer의 출처 도구이지 자유 문자열이 아니다 — schema x-validator-contract가 attribution과 묶어 강제; cap_exceeded만 emit 면제.)
- **no_op** `source_tool` = no_op의 source_tool은 *값공간이 닫힌 Decide enum* `{design-document, plan-chosen, record-decision}`으로 **M1 grammar에서 핀된다**(AC/clarification source_tool과 동일하게 allOf+enum으로 좁힘 — blocked처럼 attribution-의존 open floor가 아니라 항상 Decide 원천이므로). S3(no_implementable_surface)면 *Decide 결정 자체가 구현 0을 확정한* 정형 verdict이라 source_tool은 **필수**다(grammar if/then). S2(non_code_flow)는 flow가 *애초에 비코드*라 Decide가 design/plan/record surface를 내지 않은 채(triage-routed) Spec에 도달할 수 있으므로 — 존재하지 않는 생산 도구를 *날조*하지 않도록 — `source_tool`을 **emit하지 않을 수 있다**(optional; cap_exceeded emit-면제와 동형). 단 *있으면* 반드시 닫힌 세 Decide 값 중 하나이고(자유 문자열 불가 — M1이 핀), 없으면 triage-routed 비코드(생산 Decide 도구 없음)로 취급한다. grammar if/then이 S3일 때만 source_tool 부재를 불법화하고, allOf enum이 (S2/S3 무관) 존재 시 값공간을 강제한다. (blocked source_tool은 attribution-의존 open floor라 M2가 값공간을 핀하지만, no_op은 닫힌 Decide enum이라 M1이 직접 핀한다 — 차이.)

**branch 선택 규칙 (mechanical, V1-V13 류)**:
- S1. Decide 출력이 구현 가능한 surface를 담고(어느 mode든) AC 추출이 1개 이상 가능 → **proceed**.
- S2. flow가 비코드/문서/exploratory라서 *원래* 구현 surface가 없음(예: Decide.Record가 "문서만 갱신" 같은 합법적 non-code 결정) → **no_op(non_code_flow)**. *합법적 빔* — escalate 아님. **(principle 3)**
- S3. Decide가 코드 flow이고 Decide payload이 *정형으로 존재*하는데, 그 결정이 *합법적으로* 새 구현 surface를 요구하지 않음(예: Decide.Record가 "현 동작 유지 — 변경 불필요" 또는 "기존 코드로 이미 충족"을 결정 → create/modify 대상 파일이 0) → **no_op(no_implementable_surface)**. *합법적 빔*(결정 자체가 "구현 없음"을 가리킴) — escalate 아님. S2와의 구분: S2는 flow가 *애초에 비코드*, S3는 flow는 코드성이나 *이번 결정이 구현 surface를 0으로 확정*. **(principle 3: legitimately-empty = verdict)**
- S4. Decide가 코드 flow인데 implementable surface가 *전혀 안 나옴*(예: design document·option·decision이 모두 텅 비었거나 상충 — 즉 Decide payload이 결손/기형/상충) → **blocked** with `blocked_reason=missing_upstream`(텅 빔) 또는 `conflicting_policy`(상충). *결손/기형 빔이지 합법 no_op이 아님* — escalate. **S3과의 구분(상호배타)**: S3는 Decide payload이 *정형·완전*하고 그 결정이 "구현 0"을 *명시*하는 경우(verdict), S4는 Decide payload이 *비었거나 mode 필드가 누락/상충*해서 surface를 *읽어낼 수 없는* 경우(mechanical error). 정형 결정이 "구현 없음"을 말하면 S3, 결정 자체를 읽을 수 없으면 S4. **(P7 / principle 3: 빈-결손은 mechanical error)**
- S5. AC 추출은 됐으나 특정 정책·요구사항이 사람 결정 없이는 측정 가능하게 못 됨(애매) → **needs_clarification** (**per-invoke** max 3). **>3 애매(cap 초과)**: *한 invoke에서* 측정 불가한 distinct Decide-원천 항목이 **3개를 초과**하면 4번째 clarification을 낼 수 없고(grammar maxItems:3) 4번째 이상은 AC로 환원 불가하므로 proceed도 불가하다 → 이 경우는 *clarification으로 surface 불가한 규모*이므로 `result=blocked` + `blocked_reason=decomposition_overflow` + `attributed_step=cap_exceeded` + `overflow_subcode=ambiguity_overflow` + `detail`에 "ambiguities exceed clarification cap (>3)" 기록으로 degrade한다(Spec 자기 cap 소진과 동일 처리 — split flow 신호). (`overflow_subcode`는 decomposition_overflow의 세 trigger를 기계적으로 구분하는 필수 필드 — ↓ "AC/task 폭발".) 즉 ≤3이면 needs_clarification, >3이면 decomposition_overflow blocked. (임의로 3개만 골라 surface하고 나머지를 조용히 버리지 않는다 — principle 3.) **cap은 per-invoke이지 cross-invoke 누적이 아니다**: maxItems:3은 *단일 invoke의 emit ceiling*이고(grammar는 한 invoke의 array 길이만 본다), 재invoke 라운드마다 사람 답이 일부를 풀고 *새 distinct 애매*를 표면화하면 각 라운드도 그 시점 기준 독립적으로 ≤3을 surface한다. 따라서 ping-pong 자체는 maxItems:3이 종료시키지 *않으며* — 매 라운드 fresh 3개를 무한히 다시 낼 수 있는 잠재적 루프는 전적으로 **(flow_id, step) 5-누적-fail halt cap**(아래 "Failure & degrade handling" / failure-routing.md)이 bound한다: 누적 5회 fail이면 halt+escalate되어 needs_clarification 재invoke가 무한 반복되지 못한다. (cross-invoke 누적 3-cap은 *존재하지 않는다* — 누적 종료는 5-fail halt가 단일하게 소유한다.) **측정 가능하게 못 만드는 요구사항은 별도 `blocked_reason`이 아니다** — 그것은 전적으로 S5(needs_clarification ≤3 / decomposition_overflow >3)가 소유하므로 `unsatisfiable_requirement` 같은 별도 멤버는 존재하지 않는다(중복 라우팅 제거).

**clarifications payload 정의** (needs_clarification branch — S5):
- needs_clarification branch는 `acceptance_criteria` array를 *내지 않는다*(그건 proceed 전용). 따라서 `blocked_decide_item`은 *emit된 AC id를 가리키지 않는다* — 그것은 측정 가능하게 풀리지 못해 *AC가 되지 못한* **Decide 원천 항목**을 가리킨다 (필드 이름이 backward 의미를 직접 드러낸다).
  - `blocked_decide_item` = 그 clarification이 막고 있는 Decide-원천 ref(string): `design`이면 막힌 `policy`/`requirement`/`user_flow`의 id, `plan`이면 막힌 `sequencing[]` 단위 또는 `chosen.approach` 항목, `record`면 `decision`(한 줄이므로 그 결정 식별자). 즉 *어느 upstream 항목이 측정 가능 AC로 환원 불가한지*를 가리키는 backward ref이다. (AC가 발명되지 않았으므로 forward AC id는 존재할 수 없다 — R14 fail-loud.)
- `source_tool` ∈ `{design-document, plan-chosen, record-decision}` — AC `source_tool`(L113)과 *동일 enum*. 막힌 항목이 추출되려던 Decide 원천을 가리킨다(needs_clarification은 S5상 Decide-원천 정책/요구사항의 측정 불가에서만 발생하므로 이 enum이 닫힌 값공간이다). 제약 *상충*은 needs_clarification이 아니라 `blocked(conflicting_policy|compatibility_blocker)`로 라우팅되므로 Investigate-출처 clarification은 이 branch에 없다.

## Failure & degrade handling

### 입력 precondition fault → blocked escalate (P8 / principle 3)

Spec은 upstream을 *진실*로 검증하지 않는다(그건 Verify 일). 하지만 *존재 + 정형*은 intake에서 assert한다 — Ground의 active_flow_state mechanical-error 패턴을 일반화한 **단일 횡단 input-precondition 절**(아래 "Input preconditions"). 결손/기형이면 `result=blocked` + `failure_origin`으로 escalate하며, **`request_upstream_deepen`을 emit하지 않는다** — 그 제어 신호는 Decide 전용이다. **(principle 2: control-signal ownership)** ping-pong은 기존 (flow_id, step) 5-누적-fail halt cap이 bound한다 (failure-routing.md).

### emberdeck (enhancement tool) 부재/실패 → degrade, NOT escalate (P2 / principle 1)

emberdeck(create_card + codeLinks)는 Spec의 **enhancement** 도구지 primary 도구가 아니다 — spec card는 추적 보조물이고, AC/architecture/task는 emberdeck 없이도 전부 산출된다. 따라서 principle 1에 따라 **부재 = degraded branch**(escalate 아님):

- `spec_card_id`는 `Measured | Omitted` (M3 degrade) 형태다.
  - emberdeck attached + (Design일 때) intent card 존재 → `{ status: measured, value: <card id>, source_tool: emberdeck, code_links?: [{ from_card_anchor, to_source_path }] }`. **`code_links`는 *매핑*이다** — 각 원소가 card-side anchor(`from_card_anchor`)를 실재 source path(`to_source_path`)로 잇는다(평탄 path 리스트가 아니라 source↔card 매핑이라 reviewer의 'codeLinks 매핑 검증'이 표현·검증 가능). SHAPE만 grammar가 강제하고, 각 `to_source_path`가 실재 path로 해소되는지 + 카드가 Decide intent card에 실제로 링크되는지는 x-validator-contract(`result(proceed).spec_card_id.measured.code_links (provenance)`)가 M2로 emberdeck/path를 재독해 강제한다(자기-주장 provenance 구멍 차단).
  - emberdeck unattached/실패/timeout, **또는** Decide mode가 plan/record라 intent card가 없음 → `{ status: omitted, reason: unavailable|tool_failed|timeout|not_applicable, source_tool: "emberdeck" }`. **trigger→reason 1:1 매핑(M2 capability probe가 재현)**: emberdeck **미연결(not-attached)** → `unavailable`; `create_card` **에러** → `tool_failed`; `create_card` **timeout** → `timeout`; **plan/record (intent card 없음)** → `not_applicable`. (4 trigger ↔ 4 reason 고정 — 모호 없음. 공유 Omitted $def의 `tool_absent`/`skipped`는 이 step에서 *제외*된다.)
  - **Measured는 Decide mode=design(intent card 존재) 조건부다.** M1 grammar는 emberdeck attach 여부(Measured/Omitted oneOf)만 보고 cross-step Decide mode를 못 보므로, "plan/record flow가 measured spec card를 내는" 위반은 grammar로 막을 수 없다 → spec.schema.json x-validator-contract(`spec_card_id (Measured branch)`)가 M2로 "Decide mode∈{plan,record}이면 measured 불법, Omitted(not_applicable) 강제"를 검사한다. plan/record는 **반드시** Omitted(not_applicable)다. **(P4 / P2: grammar가 못 잡는 cross-field 제약 = M2 x-validator)**
- **null·placeholder·`# 강제` 금지** (R22). 부재의 유일한 합법 표현은 구조 완전한 Omitted 객체다. **(P2: enhancement 부재 = 정의된 omitted branch, silence 아님)**
- spec_card_id가 omitted여도 `result`는 여전히 **proceed**일 수 있다 — spec card는 게이트가 아니다. (대조: ED=Ground primary→escalate, firebat=Implement/Verify 게이트→escalate. emberdeck@Spec은 enhancement→degrade.) **(principle 1)**

### AC/task 폭발 (cap 초과)

Spec 자체는 mode→depth가 아니라 depth caps(wall_s/tokens)만 갖지만, 분해가 폭발할 때의 동작을 정의한다:
- AC 또는 task 수가 단일 Spec invoke로 측정 가능하게 다 못 담길 정도면 → Spec은 **부분 산출하지 않는다**. **관찰 가능한 기계적 cap(over-count proceed 불법화)**: **AC 수 > 50 또는 task 수 > 50**. 이 50/50은 *단일-Spec emit ceiling*으로 — 완성된 proceed가 출력만으로 감사 가능하게 재독되는 상한을 정의한다(임의 cliff가 아니라 single-invoke 분해 한도; 그 이상은 sub-flow 분할 신호). **wall_s/tokens cap 소진은 이 check의 일부가 *아니다***: 분해 도중 caps 소진은 *emit 시점에 이미* blocked를 강제하므로(아래 "caps 소진 (mid-activity)" 참조), *성공적으로 emit된 proceed는 정의상 caps를 소진하지 않은 것*이다 — 출력을 재독하는 validator는 mid-decomposition cap 상태에 대한 관찰 증거가 없으므로 그것을 assert하지 않는다(관찰 불가한 check를 부과하지 않음). 50/50을 넘는 proceed는 *조용한 과대 spec*이므로 불법이며 반드시 아래 blocked(decomposition_overflow)로 가야 한다. grammar는 하한(≥1)만 강제하므로 이 상한(50/50)은 spec.schema.json x-validator-contract `result(proceed).acceptance_criteria / tasks (over-budget proceed)`가 M2로 over-count proceed를 flag한다. `result=blocked` + `blocked_reason=decomposition_overflow` + `attributed_step=cap_exceeded` + `overflow_subcode=count_overflow` + `detail="decomposition exceeds single-spec budget; upstream Decide(Design) scope too broad — split flow"` 로 escalate한다. 이것은 Spec *자기* 예산 소진(self-caused)이지 upstream producer 잘못이 아니므로 `attributed_step`은 decide/investigate/ground가 아니라 `cap_exceeded` 제어값(FailureOrigin.cap_exceeded 미러)이다 — self-caused 실패를 upstream에 거짓 귀속하지 않는다. **(P8: 분기 열고 닫음 — caps-hit에 정의된 동작)**
- **`overflow_subcode` (decomposition_overflow trigger 구분 — 감사 가능성 명시)**: decomposition_overflow는 세 trigger로 도달할 수 있어 — **count_overflow**(AC 또는 task 수 >50), **caps_exhausted**(분해 도중 wall_s/tokens 소진), **ambiguity_overflow**(>3 distinct 측정 불가 Decide 항목, needs_clarification cap 초과) — 셋이 하나의 blocked로 *붕괴*하면 기계적으로 구별 불가하다. 따라서 blocked 페이로드는 `blocked_reason=decomposition_overflow`일 때 **`overflow_subcode` ∈ {count_overflow, caps_exhausted, ambiguity_overflow}를 필수로 emit**한다(grammar if/then; 다른 blocked_reason에서는 부재 강제). **감사 가능성은 subcode별로 다르다**: `count_overflow`만 *출력-관찰 가능*하다 — validator가 would-be AC/task 수를 재독해 실제로 50/50을 초과하는지 assert한다(50/50 이하면 오라벨 → flag). `caps_exhausted`와 `ambiguity_overflow`는 **출력에 관찰 증거가 남지 않아 output-auditable이 *아니며* trust로 수용된다**(잔여 residual: caps_exhausted/ambiguity_overflow로 오귀속된 S4 결손은 진짜와 기계적으로 구별 불가하므로 unflaggable). subcode는 적어도 *어느 trigger를 주장하는지*를 핀해 count_overflow를 checkable하게 만들고 trust-잔여를 (세 arm 전부가 아니라) 관찰 불가한 두 arm으로 좁힌다. (x-validator-contract `result(blocked).blocked_reason=decomposition_overflow <-> attributed_step=cap_exceeded`가 이 subcode 감사를 소유.)
- 이는 Compound/Migration cycle 분할 신호로 orchestrator에 전달된다(별도 sub-flow). Spec이 임의로 잘라 *조용히 일부만 proceed*하지 않는다. **(principle 3: 부분 빔을 rubber-stamp 금지)**

### caps 소진 (mid-activity)

wall_s/tokens가 모든 정책에 AC를 붙이기 전에 소진되면 → `result=blocked` + `blocked_reason=decomposition_overflow` + `attributed_step=cap_exceeded` + `overflow_subcode=caps_exhausted` + `detail`에 미완 범위 기록. 부분 proceed 금지(위와 동일 원리). 이 역시 Spec 자기 예산 소진이므로 upstream이 아니라 `cap_exceeded`로 귀속한다. (`caps_exhausted`는 출력-관찰 불가 arm이라 trust로 수용된다 — 위 `overflow_subcode` 감사 가능성 참조.)

## Input preconditions (P8: garbage-in 맹신 제거 — 단일 횡단 절)

Activity 진입 전, Spec은 필수 upstream 필드의 *존재 + 정형*을 mechanical하게 assert한다 (진실성 아님 — 그건 Verify). 실패 시 즉시 `result=blocked` + `failure_origin=<attributed_step>`. **(P8 / principle 2: Decide-아닌 소비자는 failure_origin escalate, request_upstream_deepen 아님)**

> **순서 (precondition vs no_op)**: decide_ref/Decide-surface 게이트는 모든 분기에 우선 평가된다(Decide 결정 자체를 읽지 못하면 분류 불가). 그러나 *ground/task_subgraph 비-빔* 게이트는 **no_op(S2/S3) 분류 이후**에 평가된다 — 합법적 `non_code_flow`/`no_implementable_surface` verdict은 빈 Ground/구현 surface가 *합법*이므로(principle 3: 빈-합법 vs 빈-결손), 이 게이트가 그것들에 fire하면 합법 no_op을 결손으로 오분류한다. 따라서 ground 게이트는 코드 flow가 구현 surface를 요구할 때만 fire하고, no_op verdict일 땐 *조용히 false*다(compatibility-gate의 'absent==silent false' 가드와 동형). **(P8 + principle 3: 빈-합법은 게이트가 over-fire하지 않는다)**

| precondition | 검사 | 위반 시 |
|---|---|---|
| `decide_ref` 존재 + Decide row 해소 | row가 step_name=decide로 resolve | blocked(missing_upstream, attributed_step=decide) |
| Decide payload이 mode에 맞는 surface 보유 | design→design document / plan→chosen+sequencing / record→decision (해당 mode 필드가 비어있지 않음) | blocked(missing_upstream, attributed_step=decide) **(principle 3: 빈-결손)** |
| `ground_ref` 존재 + task_subgraph 보유 **(code-flow 한정)** | row resolve + task_subgraph 비어있지 않음(architecture path 근거 필요). **단, no_op 분류(S2/S3)가 먼저 평가된다** — Decide 결정이 합법적 `non_code_flow`(S2) 또는 `no_implementable_surface`(S3) verdict이면 이 게이트는 *조용히 false*(빈 Ground surface가 합법이므로 fire하지 않음 — compatibility-gate의 'absent==silent false' 가드와 동형). 이 게이트는 *코드 flow가 구현 surface를 요구하는데* task_subgraph가 비었을 때만 fire한다. | blocked(missing_upstream, attributed_step=ground) |
| constraint 무모순 (cross-source 및 intra-source) | 동일 scope에 상충하는 두 제약 없음 | blocked(conflicting_policy) — Spec은 *어느 제약이 더 오래됐는지(stale)·이기는지*를 판별하지 않는다(그건 recency/truth 판단 = Decide/Verify 영역이고, Spec은 RowRef만 쥐고 timestamp나 truth oracle이 없다). 상충하는 *두 제약을 모두* `detail`에 surface하고 **충돌 당사자(party)가 속한 producer step으로 라우팅**한다: **(a) cross-source(Decide 제약 vs Investigate 제약)** → `attributed_step=decide`(결정 권한 보유 step이 cross-source adjudication을 소유). **(b) intra-Investigate(두 Investigate 제약끼리)** → `attributed_step=investigate`. **(c) intra-Decide(두 Decide 정책끼리)** → `attributed_step=decide`. 즉 Decide가 *당사자인* 모든 경우(a·c)는 decide로, Decide가 *당사자가 아닌* 순수 Investigate-내부 충돌(b)만 investigate로 — Decide가 party 아닌데 decide로 거짓 귀속하지 않는다(cap_exceeded 설계가 enshrine한 'never dishonestly attribute' 원칙). recency/truth adjudication은 어느 경우든 해당 producer/Verify에 남긴다. **(P8 + Boundary: Spec ≠ Decide — staleness 판정 안 함)** |
| `compatibility_verdict`가 blocking issue를 담지 않음 | `compatibility_verdict.issues[]` 중 어느 하나라도 `severity == fatal` *또는* `blocks_flow == true` (Investigate가 정의한 두 필드 = investigate.schema.json CompatibilityIssue.{severity(SeverityIssue), blocks_flow} 재사용, 새 분류기 발명 0). *count*가 아니라 *필드값* 기준 — deepen trigger의 `issues.length ≥ 2`(양적)와 별개의 *질적* 게이트. 이 cross-step 필드 결합은 M1 grammar가 $ref로 볼 수 없으므로 spec.schema.json의 x-validator-contract(`result(blocked).blocked_reason=compatibility_blocker`)가 M2로 강제. | blocked(compatibility_blocker, attributed_step=investigate) |

**deepen trigger 입력 guard**: deepen trigger 중 `Investigate.compatibility_verdict.issues.length ≥ 2`는 그 필드가 *존재 + 정형*일 때만 평가된다. Investigate degenerate(greenfield 등)라 `compatibility_verdict`가 비어/부재면 → 그 trigger는 *조용히 false*(누락이 deepen을 강제하지 않음). 다른 deepen trigger(flow_type, Decide.mode=design)는 독립적으로 평가된다. **동일 가드가 위 compatibility_blocker precondition에도 적용**: `issues[]`가 *존재 + 정형*일 때만 `severity==fatal | blocks_flow==true`를 평가한다. `compatibility_verdict` 부재/빔(Investigate degenerate)은 *blocking issue 없음*으로 취급(누락이 blocked를 강제하지 않음 — principle 3: 부재는 verdict 아닌 결손 신호가 아니라, *이 정형 게이트의 조용한 false*). **(P8: 절대 absent 필드를 정형으로 가정하지 않음)**

**합법적 빈 입력 vs 결손 빈 입력 (principle 3)**:
- *합법(비코드)*: Decide.Record가 "문서/config만, 코드 없음"을 결정 → Spec은 `no_op(non_code_flow)` (escalate 아님, AC 발명 아님). [S2]
- *합법(코드성·구현 0)*: Decide payload이 정형·완전한데 그 결정이 "변경 불필요 / 기존 코드로 충족"을 *명시* → Spec은 `no_op(no_implementable_surface)` (escalate 아님). [S3]
- *결손*: Decide row가 있는데 payload가 텅 비었거나 mode 필드가 누락/상충 → `blocked(missing_upstream|conflicting_policy)` escalate. [S4]
- Spec은 둘째를 첫째로 *조용히 rubber-stamp하지 않는다*. AC를 *발명*하지도 않는다(R14 fail-loud). 빈 AC로 proceed도 안 한다 — proceed branch는 `acceptance_criteria` ≥1을 강제한다.

## Output

> 출력은 **중첩 envelope**이다: 최상위 객체는 `result`(branch 판별자 객체) + `based_on` + (proceed일 때) `declared_next_step`을 *형제*로 둔다. branch payload(AC/architecture/tasks/spec_card_id/files_to_read)는 *최상위가 아니라* `result:` 안에 중첩된다 — 최상위 `result`는 wrapper 객체이고 그 안의 `result` const가 branch를 판별한다(spec.schema.json: top-level allOf가 `result.result==proceed`를 본다). 아래는 **proceed** branch (유일하게 AC/architecture/tasks 담음). 다른 branch는 `result:` 안에 "Result enum & branches" 표의 payload만 담고 `declared_next_step`은 *내지 않는다*(아래 placement 규칙).

```yaml
result:                         # ← wrapper 객체 (branch 판별자 + branch payload를 중첩)
  result: proceed               # branch const
  acceptance_criteria:          # ≥1 강제 (빈 AC로 proceed 불가) — result 안에 중첩
    - id            # ^AC-[0-9]{3,}$
      statement     # "When {condition}, then {observable outcome}" — minLength 가드
      measurement   # ↓ verify_probe 형태로 정의 (P6)
      edge_cases    # ↓ cardinality 정의 (P6)
      verify_probe: { command, expected_result }   # R20 — measurement의 기계 실행 형태
      policy_ref?   # optional — 이 AC가 추적하는 Decide policy/requirement로의 free-text pointer (coverage 추적 보조; M2/reviewer cross-check)
      source_tool   # provenance: 이 AC가 추출된 Decide 원천 (design-document|plan-chosen|record-decision)
      unverified    # R13 KEEP 극성 — Spec이 직접 검증 못 한 AC는 true로 propagate
  code_architecture:
    directories: [{ path, purpose?, existing }]
    files: [{ path, purpose, exports, change_kind: create|modify|read, change_summary }]  # change_summary는 change_kind∈{modify,read}일 때 **필수**(무엇이 바뀌는지/왜 읽는지 — downstream Test/Implement plan-as-prompt가 소비), create는 면제. grammar if/then이 강제(no_op.detail·spec_card_id.reason과 동형 조건부).
    module_boundaries: [{ module, responsibility, owns? }]
    dependencies: [{ from, to, kind: internal|external }]
    # dependencies 참조 규칙 (referent — M2 검사):
    #  - from: 항상 *이 architecture가 정의한* module 이름 = `module_boundaries[].module` 중 하나 (의존을 *내는* 쪽은 항상 내부 모듈).
    #  - kind=internal → to: 같은 architecture의 다른 `module_boundaries[].module` (M2 referential integrity — 실재 module).
    #  - kind=external → to: 외부 패키지 식별자 `name@version|name` (예: `zod@3`, `bun`) — module_boundaries에 없음(외부이므로 M2 module-resolve 면제). path도 symbol도 아님.
    #  (from/to는 file path나 symbol이 아니라 *module* 단위로 통일 — module_boundaries.module과 동일 referent.)
  tasks:                        # ≥1 강제
    - id              # ^T-[0-9]{3,}$
      description     # single concern
      depends_on      # [task id], acyclic (M2)
      ac_refs         # ≥1, 모든 ac_ref는 실재 AC id (M2 referential integrity)
      file_paths      # ≥1 — R33 same-file 상호배타 입력
      parallel_marker # bool — R33
  spec_card_id:                 # M3 degrade — Measured | Omitted (P2)
    # measured: { status: measured, value: <card id>, source_tool: emberdeck, code_links?: [{ from_card_anchor, to_source_path }] }
    # omitted:  { status: omitted, reason: unavailable|tool_failed|timeout|not_applicable, source_tool: emberdeck }
  files_to_read?: [<path>]      # plan-as-prompt: Test/Implement가 읽을 실재 source path (READ 입력, §5 ref 아님). proceed payload 내부 — result 안에 중첩.
                                # *병렬 목록 아님* — code_architecture.files[] 중 change_kind=read인 항목의 path 집합의 *flat projection*이다(canonical READ-입력 위치는 code_architecture.files[]). 둘은 *일치*해야 하며(drift 금지) M2 x-validator-contract가 files_to_read == {files[].path | change_kind=read}를 강제.
                                # *files[].path 유일성 불변식*: 한 path는 files[]에 **두 번 등장하지 않는다**(같은 path를 [change_kind=read]와 [change_kind=modify]로 *각각* 내는 중복 엔트리 금지). grammar의 uniqueItems는 *객체 전체* 동등성만 보므로(다른 change_kind면 객체가 달라 통과) path-단위 유일성을 표현 못 한다 → M2 x-validator-contract `code_architecture.files[].path (uniqueness + read-set membership)`가 강제한다. **read-set 멤버십 정의**: path는 *그 단일 files[] 엔트리의* change_kind가 read일 때 *iff* read-set에 속한다. 즉 한 path가 read이면서 동시에 modify인 상태는 *표현 불가*(엔트리가 하나뿐이고 그 단일 change_kind가 멤버십을 결정). 따라서 files_to_read는 files[]가 create/modify로 기록한 path를 *결코* 담지 않는다(그 path의 단일 change_kind는 read가 아님). 유일성이 강제되므로 위 projection 일치와 R33 same-file 상호배타가 둘 다 well-defined하다.
                                # *빈 read-set canonical form*: change_kind=read 파일이 0개면 read-set은 비어 있고, 이때 files_to_read는 *생략*(absent)한다 — `[]`로 내지 않는다. M1 grammar가 `minItems:1`로 literal `[]`를 *불법화*하므로 빈 표현은 omission이 유일 합법이다. **단 validator는 absent를 무조건 empty-set으로 취급하지 *않는다*(그러면 아래 drift를 가린다)** — 먼저 files[]에서 read-set을 계산한 뒤 *absent IFF read-set이 비었을 때만* canonical로 인정한다. 두 absent를 구분: (i) absent-because-empty(read 파일 0개) = canonical, drift 아님; (ii) absent-despite-nonempty-read-set(files[]에 change_kind=read가 ≥1개인데 files_to_read 생략) = projection이 누락된 **drift**이며 flag. M2 x-validator-contract가 이 구분을 강제한다.
based_on: { decide_ref, investigate_ref?, ground_ref }   # §5 RowRef. decide_ref/ground_ref 필수 — `result`의 *형제*(top-level), branch 무관하게 모든 분기에 존재.
declared_next_step              # R16 advisory (proceed *전용*) — `result`의 *형제*(top-level)이나 proceed 분기에서만 존재한다. 값공간은 닫힌 **{test, implement}** 2-값이다(Test=코드 flow / Implement=greenfield·test-less 체인). 공유 DeclaredNextStep $def는 open 10-값 StepName을 쥐지만 Spec은 이를 spec.schema.json에서 enum {test, implement}로 *좁힌다*(grammar-표현 가능 제약이므로 M1에서 핀; spec-self/decide/reflect 등 다른 후계 선언은 grammar가 불법화). orchestrator가 expected_next_step 주입, M2 대조. blocked/no_op은 정상 forward 후계가 없어(각각 attributed_step 라우팅 / downstream skip) 이 필드를 *내지 않는다* — top-level allOf가 `result.result==proceed`일 때만 required로 강제하고, 비-proceed에서는 *부재*를 강제한다(↓ placement 규칙). DeclaredNextStep은 null/skip 센티넬이 없으므로 후계가 실재하는 proceed에서만 의미.
```

> **proceed-전용 필드 placement 규칙 (asymmetric nesting 명시)**: proceed에만 존재하는 두 필드는 *서로 다른 레벨*에 있다 — `files_to_read`는 proceed branch payload *안*(`result:` 중첩)에 있어 비-proceed branch의 `additionalProperties:false`가 자동으로 금지하고, `declared_next_step`은 `result`의 *형제*(top-level)다. top-level의 `declared_next_step`은 proceed에서 required(allOf if/then)이고, **비-proceed(no_op/blocked/needs_clarification)에서는 top-level allOf가 그 *부재*를 명시적으로 강제**한다(단순 비-required로 두면 top-level이 항상 optional로 허용해 no_op 곁에 declared_next_step이 새는 구멍이 생기므로 — 이를 막는 guard). 즉 두 필드 모두 proceed-전용이라는 불변식은 동일하나, 강제 메커니즘은 nesting 레벨에 따라 (a) branch additionalProperties:false(files_to_read) (b) top-level if/then 부재 guard(declared_next_step)로 갈린다.

### `measurement` 필드 정의 (P6: measurement = verify_probe 형태)

`measurement`는 자유 산문 TBD가 아니다 — reviewer가 "mechanical assertion 가능"을 요구하므로, **각 AC는 R20 `verify_probe { command, expected_result }`를 동반**한다 (이미 상류에 존재하는 mechanical-assertion 기계). `measurement` string은 *측정 방법*(단위·assertion target)을 서술하고, `verify_probe`가 그것을 *재실행 가능한 명령*으로 못박는다. **(P6: measurement → R20 verify_probe로 wiring)**

- `verify_probe.command` = 그 AC가 만족됐는지 재증명하는 명령 (예: `bun test path/to.spec.ts -t 'AC-001'`, `grep -c 'export' file`, `curl ...`).
- `verify_probe.expected_result` = 재실행이 내야 하는 결과 (예: `"exit 0, 1 passing"`, `"exactly 1 match"`).
- **본질적으로 측정 불가능한 정책** (예: "코드가 읽기 좋아야 한다")은 그대로 AC가 될 수 없다 → Spec은 측정 가능 형태로 환원하거나(예: "공개 심볼당 doc-comment 존재" → `grep`), 환원 불가면 `result=needs_clarification` (사람이 측정 기준 제시). **AC를 측정 불가인 채 발명하지 않는다.** **(P6 + R14 fail-loud)**
- 진실성(probe가 실제로 통과하는지)은 Spec이 self-assert하지 않는다 — M2 validator가 `verify_probe`를 *재실행*해 `expected_result`와 대조한다 (sibling validator_contract). Spec은 SHAPE만 책임진다.

### `edge_cases` cardinality 정의 (P6)

`edge_cases`는 AC당 **required array** (필드 자체는 필수 — 모델이 "엣지 고려"를 조용히 건너뛸 수 없음). **빈 array는 허용** — 진짜로 엣지가 없는 AC가 존재하기 때문(예: 상수 export 존재 여부). 즉 *필드 존재는 강제, 내용은 0개 허용*. 각 원소는 boundary/exception/null/permission/state-transition 중 하나를 서술하는 non-empty string. **(P6: cardinality = required field, empty-allowed, per-element minLength 1)**

## Step Depth Policy

| Depth | 활동 | 산출 (P8: Shallow output 모순 제거) | Caps |
|---|---|---|---|
| Shallow | AC list 중심 — architecture/task는 *최소* (단일 파일/단일 task 수준) | **proceed branch 전체 필드 산출** — `acceptance_criteria`(≥1) + `code_architecture`(최소이나 비어있지 않음) + `tasks`(≥1) + `spec_card_id`(degrade 가능) + `based_on` + `declared_next_step`. *어느 필드도 생략하지 않는다.* | wall_s=30, tokens=5k |
| Deep | AC + 전체 코드 architecture + task decomposition + (Design 시) codeLinks | 동일 필드, 깊이만 증가 | wall_s=240, tokens=25k |

> **Shallow vs Output 모순 해소 (P8)**: 원 contract는 "Shallow = AC list만"이라 했으나 Output block은 `code_architecture/tasks/spec_card_id`를 무조건 보였다 — 모순. 해소: **proceed branch의 required 필드 집합은 depth와 무관하게 동일**하다(grammar가 강제). Shallow는 *필드를 생략*하는 게 아니라 각 필드를 *얕게*(architecture=대상 파일 1–2개, tasks=1개) 채운다. 어느 depth에서도 빈 `acceptance_criteria`/`tasks`로 proceed 불가. depth가 줄이는 건 *내용의 깊이*지 *스키마 모양*이 아니다.

> **depth는 Spec 출력에 emit되지 않는다 (orchestrator-internal)**: 다른 step과 달리 Spec output 스키마는 `depth`(`_defs.Depth`) 필드를 *내지 않는다* — depth 선택과 deepen-trigger 평가는 orchestrator 내부 제어(invoke caps wall_s/tokens 설정)일 뿐, Spec의 *산출 모양*은 depth와 무관하게 동일(위 모순 해소)하기 때문이다. depth는 emit해도 proceed branch의 어떤 required 집합도 바꾸지 못하므로(필드가 깊이만 다르게 채워질 뿐) 출력에 기록할 감사 가치가 없고, deepen-trigger 입력(flow_type/Decide.mode/issues.length)은 모두 *상류 row에서 재독 가능*해 M2가 출력의 `depth` 필드 없이도 trigger 평가를 cross-check할 수 있다. 따라서 depth와 그 trigger provenance는 *의도적으로 비-emit*이다 — Spec이 siblings와 달리 depth를 기록하지 않는 이유다.

**Deepen triggers (OR)**:
- `flow_type ∈ {feature, migration, performance, compound}` (canonical lowercase hyphenated flow-file stems — Ground/Triage row의 `flow_type` 값공간과 동일; 대문자 리터럴은 upstream row와 결코 일치하지 않으므로 금지)
- `Decide.mode = design`
- `Investigate.compatibility_verdict.issues.length ≥ 2` *(단, compatibility_verdict가 존재+정형일 때만 평가 — 위 Input preconditions의 deepen guard 참조)* **(P8)**

## Reviewer (spec-reviewer)

- result branch가 V-룰 류 mechanical 규칙(S1–S5)을 따르는가 (proceed면 AC≥1·tasks≥1 강제, 빈 AC로 proceed 아님; no_op면 reason이 S2(non_code_flow)/S3(no_implementable_surface) 중 *정형 결정이 구현 0을 명시*한 경우인지 — S4 결손/기형을 no_op로 rubber-stamp하지 않았는지)
- 모든 정책/요구사항이 (mode 무관하게 Decide 원천에서) AC로 변환됐는가 — coverage (모든 policy → ≥1 AC)
- AC 측정 가능한가 — 각 AC에 `verify_probe { command, expected_result }` 존재 (P6); measurement가 mechanical assertion으로 환원됨
- `edge_cases` 필드가 매 AC에 존재 (내용 0개 허용) (P6)
- 코드 architecture (디렉토리/파일) 명확 + path 실재 (modify/read는 on-disk, create는 면제 — M2)
- task 분해 빠짐없는가 — 모든 AC가 ≥1 task.ac_refs에 커버 (M2 referential integrity), task graph acyclic
- `based_on`이 입력 계약에 맞게 조건부 — `decide_ref`/`ground_ref`는 M1 grammar 필수, `investigate_ref`는 Investigate 있는 체인에서 필수(M1 grammar는 체인 모양을 못 보므로 이 조건부 존재는 spec.schema.json x-validator-contract `based_on.investigate_ref (conditional presence)`가 M2로 강제 — greenfield/Investigate-degenerate 체인에서는 합법적 부재) **(P3-류 conditional provenance)**
- **(Design 조건부)** `decide.intent_card_id` 존재 시에만 emberdeck spec card 생성 + codeLinks 매핑 검증(각 code_link가 `{from_card_anchor, to_source_path}` 매핑이고 `to_source_path`가 실재 source path로 해소되며 카드가 그 intent card에 링크되는지 — 이 매핑 검증은 x-validator-contract `result(proceed).spec_card_id.measured.code_links (provenance)`가 M2로 emberdeck/path를 재독해 기계적으로 실현; reviewer 의무가 self-asserted 필드로 방치되지 않는다); Plan/Record거나 emberdeck 부재면 `spec_card_id`가 Omitted인지 확인 (omitted를 결함으로 보지 않음) **(P2 / P4)**
- blocked/needs_clarification/no_op branch면 해당 필수 payload 존재 + Spec이 *boundary 침범 없이*(설계 재선택·AC 발명 없이) 도달했는가:
  - blocked → `blocked_reason`+`attributed_step`; `compatibility_blocker`면 Investigate issue 중 `severity==fatal | blocks_flow==true`가 실재했는지 (질적 게이트); `decomposition_overflow`면 `attributed_step=cap_exceeded`인지(decide/investigate/ground로 거짓 귀속 안 했는지) + `overflow_subcode` ∈ {count_overflow, caps_exhausted, ambiguity_overflow}가 존재하는지(count_overflow면 would-be 수가 실제 >50인지 — M2 관찰; caps_exhausted/ambiguity_overflow는 출력-관찰 불가라 trust 수용) + 부분 proceed 없이 전량 blocked인지
  - needs_clarification → `clarifications[]`의 `blocked_decide_item`이 *Decide-원천 ref*(emit AC id 아님 — 이 branch엔 AC 없음), `source_tool ∈ {design-document, plan-chosen, record-decision}`
  - no_op → `reason`: non_code_flow(S2)면 flow가 비코드인지 — S2는 emit 페이로드(detail·source_tool 면제)만으로 감사할 수 없으므로 *upstream Triage/Decide row에 대조*해 검증한다(Triage가 비-구현 flow_type으로 라우팅했거나 Decide row에 코드-bearing surface가 없는지; upstream이 코드 surface를 담는데 S2를 낸 건 S4 punt — x-validator-contract `result(no_op).reason=non_code_flow (S2 auditability)`). no_implementable_surface(S3)면 *정형 Decide 결정이 구현 0을 명시*했는지 — 이때 `detail`(필수)이 그 zero-surface 확정을 기록해 S4 결손/기형을 no_op로 rubber-stamp하지 않았음을 감사 가능하게 했는지

## Boundary — Spec이 안 하는 것

| 항목 | 책임 |
|---|---|
| 결정·옵션 deliberation·재선택 | Decide |
| **architecture/policy 선택 (re-derive)** | Decide(Design) — Spec은 *전개*만 **(P4)** |
| 상충 제약의 *승자 결정* | Decide — Spec은 모순을 surface하고 blocked로 라우팅 |
| 사실 캡처 | Ground |
| 해석·영향 분석 | Investigate |
| upstream 사실의 *진실성* 검증 (존재/정형 assert만 함) | Verify |
| Test 작성 | Test |
| 코드 작성 | Implement |
| follow-up flow 라우팅/큐잉 | orchestrator (Spec은 blocked로 *신호*만) |

## Depth & 제어 신호 소유권 (요약)

- Spec은 `request_upstream_deepen`을 **emit하지 않는다** — 그 신호는 Decide 전용이다. Spec의 upstream 결손 대응은 `result=blocked` + `failure_origin` escalate (failure-routing 재진입)뿐이다. **(principle 2)**
- escalation ping-pong은 (flow_id, step) 5-누적-fail halt cap + producer⇄reviewer 3-fail cap이 bound한다 (failure-routing.md) — 그래서 input-precondition escalate가 무한 루프를 못 만든다. **(P8 안전성 근거)**

## Sibling 메커니즘 (이 contract가 *재사용*하는 것 — 발명 0)

- result discriminated union + orchestrator 라우팅 테이블 ← Investigate compatibility_verdict (proceed|blocked|needs_clarification|no_op). **(P1)**
- `spec_card_id` Measured|Omitted ← M3 DegradableMeasurement (R22 placeholder 금지). **(P2)**
- `verify_probe` ← R20 (measurement의 재실행 형태). **(P6)**
- `failure_origin` escalate + producer⇄reviewer 재진입 + 5-누적-fail halt cap ← failure-routing.md. **(P8)**
- `based_on` RowRef + conditional 키 ← §5 / BasedOn. **(P3-류)**
- `declared_next_step` advisory + orchestrator 주입 ← R16. M2 validator(verify_probe 재실행, ac_refs/depends_on referential integrity, task graph acyclicity, path 실재, RowRef 해소)는 SHAPE 밖 — sibling 책임(이 contract는 TRUTH를 self-assert하지 않음).
