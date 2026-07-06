# Implement — Code Changes (GREEN)

## Definition

> **Implement는 Test의 RED를 GREEN으로 만든다.** Spec architecture(있을 때) 또는 Decide record/plan/design(Spec 없는 chain)에 따라 코드 작성. Sub-activities: setup (deps, config, infrastructure), code, commit. firebat/emberdeck은 GATE 도구 — code-quality·card↔code drift를 mechanical하게 막는 관문이지 enhancement가 아니다 (P2 + principle 1: GATE 부재 → escalate).

Implement는 **코드 작성 + GREEN 도달**만 한다. flow-level "목표 달성?" 판정은 Verify, AC 추출/architecture 결정은 Spec/Decide. STAY-IN-LANE: Implement은 새 follow-up flow를 큐잉하지 않고(그건 Verify가 SIGNAL → orchestrator가 큐잉), upstream artifact를 gate하지도 않는다 — 결손/기형이면 **감지 → escalate**만 한다.

## Inputs

**Required (min 1 of Spec | Decide)** — flow-conditional (P3: based_on이 이 계약을 그대로 반영):
- **Spec 출력** (`acceptance_criteria`, `code_architecture`, `tasks`) — flow에 Spec 단계 있을 시. 이때 acceptance target = Spec.acceptance_criteria.
- **또는 Decide 출력** (`decision_record` / `option_selection` / `design_document`) — Bug Fix / Chore / Release / Spike / P0 flow (Spec 없는 chain). 이때 acceptance target = Decide가 낸 산출의 **명시 요구**(decision_record의 결정 + rationale에 적힌 변경 의도, option_selection의 선택된 옵션 범위, design_document의 설계 항목). **No-Spec path의 acceptance 기준은 "undefined"가 아니라 "Decide 산출이 직접 명시한 변경 의도"이다** (홀#5 해소; principle 3: 합법적으로 Spec이 없는 chain은 정상 verdict이지 결손이 아님 — Decide 산출이 acceptance target을 떠받친다).

**Optional enrichment**:
- **Test 출력** (failing tests — RED) — flow chain이 Test 단계를 명시할 때만 required (Bug Fix Test, Refactor with coverage gap 등). 없으면 enrichment 없이 진행.
- **Investigate 출력** (`constraints`, `risk_surface`) — 항상 enrichment.
- **Ground 출력** (`volatile_state`, `task_subgraph`) — 항상 enrichment.

**Input contract rule**: minimum = 1 of (Spec | Decide). Test는 flow chain이 명시할 때만 required. reviewer/M2는 **orchestrator가 주입하는 flow chain descriptor**(flow_type→chain step-set 매핑; `declared_next_step`이 `expected_next_step`을 읽는 것과 동일한 주입 컨텍스트 소스 — 이 output의 free-fill 필드가 아님)를 읽어 chain이 Test를 명시하는지 판정한다: 그 step-set에 Test가 있으면 `test_ref` present-and-resolvable 필수, 없으면 `test_ref` 부재 (실제 입력 ref 해소는 아래 *Input preconditions* 절).

## Activities

1. **Setup** — deps install, config 변경, infra 셋업 (필요 시). 실패 처리는 *Failure & degrade handling* 절.
2. **Code** — acceptance target(Spec.code_architecture 또는 Decide 산출 변경 의도)에 따른 변경.
3. **firebat scan** — 매 change 후 (GATE). blockers>0 분기는 *Result enum & branches*에서 닫음. tool 부재 분기는 *Failure & degrade handling*에서 닫음.
4. **emberdeck validate_code_links** — card↔code drift 검출 (GATE). drift≠0 분기는 *Result enum & branches*에서 닫음. tool 부재 분기는 *Failure & degrade handling*에서 닫음.
5. **Atomic commit** — logical unit 단위. 실패 처리는 *Failure & degrade handling* 절.

> **"변경 단위(change unit)" 정의**: 한 atomic commit이 담는 하나의 logical change(= activity 5의 logical unit, reviewer의 "한 commit = 한 logical change"와 동일). fix-and-rescan / re-link / fix-and-recommit 루프의 3회 cap은 *이 단위 1개* 안에서 센다(여러 logical unit에 걸친 변경이면 각 단위마다 독립적으로 cap이 적용된다). 즉 change unit = atomic-commit boundary이지 파일 1개나 전체 flow가 아니다.

## Output

```yaml
result: implemented | blocked | needs_setup_recovery | no_op   # P1: 성공분기 포함 전체 result enum
changes:
  - file_path, change_type: create|modify|delete               # file_path = git-versioned CODE path (RowRef 아님)
commits:
  - sha, message, files
firebat_results:                                               # M3 DegradableMeasurement (Measured | Omitted)
  status: measured | omitted
  gate_invocation_attempted?: bool                             # top-level optional — omitted 시 도구 실제 호출 여부 typed 마커 (M2 reason-honesty 판정: true=호출됐으나 실패=tool-failure, false=미호출=not_applicable/skipped)
  # measured: value: { blockers: CountClaim, warnings: CountClaim }, source_tool   # 셋 다 REQUIRED (status, value, source_tool). MCP-backed count의 source 소싱은 아래 *MCP-backed GATE count 소싱* 절
  # omitted:  reason, source_tool                              # GATE 부재 → 이 output은 escalate 분기에서만 (아래 P2)
emberdeck_drift:                                               # M3 DegradableMeasurement (Measured | Omitted)
  status: measured | omitted
  gate_invocation_attempted?: bool                             # top-level optional — firebat_results와 동일 마커
  # measured: value: CountClaim (==0 강제, M2 검사), source_tool   # 셋 다 REQUIRED (status, value, source_tool). MCP-backed count의 source 소싱은 아래 *MCP-backed GATE count 소싱* 절. drift는 단일 미분화 count(재-link 처분 내역은 escalate_evidence에만 — 아래 절)
  # omitted:  reason, source_tool                              # GATE 부재 → escalate 분기에서만
new_commits_count: CountClaim                                  # R23 (value == commits.length, M2). source.command='git rev-list --count <BASE_SHA>..HEAD' (<BASE_SHA> = RESOLVED base sha 치환, 리터럴 '<base>' 토큰 아님)
changed_files_count: CountClaim                                # R23 (value == changes.length, M2). source.command='git diff --name-only <BASE_SHA>..HEAD | wc -l' (<BASE_SHA> = RESOLVED base sha 치환)
emergency_mode: { active: bool, test_bypass?, retroactive_test_followup_queued? }
  # active: REQUIRED bool — flow_type=bugfix-p0일 때만 true, 그 외 모든 flow에서는 false (필드 드롭 금지; output shape 불변). 단 이 'false' 값-정합(active==false ⟺ flow_type≠bugfix-p0)은 flow_type cross-row 진실이라 **grammar default가 아니라 M2가 검사**한다 — schema는 active를 default 없는 required bool로만 둔다(grammar는 active==true에 한해 shallow+test_bypass 정합을 강제할 뿐, active 값 자체를 flow_type에서 강제하지 못함).
  #         active=false면 test_bypass/retroactive_test_followup_queued는 부재(P0 전용 하위 flag). active=true면 test_bypass REQUIRED-present + depth=shallow + retroactive_test_followup_queued 부재(grammar 강제 — 큐잉은 post-Verify이므로 Implement emit 시점엔 미설정); test_bypass==true값/flow_type 정합은 M2.
based_on:                                                      # P3: 입력계약(min-1-of Spec|Decide) 반영, 조건부
  spec_ref?:     RowRef    # Spec chain일 때만 (Spec 출력 row)
  decide_ref?:   RowRef    # Decide-only chain일 때만 (Decide 출력 row)
  test_ref?:     RowRef    # flow chain이 Test 명시할 때만
  investigate_ref?: RowRef # Investigate 실행 시 enrichment
  ground_ref?:   RowRef    # Ground 실행 시 enrichment
  # anyOf: at-least-one of (spec_ref | decide_ref) — grammar 강제
depth: shallow | deep
unverified: bool                                              # R13 floor (KEEP polarity — Verify가 단일 gate)
declared_next_step: StepName                                  # R16 (orchestrator가 expected_next_step 주입)
# 실패/escalate 분기 (result ∈ {blocked, needs_setup_recovery})일 때만 — implemented(성공)·no_op(합법적 빈 결과)는 부재:
failure_origin?: implement | spec | decide | test | ground | investigate | cap_exceeded   # principle 2/3: 결손 라우팅 (cap_exceeded = step 자체 budget 소진, orchestrator halt+escalate — 공유 FailureOrigin enum)
escalate_reason?: string
escalate_evidence?: <ref or file:line>
no_op_details?: { reason, evidence, current_state, target_state, suggested_action }  # result=no_op일 때 필수 (no_op은 failure_origin/escalate_* 부재 — 실패가 아닌 합법적 빈 결과)
```

**`based_on` 필드별 채움 규칙 (P3 + 홀#4 해소)**:
- `spec_ref`: Spec chain일 때만 존재 (Spec 출력 RowRef). Decide-only chain에서는 **부재** — placeholder/빈 string 금지.
- `decide_ref`: Decide-only chain일 때만 존재 (Decide 출력 RowRef). `decide_ref` 필드는 **실재한다** — Decide가 유효한 sole input이므로 (legacy README가 `decide_ref`를 빠뜨린 것이 홀이었음, 본 계약이 추가).
- `test_ref`: flow chain이 Test 단계를 명시할 때만 존재. Test 부재 시 **필드 자체를 생략** — null/빈값 금지.
- min 1 of (`spec_ref` | `decide_ref`) 항상 존재 (anyOf 강제). Decide-then-Spec chain은 둘 다 가질 수 있음(anyOf = at-least-one).

**`new_commits_count` / `changed_files_count` 소싱 (모든 result 분기에서 required CountClaim — R23, fake-zero 금지)**: 두 count는 `base`(*Input preconditions*에서 정의한 run 진입 시점 commit) 기준의 **committed** git 명령 stdout으로 떠받친다 — `new_commits_count.source.command = "git rev-list --count <BASE_SHA>..HEAD"`, `changed_files_count.source.command = "git diff --name-only <BASE_SHA>..HEAD | wc -l"`. **`<BASE_SHA>`는 리터럴 `<base>` 토큰이 아니라 run 진입 시점 base commit의 RESOLVED sha를 치환한 값**이다 — `raw_stdout_sha256`이 실제 실행 가능한 명령의 stdout을 해시해야 하므로 emit되는 command 문자열에는 실 base sha가 박혀야 하고, M2는 그 명령을 재실행하여 재검증한다(M2는 리터럴 `<base>` 문자열 동등성이 아니라 base sha가 치환된 패턴으로 매치). **두 count의 측정면(measurement surface)은 `<BASE_SHA>..HEAD`의 committed diff/rev-list로 고정**되며 working-tree(uncommitted) 변경은 측정하지 않는다 — 이로써 `changes[]`/`commits[]`(= committed atomic work)와의 항등식 `changed_files_count.value == changes.length` / `new_commits_count.value == commits.length`가 모든 분기에서 성립한다.

**blocked 분기의 두 위상(phase) 구분 (홀 해소)**: `blocked`는 두 위상에서 도달 가능하다 —
- **pre-code blocked**(precondition 위반·setup-dirty·GATE-도구-부재): 코드 진입 전이므로 `HEAD == base`, `changes[]`/`commits[]` 둘 다 빔 → 위 두 명령 stdout이 **실제로 `0`**(unchanged HEAD에 대한 진짜 측정 0, source 날조 없음).
- **post-code blocked**(GATE 3x-fail·commit conflict): fix-and-rescan/fix-and-recommit 루프가 working-tree를 변경했으나 atomicity 보존을 위해 **commit하지 않은(uncommitted)** 상태로 남길 수 있다. 이때 `git diff <base>..HEAD`(committed 측정면)는 여전히 미커밋 편집을 **세지 않으므로** `changed_files_count.value == changes.length` 항등식이 깨지지 않는다 — `changes[]`는 *committed* 변경만 담고(uncommitted fix-and-rescan 편집은 `changes[]`에 등재하지 않음 — atomicity), uncommitted 작업은 working-tree diff(`git diff`, base 없는 현재 tree)로 `escalate_evidence`에만 첨부한다. commit이 일부 있었다면(예: 일부 logical unit은 commit 후 후속 unit에서 blocked) `<base>..HEAD`가 그 committed unit만큼 ≥1을 반환하고 `changes[]`/`commits[]`도 동일하게 그 committed 분만 담는다.

요약: 두 count는 **committed `<base>..HEAD`** 단일 측정면을 쓰고, `changes[]`/`commits[]`도 committed 변경만 담으므로 `value==length` 항등식은 zero-work·pre-code blocked·post-code-uncommitted blocked·implemented 모든 분기에서 보존된다. `implemented` 분기에서는 commit 후 동일 명령이 ≥1을 반환한다(M2: value==commits.length / value==changes.length). uncommitted 잔여 작업은 count의 일부가 아니라 escalate evidence다.

**MCP-backed GATE count 소싱 (firebat blockers/warnings, emberdeck drift — 홀 해소: MCP count ↔ CountClaim.source 정합)**: `firebat_results.value.{blockers,warnings}`와 `emberdeck_drift.value`는 공유 `CountClaim`이며, `CountClaim.source`는 `command`(stdout을 센 정확한 명령)와 `raw_stdout_sha256`(그 stdout 해시)를 REQUIRED로 둔다(M2가 그 stdout을 재읽기·재파싱하여 value를 재유도). firebat/emberdeck은 **shell 명령이 아니라 MCP tool**이므로, 셸 stdout이 직접 없다 — 이때 `CountClaim.source`는 다음 규약으로 채운다: (1) `source.command` = **MCP 호출을 직렬화한 표준 문자열**(예: `mcp:firebat scan --json` / `mcp:emberdeck validate_code_links --json` — 도구·메서드·인자를 deterministic하게 직렬화한 명령형 토큰; 실제 셸에서 그대로 실행 가능할 필요는 없고 **M2가 동일 MCP 호출을 재현(replay)할 수 있는 canonical 식별자**다). (2) `source.raw_stdout_sha256` = 그 **MCP 응답 payload(JSON)를 stdout으로 캡처한 바이트열의 SHA-256**. 즉 MCP JSON 응답이 "stdout" 역할을 하고, blocker/warning/drift count는 그 캡처된 JSON에서 재유도된다. **M2 재검증**: `raw_stdout_sha256`로 식별되는 캡처된 MCP 응답을 재해시·재파싱하여 `value`가 그 응답에서 유도 가능한지 assert한다 — 셸 명령 동등성이 아니라 **MCP 호출 replay 동등성**으로 매치(R23 본질: count는 그것을 낸 캡처 출력과 결코 분리되지 않는다). 이 규약으로 MCP-backed measured count도 셸-stdout-형 `CountClaim.source`를 날조 없이 채운다(별도 source variant primitive를 새로 만들지 않고 공유 CountClaim 재사용 — command 토큰의 `mcp:` prefix가 MCP-호출 직렬화임을 표시).

## Result enum & branches

(P1: 실패만이 아니라 **성공분기를 result enum으로 1급 선언** — Investigate compatibility_verdict 패턴 재사용. orchestrator는 아래 라우팅 테이블로 처리.)

```
result: implemented | blocked | needs_setup_recovery | no_op
```

| result | 의미 | 산출 조건 |
|---|---|---|
| `implemented` | 변경 작성 완료, GATE 통과(또는 GATE가 degrade-escalate 없이 통과), commit 완료 | firebat blockers=0 AND emberdeck_drift=0 (둘 다 measured) AND commit 성공 |
| `blocked` | GATE가 막음 — firebat blockers>0 또는 emberdeck_drift≠0가 자동수정으로 해소 안 됨, 또는 commit이 구조적으로 실패 | 아래 GATE 분기 / commit 분기 |
| `needs_setup_recovery` | setup(deps/infra)이 실패하고 자동 rollback으로 clean state 복구됨 — 코드 변경 미진입 | 아래 setup 분기 |
| `no_op` | **합법적으로** 변경할 코드가 없음 (요청된 변경이 이미 존재 = 실제 GREEN, 또는 Decide-only chain에서 결정이 "코드 변경 없음") | principle 3: 빈-합법. **GATE measurement 규칙**: 코드 변경이 없어 firebat/emberdeck이 측정할 대상이 없으므로 `firebat_results`/`emberdeck_drift`는 둘 다 `status: omitted` + `reason: not_applicable`(R22 first-class 부재 — fake-zero 측정 금지이자, no_op은 실패가 아니므로 escalate도 아님). **`source_tool` 값**: Omitted $def이 `source_tool`을 required로 두므로(부재 자체도 어느 도구의 부재인지 audit되어야 함), no_op에서도 *호출되지 않았더라도* 해당 GATE 도구의 리터럴 이름을 declared-but-unrun marker로 기록한다 — `firebat_results.source_tool == "firebat"`, `emberdeck_drift.source_tool == "emberdeck"` (도구가 실행됐다는 주장이 아니라, "이 GATE 슬롯이 어느 도구의 not_applicable 부재인지"를 식별하는 라벨). 이 status/reason/source_tool은 grammar(no_op allOf)가 강제 |

### GATE 분기 — firebat blockers>0 (P2: GATE 도구 → 분기를 열고 닫음)

firebat scan이 blockers>0 반환 시:
1. **fix-and-rescan 루프** — blocker를 수정하고 firebat 재실행. 같은 변경 단위 안에서 최대 3회 시도 (bounded; producer⇄reviewer 5-누적-fail halt cap과 별개의 자기-수렴 cap).
2. 3회 후에도 blockers>0 → `result: blocked`, `failure_origin: implement`, `escalate_reason`에 잔존 blocker 요약, `escalate_evidence`에 firebat raw_stdout ref. orchestrator는 Implement⇄Implement-Reviewer 재진입(failure-routing.md) — 5-누적-fail에서 flow halt.
3. firebat가 OMITTED(부재/실패/timeout)인 경우는 *Failure & degrade handling* 참조 (GATE 부재 → escalate, blocker 판정 자체를 못 함).

### GATE 분기 — emberdeck_drift≠0 (P2: GATE 도구 → 분기를 열고 닫음; 홀#3 "어떻게 0을 강제하나" 해소)

emberdeck validate_code_links가 drift≠0 반환 시:
1. **re-link 시도** — drift의 원인이 card↔code 매핑 누락이면 emberdeck로 code link를 갱신(re-link)하고 재검증. drift가 잘못된 코드 변경 때문이면 코드를 수정하고 재검증. 같은 변경 단위 안에서 최대 3회 시도. **`emberdeck_drift.value`는 단일 미분화(undifferentiated) drift count다** (홀#4 해소: 의도된 설계): 출력은 resolvable(card-mapping 누락 → re-link) drift와 genuine code drift(잘못된 코드 변경)를 value 레벨에서 **구분하지 않는다**(별도 drift-cause 필드 없음 — 새 typed field/primitive 추가 안 함). 어떤 re-link 처분(매핑 갱신 vs 코드 수정)을 취했는지의 reasoning은 **`escalate_evidence`에만** 기록한다(blocked 분기) — orchestrator/reviewer는 structured value가 아니라 escalate_evidence 산문에서 처분 내역을 읽는다. 따라서 implemented(drift==0)와 blocked(drift≠0) 두 emberdeck 분기는 단일 count로 완전히 명세되며, cause breakdown은 의도적으로 산문에 둔다.
2. 3회 후에도 drift≠0 → `result: blocked`, `failure_origin: implement`, `escalate_reason`에 drift 항목 요약, `escalate_evidence`에 emberdeck 출력 ref. orchestrator는 Implement⇄Implement-Reviewer 재진입.
3. drift==0 달성 시 `emberdeck_drift.value == 0` (M2가 `source.raw_stdout_sha256`로 식별되는 외부 캡처 stdout을 재읽기·재파싱하여 ==0 검사). **"강제"의 의미 = "drift≠0이면 result=blocked로 escalate, 자동 re-link로 0 달성 시에만 implemented"** — const 0 placeholder가 아니라 절차 (holes#3 해소).
4. emberdeck가 OMITTED인 경우는 *Failure & degrade handling* 참조.

### orchestrator 라우팅 테이블 (Investigate 패턴 재사용)

| result | Orchestrator 처리 |
|---|---|
| `implemented` | 다음 step 진입 (`declared_next_step`, 통상 verify) |
| `blocked` | `failure_origin`로 라우팅 (failure-routing.md): origin ∈ {implement, spec, decide, test, ground, investigate} → 해당 step ⇄ reviewer 재진입(5-누적-fail → flow halt + escalate). `failure_origin: cap_exceeded` → **자동 재진입 없이 즉시 flow-level halt + escalate** (orchestrator-level halt trigger) |
| `needs_setup_recovery` | Implement⇄Implement-Reviewer 재진입 (setup 원인 수정). 반복 시 5-누적-fail cap |
| `no_op` | **합법적 빈 결과** — Reflect(completed 또는 abandoned 분류). no_op_details 학습. flow는 정상 종료 또는 Verify로 (config) |

## Failure & degrade handling

### firebat / emberdeck **도구 부재** (P2 + principle 1: GATE 도구 부재 → escalate)

firebat와 emberdeck은 **enhancement가 아니라 GATE 도구다** — 이들이 없으면 Implement은 "코드가 quality gate를 통과했다 / card↔code drift가 없다"를 mechanical하게 보증할 수 없다. 따라서 unknown-disposition.md L24(`tool_unavailable → escalate`)와 일치하게 **부재 = degraded_pass가 아니라 escalate**다.

**공유 Omitted.reason 멤버의 step-local 의미 (홀 해소 — 공유 $def과 prose 정합)**: firebat_results/emberdeck_drift의 omitted `reason`은 공유 `_defs#/$defs/Omitted.reason` enum(`tool_absent | tool_failed | timeout | unavailable | skipped | not_applicable`)을 **새 멤버 추가 없이** 재사용한다. 공유 $def description이 모든 멤버를 정의하지는 않으므로(특히 `not_applicable`), 본 step에서 각 멤버의 Implement-local 의미를 명시적으로 핀한다(공유 멤버를 좁혀 쓰는 것이지 새 의미의 별도 primitive가 아님):
> - `tool_absent` = GATE 도구 바이너리/MCP 자체 부재(`which <tool>` 실패).
> - `tool_failed` = 도구가 호출됐으나 실행 실패(비정상 exit).
> - `timeout` = 도구 호출이 시간초과.
> - `unavailable` = MCP 미부착(capability probe 실패).
> - `skipped` = config가 이 run에서 GATE를 의도적으로 미실행(Verify Pass1 위임 전용; 항상 `detail=="delegated to Verify Pass1 by config"` + `result: implemented` 동반 — 아래 3).
> - `not_applicable` = **GATE-not-reached**(코드 단계 미진입이라 스캔 대상 자체가 없음 — no_op / needs_setup_recovery / precondition·setup-dirty pre-code blocked). 공유 $def은 `not_applicable`을 정의하지 않으므로 이 'GATE-not-reached' 의미는 **본 step에서만 부여되는 step-local narrowing**이며, 스캐너가 돌다 실패했다고 거짓 주장하는 tool-failure 라벨과 구별된다.
이 핀으로 공유 enum 멤버와 prose 의미가 어긋나지 않는다(공유 $def을 건드리지 않고 step에서 멤버 의미를 정의).

전역 R12/R14 준수 (missed-item 해소 — Implement이 R12/R14를 위반하던 SOLE step이었음):
- **R12 (각 tool 부재 시 어느 step·activity가 skip되는지 contract 명시)**: firebat 부재 → activity 3(firebat scan) skip 불가(GATE), emberdeck 부재 → activity 4(validate_code_links) skip 불가(GATE). 두 경우 모두 해당 measurement는 `status: omitted` (R22 first-class 부재 — null/placeholder/fake-zero 금지).
- **R14 (omit degrade는 step spec이 명시할 때만)**: 본 절이 그 명시다. 단 GATE이므로 omit은 "조용한 degraded_pass"가 아니라 **escalate를 동반한 omit**이다.

처리:
1. firebat 부재/실패/timeout → `firebat_results.status: omitted` (`reason`, `source_tool`). emberdeck 부재/실패/timeout → `emberdeck_drift.status: omitted`. **escalate(blocked) 분기의 omitted `reason`은 위상(phase)에 따라 둘로 갈린다** (홀 해소): (a) **GATE 도구가 실제로 호출됐으나 부재/실패/timeout**(GATE-도구-부재 pre-code blocked, 또는 도구가 drop된 post-code blocked) → tool-failure 멤버 {tool_absent | tool_failed | timeout | unavailable} 중 하나로 핀(MCP 미부착 = `unavailable`, 도구 실행 실패 = `tool_failed`, 부재 = `tool_absent`, 시간초과 = `timeout`); (b) **block이 code 단계 진입 전에 일어나 GATE를 아예 못 돈 경우**(precondition 위반·setup-dirty pre-code blocked — scan할 코드가 없음) → `not_applicable`(GATE-not-reached; 별도 `not_reached` primitive를 새로 만들지 않고 공유 Omitted 멤버 재사용 — 스캐너가 돌다 실패했다고 거짓 주장하는 tool-failure 라벨 회피). 따라서 grammar(blocked allOf)는 reason∈{tool_absent | tool_failed | timeout | unavailable | **not_applicable**}을 허용하고 `skipped`(config-위임 전용, 아래 3)만 reject한다. (a)/(b) 중 어느 멤버가 honest인지는 result enum이 pre-code/post-code를 구분 못 하므로 grammar가 아니라 **M2가 핀**한다(blocked-phase GATE-omission reason honesty x-validator — pre-code 식별 HEAD==base ∧ counts==0 + **`gate_invocation_attempted` 마커**로 판정). **GATE tool-invocation 캡처 신호는 free-string escalate_evidence가 아니라 typed 필드로 떠받친다**: omitted GATE 측정(`firebat_results`/`emberdeck_drift`)은 top-level optional bool `gate_invocation_attempted`를 실어 그 GATE 도구가 이 run에서 **실제로 호출됐는지**(scan/validate_code_links 진입했는지)를 기록한다 — `true` = 도구가 호출됐으나 부재/실패/timeout(tool-failure 멤버 (a)), `false` = 도구가 아예 호출되지 않음(GATE-not-reached → not_applicable (b) 또는 위임 skipped). 이로써 M2는 `escalate_evidence` 산문 파싱이 아니라 typed 신호로 reached-but-failed vs not-reached를 mechanical하게 가른다(필드 부재 시 M2는 escalate_evidence로 fallback — 후방호환).
2. GATE를 mechanical하게 못 돌렸으므로 Implement은 그 gate를 **자기 책임으로 통과시키지 않는다** — `result: blocked`, `failure_origin: implement`, `escalate_reason: "<tool> unavailable — GATE not enforceable"`, `escalate_evidence`에 `which <tool>` exit / MCP attach 상태. orchestrator는 NEEDS_CONTEXT escalate 또는 Implement 재진입(도구 복구 후). (principle 1: 주요/GATE 도구 부재 → escalate.)
3. **delegation 대안 (config)**: 환경 정책이 firebat/emberdeck를 Verify Pass1로 위임하도록 설정된 경우, Implement은 `firebat_results.status: omitted` + `result: implemented` + `unverified: true`로 진행하되, **drift/blocker gate가 미강제임을 omitted reason과 unverified로 명시 propagate** — Verify Pass1이 단일 gate가 된다. **위임은 두 GATE를 함께(all-or-nothing) 위임한다** (홀 해소): config가 GATE를 Verify Pass1로 위임하면 firebat·emberdeck **둘 다** omitted(reason=skipped)로 가고 둘 다 측정하지 않는다 — 한 GATE만 위임(skipped)하면서 다른 GATE는 RUN하여 blocker/drift≠0으로 result=blocked를 강제하는 **혼합 케이스는 발생하지 않는다**. 따라서 delegated(skipped) GATE는 측정-blocking sibling과 결코 공존하지 않으며, `skipped`는 항상 `result: implemented` 분기에서만 나타난다(blocked 분기는 `skipped`를 reject — 위 1의 phase 멤버만). 위임이 켜진 run에서 코드 자체가 다른 사유로 blocked되면(precondition·setup-dirty·commit conflict 등) 두 GATE는 phase에 맞는 tool-failure/not_applicable 멤버로 가지 `skipped`가 아니다(위임은 GATE 미실행을 뜻하므로 그 run은 애초에 GATE-측정 blocked가 아니다). **이때 omitted `reason`은 공유 Omitted enum의 `skipped` 값으로 라벨하고**(별도의 'delegated' enum member를 새로 만들지 않는다 — `skipped` = "이 run에서 GATE 도구가 의도적으로 실행되지 않음"), `detail`에 `"delegated to Verify Pass1 by config"`를 적어 위임 사유를 명시한다. `source_tool`은 위임된 GATE 도구 이름(`firebat`/`emberdeck`). (이 위임은 "조용한 rubber-stamp"가 아니라 unverified=true + reason=skipped/detail로 표면화된 명시 degrade다.) **이 'never silent rubber-stamp' 불변식은 grammar가 강제**한다 — `result=implemented` AND (firebat_results 또는 emberdeck_drift가 omitted)이면 그 omitted의 `reason==skipped` + `detail=="delegated to Verify Pass1 by config"` + `unverified==true`가 allOf로 강제되고, implemented+omitted에 tool-failure reason이나 `unverified:false`는 reject된다(value 정합인 flow_type/config 실제 위임 여부는 M2). **기본값은 escalate (위 2)**; delegation은 config opt-in.

> 어느 경우에도 legacy의 `emberdeck_drift: 0  # 강제` 하드-assert는 **금지** — 부재 시 fake-zero를 만들지 않는다 (R13/R14 위반 제거; missed-item 해소).

### Setup 실패 (홀#6 해소 — setup failure 처리)

deps install / config 변경 / infra 셋업이 실패 시:
1. **부분-상태 rollback** — setup이 만든 부분 상태(부분 설치 deps, 변경된 config, 띄운 infra)를 가능한 한 원복하여 repo/환경을 setup 진입 전 clean state로 복구. rollback은 작성 코드 변경 *이전* 단계이므로 commit은 진입하지 않는다.
2. rollback으로 clean state 복구됨 → `result: needs_setup_recovery`, `failure_origin: implement`, `escalate_reason`에 setup 실패 원인. orchestrator는 Implement 재진입(원인 수정). **GATE measurement 규칙**: setup이 code 단계 진입 *전*에 실패했으므로 firebat/emberdeck은 실행되지 않았다 — 측정 대상이 없다. 따라서 `firebat_results`/`emberdeck_drift`는 둘 다 `status: omitted` + `reason: not_applicable`(GATE-not-reached; measured-0 날조 금지이자, setup-rollback disposition이지 GATE 도구 실패가 아니므로 tool-failure 라벨도 금지) + `source_tool`은 declared-but-unrun marker로 해당 도구 리터럴 이름(`firebat_results.source_tool == "firebat"`, `emberdeck_drift.source_tool == "emberdeck"`). 이 status/reason/source_tool은 grammar(needs_setup_recovery allOf)가 강제한다 — no_op 분기와 동일한 슬롯-라벨 법칙.
3. rollback 불가(환경이 더럽혀진 채 복구 불능) → `result: blocked`, `failure_origin: implement`, `escalate_reason: "setup failed, dirty state not recoverable"` + NEEDS_CONTEXT escalate (사람 개입). **commit은 실행하지 않는다** — partial setup 위에 commit 금지.

### Commit 실패 (홀#7 해소 — commit failure 처리)

Atomic commit이 실패 시 (pre-commit hook reject / merge conflict / dirty tree):
1. **pre-commit hook reject**: hook이 firebat/lint류 blocker를 잡은 것 → GATE 분기(firebat blockers>0)와 동일하게 fix-and-recommit 최대 3회. 미해소 시 `result: blocked`, `failure_origin: implement`.
2. **merge conflict / dirty tree**: working tree가 예상과 다름 = upstream/환경 결손. `result: blocked`, `failure_origin: implement`, `escalate_evidence`에 git status. orchestrator는 Implement 재진입 또는 NEEDS_CONTEXT escalate. **부분 commit으로 진행 금지** (atomicity 보존). 이때 fix-and-recommit 루프가 만든 미커밋 working-tree 편집은 `changes[]`/`commits[]`에 등재하지 않고(committed `<base>..HEAD` 측정면 밖) working-tree `git diff`로 `escalate_evidence`에만 첨부한다 — `changed_files_count`/`new_commits_count`의 committed-surface 항등식(*Output* 소싱 절)을 깨지 않는 post-code blocked 경로.
3. commit 성공 → 해당 commit을 `commits[]`에 기록, `new_commits_count`(R23) 갱신.

### Upstream 결손 라우팅 (principle 2 — Implement은 request_upstream_deepen 못 씀)

Implement이 입력(Spec/Decide/Test)의 결손/기형을 발견하면, `request_upstream_deepen`을 **발행하지 않는다** (그건 Decide 전용 — principle 2). 대신 기존 `failure_origin` escalate 경로로 라우팅: `result: blocked`, `failure_origin`에 결손 origin(spec|decide|test|ground|investigate), `escalate_reason`/`escalate_evidence` 첨부. orchestrator가 해당 step ⇄ reviewer 재진입(failure-routing.md). 5-누적-fail halt cap이 ping-pong을 bound한다.

## Input preconditions

(P8 + P7 + principle 3: garbage-in 맹신 제거. 필수 upstream 필드의 *존재+정형*을 assert — 진실성 검사는 아님(그건 Verify). 결손/기형 → escalate. Ground active_flow_state mechanical-error 패턴 일반화. ping-pong은 5-누적-fail cap이 bound.)

Implement은 code 작성 *전에* 입력 precondition을 검사한다. 아래 위반은 **mechanical error → escalate**이지 빈-합법(no_op)이 아니다 (principle 3: 결손/기형 vs 합법적 빔 구분):

| precondition | 위반 시 |
|---|---|
| min 1 of (spec_ref \| decide_ref) 존재 + 해당 row 해소 가능 | **둘 다 리터럴 부재**(spec_ref·decide_ref 키 자체가 없음)는 Implement이 emit하는 output 형태가 아니다 — `based_on.anyOf`가 최소 1개 present를 grammar로 강제하므로 ref 없는 output을 만들 수 없고, **이 both-absent 케이스는 orchestrator/triage 경계에서 차단된다**(orchestrator는 acceptance target ref가 하나도 없으면 Implement을 dispatch하지 않는다 — Implement precondition이 아니라 dispatch 선조건). **ref는 present이나 가리킨 row가 미해소**(둘 다 present-but-unresolvable, 또는 anyOf를 만족하는 1개만 present이고 그게 미해소)인 경우 = mechanical error → `result: blocked`, `failure_origin: implement`(orchestrator 라우팅 결손) → NEEDS_CONTEXT escalate. acceptance target 없이 코드 작성 금지 (anyOf로 부재 케이스는 fabricate ref 없이 차단되고, 미해소 케이스만 Implement이 blocked로 emit) |
| Spec chain인데 **Spec.acceptance_criteria 빈 list** | (P7) 빈 AC는 *합법적 빔이 아니라 결손* — Spec이 변환 못 함. `result: blocked`, `failure_origin: spec`. orchestrator는 Spec⇄Spec-Reviewer 재진입. **빈 AC를 "코딩할 것 없음"으로 자동 no_op 고무도장 금지** |
| Spec chain인데 **Spec.code_architecture.files 빈 + Spec.tasks 빈** | (P7) 구현 대상이 0 — 결손. `result: blocked`, `failure_origin: spec`. (요청이 진짜로 "코드 변경 불필요"면 그 판정은 Decide/Investigate no_op에서 이미 났어야 함 — Spec까지 와서 빈 것은 Spec 결손) |
| Decide-only chain인데 **Decide 산출에 변경 의도 부재** (decision_record에 결정 없음 / option_selection에 선택 없음) | (P7) 결손. `result: blocked`, `failure_origin: decide`. orchestrator는 Decide⇄Decide-Reviewer 재진입 |
| Test가 chain에 명시됐는데 **test_ref 부재/미해소** | mechanical error → `result: blocked`, `failure_origin: test` |
| 입력 ref의 row가 **malformed**(필수 필드 누락/타입 오류) | mechanical error → `result: blocked`, `failure_origin`=해당 upstream step |
| 입력 row가 해소 가능·정형이나 **stale**(acceptance target이 현재 repo HEAD와 불일치 — 코드가 이미 drift했거나 `base` commit이 사라짐) | mechanical error → `result: blocked`, `failure_origin`=해당 upstream step(spec\|decide\|test). resolvable·well-formed라도 stale-but-valid를 맹신하지 않음(garbage-in 제거; principle 3). `escalate_evidence`에 row가 가리킨 base commit vs 현재 HEAD 불일치 |

**`base` 정의**: `base` = 이 Implement run **진입 시점의 repo HEAD commit**(upstream acceptance target row가 전제한 commit). 위 *changed_files_count/changes[]* 및 *new_commits_count/commits[]* M2 검사(`<base>..HEAD` diff/rev-list, schema changes↔git diff)는 모두 이 `base`를 기준으로 한다. precondition은 진입 시 `base`가 (a) 실재하는 commit이고 (b) upstream row가 전제한 commit과 일치함을 검사한다 — 불일치면 위 stale 분기로 `result: blocked`. `base`가 검증된 뒤에야 코드 작성에 진입한다.

**합법적 빔 vs 결손 (principle 3)**: 요청된 변경이 *이미 코드에 존재*(실제 GREEN, diff 0)이거나 Decide 결정이 명시적으로 "코드 변경 없음"이면 → 이는 결손이 아니라 **합법적 no_op** (`result: no_op` + `no_op_details`). 반대로 입력이 비어서/깨져서 작성할 게 없는 것은 → **escalate**. 둘을 절대 혼동하지 않으며, 후자를 전자(rubber-stamp no_op)로 처리하지 않는다.

## Step Depth Policy

| Depth | 활동 | Caps |
|---|---|---|
| Shallow | minimal patch (single concern) | wall_s=120, tokens=15k |
| Deep | full implementation + setup + 다중 commits | wall_s=900, tokens=60k |

**Deepen triggers** (OR — 어느 하나라도 참이면 deep):
- **Spec chain**: flow_type ∈ {Feature, Migration, Performance, Compound} | Spec.tasks.length ≥ 3 | Spec.code_architecture.files.length ≥ 5
- **Decide-only chain** (Spec 없음 — Bug Fix / Chore / Release / Spike, flow_type ∉ {Feature, Migration, Performance, Compound}): Decide 산출의 변경 의도가 다중 단위면 deep. 구체적으로 design_document의 설계 항목 ≥ 3 | option_selection의 선택 옵션이 ≥ 3 file/module을 건드림 | decision_record의 결정이 ≥ 3 변경 의도 항목. (Spec-기반 trigger는 Spec 부재 시 구조적으로 적용 불가하므로, Decide-only chain은 Decide 산출 항목 수로 sizing — 입력계약(min-1-of Spec|Decide)과 depth계약 정합. 어떤 항목 수도 측정 불가하면 shallow가 기본.)

P0 emergency mode는 **shallow 강제** (emergency_mode.active=true ⇒ depth=shallow — M1 grammar 강제: active==true allOf가 `depth==shallow`를 token-generation 시점에 강제) — Deepen trigger보다 우선.

**비-구현 분기의 depth (required 필드의 정의된 값)**: `depth`는 모든 result 분기에서 required인데, no_op / needs_setup_recovery / pre-code blocked(precondition 위반·setup-dirty·GATE-도구-부재) 분기는 실제 구현 작업이 없어 위 Deepen trigger의 sizing(Spec.tasks 수·Decide 변경 의도 항목 수 등)이 구조적으로 적용 불가하다. 이 분기들에서는 **depth=shallow가 기본값**(구현 sizing 미적용). 강제 수준은 분기별로 다르다: `result ∈ {no_op, needs_setup_recovery}`는 result enum만으로 식별 가능하므로 **grammar(allOf)가 depth==shallow를 강제**한다(deep 거부). `pre-code blocked`는 result=blocked가 post-code blocked와 enum상 구분되지 않아 grammar로 가를 수 없으므로 — producer는 shallow를 **emit해야 한다(SHOULD)** 이며 M2가 검사한다(pre-code 식별: HEAD==base ∧ counts==0). 어느 경우든 required `depth`는 정의된 값을 가진다.

**Step 자체 budget 소진 처리** (Test step과 동일 원칙 — silent partial proceed 금지): 위 caps(wall_s/tokens)가 구현 완료 *전에* 소진되면(예: deep run이 wall_s=900을 partial·uncommitted 코드인 채로 초과) → Implement은 **부분 commit으로 진행하지 않는다**(atomicity 보존; 미완성 변경은 uncommitted로 남김). mechanical error → **escalate**: `result: blocked`, `failure_origin: cap_exceeded`, `escalate_reason: "step budget (wall_s/tokens) exhausted before completion"`, `escalate_evidence`에 진행분(완료된 change 단위 목록 + 남은 작업 요약). `cap_exceeded`는 공유 FailureOrigin enum의 orchestrator-level halt trigger(failure-routing.md) — Implement⇄Implement-Reviewer 자동 재진입이 아니라 flow-level halt+escalate. (DONE_WITH_CONCERNS 폐지 원칙과 동일: 예산 초과를 implemented로 고무도장 금지.)

## Reviewer (implement-reviewer)

- 코드가 acceptance target을 충족하는가 — Spec chain이면 Spec.acceptance_criteria, Decide-only chain이면 Decide 산출의 명시 변경 의도 (홀#5 해소: No-Spec path도 평가 기준이 정의됨)
- **deviation rules 준수** — deviation rules는 글로벌 enforcement 개념으로 `.claude/rules/blazewrit/enforcement.md`에 거주한다 (per-flow data field가 아님; false-hole 교정 반영). reviewer는 그 enforcement 파일의 항목에 대해 검증한다. *(홀#1 해소: legacy README L52의 dangling 참조 `deviation_rules에 명시된 항목`을 — 어느 step도 생산하지 않는 입력/출력 필드로 오해하지 않도록 — 그 referent의 source를 enforcement.md로 명시. 만약 환경에 enforcement.md가 없으면 이 reviewer 기준은 적용하지 않는다(빈 기준에 대한 vacuous 통과 금지가 아니라, 존재하지 않는 정책에 대한 판정 자체를 생략).)*
- stub/hollow 없는가 (실제 동작) — `unverified` floor가 self-asserted truth임을 인지(Verify가 단일 gate)
- firebat blockers = 0 (**result=implemented**일 때만 — firebat_results.status=measured 가정; result=blocked면 측정된 blockers>0이 escalate evidence이므로 reviewer FAIL이 아님. omitted면 *Failure & degrade handling*에 따라 escalate/위임이 이미 처리됨 — reviewer는 omitted를 "0"으로 간주하지 않음)
- emberdeck drift = 0 (**result=implemented**일 때만 — emberdeck_drift.status=measured 가정; result=blocked면 측정된 drift≠0이 escalate evidence이지 FAIL 아님. omitted 처리 동일)
- atomic commits (한 commit = 한 logical change)
- result enum 정합 — `result`와 firebat/emberdeck/setup/commit 분기 일치, escalate 분기면 failure_origin 존재

## Boundary

| 항목 | 책임 |
|---|---|
| Test 작성 | Test |
| 코드 architecture 결정 | Spec |
| 옵션 결정 | Decide |
| Flow-level 검증 / 목표 달성 판정 | Verify |
| follow-up flow 큐잉 | Verify가 SIGNAL → orchestrator가 큐잉 (Implement은 안 함) |
| upstream artifact gate / failure routing 소유 | Verify (Implement은 결손을 *감지 → failure_origin escalate*만; request_upstream_deepen은 Decide 전용 — principle 2) |
| deviation rules 정의 | `.claude/rules/blazewrit/enforcement.md` (글로벌, 어느 step도 per-flow로 생산 안 함) |

## P0 Emergency Mode

`flow_type=bugfix-p0` 시 Implement은 *emergency mode* (`emergency_mode.active=true`; 그 외 모든 flow에서는 `active=false`이고 아래 P0 전용 하위 flag는 부재):
- Test 우회 (Test는 Verify 후 retroactive) — **`emergency_mode.test_bypass=true` FLAG로 기록** (필드를 드롭하지 않음; output shape는 그대로). based_on.test_ref는 부재. **active=true일 때 `test_bypass`는 REQUIRED-present**(부재 금지) — grammar(active==true allOf)가 존재를 강제하고, 값이 실제 true인지(=flow_type=bugfix-p0 정합)는 M2가 검사. P0 invariant 'shallow 강제 + Test bypass FLAG 기록'이 shape 레벨에서 닫힘(M2 단독 위임 아님).
- shallow 강제 (depth=shallow) — active=true allOf가 `depth==shallow`를 grammar로 강제
- 빠른 fix 우선
- Verify PASS 후 post-stabilization follow-up (Test 추가 + 정상 Bug Fix flow) **자동 큐잉을 Verify가 SIGNAL** → orchestrator가 큐잉 (`emergency_mode.retroactive_test_followup_queued`로 표시). Implement은 큐잉하지 않음 (boundary). 따라서 이 flag는 **Implement emit 시점(Verify 이전)엔 항상 부재**다 — active=true allOf가 그 부재를 grammar로 강제(present-false도 금지). orchestrator가 Verify PASS 경로에서 비로소 set한다.
- P0에서도 firebat/emberdeck GATE 부재 시 처리는 *Failure & degrade handling*과 동일 (P0가 GATE escalate를 면제하지 않음 — 단 config가 Verify-Pass1 위임을 켰다면 그 경로).
