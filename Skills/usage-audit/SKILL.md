---
name: usage-audit
description: Audit what this Claude Code installation costs in tokens on every request, and how it actually performs. Measures the extension surface (MCP servers, skills, hooks, plugins, subagents) byte-by-byte, cross-references it against real usage mined from session transcripts, and renders an HTML report. Surfaces unused extensions still charging token rent, duplicate tool registrations, reliability drift in long sessions, and tools with high failure rates. Read-only — never modifies configuration. Use when the user asks to audit/measure/reduce their setup cost, find unused or duplicate MCP servers and extensions, check token waste, or analyze recurring session failures. Trigger phrases "/usage-audit", "usage audit", "audit my setup", "what is my config costing", "find unused extensions", "사용 감사", "내 설정 비용 분석", "MCP 비용 얼마나", "안 쓰는 확장 찾아줘", "토큰 낭비 점검", "세션 실패 패턴 분석".
---

## 무엇을 하는 스킬인가

세 단계를 순서대로 실행한다: **측정 → 분석 → 리포팅**. 측정과 분석은 전부 스크립트가 하고, 이 문서는 **결과를 어떻게 해석하고 무엇을 권고할지**만 다룬다. 계측 로직을 산문으로 옮겨 적지 말 것 — 스크립트가 단일 진실이다.

절대 하지 않는 것: **사용자 설정 파일을 수정하지 않는다.** 이 스킬은 읽기·측정·보고만 한다. 변경은 사용자가 리포트를 보고 판단한다.

## 실행 절차

Base directory는 이 SKILL.md가 있는 디렉토리다. 스크립트는 `scripts/` 아래에 있다.

### 1단계 — 오프라인 감사 (필수, 네트워크 없음)

```bash
node scripts/audit.js
```

`~/.claude.json`·`settings.json`의 설정 표면과 `~/.claude/projects`의 세션 JSONL 전체를 스캔해
`~/.claude/usage-audit/latest.json`에 결과를 쓴다. 이력은 `history/`에 타임스탬프로 함께 남는다.

옵션: `--days N` (최근 N일만), `--out <path>`, `--quiet`

### 2단계 — 와이어 프로브 (선택, 정확한 바이트 지분이 필요할 때)

```bash
node scripts/probe.js
```

일회용 로컬 프록시를 띄우고 짧은 세션 1회를 통과시켜 **실제 요청의 구성**(도구 블록 / 시스템 / 주입 블록)과
**MCP 서버별 바이트 지분**을 측정한 뒤 `latest.json`에 병합한다. 프록시는 즉시 종료되고,
인증 토큰이 든 원본 캡처는 디스크에 남기지 않는다.

이 단계는 API 호출 1~2회를 실제로 발생시킨다(모델은 haiku 고정, 비용 미미). 사용자가 원치 않으면 건너뛴다.

### 3단계 — 리포트 생성

```bash
node scripts/report.js
```

`~/.claude/usage-audit/report.html`을 만든다. 자체 완결형이고 라이트/다크 모두 대응한다.
사용자가 원하면 Artifact로 발행해도 좋다.

## 결과 해석 — 판단이 필요한 부분

스크립트는 사실만 낸다. 아래는 그 사실을 권고로 바꿀 때의 기준이다.

### 확장을 줄이라고 권고할 때

- **판단 기준은 도구 개수가 아니라 토큰이다.** 도구 20개짜리 서버가 29개짜리보다 3배 무거울 수 있다.
  리포트의 `도구당` 열을 반드시 함께 볼 것.
- `unused_mcp`(사용 0회)라도 **최근 도입했거나 특정 프로젝트 전용**일 수 있다. 단정하지 말고
  "이 로그 범위에서 0회"라고 말하고 사용자에게 확인한다.
- `possible_duplicate` / 리포트의 중복 등록은 **거의 항상 순손실**이다. 가장 먼저 권고할 항목.
  단, 어느 쪽이 실제로 쓰이는지 `실사용` 열로 확인한 뒤 안 쓰이는 쪽을 지목할 것.
- 스킬은 개당 수십~수백 토큰이라 MCP보다 훨씬 싸다. **스킬 정리는 우선순위가 낮다**고 말해줄 것.

### 드리프트(`session_drift`)가 잡혔을 때

세션 후반 오류율이 초반의 1.4배를 넘으면 발생한다. 흔한 실체는 **미독(未讀) 편집 시도**다 —
모델은 파일을 안다고 믿지만 하니스의 "읽은 파일 장부"에는 없다.
권고: 긴 세션에서 편집 직전 Read 한 번, 그리고 다루는 파일 묶음이 바뀌는 시점에 세션 분리.
리포트의 `미독 편집 시도` 행이 후반에 몰려 있으면 이 진단이 맞다.

### 실패율 높은 도구(`flaky_tool`)가 잡혔을 때

원인을 오류 유형 분포와 교차해서 봐야 한다. 같은 높은 실패율이라도 처방이 다르다.

- `NETWORK`/`TIMEOUT`이 지배적 → 도구 문제가 아니라 **대상 서버 도달성** 문제. 사전 연결 확인을 권고.
- `SYNTAX_ERROR`가 지배적이고 PowerShell이면 → 이 환경은 **Windows PowerShell 5.1**이라
  삼항 `?:`, `&&` 체이닝, `??`가 파서 오류다. POSIX 스크립트는 Bash 도구로 옮기라고 권고.
- `USER_REJECTED`는 실패가 아니라 **권한 게이트가 의도대로 작동한 것**이다. 문제로 보고하지 말 것.

### compaction 횟수

0에 가까우면 좋은 신호다. 세션을 짧게 끊고 무거운 작업을 서브에이전트로 격리하고 있다는 뜻이므로
**칭찬하고 현 방식 유지를 권고**한다. 수치가 크면 컨텍스트 관리 개선(격리 > 외부화 > 삭제 > 요약 순서)을 제안.

## 설정을 실제로 바꾸고 싶다고 할 때

이 스킬은 변경하지 않지만, 사용자가 요청하면 **위험이 낮은 순서로** 안내한다.

| 방법 | 범위 | 원복 |
|---|---|---|
| `--strict-mcp-config --mcp-config <file>` | 그 실행 1회 | 플래그 제거 (상태 변화 없음) |
| 프로젝트 `.mcp.json` | 해당 프로젝트 | 파일 삭제 |
| `settings.json`의 `enabledPlugins`를 false | 전역 | **변경 전 반드시 백업 사본 생성** |
| `~/.claude.json`의 `mcpServers` 편집 | 전역 | **변경 전 반드시 백업 사본 생성** |
| claude.ai 커넥터(Notion 등) 해제 | 계정 전역 | 커넥터 설정에서 재연결 |

전역 파일을 수정할 때는 **먼저 타임스탬프 백업을 만들고, 그 경로를 사용자에게 알려준 뒤** 변경한다.

## 주기적으로 돌리기

`schedule` 스킬이나 스케줄 태스크로 이 스킬을 주기 실행할 수 있다. 권장 주기는 **2~4주**다 —
설정과 사용 패턴은 그보다 빨리 바뀌지 않고, `history/`에 쌓인 이력으로 추세를 비교할 수 있다.

이력 비교가 필요하면 `~/.claude/usage-audit/history/`의 두 JSON을 읽어
`usage.errorRate`, `analysis.driftRatio`, `wire.composition.toolsTokens`의 변화를 보고하면 된다.

## 자세한 내용

측정 방식과 한계는 `references/methodology.md` 참조. 숫자의 근거를 사용자가 물을 때만 읽으면 된다.
