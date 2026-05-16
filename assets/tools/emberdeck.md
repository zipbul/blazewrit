# emberdeck Integration Contract

Unified project knowledge graph (code + cards + links). MCP-queryable, incremental.

## Graph Schema

```
Node types: intent_card | spec_card | code_module | file | symbol | external_ref
Edge types: implements | references | depends_on | similar_to (with confidence)
Confidence levels: certain | inferred | ambiguous
```

## Invocations

### query_graph

```
mcp__emberdeck__query_graph({
  entry: string | string[],        # symbol name, file path, card id
  depth: number,                    # default 2
  edge_filter?: string[],           # edge types
  scope_hint?: string,              # monorepo package
  token_budget?: number             # default 5k (shallow), 20k (deep)
})
```

Output:
```yaml
subgraph:
  nodes: [{ id, type, label, confidence }]
  edges: [{ from, to, type, confidence }]
freshness:
  ed_snapshot_version: <hash>
  generated_at: <timestamp>
  stale?: boolean                  # ED snapshot이 git_HEAD보다 오래됨
```

### get_card_context

```
mcp__emberdeck__get_card_context({ card_id: string })
```

Output: card metadata + codeLinks + history.

### create_card

```
mcp__emberdeck__create_card({
  type: "intent" | "spec",
  title: string,
  body: string,
  links?: { code?: string[], requires?: string[] }
})
```

### validate_code_links

```
mcp__emberdeck__validate_code_links({ card_id: string })
```

Output: `{ drift: 0 | <n>, mismatches: [...] }`

### regression_guard

```
mcp__emberdeck__regression_guard({ threshold: 0 })
```

Output: `{ pass: bool, drift_total: <int>, regressions: [...] }`

### pre_change_check

```
mcp__emberdeck__pre_change_check({ files: string[] })
```

영향 카드 surface, 변경 위험 평가.

### write_spec_annotations

```
mcp__emberdeck__write_spec_annotations({ files: [...] })
```

코드 ↔ spec card 양방향 link write.

## Freshness Metadata

모든 query 응답에 freshness 필드:
- `ed_snapshot_version`: ED graph snapshot의 hash (incremental update 추적)
- `git_HEAD`: 비교 baseline
- `stale: true` if `ed_snapshot_version` < current `git_HEAD` (ED 갱신 누락)

Ground/Investigate가 stale 감지 시 → ED rebuild 트리거 또는 unknown[ed_stale] disposition.

## Failure Modes

| Failure | Handling |
|---|---|
| ED graph empty (referent_unresolved) | unknown[referent_unresolved] — clarification disposition 권장 |
| stale snapshot | retry with rebuild, cap=1; 초과 시 failure_origin=ground |
| ambiguous edges | unknown[ambiguous_edge] — risk disposition |
| timeout | partial subgraph + provenance에 partial 기록 |
| MCP server unavailable | escalate — `emberdeck_unavailable` unknown |

## Trigger Points

- **Ground**: `query_graph` (subgraph) — 모든 flow
- **Investigate**: `get_card_context`, `pre_change_check`
- **Decide(Design)**: `create_card` (intent)
- **Spec**: `create_card` (spec) + codeLinks
- **Implement**: `validate_code_links`, `write_spec_annotations`
- **Verify**: `regression_guard` (drift=0 강제)

## Degrade Policy

emberdeck 미설치 시:
- code-only analysis (그래프 없음)
- text-only plans (intent card 없음)
- no drift check (Verify는 typecheck + test로 대체)
- emberdeck-conditional 기능 (codeLinks, regression_guard) 모두 disabled
- ED graph 의존 unknown disposition rule들 비활성

## Project Config

`.blazewrit/config.yaml`:

```yaml
emberdeck:
  graph_path: ".emberdeck/graph.db"
  freshness_threshold_s: 3600       # 1h 후 stale 간주
```
