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

## 견고성 갭 보강 설계 (갭별 적대 검증 완료 — 14 agent)

> 초안 가설("structured_output이 4갭을 닫는다")은 **과했다.** 검증 교정: grammar는 *SHAPE*만 닫고 *TRUTH/prose-judgment*는 못 닫음. 7갭 → **4 메커니즘 + 환원불가 residual.**

### M1 — structured_output (grammar) = SHAPE 강제
모델이 *틀린 모양·누락 필드·잘못된 enum*을 token 생성 자체 못 함(§16). 리뷰어의 shape 검사 → schema 검증.
→ G1(포맷 드리프트), G3/G4/G6(필드·구조 존재) 의 **shape 부분** 닫음.

### M2 — deterministic 코드 validator (R27/R30 류) = grammar가 못 닿는 TRUTH/일관성
- **G1**: `source.raw_stdout` 재파싱 → `value`가 거기서 *도출 가능*한지 단언 (value↔stdout 일관성). **필수**(옵션 아님 — 안 하면 "count 신뢰"는 거짓).
- **G4**: `verify_probe` 재실행 → expected_result 대조 (self-assert 아닌 truth).
- **G5**: MCP 가용성을 *코드로 probe* (하네스가 attached mcpServers 앎) → fact 주입.

### M3 — degraded/failure 경로를 *schema 분기*로 (핵심 통합)
실패/부재를 placeholder 구멍이 아니라 **1급 schema 분기**로 → grammar 강제(기계), prose 아님.
- **G1 degrade**: `{measured:{value,source}} | {omitted:{reason}}` — R22 placeholder 문제 + over-typing 리스크 동시 제거.
- **G2 spec**: `result: proceed | blocked | needs_clarification | no_op` enum + orchestrator 라우팅 테이블 (**Investigate의 compatibility-verdict V1-V13 패턴 재사용** — 새 계약 발명 금지).
- **G5 verify**: RESULT enum에 `degraded_pass | blocked` 추가 + `tool_status` 분기.

### M4 — flow 정의 단일 machine source + 문서 build-생성
- **G7**: `.blazewrit/flows/*.md`(또는 구조화 def)가 **THE 단일 source**, README 체인은 *생성*(build step), R16이 단일 source에 검증. (드리프트 입증: README는 P0에 Test-retroactive를 체인 IN, .blazewrit YAML엔 없음.)

### 갭별 매핑
| 갭 | 메커니즘 | 닫힘 | 잔여 |
|---|---|:--:|---|
| G1 ground 포맷 | M1+M2+M3 | ✅ | raw_stdout *조작*, boundary-prose |
| G3 test [UNVERIFIED] | M1 + **극성 교정** | 🟠→ | unverified *값* 진실성 |
| G4 report 게이트 | M1+M2 | 🟠→ | unverified self-assert |
| G6 reflect 구조 | M1 + substance floor(minLength/no-filler) | 🟠→ | promotion-count 판단 |
| G2 spec 실패모드 | M3 (result enum + 라우팅) | 🟠→✅ | — |
| G5 verify degrade | M2+M3 (probe + enum) | 🟠→✅ | — |
| G7 이중 SoT | M4 | 🟠→✅ | — |

### 교정 (검증이 내 초안을 고침)
- **G3 극성**: 모순을 *금지* 방향이 아니라 **유지** 방향으로 — `enforcement.md L41`이 authoritative("[UNVERIFIED]는 *설계상 persist*"). → `unverified` 구조화 필드 유지+propagate, `test.md L40 "No [UNVERIFIED] remain"` 삭제, **Verify가 단일 게이트**. (초안의 "forbid"는 틀림.)
- **G2**: 새 계약 발명 말고 *기존 compatibility-verdict 패턴 재사용*.
- **G5**: config policy(prose) 아니라 *코드 probe + schema enum*(§16 강한 레이어).

### 환원불가 residual (어떤 메커니즘도 못 닫음 — 정직한 바닥)
1. **self-asserted truth** — 할루시네이션에 `unverified:false`, 조작된 raw_stdout에 맞춘 `value`. grammar/schema는 *존재*만 강제 *진실*은 아님. 코드 validator(재실행/재파싱)가 일부 커버하나 전부는 못 함.
2. **semantic boundary-prose** — R15/R18 "conflicts에 비교/도출 금지" = free-text 판단. string 필드 안의 "sources consistent"를 grammar가 못 막음.
→ 완화 = high-stakes에 **cross-verification(다모델/pyreez) + R30 re-execute(replayable한 것)**. *제거 아님*. §16이 함의하는 동일 바닥.

### 결론
**4 메커니즘이 SHAPE+DEGRADE+TRUTH(replayable)+SoT를 기계적으로 닫는다. 잔여(self-assert truth + semantic-prose)는 환원불가 LLM 판단 — cross-verification으로 완화하되 제거 못 함.** 핵심 패턴: **실패/부재를 schema 분기로, prose 룰을 코드 validator로** = 네 §16 결정의 정확한 적용.

