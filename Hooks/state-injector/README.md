# state-injector

Claude Code SessionStart + UserPromptSubmit hook. 사용자가 세션에 고정한 상태를 매 세션·매 턴 `additionalContext`로 되먹여 **system prompt처럼 상시 유지**한다.

## 핵심 분업

- **Skill (`Skills/state`) = control surface**: set / show / clear.
- **Hook (inject.js) = 상시성**: 저장된 상태를 SessionStart(초기·resume) + UserPromptSubmit(매 턴 -> 압축 후에도 생존)로 주입.
- **파일 = 계약**: `<cwd>/.state/session-state.json` (co-dev 불요, 첫 저장 시 자동 생성. 구 `co-dev/.session-state.json`은 읽기 전용 폴백으로 마이그레이션 지원).

Skill 단독으론 "매 턴 자동"이 안 된다. 그 상시성은 hook의 `additionalContext`가 만든다.

## 동작

```
SessionStart / UserPromptSubmit -> inject.js
  |- 상태 비어있음 -> exit 0 (조용)
  |- 있음 -> { hookSpecificOutput: { hookEventName, additionalContext: "[session-state]\n- key: value..." } }
```

- 상태는 작게 설계 -> full 블록을 매 턴 주입. 커지면 `store.digest()` + `lastInjectedHash` 게이트로 전환(아래).

## CLI (state.js)

아무 프로젝트 루트에서나(co-dev 불요 - `.state/`를 자동 생성):

```sh
node <설치경로>/state-injector/state.js set focus "TASK-003 BE만, FE 보류"
node <설치경로>/state-injector/state.js set constraint "PUT/DELETE 금지, GET/POST만"
node <설치경로>/state-injector/state.js show
node <설치경로>/state-injector/state.js clear focus
node <설치경로>/state-injector/state.js clear
```

## 상태 스키마 (`.state/session-state.json`)

```json
{
  "updatedAt": "2026-06-10T...",
  "lastInjectedHash": "abc123",
  "entries": [
    { "key": "focus", "value": "TASK-003 BE만", "addedAt": "..." }
  ]
}
```

## 선결 확인: session_id resume 안정성

본 도구는 **project-scoped**(프로젝트당 한 파일)가 기본이라 resume에서 session_id가 바뀌어도 안전하다. per-session 키잉을 원하면 먼저 확인:

- SessionStart hook에서 `session_id` 로깅 -> `claude --resume` -> 재진입 시 같은 id인지 비교.
- 같으면: `.state/<sessionId>.json`로 키잉 가능.
- 다르면: project-scoped 유지(기본).

## 설치

### 1. 파일 복사

```sh
cp -r Hooks/state-injector <대상프로젝트>/.claude/hooks/
cp -r Skills/state <대상프로젝트>/.claude/skills/
```

### 2. settings.json 등록

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "node \"<abs>/.claude/hooks/state-injector/inject.js\"" } ] }
    ],
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command", "command": "node \"<abs>/.claude/hooks/state-injector/inject.js\"" } ] }
    ]
  }
}
```

(recursive-eval의 Stop, comment-linter/convention-enforcer의 PostToolUse와 같은 `hooks` 객체 안에 형제로 공존.)

## 비용 / 안전

- UserPromptSubmit는 매 턴 발생 -> 상태는 **작게**(한 줄짜리 사실 위주). 큰 덤프 금지.
- 비밀값 저장 금지 (평문 + 매 턴 컨텍스트 주입).
- 큰 상태가 필요하면: inject.js를 `store.digest()`(키 목록만) + `hashOf`/`markInjected` 게이트(직전과 동일하면 skip)로 전환. 단 게이트는 압축 직후 일시적 부재 가능 -> 트레이드오프.

## 구성 파일

| 파일 | 책임 |
|---|---|
| `inject.js` | SessionStart/UserPromptSubmit hook, additionalContext 주입 |
| `lib/store.js` | 상태 read/write/upsert/remove + digest/hash (cwd 기반) |
| `state.js` | CLI: set/show/clear |
| (`Skills/state/SKILL.md`) | /state 슬래시 UX |

## 트러블슈팅

- **주입 안 됨**: 상태 파일 존재 + entries 있는지(`state.js show`), settings.json SessionStart/UserPromptSubmit 등록/경로 확인.
- **set 실패**: key와 value를 모두 줬는지 확인(`set <key> <value...>`). `.state/`는 자동 생성되므로 사전 디렉터리 준비는 불필요.
- **너무 시끄러움**: 항목 줄이거나 `clear`, 또는 digest 모드로 전환.
