# Job Graph (동결 v1)

> Status: **설계 동결.** 2라운드 크로스 적대리뷰(grok×2, codex×1[1라운드 세션한도 탈락→2라운드 참여], 자체 트레이스) 통과본. `step-taxonomy.md`(스텝 층)의 상위 층. 원칙: 스텝 층에서 검증된 패턴의 프랙탈 — **에이전트가 조합하고, 기계 문법이 검증하고, 멍청한 엔진이 실행한다.**

## 층 구조

```
사용자 의도 (work_item = 의도 앵커, 1:N)
  → 잡 그래프: jobs + job_edges (프로젝트 경계를 넘는 DAG)
    → 잡 1개 = 프로젝트 하나에서 flow 하나로 실행 (기존 스텝 기계 그대로)
```

의도가 잡 1개로 퇴화(N=1)하면 오늘의 동작과 동일 — 하위호환은 문법이 보장한다.

## 데이터 모델

- `jobs(id, work_item_id, project_id, title, scope, state, generation, lease_until, attempt, priority, scope_hash, flow_id?, created_at)`
- `job_edges(from_job, to_job)` — 명시 의존 간선
- `graph_events` — append-only 변이·결정 로그 (감사/디버그/재질의용; **결정 주체 L0/L1/L2와 거부 사유 필수 기록** — 학습 회로의 입력). 현재 상태의 권위는 jobs/job_edges + generation CAS (완전 이벤트소싱은 필요가 증명되면).

## 잡 상태기계 (엄격 — 허용 전이 외 불가)

```
pending → ready → dispatched → running → done
                                   ↘ failed(attempt·transient/terminal 필드로 재시도 판정)
held(사유 enum: dependency | failure | conflict | approval)
cancelled / superseded(세대 교체 — 구 산출물 무효화)
```

- **하류 신뢰 규칙**: 하류 잡은 `done` 잡의 산출물만 신뢰한다. 체크포인트 산출물은 잡 내부 전용.
- **타임아웃 2종 분리**: lease 타임아웃(워커 생존 — 회수·재발사) ≠ job 타임아웃(SLA 초과 — hold+에스컬레이션). hung running이 큐를 영구 점유하지 못하게.
- 실패 전파: failed → 의존 잡 `held(failure)` (자동 cancel 금지) → 에스컬레이션. cancel은 명시 행위.

## 그래프 문법 (기계 검증, 순수함수)

DAG(간선 추가 시마다 사이클 검사) · 간선 양끝 실존 · 활성 프로젝트 라우팅(환각 프로젝트 hard reject) · N=1 퇴화 = 현행 동작. 상한류 숫자 제약 없음 — 이상한 분해는 킥오프 승인과 모니터링에서 보인다.

## 분해: rolling-wave

`assembleJobs`(웨이브 분해기, assembleChain과 동형 — structured output·세션 기록·문법 벽이 소비): 의도+정찰 사실+현 그래프 → **이번 웨이브 잡/간선만 확정**, 나머지는 다음 웨이브. 선행 전체분해(BDUF) 금지 — LLM 계획 품질은 horizon에 반비례. 의도 수준 목표(수용기준)는 별도 보관해 웨이브가 표류하지 않게.

## 실행: 조정(reconcile) 컨트롤러

명령형 "완료되면 다음 찍기" 금지. 이벤트+주기 스윕으로 desired vs observed 대조:
- READY = 의존 전부 done ∧ not held ∧ generation 최신 → **멱등 dispatch (키: job_id+generation, `ready→dispatched` 전이는 generation 포함 단일 CAS)**
- **이중 방어**: 워커(flow)는 시작 시 권위 generation 재확인 — CAS는 이미 나간 dispatch를 못 막는다
- 병렬 = READY 여러 개 동시 발사 (프로젝트가 다르면), 프로젝트당 동시 1 flow(v1) + FIFO/priority 큐
- 재시작 = 전체 active 의도 reconcile. lease 만료 → 정책따라 재큐/실패

## 변이 (동적 재계획)

