# Feature Flow

Analyze(impact scope, card query, blockers, feasibility) → 기획 → Spec → [Test ⇄ Implement]* → Verify → Reflect

## Steps

```yaml
steps:
  - name: analyze
    depth: thorough
    reviewer: analyze-reviewer

  - name: 기획
    reviewer: 기획-reviewer

  - name: spec
    reviewer: spec-reviewer

  - name: test
    reviewer: test-reviewer
    loop_with: implement

  - name: implement
    reviewer: implement-reviewer
    isolation: worktree

  - name: verify
    on_fail: route_to_origin
    max_failures: 3

  - name: reflect
```

## Analyze Depth: Thorough

Trace all imports and transitive dependencies. Map impact scope across modules. Check test coverage of affected areas. Query emberdeck for related cards.

## Loop: Test ⇄ Implement

Test and Implement may cycle when implementation reveals need for additional tests, or new tests reveal implementation gaps.

## Worktree

Implement runs in a git worktree. Merge to main only on Verify PASS. On Verify FAIL, fix in the same worktree.

## Verify Failure Routing

| failure_origin | Action |
|----------------|--------|
| analyze | Re-analyze with broader scope |
| 기획 | Revise 기획서 for the identified gap |
| spec | Update AC or code architecture |
| test | Add missing test coverage |
| implement | Fix implementation to match spec |

## Gate Policy

Default: `auto`. Override in `.blazewrit/config.yaml`.
