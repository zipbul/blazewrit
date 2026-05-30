# Harness Flow — Design Conformance Review

> 재검증 (이전 "완벽" 단언 불신). 방법: 적대적 워크플로 3회(96+22 agent) + 수동 소스 자기검증 + per-step 적합성(평가자 11 + 적대검증자 11). 대상: `legacy/flows/`, `legacy/.blazewrit/flows/*.md`, `legacy/steps/*/`, `legacy/assets/agents/*.md`, `legacy/WORKFLOW_PLAN.md`(R1–R36).
> 작성 2026-05-30. **이 문서는 설계 검토 기록이다 — 변경 실행 아님.**

## 평가 기준 (사용자)
- **A 커버** — 바이브코딩 대부분 상황을 커버하는가
- **B 견고·체계** — 과정이 견고(실패 내성)하고 체계적인가
- **C 최고결과** — 실제 품질에 기여(ceremony 아님)하는가

## 적합성 매트릭스

| 스텝 | A 커버 | B 견고 | C 결과 | 적대검증 |
|---|:--:|:--:|:--:|---|
| triage | 🟠 | ✅ | ✅ | 동의 |
| ground | ✅ | ✅ | 🟠 | 동의 (단 포맷 계약 깨짐이 B도 약화) |
| **investigate** | ✅ | ✅ | ✅ | 동의 |
| **decide** | ✅ | ✅ | ✅ | 동의 |
| spec | 🟠 | 🟠 | ✅ | 동의 |
| test | 🟠 | 🟠 | ✅ | 동의 (A 일부는 라우팅으로 해소) |
| **implement** | ✅ | ✅ | ✅ | 동의 |
| report | ✅ | 🟠 | ✅ | 동의 |
| verify | ✅ | 🟠 | ✅ | **이견** — 평가자가 과함, 갭은 더 좁음 |
| reflect | ✅ | 🟠 | 🟠 | **이견** — C/B 일부 과함(학습 소비경로는 존재) |
| FLOW 조합 | ✅ | 🟠 | ✅ | 동의 (B는 맞으나 근거는 P0 divergence가 정확) |

**🔴 fail = 0. 완전부합 3 (investigate/decide/implement). partial 8.** → 깨지진 않았으나 부분 부합.

## 문제 있는 스텝 — 견고성(B) 갭 (핵심)

