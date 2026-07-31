# drift-anchor 프로브 (착수 전 1회용)

drift-anchor 본체 구현 전에 **미검증 가정 2개**를 실측하는 프로브. 가정 1의 결과가 본체 1차 구성의 방향을 정한다.

**두 가정 모두 2026-07-31 종결.** 요약:

| 가정 | 결과 |
|---|---|
| 1. `PreCompact`가 이 설치본에서 발화하는가 | ✅ `PreCompact`·`PostCompact` 둘 다 발화 (`trigger:"manual"`) |
| 2. `PostToolUseFailure` 페이로드의 에러 필드명 | ⚠️ 최상위 `error`가 맞으나 **stdout 혼합** → 시그니처 원천으로 기각, `tool_input`으로 대체 |

**철거는 보류한다.** 남은 미확인은 자동 압축(`trigger:"auto"`)에서의 발화 여부 하나뿐이고, 프로브는 무비용이라 켜둔 채로 기다리면 스스로 답이 기록된다.

## 안전

- **stdout을 쓰지 않는다.** 주입·차단 경로를 오염시키지 않는다.
- **항상 `exit 0`.** 어떤 경우에도 세션을 막지 않는다.
- 쓰기 실패는 조용히 삼킨다. 프로브가 세션을 깨뜨리면 안 된다.
- 출력은 `out/probe.jsonl` 한 곳. 세션 cwd와 무관하게 어느 프로젝트에서 발화하든 여기 모인다.

## 1. 등록

`~/.claude/settings.json`의 `hooks`에 형제로 추가 (기존 항목과 공존):

```json
"PreCompact": [
  {
    "hooks": [
      {
        "type": "command",
        "command": "node \"<설치경로>/probe.js\" precompact"
      }
    ]
  }
],
"PostCompact": [
  {
    "hooks": [
      {
        "type": "command",
        "command": "node \"<설치경로>/probe.js\" postcompact"
      }
    ]
  }
],
"PostToolUseFailure": [
  {
    "matcher": "",
    "hooks": [
      {
        "type": "command",
        "command": "node \"<설치경로>/probe.js\" toolfail"
      }
    ]
  }
]
```

`PostCompact`도 같이 거는 이유: 가정 1이 거짓(PreCompact 미발화)일 때 **어느 쪽이 도는지**를 한 번에 가른다. 어느 하나라도 발화하면 플래그 우회는 성립한다.

> **세션 재시작 불필요.** 등록 직후 같은 세션에서 3종 전부 발화하는 것을 확인했다 (2026-07-31).

## 2. 유발

새 세션에서:

- **가정 1** — `/compact` 실행 (자연 압축을 기다릴 필요 없음).
- **가정 2** — 실패하는 도구 호출 1회. 예: 없는 파일 Read, 또는 `node -e "process.exit(1)"`.

## 3. 확인

```bash
node "<설치경로>/report.js"
```

- 가정 1: 발화 여부 + 최상위 키.
- 가정 2: 문자열 필드를 전부 훑어 `errorSignature` 후보를 **이름 힌트 > 값 길이** 순으로 제시. ★ 중 하나를 골라 고정한다.

## 4. 철거

프로브는 1회용이다. **철거 시점: 자동 압축(`trigger:"auto"`) 레코드 확보 시.** 그때:

1. `settings.json`에서 위 세 블록 제거
2. `rm -rf out/` (또는 근거로 보관)

`out/`은 `.gitignore` 처리돼 있다.
