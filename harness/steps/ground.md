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
| `conversation_context` | optional | None-state turns (user_session에만 존재; a2a/ci는 부재 — 출력 digest도 channel=user_session ⇔ 존재). user_session에서 turn이 0개여도(*합법적 빈* conversation_context) digest 키는 *여전히 존재*한다 (빈 입력에 대한 digest). 키 부재는 a2a/ci 전용 |
| `channel` | ✓ | user_session \| a2a \| ci |
| `active_flow_state` | optional | 다른 in-flight 작업 인지용 (충돌 해결은 orchestrator) |
| `scope_hint` | optional | 모노리포 패키지/경로 한정 (Triage가 추출 또는 caller가 명시) |

## Input preconditions (P8 — garbage-in 감지, 횡단 단일 문구)

Ground는 필수 upstream 필드의 *존재 + 정형*만 assert한다 (값의 *진실*은 검증하지 않음 — 그건 Verify 일). 이는 모든 step에 적용되는 동일 input-precondition 문구의 Ground 인스턴스다. (P8: input-precondition assert)

| precondition | 위반 시 |
|---|---|
| `flow_type` 존재 + non-empty string (trim 후에도 non-empty) | **mechanical error** → `ground_result.status=escalate`, `failure_origin=ground`, reason `"input precondition: flow_type missing"` |
| `request_text` 존재 + non-empty string (trim 후에도 non-empty — whitespace-only(`"   "`)는 missing으로 취급) | **mechanical error** → escalate, `failure_origin=ground`, reason `"input precondition: request_text missing"` |
| `classification_metadata`, `clarifications` 키 존재 (값은 빈 list/obj 허용) | 키 부재 = **mechanical error** → escalate, `failure_origin=ground` |
| `channel` ∈ {user_session, a2a, ci} | enum 밖 값 = escalate, `failure_origin=ground`. (NOTE: structured output의 `channel`은 grammar-enforced enum이라 *잘못된* channel 값은 구조화 출력에 담길 수 없다 — 이 precondition은 Ground가 structured output을 내기 *전에* raw 입력 단계에서 감지·escalate하는 upstream/garbage-input 케이스다) |
| `active_flow_state` 정형 (아래 [Failure & degrade handling] active_flow_state 표 참조) | 모순/기형 = escalate |
| `scope_hint` (present일 때) well-formed non-empty string (non-string·null-아닌 비문자열은 비정형) | 비-string/비정형 = **mechanical error** → escalate, `failure_origin=ground`, reason `"input precondition: malformed scope_hint"`. (NOTE: 빈 `scope_hint`는 원칙 3상 *합법적 부재*로 통과 — 위반은 *존재하나 비정형*인 경우에만. scope_hint는 그 자체로 신뢰되어 ED graph query·similarity-check path-prefix overlap에 *직접* 비교 입력으로만 쓰이며 — opaque token으로만 취급, 셸/파일 경로로 해석·실행되지 않음 — path-traversal/glob 문자열이라도 string으로 well-formed면 통과한다(literal-prefix 비교라 무해)) |
| `conversation_context` (channel=user_session일 때) present + 정형 (turns가 well-typed list — 각 turn이 기대 구조). a2a/ci에선 *부재*가 합법(원칙 3) | channel=user_session인데 conversation_context 부재·비정형(예: 잘못 타입된 turns, 알 수 없는 구조) = **mechanical error** → escalate, `failure_origin=ground`, reason `"input precondition: malformed conversation_context"`. (NOTE: scope_hint 행과 평행 — *합법적 빈*(turn 0개) conversation_context는 통과(digest는 빈 입력에 대해 산출). 위반은 user_session에서 *부재 또는 비정형*인 경우에만. 이 well-formedness assert가 없으면 기형/stale conversation_context가 silent하게 digest돼 garbage-in surface가 검증 불가였다 — 그 홀을 닫는다. digest 자체의 진실은 Verify 일) |

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
| `escalate` | **PRIMARY 결손 또는 mechanical error** — ED MCP 부재/error/timeout, input precondition 위반, malformed active_flow_state (→ `failure_origin=ground`); 또는 **step 전체 budget 소진** (→ `failure_origin=cap_exceeded`). Ground가 *자기 일을 못 함* | `escalate_detail: { failure_origin: ground\|cap_exceeded, reason, evidence }` + **구조적 envelope는 여전히 존재** (아래 escalate 필드 생존 규칙). `volatile_state`·`freshness`만 drop됨 | **Flow halt**. `failure_origin=ground`→producer⇄reviewer 재진입(5-fail halt cap); `failure_origin=cap_exceeded`→즉시 halt(NO auto-reinvoke) |

**escalate 필드 생존 규칙 (schema escalate `then`과 정합)**: `status=escalate`여도 정상 [Output]이 통째로 사라지는 게 아니다 — '미산출 또는 부분'은 너무 느슨한 표현이다. 정확히는 *구조적 envelope는 여전히 required-present*하고 측정 본문(`volatile_state`, `freshness`)만 required-set에서 빠진다:
- **여전히 required**: `ground_result`(escalate_detail 포함), `flow_id`, `captured_at`, `schema_version`, `input_refs`, `channel`, `flow_type`, `depth`, `task_subgraph`(escalate 시 **Omitted 분기**로 — additionalProperties:false상 통째 부재 불가; **Omitted.reason은 escalate 원인별로 갈린다**: `failure_origin=ground`(ED-down)이면 reason ∈ {unavailable, tool_failed, timeout} (아래 [ED MCP] 표 매핑), `failure_origin=cap_exceeded`(측정 시작 전 budget 소진 — ED query가 완료 못 했거나 아예 시도 못 함)이면 reason=`skipped` (tool이 *죽은 게 아니라* budget 때문에 subgraph가 *건너뛰어진* 것이므로 unavailable/tool_failed/timeout 중 어느 것도 진실이 아니다 — `skipped`가 정확). {unavailable,tool_failed,timeout} narrowing은 *오직* failure_origin=ground 전용이고, cap_exceeded는 skipped 전용이다), `unknowns`(빈 배열 가능), `conflicts`(빈 배열 가능), `verification_proof`(escalate를 증명한 attempted tool_call 포함). **이 "attempted tool_call 포함"은 M2-only invariant이지 grammar invariant가 아니다**: 공유 `VerificationProof`는 `tool_calls`/`ed_queries`에 minItems를 걸지 않으므로(빈 배열 합법), grammar는 escalate에서 proof가 비어있지 않음을 강제하지 못한다. 따라서 `failure_origin=ground`(특히 ED-down)일 때 `verification_proof`가 escalate를 증명한 *시도된 query/tool_call*(ED-down이면 attempted ed_query)을 *최소 1개* 담아야 한다는 것은 **x-validator-contract(M2) reviewer가 강제한다** (escalate_detail.evidence가 가리키는 attempted ref가 verification_proof에도 존재해야 함; 위반 시 FAIL). cap_exceeded escalate(측정 시작 전 budget 소진)에는 적용되지 않는다.
- **required에서 drop**: `volatile_state`, `freshness` (부재 또는 부분 가능 — 측정 전에 escalate했을 수 있으므로). **git이 escalate 전에 이미 캡처되어 `volatile_state.git.git_state=repo`인 경우에도** freshness의 `git_head_start/git_head_end`는 *재요구되지 않는다*: schema의 git_state=repo 조건부 allOf는 `status≠escalate`로 gate되어 escalate에선 발화하지 않는다 (그렇지 않으면 escalate `then`이 일부러 푼 freshness 요구를 다시 걸어 두 allOf 분기가 충돌). 즉 "ED-down escalate 직전 git 캡처 완료" interaction은 freshness 전체를 optional로 두는 것으로 일관 처리된다.
- `degrade_reasons`/`source_manifest`/`active_flow_note`/`omitted_fields`는 평소대로 조건부/optional.

