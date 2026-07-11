# Task / Job Graph (v7 — 동결, 레포/제품 용어 반영)

> Status: **동결.** (v7: 주권단위 개명 — 옛 "레포"=주권=**레포**, 상위 그룹핑 **제품** 추가. 4자 토론에서 project→repo 순수 개명 + products/repos 그룹핑으로 확정, 그래프 원시·규칙 1~9 불변.) 3라운드 4자 적대검증(grok·codex·서브에이전트·자체) — 시나리오 소진(45케이스) → 과설계 감사 → 사인오프 2회. **3자 전원 SIGN.** v2(표현력 부족) → v3(뿌리 정정 C1/C2) → v4(최소·정확, 6컷) → v5(규칙6 모순·per-project seal) → v6(terminal 불변). 원칙: **추가 요소는 구체 BROKEN 시나리오 하나 이상을 닫아야 하고, 다른 원시로 표현되면 넣지 않는다.** 개정은 실제 failing 케이스가 재현될 때만.

## 정직한 아키텍처 (C1·C2 — 포장 벗김)

- **중앙 DB + write ACL + 글로벌 플래너 코드경로 없음.** blazewrit은 Postgres 하나를 쓴다. "물리 탈중앙/페더레이션"은 폐기(지어낸 서사). 저장·진실 = 중앙 DB. "권한 분산"은 아키텍처가 아니라 **write ACL**이다 — 앱 write 경로가 `jobs.repo_id == 요청 에이전트의 레포`를 검사(에이전트가 별도 DB롤이면 RLS). 오너의 "중앙 플래너 없음"은 DB 구조가 아니라 **프로세스 보증**(어떤 코드경로도 글로벌 플랜을 계산하지 않음, reconcile은 순수 결정론 전이만)으로 충족.
  - **효과:** 페더레이션 사이클탐지·크로스DB 합의는 진짜 불필요. dep-release는 A2A ack가 아니라 reconcile이 상태 직접 읽기(유실 무관). 단 **A2A 협상(요청/수락/역제안) 멱등은 남는다** — dep-release 증발과 다름.
- **C2 — 진실은 하나.** 관계형(tasks/jobs/deps)이 단일 진실. `task_events`는 감사·시각화용 append-only 투영. **상태 재구성(event-sourcing)에 절대 사용 금지**(이 한 줄이 이중진실 스큐를 봉인).

## 주권 단위 = 레포 (4자 확정, 개명)

옛 "레포"라는 코드단위 = **레포(repo)**로 개명. 계층:
```
제품(Product) = 그룹핑/뷰일 뿐, 주권 아님. (옛 "레포"의 상위 의미)
 └ 레포(Repo) = 주권 단위 = "cwd를 가진 체크아웃 하나". 제품당 N개.
     agent · A2A 엔드포인트 · seal · write-ACL · cwd · CLAUDE.md · 기록세션 = 전부 레포에.
     모노레포 = 기본 1레포(1 cwd). 무거우면 패키지를 1급 레포로 승격
       (자기 id + 자기 워크트리 cwd + 자기 카드), repos.parent_repo_id로 출신만 뷰 기록.
       "한 repo_id 아래 서브엔드포인트 여럿"은 금지(ACL·cwd·주소 붕괴 — 서브에이전트 증명).
```
- **제품 = 그룹핑 + 얇은 라우터(비주권).** jobs·seal 없음. "제품 B로 온 요청 → target repo_id 해석 후 dispatch"만(기존 중앙 triage 확장). **라우터가 jobs/deps를 직접 쓰면 안 됨**(작은 글로벌 플래너 변질 = C1 위반).
- **제품↔제품 협업 = 서로 다른 제품의 레포들이 크로스-레포 dep로 얽히는 것.** 별도 메커니즘 아님 — 제품은 주소가 아니라 뷰.
- 근거: flow는 cwd 하나. 제품은 N레포/N언어라 제품-에이전트는 "1 cwd"를 깬다(P안 사망). 모노레포 전부 주권化는 "같은 디스크 위 외교"(K안 사망). 레포만 cwd·ACL·settingSources·A2A와 1:1.
- **실코드 갭(개명과 별개):** executor cwd가 현재 프로세스당 고정 → dispatch 시 `repos.cwd`로 레포별 cwd 해석 배선 필요. 이게 "flow=cwd 하나"를 레포 주권에 실제로 묶는 유일한 배선.

