---
name: claude-code-changelog-daily
description: 매일 Claude Code CHANGELOG(code.claude.com 미러)를 확인해 새 버전만 한글로 요약·번역하여 로컬에 누적. WebSearch 교차검증으로 캐시 stale 방지.
---

너는 매일 Claude Code 릴리즈(변경사항)를 확인해서, 직전에 기록한 버전 이후로 새로 올라온 버전만 한글로 요약·번역해 로컬 파일에 누적하는 작업을 한다. 매번 새 세션에서 실행되므로 아래 절차를 그대로 따른다.

## 작업 폴더
- 상태/히스토리 파일은 `D:\claude-schedule` 에 있다. Read/Write/Edit 로 직접 사용. 접근 불가하면 `mcp__cowork__request_cowork_directory` 로 path `D:\claude-schedule` 요청 후 진행.
- 핵심 파일:
  - `D:\claude-schedule\last_seen_version.txt` : 마지막으로 보고한 최신 버전 (예: `2.1.186`)
  - `D:\claude-schedule\changelog-history.md` : 한글 변경사항 누적 파일

## ⚠️ web_fetch 캐시 함정 (반드시 인지)
web_fetch는 URL 단위로 응답을 **장기 캐싱**한다. 실측: `raw.githubusercontent.com/.../CHANGELOG.md` 는 `2.1.110`에, `code.claude.com/.../changelog/rss.xml` 는 4월자 `2.1.101`에 영구 동결된 사본을 반환했다. 응답 XML 안의 `lastBuildDate` 같은 값도 그 캐시 덩어리째 얼어 있어서 **fetch 결과만으로는 fresh 여부를 판정할 수 없다.** 따라서:
- **버전 freshness의 권위 기준은 항상 WebSearch(라이브 쿼리)다. fetch 결과가 아니다.**
- 어떤 단일 fetch URL도 단독으로 믿지 마라.

## 절차
1. `last_seen_version.txt` 를 읽어 직전 기준(LAST) 확인. 없으면 LAST 빈 값 → 최신 1개만 처리.

2. **버전 오라클:** `WebSearch` 로 "claude code changelog latest version" 류 검색 → 현재 최신 버전 번호(VLATEST) 파악. (WebSearch 결과 URL은 provenance에 등록돼 이후 web_fetch 가능.)
   - VLATEST == LAST 이면 새 버전 없음 → 6~8단계 건너뛰고 "새 변경사항 없음"만 보고.

3. **본문 확보:** `mcp__workspace__web_fetch` 로 `https://code.claude.com/docs/en/changelog` 를 가져온다(공식 미러, `<Update label="X.Y.Z" description="날짜">` 포맷). 크면 파일로 저장되니 Read offset/limit 으로 상단부터 청크로 읽고, `<Update label="{LAST}"` 헤더 도달 시점까지만 읽는다.
   - `raw.githubusercontent.com` 직링크는 쓰지 마라(캐시 동결 확인됨). RSS(`/rss.xml`)도 이 환경에선 캐시가 4월에 묶여 있으니 쓰지 마라.

4. **교차검증 (핵심):** 3단계 fetch 결과의 최상단 버전을 VLATEST와 대조.
   - 일치 → 정상. 5단계로.
   - fetch 최상단 < VLATEST → **web_fetch가 stale 캐시를 줬다는 뜻.** 이때:
     a) Chrome 도구가 있으면 `mcp__Claude_in_Chrome__navigate` 로 `https://code.claude.com/docs/en/changelog` 열고 `mcp__Claude_in_Chrome__get_page_text` 로 렌더된 본문을 받는다(web_fetch 캐시를 통째로 우회). 이걸 본문 소스로 사용.
     b) Chrome 불가하면, WebSearch 결과 스니펫에서 가능한 만큼 핵심을 보완하되, 누락이 불가피하면 그 사실을 보고에 명시.
     c) 어느 쪽도 fresh 본문을 못 얻으면 **상태 파일을 변경하지 말고** "캐시로 인해 본문 fresh 확보 실패(VLATEST=…, fetch=…)"만 보고.

5. fresh 본문에서 최상단부터 LAST 직전까지의 **새 버전 블록**을 모두 수집. (LAST가 최상단이면 새 버전 없음 처리.)

6. 각 새 버전을 한글로 정리:
   - 헤더: `## {버전} — {오늘 YYYY-MM-DD 확인}` (원문 description 날짜 병기 가능)
   - 항목을 **새 기능 / 개선 / 변경 / 버그 수정** 소제목으로 분류해 불릿 번역.
   - 번역 원칙: 고급 Java 개발자 대상, 간결·정확. `worktree`,`entitlement`,`cron`,`MCP`, 플래그/설정키(`/config`,`ANTHROPIC_BASE_URL` 등)·명령어·환경변수 등 고유 식별자는 원어 유지, 설명만 한글.
   - 여러 버전이면 최신이 위로.

7. `changelog-history.md` 의 `<!-- 새 항목은 이 줄 아래에 최신순으로 추가됩니다 -->` 주석 바로 아래에 한글 블록(들)을 최신순으로 삽입. 기존 보존.

8. `last_seen_version.txt` 를 이번에 확인한 가장 최신 버전으로 덮어쓴다. (단, 4단계에서 fresh 본문 확보 실패 시엔 덮어쓰지 말 것.)

9. 완료 보고: 새 버전 목록 + 각 버전 핵심 3~5줄 한글 요약. 새 버전 없으면 "Claude Code 새 릴리즈 없음 ({오늘})" 한 줄. 4단계에서 stale/Chrome 폴백이 발동했으면 그 사실 명시.

## 주의
- web_fetch/WebSearch/Chrome 도구 외(curl/wget/python requests 등)로 URL을 가져오지 말 것.
- web_fetch 실패 시 1회 재시도, 그래도 실패면 그 사실만 보고하고 상태 파일은 변경하지 말 것.