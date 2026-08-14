# history-search

과거 Claude Code 세션 기록에서 발화를 검색하고, 특정 발화를 전후 맥락과 함께
현재 세션 컨텍스트로 끌어오는 스킬.

## 왜 필요한가

Claude Code 내장 `/resume` 에도 검색이 있고 대화 본문까지 훑는다. 다만 세션당
검색 문자열이 **50,000자에서 잘린다**(바이너리 상수 `vym`). 긴 세션은 앞부분만
검색되고 뒤가 통째로 빠진다. 실측 (`D--0--dle`):

| 세션 | 발화 텍스트 | `/resume` 가 훑는 비율 |
|---|---|---|
| 40af99b1 | 45,654자 | 100% |
| f0ab1313 | 108,226자 | 46% |
| 3ca312f1 | 193,602자 | 26% |
| 7e7b2785 | 221,507자 | 23% |

즉 내장 검색은 "그 얘기 어느 세션에서 했지"엔 쓸 만해도 "그래서 **결론이 뭐였지**"엔
못 쓴다. 이 스킬은 캡 없이 전체를 보고, 찾은 발화를 컨텍스트로 넣어 이어서
작업할 수 있게 한다.

외부 뷰어(claude-code-history-viewer 등)와의 차이도 여기다. 뷰어는 사람이 읽고
복붙해야 하지만, 이 스킬은 결과가 모델 컨텍스트로 들어간다.

## 설치

```powershell
Copy-Item -Recurse -Force "D:\my-tools\Skills\history-search" "$env:USERPROFILE\.claude\skills\"
```

Node 18+ 외 의존성 없음.

## 사용

```bash
node scripts/search.js "동시 세션" --all
node scripts/pick.js @d20f8138#412.fcdf122a --ctx 3
node scripts/pick.js @d20f8138#412.fcdf122a --ctx 3 --tool t1
```

세션 안에서는 자연어로 부르면 된다 — "예전에 배지 SSE 문제 어떻게 결론냈지?"

## 앵커

`@<세션ID 앞 8자>#<라인번호>.<uuid 앞 8자>`

상태 파일이 없다. 검색 출력이 이미 모델 컨텍스트에 있으므로 번호(`[1]`)를 앵커로
바꾸는 건 모델이 한다. JSONL 이 append-only 라 라인번호가 불변이고, uuid 대조가
그 가정이 깨졌을 때의 안전망이다.

세션ID 가 uuid 형태가 아닌 서브에이전트 기록(`subagents/agent-a1220dfbf30a28b8f.jsonl`)은
앞 8자가 전부 `agent-a1` 이라 충돌한다. 그래서 uuid 형태일 때만 8자로 자른다.

## 동작

1. **1패스** — 전 파일을 JSON 파싱 없이 문자열 포함 여부만 검사해 후보를 거른다.
2. **2패스** — 후보만 파싱해 `type ∈ {user, assistant}` 의 `content[].text` 를 뽑는다.
   내장 검색의 `wgE()` 와 같은 규칙이라 tool_result 는 자연히 빠지고, 여기에
   `<system-reminder>` 같은 하네스 래퍼 제거와 `isMeta` 제외가 더해진다.

실측: 424개 파일 / 205MB 전체 스캔 **2.3초**. 인덱스 없음.

## 출력 예산

| | 상한 |
|---|---|
| search | 세션당 스니펫 2개 / 120자 / 총 8세션 |
| pick 발화 | 2,000자 |
| pick 툴 | 한 줄 요약. 전문은 `--tool` 로만 |
| pick 총량 | 25,000자 (초과 시 중단 + 안내) |

## 테스트

```bash
cd scripts && node --test
```

20개. 스코프 해석(대소문자 변형·하위 프로젝트), 비발화 레코드 필터링, 래퍼 제거,
툴 링킹, 앵커 왕복(uuid 세션 + `agent-*` 세션), uuid 불일치 거부, 예산 절단,
깨진 라인 skip, 툴 힌트의 `--ctx` 보존.

## 한계

- 부분일치만. 정규식·퍼지·시맨틱 없음.
- 줄바꿈이나 따옴표가 든 문구는 1패스에서 놓칠 수 있다(JSONL 이스케이프).
- `cleanupPeriodDays` 기본값 30일. 그보다 오래된 세션은 원본이 이미 없다.
  오래 보관하려면 `~/.claude/settings.json` 에 `"cleanupPeriodDays": 3650`.

설계 근거: [docs/superpowers/specs/2026-08-06-history-search-design.md](../../docs/superpowers/specs/2026-08-06-history-search-design.md)