## DB 스키마 (최소·정확)

```sql
tasks (
  id text pk, title text not null, description text,
  status text not null check (status in ('open','done','failed','cancelled')),
  -- 전역 seal 없음(그게 cross-project 봉쇄=주권위반이었다). status는 유도값:
  --   done   = 모든 참여 레포가 자기 슬라이스 seal ∧ 모든 잡 satisfied
  --   failed = 모든 참여 레포 seal ∧ 모든 잡 terminal ∧ ≥1 failed
  --   cancelled = 명시 취소
  created_at timestamptz not null default now()
)

task_seals (                             -- 레포별 seal(주권): 존재 = 그 레포가 자기 슬라이스 종료 선언
  task_id text not null references tasks(id),
  repo_id text not null references repos(id),
  sealed_at timestamptz not null default now(),
  primary key (task_id, repo_id)
)

jobs (
  id text pk,
  task_id text not null references tasks(id),
  repo_id text not null references repos(id),
  title text not null, description text,
  status text not null check (status in
    ('pending','ready','running','blocked','done','failed','cancelled')),
  generation int not null default 1,     -- 재실행 = 제자리 gen++ (새 행 아님 → 봉인 위반 없음)
  created_at timestamptz not null default now()
)

deps (                                   -- 대기자의 준비 조건. 한 잡이 여러 dep = dep 간 AND
  id text pk,
  waiter_job text not null references jobs(id),
  predicate text not null default 'all' check (predicate in ('all','any')),  -- AND / OR
  status text not null default 'active' check (status in ('active','released','stale'))
)

dep_members (                            -- 다형 타깃 + non-boolean outcome
  dep_id text not null references deps(id),
  target_type text not null check (target_type in ('job','task','external')),
  target_id text not null,               -- job id | task id | external_gate id
  expected_gen int,                      -- job 타깃 stale 판정
  outcome text not null default 'pending'
    check (outcome in ('pending','satisfied','failed','cancelled')),  -- 잡 terminal과 1:1
  acceptable text[] not null default '{satisfied}',  -- 이 멤버가 "충족"으로 치는 결과 (예: cancelled 수용)
  primary key (dep_id, target_type, target_id)
)

external_gates (                         -- 웹훅/사람승인/크론 (job 아닌 provider)
  id text pk, task_id text not null references tasks(id),
  kind text not null, description text,
  status text not null default 'pending' check (status in ('pending','fired')),
  created_at timestamptz not null default now()
)

products (                              -- 그룹핑/뷰. 주권 없음(jobs·seal 없음).
  id text pk, name text not null, created_at timestamptz not null default now()
)
repos (                                  -- 주권 단위(옛 projects). cwd가 실행기 바인딩의 진실.
  id text pk, product_id text not null references products(id),
  name text not null, git_url text, cwd text not null,
  parent_repo_id text references repos(id),   -- 모노레포에서 승격됐으면 출신(뷰용)
  card jsonb not null default '{}', created_at timestamptz not null default now()
)

-- task_events: 감사·시각화 투영. 구현은 P5(시각화)로 연기. 상태 재구성 금지.
```

**물리(작음, 유지):** 실행 lease/heartbeat(워커 crash 감지), ready→running 원자 claim(중복 dispatch 방지, 단일 DB 트랜잭션 CAS).

## 봉합 규칙 (컬럼 아닌 불변식 — ADD)

