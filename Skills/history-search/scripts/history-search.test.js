'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const projects = require('./lib/projects');
const transcript = require('./lib/transcript');
const render = require('./lib/render');
const search = require('./search');
const pick = require('./pick');
const { buildFixtureRoot, FIXTURE_CWD } = require('./fixtures/build');

const ROOT = buildFixtureRoot();
const ALPHA = path.join(ROOT, 'd--fix-alpha', 'aaaa1111-0000-0000-0000-00000000aaaa.jsonl');

test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

function capture(fn) {
  const chunks = [];
  const errs = [];
  const outWrite = process.stdout.write.bind(process.stdout);
  const errWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = (s) => (chunks.push(String(s)), true);
  process.stderr.write = (s) => (errs.push(String(s)), true);
  let code;
  try {
    code = fn();
  } finally {
    process.stdout.write = outWrite;
    process.stderr.write = errWrite;
  }
  return { code, out: chunks.join(''), err: errs.join('') };
}

test('스코프: 대소문자 변형과 하위 프로젝트를 잡고 남은 프로젝트는 뺀다', () => {
  const scope = projects.resolveScope({ cwd: FIXTURE_CWD, root: ROOT });
  assert.deepStrictEqual(scope, ['D--Fix-Alpha-cnd', 'd--fix-alpha']);
  assert.ok(!scope.includes('D--Other'));
});

test('스코프: --all 은 전부', () => {
  const scope = projects.resolveScope({ cwd: FIXTURE_CWD, all: true, root: ROOT });
  assert.ok(scope.includes('D--Other'));
  assert.strictEqual(scope.length, 3);
});

test('트랜스크립트 목록: subagents 하위 디렉토리까지 훑는다', () => {
  const files = projects.listTranscripts(['d--fix-alpha'], { root: ROOT });
  assert.strictEqual(files.length, 2);
  assert.ok(files.some((f) => f.sessionId === 'agent-dddd4444'));
});

test('파싱: 발화만 남기고 attachment/queue-operation/tool_result/isMeta 는 뺀다', () => {
  const { messages, skipped } = transcript.parseTranscript(ALPHA);
  const texts = messages.map((m) => m.text);

  assert.strictEqual(skipped, 1, '깨진 라인 1개를 집계해야 한다');
  assert.ok(texts.some((t) => t.includes('첫 질문입니다 NEEDLE')));
  assert.ok(!texts.some((t) => t.includes('in attachment')), 'attachment 는 발화가 아니다');
  assert.ok(!texts.some((t) => t.includes('메타 NEEDLE')), 'isMeta 는 발화가 아니다');
  assert.ok(!texts.some((t) => t.includes('a\nb\nc')), 'tool_result 는 발화가 아니다');
});

test('파싱: system-reminder 래퍼 안 내용은 텍스트에서 지워진다', () => {
  const { messages } = transcript.parseTranscript(ALPHA);
  const target = messages.find((m) => m.text.includes('두번째 NEEDLE'));
  assert.ok(target);
  assert.ok(!target.text.includes('HIDDENONLY'));
  assert.ok(target.text.includes('끝'));
});

test('파싱: tool_use 와 뒤따르는 tool_result 를 잇는다', () => {
  const { messages } = transcript.parseTranscript(ALPHA);
  const withTool = messages.find((m) => m.tools.length > 0);
  assert.strictEqual(withTool.tools[0].name, 'Bash');
  assert.strictEqual(withTool.tools[0].desc, '목록 조회');
  assert.strictEqual(withTool.tools[0].resultLines, 3);
});

test('검색: 기본 스코프에서 발화 매칭만 집계한다', () => {
  const { out } = capture(() =>
    search.main(['NEEDLE', '--root', ROOT, '--cwd', FIXTURE_CWD])
  );
  assert.match(out, /hits 2/, 'alpha 세션의 발화 매칭은 2건');
  assert.ok(!out.includes('D--Other'), '다른 프로젝트는 기본 스코프 밖');
  assert.ok(out.includes('D--Fix-Alpha-cnd'), '하위 프로젝트는 포함');
});

test('검색: system-reminder 안에만 있는 문자열은 세션을 만들지 않는다', () => {
  const { out } = capture(() =>
    search.main(['HIDDENONLY', '--root', ROOT, '--cwd', FIXTURE_CWD])
  );
  assert.match(out, /매칭 없음/);
  assert.match(out, /cleanupPeriodDays/, '결과 0 이면 리텐션을 안내한다');
});

test('검색: --all 이면 다른 프로젝트도 나온다', () => {
  const { out } = capture(() =>
    search.main(['NEEDLE', '--all', '--root', ROOT, '--cwd', FIXTURE_CWD])
  );
  assert.ok(out.includes('D--Other'));
});

test('앵커 왕복: search 가 낸 앵커로 pick 이 같은 발화를 집는다', () => {
  const { out } = capture(() =>
    search.main(['NEEDLE', '--root', ROOT, '--cwd', FIXTURE_CWD])
  );
  const anchor = /@[0-9a-f]+#\d+\.[0-9a-z]+/.exec(out)[0];

  const picked = capture(() => pick.main([anchor, '--ctx', '1', '--root', ROOT]));
  assert.strictEqual(picked.code, 0);
  assert.match(picked.out, />U> 첫 질문입니다 NEEDLE 포함/);
});