연산: split / merge / reorder / amend / add / cancel / 크로스 요청. **running은 신성불가침이 아니다**: (a) 스텝 경계 체크포인트에서 남은 계획 amend (b) cancel+respawn(generation+1, 구 잡 superseded) (c) 토폴로지 안 건드리는 수용기준 편입.

## 권한: 에이전트 전권

**잡·태스크 관리에 제약을 걸지 않는다.** per-intent 플래너가 자기 의도의 그래프에 전권을 갖는다 — split/merge/reorder/amend/add/cancel 전부, 프로젝트 경계와 무관하게. 타 의도의 잡은 소유권이 다르므로 제안으로 조율하고, 상대 플래너가 자율 결정한다.

**인간은 게이트가 아니다.** 시스템은 어디서도 승인을 기다리며 멈추지 않는다. 인간이 갖는 것은 개입 **능력**(모니터링에서 보고, 원할 때 일시정지/수정/취소) — 요구되는 승인이 아니라 선택적 개입. 기계(L0)가 하는 것은 판단이 아니라 동작뿐: READY 발사, CAS, lease 회수, 실패 hold 전파, 사이클 검사, 재발견 승격.

## 플래너 간 조율 프로토콜

- 요청 = 제안(proposed → accepted | rejected | 역제안). **역제안 = 원요청 참조하는 새 제안** — 협상 FSM 없음.
- **조율에 제약 없음.** 왕복 횟수·예산·무진전 판정 같은 인위적 울타리를 두지 않는다 — 판단은 에이전트의 일이다. 안전 모델은 울타리가 아니라 **가시성**: 모든 제안·수락·거절이 graph_events에 남고, 이상 패턴은 사람이 모니터링에서 보고 원인(프롬프트·학습)을 고친다. 증상을 쿼터로 가리는 것은 땜질이다(마인드셋 #3).
- stale 감지: 제안이 참조한 generation이 지나가면 자동 무효 (이건 제약이 아니라 사실 — 대상이 이미 변했다).

## 충돌 (교차 의도)

같은 프로젝트를 두 의도가 다투면 플래너끼리 제안으로 조율한다 — 중재 룰·심판 없음. 동시 쓰기의 정합만 기계가 지킨다(generation CAS — 룰이 아니라 물리). 조율 과정은 전부 기록되고, 인간은 보이는 대로 원하면 개입한다.

## 스케줄링

프로젝트당 동시 1 flow(v1 물리 제약: 프로세스당 cwd 1개) + 대기열. 순서는 플래너들이 조율로 정한다 — 스케줄링 정책을 시스템이 강제하지 않는다.

## 발견 처리

발견은 discovery 이벤트로 방출되고 per-intent 플래너가 판단해 처분한다(즉시/편입/새 잡/기록). 4처분은 어휘지 강제 룰이 아니다 — 플래너의 판단이 우선하고, 판단 근거는 기록된다.

## 만들지 않는 것 (합의)

협상 FSM · 글로벌 최적 스케줄러 · partial-done 상태 · 완전 이벤트소싱(로그는 감사용) · 왕복 상한 · 변이/조율 예산 · 무진전 판정기 · 승인 게이트 · 중재 룰 · preempt/kill. **판단과 관리에 대한 제약 일절 금지 — 에이전트 전권, 안전은 가시성+기록+사람의 선택적 개입에서 나온다.**

## 구현 순서

1. **P1** 스키마(jobs/job_edges/graph_events) + 그래프 문법 순수함수 + 상태기계 전이 검증 (TDD; N=1 퇴화=현행 증명)
2. **P2** assembleJobs 웨이브 분해기 + 세션 기록
3. **P3** 조정 컨트롤러 (멱등 dispatch·이중 generation 방어·lease/job 타임아웃·재시작 reconcile) — 기존 A2A dispatch 재사용
4. **P4** 변이 연산 + 조율 프로토콜 + supersede
5. **P5** 발견 이벤트 + 인간 개입 수단(일시정지/수정/취소 — 게이트 아님)
