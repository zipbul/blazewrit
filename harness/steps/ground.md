# Ground — Evidence Boundary

## Definition

> **Ground는 Triage된 의도를 bounded·sourced·current 사실 + 명시 불확실성으로 변환한다.** 영향 해석도, 행동 선택도 하지 않는다. 다음 step (Investigate)이 *추측 없이* 영향 분석할 수 있는 evidence 기반을 제공.

**Ground가 하는 것**: ED 그래프 query / volatile 측정 / unknown·conflict surface
**Ground가 안 하는 것**: 판정, 영향 분석, 설계, 계획, 카드 생성, 코드 변경, 측정값 *해석*, 위험 *판단*, unknown의 *disposition 분류* (그건 Investigate 일 — 본 contract는 unknown을 *사실 태그*로만 surface)

Ground는 단일 명시 `ground_result`를 산출한다 (success 분기를 포함한 전체 result enum — 아래 [Result enum & branches] 참조). 성공·degrade·escalate를 같은 discriminated enum으로 선언하여 "성공 출력 미정의"(P1) 홀을 닫는다. (P1: success branch declared)

## Inputs

| 필드 | 필수 | 설명 |
|---|---|---|
| `flow_type`, `classification_metadata`, `clarifications` | ✓ | Triage 출력 |
| `request_text` | ✓ | 원 입력 |
| `conversation_context` | optional | None-state turns (user_session에만 존재; a2a/ci는 빈 값) |
| `channel` | ✓ | user_session \| a2a \| ci |
| `active_flow_state` | optional | 다른 in-flight 작업 인지용 (충돌 해결은 orchestrator) |
| `scope_hint` | optional | 모노리포 패키지/경로 한정 (Triage가 추출 또는 caller가 명시) |

## Input preconditions (P8 — garbage-in 감지, 횡단 단일 문구)

Ground는 필수 upstream 필드의 *존재 + 정형*만 assert한다 (값의 *진실*은 검증하지 않음 — 그건 Verify 일). 이는 모든 step에 적용되는 동일 input-precondition 문구의 Ground 인스턴스다. (P8: input-precondition assert)

| precondition | 위반 시 |
|---|---|
| `flow_type` 존재 + non-empty string | **mechanical error** → `ground_result.status=escalate`, `failure_origin=ground`, reason `"input precondition: flow_type missing"` |
| `request_text` 존재 + non-empty string | **mechanical error** → escalate, `failure_origin=ground`, reason `"input precondition: request_text missing"` |
| `classification_metadata`, `clarifications` 키 존재 (값은 빈 list/obj 허용) | 키 부재 = **mechanical error** → escalate, `failure_origin=ground` |
| `channel` ∈ {user_session, a2a, ci} | enum 밖 값 = escalate, `failure_origin=ground`. (NOTE: structured output의 `channel`은 grammar-enforced enum이라 *잘못된* channel 값은 구조화 출력에 담길 수 없다 — 이 precondition은 Ground가 structured output을 내기 *전에* raw 입력 단계에서 감지·escalate하는 upstream/garbage-input 케이스다) |
| `active_flow_state` 정형 (아래 [Failure & degrade handling] active_flow_state 표 참조) | 모순/기형 = escalate |

**원칙 3 (legitimately-empty vs missing/malformed)**: 빈 `clarifications` list나 빈 `scope_hint`는 *합법적*이다 (정상 진행). *키 자체 부재*나 *비정형*만 mechanical error다. Ground는 둘을 혼동해 깨진 입력을 깨끗한 입력처럼 통과시키지 않는다. (principle 3: empty-legit vs missing-malformed)

**Escalation은 bounded**: input-precondition escalate는 `failure_origin=ground` 경로로 producer⇄reviewer 재진입하며, `(flow_id, ground)` **누적 5-fail halt cap** (decide/failure-routing.md)이 ping-pong을 막는다. 따라서 입력 사전조건 escalate는 무한 루프 위험 없이 안전. (reuse: failure_origin routing + 5-accumulated-fail halt cap)

**제어 신호 소유권 (principle 2)**: Ground는 `request_upstream_deepen`을 emit하지 **않는다** — 그 신호는 Decide 전용이다. degenerate/missing upstream은 모두 위 `failure_origin=ground` escalate 경로로 라우팅한다. (principle 2: request_upstream_deepen is Decide-only)

## Activities (병렬 1·2 강제, 3은 둘 위에서)

Activities 1·2는 independent — orchestrator가 `invoke_parallel([activity1, activity2])`로 fan-out 실행 (R8). Activity 3 (Surface)는 둘 결과 위에서 sequential.

