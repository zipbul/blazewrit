# Task / Job Graph (동결 v2)

> Status: **설계 동결.** 다중 라운드 크로스 적대리뷰(grok×N, codex×N, 자체) + 오너 교정 반영. v1의 "중앙 플래너/의도 소유자" 모델은 **폐기** — 오너 교정: 총괄자 없이 주권 프로젝트들이 A2A로 창발 조율. `step-taxonomy.md`(잡 내부 실행)의 상위 층.

## 개념 (오너 고정)

- **태스크(Task)** = 사용자 요구사항. **프로젝트를 가로질러 걸친다.** 1 : N 잡.
- **잡(Job)** = 한 프로젝트에 속한 할일 = 태스크 의존 그래프의 노드. **각 프로젝트가 자기 잡의 주권자** — 아무도 남의 잡을 편집하지 않는다.
- **플로우(Flow)** = 잡을 실행하는 내부 스텝 체인(잡 1:1, 구현어). 잡은 pending일 때 플로우 없이 존재; dispatch되면 플로우 생성.
- **중앙 소유자/플래너 없음.** 조율은 주권 프로젝트 에이전트들의 A2A 대화에서 **창발**.
- **협업 = 태스크 자동생성.** A가 일하다 B 소관 일을 발견 → A2A 요청 → B가 **자기 잡**을 생성·관리(같은 태스크 밑 / 다른 활성 태스크에 제안 / 새 태스크; 완료된 태스크 재개봉 금지).
- **의존 대처**: A 잡이 B 잡을 기다리는데 B가 실패·변경 → 파급이 A에게 전달, **A가 자기 잡을** 대기·재계획·대안. 남이 A 잡 안 건드림.
- **자율 모드 = 전역 설정.** ON이면 사람한테 안 묻고 진행. 사람은 게이트가 아니라 **투명성(상황·이유 전달) + 언제든 대화·개입(일시정지/수정/취소)**.
- **판단에 인위적 제약 금지** — 예산·쿼터·왕복상한·승인게이트 없음. 안전 = 주권 + 타입 문법 + 전 기록 + 가시성.

## DB 스키마 (타입 보장, jsonb는 진짜 가변 페이로드에만)

```sql
tasks (
  id text pk, title text not null, description text,
  status text not null check (status in ('open','done','cancelled')),
  created_at timestamptz not null default now()
)
jobs (
  id text pk,
  task_id text not null references tasks(id),
  project_id text not null references projects(id),
  title text not null, description text,
  status text not null check (status in
    ('pending','ready','running','blocked','done','failed','cancelled')),
  generation int not null default 1,
  created_at timestamptz not null default now()
)
job_deps (                              -- 순서·의존 = 간선. 없으면 병렬.
  waiter_job text not null references jobs(id),
  provider_job text not null references jobs(id),
  provider_gen int not null,            -- 의존 시점 generation (stale 판정)
  status text not null check (status in ('active','released','stale')),
  primary key (waiter_job, provider_job),
  check (waiter_job <> provider_job)
)
task_events (                           -- 공유 진실 = append-only. 시각화·감사·사이클 검사의 원천.
  seq bigserial pk, task_id text not null references tasks(id),
  actor text not null,                  -- machine | project:<id> | human
  kind text not null,                   -- 아래 메시지/이벤트 종류
  job_id text, edge jsonb,              -- jsonb는 여기(타입별 가변)만 정당
  created_at timestamptz not null default now()
)
```

FK=매달린 간선 차단, CHECK=상태값 강제, PK=중복 간선 차단, `<>`=자기루프 차단 — 전부 DB가 보장. **DB가 진실, A2A는 그 위에 이벤트 얹는 것뿐.**

## 에이전트는 언제·무슨 기준으로 판단하나 (핵심)

**에이전트는 스케줄링을 하지 않는다. 의존을 선언할 뿐이다. 기계는 준비된 것을 돌린다.**

판단 시점 = 3개 이벤트 (매순간 상주 아님):
1. **분해 시** — 태스크가 오면 잡들 + 의존 간선을 쓴다.
2. **실행 중 발견 시** — 필요한 게 생기면 잡 추가 / 타프로젝트 요청.
3. **의존 해소·실패 시** — 기다리던 게 done/failed 되면 대처.

기준 (직렬/병렬/타프로젝트):
- **순서 = 결과 의존 하나뿐.** "이 잡이 저 잡의 *결과*가 필요한가?" → 필요하면 의존 간선(직렬), 아니면 간선 없음(병렬). 취향·추측 아님, 결과 의존만.
- **타프로젝트 = 소관.** "이 일이 다른 프로젝트 도메인인가?" → A2A 요청. 그쪽이 자기 잡 선언.
- 판단 결과 = DB 쓰기(잡·간선), 문법(사이클 검사 등)이 검증.

## A2A = DB 위의 이벤트 (타입별)

`job.requested`(A→B) / `accepted·rejected·countered`(B 주권) / `dep.declared` / `job.changed` / `job.terminal`(done·failed·cancelled·superseded) / `fact.request·reply`(읽기, provenance 데이터 — 지시로 프롬프트에 넣지 않음). 상관: `contextId=task_id`, `messageId` 멱등, 의존은 `(project_id, job_id, generation)`에 건다.

## 기계 (물리, 판단 아님 — L0)

- **reconcile 컨트롤러**: 의존 다 released인 잡 → ready → 기존 A2A dispatch로 실행. 병렬 = ready 여럿 동시(프로젝트 다르면). 재시작 = 전체 reconcile.
- **사이클**: 간선 insert 시 검사 → 순환이면 **거절**(DAG 물리). 거절당한 에이전트가 대안 판단.
- **정체(stall)**: lease/heartbeat 침묵 = 관측된 사실(쿼터 아님) → 의존 잡 blocked로 깨어나 대처.
- **stale**: provider가 supersede(generation↑) → 옛 간선 stale → 대기자 자동 wake·재계획.

## 시각화

`task_events` projection. 상위 뷰 = 프로젝트 간 A2A/의존 흐름, 하위 뷰 = 프로젝트별 잡 그래프(자기 슬라이스). 같은 edge id로 조인. 상태·의존·막힘·파급 실시간. (일관된 실시간 그래프 요구가 공유 로그를 강제 — 나중 join은 skew로 거짓말.)

## 만들지 않는 것

중앙 플래너·중앙 그래프 소유자 · 크로스 프로젝트 잡 편집 · 예산/쿼터/왕복상한/승인게이트 · 협상 FSM · 글로벌 스케줄러 · 완료 태스크 재개봉.

## 구현 순서

1. **P1** 스키마(tasks/jobs/job_deps/task_events) + 상태기계 전이 + 사이클 검사 순수함수 (TDD; N=1 잡 = 현행 동작 보존)
2. **P2** reconcile 컨트롤러 (ready 판정·기존 dispatch 재사용·stale/stall 물리)
3. **P3** A2A 이벤트 종류 + 멱등/상관 + task_events append
4. **P4** 분해·발견 판단(에이전트) → 잡·간선 쓰기 + 타프로젝트 요청
5. **P5** 시각화(2층 뷰) + 자율모드 토글 + 투명성/개입 UI
