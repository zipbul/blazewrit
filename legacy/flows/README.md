# Flows (16)

모든 flow는 `Triage → Ground → Investigate → Decide → ...` 순. **Decide는 universal — skip 없음**, mode만 차등.

- `Ground(volatile_profile)`은 flow별 선언된 measurement profile (universal + conditional)
- `Decide(mode)`는 flow의 기본 mode 선언 (Record / Plan / Design) — Decide가 옵션 발견 시 upgrade 가능

## Chain by Flow Type

### Feature
```
Ground(universal)
→ Investigate(impact scope, card query, blockers, feasibility)
→ Decide(Design)              # design document + intent card
→ Spec → [Test ⇄ Implement]* → Verify → Reflect
```

### Bug Fix
```
Ground(universal)
→ Investigate(error logs, related code)
→ Decide(Record→Plan?)        # 단일 fix면 Record, 옵션 N≥2면 Plan
→ Test(reproduce) → Implement(fix) → Verify → Reflect
```

### Bug Fix P0
```
Ground(universal)
→ Investigate(minimal: symptom location only)
→ Decide(Record)              # emergency fix 결정
→ Implement(emergency) → Verify → Test(retroactive) → Reflect
```

### Bug Fix Unreproducible
```
Ground(universal + observability)
→ Investigate(logs, history, hypothesis 식별)
→ Decide(Plan)                # hypothesis 우선순위
→ Implement(hypothesis) → Verify(extended observation) → Reflect
```

### Refactor
```
Ground(universal)
→ Investigate(coverage, dependencies)
→ Decide(Plan→Design?)        # 단순 리팩터=Plan, 광범 시 Design upgrade
→ Spec → [Test(<80%)]? → [Implement → Verify]* → Reflect
```

### Performance
```
Ground(universal + perf baseline)
→ Investigate(profile target, baseline interpretation)
→ Decide(Design)              # 목표+정책+architecture
→ Spec → [Test(profile) → Implement → Verify(measure)]* → Reflect
```

### Migration
```
Ground(universal + dependency_audit)
→ Investigate(compatibility matrix, breaking surface)
→ Decide(Plan)                # 옵션 비교 + 순서, 광범 시 Design upgrade
→ Spec → [Test(validate) → Implement → Verify]* → Reflect
```

### Test
```
Ground(universal)
→ Investigate(coverage gap)
→ Decide(Plan)                # 어떤 테스트, 어떤 순서
→ Test → Verify → Reflect
```

### Chore
```
Ground(universal)
→ Investigate(minimal: change target)
→ Decide(Record)              # 자명한 1줄 결정
→ Implement → Verify → Reflect
```

### plan-standalone
```
Ground(universal)
→ Investigate(existing cards, docs)
→ Decide(Design)              # design document 산출
→ Report → Verify → Reflect
```

### Review
```
Ground(universal)
→ Investigate(diff, related code)
→ Decide(Record)              # 리뷰 verdict 결정
→ Report → Verify → Reflect
```

### Release
```
Ground(universal + version_changelog)
→ Investigate(minimal: version, CI status)
→ Decide(Record)              # patch/minor/major + changelog 항목
→ Implement(version) → Verify → Reflect
```

### Retro
```
Ground(universal)
→ Investigate(git log, history)
→ Decide(Plan)                # 어느 영역 학습 추출, 우선순위
→ Report → Verify → Reflect
```

### Spike
```
Ground(universal)
→ Investigate(minimal)
→ Decide(Plan)                # 어느 prototype 접근
→ Implement(prototype) → Report → Verify → Reflect
```

### Exploration
```
Ground(universal)
→ Investigate(관련 영역 탐색)
→ Decide(Plan)                # 어느 깊이/방향
→ Report → Verify → Reflect
```

### Compound
```
Ground(universal)
→ Investigate(sub-flow identification)
→ Decide(Design)              # sub-flow 분해 + ordering + gate_rules
→ [Sub-Flow → Gate]* → Report → Verify → Reflect
(각 Sub-Flow는 자체 Triage → Ground → Investigate → Decide → ... 실행)
```