| 스텝/흐름 | 결함 | 증거 |
|---|---|---|
| **ground** | **포맷 계약 3중 모순** — README는 YAML, `agents/ground.md`는 HTML5 출력, completion 토큰은 `.md`. reviewer의 YAML 정규식(R22 `value=null`, R23 bare-integer, R24 `cove_log:`)이 HTML(`<td>16</td>`, `data-section="cove_log"`)에 **오발** → 실제 산출물을 기계 강제 못 함 | `agents/ground.md:25,300` vs `ground-reviewer.md:38,44,45` |
| **spec** | **실패모드 미설계** — 상충/불충족 정책, 누락 upstream artifact, Plan/Record 모드 decide 출력(README Inputs가 받겠다 약속)에 정의된 동작 없음 | `spec.md` prompt이 Plan/Record decide 소비 불가 |
| **test** | **내부 모순** — L20은 `[UNVERIFIED]` 허용, L40 self-validation은 "No [UNVERIFIED]" 요구. + "Bug Fix Unreproducible hypothesis" 입력에 동작 정의 없음(orphan) | `agents/test.md:20` vs `:40` |
| **report** | **스키마/게이트 자기모순** — README/agent는 `evidence_ref`·content-over-form·`[UNVERIFIED]` 허용, reviewer는 finding당 `verify_probe` 누락(R20#10)과 `[UNVERIFIED]`(#3)에 **hard-FAIL** | `report-reviewer.md` |
| **verify** | **tool-degrade 정책 부재** — Pass1(firebat blockers=0, emberdeck drift=0)·Pass4(pyreez)가 MCP에 hard-depend, 부재 시 fallback 없음 → **바로 그 degraded 조건에서 PASS/FAIL 미정의** (적대검증: 갭은 좁음 — verify.md/README가 tool 계약을 *전혀 cross-ref 안 함*) | `verify.md` Pass1/4 |
| **reflect** | **강제가 비차단·LLM 재량** — structure hook은 로그만, reflect는 validator/reviewer retry 면제, "3+ 반복 패턴" 승격이 LLM 판단 (적대검증: 학습 소비경로 Tier2→`.claude/rules`는 *존재* → 품질 약점은 *강제 부재*지 *루프 부재* 아님) | `hookReflectStructure` |
| **FLOW 조합** | **이중 source-of-truth** — `flows/README.md` 사람용 체인 vs `.blazewrit/flows/*.md` 정의(R16이 검증하는 대상)가 드리프트 가능. R16이 추가된 이유 자체가 과거 next-step 모순. 적대검증이 **P0에서 실제 divergence 입증**(Test-retroactive 위치) | R16, P0 chain |

## 문제 있는 스텝 — 커버리지(A) 갭

| 스텝 | 결함 |
|---|---|
| **triage** | 바이브코딩의 *지배적 루프*(명료화 Ask-cycle + None↔Flow 전환)를 **orchestrator/host-LLM으로 위임** — README 143-150에 정의는 됨(적대검증: "undefined" 아님)이나 **step pool의 1급 flow가 아님.** 대화형 반복이 후순위 |
| **spec/test** | non-code/docs/config/exploratory를 partial 커버 (적대검증: chore/exploration이 Test 스킵 = 라우팅으로 부분 해소). 단 test의 "unreproducible hypothesis" 입력은 무정의 = 실 갭 |

## 문제 있는 스텝 — 결과품질(C) 갭

| 스텝 | 결함 |
|---|---|
| **ground** | format ceremony (HTML 전환 후 mechanical 검증 약화) |
| **reflect** | LLM 재량 강제 (위 B 참조) |

## 완전부합이나 noted (minor)

| 스텝 | minor |
|---|---|
| investigate | Ground-deepen 왕복에 cycle cap/fallback 부재 (cap=1은 stale-ED 경로만) — 지속적 Ground 부족 시 무한 round-trip 가능 |
| decide | **Record 모드 ceremony-budget 불일치** — "자명 1줄 결정"에 verification_proof(R26)·cove_log(R24)·R23 count-wrap 강제하면서 budget은 wall 10s/1k tokens |
| implement | Self-Validation이 "All tests pass GREEN" 주장하나 **mechanical 실행수단 없음**(Verify로 이관). Decide-only 체인(Chore/Spike/P0, Test 없음)에선 GREEN 주장 근거 약함 |

## 문제 있는 구체 FLOW

| Flow | 노출되는 결함 |
|---|---|
| **bugfix-p0** | 이중 source-of-truth divergence(Test-retroactive) + implement GREEN 근거 약함(Test 없음) |
| **bugfix-unreproducible** | Test에 hypothesis 입력 무정의 |
| **chore / spike / release** (Decide-only/Record) | implement GREEN 근거 약함 + Record ceremony-budget 불일치 |
| **exploration / review / retro** (non-code) | test/spec 커버 partial (라우팅으로 부분 해소) |
| **전 flow 공통** | ground HTML/YAML 계약 모순 · verify tool-degrade 부재 |

## 3대 테마 (갭 수렴점)
1. **대화형 루프 = 후순위** — 바이브코딩의 반복·명료화가 step pool 밖 orchestrator glue. (기준 A)
2. **실패/계약 견고성** — 포맷 3중 모순, tool-degrade 부재, spec/test 실패모드 미설계, test/report 내부 모순, 이중 source-of-truth. (기준 B — 가장 약함)
3. **LLM 자율강제** — R1–R36 다수 + reflect가 prose 자기감시(설계 자기문서가 R13/R27/R30에서 "prompt-only 실패"를 실사례로 자백). 기계 게이트는 ~R27/R30뿐. (기준 C)

## 종합
**"완벽"은 틀렸다. 0개 fail이므로 기반은 견고하고 살릴 가치 있다. 균열은 위 3 테마, 특히 기준 B(견고성)에 집중.** partial 8개가 정확한 보강 지점.

## 저장 모델 — 워크플로 산출물은 파일이 아니다 (Postgres 확정 귀결, DECISIONS §5)

Postgres 단일 DB 확정 시점에서 **워크플로가 생성하는 산출물을 파일로 저장할 이유가 없다.** 오히려 *파일이라서* 결함이 생긴다:
- ground 포맷 3중모순(HTML/YAML/.md) = `.blazewrit/grounds/*.html` 파일로 산출하니까 생긴 문제. step_runs row면 모순 자체가 없음.
- flow-state.json = non-atomic·silent-loss (legacy file-first 잔재).

**규칙: step 산출물·상태·전 출력은 Postgres(step_runs/events). 파일은 ① Claude Code가 읽는 입력(`.claude/rules` 학습·CLAUDE.md) ② git이 버전하는 코드, 딱 둘.** 데이터마다 집 하나(이중 source-of-truth 금지 — 위 FLOW-COMPOSITION 갭과 동일 원리).

→ 하네스 재구현 시: `.blazewrit/*.html` 산출 폐기, step 결과를 Postgres에 직접 기록. 이게 요구 A(UI 1:1 거울)/B(제3자 디버깅)의 전제이기도 함.

## 정직한 한계
- 이건 *설계 문서* 검토다 — *런타임 동작*은 미검(하네스 미구현).
- design-critique를 strict schema에 못 담아 1차 워크플로(coverage/structure/robustness 차원)는 StructuredOutput 실패로 손실 → 수동 자기검증으로 보강. per-step(이 문서)이 권위 소스.
- 적대검증이 verify/reflect 평가를 *좁힘* — 위 표에 반영.