**분기 선택 규칙 (mechanical, 우선순위 순서대로 평가)**:
1. **step 전체 budget(wall_s/tokens) 소진 (모든 activity 완료 전)** → `escalate` (`failure_origin=cap_exceeded`) ([Adaptive Depth] Step 자체 budget 소진). **이 규칙이 ground-origin 원인(2·3·4)보다 우선한다 — 정당화**: budget이 이미 소진된 상태에서 동시에 ground-origin 원인(예: ED-down)이 있어도 `cap_exceeded`로 분기해야 한다. `failure_origin=ground` 경로는 producer⇄reviewer 자동 재진입을 유발하는데, 이는 *이미 소진된* 바로 그 budget을 다시 태워 `cap_exceeded`의 즉시-halt 보장을 무너뜨린다. budget 소진은 *재시도로 해소되지 않는* 상위 halt 조건이므로 ground-origin 자동 재진입보다 먼저 평가해 즉시 halt(NO auto-reinvoke)한다. (cap_exceeded > ground precedence — 재시도 비용이 무의미한 소진 상태에서 reinvoke 금지)
2. input precondition 위반 → `escalate` (`failure_origin=ground`).
3. ED MCP 부재/error/timeout (primary tool down) → `escalate` (`failure_origin=ground`) (principle 1: ED는 PRIMARY → escalate, NOT degraded; unknown-disposition.md L24 `tool_unavailable→escalate`와 정합). (P2 + principle 1)
3c. malformed active_flow_state → `escalate` (`failure_origin=ground`).
4. 위 넷 다 아니고, ENHANCEMENT-급 결손만 있음 → `degraded_pass`. ENHANCEMENT-급 결손 = {conditional volatile 명령 부재/timeout/fail, racing 잔존, `git_state≠repo` (no_repo/empty_repo/git_unavailable — [git capture states]), unrecognized flow_type fallback ([Unknown / 미인식 flow_type fallback])}. (git은 PRIMARY 아님 → 부재해도 degrade)
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
    evidence: <input ref | tool_call ref>          # 단일 string ref. cap_exceeded에선 부분 진행분(완료/미완 activity)을 *요약한 단일 ref string*(예: 진행 로그/체크포인트 ref) — 구조적 activity list가 아니라 schema상 single string

flow_id: <id>
captured_at: ISO8601
schema_version: <integer ≥1>           # 현재 1; schema는 minimum:1 open range (const 아님 — 미래 버전 ≥1 허용)
input_refs: { triage_ref, request_text, conversation_context_digest?, scope_hint? }  # §5: triage_ref는 Triage step_runs RowRef; conversation_context_digest는 digest 형태(legacy conversation_context). 나머지는 inline literal. required=[triage_ref, request_text]. M2: conversation_context_digest는 channel=user_session일 때만 *존재*(a2a/ci는 부재 — 빈 문자열 아님). user_session에서 conversation_context turn이 0개인 degenerate 케이스에도 digest 키는 *존재*한다 (빈 입력의 digest — 빈 문자열로 채우지 않고 실제 digest 값을 가짐); 키 *부재*는 a2a/ci에만 예약된다. 따라서 M2 IFF 체크는 한 방향으로만 발화: `존재 ⇔ user_session`. 이 channel↔digest 결합은 두 top-level 속성에 걸치는 cross-field 제약이라 grammar 미강제, x-validator-contract(M2)다

task_subgraph:                                    # M3 DEGRADE union (status discriminant)
  status: measured | omitted                      # measured = ED 살아있고 결과 있음
  source_tool: <SourceTool>                        # Measured envelope provenance floor — measured 분기에서 schema(_defs Measured)가 task_subgraph 최상위에 요구. omitted 분기에선 Omitted{reason, source_tool}의 source_tool
  # --- measured 분기일 때만 아래 키 존재 (value 안) ---
  entry_nodes: [{ id, source: <SourceTool>, freshness: ISO8601 }]   # source = per-node provenance (SourceTool); subgraph nodes 산출자는 ed_query지만 schema상 고정 const 아닌 provenance 필드
  neighbors: [...]
  god_nodes_in_scope: [...]                        # R18: measured 분기에만 존재
  bounded_at: <CountClaim>                          # R23: token-budget cutoff은 measured count → CountClaim(object {value, source}), bare integer 아님 (tests.passed/lint.warnings와 동일 처리)
  ed_snapshot_version: <ED version/hash>
  # --- omitted 분기일 때: 위 키 전부 부재 + Omitted{reason ∈ {unavailable,tool_failed,timeout,skipped}, source_tool} ---
  # (NOTE: task_subgraph가 omitted인 *유일한 합법 경우*는 status=escalate다 —
  #  "ED present지만 scope가 빈 degenerate 그래프"가 아니라(그건 measured), ED 총부재(failure_origin=ground)
  #  또는 budget 소진으로 subgraph를 못 돌린 cap_exceeded escalate. reason은 origin별로:
  #  ground(ED-down)=unavailable|tool_failed|timeout, cap_exceeded=skipped.
  #  measured/omitted 구분은 [Failure & degrade handling] ED 표가 권위.)