→ Compound recursion 상세: [../steps/decide/compound-recursion.md](../steps/decide/compound-recursion.md)

## Reclassification Rules

Any step can trigger reclassification:

- Bug Fix discovers design flaw → Refactor or Compound
- Refactor requires public API change → Migration
- Spike confirms feasibility → Feature
- Any flow: 3 failures with same approach → stop, escalate
- Any flow: scope exceeds bounds → Compound or chunking

Triage reclassify cap: flow 당 3회. 초과 시 flow halt + escalate.

## Volatile Profile by Flow Type

| Flow | Universal | Conditional 추가 |
|---|---|---|
| Feature | typecheck/test/lint/git | — |
| Bug Fix | typecheck/test/lint/git | — |
| Bug Fix P0 | typecheck/test/lint/git | — |
| Bug Fix Unreproducible | typecheck/test/lint/git | `observability` (log tail, metrics snapshot) |
| Refactor | typecheck/test/lint/git | — |
| Performance | typecheck/test/lint/git | `perf_baseline` (bench run, metric capture) |
| Migration | typecheck/test/lint/git | `dependency_audit` (compat matrix, breaking surface scan) |
| Test | typecheck/test/lint/git | — |
| Chore | typecheck/test/lint/git | — |
| plan-standalone | typecheck/test/lint/git | — |
| Review | typecheck/test/lint/git | — |
| Release | typecheck/test/lint/git | `release_state` (version, CI status, changelog draft) |
| Retro | typecheck/test/lint/git | — |
| Spike | typecheck/test/lint/git | — |
| Exploration | typecheck/test/lint/git | — |
| Compound | typecheck/test/lint/git | (sub-flow별 profile inherit) |

## Decide Mode by Flow

| Flow | Default Mode | Upgrade Conditions |
|---|---|---|
| Feature | Design | — |
| Bug Fix | Record | 옵션 N≥2 → Plan |
| Bug Fix P0 | Record | (override 없음, emergency) |
| Bug Fix Unreproducible | Plan | — |
| Refactor | Plan | 광범 architecture 영향 → Design |
| Performance | Design | — |
| Migration | Plan | 광범 영향 → Design |
| Test | Plan | — |
| Chore | Record | — |
| plan-standalone | Design | — |
| Review | Record | — |
| Release | Record | — |
| Retro | Plan | — |
| Spike | Plan | — |
| Exploration | Plan | — |
| Compound | Design | — |

## Bug Fix Paths

| Condition | Path |
|-----------|------|
| Normal (reproducible) | Ground → Investigate → Decide(Record→Plan?) → Test(reproduce RED) → Implement(fix GREEN) → Verify → Reflect |
| P0/production down | Ground → Investigate(minimal) → Decide(Record) → Implement(emergency fix) → Verify → Test(retroactive, mandatory within 24h) → Reflect. Enforcement: scheduled trigger checks `retroactive_test_due` in flow-state.json every 6h, auto-creates Test flow if overdue. Fallback: SessionStart hook warns on next session. |
| Unreproducible (intermittent) | Ground → Investigate(hypothesis 식별) → Decide(Plan: hypothesis 우선순위) → Implement(hypothesis fix, documented) → Verify(extended observation) → Reflect |

## Refactor Guards

- If Investigate identifies target code has <80% test coverage → Test step mandatory before Implement to establish baseline
- Large scope (5+ files) → Decide forced to Design mode for chunking plan
- Breaking changes (public API) → reclassify as Migration

## Migration Test-First Rule

Migration flow includes Test before each Implement cycle:

```
Decide(Plan) → Spec → [Test(validate migration) → Implement(apply migration) → Verify]*
```

Test validates: migration scripts are reversible, data integrity preserved, rollback works.

## Chunking Rule

