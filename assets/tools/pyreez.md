# pyreez Integration Contract

Multi-model deliberation / cross-verification tool.

## Invocation

```
mcp__pyreez__deliberate({
  mode: "options" | "review" | "architecture" | "ideation",
  inputs: {
    question: string,
    context: string,
    candidates?: string[],   # options mode
    artifact?: string,        # review mode
  },
  models?: string[],          # default: project config
  timeout_s?: number          # default 60
})
```

## Output Schema

```yaml
deliberation_id: <uuid>
verdict:
  consensus: agreement | disagreement | mixed
  primary: <model-name>의 응답
  alternatives: [{ model, opinion, rationale }]
provenance:
  models_consulted: [<name>, ...]
  wall_s: <int>
  tokens: <int>
```

## Failure Modes

| Failure | Handling |
|---|---|
| model_unavailable (single model) | degrade — 남은 model로 진행, provenance에 누락 기록 |
| model_unavailable (all) | escalate — `pyreez_unavailable` unknown |
| disagreement (no consensus) | output에 명시 (consensus=disagreement) — caller가 처리 (Verify는 failure_origin=verify 트리거) |
| timeout | partial result 반환 + `partial: true` flag, 또는 escalate |
| rate_limit | exponential backoff 1회 → 실패 시 escalate |

## Trigger Criteria (R5)

cross-verification 강제 호출:
- Decide(Design) — architecture 결정
- Investigate.compatibility_verdict=blocked
- Investigate.risk_surface severity=critical
- Verify (high-risk flows)

자율 호출:
- 5+ affected files
- emberdeck card risk = high/critical
- Explicit caller request

## Degrade Policy

pyreez 미설치 시:
- Decide: agent 단독 결정 (deliberation 없음)
- Verify: internal multi-pass만 (cross-verify 없음, R2 self-misjudgment detection도 약화)
- R5 cross-verify 강제 trigger들 → 경고 + 진행 (단, config `pyreez_required: true`면 halt)

## Timeout / Rate Limit

- Default timeout: 60s per invocation
- Project-level rate limit: `.blazewrit/config.yaml`의 `pyreez.requests_per_hour` (default 50)
- 초과 시 daily budget cycle 적용 (R10과 동일 메커니즘)