volatile_state:
  # Universal — 키는 항상 존재. 각 값은 M3 DegradableMeasurement (measured | omitted-with-reason)
  typecheck: <DegradableMeasurement>              # measured{result: success|fail, output_hash, source_command, captured_at, duration_ms} | omitted{reason ∈ Ground가 emit하는 Omitted reason {tool_absent|tool_failed|timeout|unavailable|skipped}, source_tool}  # NOTE: 'status'는 M3 union 판별자(measured|omitted)이므로 측정 결과 필드는 'result'. 공유 Omitted enum의 not_applicable은 Ground가 emit하지 않는다 (아래 [Ground와 not_applicable] 참조)
  tests:     <DegradableMeasurement>              # measured{result, passed, failed:[...], failed_count, coverage?, source_command, output_hash, captured_at, duration_ms} | omitted{reason, source_tool}  # coverage는 optional number 0–100 (test 명령이 coverage emit할 때만)
  lint:      <DegradableMeasurement>              # measured{warnings, errors, source_command, output_hash, captured_at, duration_ms} | omitted{reason, source_tool}  # lint은 success/fail result 필드 없음 (warnings/errors만)
  git:                                            # factual state — 항상 키 존재. git_state discriminant ([git capture states] 표 참조)
    git_state: repo | no_repo | empty_repo | git_unavailable
    # git_state=repo 일 때만: branch, dirty, head_start, head_end, recent_commits:[...]
    # no_repo (워킹디렉터리가 git repo 아님) / empty_repo (commit 0개, HEAD 없음) / git_unavailable (git 바이너리 부재·실행불가):
    #   branch/dirty/head_start/head_end/recent_commits 키 omit + omitted_fields 기록. head_*는 racing_changes 비교에서 제외
  # flow-conditional 추가 (해당 profile일 때만 키 존재; 부재 시 키 자체 omit + omitted_fields 기록):
  perf_baseline?: <DegradableMeasurement>
  dependency_audit?: <DegradableMeasurement>
  observability?: <DegradableMeasurement>
  release_state?: <DegradableMeasurement>

active_flow_note?:                                # post-resolution active-flow 잔재 인지용 (optional; orchestrator가 Ground 진입 전 conflict 해결). M2 linkage는 [active_flow_state↔active_flow_note linkage] 참조
  suspended_similar_hint?: <string>               # similarity check가 path-prefix overlap 발견 시 advisory mirror. M2: 존재 ⇔ check fired ⇔ 매칭 unknowns[{dim:suspended_similar}] ≥1개 존재 (overlapping prior 당 1개라 다중 가능 — hint는 suspended_similar 차원을 *집합적으로* mirror, unknowns가 authoritative carrier)
  preempted_prior_ref?: <RowRef>                  # P0 preempt된 prior flow의 RowRef (post-stabilization follow-up용). M2: 존재 ⇔ 입력 active_flow_state.preempted≠null

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

source_manifest?:                                 # R36 — Ground는 canonical fact-citation step (CLAUDE.md/AGENTS.md/.claude/rules 읽음)
  entries: [{ path, sha256, line_count, cited_lines }]
  # M2: Ground가 인용하는 모든 file:line은 여기 cited_lines에 존재해야 하고 각 sha256은 Verify에서 re-hash 일치
```

**Provenance 강제**: 모든 fact / unknown / conflict / omitted_field 항목에 `source_tool` 필수. `verification_proof` 해시만으론 부족 — 항목별로 출처 추적 가능해야 함.

### omitted_fields carrier + key-omission 규칙 (R22 — README↔policy 출력 shape 정합)

tool/data 부재로 *어떤 schema key를 산출 못 할 때*의 규칙 (Ground 본 contract가 자기 degrade가 의존하는 carrier를 명시):

- 키 자체를 **완전 omit** (YAML에 key 등장 안 함). `value: null`, `value: # OMITTED` 같은 marker 금지. (R22: key full omission, not value-comment)
- omit한 키마다 `omitted_fields`에 `{field, reason, source_tool}` 1행 기록.
- **git-omission 행의 source_tool**: `git_state≠repo`로 branch/dirty/head_*/recent_commits를 omit한 행은 *측정값이 없는* 사실적 비-측정이므로, source_tool에 **git_state 판별 도구**(예: `git rev-parse`)를 기록한다 — 즉 같은 git_state를 산출한 `VolatileGit` non-repo 분기의 `source_tool`과 *동일* 값이다 (provenance가 갈라지지 않음). 마찬가지로 `ed_snapshot_version` omission 행은 ED query 도구를 source_tool로 가진다.
- ED 부재로 escalate가 아닌 "ED present인데 god_node 분류 불가" 같은 경우는 발생하지 않는다 — ED present면 god_nodes_in_scope는 measured 분기에 존재하고, ED absent면 escalate다. (R18: god_node interpretation when ED absent → 본 contract에선 ED absent=escalate이므로 god_node 산출 자체가 차단됨)

이 carrier가 없으면 `omitted_fields`를 참조하는 자기 degrade(conditional volatile 부재 등)가 갈 곳이 없었다 — 그 홀을 닫는다. (closes: README schema가 omitted_fields carrier 부재였던 gap)

**profile 부재(정상) vs capture 결손(기록) 구분**: conditional 필드(perf_baseline/dependency_audit/observability/release_state)가 *현재 flow_type이 그 필드를 profile에 선언하지 않아서* 부재한 경우(예: feature flow에 perf_baseline 부재)는 **정상 profile 부재**이며 `omitted_fields` 행을 **요구하지 않는다** — Ground가 omit한 게 아니라 애초에 해당 flow의 profile에 없는 필드다. `omitted_fields`는 *profile이 선언한 필드를 캡처하지 못했을 때*만 요구된다: ① profile-declared conditional 필드가 자기 applicable flow 안에서 캡처 실패(skipped/tool_absent/timeout/tool_failed/unavailable; 예: performance flow에서 perf 명령 실패), ② `git_state≠repo`의 head_*/recent_commits omission, ③ unrecognized_flow fallback에서 universal-only로 떨어지며 *추론을 거부한* conditional 차원. 따라서 non-performance run이 perf_baseline 부재로 `omitted_fields` 행을 가질 필요는 없다 (정상 profile 부재).

