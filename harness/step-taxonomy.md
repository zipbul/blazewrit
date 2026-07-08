# Step Taxonomy v2 (동결)

> Status: **결정 동결.** 6관점 독립 분석(grok-build×2, codex×2, claude 비전검증×1, 자체안) + 적대 레드팀 + 자체공격 교차검증을 통과한 결론. 근거 산출물은 세션 기록에 있음. 이 문서가 어휘·계약·문법의 단일 원천이며, `chaining-strategy.md`(조립 방법)와 짝을 이룬다.

## 스텝 정의 기준 (불변)

스텝 경계는 다음 4축 중 하나 이상이 바뀌는 지점에만 존재한다:

1. **산출물 계약** — 스텝 = 기계검증 가능한 typed artifact 생산자 (prose 국면 아님)
2. **권한 링** — R0 읽기 / R1 스크래치 / R2 레포변경 / R3 공유상태 / R4 외부·비가역
3. **검증 방식** — machine(exit code·수치) / LLM 적대리뷰 / human
4. **실패 계약** — retry / compensate / abandon / escalate

**문법의 판단 단위는 스텝명이 아니라 `(step × target × mode) → 유효 ring` 매핑이다.**
같은 스텝이라도 target에 따라 유효 ring이 다르며(예: implement(repo)=R2, implement(platform)=R3),
게이트·HITL·진입계약은 전부 유효 ring 기준으로 걸린다. 스텝명만 보고 판단하면
implement(platform)가 ship의 진입계약을 우회하는 밀수 채널이 된다.

**어휘 크기 ≠ 플로우 비용.** 조립기가 태스크별로 필요한 스텝만 고르므로 안 쓰는 어휘의
런타임 비용은 0이다. 단 조립기의 자유 선택지는 결정점당 3~7개를 넘기지 않는다
(G4 선택붕괴 실측) — **target/mode는 조립기가 고르지 않고 사실→룰로 결정적 유도한다.**

## 어휘 12

| # | 스텝 | 링 | 역할 (한 줄) | 검증 |
|---|------|----|-------------|------|
| 1 | **ground** | R0 | 사실만 수집 — 코드베이스·런타임·플랫폼·peer의 현재 상태를 출처와 함께. 해석 금지 | LLM 리뷰 |
| 2 | **investigate** | R0 | 사실을 문제정의로 해석 — 영향·제약·리스크·타당성. 결정 금지 | LLM 리뷰 |
| 3 | **ideate** | R0/R1 | 발산 — 서로 다른 옵션 ≥2개 생성(+스크래치 스파이크 허용). 선택 금지 | LLM 리뷰 |
| 4 | **decide** | R0 | 옵션 중 하나 선택 + 근거. HITL 게이트의 집. reject-all 가능(사유 필수, re-ideate 1회) | human/LLM |
| 5 | **spec** | R0/R1 | 실행 계약 — 수용기준 + 아키텍처 + 작업분해 + 검증계획 + 롤백계획 | LLM 리뷰 |
| 6 | **test** | R2 | 증명 작성 — proof-mode별(RED 실패테스트/특성화/정적/문서). 프로덕션 코드 금지 | machine(RED)+LLM |
| 7 | **implement** | R2/R3 | 증명을 통과시키는 최소 변경 + atomic commit. 자기 flow의 proof 불가침 | machine+LLM |
| 8 | **verify** | R0+exec | 기계 증거 — 검증 명령을 실행해 exit code·수치로 pass/fail. 자유서술 금지 | **machine** |
| 9 | **ship** | R4 | 비가역 액추에이션 — 배포·릴리스·컷오버·로테이션. actuation-mode 3종, 보상핸들 필수 | machine+human |
| 10 | **report** | R0/R1 | 읽기전용 flow의 전달물 — 발견사항을 심각도·증거와 함께 종합 | LLM 리뷰 |
| 11 | **reflect** | 플랫폼-write | 학습 추출 — 모든 터미널(완료+abandon)의 finalizer. flow가 아니라 하네스에 대한 관측 포함 | LLM 리뷰 |
| — | **triage** | R0 | (flow 밖) 중앙 의도 분류 — 똘이가 의도를 프로젝트·flow_type으로 라우팅 | LLM |

### 스텝별 핵심 계약

