# Reflect — Post-Flow Learning

## Definition

> **Reflect은 flow 종료 후 학습을 추출한다.** Internal multi-pass (reviewer 없음). completion + abandonment에서 실행, suspension에서는 미실행.

## Inputs

- 전체 flow 산출물 (Triage → ... → Verify)
- Verify 결과 (PASS / FAIL / RETRY_EXHAUSTED)
- `.blazewrit/flow-history/` (prior runs)

## Internal Multi-Pass

```
Pass 1: Fact collection — what happened at each step, what results
Pass 2: Pattern extraction — recurring themes, surprises, what worked/failed
Pass 3: Prior learning comparison — read .blazewrit/flow-history/, compare with past
→ max 3 iterations until 4 required sections are substantive
```

## Required Sections (구조 강제)

Every Reflect output must contain (enforced by Reflect structure check hook):

1. **what_worked** — techniques, tools, approaches that succeeded
2. **what_failed** — what didn't work and why
3. **unexpected** — surprises, edge cases, assumptions proven wrong
4. **patterns_discovered** — recurring observations worth tracking

## 3-Tier Progressive Knowledge Distillation

Adopted from Ralph Loop. ACE (arXiv 2510.04618) warns against "brevity bias" and "context collapse".

| Tier | Location | Content | Lifecycle |
|------|----------|---------|-----------|
| **Raw** | `.blazewrit/flow-history/<id>.json` | Full Reflect output | Auto-archived on flow completion/abandonment |
| **Curated** | `.claude/rules/<topic>.md` | Patterns observed 3+ times across flows. Append-only — never rewrite | Promoted from Tier 1 when pattern repeats. Pruned when contradicted |
| **Permanent** | CLAUDE.md (manual) | Battle-tested rules user chooses to enshrine | User decision only. Reflect never writes here |

## Dedup Rule

Tier 2 (`.claude/rules/`) write 전에 Reflect는 기존 rule 파일에서 동일 패턴 검색:
- Found → 기존 파일에 evidence append
- Not found → 새 파일 생성

Never create duplicate rules.

## Reflect 분류

| 분류 | 조건 | Reflect 실행 |
|---|---|---|
| `completed` | 모든 step 정상 종료 | ✓ |
| `abandoned` | blocked / no_op / user abandonment / RETRY_EXHAUSTED | ✓ |
| `suspended` | NEEDS_CONTEXT 또는 active flow preempted | ✗ |

## No Reviewer

Structure check hook (4 sections) + 3-tier distillation filter + append-only로 품질 보장. 별도 reviewer 없음.

## Boundary

| 항목 | 책임 |
|---|---|
| 결정 변경 | Decide (Reflect은 학습만, 결정 안 함) |
| 코드 변경 | Implement |
| Flow-level 검증 | Verify |
| CLAUDE.md 직접 write | User (Reflect은 Tier 2까지만) |