**M2-only invariant (grammar 미강제)**: `omitted_fields`는 grammar 수준에선 *optional*이다 (schema의 top-level required에 없음 — 아무것도 omit 안 한 ok 출력은 빈/부재 carrier가 합법). "profile이 선언한 schema key가 omit됐으면 정확히 1행이 존재하고 비어있지 않아야 한다"는 *키↔행 linkage*는 grammar로 닫을 수 없으므로 **M2 reviewer가 강제한다** (§223 omitted_fields gate). 즉 `degraded_pass` 분기(profile-declared conditional volatile 캡처 결손, `git_state≠repo` head_* omission, unrecognized_flow conditional 차원 omission)는 정의상 *선언된* 키를 omit하므로 M2에서 `omitted_fields` 비어있지 않음이 보장된다 — 단 이는 grammar invariant가 아니라 M2-only invariant이며, *profile 미선언으로 인한 정상 부재*에는 적용되지 않는다.

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
| `unrecognized_flow` | `flow_type`이 [Volatile Profile by Flow Type] 표의 어느 행에도 매칭 안 됨 — Ground가 conditional profile을 추론하지 않고 universal-only로 fallback (referent와 별개 차원: 그래프 entity 부재가 아니라 *profile 차원* 미상) | `unrecognized_flow_type` |

enum은 *사실 차원* 기준이며, 새 사실 차원이 생기면 dim에 추가 가능(open-ish) — 단 모든 항목은 `reason + source_tool`로 self-describing해야 한다(silent-gap 금지). Investigate는 이 dim → unknown-disposition.md matrix의 `unknown_type`으로 매핑해 처분한다. (downstream type-safe branch 가능)

### conflicts production rule (unknowns vs conflicts 경계 — open disjunction 닫음)

`conflicts[]`와 `unknowns[]`는 *별개 채널*이며 산출 기준이 mechanical하게 구분된다. 이전 Surface 문구의 "unknowns 또는 conflicts" open disjunction을 닫는다. (closes: conflicts had no production rule)

- **unknowns** = *단일 source*의 불확실성 (모름·미해소·미인식). 1개 source가 "이건 모르겠다/애매하다/추론값이다"라고 말하는 모든 경우. ED AMBIGUOUS/INFERRED 엣지, referent 미해소, capture 실패/timeout, inaccessible, racing_changes 등은 전부 unknowns다.
- **conflicts** = *2개 이상 source가 같은 referent에 대해 양립 불가한 사실을 동시에 보고*. 즉 둘 다 측정됐고(둘 다 measured) 둘이 서로 모순일 때만 conflict다. mechanical 산출 조건:
  - **ED drift conflict**: ED가 `card↔code 불일치`를 *양쪽 사실*과 함께 보고 (card는 X라 하고 code는 Y라 함) → conflicts 1행. `sources: [{kind:file, ref:card}, {kind:file, ref:code}]`. (이 경우 `unknowns[{dim:ed_drift}]`가 아니라 conflicts로 간다 — 양립 불가 *사실 쌍*이 있으므로. ed_drift dim은 ED가 한쪽만 보고하고 다른 쪽을 모를 때의 *단일-source 불확실성*에 한정.) **출처 규칙(R36, 홀 닫음)**: 이 `card`/`code` ref는 *ED-graph artifact*(Ground가 직접 read하지 않은 ED-internal ref)이므로 `source_manifest.entries`에 등장할 필요가 *없다*. 반대로 `kind:file` ref가 Ground가 실제로 *읽은* 파일 경로면(verification_proof.read_files에 존재) 그건 `source_manifest.cited_lines`에 *반드시* 존재해야 한다 (x-validator-contract M2). 즉 conflict file ref의 source_manifest 등재 의무는 "Ground가 그 파일을 읽었는가"로 갈린다.
  - **tool↔tool conflict**: 2개 volatile 측정이 같은 referent에 대해 양립 불가한 결과 (예: typecheck는 pass인데 build 산출물이 stale을 보고) → conflicts 1행. `sources: [{kind:tool, ref}, {kind:tool, ref}]`.
- **경계 규칙 (mechanical, 모호성 0)**: source가 1개면 *항상* unknowns (해당 dim). source가 2개 이상이고 그 둘이 *양립 불가한 사실*을 보고하면 *항상* conflicts. 양쪽 다 해당 안 되면(모순 없음) 아무것도 산출 안 함.
- **Boundary**: conflict는 *사실 surface*다 — Ground는 "두 source가 모순이다"라는 사실만 기록하고, *누가 옳은지·어느 쪽을 택할지* 판단하지 않는다 (그건 Investigate/Verify 일). conflicts 항목에 derived/판정 문장 금지 (reviewer Boundary gate, R18).

각 conflict 항목은 `{sources:[{kind, ref}], description, source_tool}`로 self-describing. ED가 양쪽 사실을 동시에 surface하지 못해 한쪽만 알면 그건 conflict가 아니라 `unknowns[{dim:ed_drift}]` (단일-source 불확실성)다.

## Reviewer (ground-reviewer)

