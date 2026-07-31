# recursive-eval

Claude Code `Stop` hook. 작업 단위가 끝날 때마다 headless `claude -p` 평가자를 실행해, 통과할 때까지 자동 수정시키고 / 통과하면 다음 작업을 지시해 **사용자 턴 없이 재귀적으로** 작업을 이어가는 자동화 루프.

평가자는 전체 세션 맥락을 읽고 피드백하며, 그 호출을 hook이 강제하고 결과로 본 세션을 다시 깨운다.

## 동작

```
[본 세션 턴 종료] -> Stop hook(index.js)
   |- env RECURSIVE_EVAL_CHILD 있음 -> exit 0            (재귀 가드 2차)
   |- running-marker 있음           -> exit 0            (재귀 가드 1차)
   |- 센티넬 armed 아님             -> exit 0            (루프 꺼짐)
   |- iteration >= maxIter          -> disarm + exit 0   (상한 소진)
   |- 평가자 실행(claude -p) -> verdict:
        needs_fix       -> iteration++ -> {decision:block, reason:피드백}   (본 세션 즉시 수정)
        approved + next -> iteration++ -> {decision:block, reason:다음작업}  (본 세션 이어감)
        approved + done -> disarm + exit 0                                    (정상 종료)
        평가자 실패     -> exit 0 + stderr 경고                              (차단 안 함)
```

- `{decision:block, reason}`를 stdout으로 내보내면 Claude가 종료 못 하고 `reason`을 다음 지시로 삼아 자동 재진입.
- 평가자는 `transcript_path`(Stop payload 제공)로 세션 전체를 읽고, `co-dev/TASK.md`의 `### Done`/sub-task 와 `CLAUDE.md` 컨벤션으로 판정.

## 게이트 (arm/disarm)

`Stop`은 모든 턴 끝마다 발생하므로 항상 켜두면 비용이 폭발한다. **명시적으로 arm 했을 때만** 동작.

```sh
# 켜기 (프로젝트 루트 = co-dev/TASK.md 있는 곳에서 실행)
node <설치경로>/recursive-eval/arm.js TASK-003 --model sonnet --max 10

# 끄기
node <설치경로>/recursive-eval/disarm.js
```

- `arm.js <TASK-ID|all> [--model sonnet|opus|haiku] [--max N]` -> `<cwd>/co-dev/.recursive-eval.lock` 생성, `iteration=0` 리셋.
- 기본값: model=`sonnet`, max=`10`.
- **escape hatch**: 다른 터미널에서 lock 파일을 지우면 다음 라운드에서 즉시 정지(hook이 매 라운드 센티넬을 다시 읽음).

### 센티넬 스키마 (`co-dev/.recursive-eval.lock`)

```json
{
  "armed": true,
  "targetTask": "TASK-003",
  "model": "sonnet",
  "maxIter": 10,
  "iteration": 0,
  "armedAt": "2026-06-09T10:00:00Z"
}
```

`targetTask: null`이면 TASK.md 의존성 순서대로 진행.

## 설치

이 hook은 *범용 도구*다. 데이터 경로(lock / TASK.md / CLAUDE.md)는 코드 위치가 아니라 **세션 cwd(=대상 프로젝트)** 기준으로 잡으므로 여러 프로젝트에서 재사용 가능.

### 1. 파일 복사

```sh
cp -r Hooks/recursive-eval <대상프로젝트>/.claude/hooks/
```

### 2. settings.json 등록 (timeout 필수)

대상 프로젝트의 `.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"<프로젝트절대경로>/.claude/hooks/recursive-eval/index.js\"",
            "timeout": 600
          }
        ]
      }
    ]
  }
}
```

- `"timeout": 600` 은 **필수**. Claude Code hook 기본 타임아웃(~60s)이면 평가자가 추론 중 SIGTERM 되고 verdict가 유실되어 루프가 조용히 끊긴다.
- 기존 `PostToolUse`(comment-linter 등)와 같은 `hooks` 객체 안에 형제로 추가한다 (덮어쓰지 말 것).

## 안전장치

| 위험 | 대책 |
|---|---|
| 평가자 headless가 자기 Stop hook을 다시 발동 -> 무한 spawn | running-marker(1차, 동기 spawn 기준 결정적) + `RECURSIVE_EVAL_CHILD` env(2차) 이중 가드 |
| hook 타임아웃이 평가자 SIGTERM -> verdict 유실 | settings.json `"timeout": 600` |
| win32에서 `claude`가 .cmd shim이라 spawn 실패 | `spawnSync(..., { shell: true })` |
| 자율 연속 진행 폭주 | `maxIter`(기본 10) 하드캡 + 매 라운드 센티넬 재확인 |
| 평가자 실패 시 무한정지 | 실패 시 차단하지 않고 종료 허용 + stderr 경고 |
| verdict 이중 파싱(JSON 봉투 안 모델 JSON) | "JSON만 출력" 지시 + 마지막 `{...}` 방어적 추출 |

### hooks-free.json (fallback)

`RECURSIVE_EVAL_CHILD` env 가 자식 hook까지 전파되지 않는 환경이 확인되면, `runEvaluator.js`의 spawn args에 `--settings <이경로>/hooks-free.json` 을 추가해 자식 세션에서 Stop hook 자체를 제거한다. (현재 1차 가드인 running-marker로 충분하므로 기본 비활성.)

## 구성 파일

| 파일 | 책임 |
|---|---|
| `index.js` | Stop hook 진입점, 상태머신, 재귀 가드 |
| `lib/sentinel.js` | lock/marker read/write (cwd 기준) |
| `lib/runEvaluator.js` | headless claude spawn + verdict 추출 |
| `lib/format.js` | block reason 포매팅 |
| `prompts/evaluator.md` | 평가자 시스템 프롬프트 (리뷰/디스패치 이중역할 + JSON 계약) |
| `arm.js` / `disarm.js` | 루프 켜기/끄기 CLI |
| `hooks-free.json` | 재귀 가드 fallback settings |

## 트러블슈팅

- **루프가 안 돈다**: arm 됐는지(`co-dev/.recursive-eval.lock` 존재 + `armed:true`), settings.json `Stop` 등록/경로 확인.
- **평가자가 매번 실패(allowing stop)**: `claude --help`로 `-p`/`--output-format`/`--allowedTools`/`--permission-mode` 표기 확인(버전 드리프트). `model` 값이 유효한지 확인.
- **세션이 안 멈춘다**: `disarm.js` 실행 또는 lock 파일 직접 삭제. maxIter를 낮춰 재-arm.
- **node 못 찾음**: settings.json command를 node 전체 경로로(예: `"C:/Program Files/nodejs/node.exe"`).
- **응답이 느려졌다**: Stop마다 평가자(claude -p)가 동기 실행되어 그 시간만큼 턴 종료가 지연됨 - 의도된 동작. 평소엔 disarm 상태로 둘 것.
