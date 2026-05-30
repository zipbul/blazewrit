# DECISIONS — blazewrit Architecture Ideation

브레인스토밍을 통해 합의된 architecture 결정. evidence는 [.research/2026-trends/](./.research/2026-trends/) 참조.

**Last updated**: 2026-05-25
**Status**: Ideation 합의 (구현 전)

---

## 1. 정체성

- **blazewrit = 1 project 완벽 담당 agent** (UI + workflow + orchestrator 통합)
- 핵심 가치: **"기억 + 일관성 + 시스템 가드"** — vibe coding 병신 코드를 *시스템적으로* 해결
- Karpathy "agentic engineering" (2026-04 Sequoia) framework에 정렬
- "완벽 담당자"는 marketing claim보다 *기억·추적·가드* 본질로 표현

## 2. Scope

- **Multi-project + monorepo 지원** → ziphub 기능 흡수, **ziphub 제거**
- A2A = blazewrit 내부 feature
  - Internal: 같은 instance 내 project ↔ project
  - External: 다른 machine의 blazewrit instance ↔ instance (동일 A2A protocol)
- Project grouping / classification / relationship(deps) 기능 내장
- 미래 enterprise org-level 기능 필요 시에만 별도 layer 검토 (V1 불필요)

## 3. 인터페이스

- **UI 우선 + CLI 유지** (daemon + UI + CLI 동시 — 같은 backend 뷰)
  - UI: 상태 가시성, action, history, A2A peer 상태
  - CLI: scripting, CI, A2A trigger, headless
- `--dangerously-skip-permissions` **유지** — A2A 풀자동에 필수 (permission prompt = 자동화 차단)
- OS sandbox는 *별도* (permission prompt ≠ sandbox) — Seatbelt(mac)/bubblewrap+seccomp(linux)

## 4. Format — purpose별 mixed (single format 강제 X)

| 용도 | format | 근거 |
|---|---|---|
| Inter-agent 통신 | **JSON** (structured_output grammar-enforce) | Anthropic/OpenAI/Gemini native, decoder-level prevention |
| Human review surface | **HTML** | Anthropic 2026 trend (Thariq), rich visual/interactive |
| Spec docs (README, architecture) | **MD** | greppable, diff, version control |
| Reflect 학습 (.claude/rules/) | **MD** | persistent, greppable archive |
| Runtime state | **DB** | queryable, transactional |
| Config | **JSON** (or TOML) | machine read + 가끔 human edit |

→ Phase F 실측: JSON 0.90x MD size, HTML 1.61x (Anthropic 주장 2-4x보다 양호)

## 5. Storage — Postgres 단일 DB (확정)

요구사항: **여러 프로젝트 + 프로젝트별 task + task별 진행상황/사용자 피드백/agent 작업 출력 전체 + observability + 환경 간 공유**.
→ 이 workload는 SQLite로 불가능 (single-writer, file-local, 공유 안 됨). **Postgres 확정**.

근거: Linear / Notion / Devin 모두 Postgres (multi-project agent platform의 industry standard). knoldr도 *이미 Postgres + drizzle 사용 중* → zipbul 생태계 일관성.

### 파일 vs Postgres 경계 — "소비자가 누구냐" (확정, 2026-05 정정)

> 핵심: **워크플로가 생성하는 산출물(ground/investigate/decide/report/flow-history)은 거의 전부 Postgres여야 한다.** 파일이 아니다.
> 이유: 요구 A/B 자체가 "모든 step·출력을 DB에 기록 → UI 1:1 거울 + 제3자 디버깅". 파일로 산출하면 그 요구를 *못 푼다*. (옛 file-first 설계 = legacy 잔재.) 데이터마다 **집은 하나** — 이중 source-of-truth 금지(HARNESS_FLOW_REVIEW의 dual-SoT 갭).

| 카테고리 | 소비자 | 저장 | 비고 |
|---|---|---|---|
| **운영 상태** projects/tasks/flows/step_runs/decisions | UI·쿼리·관측 | **Postgres only** | flow-state.json **폐기** (non-atomic·silent-loss 버그) |
| **워크플로 산출물** ground/investigate/decide/spec/report 결과 | UI(요구 A 거울) | **Postgres** (step_runs/events에 직접 기록) | `.blazewrit/*.html` 파일 산출 자체를 **버림**. 포맷 3중모순(HTML/YAML/.md)도 파일이라 생긴 문제 |
| **agent 전체 I/O / 이벤트** | 디버깅·replay·관측 | **Postgres** traces/events (+ raw jsonl 원본은 파일/blob, Postgres는 포인터) | 요구 B |
| **Facts** verified knowledge | 질의 | **knoldr A2A** | 별도 |
| **에이전트 입력** `.claude/rules`(학습)·CLAUDE.md·AGENTS.md | **Claude Code (파일시스템에서 읽음)** | **파일** | Postgres가 컨텍스트 주입 불가 → 대체 불가. Reflect Tier2 학습의 유일 전달경로 |
| **코드 + (선택)spec/ADR** | git·개발자 | **파일 (git)** | 브랜치 따라 diff/merge. Postgres row 불가 |

