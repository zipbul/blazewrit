# Ground — Evidence Boundary

## Definition

> **Ground는 Triage된 의도를 bounded·sourced·current 사실 + 명시 불확실성으로 변환한다.** 영향 해석도, 행동 선택도 하지 않는다. 다음 step (Investigate)이 *추측 없이* 영향 분석할 수 있는 evidence 기반을 제공.

**Ground가 하는 것**: ED 그래프 query / volatile 측정 / unknown·conflict surface  
**Ground가 안 하는 것**: 판정, 영향 분석, 설계, 계획, 카드 생성, 코드 변경, 측정값 *해석*, 위험 *판단*

## Inputs

| 필드 | 필수 | 설명 |
|---|---|---|
| `flow_type`, `classification_metadata`, `clarifications` | ✓ | Triage 출력 |
| `request_text` | ✓ | 원 입력 |
| `conversation_context` | optional | None-state turns |
| `channel` | ✓ | user_session \| a2a \| ci |
| `active_flow_state` | optional | 다른 in-flight 작업 인지용 (충돌 해결은 orchestrator) |
| `scope_hint` | optional | 모노리포 패키지/경로 한정 (Triage가 추출 또는 caller가 명시) |

## Activities (병렬 1·2 강제, 3은 둘 위에서)

Activities 1·2는 independent — orchestrator가 `invoke_parallel([activity1, activity2])`로 fan-out 실행 (R8). Activity 3 (Surface)는 둘 결과 위에서 sequential.

```
1. ED Graph Query
   - request_text + clarifications + scope_hint → ED MCP query
   - 출력: bounded subgraph (entry nodes + neighbors + god nodes in scope)
   - cap: token budget + god node expansion limit
   - per-node: freshness metadata (last_updated, source)

2. Volatile Capture (flow_type별 선언된 profile)
   - Universal (모든 flow): typecheck, test, lint, git status/log
   - Conditional (flow별 선언):
     · Performance: + perf baseline 측정
     · Migration: + dependency/compatibility audit
     · Bug Fix Unreproducible: + observability data
     · Release: + version·changelog 상태
   - 각 명령: bounded timeout
   - 명령 부재 시: skipped-with-reason
   - 캡처 시작·종료 git HEAD 비교 → 변동 시 racing_changes 1회 재시도

3. Surface
   - ED의 AMBIGUOUS/INFERRED 엣지 → unknowns 또는 conflicts에 매핑
   - capture 실패/timeout → unknowns
   - request referent 그래프에 부재 → unknowns[{dim: referent, reason: unresolved}]
   - silent gap 금지: 모든 모름·모순 명시
```

## Output (provenance 강제)

```yaml
flow_id: <id>
captured_at: ISO8601
schema_version: 1
input_refs: { triage_output, request_text, conversation_context, scope_hint }

task_subgraph:
  entry_nodes: [{ id, source: ed_query, freshness: ISO8601 }]
  neighbors: [...]
  god_nodes_in_scope: [...]
  bounded_at: token_count
  ed_snapshot_version: <ED version/hash>

volatile_state:
  typecheck: { status: success|fail|timeout|skipped, output_hash, source_command, captured_at, duration_ms }
  tests: { status, passed, failed: [...], coverage, source_command, captured_at, duration_ms }
  lint: { status, warnings, errors, source_command, captured_at, duration_ms }
  git: { branch, dirty, head_start, head_end, recent_commits: [...] }
  # flow-conditional 추가 (해당 시):
  perf_baseline?: { ... }
  dependency_audit?: { ... }
  observability?: { ... }
  release_state?: { ... }

unknowns: [{ dim, reason, source_tool, attempted_at }]
conflicts: [{ sources: [tool|file], description, source_tool }]

freshness:
  ed_snapshot_version
  git_head_start
  git_head_end           # 다르면 racing_changes 표시
  racing_changes: bool

verification_proof:
  tool_calls: [{ tool, args_hash, output_hash, exit_code }]
  read_files: [{ path, hash, mtime }]
  ed_queries: [{ query, result_hash }]
```

