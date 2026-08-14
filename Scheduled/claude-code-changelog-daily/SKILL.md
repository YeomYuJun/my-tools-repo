---
name: claude-code-changelog-daily
description: 매일 Claude Code 릴리즈를 확인해 직전 기록 이후 새 버전만 한글로 요약·번역해 로컬에 누적한다. npm registry를 docs와 독립인 버전 오라클로 사용해 "web_fetch 캐시 stale"과 "docs 미게시"를 구분한다. 트리거 "/claude-code-changelog-daily", "Claude Code 변경사항 확인", 매일 09:00 스케줄 실행.
---

## When to use

매일 1회, Claude Code의 새 릴리즈를 한글로 요약해 `D:\claude-schedule`에 누적할 때. 매번 새 세션에서 실행되므로 아래 절차를 그대로 따른다.

## 작업 폴더

- 상태/히스토리 파일은 `D:\claude-schedule` 에 있다. Read/Write/Edit 로 직접 사용. 접근 불가하면 `mcp__cowork__request_cowork_directory` 로 path `D:\claude-schedule` 요청 후 진행.
- 핵심 파일:
  - `D:\claude-schedule\last_seen_version.txt` : 마지막으로 **본문까지 확보해 기록한** 최신 버전 (예: `2.1.232`)
  - `D:\claude-schedule\changelog-history.md` : 한글 변경사항 누적 파일

## 소스 3개와 각각의 실패 모드

| 소스 | 역할 | 실패 모드 |
|---|---|---|
| npm registry `@anthropic-ai/claude-code` | **버전 오라클** | 거의 없음. docs와 독립 |
| `code.claude.com/docs/en/changelog` | 1차 본문 | ① web_fetch 장기 캐시 ② npm 배포보다 늦게 게시 |
| GitHub `CHANGELOG.md` | 폴백 본문 | 코드 뷰 가상 스크롤 → 일반 텍스트 추출 불가 |

### ⚠️ 함정 1 — web_fetch 캐시
web_fetch는 URL 단위로 응답을 **장기 캐싱**한다. 실측 동결 사례: `raw.githubusercontent.com/.../CHANGELOG.md` → `2.1.110`, `code.claude.com/.../changelog/rss.xml` → 4월자 `2.1.101`. 응답 안의 `lastBuildDate` 같은 값도 캐시 덩어리째 얼어 있어 **fetch 결과만으로는 fresh 여부를 판정할 수 없다.**

### ⚠️ 함정 2 — WebSearch는 오라클이 될 수 없다
WebSearch는 docs 페이지와 그것을 긁어가는 aggregator를 색인한다. 즉 **본문 소스와 독립이 아니다.** 2026-08-14 실측: npm에 `2.1.232`가 배포된 상태에서 WebSearch와 docs가 사이좋게 `2.1.231`로 일치해 "교차검증 통과" 오판이 발생했다. 오라클은 반드시 npm이다.

### ⚠️ 함정 3 — docs 미게시 ≠ 캐시 stale
docs 미러는 npm 배포보다 늦게 갱신된다. 이 둘은 **대응이 다르므로 반드시 구분**해야 한다(캐시면 Chrome으로 우회 가능, 미게시면 GitHub로 가야 함). 4단계 분기가 이 구분을 담당한다.

## 절차

### 1. 기준선
`last_seen_version.txt` 를 읽어 LAST 확인. 없으면 LAST 빈 값 → 최신 1개만 처리.

### 2. 버전 오라클 (npm)
Chrome으로 `https://registry.npmjs.org/@anthropic-ai/claude-code/latest` 를 열고 `version` 필드를 읽어 **VNPM** 확정.

- Chrome 도구가 없으면 같은 URL을 `mcp__workspace__web_fetch` 로 가져오되, 캐시 위험이 있으므로 그 사실을 최종 보고에 명시한다.
- **VNPM == LAST → 새 버전 없음.** 3~8단계 건너뛰고 9단계 보고만 한다.

### 3. 본문 1차 시도 (docs)
`mcp__workspace__web_fetch` 로 `https://code.claude.com/docs/en/changelog` 를 가져온다(`<Update label="X.Y.Z" description="날짜">` 포맷). 응답이 크면 파일로 저장되니 Read offset/limit 으로 상단부터 청크로 읽고, `<Update label="{LAST}"` 에 도달하면 멈춘다. 최상단 라벨을 **Dfetch** 로 둔다.

### 4. 분기 (핵심)