**규칙: 파일은 *워크플로 산출물 저장소가 아니다*. 파일 = ① Claude Code가 읽는 입력(룰/학습) ② git이 버전하는 코드, 딱 둘.**

### Postgres schema (초안 — §10/§14 step_runs 모델로 정렬)
```
projects        (id, name, workspace, deps, ...)
work_items      (id, project_id, type, state, active_flow_id, ...)   # §10
flows           (id, work_item_id, flow_type, attempt_no, status, current_step_run_id, ...)  # §10 (1:N)
step_runs       (id, flow_id, parent_step_run_id, step_name, role, attempt_no, status, ...)  # §14 — step 산출물·상태가 여기 (파일 아님)
events          (id, step_run_id, seq, type, payload jsonb, created_at)  # append-only — agent 전 출력 (요구 B)
decisions       (id, flow_id, status, request_type, question, options jsonb, answer, ...)    # §10 HITL
traces          (id, flow_id, agent, input jsonb, output jsonb, tokens, cost, latency_ms, ...) # 관측
user_feedback   (id, work_item_id, content, signal, created_at)
raw_sessions    (session_id, step_run_id, jsonl_path|blob, ingested_at)  # replay 원본 포인터
```
**flow-state.json 없음** — flow 상태는 Postgres flows/step_runs가 단일 진실. **`.blazewrit/grounds|plans|reports/*` 파일 없음** — step 산출물은 step_runs/events.

### Observability — agent orchestrator의 core (optional 아님)
- "왜 이 결정했나" 디버깅 / flow replay / cost 추적 / 워크플로우 개선 = vibe coding 해결 핵심 메커니즘 (측정 없이 개선 없음)
- **V1**: Postgres `traces` table + SQL query + UI dashboard (충분)
- **V2 (수천+ flow scale 시)**: Langfuse self-host (LLM observability 전용 — trace/span/session/replay/eval) upgrade

### Deployment
- Local dev: Docker `postgres:17` (`docker compose up` — knoldr 동일 패턴, Dockerfile.postgres 존재)
- Hosted: Neon / Supabase free tier (multi-machine/team 자동 공유)
- Self-host: 자체 Postgres
- → "local-first 단순함"은 잃지만 *요구사항(multi-project + sharing + observability)이 요구*

### git에 DB commit? — 안 함
- DB(Postgres)는 git 무관 (server/hosted)
- git-committed = *완료 artifact + Reflect 학습*만 (HTML/JSON/MD)

## 6. Architecture layer anchor — Hybrid 3+1+6

(현재 prompt-rule anchor = 0 top tool이 채택 안 한 lane → 전환 필요)

- **Layer 3 (Tool/Sandbox)**: OS sandbox (Anthropic Claude Code 자체 anchor)
- **Layer 1 (Model/Decoding)**: Claude Agent SDK `structured_output` — JSON Schema가 grammar로 compile되어 *위반 token 생성 자체 불가*. paper rule(R13-R27)을 Zod schema field로 승격하면 *bypass 불가*
- **Layer 6 (Verification)**: Aider-style edit-test-repair loop

→ `@anthropic-ai/claude-agent-sdk` 채택 평가 (현재 `claude --agent X --print` CLI wrapper 대체)

## 7. Vector store

- **blazewrit 자체 구현 X**
- knoldr이 verified knowledge graph + semantic search + claim verification 제공
- blazewrit의 fact verification / RAG context / past-similarity → **knoldr A2A 호출**
- blazewrit Postgres는 자기 project state + observability만 (knoldr과 별도 DB)

## 8. zipbul ecosystem 역할 분리 (Unix philosophy)

| Component | 역할 |
|---|---|
| **knoldr** | 데이터 백본 (verified facts + KG + authority learning + CoVe) |
| **emberdeck** | 코드 knowledge graph (intent/spec ↔ code, drift detection) |
| **firebat** | code quality scanner |
| **pyreez** | multi-model deliberation |
| **blazewrit** | single-project agent (UI + workflow + orchestrator) |
| **ziphub** | **제거** (blazewrit multi-project로 흡수) |
| baker / gildash / toolkit / zipbul | (조사 필요 — 미파악) |

각자 *한 가지 잘함*. blazewrit은 emberdeck/firebat/pyreez/knoldr 모두 *optional + graceful degrade* (단독 출시 가능).

## 9. 방법론 결정 (검증됨)

- **paper rule 추가 (R28-R36) 중단** — 떡칠. detection은 LLM judgment 의존이라 한계.
- **근본 해결 = layer 이동** (Agent SDK structured_output = grammar enforcement)
- R13-R27 paper rules는 폐기 아닌 *Zod schema field로 승격* → mechanical enforcement

## 9b. 원칙 — Flow step ↔ Task status 1:1 매칭 (확정)

blazewrit의 **전체 flow + 각 step + step 사이의 review 과정 하나하나**가 UI 태스크의 status와 **1:1로 매칭**된다.

- status는 "진행중/완료" 같은 뭉뚱그린 값이 아니라, **flow의 step·review 진행 상태를 그대로 비추는 거울**.
- step이 N개면 status가 그 N개 단계(+ review 단계)를 정확히 반영.
- UI에서 태스크를 보면 *지금 정확히 어느 step에 있고, reviewer 도는 중인지, 통과했는지* 알 수 있어야 한다.
- 또한 에이전트/서브에이전트의 **모든 출력물이 기록**되어 제3자가 전 과정을 replay/디버깅할 수 있어야 한다. (요구 B)

