# blazewrit 핸드오프 — 현재 상황 (2026-07-25)

> 잡 그래프 오케스트레이션 레이어의 완전한 인수인계. 이 문서 하나로 이어받을 수 있게 작성. 동결 설계는 `harness/job-graph.md`(규칙 1~9, 8테이블), 진행 이력은 auto-memory `blazewrit-job-graph-progress.md`, 아키텍처 판정은 `blazewrit-arch-topology-verdict.md`.

**HEAD: `100d516`** (main, origin와 동기화됨). 워킹트리 클린(유일 미추적 `apps/fe/public/blaze-sample.html`은 FE 샘플, 무관).

---

## 0. 한 줄 요약

멀티레포 에이전트 플랫폼의 **잡 그래프 오케스트레이션 레이어가 완성·검증됨**. 마이그레이션 1~11 + P1~P4 + 단일기록자 리팩터 + 카오스 시뮬 자산까지. **동작·안전·최적성 3자 검증 완료.** 남은 건 (1)재실행 트리거 배선 (2)P5 UI (3)규모 커지면 "눈 넓히기". 자율모드는 기본 OFF(안전).

---

## 1. 아키텍처 (실코드 기준, 검증됨)

**토폴로지 = 레포 주권 + A2A 협상 + 중앙 사실 DB + 결정론 reconcile.** 2026-07-24 4갈래 검증(리서치+Codex+Grok+Claude)에서 **이 문제(1-cwd 물리제약·인간=결정만·크로스레포 태스크)에 최적** 판정. 대안(계층/블랙보드/마켓/코레오그래피) 전부 1-cwd에서 짐.

| 주체 | 역할 | 파일 |
|---|---|---|
| **똘이(중앙 triage)** | 인간 의도 접수·분류·타깃 레포 라우팅. jobs/tasks 직접 안 씀(비주권) | `triage/`, `dispatchTask`(rest.ts:~1017) |
| **레포별 wake 세션** | 깨어난 레포 에이전트가 MCP 툴로 **자기 슬라이스만** 관리 | `graph/wake-session.ts`(actorRepoId 바인딩) |
| **reconcile 컨트롤러** | 결정론 기계(에이전트 아님) — ready→running 원자 claim, lease, dep release, wake 발화, **job_events 소비=유일 상태 기록자** | `graph/controller.ts`(tick), `graph/reconcile.ts`(reconcileTask/consumeJobEvents/consumeOneEvent) |
| **write ACL** | 남의 레포 잡 쓰면 `WriteAclError` | `graph/store.ts` |

**MCP 그래프 툴(7종, wake 세션에만 주입)**: `graph/agent-tools.ts` — job_add / dep_declare / dep_retract / task_seal / task_unseal / a2a_request / **graph_read**(읽기, 태스크 전역·크로스레포). 상태전이 툴 없음(done/failed=실행결과, ready=reconcile만). repo_id는 ctx 바인딩(스푸핑 불가).

**wake 세션 보안**: `tools:[]`(내장 Bash/Write 차단) + `allowedTools:[7 graph FQN]` + `permissionMode:'dontAsk'` + **`settingSources:[]`**(레포 훅 셸실행 차단 — 플랫폼 에이전트 격리, triage와 동일).

---

## 2. 데이터 모델 핵심 (`infra/schema.ts`)

- **8테이블**: products / repos / tasks / task_seals / jobs / deps / dep_members / external_gates.
- **job_events**(append-only, PK `(job_id, generation, kind)`, kind∈succeeded/failed/rerun_requested, processed_at nullable, 부분유니크 `one_terminal`): **실행 완료 = 사실 기록**. `consumeOneEvent`가 이벤트별 단일 tx로 processed_at 선점 claim→jobs CAS→work_items 파생. **상태 쓰기는 reconcile 한 곳만.**
- **재실행 = 제자리 gen++**(불변 이벤트소싱 아님 — C2 이중진실스큐 회피). `rerun_requested` 이벤트→consumeOneEvent가 **tasks FOR UPDATE→open 재검증→jobs→gen++**(규칙9 방어선).
- **task_seals**: 레포별 종료 선언(주체 컬럼 없음 — seal=레포 사실). 인간의 에이전트-불가역 브레이크는 seal이 아니라 **cancel**(규칙9 terminal latch).
- **repos.autonomy**(boolean, default false): per-repo 자율모드. `PATCH /api/repos/:id/autonomy`로 토글(P5 UI 백엔드). wake-consumer가 wake마다 fresh 조회.
- **락 순서 통일**: 모든 FOR UPDATE가 tasks→jobs(store/negotiation/reconcile). 역전 쌍 없음.

---

## 3. 완료된 것 (커밋 히스토리)

마이그레이션 1~11, P1(스키마+상태기계), P2(reconcile 컨트롤러), P3(A2A 협상+external_gates), **P4-1**(그래프 MCP 툴 a120b50), **P4-2a**(wake 세션 실행기 bd72c13), **P4-2b**(실행 클로저 DB 재구성=F-E1 좀비 근본해결 3c4e20e), **P4-2c**(wake 트리거 배선, 자율 게이트 OFF 1392b64), **graph_read**(76329aa+44b2974), **단일기록자 통합**(P1 5232d84 / P2+P3 fa7668b), **카오스 시뮬 자산**(241d353), **claim TOCTOU 수정**(1a33cfd), **정리**(100d516).

**3자 적대 리뷰(Fable/Codex/Grok)로 커밋 전 잡은 실버그**: 협상 원자성(critical 3), E3 좀비 회귀, P4-2a 훅 RCE, flowType 발산, graph_read 죽은 outcome 컬럼, **claim dep TOCTOU**, 완료 이벤트 유실, 미러 비원자, 규칙9 위반, **B4 flaky 근본원인(stop()이 in-flight tick 미drain)**.