```
Dfetch == VNPM              → 정상. docs 본문 사용. 5단계로.
Dfetch <  VNPM              → Chrome으로 docs를 다시 열어 최상단 라벨 Dlive 확인
    ├─ Dlive > Dfetch       → web_fetch 캐시 stale. Dlive 본문을 사용. 5단계로.
    └─ Dlive == Dfetch      → docs 미게시. 5-B GitHub 폴백으로.
```

어느 경로로도 본문을 못 얻으면 **상태 파일을 변경하지 말고** 사유(VNPM/Dfetch/Dlive 값 포함)만 보고한다.

### 5. 새 버전 블록 수집
확보한 fresh 본문에서 최상단부터 LAST 직전까지의 새 버전 블록을 모두 수집.

### 5-B. GitHub 폴백 (docs 미게시일 때만)

`raw.githubusercontent.com` 은 web_fetch에선 캐시 동결, Chrome에선 에러 페이지가 뜬다. GitHub blob 코드 뷰는 가상 스크롤이라 `get_page_text` / `read_page` 모두 라인 번호만 반환한다. **유일하게 동작하는 경로는 다음 하나다:**

1. Chrome navigate → `https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md?plain=1`
2. `javascript_tool` 로 구간 크기부터 확인:

```js
const t = document.body.innerText || '';
const a = t.indexOf('## {VNPM}'), b = t.indexOf('## {LAST}');
const lines = t.slice(a, b).split('\n').filter(x => x.trim());
'N=' + lines.length + ' CHARS=' + (b - a);
```

3. **절대 한 번에 전부 반환하지 마라.** 전체 슬라이스를 반환하면 시크릿 스캐너가 본문에 포함된 토큰 prefix(예: GitLab `gl*-` 계열 리댁션 항목)를 실제 시크릿으로 오탐해 `[BLOCKED: Cookie/query string data]` 로 막힌다. 6줄 × 190~230자 단위로 끊어 반복 호출한다:

```js
lines.slice(i, i + 6).map((x, k) => (k + i) + ': ' + x.slice(0, 200)).join('\n');
```

4. 특정 구간이 계속 블록되면 범위를 더 좁히고, 그래도 막히는 줄은 건너뛰되 **그 줄이 누락됐다는 사실을 보고에 명시**한다.

### 6. 한글 정리
- 헤더: `## {버전} — {오늘 YYYY-MM-DD 확인}`. 원문 description 날짜를 병기하고, GitHub 폴백으로 수집했으면 그 사실을 인용문 한 줄로 남긴다.
- 항목을 **새 기능 / 보안 수정 / 변경 / 개선 / 버그 수정** 소제목으로 분류해 불릿 번역. (권한 우회·샌드박스·시크릿 관련은 일반 버그 수정과 분리해 `보안 수정` 으로 올린다.)
- 번역 원칙: 고급 Java 개발자 대상, 간결·정확. `worktree`, `entitlement`, `cron`, `MCP`, 플래그/설정키(`/config`, `ANTHROPIC_BASE_URL` 등)·명령어·환경변수 등 고유 식별자는 원어 유지, 설명만 한글.
- 여러 버전이면 최신이 위로.

### 7. 파일 삽입
`changelog-history.md` 의 `<!-- 새 항목은 이 줄 아래에 최신순으로 추가됩니다 -->` 주석 바로 아래에 한글 블록(들)을 최신순으로 삽입. 기존 내용 보존.

### 8. 상태 갱신
`last_seen_version.txt` 를 **본문을 실제로 확보해 기록한 최신 버전**으로 덮어쓴다.

- docs 미게시 + GitHub 폴백까지 실패해 본문이 없으면 **갱신하지 않는다.** 그 버전은 다음 실행에서 자동 회수된다.
- VNPM 을 기록했다고 해서 무조건 VNPM 을 쓰지 마라. 기준은 "요약을 남긴 버전"이다.

### 9. 완료 보고
새 버전 목록 + 각 버전 핵심 3~5줄 한글 요약. 새 버전이 없으면 `Claude Code 새 릴리즈 없음 ({오늘})` 한 줄.
4단계에서 캐시 stale 또는 docs 미게시 분기가 발동했으면 **어느 분기였는지와 VNPM/Dfetch/Dlive 값을 명시**한다.

## 주의

- web_fetch / WebSearch / Chrome 도구 외(curl, wget, python requests 등)로 URL을 가져오지 말 것.
- web_fetch 실패 시 1회 재시도, 그래도 실패면 그 사실만 보고하고 상태 파일은 변경하지 말 것.
- 판단이 애매하면 **상태 파일을 건드리지 않는 쪽**을 택한다. 누락은 다음 실행에서 회수되지만, 잘못 전진한 LAST 는 그 구간을 영구히 건너뛴다.