→ 이게 §10 데이터 모델·통신 설계의 상위 제약. (구체 스키마/통신 방식은 아직 brainstorming 단계, 미확정)

## 10. Task Data Model (Claude + Codex 이중 적대 리뷰 합의)

UI/data 핵심. 두 reviewer가 *놀랍도록 일치* — "over-typed and under-related" 진단.

### Schema

```sql
work_items (
  id, project_id, title, description,
  type   enum('bug','feature','task'),   -- 3개 (GitHub default). idea=inbox state, question=HITL, improvement/chore=label or flow_type
  labels text[],                          -- MVP 정규화(lowercase+dedupe), Phase 2 label_groups 승격 (rot 방지)
  state  enum('inbox','backlog','blocked','in_flow','done','rejected'),  -- 6개. ready=computed predicate (저장 X)
  priority, source enum('user','agent','audit'),
  active_flow_id null,                    -- 현재 active flow pointer (partial unique: 1 active만)
  resolution, completed_by, completed_at, -- flow 없이 done 가능
  created_at, updated_at
)

flows (                                   -- work_item : flow = 1:N (핵심)
  id, work_item_id,
  flow_type enum('feature','bugfix','refactor','research','migration','audit',...),  -- triage 결정
  attempt_no, trigger enum('triage','retry','reclassify','audit'),
  supersedes_flow_id null,                -- retry/reclassify chain
  status, current_step, outcome, closed_reason,
  created_at
)

work_item_relations (                     -- planning graph (누락됐던 핵심)
  id, source_id, target_id,
  relation enum('parent','blocks','relates','duplicates','caused_by')
)
```

### 핵심 결정 (이전 합의 수정)

| 항목 | 결정 | 이유 |
|---|---|---|
| **type** | 3개 (bug/feature/task) | GitHub default, 검증됨. 7개는 over-typed. idea=state, question=HITL, improvement=label |
| **labels** | text[] (MVP, 정규화) → label_groups (Phase 2) | Codex: ungoverned text[]는 수주 내 shadow schema rot |
| **state** | 6개 (inbox/backlog/blocked/in_flow/done/rejected) | ready=computed predicate (저장 시 drift). triage→inbox 흡수 |
| **work_item ↔ flow** | **1:N** (active_flow_id + supersedes_flow_id + attempt_no) | **#1 risk**: 1:1은 retry/reclassify/audit/provenance 파괴 |
| **flow_type ≠ type** | flow_type은 flow에만 (triage 결정) | 같은 type=bug가 triage 결과 bugfix or research. 1:N이라 정당 |
| **flow optional** | trivial work는 flow 없이 `done` (resolution 기록) | 9-step 오버킬 방지 (friction risk) |
| **graph** | work_item_relations edge table (parent/blocks/relates/duplicates/caused_by) | 누락 시 plan 불가. ready predicate도 deps로 계산 |
| recurring / milestone | **defer** | single-project = project가 scope |

### Top 3 risk (두 reviewer 공통)
1. 1:1 가정 = retry/rework/audit/provenance 파괴 (최우선)
2. ungoverned tags = shadow schema rot
3. 모든 것을 flow로 = trivial work friction

### Decision request (HITL — UI)
```sql
decision_requests (                       -- 모든 HITL 단일화 (NEEDS_CONTEXT 흡수)
  id, flow_id, step_run_id, requesting_agent,
  status      enum('open','answered','expired','cancelled'),
  request_type enum('approval','free_text','single_choice','multi_choice'),  -- MVP: approval+free_text
  question, options jsonb,                -- options: {label, value, risk, recommended, effect}
  context jsonb,                          -- why_asking, findings, evidence
  blocking boolean,                       -- true=step pause / false=provisional 계속
  default_action jsonb, answer jsonb, answered_by, answered_at, expires_at
)
```
- UI: flow timeline inline card + 전역 decision inbox (multi-project)
- options에 risk/recommended/effect 표시 → user informed decision
- LangGraph `interrupt` durable pause/resume 패턴

### Task type → UI 표시
| type | icon | → triage flow_type 예 |
|---|---|---|
| bug | 🐛 | bugfix / research (재현 불가 시) |
| feature | ✨ | feature |
| task | ✓ | chore / refactor / test / ... |

(idea = state=inbox의 task, question = decision_request)

## 10b. UI/UX 컨셉 (Claude 서브에이전트 + Codex 창의 브레인스토밍 수렴, 미확정·시각 미검토)

> 두 에이전트가 메타포 6~7개씩 던진 뒤 **독립적으로 같은 결론에 수렴.** 단 사용자가 아직 화면을 눈으로 못 봐서 *미확정* (반영만).

**메타포: 지하철 노선도** — 요구 A(step 1:1 거울)에 구조적 최적.
- 역 = step, 역 사이 검표소 = reviewer 관문 → 1:1 매칭이 메타포에 내장
- 유기체/강/궤도는 아름답지만 step 경계가 흐려 요구 A에 불리 → 탈락 (둘 다 같은 이유)

