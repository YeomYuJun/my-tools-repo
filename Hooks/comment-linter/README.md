# comment-linter

Claude Code PostToolUse hook + companion sub-agent. Edit/Write 호출 시 추가된 주석에 컨벤션 검사를 적용하고, 위반이 있으면 stderr로 차단 메시지를 Claude에게 전달함.

## 동작

- 매핑된 파일 경로에서 Edit/Write 발생 시 자동 발동
- 룰 매치 → exit 2 + stderr → Claude가 자동 재편집
- 룰 매치 없음 → exit 0 (조용히 통과)
- 매핑되지 않은 경로/확장자 → skip
- `.claude/` 내부 파일은 자체 인프라이므로 항상 skip (self-block 회피)

## 설치

### 1. 파일 복사
이 도구는 hook 본체 + 동반 sub-agent 두 위치에 설치 필요.

```sh
# hook 본체
cp -r Hooks/comment-linter <대상프로젝트>/.claude/hooks/

# companion sub-agent
cp Agents/comment-linter.md <대상프로젝트>/.claude/agents/
```

### 2. settings.json 등록
대상 프로젝트의 `.claude/settings.json`에 추가:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "node \"<프로젝트절대경로>/.claude/hooks/comment-linter/index.js\""
          }
        ]
      }
    ]
  }
}
```

`<프로젝트절대경로>` 부분은 OS 절대 경로로 치환. 공백이 있으면 따옴표 필수.

### 3. services.json 조정
`config/services.json`의 `services` 배열을 대상 프로젝트 구조에 맞게 수정. 기본 파일은 예시 매핑이므로 대상 프로젝트에 맞게 교체 필요.

각 서비스 항목:
- `id`: 서비스 식별자 (자유)
- `prefix`: 매칭할 경로 부분문자열 (forward slash 기준)
- `defaultLanguage`: 확장자로 언어 결정 안 될 때 fallback

`applyWithoutService: true`면 서비스 매핑이 없어도 확장자만으로 작동.

## 룰 계층

| 계층 | 위치 | 1차 상태 |
|---|---|---|
| 공통 하드룰 | `rules/common.js` | 7개 작동 |
| 언어별 | `rules/lang/{java,vue,js}.js` | 슬롯 (빈 배열) |
| 서비스별 | `rules/service/{서비스ID}.js` | 슬롯 |
| 사용자 정규식 | `config/user-rules.json` | 빈 rules |

룰 인터페이스:
```js
{ id: string, severity: 'block'|'advisory', check(snippet, ctx) => violation | null }
```

### 공통 하드룰 (1차)
- **컨텍스트 누설**: 티켓 멘션, 세션 누설, 요청자 멘션
- **빈 마커**: 내용 없는 TODO/FIXME
- **타이포그래피**: 이모지, em-dash, smart quotes/arrows/bullets 등 (LLM이 자주 흘리는 typographic 문자)

## 확장

### 사용자 정규식 룰
`config/user-rules.json`의 `rules` 배열에 객체 추가. 재시작 불필요.

```json
{
  "id": "no-author-tag",
  "pattern": "@author\\s+",
  "flags": "i",
  "message": "@author tag forbidden. Use git blame.",
  "severity": "block",
  "appliesTo": { "services": ["*"], "languages": ["java"] }
}
```

### 서비스별 룰
`rules/service/{서비스ID}.js` 파일을 추가하면 자동 로드.

```js
module.exports = [
  {
    id: 'admin-no-author',
    severity: 'block',
    check(snippet, ctx) {
      return /@author\s+/i.test(snippet)
        ? { ruleId: 'admin-no-author', severity: 'block', message: 'no @author' }
        : null;
    },
  },
];
```

### 언어별 룰
`rules/lang/{java,vue,js}.js`의 빈 배열에 룰 추가. 서비스별 룰과 동일한 인터페이스.

## 동반 sub-agent

`Agents/comment-linter.md`는 의미 판단(WHAT-주석 후보, Javadoc 시그니처 불일치 등)을 위임받는 sub-agent. 1차 hook은 정규식 룰만 적용하므로 sub-agent는 향후 advisory 계층이 채워지면 자동 호출 흐름에 합류.

수동 호출 예:
```
@comment-linter 이 파일 변경의 주석을 검토해줘: <파일경로>
```

## 트러블슈팅

- **hook이 발동 안 함**: settings.json의 command 경로 확인. Windows에서 절대 경로의 공백은 따옴표 필수.
- **자기 룰 파일이 차단됨**: `.claude/` 내부는 skip되도록 lib/detect.js에 가드 있음. 다른 곳의 룰 파일을 편집하면 차단될 수 있음.
- **node 명령 못 찾음**: settings.json의 command를 node 전체 경로로 (예: `"C:/Program Files/nodejs/node.exe"`).
