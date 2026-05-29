# firebat Integration Contract

Code quality scanner. firebat 의 책임은 *code quality issues* (compile errors, lint warnings, security smells).

## Invocation

```
mcp__firebat__scan({
  path: string | string[],
  mode: "baseline" | "incremental" | "full",
  expandAffected?: boolean,    # transitive dependents
  severity_threshold?: "error" | "warning" | "info"
})
```

## Output Schema

```yaml
scan_id: <uuid>
results:
  - file: <path>
    line: <int>
    severity: error | warning | info
    rule_id: <string>
    message: <string>
    suggested_fix?: <string>
summary:
  blockers: <int>     # severity=error count
  warnings: <int>
  info: <int>
provenance:
  wall_s: <int>
  files_scanned: <int>
```

## Severity Semantics

| Severity | Meaning | blazewrit handling |
|---|---|---|
| **error** (blocker) | bad code ships — type error, null deref, security smell, broken build | Implement 단계 hook (PostToolUse Edit/Write)가 자동 block. Verify에선 `blockers > 0` → FAIL |
| warning | task-related fix 권장, 무관 시 skip 가능 | Implement reviewer가 task scope 판단 |
| info | 개선 제안 | 기록만, 자동 action 없음 |

## Exit Code Semantics

- 0: scan succeeded, blockers=0
- 1: scan succeeded, blockers>0
- 2: scan failed (tool error, not code quality)

## Failure Modes

| Failure | Handling |
|---|---|
| tool_error (exit 2) | escalate — `firebat_unavailable` unknown |
| timeout | partial 결과 사용 + provenance에 partial flag |
| 잘못된 path | warning + 무시 |

## Trigger Points

- **PostToolUse(Edit|Write)** in Implement — incremental scan changed files (hook 자동)
- **PreToolUse(Bash(git commit*))** — regression_guard
- **Verify** — full scan
- **Migration flow Investigate** — query-dependencies (compat matrix)

## expandAffected Semantics

`expandAffected: true` — 변경 파일의 *transitive dependent*도 스캔 (ED graph 기반). false면 직접 변경만.

## Degrade Policy

firebat 미설치 시:
- typecheck + test만 (lint scan 없음)
- regression_guard hook 비활성
- Verify의 `blockers > 0` check 대신 `typecheck + test pass`로 fallback
- Implement에서 PostToolUse scan hook 비활성

## Project Config

`.blazewrit/config.yaml`:

```yaml
firebat:
  rules_path: ".firebat/rules/"
  severity_overrides:
    "no-unused-vars": info       # downgrade to info
```
