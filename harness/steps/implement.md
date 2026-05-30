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

**Input contract rule**: minimum = 1 of (Spec | Decide). Test는 flow chain이 명시할 때만 required. reviewer/M2는 chain 명시에 따라 검증 (실제 입력 ref 해소는 아래 *Input preconditions* 절).

## Activities

1. **Setup** — deps install, config 변경, infra 셋업 (필요 시). 실패 처리는 *Failure & degrade handling* 절.
2. **Code** — acceptance target(Spec.code_architecture 또는 Decide 산출 변경 의도)에 따른 변경.
3. **firebat scan** — 매 change 후 (GATE). blockers>0 분기는 *Result enum & branches*에서 닫음. tool 부재 분기는 *Failure & degrade handling*에서 닫음.
4. **emberdeck validate_code_links** — card↔code drift 검출 (GATE). drift≠0 분기는 *Result enum & branches*에서 닫음. tool 부재 분기는 *Failure & degrade handling*에서 닫음.
5. **Atomic commit** — logical unit 단위. 실패 처리는 *Failure & degrade handling* 절.

## Output

```yaml
result: implemented | blocked | needs_setup_recovery | no_op   # P1: 성공분기 포함 전체 result enum
changes:
  - file_path, change_type: create|modify|delete               # file_path = git-versioned CODE path (RowRef 아님)
commits:
  - sha, message, files
firebat_results:                                               # M3 DegradableMeasurement (Measured | Omitted)
  status: measured | omitted
  # measured: value: { blockers: CountClaim, warnings: CountClaim }, source_tool
  # omitted:  reason, source_tool                              # GATE 부재 → 이 output은 escalate 분기에서만 (아래 P2)
emberdeck_drift:                                               # M3 DegradableMeasurement (Measured | Omitted)
  status: measured | omitted
  # measured: value: CountClaim (==0 강제, M2 검사)
  # omitted:  reason, source_tool                              # GATE 부재 → escalate 분기에서만
new_commits_count: CountClaim                                  # R23 (value == commits.length, M2)
changed_files_count: CountClaim                                # R23 (value == changes.length, M2)
emergency_mode: { active, test_bypass?, retroactive_test_followup_queued? }
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
# 실패/escalate 분기 (result != implemented)일 때:
failure_origin?: implement | spec | decide | test | ground | investigate   # principle 2/3: 결손 라우팅
escalate_reason?: string
escalate_evidence?: <ref or file:line>
no_op_details?: { reason, evidence, current_state, target_state, suggested_action }  # result=no_op일 때 필수
```

