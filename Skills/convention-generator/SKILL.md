---
name: convention-generator
description: 기존 프로젝트 코드를 비즈니스 레이어별(controller/service/mapper/converter/dto/entity)로 스캔해, 실제로 통용되는 컨벤션을 confidence+evidence와 함께 정형화한 draft.json을 생성한다. convention-enforcer hook이 이 파일을 읽어 탐지/피드백한다. 트리거"컨벤션 뽑아줘", "이 프로젝트 컨벤션 정형화", "convention draft 생성", "레이어별 규칙 추출". 사람이 draft를 검토해 enforced로 승격하기 전까지는 어떤 규칙도 차단되지 않는다(descriptive only).
---

## When to use

기존 코드베이스의 컨벤션을 사람이 일일이 손으로 룰로 적기 어려울 때, 코드를 스캔해 **기계가 읽는 규칙 초안(draft.json)** 으로 정형화한다. 산출물은 convention-enforcer hook(`Hooks/convention-enforcer/conventions/draft.json`)이 소비한다.

트리거 예:
- "이 서비스 컨벤션 뽑아서 draft 만들어줘"
- "controller 레이어 규칙 추출해서 정형화"
- "이 프로젝트 컨벤션 draft.json 생성"

## 절대 원칙 (어기면 도구가 망가짐)

- 생성기는 **"코드가 이렇게 한다"(descriptive)** 만 만든다. "이래야 한다"는 사람이 promote로 정한다.
- **draft의 모든 규칙은 advisory.** `severity:"block"`을 절대 쓰지 않는다. 차단은 사람이 enforced.json으로 옮긴 뒤에만.
- 각 규칙에 **confidence(0~1)** 와 **evidence("N/M 파일이 일치")** 를 반드시 붙인다. 사람이 promote 여부를 판단할 근거.
- 빈도 != 의도. 80%가 X여도 레거시 부채일 수 있음을 전제로 한다.

## 입력

- 대상 프로젝트 루트 + 레이어 범위(전체 또는 특정 레이어/모듈).
- 레이어 정의는 `Hooks/convention-enforcer/conventions/layers.json`의 pathGlobs를 따른다.
- 컨벤션 힌트는 프로젝트 문서(CLAUDE.md 등)에서 우선 수집(URI/HTTP/응답 래핑/네이밍/Entity 규칙이 명시된 경우가 많다).

## 워크플로

### 1단계 - 레이어별 파일 수집

`layers.json`의 각 레이어 pathGlobs로 Glob -> 파일 목록. 레이어별로 분리.

**Done when**: 각 레이어의 대상 파일 집합이 정해짐.

### 2단계 - 패턴 추론 + 빈도 집계

레이어별로 후보 규칙을 세우고 일치 파일 수를 센다. 예(Spring BE):

| 레이어 | 후보 규칙 | 측정 |
|---|---|---|
| controller | `ResponseEntity.ok(ApiResponse.success(...))` 래핑 | 래핑 메서드 / 전체 핸들러 |
| controller | URI 소문자+복수+케밥케이스 | @RequestMapping 값 패턴 |
| mapper | findAll / find{Entity}By{Column} / insert / update / delete / exists 네이밍 | 준수 메서드 / 전체 |
| entity | `@Builder(toBuilder=true)` + 전체 setter 부재 | 일치 클래스 / 전체 |
| dto | record 사용 + validation 애너테이션 | record / 전체 |
| converter | MapStruct `@Mapper` 사용 | 일치 / 전체 |

confidence = 일치율(또는 보정값). evidence = "23/27 일치" 형태.

**Done when**: 각 후보에 confidence + evidence 부여.

### 3단계 - draft.json 작성

`Hooks/convention-enforcer/conventions/draft.json`을 레이어별 규칙 배열로 작성(또는 갱신). 규칙 형태:

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

- `checker`: 정규식으로 판정 가능하면 `regex`(hook이 직접 검사). 구조/의미 판단이면 `structural`/`semantic`(hook은 차단 못 하므로 advisory로만 노출).
- `mustMatch`: true=패턴이 있어야 정상, false=패턴이 있으면 위반.
- **severity는 항상 "advisory".**

전체 구조:
```json
{
  "_comment": "...",
  "controller": [ { ...rule... }, ... ],
  "mapper": [ ... ]
}
```

**Done when**: draft.json이 레이어별 규칙으로 채워짐. enforced.json은 건드리지 않음.

### 4단계 - promote 후보 요약 출력

사람에게 표로 보고: 레이어 / 규칙 id / confidence / evidence / regex 가능여부. 고신뢰(>=0.9, checker:regex)부터 promote 후보로 추천. **promote(=enforced.json 편집)는 사람의 행위**임을 명시.

**Done when**: 사람이 어떤 규칙을 enforced로 올릴지 결정할 수 있는 요약을 받음.

## 안티패턴

- draft에 `severity:"block"` 쓰기 (금지).
- evidence/confidence 없이 규칙 쓰기 (promote 판단 불가).
- 저신뢰 규칙을 강한 어조로 단정.
- enforced.json을 생성기가 자동 수정.
