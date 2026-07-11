# Task / Job Graph (v3 — 합의 전 초안, 동결 아님)

> Status: **동결 해제.** v2는 4자 시나리오 소진(grok·codex·서브에이전트·자체, 45케이스 중 ~26 BROKEN)에서 표현력 부족 + 뿌리 모순이 드러나 철회. 이 문서는 합의될 때까지 반복 수정한다. 목표: **과설계가 아니라 정확한 설계** — 추가하는 모든 요소는 실제 BROKEN 시나리오 하나 이상을 해소해야 하고, 근거 없는 primitive는 넣지 않는다.

## 뿌리 정정 (C1·C2)

- **C1 — 중앙 DB를 인정한다.** blazewrit은 Postgres **하나**를 쓴다. 전 프로젝트 jobs/deps가 한 DB에 있고, 사이클검사·FK·의존 전파가 작동하는 이유가 그것이다. "물리 탈중앙/페더레이션 A2A"는 폐기한다(지어낸 서사). **정정: 저장·진실 = 중앙 DB, 권한 = 분산(에이전트는 자기 프로젝트 잡만 write, 강제).** 오너 요구("중앙 플래너 없음")는 결정 권한 얘기지 물리 격리가 아니었다 — 그건 지켜진다.
  - **효과: 분산 primitive가 증발한다.** 페더레이션 사이클탐지·분산 dep-release 신뢰성·크로스DB 합의·durable ack/retry 불필요. 중앙 DB니까 reconcile이 provider 상태를 **직접 읽어** 의존을 푼다(A2A 메시지 유실돼도 상태가 진실).
- **C2 — 진실은 하나.** 관계형 DB(tasks/jobs/deps)가 **단일 진실.** `task_events`는 경쟁 진실이 아니라 **감사·시각화용 append-only 로그/투영**. 사이클검사·ready 판정은 관계형에서, 이벤트는 기록만.

## 개념 (오너 고정)

- **태스크** = 사용자 요구, 프로젝트를 걸침, 1:N 잡.
- **잡** = 한 프로젝트의 할일 = 그래프 노드. 각 프로젝트가 자기 잡만 write(권한 분산).
- **플로우** = 잡 실행 스텝 체인(잡 1:1, 구현어).
- 조율 = 프로젝트 에이전트끼리 A2A로 **협상**(요청/수락/역제안). 단 **상태는 공유 중앙 DB**에 산다(A2A는 결정 채널, DB는 진실).

## DB 스키마 (정확 — 각 요소가 BROKEN 시나리오를 해소)

```sql
tasks (
  id text pk, title text not null, description text,
  status text not null check (status in ('open','sealed','done','cancelled')),
  -- sealed = 더 이상 잡 추가 안 함(rolling-wave 종료 선언). done = sealed ∧ 모든 잡 terminal.
  -- 이게 "태스크 done 정의"(BROKEN #18)와 whole-task 대기(#6)의 근거.
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
  superseded_by text references jobs(id),   -- gen++/재실행 대체 (P5)
  created_at timestamptz not null default now()
)

job_lineage (                               -- split/merge (P5): 한 잡 ↔ 여러 잡
  parent_job text not null references jobs(id),
  child_job  text not null references jobs(id),
  kind text not null check (kind in ('split','merge')),
  primary key (parent_job, child_job)
)

-- 의존 = 대기자의 "준비 조건". 그룹(술어) + 멤버(다형 타깃).
deps (                                      -- 한 잡이 여러 그룹 가질 수 있음 = 그룹 간 AND
  id text pk,
  waiter_job text not null references jobs(id),
  predicate text not null default 'all' check (predicate in ('all','any','k_of_n')),  -- P2: OR/정족수
  k int,                                    -- k_of_n일 때
  softness text not null default 'hard' check (softness in ('hard','soft')),          -- P2: soft
  deadline timestamptz,                     -- P2: 이 시각 지나면 미충족이어도 release
  status text not null default 'active' check (status in ('active','released','stale'))
)

dep_members (                               -- P1: 타깃이 잡/태스크/외부 다형
  dep_id text not null references deps(id),
  target_type text not null check (target_type in ('job','task','external')),
  target_id text not null,                  -- job id | task id | external_gate id
  expected_gen int,                         -- job 타깃 stale 판정
  outcome text not null default 'pending'   -- P3: 결과가 불리언 아님
    check (outcome in ('pending','satisfied','failed','cancelled','partial')),
  acceptable text[] not null default '{satisfied}',  -- 이 멤버가 "충족"으로 치는 결과 집합
  primary key (dep_id, target_type, target_id)
)

external_gates (                            -- P1: 웹훅/사람승인/크론/외부API (job 아닌 provider)
  id text pk, task_id text not null references tasks(id),
  kind text not null, description text,
  status text not null default 'pending' check (status in ('pending','fired')),
  created_at timestamptz not null default now()
)

job_resources (                             -- P6: 같은 파일/계약 충돌 직렬화
  job_id text not null references jobs(id),
  resource_key text not null,               -- 파일경로/계약명
  mode text not null check (mode in ('read','write')),
  primary key (job_id, resource_key)
)

task_events (                               -- 감사·시각화 로그 (진실 아님, 투영)
  seq bigserial pk, task_id text not null references tasks(id),
  actor text not null, kind text not null,
  job_id text, payload jsonb,               -- jsonb는 여기(타입별 가변)만
  created_at timestamptz not null default now()
)
```