test('앵커 왕복: subagents 세션(agent-*)도 픽업된다', () => {
  const { out } = capture(() =>
    search.main(['서브에이전트', '--root', ROOT, '--cwd', FIXTURE_CWD])
  );
  const anchor = /@agent-[0-9a-z]+#\d+\.[0-9a-z]+/.exec(out);
  assert.ok(anchor, 'search 가 agent 세션 앵커를 내야 한다');

  const picked = capture(() => pick.main([anchor[0], '--ctx', '0', '--root', ROOT]));
  assert.strictEqual(picked.code, 0, picked.err);
  assert.match(picked.out, />U> 서브에이전트 NEEDLE 기록/);
});

test('앵커: uuid 아닌 세션ID 는 자르지 않는다 (agent-* 접두사 충돌 방지)', () => {
  assert.strictEqual(render.shortId('aaaa1111-0000-0000-0000-00000000aaaa'), 'aaaa1111');
  assert.strictEqual(render.shortId('agent-a1220dfbf30a28b8f'), 'agent-a1220dfbf30a28b8f');
});

test('툴 힌트: 재실행이 같은 창을 열도록 --ctx 를 박는다', () => {
  const { messages } = transcript.parseTranscript(ALPHA);
  const withTool = messages.find((m) => m.tools.length > 0);
  const anchor = render.anchorOf('aaaa1111-0000-0000-0000-00000000aaaa', withTool);

  const { out } = capture(() => pick.main([anchor, '--ctx', '1', '--root', ROOT]));
  assert.match(out, /--ctx 1 --tool t1/);
});

test('앵커: uuid 가 어긋나면 거부한다', () => {
  const { messages } = transcript.parseTranscript(ALPHA);
  const target = messages.find((m) => m.text.includes('첫 질문입니다'));
  const bad = `@aaaa1111#${target.line}.deadbeef`;

  const { code, err } = capture(() => pick.main([bad, '--root', ROOT]));
  assert.strictEqual(code, 1);
  assert.match(err, /uuid 가 앵커와 다릅니다/);
});

test('앵커: 발화가 아닌 라인은 거부한다', () => {
  const { code, err } = capture(() => pick.main(['@aaaa1111#1.00000000', '--root', ROOT]));
  assert.strictEqual(code, 1);
  assert.match(err, /발화 라인이 아닙니다/);
});

test('앵커: 없는 세션은 리텐션 가능성을 안내한다', () => {
  const { code, err } = capture(() => pick.main(['@ffffffff#3.00000000', '--root', ROOT]));
  assert.strictEqual(code, 1);
  assert.match(err, /cleanupPeriodDays/);
});

test('예산: 발화는 2000자에서 잘린다', () => {
  const { messages } = transcript.parseTranscript(ALPHA);
  const long = messages.find((m) => m.text.startsWith('LONGONE'));
  assert.ok(long.text.length > render.BUDGET.utteranceChars);

  const anchor = render.anchorOf('aaaa1111-0000-0000-0000-00000000aaaa', long);
  const { out } = capture(() => pick.main([anchor, '--ctx', '0', '--root', ROOT]));
  assert.match(out, /\.\.\.\[\+\d+자\]/);
});

test('예산: 픽업 총량을 넘으면 중단하고 안내한다', () => {
  const blocks = [
    {
      project: 'P',
      sessionId: 'ssssssss-0000',
      mtime: new Date(),
      center: 1,
      messages: Array.from({ length: 40 }, (_, i) => ({
        line: i + 1,
        uuid: '',
        role: 'user',
        text: 'x'.repeat(1500),
        tools: [],
      })),
    },
  ];
  const { text } = render.renderPick(blocks, { ctx: 3 });
  assert.match(text, /예산 25000자 초과로 중단/);
  assert.ok(text.length < 40 * 1500);
});

test('툴 전문: --tool 로 결과를 꺼낸다', () => {
  const { messages } = transcript.parseTranscript(ALPHA);
  const withTool = messages.find((m) => m.tools.length > 0);
  const anchor = render.anchorOf('aaaa1111-0000-0000-0000-00000000aaaa', withTool);

  const { out } = capture(() =>
    pick.main([anchor, '--ctx', '0', '--tool', 't1', '--root', ROOT])
  );
  assert.match(out, /\[t1\] Bash/);
  assert.match(out, /a\nb\nc/);
});

test('앵커 파서: 형식과 관대함', () => {
  assert.deepStrictEqual(render.parseAnchor('@abcd1234#12.ff00aa11'), {
    session: 'abcd1234',
    line: 12,
    uuid: 'ff00aa11',
  });
  assert.deepStrictEqual(render.parseAnchor('abcd1234#12'), {
    session: 'abcd1234',
    line: 12,
    uuid: null,
  });
  assert.strictEqual(render.parseAnchor('그냥문자열'), null);
});