**5-요소 화면 구성 (2층 + 보조 패널):**
1. **Mission Control** (상위, 다 태스크) — 여러 flow = 함대 현황판, attempt/verify_failure를 텔레메트리로
2. **지하철 노선도** (줌인, 한 태스크) — 현재 위치 = 거울 (요구 A)
3. **타임라인 스크러버** (어떻게 왔나 + replay 디버깅, 요구 B) — checkpoint = Git 커밋 마커
4. **사고 스트림 패널** — 라이브 토큰 스트리밍 + tool 동사 라벨, 활성 노드 맥박/발광
5. **HITL 결정 카드** (요구 C) — 4축 위험(비가역성/영향반경/컴플라이언스/확신도)으로 색·크기 차등

**비선형 시각화:**
- 되감기 = 열차 역주행 + Git rebase식 rewind 화살표
- Ralph loop = 왕복 셔틀 + 회차 뱃지(×2,×3), 회차↑ 시 간선 굵어짐/붉어짐(고전 경고)
- sub-flow = 지선 분기 / matryoshka 드릴다운
- 서브에이전트 = 접히는 가지 트리

**flow_type 차이:** "유령 step" — 전체 step 슈퍼셋을 흐린 placeholder로 깔고 실재 step만 점등. 조건부 step은 점선+물음표.

**핵심 위험 + 해법:** 비선형 폭증 시 노선도 스파게티화 → **공간 복잡도를 시간축(타임라인 스크러버)으로 떠넘김** (노선도=현재 스냅샷, 타임라인=경로). calm design + progressive disclosure(기본 고요, 깊이는 펼침).

**리서치 근거:** LangGraph Studio/LangSmith(토큰 스트리밍·checkpoint=Git트리 replay), GitHub Agent HQ(Mission Control), HITL 4축 위험모델, Dagster/Airflow(DAG run view), 2026 calm/spatial UI 트렌드. (.research 추가 문서화 필요)

## 11. 미결정 (다음 brainstorm 필요)

- [ ] 명명: "vibe coding tool" vs "agentic engineering tool" vs "Vibe done right"
- [ ] MVP scope: 1 project full → multi-project 단계
- [x] **UI tech: Angular 21/22 (사용자 숙련 + 앱 프로파일 정합 — 리서치 판정 완료)** → 세부는 §11b
- [x] **Backend: zipbul 프레임워크** (Bun-native, §13). DTO = @zipbul/baker.
- [ ] Observability: Langfuse self-host vs 자체 JSONL log
- [x] **A2A protocol: 채택** — 실행/통신 아키텍처 = A2A per-repo 에이전트 (§14). 전송도 A2A 네이티브(TaskStatusUpdateEvent + TaskArtifactUpdateEvent)로 검증 완료.
- [x] **zipbul = Bun 웹 프레임워크 / baker = DTO 검증 라이브러리** 확인 (§13). gildash/toolkit 정체는 미파악

## 11b. UI tech 판정 — Angular (리서치 기반, 2026-05)

**결론: Angular 21/22 채택. 이 앱 프로파일(복잡·장기유지·실시간 대시보드·SSR불필요)에 정합.**

