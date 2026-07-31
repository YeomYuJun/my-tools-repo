# convention-enforcer

Claude Code PostToolUse hook. comment-linter를 "주석 규칙"에서 **비즈니스 레이어별 컨벤션 전반**으로 일반화한 것. 컨벤션을 코드 스캔으로 생성(descriptive)하고, 사람이 promote한 규칙만 차단한다.

## 핵심 원칙 (절대)

**자동 생성된 규칙은 차단하지 않는다.** 생성기(convention-generator Skill)는 빈도 기반 descriptive 규칙(+confidence+evidence)만 만든다. 사람이 검토 후 `enforced.json`으로 promote한 규칙만 hook이 block한다. 나머지는 advisory. (빈도 != 의도. 자동 강제 = 레거시 부채를 법으로 굳혀 오탐 폭발.)

## 동작

```
PostToolUse(Edit|Write) -> index.js
  |- tool_name이 Edit/Write 아님 / file_path 없음 -> exit 0
  |- detectLayer(file_path)  (layers.json pathGlobs)  -> 레이어 없음 / .claude 내부 -> exit 0
  |- 해당 레이어 enforced+draft 규칙 0개 -> exit 0
  |- 파일 내용 읽어 규칙 실행:
        enforced 위반 -> stderr + exit 2  (Claude 자동 재편집)
        draft 위반    -> stdout advisory + exit 0
        위반 없음     -> exit 0
```

- 파일 전체를 검사한다(레이어 불변식 성격). enforced에는 파일 단위로 성립하는 규칙만 promote할 것.

## descriptive -> promote -> enforce

```
[convention-generator Skill]  코드 스캔 -> draft.json (advisory, confidence+evidence)
        |
[사람의 promote]  고른 규칙을 enforced.json 으로 복사   <- 사람의 행위
        |
[enforcer Hook]   enforced 규칙만 block, draft는 advisory
```

enforced.json 이 곧 "동적 config" - 재생성/재승격하면 hook 코드 0줄 수정으로 동작 변경.

## 구성 파일

```
Hooks/convention-enforcer/
  index.js                 # PostToolUse 진입점, 상태머신
  lib/
    detect.js              # 파일 경로 -> 레이어 (layers.json pathGlobs, glob 매칭)
    load.js                # layers/enforced/draft 로드
    engine.js              # regex/structural 룰 실행 (mustMatch 양방향)
  conventions/
    layers.json            # 레이어 정의 (pathGlobs). 안정/수동
    enforced.json          # 사람이 promote한 규칙 = 차단. 초기 비어있음
    draft.json             # 생성된 규칙 = advisory. generator가 작성

Skills/convention-generator/
  SKILL.md                 # 코드 스캔 -> draft.json 생성 절차
```

## 룰 스키마

```json
{
  "id": "controller-apiresponse-wrap",
  "checker": "regex",
  "pattern": "ResponseEntity\\.ok\\(\\s*ApiResponse\\.success",
  "flags": "m",
  "mustMatch": true,
  "severity": "advisory",
  "message": "Controller 응답은 ApiResponse.success로 래핑",
  "confidence": 0.85,
  "evidence": "23/27 controllers match",
  "source": "inferred"
}
```

- `checker`: `regex`(hook이 직접 판정) | `structural`/`semantic`(차단 불가, advisory로만).
- `mustMatch`: true=패턴 있어야 정상(없으면 위반), false=패턴 있으면 위반.
- enforced.json의 규칙만 차단. draft.json은 severity와 무관하게 advisory.

## 설치

### 1. 파일 복사

```sh
cp -r Hooks/convention-enforcer <대상프로젝트>/.claude/hooks/
cp -r Skills/convention-generator <대상프로젝트>/.claude/skills/   # 선택(생성용)
```

### 2. settings.json 등록 (comment-linter의 형제로)

```json
{
  "hooks": {
    "PostToolUse": [
      { "matcher": "Edit|Write", "hooks": [
        { "type": "command", "command": "node \"<abs>/.claude/hooks/comment-linter/index.js\"" },
        { "type": "command", "command": "node \"<abs>/.claude/hooks/convention-enforcer/index.js\"" }
      ]}
    ]
  }
}
```

### 3. 컨벤션 생성 + 승격

1. convention-generator Skill로 draft.json 생성 ("이 프로젝트 컨벤션 뽑아줘").
2. draft.json을 검토 -> 고신뢰(checker:regex) 규칙을 enforced.json으로 복사(promote).
3. 이제 그 규칙 위반 시 편집이 차단된다.

## 안전 / 안티패턴

- inferred 규칙 자동 block 금지 (핵심 원칙). 생성기는 advisory만.
- self skip: `.claude/` 내부는 검사 제외 (detect.js 가드).
- 2-layer: regex/structural은 hook, semantic은 advisory 또는 companion agent.
- PreToolUse 사전 주입 안 함 (CLAUDE.md가 이미 컨텍스트).
- enforced에는 파일 단위 불변식만. 부분 편집에서 오탐 나는 규칙은 promote하지 말 것.

## 트러블슈팅

- **차단이 안 됨**: 해당 레이어 규칙이 enforced.json에 있는지(draft만으론 차단 안 됨), layers.json pathGlobs가 파일 경로와 맞는지 확인.
- **오탐 차단**: 그 규칙을 enforced에서 빼고 draft(advisory)로 되돌림. 빈도 기반 규칙은 promote 신중히.
- **node 못 찾음**: settings.json command를 node 전체 경로로.