---

## 4. 테스트·검증 (재현 방법)

```bash
cd apps/be
bun test              # 전체 유닛/통합: 573 pass / 0 fail (dev PG :3446 필요)
bun run typecheck     # clean
BW_SIM=1 bun test src/graph/graph-chaos.sim.spec.ts   # 카오스 통합 시뮬(전용 blazewrit_sim DB 자동생성)
```

- **카오스 시뮬**(`graph-chaos.sim.spec.ts`, BW_SIM 게이트, 커밋 자산): 실제 컨트롤러 실시간 실행 + 스크립트 에이전트 3 동시 + 카오스(유입/gen++/미드런 seal) + **DB 감사 트리거 풀히스토리 단언**(터미널 역행·dep latch·seal-freeze·규칙9·derive·미러·ACL). 시드 3개 결정론(mulberry32). 발화 강제(동시 reconcile·lease만료·stale, 0이면 실패).
- **함정**: dev PG(:3446) 잔해는 `truncate table a2a_proposals,a2a_inbox,dep_members,deps,task_seals,jobs,external_gates,tasks restart identity cascade`. 대량 반복 실행 금지(controller 글로벌 스캔 느려짐). B4 timeout은 고부하 수렴지연(격리 재실행 통과).

---

## 5. 잔여 작업 (급한 순)

### 티어 1 — "자율 자기개선"이 실제 돌려면
- **[미배선] 재실행 트리거**: `bumpJobGeneration`(→rerun_requested 이벤트)의 **프로덕션 호출처 0**. 재실행 경로는 완성·안전(규칙9 방어까지)인데 **아무도 안 당김** → 실패 잡이 자동 재시도 안 됨. 필요: 트리거 배선(에이전트 `job_rerun` 툴? wake 판단? 정책?). "결과에서 학습해 자기개선"의 전제. **이게 최우선.**
- **[미착수] P5 UI**(job-graph.md:176): task_events + 그래프 시각화(2층 뷰) + **자율모드 토글 UI**(백엔드=PATCH autonomy 완료) + 개입 UI. FE 중심. 인간 가시성/제어의 핵심.

### 티어 2 — "눈 넓히기"(오라클) — **계측 먼저, 지금 아님**
아키텍처 판정의 유일 갭 = **크로스-태스크/레포 가시성**(태스크-내는 graph_read가 이미 커버). 근거: Sandholm 정리(양자·단일잡 협상=지역최적 함정) + graph_read 지평이 1태스크서 멈춤 + `buildWakePrompt`가 `repos.card` 미주입. **처방은 플래너 아니라 read-only 오라클**(권고형 플래너는 신뢰성 역설로 소프트강제 병목 뒷문).
- ① **계측**(선행 필수): A2A 라운드수·정체wake·역제안비율 메트릭 → thrashing 실측
- ② graph_read 지평 크로스-태스크 확장(read-only, 스키마 변경 0)
- ③ wake 필터⑦ "크로스-태스크/레포 충돌" 기계탐지→에이전트 판단
- ④ 주기 글로벌 reflect→repos.card 권고 prior write→wake 프롬프트 주입
- (선택) A2A 어휘를 다자 원자 제안으로(Sandholm OCSM)
- **전부 read-only·가산·주권보존. 실측 재현 전엔 착수 금지(과설계 게이트).**

### 티어 3 — 보안·견고성 백로그
- **#27** step-executor `settingSources:['project']` 훅 셸실행 노출(플랫폼 전역). 외부 레포 연결 전 필수. 현재 repos=유저 자기 레포라 수용. 수정안: `allowManagedHooksOnly` or 신뢰모델 명시.
- **#5** dep 동시생성 사이클 TOCTOU: 서로 다른 waiter의 동시 dep_declare 2개가 각자 cycle검사 통과 후 순환 형성(각자 다른 잡 락이라 미직렬화). latent.
- **a2a 순환 데드락 가드 없음**: 두 레포 상호 a2a 대기 교착 가능(리서치 지적). 명시 가드 필요.
- **검증 게이트 강화**(MAST 근거): verify/seal을 명시 다층 게이트로.
- **A2A 협상 오버헤드 계측·상한**(하이브리드 세금).

### 미검증(정직)
- **비교 시뮬 미작성**: "순수 로컬 vs 오라클 증강" thrashing 라운드수 실측 — 갭이 현 규모 미도달이라 안 만듦. 오라클 착수 판단 시 근거로 만들 것.

---

## 6. 운영 규칙 (팀 관례)

- **역할 분담**: 모든 코드(테스트 포함)는 Sonnet 서브에이전트 위임. 스펙·리뷰·오케스트레이션은 메인(Opus 전환 후 소규모 수정은 직접 가능).
- **3자 적대 리뷰 필수**: 매 산출 단위 = Fable 신선 서브에이전트(model=fable) + Codex(`codex exec`) + Grok(`grok -p`), 공통 브리프. 검증 하네스·불변식 정의·결과 해석도 리뷰 대상(체커 약하면 "위반 0" 무의미 — 실증됨).
- **세션한도 사망 승계**: 부분 산출물 검증 후 잔여만 새 Sonnet에(전임 산출물 재작성 금지).
- **중앙 에이전트 이름 = 똘이**(고정, 재론 금지).
- **커밋**: 라운드 단위, main 직접, 3자 리뷰 통과 후. 매 커밋 전체 스위트 green.