| 고려사항 | 판정 |
|---|---|
| **버전** | Angular 21(2025-11, zoneless 디폴트·signals 성숙·Vitest stable). v22(2026-05, Signal Forms stable) 릴리스 중. 신규 프로젝트 = zoneless+signals 자동 |
| **실시간 성능** ✅ | zoneless+signal = fine-grained, 30-40%↑, 스트림 3x 반응성. 토큰 스트리밍·수백 라이브 노드(이 앱 핵심)에 signal이 최적. RxJS(스트림 오케스트레이션)+signal(렌더) 조합 이상적. → 이전 "Solid/Svelte 우위" 논거 소멸 |
| **시각화** ⚠️(중립) | D3는 "Angular DOM 충돌" → D3는 레이아웃 수학만, 렌더는 Angular/Canvas. 차트=ECharts(Canvas/SVG 듀얼)/Unovis(TS·Angular래퍼). 노선도·스크러버=커스텀 SVG+signal, 폭증 시 Canvas/WebGL. **프레임워크 무관 난이도** |
| **SSR/Next.js 비교** ✅ | 인증 라이브 대시보드 = SEO/SSR 불필요 → Next.js 주무기 무용. SPA 충분, Angular 불리 이유 없음 |
| **데스크톱** | daemon이 HTTP/SSE 서빙 → **웹앱으로 끝낼 수 있음(셸 불필요)**. 필요 시 Tauri(25x 작음, 단 커스텀 Canvas 플랫폼 편차) vs Electron(무겁지만 렌더 일관, heavy 대시보드엔 안전). **웹앱 우선** |
| **Bun 호환** ✅ (정정) | Angular CLI는 bun을 **패키지매니저로만 공식 지원**(v17.2~). **Angular 공식 런타임 = Node.js 뿐**(angular.dev/reference/versions, Bun/Deno 미언급. bun-런타임은 미구현 feature request #25809). → 정석 = **bun=설치, node=ng 실행**. 실무: 스크립트는 `ng serve`/`ng build` 그대로, **`bun run start`로 실행하면 bun이 shebang(`#!/usr/bin/env node`) 존중해 자동 node 런타임** → 깔끔+공식. ⚠️ **`bun --bun`은 쓰지 말 것**(bun 런타임 강제 → watchpack `fs.watch` 크래시, §16 참조). 이전 "`bun --bun run ng build`" 표기는 오기 |
| **유일한 실질 비용** ⚠️ | agent/observability UI 생태계가 **React 중심**(LangGraph Studio류) → Angular는 기성 컴포넌트 빈약, 커스텀 비중↑. 단 메타포가 어차피 커스텀이라 페널티 축소 |

**권고 스택:** Angular 22 (zoneless+signals) + RxJS(스트림) + signal(렌더) + ECharts/Unovis(차트) + 커스텀 SVG/Canvas(노선도·타임라인). 데스크톱은 웹앱 우선.

**리서치 출처:** [Angular v21 announce](https://blog.angular.dev/announcing-angular-v21-57946c34f14b), [v22 shift](https://medium.com/angular-engineering/angular-22-the-shift-to-signal-first-zoneless-and-performance-driven-architecture-b0d5a68f51e6), [zoneless 성능](https://push-based.io/article/angular-v21-goes-zoneless-by-default-what-changes-why-its-faster-and-how-to), [Angular 차트 라이브러리 2026](https://weavelinx.com/best-chart-libraries-for-angular-projects-in-2026/), [Tauri vs Electron 2026](https://www.pkgpulse.com/guides/electron-vs-tauri-2026)

## 12. 설치 & CLI (확정 — 삼자 리뷰 반영)

타깃: **개발자 전용** (비개발자는 나중 레이어). 로컬 설치, self-setup. 검증 관례: supabase CLI / vercel link.

### 도구(글로벌) ≠ 인스턴스(로컬)
- `bz` = **npm/bun 글로벌 바이너리, 무상태, 순수 도구.**
- 워크스페이스 = **격리 경계.** 디렉토리마다 자체 config + 자체 DB + 자체 daemon 포트. cwd에서 위로 탐색(git `.git` 방식). 홈디렉토리 강제 없음.
- 인스턴스 여러 개 = 사용자 자유. **단 디폴트 서사 = "1 instance에 multi-project"** (인스턴스 남발 시 A2A-internal 희석되므로 분리는 예외로 유도).

### CLI 표면 = 4개 (lifecycle만)
```
bz new <dir>   # 워크스페이스 생성: config.toml + docker-compose.yml 스캐폴드
bz start       # cwd 워크스페이스 daemon 부팅 (+ UI 서빙 + 브라우저). UI는 daemon이 서빙하므로 부팅은 CLI가 유일 진입점(닭-달걀)
bz stop        # daemon 정지
bz restart     # config 편집 후 재기동
```
- **나머지 전부 UI에서**: 프로젝트 관리(어떤 repo, A2A 연결), config 편집, logs, 워크플로우 트리거.
- **DB 부트스트랩**: `bz new`가 config.toml 스캐폴드 → 사용자가 DB 연결 직접 편집(self-setup) → Postgres(docker-compose 생성본) 띄우고 `bz start`. (UI 내 config 편집은 나중 편의 레이어)

### 핵심 원칙 — 기능은 백엔드, CLI는 entry만
> 모든 기능 로직은 `core` 패키지(백엔드)에 있고, CLI·daemon·UI는 *같은 core를 다른 entry로 호출*할 뿐.

- → CLI 표면을 지금 다 설계할 필요 없음. CI/headless가 나중에 필요하면 `bz project add` 같은 얇은 entry만 추가(로직은 core에 이미 존재, 재작업 0).
- → **headless 부재 = 구멍(과소설계) 아님, core 공유 덕에 안전하게 미룬 것.**
- → CLI/daemon이 같은 core 호출 → "cmdRun/cmdNext 권위 불일치"류 구조적 차단.

### 삼자 리뷰 적용 사항
- 과설계 덜어냄: `bz config`(읽기 단독)·`bz migrate` 최상위 노출 제거 → migrate는 `bz start` 자동 적용.
- 가드레일(필수): `bz start`/`stop`/`restart`는 resolve된 워크스페이스 경로 출력. `bz new`가 상위 config 존재 시 경고(중첩 방지).
- §3 갱신: "CLI = 부팅 진입점만. 자동화는 A2A 프로토콜(daemon)·UI로." (CLI headless 트리거 요구 철회 — A2A는 daemon 네트워크 프로토콜이라 불변)

### 데몬/Postgres
- daemon = 코드 사는 곳(로컬/WSL/VM)에 위치. UI는 HTTP/SSE 클라이언트(브라우저). **Electron 없음** (WSL/VM에서 daemon-번들 Electron은 깨짐, 브라우저는 WSL2 localhost 포워딩으로 그냥 됨).
- Postgres = **bring-your-own + docker-compose 편의 생성**(번들 안 함).

## 13. Backend = zipbul 프레임워크 / DTO = @zipbul/baker (확정 — 실측 반영)

### 생태계 정체 (전수 확인)
- **zipbul** = Bun-native 웹 **프레임워크** (NestJS-inspired + AOT 컴파일 + DI + HTTP adapter, Node 미지원). v0.0.1 개발 중. → "backend는 zipbul로" = **BE를 zipbul 프레임워크로 작성** (반쯤 만든 앱 아님, BE 짜는 프레임워크 = NestJS/Fastify 자리).
- **@zipbul/baker** = AOT 데코레이터 기반 **DTO 검증/직렬화 라이브러리** (`@Recipe`/`@Field`/`seal()`/`deserialize()`, "zod-alternative", zero reflect-metadata, Bun ≥1.3.13). v3.0.0 성숙.

### 단순화된 런타임 모델 (사용자 정정 반영)
```
zipbul = BE   ← CLI(bz) 내장 + API(HTTP/SSE) 내장 + 모든 로직 내장
FE     = Angular
daemon = FE + BE 실행만 하는 얇은 러너 (bz start → FE+BE 부팅)
```
- §1의 core/agent-runner/db/a2a 6패키지 분해 = **zipbul 내부 구현 디테일**일 뿐, 배포 관점은 "zipbul(BE) + FE + 실행 daemon".

### DTO = @zipbul/baker로 통일 (공유 패키지)
- monorepo면 publish 불필요 → **공유 `dto` 패키지(baker `@Recipe` 클래스)를 FE·BE·mock 셋이 워크스페이스로 import.** 계약 drift 원천 차단.
- Zod/순수 TS 선택지 무의미 — 생태계에 baker가 그 자리.

**FE(브라우저) 작동 실측 (2026-05):**
- baker README "Bun-only / Node가 Symbol.metadata 미populate"는 *tsc/Node 네이티브* 데코레이터 한정.
- **esbuild(=Angular 파이프라인)가 `Symbol.metadata`를 populate** → esbuild 번들을 V8(node)에서 실행 시 baker 런타임 검증 정상 동작 확인: 정상 `OK`, 실패 입력 `ISSUES[name:minLength, age:min]`(no-op 아님), `UserDto[Symbol.metadata]=true`.
- → FE에서 **런타임 검증까지 가능** (타입만 아님). BE·FE 동일 baker DTO 사용.
- **단서**: ① node V8을 브라우저 proxy로 측정(실제 브라우저 DOM 1회 더 권장, 단 데코레이터 메타데이터는 DOM 무관이라 확신 높음) ② FE 번들 +131KB(baker+result) — 런타임 검증 실으면 비용.

### 프론트-퍼스트 (zipbul 개발 중)
- FE는 dto 계약에만 의존 → **미니 mock 서버**(REST 카드 + SSE로 녹화 세션 jsonl 재생)로 라이브 UI 선개발 → zipbul 완성 시 URL 스왑.
- Storybook으로 무거운 커스텀 뷰(노선도·스크러버) 고립 개발.

## 14. 실행/통신 아키텍처 — A2A per-repo 에이전트 (확정)

현재 코드의 "orchestrator가 `claude --print` 직접 spawn"은 **폐기**. 새 모델:

```
[bz daemon]  ──A2A client──>  [repo의 A2A server + 전용 에이전트(Claude Code)]
   · flow 상태 보유                · repo 안에서 실제 실행
   · UI/DB/관측 (system of record) · worktree·git·브랜치·파일수정 전부 자기 책임
   · 내용(태스크/지시)만 전달  <──A2A── 진행상황·전 출력 회신
```

### 책임 경계
| 단계 | 주체 |
|---|---|
| **실행 + 캡처** (전 출력 생성·수집) | **repo 에이전트** (Claude Code stream-json/jsonl이 존재하는 유일한 곳) |
| **전송** | **A2A** (2 이벤트 타입, 아래) |
| **저장·관리·조회** | **bz** (중앙 DB = system of record, 멀티프로젝트 관측) |

- bz는 repo 파일시스템·git·**worktree를 안 건드린다** — 전부 repo 에이전트 소관.
- bz는 각 repo 에이전트의 **A2A 주소만** 알면 됨 → "repo 흩어진 채 vs bare clone"은 bz와 무관.
- bz의 "관리" = **저장/소유(DB)**지 실행 아님.

### A2A 전송 (공식 spec 검증, 2026-05)
`message/stream`(SSE) 위 2 이벤트:
- **TaskStatusUpdateEvent** = lifecycle 상태 + 중간 메시지 → **요구 A**(step 1:1 거울, 라이브)
- **TaskArtifactUpdateEvent** = `append`+`lastChunk` 청크 스트리밍(대용량 파일/데이터용 설계) → **요구 B**(전 raw 출력)
- 대용량(예: 13M jsonl)은 `FilePart.bytes`(base64 인라인) 말고 **`uri` 참조 또는 청크** 권장. spec상 명시적 크기 제한 없음.
- → **A2A 네이티브로 전 출력 전송 가능, 추가 메커니즘 불필요.** bz는 두 스트림 받아 DB 적재.

### 대화 → Triage 경계 (확정 — HARNESS_FLOW_REVIEW 테마① 해결)

문제: Triage가 대화/명료화 루프를 "host LLM glue"로 위임 → 바이브코딩의 지배적 루프가 step pool 밖, 미설계.

**해결: 대화는 flow가 아니다. 경계는 *사람의 작업 커밋*이다 (LLM 분류 아님).**

```
대화 (repo 에이전트 native 모드 · bz가 프록시+기록 · flow 안 탐 · events에 flow_id=null)
   ├ 명확한 명령 ───────────────→ Triage 발동 → flow 시작 (worktree/steps/실행)
   └ 모호 → 에이전트 "작업으로?" 제안 → 사람 확인 → Triage
```

- **별도 "대화 레이어"·LLM turn-classifier(L0) 없음** — over-engineering. 대화는 에이전트 기본모드, bz는 채팅 로그만.
- **트리거 = 사람 의도** (UI "작업 시작" / 명확한 명령). 잡담↔작업 판정을 *사람이* → 더 단순(부품↓) + 더 확실(LLM 오분류 없음) + "that's not what I meant" 안전장치 공짜.
- 트리거가 mutation *이전*이어야 함(flow가 계획→mutation 순서) → mutation 기반 자동판정 불가, *판단*은 필수, 그 판단을 사람에 둠.
- **per-repo**: 대화는 bz 레벨(멀티레포 인지), Triage+flow는 repo 레벨. "API랑 웹 둘 다" → bz가 라우팅 → 각 repo가 자기 Triage/flow.
- 정직한 한계: "THE 최단순" 증명 불가(설계 trade-off), 단 L0 버전보다 명백히 단순+확실. 유일 조건 = 모호 시 에이전트 제안→사람 확인, 명확하면 auto.

**별개 미해결 (테마①과 혼동 금지)**: trivial 작업("더 파랗게")은 *작업*이라 Triage는 타되 9-step 풀 flow면 과함 = **flow 무게** 문제. → `complexity_signal=trivial`이면 *경량 micro-flow* 라우팅으로 따로 해결 (테마②/③와 함께 하네스 재설계 시).

## 15. FE 화면 패러다임 & 디자인 스택 (리서치 확정, 2026-05)

### 화면 패러다임 — "워크스페이스 셸" (7 라우팅 화면 → 1 셸+패널)
best-in-class dev-tool 전수조사(Linear/VS Code/Temporal/LangSmith/Dagster/Sentry/Vercel/GitHub): **"기능마다 독립 페이지"를 쓰는 곳이 하나도 없다.** 전부 워크스페이스 셸 + 패널/뷰 전환 + ⌘K.

```
┌─ Activity rail ─┬─ Primary 패널 ──────┬─ Detail 패널 ──────────────┐
│ (영역 스위처)     │ (마스터: 리스트/노선도) │ (선택 엔티티 디테일)          │
│ • 워크스페이스     │ 프로젝트>태스크 / flow  │ 태스크: 라이브⇄replay 토글     │
│ • 태스크          │                      │  + 타임라인 스크러버           │
│ • 결정함          │                      │ 결정: diff + approve/edit     │
│ • 연결모니터       │                      │                             │
└─────────────────┴─────────────────────┴────────────────────────────┘
  하단: 연결/스트림 status bar (calm, 상시)       ⌘K: 전역 액션·이동
```
- 셸 안 영역(뷰): 워크스페이스 / 태스크(**라이브⇄replay 토글** — 별 페이지로 쪼개지 말 것, Temporal·LangSmith 교훈) / 결정함 / 연결모니터
- 셸 밖 별도 라우트: **온보딩**(1회성 풀스크린), **설정**(가끔 방문)
- **⌘K = 항상 얹는 레이어** (검색 아니라 *액션 실행기*: 태스크 시작/중단/결정 승인). 시각 UI를 대체 아닌 가속.
- 레이아웃 영속화(VS Code), 일관 셸 크롬(Linear 2026), progressive disclosure + calm design.

### 디자인 스택 — bespoke 헤드리스 + 토큰-퍼스트 (최고 룩)
"최고 UI/UX" = 컴포넌트 라이브러리 룩 아님(Linear/Vercel은 bespoke). 핵심 viz(노선도/타임라인)는 어차피 커스텀 → 라이브러리는 셸/폼/⌘K만.

```
디자인 토큰 (Tailwind v4 CSS-first, CSS vars)      ← 룩의 단일 진실. 클래스 흩뿌리지 말 것
   └ Angular CDK (a11y/overlay/drag-drop)          ← 동작 기반 (도킹/리사이즈 패널!)
      └ Spartan/ui (shadcn 룩, signals-built·zoneless-ready·SSR) ← 컴포넌트
         └ 커스텀 viz (노선도/타임라인, SVG/Canvas)  ← 핵심
폼: Angular Reactive/Signal Forms(로직, 재구현 X) + Spartan primitive(비주얼)
```
- **토큰-퍼스트**: tokens→primitives→components→themes 레이어. Tailwind 클래스를 public API로 노출 금지(재작성 방지).
- **레이어 근거**: 헤드리스+Tailwind = 2026 업계 방향(동작 안정/표현 적응). Spartan = 가장 성숙한 shadcn-for-Angular, **zoneless ready 명시**.
- **도킹 멀티패널**은 Spartan만으론 안 나옴 → **Angular CDK drag-drop/overlay**(+ 필요시 angular-split).
- 폼은 blazewrit에서 소수(설정/온보딩/결정답변) — 로직은 Angular가, 비주얼만 스타일.

### 단서
- **ng-primitives**(Radix 포팅)도 헤드리스 후보지만 **pre-1.0(API 불안정)** → 주력은 Spartan.
- bespoke = 제작 비용↑, 단 토큰-퍼스트로 재작성 방지해 회수.
- 리서치 출처: [Spartan](https://www.spartan.ng/), [ng-primitives](https://angularprimitives.com/), [Temporal viz](https://temporal.io/blog/lets-visualize-a-workflow), [Linear UI 2026](https://linear.app/now/how-we-redesigned-the-linear-ui), [VS Code layout](https://code.visualstudio.com/docs/configure/custom-layout), [Tailwind v4 design system 2026](https://medium.com/@flaviusson/design-systems-at-scale-tailwindcss-angular-material-headless-ui-2026-best-practices-1b43a6ad8f61)

## 16. FE 구현 — 구조 · 모던 문법 · 런타임 (확정, 삼자 리뷰 + 공식 문서 검증)

### 디자인 언어 = M-dark (확정)
다크 글래스모피즘 + 그라디언트 메시, Bricolage Grotesque / Spline Sans Mono. Spartan/shadcn 표준 토큰 구조에 M-dark 값(dark-first) + glass/mesh 커스텀 토큰. 3뷰(Dashboard 벤토 / Board 칸반레인 / Canvas 노드)가 **동일 글래스 카드 스펙**(blur 24 / border .08 / radius 16 / shadow 0 14px 44px). bg `#0a0816`.

### 디렉토리 구조 = 공식 스타일가이드 정합
- **feature 기반.** `components`/`services`/`directives` 등 **타입 디렉토리 금지**(공식 명시). **core/shared 안 만듦**(공식 미처방 + 타입버킷화 위험 — 삼자리뷰 합의로 내 이전 core/shared 제안 폐기).
- suffix 없음(`dashboard.ts`), 하이픈 네이밍, one-concept-per-file, `.spec.ts` co-located.
- 구조: `src/app/` = `app.*` + `layout/shell/` + `features/{dashboard,board,canvas}` (+추후 `decisions/`,`connections/`). cross-cutting(zipbul BE 클라이언트·A2A/SSE 스트림·signal 스토어)은 타입버킷 대신 **도메인 개념 폴더**(`data-access/`,`tasks/`,`connections/`)로 *BE 붙일 때* 생성.

### 모던 문법 = stable만 적극 (삼자리뷰 합의)
- ✅ **쓴다**: signals/computed/effect, **zoneless**(provider 명시), `@if/@for/@switch/@defer`, `inject()`, signal `input/output/model`, `[class]/[style]`, **OnPush**, `toSignal()`.
- ⛔ **v22까지 보류(experimental)**: `resource()`, `httpResource()`, **Signal Forms**.
- **SSE/A2A 스트림 = `EventSource` + RxJS + `toSignal()`** (resource류는 단발 req/res라 부적합 — 정정).
- 적용된 cleanup: `provideZonelessChangeDetection()` 명시, 전 컴포넌트 OnPush, 라우트 `**` 와일드카드, 깨진 spec 수정, lazy `loadComponent`.

### 런타임 / 빌드 / watcher (공식 검증)
- **Angular 공식 런타임 = Node.js만** (angular.dev/reference/versions: 21.0.x = `^20.19||^22.12||^24`. Bun/Deno 미언급, bun-런타임은 미구현 요청 #25809).
- **bun = 패키지매니저 + 스크립트 러너.** `bun run start/build` → bun이 ng shebang(node) 존중 → **자동 Node 런타임** = 공식 정합 + 깔끔.
- **`bun --bun` 금지**: bun 런타임 강제 시 **Bun `fs.watch`가 rename에서 filename=undefined 반환 → watchpack 크래시**(Bun 버그 #23306/#11327/#14699, `ng serve` watch 사망). 빌드는 우연히 동작하나 비공식.
- "Bun-only(no node)"는 **Angular CLI를 자작 dev-server로 교체해야** 가능(커뮤니티 `kream0/bung`) → 비공식·유지보수 부담·CLI 상실로 **기각**.
- 프로젝트가 Linux fs(`/home/revil`)라 `--poll` 불필요(WSL `/mnt/c`였다면 필요).

### 스택 (apps/fe)
Angular 21.2 (zoneless 기본) + Tailwind v4(CSS-first) + Spartan/ui(+@angular/cdk) + bun(PM/러너) + node(ng 런타임). build/serve/test 전부 `bun run <script>`로 node 위임.

---

## Evidence Base

상세 근거는 [.research/2026-trends/](./.research/2026-trends/):
- 01: Vibe coding → agentic engineering paradigm shift
- 02: MD vs HTML vs JSON format trends + 벤치마크
- 03: Spec → issue/session workflow 이동
- 04: Chronic problems 정량 (tech debt 3x, security 40-62%, METR -19%)
- 05: Architecture patterns (6 canonical + 8 spec-driven + layer 분포)
- 06: 17 tool deployment models
- 07: blazewrit implications