## 플로우-셋 최적성 (갭별 적대 검증 완료 — 10 agent)

> 검증이 **내 제안 5개 중 4개를 수정/1개를 기각.** 두 가지 standing 가정을 *file 증거로 뒤집음.*

| 제안 | 판정 | 핵심 |
|---|:--:|---|
| **P1 greenfield 추가** | 🟠 **채택+수정** | 진짜 distinct (16과 precondition 상호배타 — 빈 레포는 needs_clarification에서 *Decide 전 기계적 halt*). "첫 플로우" 갭 충족 |
| **P2 micro-flow 추가** | 🔴 **기각** | **이미 있음** — chore + Adaptive Step Depth Policy가 fast-path |
| **P3 bugfix×3 → bugfix(variant)** | 🟠 **채택+수정** | p0/unreproducible 체인 byte-identical → 통합. 단 P0의 *mandatory retroactive test* 보존 필수 |
| **P4 flows = chain-shape × 파라미터** | 🟠 **채택+수정** | orchestrator executor가 *이미 generic*(StepDef[] zero per-flow branching) → 16 .md는 순수 data. 단 파라미터 축 under-spec |
| **P5 coverage sweep** | 🟠 수정 | 11 후보 중 **data-migration만** 진짜 distinct+in-scope. 나머지(deployment/multi-repo 등)는 over-granularity, 추가 금지 |

### 🔴 검증이 뒤집은 내 가정 2개 (정직)
1. **"micro-flow 필요(theme① flow-weight 미해결)" = 틀림.** trivial fast-path가 *이미 존재* — `chore`(="Trivial change, Minimal pipeline") + **Adaptive Step Depth Policy**(모든 step default shallow, mechanical trigger 시만 deepen). "9-step 비용"은 *날조* — 9-step flow 없음(chore=6, shallow). 싼 반복은 *새 flow가 아니라 depth 변조*에서. micro-flow는 over-engineering이고 Ground 삭제 시 Verify baseline 계약 깨짐. → **§14의 "trivial→micro-flow 미해결" 노트 철회.**
2. **"16 flow가 over-granular면서 동시에 under-cover" 중 — 실제는 over-granular가 맞고 under-cover는 greenfield 하나뿐.** 대부분 상황은 기존 flow가 잘 서빙. 갭은 *커버리지 부족이 아니라 granularity 과다.*

### greenfield 추가 — 정확한 형태 (검증 교정 반영)
- **체인**: Ground(greenfield profile) → Decide(Design) → Spec → Implement → Verify → Reflect. (Investigate degenerate — Activity 1만 비고 2~6은 유효)
- **교정1**: Ground는 *factual 유지* (git-init 상태, toolchain/runtime 버전, template 유무 캡처, "no existing code"를 dominant unknown으로). **스택/아키텍처 선택은 Decide(Design) 일** — 내 제안이 Decide 일을 Ground에 누출.
- **교정2 (필수)**: unknown-disposition 매트릭스 *override* — `referent_unresolved → defer`(아니면 needs_clarification에서 Decide 전 halt).
- **교정3**: Triage에 greenfield **entry + exit 기준** (언제 greenfield→feature: 첫 커밋? 첫 passing test?). Signal Table에 greenfield row 추가.

### 결론 — 플로우-셋은 *늘리는 게 아니라 줄이는* 방향
**16 → ~14** (bugfix×3→1 통합, exploration/plan-standalone을 shape variant로 인식) **+ greenfield 1** + (검토 후) data-migration?. **커버리지는 충분, granularity가 과했다.** 핵심: **flows = 소수 chain-shape × 파라미터 테이블** (executor가 이미 generic) → M4(dual-SoT) 드리프트 표면 동시 축소.

## R1~R36 prose 룰 정리 (9 클러스터 적대 검증 완료 — 18 agent)

> 36개 prose 룰은 *텍스트 출력이라서 생긴 패치*가 다수. M1(grammar)+M2(코드 validator)+M3(분기)로 가면 schema 필드가 되거나 코드로 승격되거나 *소멸*. **9 클러스터 전부 "대체로 견고"+적대 전원 동의+결함 0.** 단 일관된 교정 하나가 관통: 내가 "삭제/흡수"로 본 룰 다수가 *순수 흡수가 아니라 SPLIT* — {SHAPE→M1} + {enforcement→M2 유지}. **삭제가 안전한 건 enforcement가 사라져서가 아니라 R27 `validateArtifact()`/R30 re-execute 코드에 이미 물리적으로 존재하기 때문** (예: R16 체인검사가 R27 본문 L1005-1008에 inline). → **DELETE 버킷은 내 초안보다 작다.**