**Provenance 강제**: 모든 fact / unknown / conflict 항목에 `source_tool` 필수. `verification_proof` 해시만으론 부족 — 항목별로 출처 추적 가능해야 함.

## Reviewer (ground-reviewer)

| 검사 | 기준 |
|---|---|
| task_subgraph | `entry_nodes` ≥1 **OR** unknowns에 `referent_unresolved` 명시 |
| volatile_state | profile-required 각 명령에 explicit status (success/fail/timeout/skipped-with-reason) |
| unknowns 매핑 | ED의 AMBIGUOUS/INFERRED 엣지 + capture 실패가 unknowns 또는 conflicts에 모두 매핑됨 |
| provenance | 모든 사실 항목에 `source_tool` 존재 |
| freshness | `ed_snapshot_version` + `git_head_start` 기록됨 |
| racing_changes | `head_start ≠ head_end`이면 표시 (재시도 1회 후도 변동 시) |
| Boundary 준수 | 해석·판단 흔적 없음 (예: "perf delta 의미 X" 같은 평가 prose 금지) |

## Volatile Profile by Flow Type

선언된 capture profile만 실행. Ground가 *어느 측정이 중요한지 판단하지 않음* — flow definition이 미리 선언.

| Flow | Universal + 추가 conditional 필드 |
|---|---|
| Feature, Bug Fix, Bug Fix P0, Refactor, Test, Chore, Review, Retro, Exploration, Compound, plan-standalone, Spike | Universal만 (typecheck/tests/lint/git) |
| Performance | + `perf_baseline: { p50, p95, p99, throughput, captured_at, command }` |
| Migration | + `dependency_audit: { packages: [{name, current, latest, breaking}], lockfile_hash }` |
| Bug Fix Unreproducible | + `observability: { logs_query, metrics_query, traces_query, results }` |
| Release | + `release_state: { last_version, new_commits_count, changelog_entries: [...] }` |

profile은 `.blazewrit/flows/<type>.md`의 `volatile_profile` 필드에서 선언.

위 conditional 필드는 *명시 schema*. Ground 출력의 `volatile_state.<conditional_field>`로 carrier 제공. Investigate가 type-safe 참조 가능.

## Cache 정책 (logically stateless + strict invalidation)

논리적으로 stateless (같은 입력 → 같은 출력). 캐시 사용 가능, 단 invalidation 엄격:

**Cache key**: `hash(request_text + conversation_context_digest + ed_snapshot_version + git_HEAD + worktree_status + volatile_commands_definition + flow_type + scope_hint)`

cache hit이어도 freshness metadata 노출 필수. 모든 키 구성요소 변동 시 invalidate.

## Active Flow Conflict 우선순위

Ground는 conflict resolution 안 함. orchestrator가 *Ground 진입 전* 해결. 그러나 Ground는 *해결 후 잔재* 또는 *suspended/preempted prior*를 인지:

| `active_flow_state` 상태 | Ground 처리 |
|---|---|
| `active: null, suspended: []` | 그대로 진행 |
| `active: null, suspended: [prior1, prior2]` (orchestrator가 suspend 처리 후) | 그대로 진행. unknowns에 *유사 영역 suspended가 있다* hint (similarity 검사 시) |
| `active: null, preempted: prior_id` (P0 preempt 직후) | 그대로 진행. metadata에 preempted prior 기록 (post-stabilization follow-up에 사용) |
| `active: <something>` | **mechanical error** — orchestrator가 해결 안 한 채 Ground 진입 = bug. Ground 즉시 escalate |

## 채널별 차이

없음 — Ground는 channel-agnostic. 단 `conversation_context`가 user_session에서만 존재 (a2a/ci는 빈 값).

## Boundary — Ground가 안 하는 것

| 항목 | 책임 |
|---|---|
| Feasibility 판정 (proceed/blocked) | Investigate |
| 영향 범위 *해석* | Investigate |
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
