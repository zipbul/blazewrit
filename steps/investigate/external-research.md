# External Research Policy

외부 리서치는 *수단*이지 *기본*이 아님. claim 단위로 trigger·source·tool·stop criteria 결정.

## Triggers (claim이 외부 진실 의존 시)

- Lib API spec, version compatibility, deprecation status
- 보안 advisory (CVE / GHSA / 벤더 보안 피드)
- License / 컴플라이언스 의무
- 외부 API contract / 벤더 행위 / pricing·quota
- 표준 (RFC / W3C / ISO / IETF) 행위
- Browser·runtime 지원 매트릭스
- Package registry metadata (npm / pypi / crates.io)
- 내부 docs가 외부 source를 인용 → 확인
- 캐시된 내부 사실과 외부 실시간 상태 충돌 의심

## Source Eligibility (trust 등급)

| Trust | Source 유형 |
|---|---|
| **high** | official_current (벤더 canonical URL, 현재 버전), standards_body (RFC/W3C/ISO/IETF), source_code (authoritative), security_advisory (CVE/GHSA) |
| **medium** | official_stale (구버전 official), vendor_changelog, package_registry |
| **low** | community (StackOverflow, 블로그), cached_archive (web.archive.org) |
| **rejected** | generated_seo, expired without alternatives |

generated_seo는 *어떤 경우에도 authoritative 인용 불가*.

## Tool Selection (context-dependent, 고정 우선순위 아님)

| Claim 유형 | 권장 tool 순서 |
|---|---|
| Lib API spec | Context7 (indexed) → WebFetch official docs (verification) |
| Version compat / breaking | WebFetch official changelog/migration guide → package registry |
| CVE / security | WebFetch CVE/GHSA URL → 벤더 security feed |
| Standards behavior | WebFetch 표준 doc (RFC/W3C) |
| Community pattern (last resort) | WebSearch + low trust caveat |
| Freshness 검증 | WebFetch *직접* (cached intermediaries skip) |

## Stop Criteria (고정 budget 아님)

```
sufficient_evidence: claim verified at trust ≥ medium AND no contradictions
diminishing_returns: 3+ sources agree
blocking_failure: source inaccessible OR user input needed
safety_cap:
  per Investigate invocation:
    Migration / Feature / Spike: 60s wall, 30k tokens (liberal)
    Bug Fix Unreproducible / Performance: 40s, 20k
    Bug Fix (general) / Refactor / Test: 20s, 10k (claim-driven override 허용)
    Chore / Release / Review / Retro / Exploration / plan-standalone: 10s, 5k
```

caps는 *default*. 특정 claim이 더 필요 시 (예: simple Bug Fix에 OAuth 표준 확인) Investigate가 명시 rationale로 cap 초과 가능, reviewer 검증.

## Provenance (claim 중요도별, 균일 아님)

| Claim 분류 | Provenance 요구 |
|---|---|
| decision_critical (compatibility issue·risk 결정 근거) | 전체: url + accessed_at + content_hash + source_type + version_snapshot |
| version_sensitive | 전체 |
| conflict_with_internal | 전체 |
| background_context | aggregated: `sources_consulted: [url 목록]`, `primary: url` |

소소한 background claim에 전체 provenance 강제 = mechanical noise. **claim 중요도가 provenance 깊이 결정**.

## Conflict 처리 (외부 vs 내부 사실)

| 충돌 유형 | 규칙 |
|---|---|
| External API fact (lib 변경) vs 내부 캐시 | **external 채택**, conflicts에 기록 |
| 내부 contract/policy/규칙 vs external | **내부 채택** (silent override 금지), conflicts에 owner review용 기록 |
| 소스 권위 모호 | conflicts에 기록, user/Decide 결정 위임 |

**원칙**: 내부 source-of-truth는 owner 결정 없이 silent override 안 됨.

## No-Results 처리 (claim 중요도별)

| Claim 분류 | 처리 |
|---|---|
| decision_critical | compatibility issue 등록 (blocks_flow 또는 requires_user) |
| version_sensitive | risk_surface 항목 + follow-up flag |
| background | 진행, unknown disposition=defer |
| feasibility-critical (Spike) | *negative signal*로 명시 — "no evidence found" 자체가 사실 |

## Failure Recovery

| Failure | 처리 |
|---|---|
| Rate limit | 우선순위 fallback (Context7 한도 → WebFetch → WebSearch caveat) |
| Network error | 1 재시도 → unknown[external_inaccessible] |
| Auth required (private docs) | unknown[external_inaccessible: auth] → escalate or skip |
| Paywall | unknown[external_inaccessible: paywall] |
| 모든 source 실패 | claim 중요도별 No-Results 처리 |

## A2A External Auth

A2A 채널에서 외부 리서치 일부가 *auth 필요* (private docs, paid API):

| 상황 | 처리 |
|---|---|
| user_session: auth 필요 | user에 credential 요청 (NEEDS_CONTEXT) |
| A2A: caller가 credential payload에 포함 | 그대로 사용 (provenance: caller-supplied) |
| A2A: credential 없음 | unknown[external_inaccessible: auth] — caller에 알림 (INTENT_INCOMPLETE 가능) |
| CI: secret manager 통합 | 사전 설정 secret 사용 (config 지정) |

Auth 자체는 *Investigate의 책임 아님* — 외부 도구 (WebFetch 등)가 credential 받음. Investigate는 graceful 처리.
