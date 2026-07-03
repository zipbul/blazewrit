# blazewrit

**blazewrit is a multi-project agent platform that converts user intent into agentic workflows, executes them to produce optimized work, and learns from the results to improve itself.** It manages tasks per project; each project has its own dedicated agent and A2A server through which projects collaborate and auto-generate tasks. Self-configuration — creating projects and wiring their relationships — is handled by a higher-level agent, while the human only inputs intent, makes decisions, and monitors through the UI.

## 코드 기준 (2026-07-03 확정 — 위반은 기능보다 우선 수정)

### 기계 게이트 (`bun run check` 실패 = 머지 불가)
- **G0** tsc strict + eslint + 경계검사(dependency-cruiser) + knip + bun test + 시크릿스캔. 기존 위반은 CI 생성 베이스라인에 격리(위반-ID diff, 손편집 fail, 총량 증가 fail)
- **G-META** 게이트 설정·베이스라인·화이트리스트·이 문서 = 보호 경로: 수혜 커밋과 동시 변경 금지, 오너 승인 별도 커밋만
- **G1** 경계: 쓰기=라우트만 / 중앙 에이전트=읽기전용 뷰(bw_v_*)만 / import 방향 위반 fail (동적 import 우회 금지)
- **G2** 수직 슬라이스: 기능=폴더 1개, 외부에선 barrel(index.ts)로만 접근. 전부-재수출 barrel은 위반
- **G5** 파일명: `역할.종류.ts` 고정 목록(.tool/.contract/.routes/.store/.sql/.spec…). 새 종류=책임 정의 1줄+오너 승인
- **G8** 의미 있는 값은 이름 필수(같은 의미=상수 1개, 슬라이스당 상수 모듈 1곳). 관용값(0,1,-1, 라우트 내 HTTP코드, 테스트 픽스처) 허용
- **G15** 죽은 코드: 고아를 만든 커밋이 삭제(knip). 살리기용 가짜 참조/스펙 = J11 위반
- **G16** any 금지. as·!·@ts-expect-error는 성립 근거를 file:line/스펙명으로 인용해야만(바이브 주석 무효). `as const` 허용
- **G17** 의존성 정확 고정(latest/^ 금지), lockfile CI 검증, bun audit
- **G-TEST** 신규 .routes/.tool/.store 파일에 spec 없으면 fail. TDD: 행동 변경은 선행 실패 스펙을 지목해야

### 판단 티어 (크로스리뷰 고정 렌즈 — 규칙별 근거 인용 필수, 맨몸 'pass' 무효)
- **J3** 뻔하지 않은 결정(대안을 기각한 결정)엔 왜를 남김. 뻔한 코드에 왜-보일러플레이트 금지
- **J4/J6** 1파일·1함수 = 1책임. 판정: 리뷰어가 코드만 보고 책임 한 문장을 콜드 작성 + 변경 동인(어떤 요구 변화가 수정을 강제하나) 2개면 분리. 숫자(줄수·복잡도)는 신호일 뿐 절대 pass/fail 아님
- **J9** 지식 중복 금지(진짜 DRY): 한쪽만 고치면 버그가 되는 두 코드 = 중복 → 진실원 1개. 우연히 닮은 코드는 중복 아님 — 다른 이유로 변하는 걸 합치면 그게 위반(잘못된 결합)
- **J10** 땜질 금지: 이 repo가 소유한 코드는 원인만 고침. 신뢰 경계(A2A/HTTP/에이전트 입력) 검증은 땜질 아님(필수). 임시=`TEMP(ISO날짜, 검증가능조건)` + append-only 레지스트리, 만료=위반
- **J11** 테스트=행동 검증만. mock은 구조적 external(프로세스/네트워크/시계/fs/난수 경계)만 — 순수 로직을 서비스로 포장해 mock = 세탁 = 위반. 실패 경로 스펙 필수
- **J12** 무음 catch 금지. 모든 실패는 typed error 전파 or 태스크 기록. log-만-하고-계속 = 무음 삼킴
- **J13** 외부 입력은 진입점 스키마 검증. 보안 자세는 선언이 아니라 스펙이 assert(bind 주소/미들웨어). 검증 불가 선언=부재
- **J14** 스키마 변경=순번 마이그레이션 파일. CI가 scratch DB 적용→schema와 diff로 파생성 검증
- **J18** A2A/오케스트레이터 핸들러는 중복 수신 안전 — 중복배달 스펙(2회 전송→효과 1회)으로 증명. 다단계 변이는 트랜잭션 or 명시 보상
- **J19** (트리거: 배포 단위 밖 소비자 발생, 발동은 오너가 DECISIONS.md에 기록) 계약 버저닝
- **J-OPS** PG 자동 pg_dump + 분기별 복원 리허설. 백업은 복원해봐야 백업

**부트스트랩(G-BOOT)**: `bun run check`+CI+베이스라인이 실물로 서기 전까지 G티어는 ADVISORY. 첫 감소분 = 현행 G17 위반(latest/^ 핀) 제거.
