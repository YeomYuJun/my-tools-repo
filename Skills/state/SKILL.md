---
name: state
description: 현재 세션에 상태(집중 작업, 제약, 결정사항 등)를 주입/조회/삭제하는 control surface. state-injector hook이 이 상태를 SessionStart와 매 턴(UserPromptSubmit)마다 additionalContext로 되먹여 system prompt처럼 상시 유지한다. 트리거"/state", "상태 주입", "이 세션 상태 설정", "지금 컨텍스트에 X 고정", "현재 주입 상태 보여줘", "상태 초기화".
---

## When to use

세션 내내 모델이 잊지 않아야 할 짧은 사실(현재 집중 TASK, 하드 제약, 합의된 결정)을 사용자가 직접 고정하고 싶을 때. Skill은 조작 표면이고, 상시 주입은 state-injector hook이 담당한다.

트리거 예:
- "/state set focus 'TASK-003 BE만, FE 보류'"
- "지금 세션에 'PUT/DELETE 금지' 고정해줘"
- "/state show" (현재 주입된 상태 조회)
- "/state clear" (전체 초기화)

## 동작 모델

- **Skill(이 문서) = 조작**: set / show / clear.
- **Hook(state-injector) = 상시성**: 저장된 상태를 SessionStart + 매 턴 additionalContext로 주입.
- **파일 = 계약**: `<프로젝트>/.state/session-state.json` (co-dev 불요, 첫 저장 시 자동 생성. 구 `co-dev/.session-state.json`은 읽기 폴백으로만 지원).

Skill 단독으로는 "매 턴 자동"이 안 된다. 그 상시성은 hook이 만든다. 이 Skill은 상태 파일을 갱신할 뿐이고, 다음 턴부터 hook이 주입한다.

## 명령

저장은 결정적 CLI(`state.js`)가 담당한다. 아무 프로젝트 루트에서나 실행(co-dev 불요 - `.state/`를 자동 생성):

| 의도 | 명령 |
|---|---|
| 설정/갱신 | `node <설치경로>/state-injector/state.js set <key> <value...>` |
| 조회 | `node <설치경로>/state-injector/state.js show` |
| 삭제(키) | `node <설치경로>/state-injector/state.js clear <key>` |
| 전체 삭제 | `node <설치경로>/state-injector/state.js clear` |

## 워크플로

1. 사용자가 고정할 항목을 받는다(key + value). key는 짧게(focus, constraint, decision 등).
2. `state.js set`으로 저장(또는 Write로 `.state/session-state.json` 직접 갱신).
3. 조회 요청 시 `state.js show` 결과를 보여준다.
4. 사용자에게: 다음 턴부터 hook이 자동 주입함을 안내(현재 턴 컨텍스트엔 이미 대화로 존재).

**Done when**: 상태 파일에 항목이 반영되고, 사용자가 조회로 확인 가능.

## 주의

- 상태는 **작게**. 매 턴 주입되므로 큰 덤프는 토큰 낭비. 한 줄짜리 사실 위주.
- 비밀값(토큰/비번) 저장 금지 - 평문 파일 + 매 턴 컨텍스트 주입됨.
- 작업이 끝난 항목은 `clear`로 정리.
