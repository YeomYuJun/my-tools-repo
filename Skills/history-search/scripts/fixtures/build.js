'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const rec = (obj) => JSON.stringify(obj);

const user = (uuid, content, extra = {}) =>
  rec({ type: 'user', uuid, timestamp: '2026-08-01T10:00:00.000Z', message: { content }, ...extra });

const assistant = (uuid, content, extra = {}) =>
  rec({ type: 'assistant', uuid, timestamp: '2026-08-01T10:01:00.000Z', message: { content }, ...extra });

/** 발화/비발화/깨진 라인이 섞인 주 픽스처. NEEDLE 은 발화 2건에만 걸린다. */
function alphaMain() {
  return [
    rec({ type: 'queue-operation', operation: 'enqueue' }),
    rec({ type: 'attachment', attachment: { type: 'hook_success' }, text: 'NEEDLE in attachment' }),
    user('11111111-aaaa-0000-0000-000000000001', '첫 질문입니다 NEEDLE 포함'),
    assistant('22222222-bbbb-0000-0000-000000000002', [
      { type: 'text', text: '답변 하나' },
      { type: 'tool_use', id: 'tu_1', name: 'Bash', input: { description: '목록 조회', command: 'ls -al' } },
    ]),
    user('33333333-cccc-0000-0000-000000000003', [
      { type: 'tool_result', tool_use_id: 'tu_1', content: [{ type: 'text', text: 'a\nb\nc' }] },
    ]),
    assistant('44444444-dddd-0000-0000-000000000004', [{ type: 'text', text: '결과는 3행입니다' }]),
    '{"type":"user","broken',
    user('55555555-eeee-0000-0000-000000000005', [
      { type: 'text', text: '두번째 NEEDLE 질문 <system-reminder>숨김 HIDDENONLY</system-reminder> 끝' },
    ]),
    user('66666666-ffff-0000-0000-000000000006', '메타 NEEDLE 무시되어야', { isMeta: true }),
    assistant('77777777-0000-0000-0000-000000000007', [
      { type: 'text', text: `LONGONE ${'가'.repeat(2500)}` },
    ]),
  ].join('\n');
}

function simple(uuid, text) {
  return [user(uuid, text)].join('\n');
}

/**
 * 임시 디렉토리에 projects 트리를 만든다.
 * cwd 'D:\\Fix\\Alpha' 는 'D--Fix-Alpha' 로 인코딩된다 (구분자 개수만큼 대시).
 * 대소문자 변형 d--fix-alpha 와 하위 프로젝트 D--Fix-Alpha-cnd 가 스코프에 들어오고
 * D--Other 는 빠져야 한다.
 */
function buildFixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-fixture-'));

  const write = (rel, body) => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body, 'utf8');
    return full;
  };

  write('d--fix-alpha/aaaa1111-0000-0000-0000-00000000aaaa.jsonl', alphaMain());
  write(
    'd--fix-alpha/subagents/agent-dddd4444.jsonl',
    simple('88888888-0000-0000-0000-000000000008', '서브에이전트 NEEDLE 기록')
  );
  write(
    'D--Fix-Alpha-cnd/bbbb2222-0000-0000-0000-00000000bbbb.jsonl',
    simple('99999999-0000-0000-0000-000000000009', '하위 프로젝트 NEEDLE 기록')
  );
  write(
    'D--Other/cccc3333-0000-0000-0000-00000000cccc.jsonl',
    simple('aaaaaaaa-0000-0000-0000-00000000000a', '다른 프로젝트 NEEDLE 기록')
  );

  return root;
}

const FIXTURE_CWD = 'D:\\Fix\\Alpha';

module.exports = { buildFixtureRoot, FIXTURE_CWD };
