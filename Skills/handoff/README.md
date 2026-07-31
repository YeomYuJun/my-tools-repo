# handoff

Claude Code 스킬. 현재 세션의 작업 상태를 다음 세션으로 인계한다. 세션마다 다른 durable anchor를 자동 발견하고, 각 claim을 발견 원천에 대조해 검증등급을 매긴 뒤, **기록 문서 + 얇은 부트스트랩 프롬프트** 2종을 생성한다.

## 왜 (수동 인계 프롬프트 대비)

- **정확**: 진행상태를 내 기억이 아니라 ground-truth 원천(git·체크박스 등)에 대조 → `✓`/`~`/`⚠️` 등급.
- **절약**: 부트스트랩은 문서를 복제하지 않고 참조만 → 다음 세션 토큰 최소화.
- **정직**: 검증 못 한 claim을 `⚠️`로 노출. 대조 원장이 없으면 문서 상단에 고지.

핵심은 "정해진 파일을 긁는" 하베스터가 아니라 **이 세션의 anchor가 무엇인지 발견하는 프로토콜**이라는 점. 원천은 세션마다 다르다.

## 동작

4단계(SKILL.md): **DISCOVER**(anchor 발견, `handoff.js`가 discovery 번들 수집) → **SYNTHESIZE**(고정 스키마로 문서 작성) → **VERIFY**(claim에 검증등급) → **EMIT**(문서 + 얇은 부트스트랩).

- `handoff.js`는 결정적 수집기: git status·diff **요약**(전체 diff 아님, 토큰 보호), 후보 트래킹 파일(checklist/todo/handoff/.state), MEMORY.md 인덱스, cwd 얕은 트리.
- 발견의 *판단*은 모델이. 고신뢰는 자동, 저신뢰/모호/고위험만 사용자 확인.

## 사용

세션에서 트리거: `/handoff`, "다른 세션으로 넘길 준비 해줘", "인수인계 만들어줘" 등.

번들만 따로 확인:
```sh
node <설치경로>/handoff.js          # 마크다운
node <설치경로>/handoff.js --json   # JSON
```

## 설치

```sh
cp -r Skills/handoff <대상프로젝트>/.claude/skills/
```

스킬은 `.claude/skills/handoff/`에서 자동 인식된다. `handoff.js`는 Node 18+ 필요(`node:test` 사용 테스트 포함).

테스트:
```sh
node --test <설치경로>/handoff.test.js
```

## 한계 (MVP)

- **cwd 밖 원장**(예: 다른 디렉토리의 checklist)은 `handoff.js`가 자동 수집하지 못함 → 모델이 대화 기억으로 보완해 Read.
- **MEMORY.md**는 cwd 기준으로 찾음. 사용자 전역 메모리는 별도 경로일 수 있어 미검출될 수 있음.
- **resume 모드 미구현**: 받는 세션의 결정적 재수화 및 규칙 자동주입(state hook 연동)은 out-of-scope. 문서 스키마에 고정 앵커만 남겨 추후 확장 여지 확보.

실사용 예시: [EXAMPLE-handoff.md](EXAMPLE-handoff.md).