| 검사 | 기준 |
|---|---|
| ground_result | `status` ∈ {ok, degraded_pass, escalate}. `degraded_pass`면 `degrade_reasons` 비어있지 않음. `escalate`면 `escalate_detail.{failure_origin, reason, evidence}` 존재, `failure_origin` ∈ {ground, cap_exceeded} (cap_exceeded는 step budget 소진에만) |
| task_subgraph | `status=measured`면 `entry_nodes` ≥1 **OR** unknowns에 `{dim: referent, reason: unresolved}` 명시. `status=omitted`은 ground_result.status=escalate가 아닌 경우엔 발생 불가 (ED 총부재=escalate) |
| ED-absence 정합 | `task_subgraph.status=omitted`이면서 `ground_result.status≠escalate` → **FAIL** `reason: "ED absence must escalate (primary tool), not degraded"` (P2 + principle 1). task_subgraph Omitted은 *오직* escalate와만 공존하며 (degenerate empty subgraph·referent absent는 measured), Omitted.reason ∈ {unavailable, tool_failed, timeout, skipped}로 제한된다 (M1 grammar 강제 — tool_absent/not_applicable는 task_subgraph에서 구조적으로 산출 불가). **reason↔failure_origin 정합(M2)**: {unavailable, tool_failed, timeout}는 *오직* `failure_origin=ground`(ED-down)일 때만, `skipped`는 *오직* `failure_origin=cap_exceeded`(budget 소진으로 subgraph 건너뜀)일 때만 합법 — grammar는 enum 멤버만 좁히고 reason↔origin 페어링은 M2가 강제 |
| volatile_state | profile-required 각 명령에 explicit M3 분기 (measured OR omitted{reason}; M3 판별자는 status=measured\|omitted, typecheck/tests 측정 결과 필드는 result, lint은 warnings/errors만). omitted면 reason ∈ Ground-emit Omitted reason {tool_absent, tool_failed, timeout, unavailable, skipped} — 명령 정의 없음=skipped, 실행 실패=tool_failed, timeout=timeout, 바이너리 부재=tool_absent, 백엔드/MCP 미부착=unavailable. not_applicable은 Omitted 분기가 `reason ∈ {tool_absent,tool_failed,timeout,unavailable,skipped}`로 narrow돼 **M1 grammar상 산출 불가** — reviewer는 정합 재확인만 ([Ground와 not_applicable]) |
| conditional volatile gate (M2) | conditional 키(perf_baseline/dependency_audit/observability/release_state)는 *현재 `flow_type`의 profile이 그 필드를 선언한 경우에만* 존재 가능 (perf_baseline⇔performance, dependency_audit⇔migration, observability⇔bugfix-unreproducible, release_state⇔release — [Volatile Profile by Flow Type]). 선언 안 한 flow_type에 해당 키가 존재하면 **FAIL** `reason: "conditional volatile field present in a flow whose profile does not declare it"`. flow_type이 free string이라 grammar 미강제 → M2 reviewer 강제 (조작된 conditional 측정이 grammar·reviewer 통과하는 홀 닫음) |
| skipped carrier | volatile 명령 부재가 `omitted{reason: skipped, source_tool}`로 carrier에 존재 (silent skip 0) |
| unknowns 매핑 | ED의 AMBIGUOUS/INFERRED 엣지 + capture 실패가 모두 unknowns에 매핑됨 (단일-source = unknowns; [conflicts production rule]) |
| conflicts 매핑 | 모든 conflicts 항목이 *2개 이상 source의 양립 불가 사실*임 ([conflicts production rule] 기준). single-source 항목이 conflicts에 있으면 FAIL `reason: "single-source belongs in unknowns, not conflicts"`. conflicts 항목에 판정/derived 문장 있으면 FAIL (Boundary) |
| dim 태그 | 모든 `unknowns[].dim`이 FACTUAL tag enum 소속(또는 self-describing) — Investigate disposition 토큰 미사용 |
| omitted_fields | *profile이 선언한* schema key가 omit될 때마다 `omitted_fields`에 `{field, reason, source_tool}` 1행 (profile 미선언으로 인한 정상 conditional 부재는 행 불요). `value: null`/comment-only key 검출 시 FAIL `reason: "R22 partial omission"` |
| provenance | 모든 사실/unknown/conflict/omitted_field 항목에 `source_tool` 존재 |
| escalate proof-of-attempt (M2) | `status=escalate` & `failure_origin=ground`이면 `verification_proof`에 escalate를 증명한 attempted tool_call/ed_query가 *최소 1개* 존재(ED-down이면 attempted ed_query)하고 `escalate_detail.evidence`가 그 ref를 가리켜야 함. grammar 미강제(공유 VerificationProof에 minItems 없음)이므로 M2 강제. 위반 시 FAIL `reason: "escalate verification_proof missing attempted ED query"`. cap_exceeded escalate는 면제 |
| active_flow_note linkage (M2) | `preempted_prior_ref` 존재 ⇔ 입력 `active_flow_state.preempted≠null`. `suspended_similar_hint` 존재 ⇔ similarity check fired ⇔ 매칭 `unknowns[{dim:suspended_similar}]` ≥1개 존재(overlapping prior 당 1개라 다중 가능; unknowns가 authoritative, hint는 차원을 집합적으로 mirror). 위반 시 FAIL |
| conversation_context_digest 결합 (M2) | `conversation_context_digest` 존재 ⇔ `channel=user_session` (a2a/ci는 키 부재). 위반 시 FAIL |
| depth P0 override | `flow_type=bugfix-p0`이면 `depth=shallow` (M1 grammar 강제 — reviewer는 정합 재확인만) |
| conflict file ref 출처 (M2) | `conflicts[].sources[{kind:file}].ref`가 Ground가 *읽은* 파일(verification_proof.read_files)이면 `source_manifest.entries`에 존재해야 함. ED-internal artifact(card/code 등 Ground 미독)면 면제 |
| ED-down Omitted reason | `task_subgraph` Omitted일 때 reason: `failure_origin=ground`(ED-down)이면 ∈ {unavailable(MCP 미부착), tool_failed(error), timeout} ([ED MCP] 표 매핑); `failure_origin=cap_exceeded`(budget 소진으로 subgraph 건너뜀)이면 `skipped`. escalate-grade는 `ground_result.status=escalate`가 운반. reason↔failure_origin 페어링 위반 시 FAIL (M2) |
| source_manifest | (R36) Ground가 인용하는 모든 file:line이 `source_manifest.entries[].cited_lines`에 존재; 각 entry는 `{path, sha256, line_count, cited_lines}`. M2: sha256 re-hash 일치 |
| freshness | `task_subgraph.status=measured`면 `ed_snapshot_version` 기록 — **이 요구는 M2-only(grammar 미강제)다**: schema는 `freshness.ed_snapshot_version`을 grammar 수준에서 optional로 두며(status≠escalate에서 measured subgraph일 때 requiredness를 거는 grammar branch가 없음 — escalate `then`이 freshness를 통째로 relax하고 ED-Omitted는 *항상* escalate와 공존하므로 grammar는 non-escalate measured 케이스만 별도로 강제하지 않는다), "measured면 ed_snapshot_version 존재 + `task_subgraph.value.ed_snapshot_version`과 일치"는 reviewer(M2)가 강제한다. `volatile_state.git.git_state` 항상 존재. `git_state=repo`면 `git_head_start` 기록(이건 M1 grammar 조건부 allOf 강제); `git_state∈{no_repo,empty_repo,git_unavailable}`면 head_*/dirty omit + omitted_fields 기록 ([git capture states]) |
| git_state | `git_state` ∈ {repo, no_repo, empty_repo, git_unavailable}. ≠repo면 branch/dirty/head_*/recent_commits 키 omit + 해당 unknowns dim + `degraded_pass` ([git capture states]). git_state 부재 = FAIL |
| racing_changes | `git_state=repo`이고 `head_start ≠ head_end`이면 표시 (재시도 1회 후도 변동 시). `git_state≠repo`면 비교 skip, `racing_changes=false`. capture window 내 git_state 전이(시작 repo→종료 비-repo 등)는 instability → `degraded_pass` + `unknowns[{dim:racing_changes\|capture_failure}]` + `racing_changes=false` ([racing_changes] capture window 전이) |
| Boundary 준수 | 해석·판단 흔적 없음 (예: "perf delta 의미 X" 같은 평가 prose 금지; conflicts에 derived/counting 문장 금지 — R18) |