When Investigate identifies scope exceeding bounds (5+ files, 3+ modules), Decide MUST produce a chunking plan (Plan or Design mode):
- Split into bounded cycles, each covering one concern/module
- Each cycle is a complete mini-flow (Test → Implement → Verify)
- Dependency order between cycles defined in the plan

## Flow Variants — Operational Edge Cases

### Review flow follow-up

Review flow는 *audit only* — 코드 변경 안 함. 그러나 review findings에 *코드 수정 필요*가 surface되는 흔한 케이스:

- Review의 Decide(Record) 산출물: `decision_record` + `followup_flows: [{type: bugfix|refactor|feature, scope: <finding ref>}]`
- `followup_flows`가 비어있지 않으면 → Review 완료 후 orchestrator가 자동으로 후속 flow 큐잉 (각 finding이 자체 flow_id로)
- 사용자 cycle: Review → followups queued → 사용자가 각 후속 flow를 별도로 실행
- 자동 실행 안 함 (user/CI 결정)
- `followup_flows`는 `(type, scope_hash)` 기준 dedup 강제. 같은 영역에 같은 type 후속 1개로 통합. Decide-Reviewer가 검증.

### Release CI confirm gate 처리

`gate_policy: confirm: [migration, release]`는 user 입력 가정. CI/A2A에서 user 부재 → 충돌:

| Channel | Confirm gate 처리 |
|---|---|
| user_session | user에 prompt (normal) |
| CI | trigger config의 `pre_approved: bool` 필드. true면 자동 진행. false면 *flow halt* + scheduled retry (다음 user 세션에서 처리) |
| A2A | caller request의 `pre_approved` 필드. true면 자동. false면 INTENT_NOT_COMPLETE 반환 (caller가 결정) |

Config에서 `gate_policy.allow_pre_approval: false`이면 CI/A2A에서 confirm 필수 flow는 항상 halt (보안 정책).

`pre_approved` 우회는 *명시 flow type만* 허용. `gate_policy.allow_pre_approval_flows: [release, migration]` (default) — 다른 flow에 pre_approved 보내도 무시. 보안 risk 최소화.

### External Auth in A2A

Investigate의 외부 리서치 일부가 *auth 필요* (private docs, paid API):

| 상황 | 처리 |
|---|---|
| user_session: auth 필요 | user에 credential 요청 (NEEDS_CONTEXT) |
| A2A: caller가 credential payload에 포함 | 그대로 사용 (provenance: caller-supplied) |
| A2A: credential 없음 | unknown[external_inaccessible: auth] — caller에 알림 (INTENT_INCOMPLETE 가능) |
| CI: secret manager 통합 | 사전 설정 secret 사용 (config 지정) |

Auth 자체는 *Investigate의 책임 아님* — 외부 도구 (WebFetch 등)가 credential 받음. Investigate는 graceful 처리.

### no_op in A2A (caller가 terminal result 원함)

A2A에서 result=no_op:
- Flow halt + Reflect는 동일
- caller에 *terminal result* 반환: `{status: no_op, details: <no_op_details>, suggested_action}`
- caller가 follow-up 결정 (abandon vs reframe)

## Non-Implementation Flow Completion Criteria

Flows without code output (Review, Retro, Exploration, Spike, plan-standalone) complete when their terminal artifact exists and is substantive (GSD verifier Level 1 + Level 2: exists and not stub).

| Flow | Terminal artifact | Completion = |
|------|------------------|--------------|
| Review | `.blazewrit/reports/<flow-id>.md` | Report exists + every finding has severity tag |
| Retro | `.blazewrit/reports/<flow-id>.md` | Report exists + at least 1 action item |
| Exploration | `.blazewrit/reports/<flow-id>.md` | Report exists with content (no minimum structure) |
| Spike | `.blazewrit/reports/<flow-id>.md` | Report exists + feasibility verdict (GO / NO-GO / CONDITIONAL) |
| plan-standalone | `.blazewrit/plans/<flow-id>-plan.md` | design document exists + next step explicitly named |