```
1. ED Graph Query  [PRIMARY tool: emberdeck.query_graph]
   - request_text + clarifications + scope_hint → ED MCP query
   - 출력: bounded subgraph (entry nodes + neighbors + god nodes in scope)
   - cap: token budget + god node expansion limit
   - per-node: freshness metadata (last_updated, source)
   - tool-status 분기 (P2 + principle 1 — 아래 [Failure & degrade handling] ED 표):
     · present + 결과 있음 → task_subgraph.status=measured
     · present + referent 그래프 부재 → unknowns[{dim: referent, reason: unresolved}] (legitimate verdict)
     · ABSENT / error / timeout (도구 자체 죽음) → ESCALATE (NOT degraded)

2. Volatile Capture (flow_type별 선언된 profile — Ground 본 contract가 authoritative)
   - Universal (모든 flow): typecheck, test, lint, git status/log
   - Conditional (flow별 선언): [Volatile Profile by Flow Type] 표 참조
   - 각 명령: bounded timeout
   - 명령 부재 시: M3 Omitted{reason='skipped', source_tool} (skipped-with-reason carrier). 바이너리 부재면 reason='tool_absent', MCP/백엔드 미부착이면 reason='unavailable' (공유 Omitted enum)
   - timeout/fail-to-run: M3 Omitted{reason='timeout'|'tool_failed', source_tool}
   - git: `git_state` discriminant로 분류 ([git capture states] 표). `git_state=repo`일 때만 캡처 시작·종료 git HEAD 비교 → 변동 시 racing_changes 1회 재시도. non-repo/empty/binary부재는 escalate 아닌 *사실 상태*로 surface (degraded_pass)

3. Surface
   - ED의 AMBIGUOUS/INFERRED 엣지 → unknowns (dim: ed_ambiguous | ed_inferred) [conflicts 아님 — 단일 source의 불확실성]
   - **2개 이상 source가 같은 referent에 대해 양립 불가한 사실을 보고** → conflicts (criterion 아래 [conflicts production rule] 절)
   - capture 실패/timeout (volatile) → unknowns[{dim: capture_failure|timeout, ...}]
   - request referent 그래프에 부재 → unknowns[{dim: referent, reason: unresolved}]
   - permission/access 거부 (ed_query 외 capture·file read) → unknowns[{dim: inaccessible, reason: permission_denied, source_tool}]
   - silent gap 금지: 모든 모름·모순 명시
   - tool/data 부재로 schema key를 omit한 경우 → omitted_fields에 사유 기록 (R22)
```

## Result enum & branches (P1 — success 분기 포함 전체 enum)