## Failure & degrade handling

### ED MCP (emberdeck.query_graph) — PRIMARY tool (P2 + principle 1)

ED는 Ground의 *주요* 도구다. 그 부재/실패는 Ground가 *자기 일을 못 한다*는 뜻이므로 degrade가 아니라 **escalate**다. 이는 unknown-disposition.md L24 (`tool_unavailable (ED/firebat/pyreez 부재) → escalate`)와 정확히 정합한다. (principle 1: ED primary → escalate)

| ED 상태 | 구분 | Ground 처리 |
|---|---|---|
| present + 결과 있음 | 정상 | `task_subgraph.status=measured`, `ground_result.status=ok` |
| present + request referent 그래프에 부재 | **legitimate verdict** (도구는 동작) | `unknowns[{dim:referent, reason:unresolved}]`, task_subgraph는 measured(다른 entry_nodes 있을 수 있음) 또는 entry_nodes=[] + referent unknown. `ground_result.status=ok` |
| present + 결과 빈 subgraph (referent는 technically 존재) | **degenerate-but-working** (도구는 동작) | referent 해소 결과를 명시: 해소 안 됨이면 `unknowns[{dim:referent, reason:unresolved}]`; 해소됐으나 neighbors 없음이면 entry_nodes에 referent node 1개 + neighbors=[]. **reviewer gate 만족**: entry_nodes≥1 OR referent_unresolved 둘 중 하나로 *명확히* 분류. `ground_result.status=ok` (principle 3: degenerate-but-working ≠ broken) |
| ABSENT (MCP not in session) / error / timeout | **PRIMARY tool down** | `ground_result.status=escalate`, `escalate_detail: {failure_origin: ground, reason: "emberdeck MCP unavailable / errored / timed out", evidence: <attempted ed_query ref>}`. `task_subgraph`는 **Omitted 분기**로 산출(additionalProperties:false상 통째 부재 불가) — **Omitted.reason 매핑**: MCP 미부착=`unavailable`, ED error=`tool_failed`, ED timeout=`timeout` (공유 Omitted enum; escalate/primary_down 멤버는 없으므로 escalate-grade는 `ground_result.status=escalate`가 운반, Omitted.reason은 *왜 omit됐나*만 기록). `ed_snapshot_version`/`god_nodes_in_scope`는 measured value 안에 있던 키라 함께 부재 + omitted_fields 기록. **Flow halt** (P2 + principle 1) |

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

**Ground와 not_applicable (orphan enum 닫음 — M1 grammar)**: 공유 Omitted enum(`_defs.schema.json`)은 `not_applicable`을 포함하지만 — 이는 다른 step이 "이 측정이 이 맥락에 *해당 안 됨*"을 표현하는 멤버다 — **Ground는 `not_applicable`을 emit하지 않는다**. Ground에서 측정 omission의 사유는 항상 위 표의 5개 {skipped, tool_absent, unavailable, timeout, tool_failed} 중 하나로 분류된다: 명령이 *정의 안 됨*(해당 안 됨 포함)은 `skipped`, profile 미선언 conditional 필드는 애초에 키 자체가 부재(Omitted 분기 아님 — [omitted_fields carrier] profile 부재 규칙). 이 `not_applicable` 배제는 *단일-enum-멤버 제한*이라 grammar로 표현 가능하므로 **M1에서 닫는다**: Ground의 모든 volatile Omitted 분기(universal typecheck/tests/lint + conditional 4개)는 shared Omitted를 `reason ∈ {tool_absent, tool_failed, timeout, unavailable, skipped}`로 narrow한 allOf로 ref하여 `not_applicable`을 구조적으로 산출 불가하게 한다 — task_subgraph의 Omitted reason 제한과 *동일한* grammar 처리이며(asymmetry 없음), reviewer는 정합 재확인만 한다. (closes: not_applicable orphan enum member — grammar-enforced, symmetric with task_subgraph)

### git capture states (git는 *사실 상태*지 primary tool 아님 — non-repo/empty/binary부재는 escalate 아닌 *사실 surface*)

git 캡처는 "always measured"가 아니라 *git_state discriminant로 항상 분류*된다. git이 없거나(non-repo, binary 부재) commit이 0개여도 그건 Ground가 *자기 일을 못 하는 것*이 아니라 *워크스페이스의 사실 상태*다 — 그 사실을 기록하고 degrade로 surface한다 (escalate 아님). git은 PRIMARY tool이 아니므로 principle 1상 degrade 경로다. (closes: git failure / non-repo / empty-repo unhandled)

| git_state | 조건 | Ground 처리 |
|---|---|---|
| `repo` | git repo + commit ≥1 | 정상. branch/dirty/head_start/head_end/recent_commits measured. racing_changes 비교 적용 |
| `empty_repo` | git repo지만 commit 0개 (HEAD 없음) | branch/dirty/head_start/head_end/recent_commits 키 omit + omitted_fields 기록. `unknowns[{dim:capture_failure, reason:"empty_repo — no HEAD", source_tool}]` + `ground_result.status=degraded_pass`. racing_changes 비교 skip (`freshness.racing_changes=false`) |
| `no_repo` | 워킹디렉터리가 git repo 아님 | 위와 동일 키 omit + omitted_fields. `unknowns[{dim:inaccessible, reason:"no_git_repo", source_tool}]` + `degraded_pass`. racing_changes skip |
| `git_unavailable` | git 바이너리 부재/실행 불가 | 위와 동일 키 omit + omitted_fields. `unknowns[{dim:capture_failure, reason:"git_unavailable", source_tool}]` + `degraded_pass`. racing_changes skip |

**Cache key 영향**: cache key의 `git_HEAD`·`worktree_status` 구성요소는 git_state≠repo이면 측정 불가 → 그 자리에 `git_state` 토큰 자체를 사용한다 (예: `no_repo`). 즉 cache key는 항상 잘 정의된다 (HEAD 부재로 깨지지 않음). git_state가 repo→non-repo로 바뀌면 key가 달라져 invalidate된다.

### racing_changes

`git HEAD start ≠ end` 감지 → 1회 재시도. 재시도 후에도 변동 시 → `freshness.racing_changes=true` + `unknowns[{dim:racing_changes, reason:head_moved_after_retry}]` + `ground_result.status=degraded_pass`. (escalate 아님 — Investigate가 risk로 처분 가능; unknown-disposition.md `racing_changes→risk`)

