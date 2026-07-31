# usage-audit

Claude Code 설치본이 **매 요청에 물리는 토큰 비용**과 **실제 사용/실패 실적**을 측정해
자체 완결형 HTML 리포트로 만드는 스킬.

설정을 **읽기만** 한다. 어떤 설정 파일도 수정하지 않는다.

## 무엇을 알려주나

- 요청 구성 — 도구 정의 / 시스템 프롬프트 / 주입 블록이 각각 몇 토큰인지
- MCP 서버별 바이트 지분 — **도구 개수가 아니라 바이트 기준**
- 설정돼 있으나 안 쓰는 확장 (MCP·스킬·플러그인)
- 같은 도구의 중복 등록과 그 낭비량
- 세션 후반 신뢰도 저하(드리프트) 배수
- 도구별 실패율과 오류 유형 분포

## 설치

스킬 디렉토리를 아래 중 한 곳에 두면 된다.

| 위치 | 범위 |
|---|---|
| `~/.claude/skills/usage-audit/` | 사용자 전역 |
| `<project>/.claude/skills/usage-audit/` | 해당 프로젝트 |

`.skill` 패키지로 받았다면 압축을 풀어 위 경로에 `usage-audit/` 이름으로 넣는다.

```bash
# 예: 사용자 전역 설치
mkdir -p ~/.claude/skills/usage-audit
unzip usage-audit.skill -d ~/.claude/skills/usage-audit
```

요구사항: **Node.js**(추가 의존성 없음, 내장 모듈만 사용), `claude` CLI가 PATH에 있을 것(2단계에만 필요).

## 사용

스킬로 호출하거나(`/usage-audit`), 스크립트를 직접 실행한다.

```bash
cd ~/.claude/skills/usage-audit/scripts

node audit.js          # 1) 오프라인 측정 (네트워크 없음)
node probe.js          # 2) 선택: 와이어 캡처로 정확한 바이트 지분
node report.js         # 3) HTML 리포트 생성
```

산출물은 `~/.claude/usage-audit/` 아래에 생긴다.

```
~/.claude/usage-audit/
├── latest.json          # 최신 측정 결과
├── report.html          # 리포트
└── history/             # 타임스탬프 이력 (추세 비교용)
```

### 옵션

| 스크립트 | 옵션 |
|---|---|
| `audit.js` | `--days N` 최근 N일만 · `--out <path>` · `--quiet` |
| `probe.js` | `--model <name>` (기본 haiku) · `--merge <audit.json>` · `--keep-raw` |
| `report.js` | `--in <audit.json>` · `--out <report.html>` |

## 2단계(probe)에 대해

`probe.js`는 일회용 로컬 리버스 프록시를 띄우고 짧은 세션 1회를 통과시켜 **실제 요청 바이트**를 잰다.

- 클라이언트↔프록시 구간만 평문(루프백 127.0.0.1), 프록시↔API는 정상 TLS
- 캡처에는 인증 토큰이 포함되므로 **원본은 메모리에서만 쓰고 디스크에 남기지 않는다**
  (`--keep-raw`를 명시하지 않는 한)
- 도구 호출을 유발해 2턴을 강제한다 — turn 1만 재면 아직 연결되지 않은 MCP 서버가 빠져
  도구 수가 과소 집계된다(cold-start 경쟁)
- API 호출 1~2회가 실제로 발생한다(haiku 기준, 비용 미미). 원치 않으면 이 단계를 건너뛰면 되고,
  리포트는 오프라인 항목만으로도 생성된다

## 주기 실행

권장 주기는 **2~4주**. 설정과 사용 패턴이 그보다 빨리 바뀌지 않고, `history/`에 쌓인 이력으로
`usage.errorRate` · `analysis.driftRatio` · `wire.composition.toolsTokens` 추세를 비교할 수 있다.

## 구조

```
usage-audit/
├── SKILL.md                    # 해석 기준 · 권고 판단 (모델이 읽음)
├── README.md                   # 이 문서 (사람이 읽음)
├── scripts/
│   ├── audit.js                # 오프라인 측정 → latest.json
│   ├── probe.js                # 와이어 캡처 → latest.json 병합
│   └── report.js               # latest.json → report.html
└── references/
    └── methodology.md          # 측정 방식과 한계
```

설계 원칙: **판단은 산문에, 결정성은 코드에.** 계측 로직은 전부 스크립트에 있고
SKILL.md는 결과 해석 기준만 담는다. 절차를 산문으로 옮겨 적지 않는다.

## 한계

- "사용 0회"는 스캔 범위 내의 사실일 뿐, 영구 불필요를 뜻하지 않는다
- 서브에이전트 트랜스크립트는 집계에서 제외된다(세션 최상위 `.jsonl`만 스캔)
- 와이어 측정은 `-p` 모드 1회 기준이며, 대화형 세션은 지연 로딩(deferred tools)으로 구성이 다를 수 있다
- 오류 분류는 정규식 기반이라 미분류(`OTHER`)가 남는다 — 경향 파악용으로 쓸 것

자세한 내용은 `references/methodology.md` 참조.