**ready 판정(기계):** 대기자의 **모든 dep**에 대해 — 그룹 술어(all/any/k_of_n)가 멤버 outcome∩acceptable로 충족 ∨ softness=soft ∨ deadline 지남 → 그 dep released. 전 dep released면 ready. + job_resources write 충돌은 기계가 직렬화.

## 이 스키마가 닫는 BROKEN (근거)

- whole-task/task→task/task-done → tasks.sealed + dep target_type='task'
- 외부이벤트 → external_gates + target_type='external'
- OR/k-of-N → deps.predicate. soft/deadline → softness/deadline
- partial/failed/cancelled 구분 → dep_members.outcome + acceptable (예: provider cancelled여도 "없음"으로 진행 = acceptable에 'cancelled')
- split/merge/supersede → job_lineage + superseded_by
- artifact 충돌 → job_resources
- 크로스 사이클/유실/합의 → **C1으로 증발**(중앙 DB, 상태 직접 읽기)

## 남는 물리 (증발 안 함, 작음)

- 실행 lease/heartbeat: 워커 crash로 running 고착 감지. lease = 물리(쿼터 아님).
- ready→running 원자 claim: 재시작 후 중복 dispatch 방지(단일 DB 트랜잭션 CAS).

## 에이전트 wake (이미 4자 합의 — 유지)

에이전트 프롬프트 = 얇은 뉘앙스 하나 + 이번 wake의 구체 이유 한 줄. 9분류 나열 안 함. 기계가 결정론 전이는 혼자, 판단 필요한 6타입 + 타이머만 에이전트 깨움. (상세: 아래 "언제 깨어나나" 절 — 이전 합의본 유지.)

## 만들지 않는 것 (과설계 방지 — C1으로 불필요해진 것 포함)

페더레이션 사이클탐지 · 분산 dep-release 신뢰성 · durable ack/retry/OOO버퍼 · 크로스DB 합의 · contract 버전관리 · release batching/fairness · 협상 FSM · preempt/kill · 예산/쿼터/왕복상한/승인게이트. (대부분 중앙 DB 인정으로 문제 자체가 사라짐. 나머지는 현 규모 미도달.)

## 구현 순서

1. **P1** 스키마 전체 + 상태기계 전이 + 사이클검사(관계형) + ready 판정 순수함수 (TDD; 단일 잡·단일 dep = 현행 동작 보존)
2. **P2** reconcile 컨트롤러 (ready·lease·원자 claim·재시작 reconcile) — 기존 dispatch 재사용
3. **P3** A2A 협상(요청/수락/역제안) + task_events append + external_gates 발화 경로
4. **P4** 에이전트 wake 배선(이유 전달) + 분해·발견 판단 → 잡·dep write
5. **P5** 시각화(2층 뷰) + 자율모드 토글 + 개입 UI

## 언제 깨어나나 (4자 합의 유지)

에이전트 프롬프트 = "네 슬라이스 그래프 유연히 관리 — add/split/merge/reorder, dep 선언/철회, 타프로젝트 요청" + 이번 이유 한 줄. 기계 혼자: dep released→ready, ready 스케줄링, 인간 cancel 즉시 집행, 중복 coalesce. 에이전트 깨우는 필터 6 + 타이머: ①분해 ②자기완료 편입 ③의존 예외 ④인바운드 A2A 결정 ⑤인간 권한(정리만) ⑥이상·품질 + 정체/주기 타이머. 9-분류는 이 필터의 완전성 스펙일 뿐 프롬프트 아님.