**git_state≠repo일 때**: head_start/head_end가 없으므로 racing_changes 비교 자체를 skip하고 `freshness.racing_changes=false`로 둔다 (비교 불가를 모순으로 오인하지 않음 — principle 3: 합법적 부재 ≠ 깨진 입력).

**capture window 내 git_state 전이 (instability)**: 위 규칙들은 단일 capture window의 시작·종료에 걸쳐 `git_state`가 *안정*임을 가정한다. 시작 시 `git_state=repo`였으나 종료 전에 repo/HEAD가 사라지거나(예: repo→no_repo/git_unavailable로 전이) `git_state`가 달리 관측되면 — head_end 캡처와 racing 비교가 정의되지 않는다. 이를 *미정의로 두지 않고* **instability**로 처리한다: head_end/racing 비교를 *모순으로 오인하거나 깨진 출력으로 산출하지 않고*, `ground_result.status=degraded_pass` + `unknowns[{dim:racing_changes, reason:"git_state changed during capture window", source_tool}]` (HEAD 비교 자체가 불안정했던 경우) 또는 종료-상태가 비-repo면 `unknowns[{dim:capture_failure, reason:"git_state transitioned to <end_state> during capture", source_tool}]` + 종료 git_state 분기의 head_* omit + omitted_fields 기록으로 surface한다. `freshness.racing_changes`는 비교가 불안정/불가했으므로 `false`로 둔다 (안정적 head_start≠head_end 증거가 없음). 즉 window 내 전이는 escalate가 아니라 degrade-surface다 (git은 PRIMARY 아님). (closes: git_state transition within a single capture window undefined — cache-key invalidation note는 *런들 간* KEY 전이만 다룸, 본 규칙은 *한 run 내* 관측 전이를 다룸)

### active_flow_state (orchestrator가 Ground 진입 전 해결; Ground는 잔재 인지 + 기형 escalate)

Ground는 conflict resolution을 하지 않는다 (orchestrator 책임). Ground는 *해결 후 잔재* 인지 + *기형 입력* escalate만 한다. `active_flow_state`는 런타임 *입력*으로만 소비되며 (input_refs에 raw 형태로 등장하지 않음), 그 *잔재*만 출력 `active_flow_note`(suspended_similar_hint / preempted_prior_ref)로 나타난다. malformed→escalate는 위 `ground_result` 경로로 처리된다.

**active_flow_state(입력) ↔ active_flow_note(출력) linkage (x-validator-contract, M2)**: `active_flow_state`는 출력 schema에 없는 *입력*이라 grammar가 그 값을 볼 수 없으므로 아래 결합은 M2 reviewer가 강제한다 (advisory 아님 — degraded/ok run이 preempted prior를 가지고도 note를 안 채우면 FAIL).
- `active_flow_note.preempted_prior_ref` **존재 ⇔ `active_flow_state.preempted ≠ null`**.
- `active_flow_note.suspended_similar_hint` **존재 ⇔ similarity check가 path-prefix overlap을 발견**. 발견 시 **authoritative carrier**는 `unknowns[{dim:suspended_similar}]` 항목(들)이고 hint는 그 *advisory mirror*다 — hint가 있으면 매칭 unknowns 항목이 *최소 1개* 존재해야 한다(overlapping prior 당 1개라 다중 가능; hint는 suspended_similar *차원*을 집합적으로 mirror하며 1:1 대응이 아니다 — hint는 권위 carrier 아님).

| `active_flow_state` 형태 | Ground 처리 |
|---|---|
| `active: null, suspended: []` | 그대로 진행 (`status=ok`) |
| `active: null, suspended: [prior...]` (orchestrator suspend 처리 후) | 진행. similarity check가 path-prefix overlap 발견 시 **authoritative carrier**인 unknowns[{dim:suspended_similar}] 항목(overlapping prior 당 1행, 다중 가능) + (mirror) `active_flow_note.suspended_similar_hint`. M2 linkage: hint 존재 ⇔ similarity check fired ⇔ 매칭 unknowns 항목 ≥1개 존재 |
| `active: null, preempted: prior_id` (P0 preempt 직후) | 진행. `active_flow_note.preempted_prior_ref` 기록 (post-stabilization follow-up용). M2 linkage: **preempted_prior_ref 존재 ⇔ active_flow_state.preempted≠null** |
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

표 키는 canonical `flow_type` 토큰(triage.schema.json `FlowType` enum의 hyphenated/single-word stem)이다 — display 이름이 아니다. 런타임은 실제 `flow_type` 토큰을 이 키에 직접 매칭한다 (매핑 레이어 없음).

| Flow (flow_type token) | Universal + 추가 conditional 필드 |
|---|---|
| feature, bugfix, bugfix-p0, refactor, test, chore, review, retro, exploration, compound, plan-standalone, spike | Universal만 (typecheck/tests/lint/git) |
| performance | + `perf_baseline: { p50, p95, p99, throughput, command, captured_at, output_hash }` (output_hash = provenance hash, measured 분기 필수) |
| migration | + `dependency_audit: { packages: [{name, current, latest, breaking}], lockfile_hash, source_command }` |
| bugfix-unreproducible | + `observability: { logs_query, metrics_query, traces_query, results, source_tool }` |
| release | + `release_state: { last_version, new_commits_count, changelog_entries: [...] }` |

위 conditional 필드는 *명시 schema*. Ground 출력의 `volatile_state.<conditional_field>`로 carrier 제공 (각 값은 M3 DegradableMeasurement). Investigate가 type-safe 참조 가능.

**Conditional 필드 presence gate (M2)**: conditional 필드는 *현재 flow_type의 profile이 그것을 선언할 때에만* `volatile_state`에 존재할 수 있다 — perf_baseline은 performance, dependency_audit은 migration, observability는 bugfix-unreproducible, release_state는 release flow에서만. `flow_type`은 free string이라(M4 flow-definition source가 권위) grammar가 presence를 flow_type에 gate할 수 없으므로 이 제약은 **x-validator-contract(M2) reviewer가 강제한다**: 선언하지 않은 flow_type(예: chore/feature)에 conditional 키가 존재하면 **FAIL**. 이로써 비-applicable flow에 조작된 perf_baseline 등이 grammar·reviewer를 모두 통과하던 홀을 닫는다 (정상 *부재*는 [omitted_fields carrier] profile 부재 규칙대로 omitted_fields 행 불요).