Ground 출력 최상위에 단일 discriminated `ground_result.status`를 선언한다. Investigate의 `compatibility_verdict.result`가 success+failure를 한 enum으로 선언하는 것과 동일한 shape를 재사용한다 — *성공* 분기를 *실패*만큼 명시적으로 선언한다. (P1: discriminated result enum, reuse Investigate's compatibility_verdict shape)

```
ground_result.status: ok | degraded_pass | escalate
```

| status | 의미 | 산출 | Orchestrator 처리 |
|---|---|---|---|
| `ok` | 모든 primary 활동 정상 — bounded·sourced·current 사실 + 명시 unknowns 산출 | 아래 [Output] 전체 (task_subgraph.status=measured) | Investigate 진입 |
| `degraded_pass` | **ENHANCEMENT-급 결손만** 발생 — primary(ED)는 살아있고, *conditional volatile profile 명령 일부 부재/timeout* 또는 *racing_changes 재시도 후 잔존* 처럼 Investigate가 unknown/risk로 처분 가능한 결손. `degrade_reasons[]` 명시 + 해당 측정은 M3 Omitted 분기 + omitted_fields 기록 | [Output] 전체 + `degrade_reasons` + `omitted_fields` | Investigate 진입 (Investigate가 unknown-disposition matrix로 처분) |
| `escalate` | **PRIMARY 결손 또는 mechanical error** — ED MCP 부재/error/timeout, input precondition 위반, malformed active_flow_state (→ `failure_origin=ground`); 또는 **step 전체 budget 소진** (→ `failure_origin=cap_exceeded`). Ground가 *자기 일을 못 함* | `escalate_detail: { failure_origin: ground\|cap_exceeded, reason, evidence }` (정상 [Output] 미산출 또는 부분) | **Flow halt**. `failure_origin=ground`→producer⇄reviewer 재진입(5-fail halt cap); `failure_origin=cap_exceeded`→즉시 halt(NO auto-reinvoke) |

**분기 선택 규칙 (mechanical)**:
1. input precondition 위반 → `escalate` (`failure_origin=ground`).
2. ED MCP 부재/error/timeout (primary tool down) → `escalate` (`failure_origin=ground`) (principle 1: ED는 PRIMARY → escalate, NOT degraded; unknown-disposition.md L24 `tool_unavailable→escalate`와 정합). (P2 + principle 1)
3. malformed active_flow_state → `escalate` (`failure_origin=ground`).
3b. step 전체 budget(wall_s/tokens) 소진 (모든 activity 완료 전) → `escalate` (`failure_origin=cap_exceeded`) ([Adaptive Depth] Step 자체 budget 소진).
4. 위 셋 다 아니고, ENHANCEMENT-급 결손만 있음 → `degraded_pass`. ENHANCEMENT-급 결손 = {conditional volatile 명령 부재/timeout/fail, racing 잔존, `git_state≠repo` (no_repo/empty_repo/git_unavailable — [git capture states]), unrecognized flow_type fallback ([Unknown / 미인식 flow_type fallback])}. (git은 PRIMARY 아님 → 부재해도 degrade)
5. 결손 없음 → `ok`.

**Boundary**: `degraded_pass`는 *판정*이 아니다 — Ground는 결손을 *사실로 surface*할 뿐, 그 결손이 flow를 막는지(blocked) 위험한지(risk) 판단하지 않는다. 그 처분은 Investigate의 unknown-disposition.md 일이다. (stay-in-lane: Ground surfaces fact, Investigate disposes)

## Output (provenance 강제)

```yaml
ground_result:
  status: ok | degraded_pass | escalate          # P1 — success 분기 포함
  degrade_reasons?: [<string>]                    # status=degraded_pass일 때 필수
  escalate_detail?:                               # status=escalate일 때 필수
    failure_origin: ground | cap_exceeded           # ground = Ground 자기 일 못 함(ED 부재/precondition/malformed); cap_exceeded = step 전체 budget 소진(orchestrator halt, NO auto-reinvoke — 공유 FailureOrigin enum)
    reason: <string>
    evidence: <input ref | tool_call ref>

flow_id: <id>
captured_at: ISO8601
schema_version: 1
input_refs: { triage_output, request_text, conversation_context, scope_hint }

task_subgraph:                                    # M3 DEGRADE union (status discriminant)
  status: measured | omitted                      # measured = ED 살아있고 결과 있음
  # --- measured 분기일 때만 아래 키 존재 ---
  entry_nodes: [{ id, source: ed_query, freshness: ISO8601 }]
  neighbors: [...]
  god_nodes_in_scope: [...]                        # R18: measured 분기에만 존재
  bounded_at: token_count
  ed_snapshot_version: <ED version/hash>
  # --- omitted 분기일 때: 위 키 전부 부재 + Omitted{reason, source_tool} ---
  # (NOTE: task_subgraph가 omitted인 *유일한 합법 경우*는 status=escalate가 아닌
  #  "ED present지만 scope가 빈 degenerate 그래프"가 아니라 — ED 총부재는 escalate다.
  #  measured/omitted 구분은 [Failure & degrade handling] ED 표가 권위.)

volatile_state:
  # Universal — 키는 항상 존재. 각 값은 M3 DegradableMeasurement (measured | omitted-with-reason)
  typecheck: <DegradableMeasurement>              # measured{status: success|fail, output_hash, source_command, captured_at, duration_ms} | omitted{reason ∈ 공유 Omitted enum (tool_absent|tool_failed|timeout|unavailable|skipped|not_applicable), source_tool}
  tests:     <DegradableMeasurement>              # measured{status, passed, failed:[...], failed_count, coverage, source_command, captured_at, duration_ms} | omitted{reason, source_tool}
  lint:      <DegradableMeasurement>              # measured{status, warnings, errors, source_command, captured_at, duration_ms} | omitted{reason, source_tool}
  git:                                            # factual state — 항상 키 존재. git_state discriminant ([git capture states] 표 참조)
    git_state: repo | no_repo | empty_repo | git_unavailable
    # git_state=repo 일 때만: branch, dirty, head_start, head_end, recent_commits:[...]
    # no_repo (워킹디렉터리가 git repo 아님) / empty_repo (commit 0개, HEAD 없음) / git_unavailable (git 바이너리 부재·실행불가):
    #   branch/head_start/head_end/recent_commits 키 omit + omitted_fields 기록. head_*는 racing_changes 비교에서 제외
  # flow-conditional 추가 (해당 profile일 때만 키 존재; 부재 시 키 자체 omit + omitted_fields 기록):
  perf_baseline?: <DegradableMeasurement>
  dependency_audit?: <DegradableMeasurement>
  observability?: <DegradableMeasurement>
  release_state?: <DegradableMeasurement>

unknowns: [{ dim, reason, source_tool, attempted_at }]    # dim enum: [unknowns.dim FACTUAL tag enum] 절 참조
conflicts: [{ sources: [{kind: tool|file, ref}], description, source_tool }]

omitted_fields:                                   # NEW carrier (R22) — 어느 schema key가 왜 omit됐는지
  - { field: <schema field path>, reason: <string>, source_tool }
  # 예: { field: perf_baseline, reason: "perf command not defined for this repo (skipped)", source_tool: Bash }

freshness:
  ed_snapshot_version?                            # task_subgraph가 omitted면 이 키도 omit + omitted_fields 기록
  git_head_start
  git_head_end                                    # 다르면 racing_changes 표시
  racing_changes: bool

verification_proof:
  tool_calls: [{ tool, args_hash, output_hash, exit_code }]
  read_files: [{ path, hash, mtime }]
  ed_queries: [{ query, result_hash }]
```

**Provenance 강제**: 모든 fact / unknown / conflict / omitted_field 항목에 `source_tool` 필수. `verification_proof` 해시만으론 부족 — 항목별로 출처 추적 가능해야 함.

### omitted_fields carrier + key-omission 규칙 (R22 — README↔policy 출력 shape 정합)

tool/data 부재로 *어떤 schema key를 산출 못 할 때*의 규칙 (Ground 본 contract가 자기 degrade가 의존하는 carrier를 명시):

- 키 자체를 **완전 omit** (YAML에 key 등장 안 함). `value: null`, `value: # OMITTED` 같은 marker 금지. (R22: key full omission, not value-comment)
- omit한 키마다 `omitted_fields`에 `{field, reason, source_tool}` 1행 기록.
- ED 부재로 escalate가 아닌 "ED present인데 god_node 분류 불가" 같은 경우는 발생하지 않는다 — ED present면 god_nodes_in_scope는 measured 분기에 존재하고, ED absent면 escalate다. (R18: god_node interpretation when ED absent → 본 contract에선 ED absent=escalate이므로 god_node 산출 자체가 차단됨)

이 carrier가 없으면 `omitted_fields`를 참조하는 자기 degrade(conditional volatile 부재 등)가 갈 곳이 없었다 — 그 홀을 닫는다. (closes: README schema가 omitted_fields carrier 부재였던 gap)

### unknowns.dim FACTUAL tag enum (P6 — 사실 태그만, disposition 토큰 발명 금지)

`unknowns[].dim`은 *불확실성의 차원을 가리키는 사실 태그*다. **Investigate의 disposition 토큰(resolved/risk/constraint/clarification/escalate 등)을 여기 발명하지 않는다** — 분류는 Investigate 일이다. (P6 + stay-in-lane: dim = factual dimension tag, NOT Investigate disposition)

| `dim` 값 (FACTUAL tag) | 의미 | 예시 reason |
|---|---|---|
| `referent` | request entity가 ED 그래프에 부재 (referent_unresolved 케이스) | `unresolved` |
| `ed_ambiguous` | ED AMBIGUOUS 엣지 | `ambiguous_edge` |
| `ed_inferred` | ED INFERRED (low-confidence) 엣지 | `inferred_edge` |
| `ed_drift` | ED가 card↔code drift를 *한쪽만* 알고 보고 (단일-source 불확실성; 양쪽 사실이 다 있으면 conflicts로 감 — [conflicts production rule] 참조) | `card_code_mismatch` |
| `capture_failure` | volatile 명령 실행 실패 (non-timeout) | `tool_failed` |
| `timeout` | volatile 명령 timeout | `timeout` |
| `inaccessible` | permission/access 거부 | `permission_denied` |
| `racing_changes` | 재시도 후에도 head_start≠head_end 잔존 | `head_moved_after_retry` |
| `suspended_similar` | 유사 영역 suspended prior 존재 (similarity check) | `suspended_prior_in_scope` |
| `external_unknown` | 외부 lib/API 미상 (Ground가 해소 못 함 — Investigate가 WebFetch 시도) | `external_lib_version_unknown` |
| `unrecognized_flow` | `flow_type`이 [Volatile Profile by Flow Type] 표의 어느 행에도 매칭 안 됨 — Ground가 conditional profile을 추론하지 않고 universal-only로 fallback (referent와 별개 차원: 그래프 entity 부재가 아니라 *profile 차원* 미상) | `unrecognized_flow_type` |

enum은 *사실 차원* 기준이며, 새 사실 차원이 생기면 dim에 추가 가능(open-ish) — 단 모든 항목은 `reason + source_tool`로 self-describing해야 한다(silent-gap 금지). Investigate는 이 dim → unknown-disposition.md matrix의 `unknown_type`으로 매핑해 처분한다. (downstream type-safe branch 가능)

### conflicts production rule (unknowns vs conflicts 경계 — open disjunction 닫음)

`conflicts[]`와 `unknowns[]`는 *별개 채널*이며 산출 기준이 mechanical하게 구분된다. 이전 Surface 문구의 "unknowns 또는 conflicts" open disjunction을 닫는다. (closes: conflicts had no production rule)

- **unknowns** = *단일 source*의 불확실성 (모름·미해소·미인식). 1개 source가 "이건 모르겠다/애매하다/추론값이다"라고 말하는 모든 경우. ED AMBIGUOUS/INFERRED 엣지, referent 미해소, capture 실패/timeout, inaccessible, racing_changes 등은 전부 unknowns다.
- **conflicts** = *2개 이상 source가 같은 referent에 대해 양립 불가한 사실을 동시에 보고*. 즉 둘 다 측정됐고(둘 다 measured) 둘이 서로 모순일 때만 conflict다. mechanical 산출 조건:
  - **ED drift conflict**: ED가 `card↔code 불일치`를 *양쪽 사실*과 함께 보고 (card는 X라 하고 code는 Y라 함) → conflicts 1행. `sources: [{kind:file, ref:card}, {kind:file, ref:code}]`. (이 경우 `unknowns[{dim:ed_drift}]`가 아니라 conflicts로 간다 — 양립 불가 *사실 쌍*이 있으므로. ed_drift dim은 ED가 한쪽만 보고하고 다른 쪽을 모를 때의 *단일-source 불확실성*에 한정.)
  - **tool↔tool conflict**: 2개 volatile 측정이 같은 referent에 대해 양립 불가한 결과 (예: typecheck는 pass인데 build 산출물이 stale을 보고) → conflicts 1행. `sources: [{kind:tool, ref}, {kind:tool, ref}]`.
- **경계 규칙 (mechanical, 모호성 0)**: source가 1개면 *항상* unknowns (해당 dim). source가 2개 이상이고 그 둘이 *양립 불가한 사실*을 보고하면 *항상* conflicts. 양쪽 다 해당 안 되면(모순 없음) 아무것도 산출 안 함.
- **Boundary**: conflict는 *사실 surface*다 — Ground는 "두 source가 모순이다"라는 사실만 기록하고, *누가 옳은지·어느 쪽을 택할지* 판단하지 않는다 (그건 Investigate/Verify 일). conflicts 항목에 derived/판정 문장 금지 (reviewer Boundary gate, R18).

각 conflict 항목은 `{sources:[{kind, ref}], description, source_tool}`로 self-describing. ED가 양쪽 사실을 동시에 surface하지 못해 한쪽만 알면 그건 conflict가 아니라 `unknowns[{dim:ed_drift}]` (단일-source 불확실성)다.

## Reviewer (ground-reviewer)

| 검사 | 기준 |
|---|---|
| ground_result | `status` ∈ {ok, degraded_pass, escalate}. `degraded_pass`면 `degrade_reasons` 비어있지 않음. `escalate`면 `escalate_detail.{failure_origin, reason, evidence}` 존재, `failure_origin` ∈ {ground, cap_exceeded} (cap_exceeded는 step budget 소진에만) |
| task_subgraph | `status=measured`면 `entry_nodes` ≥1 **OR** unknowns에 `{dim: referent, reason: unresolved}` 명시. `status=omitted`은 ground_result.status=escalate가 아닌 경우엔 발생 불가 (ED 총부재=escalate) |
| ED-absence 정합 | `task_subgraph.status=omitted`이면서 `ground_result.status≠escalate` → **FAIL** `reason: "ED absence must escalate (primary tool), not degraded"` (P2 + principle 1) |
| volatile_state | profile-required 각 명령에 explicit M3 분기 (measured{status} OR omitted{reason}). omitted면 reason ∈ 공유 Omitted enum {tool_absent, tool_failed, timeout, unavailable, skipped, not_applicable} — 명령 정의 없음=skipped, 실행 실패=tool_failed, timeout=timeout, 바이너리 부재=tool_absent, 백엔드/MCP 미부착=unavailable |
| skipped carrier | volatile 명령 부재가 `omitted{reason: skipped, source_tool}`로 carrier에 존재 (silent skip 0) |
| unknowns 매핑 | ED의 AMBIGUOUS/INFERRED 엣지 + capture 실패가 모두 unknowns에 매핑됨 (단일-source = unknowns; [conflicts production rule]) |
| conflicts 매핑 | 모든 conflicts 항목이 *2개 이상 source의 양립 불가 사실*임 ([conflicts production rule] 기준). single-source 항목이 conflicts에 있으면 FAIL `reason: "single-source belongs in unknowns, not conflicts"`. conflicts 항목에 판정/derived 문장 있으면 FAIL (Boundary) |
| dim 태그 | 모든 `unknowns[].dim`이 FACTUAL tag enum 소속(또는 self-describing) — Investigate disposition 토큰 미사용 |
| omitted_fields | omit된 schema key마다 `omitted_fields`에 `{field, reason, source_tool}` 1행. `value: null`/comment-only key 검출 시 FAIL `reason: "R22 partial omission"` |
| provenance | 모든 사실/unknown/conflict/omitted_field 항목에 `source_tool` 존재 |
| freshness | `task_subgraph.status=measured`면 `ed_snapshot_version` 기록. `volatile_state.git.git_state` 항상 존재. `git_state=repo`면 `git_head_start` 기록; `git_state∈{no_repo,empty_repo,git_unavailable}`면 head_* omit + omitted_fields 기록 ([git capture states]) |
| git_state | `git_state` ∈ {repo, no_repo, empty_repo, git_unavailable}. ≠repo면 head_*/recent_commits 키 omit + 해당 unknowns dim + `degraded_pass` ([git capture states]). git_state 부재 = FAIL |
| racing_changes | `git_state=repo`이고 `head_start ≠ head_end`이면 표시 (재시도 1회 후도 변동 시). `git_state≠repo`면 비교 skip, `racing_changes=false` |
| Boundary 준수 | 해석·판단 흔적 없음 (예: "perf delta 의미 X" 같은 평가 prose 금지; conflicts에 derived/counting 문장 금지 — R18) |

## Failure & degrade handling

### ED MCP (emberdeck.query_graph) — PRIMARY tool (P2 + principle 1)

ED는 Ground의 *주요* 도구다. 그 부재/실패는 Ground가 *자기 일을 못 한다*는 뜻이므로 degrade가 아니라 **escalate**다. 이는 unknown-disposition.md L24 (`tool_unavailable (ED/firebat/pyreez 부재) → escalate`)와 정확히 정합한다. (principle 1: ED primary → escalate)

| ED 상태 | 구분 | Ground 처리 |
|---|---|---|
| present + 결과 있음 | 정상 | `task_subgraph.status=measured`, `ground_result.status=ok` |
| present + request referent 그래프에 부재 | **legitimate verdict** (도구는 동작) | `unknowns[{dim:referent, reason:unresolved}]`, task_subgraph는 measured(다른 entry_nodes 있을 수 있음) 또는 entry_nodes=[] + referent unknown. `ground_result.status=ok` |
| present + 결과 빈 subgraph (referent는 technically 존재) | **degenerate-but-working** (도구는 동작) | referent 해소 결과를 명시: 해소 안 됨이면 `unknowns[{dim:referent, reason:unresolved}]`; 해소됐으나 neighbors 없음이면 entry_nodes에 referent node 1개 + neighbors=[]. **reviewer gate 만족**: entry_nodes≥1 OR referent_unresolved 둘 중 하나로 *명확히* 분류. `ground_result.status=ok` (principle 3: degenerate-but-working ≠ broken) |
| ABSENT (MCP not in session) / error / timeout | **PRIMARY tool down** | `ground_result.status=escalate`, `escalate_detail: {failure_origin: ground, reason: "emberdeck MCP unavailable / errored / timed out", evidence: <attempted ed_query ref>}`. `task_subgraph` 및 `ed_snapshot_version`/`god_nodes_in_scope` 키 omit + omitted_fields 기록. **Flow halt** (P2 + principle 1) |

**Degenerate ED result vs referent-unresolved 구분 (홀 닫음)**: 위 표 2·3행이 둘을 명확히 분리한다 — "그래프에 부재"는 `referent_unresolved`, "존재하나 neighbor 없음"은 entry_nodes≥1. reviewer gate가 두 경우 모두에 대해 모호하지 않다. (closes: degenerate-vs-unresolved conflation)

### Volatile capture (ENHANCEMENT-급 측정) — M3 degrade

volatile 명령은 *측정*이지 primary tool이 아니다. 명령 부재/timeout/fail-to-run은 escalate가 아니라 M3 Omitted 분기 + (conditional 명령이면) `degraded_pass`. (M3 degrade-as-branch; R12 failure_modes)

| 상황 | 처리 |
|---|---|
| 명령 정의 없음 | `omitted{reason: skipped, source_tool}` + (conditional이면) omitted_fields 기록 |
| 바이너리 부재 (명령 자체 미설치) | `omitted{reason: tool_absent, source_tool}` |
| MCP/백엔드 미부착 (예: observability backend down) | `omitted{reason: unavailable, source_tool}` |
| timeout | `omitted{reason: timeout, source_tool}` + unknowns[{dim:timeout}] |
| 실행 실패 (non-zero, 비-fail-status) | `omitted{reason: tool_failed, source_tool}` + unknowns[{dim:capture_failure}] |
| **permission/access 거부** (명령 실행 또는 file read가 권한 거부) | `omitted{reason: tool_failed, source_tool}` + unknowns[{dim:inaccessible, reason:permission_denied}] (tool_failed의 *권한* 하위케이스를 inaccessible dim으로 명시 surface — orphan enum 닫음) |
| typecheck/test/lint이 *실행돼서 fail 보고* | measured{status: fail} (이건 정상 측정 — Omitted 아님) |

Universal 명령(typecheck/tests/lint) 전부가 omitted여도 Ground는 escalate하지 않는다 — ED(primary)가 살아있으면 `degraded_pass`로 진행하고 Investigate가 처분한다. (principle 1: enhancement absent → degraded, not escalate)

### git capture states (git는 *사실 상태*지 primary tool 아님 — non-repo/empty/binary부재는 escalate 아닌 *사실 surface*)

git 캡처는 "always measured"가 아니라 *git_state discriminant로 항상 분류*된다. git이 없거나(non-repo, binary 부재) commit이 0개여도 그건 Ground가 *자기 일을 못 하는 것*이 아니라 *워크스페이스의 사실 상태*다 — 그 사실을 기록하고 degrade로 surface한다 (escalate 아님). git은 PRIMARY tool이 아니므로 principle 1상 degrade 경로다. (closes: git failure / non-repo / empty-repo unhandled)

| git_state | 조건 | Ground 처리 |
|---|---|---|
| `repo` | git repo + commit ≥1 | 정상. branch/dirty/head_start/head_end/recent_commits measured. racing_changes 비교 적용 |
| `empty_repo` | git repo지만 commit 0개 (HEAD 없음) | head_start/head_end/recent_commits 키 omit + omitted_fields 기록. `unknowns[{dim:capture_failure, reason:"empty_repo — no HEAD", source_tool}]` + `ground_result.status=degraded_pass`. racing_changes 비교 skip (`freshness.racing_changes=false`) |
| `no_repo` | 워킹디렉터리가 git repo 아님 | 위와 동일 키 omit + omitted_fields. `unknowns[{dim:inaccessible, reason:"no_git_repo", source_tool}]` + `degraded_pass`. racing_changes skip |
| `git_unavailable` | git 바이너리 부재/실행 불가 | 위와 동일 키 omit + omitted_fields. `unknowns[{dim:capture_failure, reason:"git_unavailable", source_tool}]` + `degraded_pass`. racing_changes skip |

**Cache key 영향**: cache key의 `git_HEAD`·`worktree_status` 구성요소는 git_state≠repo이면 측정 불가 → 그 자리에 `git_state` 토큰 자체를 사용한다 (예: `no_repo`). 즉 cache key는 항상 잘 정의된다 (HEAD 부재로 깨지지 않음). git_state가 repo→non-repo로 바뀌면 key가 달라져 invalidate된다.

### racing_changes

`git HEAD start ≠ end` 감지 → 1회 재시도. 재시도 후에도 변동 시 → `freshness.racing_changes=true` + `unknowns[{dim:racing_changes, reason:head_moved_after_retry}]` + `ground_result.status=degraded_pass`. (escalate 아님 — Investigate가 risk로 처분 가능; unknown-disposition.md `racing_changes→risk`)

**git_state≠repo일 때**: head_start/head_end가 없으므로 racing_changes 비교 자체를 skip하고 `freshness.racing_changes=false`로 둔다 (비교 불가를 모순으로 오인하지 않음 — principle 3: 합법적 부재 ≠ 깨진 입력).

### active_flow_state (orchestrator가 Ground 진입 전 해결; Ground는 잔재 인지 + 기형 escalate)

Ground는 conflict resolution을 하지 않는다 (orchestrator 책임). Ground는 *해결 후 잔재* 인지 + *기형 입력* escalate만 한다. `active_flow_state`는 런타임 *입력*으로만 소비되며 (input_refs에 raw 형태로 등장하지 않음), 그 *잔재*만 출력 `active_flow_note`(suspended_similar_hint / preempted_prior_ref)로 나타난다. malformed→escalate는 위 `ground_result` 경로로 처리된다.

| `active_flow_state` 형태 | Ground 처리 |
|---|---|
| `active: null, suspended: []` | 그대로 진행 (`status=ok`) |
| `active: null, suspended: [prior...]` (orchestrator suspend 처리 후) | 진행. similarity check 적용 시 unknowns[{dim:suspended_similar}] hint |
| `active: null, preempted: prior_id` (P0 preempt 직후) | 진행. `active_flow_note.preempted_prior_ref` 기록 (post-stabilization follow-up용) |
| `active: <something>` | **mechanical error** — orchestrator가 미해결로 Ground 진입 = bug → `status=escalate`, `failure_origin=ground`, reason `"unresolved active flow on Ground entry"` |
| **malformed** (예: `active`와 `suspended` 동시 populate, `preempted`와 `active` 모순, 알 수 없는 키, 비정형 구조) | **mechanical error** → `status=escalate`, `failure_origin=ground`, reason `"malformed active_flow_state: <what>"` (P8 + principle 3: malformed ≠ legitimately-empty) |

**malformed 케이스 닫음**: 4-row 정상 표 외의 모든 모순/기형 형태를 마지막 행이 escalate로 포괄한다 — 이전엔 `active:<something>`만 escalate였다. (closes: malformed active_flow_state uncovered)

### similarity check (최소 정의)

"유사 영역 suspended prior가 있다" hint를 언제 다는지의 *최소* 규칙 (이전엔 미정의 연산이었다):

- **대상**: `active_flow_state.suspended[]`의 각 prior의 `scope` (패키지/경로 set).
- **비교**: 현재 flow의 `scope_hint`(또는 task_subgraph entry_nodes가 속한 패키지/경로) 와 각 prior scope의 **path-prefix overlap** — 공유 top-level 패키지/디렉터리가 1개 이상이면 "유사".
- **결과**: 유사한 prior가 있으면 `unknowns[{dim:suspended_similar, reason:suspended_prior_in_scope, source_tool}]` 1개 (prior 당 1개 가능). 유사 없으면 hint 미생성.
- **Boundary**: 이건 *사실 hint*다 (겹치는 경로가 있다). 충돌 여부·우선순위·재개 판단은 하지 않는다 — orchestrator/Investigate 일. scope_hint도 entry_nodes도 없어 비교 불가하면 similarity check를 skip하고 hint를 달지 않는다 (escalate 아님). (closes: undefined similarity operation; stay-in-lane: fact hint only)

## Volatile Profile by Flow Type

선언된 capture profile만 실행. Ground가 *어느 측정이 중요한지 판단하지 않음* — **profile은 Ground 본 contract의 아래 표가 authoritative source**다 (M4 flow-definition machine source의 일부로서 Ground가 보유). 이전 README가 가리킨 `.blazewrit/flows/<type>.md`의 `volatile_profile` 필드는 *존재하지 않으며*, 그 필드를 읽으려는 시도는 R14 fail-loud("spec hole — field undefined" → STATUS BLOCKED)로 step을 막을 수 있었다 — 그래서 authoritative source를 본 표로 못박는다. (closes worst hole: broken volatile_profile declaration site; R14 fail-loud 회피)

| Flow | Universal + 추가 conditional 필드 |
|---|---|
| Feature, Bug Fix, Bug Fix P0, Refactor, Test, Chore, Review, Retro, Exploration, Compound, plan-standalone, Spike | Universal만 (typecheck/tests/lint/git) |
| Performance | + `perf_baseline: { p50, p95, p99, throughput, captured_at, command }` |
| Migration | + `dependency_audit: { packages: [{name, current, latest, breaking}], lockfile_hash }` |
| Bug Fix Unreproducible | + `observability: { logs_query, metrics_query, traces_query, results }` |
| Release | + `release_state: { last_version, new_commits_count, changelog_entries: [...] }` |

위 conditional 필드는 *명시 schema*. Ground 출력의 `volatile_state.<conditional_field>`로 carrier 제공 (각 값은 M3 DegradableMeasurement). Investigate가 type-safe 참조 가능.

### Unknown / 미인식 flow_type fallback (P8)

`flow_type`이 위 표의 어느 행에도 매칭 안 되면 (Triage가 산출했으나 Ground가 모르는 값, 또는 garbage):

1. **존재+정형 precondition은 통과** (non-empty string이므로) — 이건 input-precondition escalate 대상이 *아니다*.
2. **Universal-only profile 실행** — 알 수 없는 conditional은 안전한 최소 집합(typecheck/tests/lint/git)으로 fallback. conditional 필드는 키 omit + omitted_fields 기록.
3. **사실 surface**: `unknowns[{dim:unrecognized_flow, reason:"unrecognized flow_type — universal profile applied", source_tool}]` 1개 추가하여 *Ground가 profile을 추론하지 않았음*을 명시 (referent 아님 — 그래프 entity 부재가 아니라 profile 차원 미상; [unknowns.dim FACTUAL tag enum] `unrecognized_flow`).
4. `ground_result.status=degraded_pass`, `degrade_reasons: ["unrecognized flow_type; universal-only profile"]`.

이로써 미인식 flow_type은 silent하게 빈 profile로 통과하지 않고, escalate로 과잉 halt하지도 않는다 — degrade로 surface하고 Investigate/orchestrator가 처분. (closes: unknown/garbage flow_type fallback; principle 3: not silent rubber-stamp, not over-escalate)

## Cache 정책 (logically stateless + strict invalidation)

논리적으로 stateless (같은 입력 → 같은 출력). 캐시 사용 가능, 단 invalidation 엄격:

**Cache key**: `hash(request_text + conversation_context_digest + ed_snapshot_version + git_HEAD + worktree_status + volatile_commands_definition + flow_type + scope_hint)`

`git_HEAD`·`worktree_status`는 `git_state=repo`일 때의 값이며, `git_state≠repo`이면 그 자리에 `git_state` 토큰(`no_repo`|`empty_repo`|`git_unavailable`)을 사용한다 — HEAD 부재로 key가 깨지지 않고 항상 잘 정의된다 ([git capture states]).

cache hit이어도 freshness metadata 노출 필수. 모든 키 구성요소 변동 시 invalidate. `ground_result.status=escalate`는 캐시하지 않는다 (mechanical error는 재시도 대상).

## 채널별 차이

없음 — Ground는 channel-agnostic. 단 `conversation_context`가 user_session에서만 존재 (a2a/ci는 빈 값 — input-precondition상 *합법적 빈*이며 escalate 아님).

## Boundary — Ground가 안 하는 것

| 항목 | 책임 |
|---|---|
| Feasibility 판정 (proceed/blocked) | Investigate |
| 영향 범위 *해석* | Investigate |
| unknown의 *disposition 분류* (risk/constraint/clarification/escalate) | Investigate (unknown-disposition.md) |
| `request_upstream_deepen` 신호 | Decide (Ground는 escalate만) |
| 옵션 후보 / 접근 결정 | Decide |
| 카드 *생성* (intent/spec) | Decide(Design)/Spec — Ground는 *읽기*만 |
| 측정값 *의미 판단* (예: "이건 느림") | Investigate |
| 위험·심각도 *판단* | Investigate / Verify |
| 코드 변경 | Implement |

## Adaptive Depth

Step Depth Policy 참조 (root WORKFLOW_PLAN.md). Ground는 default shallow:
- **shallow**: volatile_capture + lightweight ed_query (token_budget=1k, god_node priority by graph degree). caps: wall_s=20, tokens=5k
- **deep**: full ed_query, volatile + flow_profile 전체, full surface. caps: wall_s=180, tokens=20k

**deepen triggers (OR)**:
- flow_type ∈ {Feature, Migration, Performance, Compound}
- Triage.complexity_signal = high
- shallow ed_query 결과에 god_node 포함
- volatile_capture failures (lint/test/typecheck) ≥ 1

P0 override: `flow_type = bugfix-p0`이면 모든 deepen trigger 무시, shallow 강제.

**Depth와 result의 독립성**: deepen은 *얼마나 깊이 측정하나*를 정할 뿐, ED 부재나 input 결손은 depth와 무관하게 [Result enum & branches] 규칙대로 escalate/degrade한다.

**Step 자체 budget 소진 처리** (Test/Implement step과 동일 원칙 — silent partial 금지): 위 caps(shallow wall_s=20/tokens=5k, deep wall_s=180/tokens=20k)가 모든 activity 완료 *전에* 소진되면(예: ED query가 끝나기 전 wall_s 초과, 또는 누적 토큰 초과) → Ground는 **부분 결과를 ok/degraded_pass로 고무도장하지 않는다**. mechanical error → **escalate**: `ground_result.status=escalate`, `escalate_detail={failure_origin: cap_exceeded, reason: "step budget (wall_s/tokens) exhausted before all activities complete", evidence: <부분 진행분: 완료된 activity 목록 + 미완 activity>}`. `cap_exceeded`는 공유 FailureOrigin enum의 orchestrator-level halt origin(failure-routing.md, `_defs.schema.json`) — Ground⇄reviewer 자동 재진입이 아니라 즉시 flow-level halt+escalate(NO auto-reinvoke). (개별 operation의 per-command volatile timeout=omitted, ED timeout=escalate(failure_origin=ground)와 구분됨: 여기는 *step 전체* 예산 소진.)