**`based_on` 필드별 채움 규칙 (P3 + 홀#4 해소)**:
- `spec_ref`: Spec chain일 때만 존재 (Spec 출력 RowRef). Decide-only chain에서는 **부재** — placeholder/빈 string 금지.
- `decide_ref`: Decide-only chain일 때만 존재 (Decide 출력 RowRef). `decide_ref` 필드는 **실재한다** — Decide가 유효한 sole input이므로 (legacy README가 `decide_ref`를 빠뜨린 것이 홀이었음, 본 계약이 추가).
- `test_ref`: flow chain이 Test 단계를 명시할 때만 존재. Test 부재 시 **필드 자체를 생략** — null/빈값 금지.
- min 1 of (`spec_ref` | `decide_ref`) 항상 존재 (anyOf 강제). Decide-then-Spec chain은 둘 다 가질 수 있음(anyOf = at-least-one).

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
| `no_op` | **합법적으로** 변경할 코드가 없음 (요청된 변경이 이미 존재 = 실제 GREEN, 또는 Decide-only chain에서 결정이 "코드 변경 없음") | principle 3: 빈-합법 |

### GATE 분기 — firebat blockers>0 (P2: GATE 도구 → 분기를 열고 닫음)

firebat scan이 blockers>0 반환 시:
1. **fix-and-rescan 루프** — blocker를 수정하고 firebat 재실행. 같은 변경 단위 안에서 최대 3회 시도 (bounded; producer⇄reviewer 5-누적-fail halt cap과 별개의 자기-수렴 cap).
2. 3회 후에도 blockers>0 → `result: blocked`, `failure_origin: implement`, `escalate_reason`에 잔존 blocker 요약, `escalate_evidence`에 firebat raw_stdout ref. orchestrator는 Implement⇄Implement-Reviewer 재진입(failure-routing.md) — 5-누적-fail에서 flow halt.
3. firebat가 OMITTED(부재/실패/timeout)인 경우는 *Failure & degrade handling* 참조 (GATE 부재 → escalate, blocker 판정 자체를 못 함).

### GATE 분기 — emberdeck_drift≠0 (P2: GATE 도구 → 분기를 열고 닫음; 홀#3 "어떻게 0을 강제하나" 해소)

emberdeck validate_code_links가 drift≠0 반환 시:
1. **re-link 시도** — drift의 원인이 card↔code 매핑 누락이면 emberdeck로 code link를 갱신(re-link)하고 재검증. drift가 잘못된 코드 변경 때문이면 코드를 수정하고 재검증. 같은 변경 단위 안에서 최대 3회 시도.
2. 3회 후에도 drift≠0 → `result: blocked`, `failure_origin: implement`, `escalate_reason`에 drift 항목 요약, `escalate_evidence`에 emberdeck 출력 ref. orchestrator는 Implement⇄Implement-Reviewer 재진입.
3. drift==0 달성 시 `emberdeck_drift.value == 0` (M2가 raw_stdout 재파싱으로 ==0 검사). **"강제"의 의미 = "drift≠0이면 result=blocked로 escalate, 자동 re-link로 0 달성 시에만 implemented"** — const 0 placeholder가 아니라 절차 (holes#3 해소).
4. emberdeck가 OMITTED인 경우는 *Failure & degrade handling* 참조.

### orchestrator 라우팅 테이블 (Investigate 패턴 재사용)

| result | Orchestrator 처리 |
|---|---|
| `implemented` | 다음 step 진입 (`declared_next_step`, 통상 verify) |
| `blocked` | Implement⇄Implement-Reviewer 재진입 (failure-routing.md). 5-누적-fail → flow halt + escalate |
| `needs_setup_recovery` | Implement⇄Implement-Reviewer 재진입 (setup 원인 수정). 반복 시 5-누적-fail cap |
| `no_op` | **합법적 빈 결과** — Reflect(completed 또는 abandoned 분류). no_op_details 학습. flow는 정상 종료 또는 Verify로 (config) |

## Failure & degrade handling

### firebat / emberdeck **도구 부재** (P2 + principle 1: GATE 도구 부재 → escalate)

firebat와 emberdeck은 **enhancement가 아니라 GATE 도구다** — 이들이 없으면 Implement은 "코드가 quality gate를 통과했다 / card↔code drift가 없다"를 mechanical하게 보증할 수 없다. 따라서 unknown-disposition.md L24(`tool_unavailable → escalate`)와 일치하게 **부재 = degraded_pass가 아니라 escalate**다.

전역 R12/R14 준수 (missed-item 해소 — Implement이 R12/R14를 위반하던 SOLE step이었음):
- **R12 (각 tool 부재 시 어느 step·activity가 skip되는지 contract 명시)**: firebat 부재 → activity 3(firebat scan) skip 불가(GATE), emberdeck 부재 → activity 4(validate_code_links) skip 불가(GATE). 두 경우 모두 해당 measurement는 `status: omitted` (R22 first-class 부재 — null/placeholder/fake-zero 금지).
- **R14 (omit degrade는 step spec이 명시할 때만)**: 본 절이 그 명시다. 단 GATE이므로 omit은 "조용한 degraded_pass"가 아니라 **escalate를 동반한 omit**이다.

처리:
1. firebat 부재/실패/timeout → `firebat_results.status: omitted` (`reason`, `source_tool`). emberdeck 부재/실패/timeout → `emberdeck_drift.status: omitted`.
2. GATE를 mechanical하게 못 돌렸으므로 Implement은 그 gate를 **자기 책임으로 통과시키지 않는다** — `result: blocked`, `failure_origin: implement`, `escalate_reason: "<tool> unavailable — GATE not enforceable"`, `escalate_evidence`에 `which <tool>` exit / MCP attach 상태. orchestrator는 NEEDS_CONTEXT escalate 또는 Implement 재진입(도구 복구 후). (principle 1: 주요/GATE 도구 부재 → escalate.)
3. **delegation 대안 (config)**: 환경 정책이 firebat/emberdeck를 Verify Pass1로 위임하도록 설정된 경우, Implement은 `firebat_results.status: omitted` + `result: implemented` + `unverified: true`로 진행하되, **drift/blocker gate가 미강제임을 omitted reason과 unverified로 명시 propagate** — Verify Pass1이 단일 gate가 된다. (이 위임은 "조용한 rubber-stamp"가 아니라 unverified=true로 표면화된 명시 degrade다.) **기본값은 escalate (위 2)**; delegation은 config opt-in.

> 어느 경우에도 legacy의 `emberdeck_drift: 0  # 강제` 하드-assert는 **금지** — 부재 시 fake-zero를 만들지 않는다 (R13/R14 위반 제거; missed-item 해소).

### Setup 실패 (홀#6 해소 — setup failure 처리)

deps install / config 변경 / infra 셋업이 실패 시:
1. **부분-상태 rollback** — setup이 만든 부분 상태(부분 설치 deps, 변경된 config, 띄운 infra)를 가능한 한 원복하여 repo/환경을 setup 진입 전 clean state로 복구. rollback은 작성 코드 변경 *이전* 단계이므로 commit은 진입하지 않는다.
2. rollback으로 clean state 복구됨 → `result: needs_setup_recovery`, `failure_origin: implement`, `escalate_reason`에 setup 실패 원인. orchestrator는 Implement 재진입(원인 수정).
3. rollback 불가(환경이 더럽혀진 채 복구 불능) → `result: blocked`, `failure_origin: implement`, `escalate_reason: "setup failed, dirty state not recoverable"` + NEEDS_CONTEXT escalate (사람 개입). **commit은 실행하지 않는다** — partial setup 위에 commit 금지.

### Commit 실패 (홀#7 해소 — commit failure 처리)

Atomic commit이 실패 시 (pre-commit hook reject / merge conflict / dirty tree):
1. **pre-commit hook reject**: hook이 firebat/lint류 blocker를 잡은 것 → GATE 분기(firebat blockers>0)와 동일하게 fix-and-recommit 최대 3회. 미해소 시 `result: blocked`, `failure_origin: implement`.
2. **merge conflict / dirty tree**: working tree가 예상과 다름 = upstream/환경 결손. `result: blocked`, `failure_origin: implement`, `escalate_evidence`에 git status. orchestrator는 Implement 재진입 또는 NEEDS_CONTEXT escalate. **부분 commit으로 진행 금지** (atomicity 보존).
3. commit 성공 → 해당 commit을 `commits[]`에 기록, `new_commits_count`(R23) 갱신.

### Upstream 결손 라우팅 (principle 2 — Implement은 request_upstream_deepen 못 씀)

Implement이 입력(Spec/Decide/Test)의 결손/기형을 발견하면, `request_upstream_deepen`을 **발행하지 않는다** (그건 Decide 전용 — principle 2). 대신 기존 `failure_origin` escalate 경로로 라우팅: `result: blocked`, `failure_origin`에 결손 origin(spec|decide|test|ground|investigate), `escalate_reason`/`escalate_evidence` 첨부. orchestrator가 해당 step ⇄ reviewer 재진입(failure-routing.md). 5-누적-fail halt cap이 ping-pong을 bound한다.

## Input preconditions

(P8 + P7 + principle 3: garbage-in 맹신 제거. 필수 upstream 필드의 *존재+정형*을 assert — 진실성 검사는 아님(그건 Verify). 결손/기형 → escalate. Ground active_flow_state mechanical-error 패턴 일반화. ping-pong은 5-누적-fail cap이 bound.)

Implement은 code 작성 *전에* 입력 precondition을 검사한다. 아래 위반은 **mechanical error → escalate**이지 빈-합법(no_op)이 아니다 (principle 3: 결손/기형 vs 합법적 빔 구분):

| precondition | 위반 시 |
|---|---|
| min 1 of (spec_ref \| decide_ref) 존재 + 해당 row 해소 가능 | 둘 다 부재/미해소 = mechanical error → `result: blocked`, `failure_origin: implement`(orchestrator 라우팅 결손) → NEEDS_CONTEXT escalate. acceptance target 없이 코드 작성 금지 |
| Spec chain인데 **Spec.acceptance_criteria 빈 list** | (P7) 빈 AC는 *합법적 빔이 아니라 결손* — Spec이 변환 못 함. `result: blocked`, `failure_origin: spec`. orchestrator는 Spec⇄Spec-Reviewer 재진입. **빈 AC를 "코딩할 것 없음"으로 자동 no_op 고무도장 금지** |
| Spec chain인데 **Spec.code_architecture.files 빈 + Spec.tasks 빈** | (P7) 구현 대상이 0 — 결손. `result: blocked`, `failure_origin: spec`. (요청이 진짜로 "코드 변경 불필요"면 그 판정은 Decide/Investigate no_op에서 이미 났어야 함 — Spec까지 와서 빈 것은 Spec 결손) |
| Decide-only chain인데 **Decide 산출에 변경 의도 부재** (decision_record에 결정 없음 / option_selection에 선택 없음) | (P7) 결손. `result: blocked`, `failure_origin: decide`. orchestrator는 Decide⇄Decide-Reviewer 재진입 |
| Test가 chain에 명시됐는데 **test_ref 부재/미해소** | mechanical error → `result: blocked`, `failure_origin: test` |
| 입력 ref의 row가 **malformed**(필수 필드 누락/타입 오류) | mechanical error → `result: blocked`, `failure_origin`=해당 upstream step |

**합법적 빔 vs 결손 (principle 3)**: 요청된 변경이 *이미 코드에 존재*(실제 GREEN, diff 0)이거나 Decide 결정이 명시적으로 "코드 변경 없음"이면 → 이는 결손이 아니라 **합법적 no_op** (`result: no_op` + `no_op_details`). 반대로 입력이 비어서/깨져서 작성할 게 없는 것은 → **escalate**. 둘을 절대 혼동하지 않으며, 후자를 전자(rubber-stamp no_op)로 처리하지 않는다.

## Step Depth Policy

| Depth | 활동 | Caps |
|---|---|---|
| Shallow | minimal patch (single concern) | wall_s=120, tokens=15k |
| Deep | full implementation + setup + 다중 commits | wall_s=900, tokens=60k |

**Deepen triggers**: flow_type ∈ {Feature, Migration, Performance, Compound} | Spec.tasks.length ≥ 3 | Spec.code_architecture.files.length ≥ 5

P0 emergency mode는 **shallow 강제** (emergency_mode.active=true ⇒ depth=shallow, M2 검사).

## Reviewer (implement-reviewer)

- 코드가 acceptance target을 충족하는가 — Spec chain이면 Spec.acceptance_criteria, Decide-only chain이면 Decide 산출의 명시 변경 의도 (홀#5 해소: No-Spec path도 평가 기준이 정의됨)
- **deviation rules 준수** — deviation rules는 글로벌 enforcement 개념으로 `.claude/rules/blazewrit/enforcement.md`에 거주한다 (per-flow data field가 아님; false-hole 교정 반영). reviewer는 그 enforcement 파일의 항목에 대해 검증한다. *(홀#1 해소: legacy README L52의 dangling 참조 `deviation_rules에 명시된 항목`을 — 어느 step도 생산하지 않는 입력/출력 필드로 오해하지 않도록 — 그 referent의 source를 enforcement.md로 명시. 만약 환경에 enforcement.md가 없으면 이 reviewer 기준은 적용하지 않는다(빈 기준에 대한 vacuous 통과 금지가 아니라, 존재하지 않는 정책에 대한 판정 자체를 생략).)*
- stub/hollow 없는가 (실제 동작) — `unverified` floor가 self-asserted truth임을 인지(Verify가 단일 gate)
- firebat blockers = 0 (firebat_results.status=measured일 때; omitted면 *Failure & degrade handling*에 따라 escalate/위임이 이미 처리됨 — reviewer는 omitted를 "0"으로 간주하지 않음)
- emberdeck drift = 0 (emberdeck_drift.status=measured일 때; omitted 처리 동일)
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

`flow_type=bugfix-p0` 시 Implement은 *emergency mode*:
- Test 우회 (Test는 Verify 후 retroactive) — **`emergency_mode.test_bypass=true` FLAG로 기록** (필드를 드롭하지 않음; output shape는 그대로). based_on.test_ref는 부재.
- shallow 강제 (depth=shallow)
- 빠른 fix 우선
- Verify PASS 후 post-stabilization follow-up (Test 추가 + 정상 Bug Fix flow) **자동 큐잉을 Verify가 SIGNAL** → orchestrator가 큐잉 (`emergency_mode.retroactive_test_followup_queued`로 표시). Implement은 큐잉하지 않음 (boundary).
- P0에서도 firebat/emberdeck GATE 부재 시 처리는 *Failure & degrade handling*과 동일 (P0가 GATE escalate를 면제하지 않음 — 단 config가 Verify-Pass1 위임을 켰다면 그 경로).