1. **write 권한 강제(주권)**: 앱 write 경로가 검사 — 잡은 `jobs.repo_id == 요청 레포`, seal은 `task_seals.repo_id == 요청 레포`(자기 슬라이스만). "강제"는 단어가 아니라 이 경로. 전역 task 잠금이 없으므로 한 레포가 남을 못 막는다.
2. **seal = 슬라이스 insert-freeze**: 레포 P가 T를 seal(task_seals 삽입)하면 **P의 잡만** T에 INSERT 거부. 다른 레포는 계속 추가 가능(봉쇄 없음). 재실행은 제자리 gen++라 INSERT 아님, 봉인과 무충돌. P가 다시 열려면 자기 seal 행 삭제(자기 슬라이스만, ACL 적용).
3. **done 원자성**: `모든 참여 레포 seal(task_seals) ∧ 모든 잡 terminal` → task.status를 done|failed|cancelled로 유도(같은 트랜잭션). 슬라이스 insert-freeze가 race 봉합.
4. **liveness backstop**: task-타깃/external dep가 안 풀리면 **정체 타이머가 대기자 에이전트를 깨워** 결정(재협상/부재수용/에스컬레이트). deadline auto-release 없음. 침묵 hang 금지.
5. **stale 해소**: dep `stale`(expected_gen 불일치) → 대기자 에이전트 wake해 새 gen 대상 재선언.
6. **task-타깃 outcome 유도 (1:1, 모순 없음)**: target='task' → task.status로만 매핑 — `done→satisfied`, `failed→failed`, `cancelled→cancelled`, `open→pending`. (task.status가 이미 done/failed를 가르므로 유도가 자명. 잡 개별 검사 안 함.)
7. **cycle 검사 범위**: job→job + job→task 확장(태스크를 소속 잡으로 펼침). external은 제외.
8. **A2A 협상 멱등**: 요청/수락/역제안이 DB(jobs/deps/external_gates)로 **원자 materialize**. messageId 멱등.
9. **terminal 태스크 불변 + done 단조(latch)**: 태스크가 done/failed/cancelled면 — **어느 레포도** 잡 INSERT 금지, seal 변이·소속 잡 gen++ 금지. task-타깃 dep가 terminal outcome으로 release되면 **latched**(역행 없음). 완료 태스크에 새 일이 필요하면 → **새 태스크**(재개봉 금지 — 기정 원칙). ← 비참여 레포 INSERT·seal삭제·gen++로 인한 done→open 회귀 봉쇄(grok·codex·서브에이전트 공통 지적). P1 상태기계 테스트에 명시 케이스로.

## 잘라낸 것 (과설계 — 3자 감사)

`k_of_n`+k(정족수 시나리오 부재) · `softness`(soft=즉시release=no-op, acceptable이 흡수) · `deadline`(정체타이머와 중복, auto-satisfy 위험) · `outcome=partial`(잡 terminal에 없는 원천 없는 상태; "쓸만함"은 대기자 판단) · `superseded_by`(generation++로 충분, 중복) · `job_lineage`(jobs+deps로 split=children deps, merge=successor all-dep 표현됨) · `job_resources`(단일운영자 규모 과설계, 순서필드 없어 임의직렬화 오답 + 크로스레포 쓰기순서=중앙조율 재등장 → DEFER). **관계 표현법이 2개 이상이면 정의상 과설계.**

페더레이션 사이클탐지 · 분산 dep-release 신뢰성 · durable ack/retry · 크로스DB 합의 · contract 버전관리 · 협상 FSM · 예산/쿼터/왕복상한/승인게이트 — C1 인정으로 불필요하거나 현 규모 미도달.

## 에이전트 wake (기확정 — 유지)

프롬프트 = 얇은 뉘앙스 하나("네 슬라이스 그래프 유연히 관리 — add/split/merge/reorder, dep 선언/철회, 타레포 요청") + 이번 wake의 구체 이유 한 줄. 9-분류 나열 안 함(필터 완전성 스펙일 뿐). 기계 혼자: dep released→ready, ready 스케줄링, 인간 cancel 즉시 집행, coalesce. 에이전트 깨우는 필터 6 + 타이머: ①분해 ②자기완료 편입 ③의존 예외 ④인바운드 A2A 결정 ⑤인간 권한(정리만) ⑥이상·품질 + 정체/주기 타이머.

## 구현 순서

1. **P1** 최소 스키마(products/repos/tasks/task_seals/jobs/deps/dep_members/external_gates) + 상태기계 + 봉합규칙 1·2·3·6·7 + cycle·ready 순수함수 (TDD; 단일 잡·단일 dep = 현행 보존). A2A 주소 `/agents/:repoId/a2a`. 제품 라우터 = 기존 중앙 triage 확장(비주권). executor cwd = `repos.cwd` 해석.
2. **P2** reconcile 컨트롤러 (ready·lease·원자claim·재시작 reconcile·규칙 4·5)
3. **P3** A2A 협상(멱등, 규칙 8) + external_gates 발화
4. **P4** 에이전트 wake 배선(이유 전달) + 분해·발견 판단 write
5. **P5** task_events + 시각화(2층 뷰) + 자율모드 토글 + 개입 UI