### 최종 규칙별 disposition (36 → 6 메커니즘 home + 소수 삭제/강등)
| disposition | 규칙 | 의미 |
|---|---|---|
| **M1 schema 기반** | R1 | step별 JSON Schema = grammar 기반 (SHAPE) |
| **M1 필드만 (prose 삭제)** | R2(enum), R34(ADR), R35(dep_graph) | shape를 grammar가 강제 → standalone 룰 삭제 |
| **M1 필드 + M2 validator (SPLIT·둘 다 유지)** | R13(unverified+극성), R19/R33(task_list+상호배타), R20(verify_probe+실행), R29(exec_meta+pid≠pid/timestamp), R36(source_manifest+sha256/인용 대조) | 필드는 grammar, 진실성/실행/일관성은 코드 — *prose만 삭제, validator 유지* |
| **M1 count TYPE (흡수자)** | R23 | 모든 count = `{value, source:{command,raw_stdout}}` 타입 → bare integer 생성 불가. *아래 텍스트-패치들을 흡수* |
| **M2 코드 validator (진짜 prevention·코드 유지)** | R27(validator hook 컨테이너·R16 흡수), R30(re-execute/replay), R6(decide mode force), R15(boundary regex), R17(재실행/재해시 TRUTH), R21(count 교차검증), R26(provenance 검사), R32(derived-command 검사) | grammar가 못 닿는 TRUTH/일관성. self-attest 불신, orchestrator가 독립 replay |
| **M2 — R27에 흡수(fold)** | R16 | 체인검사가 R27 본문에 이미 inline. `expected_next_step` 주입 인터페이스만 산다. (R16≠M4 — M4는 R16이 *검증하는 대상*인 단일 SoT 아키텍처) |
| **M3 degrade-분기 (tool-부재 부분만)** | R12(failure_modes→분기+M4 enum 태그), R14(fail-loud→result enum 분기), R22(omission→`{measured}\|{omitted}` + partial-omission validator) | 실패/부재를 1급 schema 분기로. prose 전체 삭제 금지 — M2 부분 유지 |
| **🔴 DELETE (count TYPE가 진짜 흡수)** | R28(word-integer), R18-강화(numeric-in-conflicts), R21-format부분 | 순수 prose-scan regex 패치 — 타입화로 소멸. *enforcement 손실 없음* |
| **🟠 DEMOTE (LLM이 자기검증 — 설계 스스로 약하다 인정)** | R24(CoVe), R25(double-run), R31(all-PASS 휴리스틱) | load-bearing prevention 아님. 진짜는 R30 코드 re-execute. cove_log는 옵션 구조로만 |
| **자원/상태 governor 코드 (유지·별 카테고리)** | R3(flow caps), R4(nesting cap), R10(research budget), R11(stale-on-resume) | 순수 산술/비교. KEEP하되 *할루시네이션 enforcement와 혼동 금지* |
| **observability/capability (유지·enforcement서 분리)** | R7(triage 정확도 metrics), R8(parallel capability), R9(learning loop) | 측정/역량 — 룰이 아님 |
| **환원불가 floor (못 닫음·cross-verify로 완화)** | R5(pyreez cross-verify=완화 메커니즘), R18-semantic 잔여(conflicts 비교어 판단), R26-paraphrase 잔여 | self-asserted truth + semantic boundary-prose. *제거 아닌 완화* |

### 🔴 검증이 좁힌 내 초안 (정직)
1. **DELETE는 3개뿐** (R28, R18-강화, R21-format) — 내가 ~6개 삭제로 봤으나 R21(count 교차검증)·R32(derived-cmd 검사)는 *M2로 살아남음*. enforcement는 소멸이 아니라 *R27/R30 코드로 이전*.
2. **환원불가 floor는 내 주장보다 작다** — R15(순수 regex)·R18 god_node/meta-verb 검사는 M2(닫힘). floor에 남는 건 R5 cross-verify + R18 conflicts-비교어 + R26 paraphrase 잔여뿐.
3. **R16≠M4, R29≠self-verify** — R16은 M2(R27 흡수), R29는 M1+M2(pid≠pid validator). 라벨 교정.
4. **governor(R3/R4/R10/R11)는 anti-hallucination M-메커니즘과 다른 카테고리** — 같이 묶지 말 것.

### 결론 — prose 타워 붕괴
**36 prose 룰 → 실제 home은 6개**: M1 schema·M1 count-type·M2 validator(R27/R30 컨테이너)·M3 분기·M4 단일SoT·환원불가 floor. **삭제 3 / 강등 3 / governor 4 + observability 3은 유지하되 "할루시네이션 enforcement"에서 분리.** 핵심: *대부분의 R-룰은 자기 자리가 schema 필드 아니면 R27/R30 코드 본문이고, prose 문장은 거기 이미 있는 enforcement의 그림자였다.* = §16(grammar+코드가 진짜 레이어)의 정확한 귀결.

## 정직한 한계
- 이건 *설계 문서* 검토다 — *런타임 동작*은 미검(하네스 미구현).
- design-critique를 strict schema에 못 담아 1차 워크플로(coverage/structure/robustness 차원)는 StructuredOutput 실패로 손실 → 수동 자기검증으로 보강. per-step(이 문서)이 권위 소스.
- 적대검증이 verify/reflect 평가를 *좁힘* — 위 표에 반영.