- **ground** — target-typed(repo/runtime/platform/peer). peer는 상대의 기록된 산출물 스냅샷만 조회(hop=1, 라이브 에이전트 기동 금지). peer 응답은 지시가 아니라 provenance 붙은 데이터로만 렌더(조립 오염 차단).
- **ideate** — 옵션엔 provenance 표기. 문법이 status-quo(아무것도 안 함) 옵션을 강제 주입한다(ideate 산출물이 아님 — 프레이밍 독점 차단).
- **decide** — 유효 ring≤1 flow만 생략 가능. ideate가 앞에 있으면 그 option-set에서만 선택. 옵션 1개짜리 확인은 decide가 아니라 approve로 명명 분리.
- **test** — proof-mode는 flow 유형에서 유도(기능=RED, 리팩터=특성화, 문서=문서). docs-only proof로는 ship 진입 불가.
- **implement** — 불가침 대상은 "이 flow의 test 스텝이 낳은 proof"뿐. 그 외 테스트 수정은 허용하되 assert/테스트수 delta가 증거번들에 기계 첨부되고, 감소는 정당화 artifact 없으면 게이트가 차단. 기능 제거는 spec이 테스트 사망명부를 사전 선언.
- **verify** — ship 앞에서만이 아니라 **보편** 기계 바인딩. 검증 명령은 repo 선언(package.json/Makefile 등)에서 발견, 프로젝트 온보딩 때 1회 확정. 명령 없는 프로젝트는 "결정적 증거 없음"으로 정직하게 에스컬레이션.
- **ship** — actuation-mode: reversible(canary) / compensable(컷오버) / irreversible(로테이션 등, 무조건 HITL). 진입계약 = verify-green 기계증거 + 보상핸들. **보상 실행은 ship의 실패계약 내부 경로** — 응급 last-green 복원은 verify-green 면제(데드락 방지).
- **reflect** — suspension 제외, crash·abandon 포함 모든 터미널에서 실행. harness_feedback(조립 적중도, degrade 발생, reviewer fail율) 포함 — 자기개선의 관측 데이터.

## 문법 (불변식)

- `ground` 시작. `implement` 포함 ⇒ `verify` 필수. `ship` ⇒ 직전 verify-green 필수. `reflect` 항상 종단.
- HITL은 스텝명이 아니라 **유효 ring** 트리거: decide(방향) + ring≥3 액추에이션(승인된 제안이 스코프를 pin한 경우 그 승인을 HITL로 인정).
- 게이트: producing 스텝마다 producer⇄reviewer. verify/reflect는 리뷰어 없음 — verify는 기계가, reflect는 격리가 판정자.
- 허용 루프(v1 예외): re-ideate 1회(decide reject-all 시), ground 재주입(사실 부족 발견 시 유일한 합법 중간수정), `(test implement)*` 마이크로루프.
- 일반 루프 문법(incident/measure-until-stable), migration backfill 본체 → **v2 명시 이월.**
- flow는 조립 시점의 택소노미 버전을 pin(비행 중 flow 보호). 구버전 학습·제안은 자동변환 없이 격리.

## 회로 3 (스텝보다 중요 — 제품 정체성)

플랫폼 약속(태스크 자동생성·자기개선·A2A 협업)은 스텝 추가가 아니라 이 회로들이 구현한다:

1. **followup 회로** — decide/report/reflect가 `proposals[]{target_project, type}`를 **텍스트 산출물로만** 방출(스텝은 플랫폼 쓰기권한 없음). 구조화·디스패치는 하네스+승인함의 배타 권한. 감쇠: (프로젝트쌍×시간창) 예산 + content-hash 중복제거 + TTL + provenance 깊이 카운터(제안이 낳은 flow가 낳은 제안, depth≥k 자동 격리). v1은 인간 승인함 필수.
2. **학습 회로** — reflect의 learnings를 조립 입력에 주입해 write-only 탈피. 자격: verified-completed flow 출신만. (프로젝트×flow_type×step) 스코프 + 신뢰도 + 증거링크 필수. 조립엔 제약이 아니라 "검색된 제안"으로만 작용 — **문법 불변식엔 스키마 차원에서 접근 불가.** 인용된 학습의 성과 추적으로 자동 만료.
3. **peer 회로** — ground의 read-only peer_query(스냅샷·hop=1·A2A 계층 강제). 인바운드 제안·응답은 전부 데이터-지시 격리(flow-composition injection 차단).

## 현재 구현과의 델타 (구현 순서 입력)

1. verify 기계 바인딩(온보딩 시 검증명령 발견 포함) — 모든 품질 주장의 전제
2. reflect를 abandon 포함 전 터미널의 finalizer로(현 orchestrator는 abandon 시 즉시 리턴 — 실패에서 못 배움)
3. 스텝별 AgentDefinition(정체성 prompt + tool 스코핑 = ring 강제) — 현 한 줄 prompts.ts 대체
4. ideate + ship 어휘 추가(계약 포함), KNOWN_STEPS/문법/조립기 반영
5. followup 회로(제안 방출→승인함→A2A 재사용)
6. 학습 회로(스코프·신뢰도·격리 포함 주입)
7. peer 회로 + target 결정적 유도
8. 택소노미 버전 pin