### Unknown / 미인식 flow_type fallback (P8)

`flow_type`이 위 표의 어느 행에도 매칭 안 되면 (Triage가 산출했으나 Ground가 모르는 값, 또는 garbage):

1. **존재+정형 precondition은 통과** (non-empty string이므로) — 이건 input-precondition escalate 대상이 *아니다*.
2. **Universal-only profile 실행** — 알 수 없는 conditional은 안전한 최소 집합(typecheck/tests/lint/git)으로 fallback. conditional 필드는 키 omit + omitted_fields 기록.
3. **사실 surface**: `unknowns[{dim:unrecognized_flow, reason:"unrecognized flow_type — universal profile applied", source_tool}]` 1개 추가하여 *Ground가 profile을 추론하지 않았음*을 명시 (referent 아님 — 그래프 entity 부재가 아니라 profile 차원 미상; [unknowns.dim FACTUAL tag enum] `unrecognized_flow`).
4. `ground_result.status=degraded_pass`, `degrade_reasons: ["unrecognized flow_type; universal-only profile"]`.

**deepen trigger와의 상호작용 (명시)**: universal-only profile로의 collapse는 *profile 차원*(어느 conditional 측정을 도느냐)만 좁힌다 — **non-flow_type deepen triggers는 보존된다**. 즉 [Adaptive Depth] deepen triggers 중 `flow_type ∈ {feature, migration, performance, compound}` 항목은 미인식 토큰이 그 집합에 없으므로 *발화하지 않지만*, 나머지 세 trigger(`complexity_signal=high`, shallow ed_query 결과에 god_node 포함, volatile_capture failures ≥1)는 flow_type과 무관하므로 *그대로 평가된다*. 따라서 unrecognized flow_type + degraded_pass run도 이 세 trigger 중 하나로 `depth=deep`에 도달할 수 있으며, 이는 의도된·정합적 조합이다([Depth와 result의 독립성] — depth는 *얼마나 깊이 측정하나*, result는 *결손 분기*로 서로 독립). universal-only profile은 deep에서도 universal 측정만 *더 깊이* 돌 뿐 미상의 conditional 차원을 추론하지 않는다.

이로써 미인식 flow_type은 silent하게 빈 profile로 통과하지 않고, escalate로 과잉 halt하지도 않는다 — degrade로 surface하고 Investigate/orchestrator가 처분. (closes: unknown/garbage flow_type fallback; principle 3: not silent rubber-stamp, not over-escalate)

## Cache 정책 (logically stateless + strict invalidation)

논리적으로 stateless (같은 입력 → 같은 출력). 캐시 사용 가능, 단 invalidation 엄격:

**Cache key**: `hash(request_text + conversation_context_digest + ed_snapshot_version + git_HEAD + worktree_status + volatile_commands_definition + flow_type + scope_hint)`

`git_HEAD`·`worktree_status`는 `git_state=repo`일 때의 값이며, `git_state≠repo`이면 그 자리에 `git_state` 토큰(`no_repo`|`empty_repo`|`git_unavailable`)을 사용한다 — HEAD 부재로 key가 깨지지 않고 항상 잘 정의된다 ([git capture states]).

cache hit이어도 freshness metadata 노출 필수. 모든 키 구성요소 변동 시 invalidate. `ground_result.status=escalate`는 캐시하지 않는다 (mechanical error는 재시도 대상).

## 채널별 차이

없음 — Ground는 channel-agnostic. 단 `conversation_context`가 user_session에서만 존재 (a2a/ci는 *부재* — input-precondition상 *합법적 부재*이며 escalate 아님). 출력 `input_refs.conversation_context_digest`도 이와 정합: **channel=user_session ⇔ conversation_context_digest 존재** (a2a/ci에선 키 자체 부재, 빈 문자열로 채우지 않음). user_session에서 conversation_context turn이 0개여도 digest 키는 *존재*한다 — 빈 입력에 대한 digest 값을 가지며(빈 문자열 아님), 키 부재는 a2a/ci에만 예약된다. 이 channel↔digest 결합은 grammar로 닫을 수 없는 cross-field 제약이므로 x-validator-contract(M2)가 강제한다 (advisory 아님 — 위반 시 FAIL).

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
- flow_type ∈ {feature, migration, performance, compound}
- Triage.complexity_signal = high
- shallow ed_query 결과에 god_node 포함
- volatile_capture failures (lint/test/typecheck) ≥ 1

P0 override: `flow_type = bugfix-p0`이면 모든 deepen trigger 무시, shallow 강제. **이 override는 M1 grammar로 강제된다** — schema top-level allOf의 `if flow_type=bugfix-p0 then depth=shallow`로, `flow_type=bugfix-p0` + `depth=deep` 조합은 구조적으로 산출 불가(reviewer 도달 전 grammar 차단). depth는 orchestrator-injected fact지만 이 한 가지 cross-field 모순은 grammar가 닫는다.

**Depth와 result의 독립성**: deepen은 *얼마나 깊이 측정하나*를 정할 뿐, ED 부재나 input 결손은 depth와 무관하게 [Result enum & branches] 규칙대로 escalate/degrade한다.

**Step 자체 budget 소진 처리** (Test/Implement step과 동일 원칙 — silent partial 금지): 위 caps(shallow wall_s=20/tokens=5k, deep wall_s=180/tokens=20k)가 모든 activity 완료 *전에* 소진되면(예: ED query가 끝나기 전 wall_s 초과, 또는 누적 토큰 초과) → Ground는 **부분 결과를 ok/degraded_pass로 고무도장하지 않는다**. mechanical error → **escalate**: `ground_result.status=escalate`, `escalate_detail={failure_origin: cap_exceeded, reason: "step budget (wall_s/tokens) exhausted before all activities complete", evidence: <부분 진행분을 요약한 단일 ref string — 완료/미완 activity를 가리키는 progress-checkpoint ref (schema상 escalate_detail.evidence는 single string이므로 구조적 list가 아니라 그 list를 가리키는 *하나의* ref/요약 string으로 직렬화)>}`. `cap_exceeded`는 공유 FailureOrigin enum의 orchestrator-level halt origin(failure-routing.md, `_defs.schema.json`) — Ground⇄reviewer 자동 재진입이 아니라 즉시 flow-level halt+escalate(NO auto-reinvoke). (개별 operation의 per-command volatile timeout=omitted, ED timeout=escalate(failure_origin=ground)와 구분됨: 여기는 *step 전체* 예산 소진.)
