'use strict';

const { parseArgs } = require('node:util');

const projects = require('./lib/projects');
const transcript = require('./lib/transcript');
const render = require('./lib/render');

const USAGE = `사용법: node pick.js <앵커...> [옵션]

  앵커는 search.js 가 출력한 @<세션8자>#<라인>.<uuid8> 형식.

  --ctx N       매칭 발화 전후 턴 수 (기본 3)
  --tool tN     픽업 출력에 요약된 툴 중 지정한 것의 결과 전문
  --root PATH   projects 디렉토리 경로 (테스트용)
`;

function locate(anchor, root) {
  const parsedAnchor = render.parseAnchor(anchor);
  if (!parsedAnchor) {
    return { error: `앵커 형식이 아닙니다: ${anchor}` };
  }

  const candidates = projects.findBySessionPrefix(parsedAnchor.session, { root });
  if (candidates.length === 0) {
    return {
      error:
        `세션 ${parsedAnchor.session} 을 찾을 수 없습니다. ` +
        `리텐션(cleanupPeriodDays 기본 30일)으로 삭제됐을 수 있습니다.`,
    };
  }
  if (candidates.length > 1) {
    return { error: `세션 접두사 ${parsedAnchor.session} 가 ${candidates.length}개 파일에 걸립니다. 더 긴 접두사가 필요합니다.` };
  }

  const meta = candidates[0];
  const { messages, skipped } = transcript.parseTranscript(meta.file);
  const index = messages.findIndex((m) => m.line === parsedAnchor.line);

  if (index === -1) {
    return { error: `${parsedAnchor.session}#${parsedAnchor.line} 은 발화 라인이 아닙니다. 다시 검색하세요.` };
  }

  const target = messages[index];
  if (parsedAnchor.uuid) {
    const actual = (target.uuid || '').replace(/-/g, '').slice(0, parsedAnchor.uuid.length);
    if (actual !== parsedAnchor.uuid) {
      return {
        error:
          `${parsedAnchor.session}#${parsedAnchor.line} 의 uuid 가 앵커와 다릅니다 ` +
          `(앵커 ${parsedAnchor.uuid} / 실제 ${actual || '없음'}). 다시 검색하세요.`,
      };
    }
  }

  return { meta, messages, index, center: target.line, skipped };
}

function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        ctx: { type: 'string', default: '3' },
        tool: { type: 'string' },
        root: { type: 'string' },
      },
    });
  } catch (err) {
    process.stderr.write(`${err.message}\n\n${USAGE}`);
    return 1;
  }

  const anchors = parsed.positionals.filter(Boolean);
  if (anchors.length === 0) {
    process.stderr.write(USAGE);
    return 1;
  }

  const root = parsed.values.root || projects.PROJECTS_DIR;
  const ctx = Math.max(0, Number(parsed.values.ctx) || 0);

  const blocks = [];
  const errors = [];
  let skipped = 0;

  for (const anchor of anchors) {
    const found = locate(anchor, root);
    if (found.error) {
      errors.push(found.error);
      continue;
    }
    skipped += found.skipped;
    const from = Math.max(0, found.index - ctx);
    const to = Math.min(found.messages.length, found.index + ctx + 1);
    blocks.push({
      project: found.meta.project,
      sessionId: found.meta.sessionId,
      mtime: found.meta.mtime,
      center: found.center,
      messages: found.messages.slice(from, to),
    });
  }

  if (blocks.length === 0) {
    process.stderr.write(errors.join('\n') + '\n');
    return 1;
  }

  const { text, toolIndex } = render.renderPick(blocks, { ctx });

  if (parsed.values.tool) {
    const entry = toolIndex.get(parsed.values.tool);
    if (!entry) {
      process.stderr.write(
        `${parsed.values.tool} 은 --ctx ${ctx} 창에 없는 툴 참조입니다. ` +
          `같은 앵커에 --ctx ${ctx} 로 먼저 픽업해 번호를 확인하세요.\n`
      );
      return 1;
    }
    process.stdout.write(render.renderToolDump(entry, parsed.values.tool) + '\n');
    return 0;
  }

  process.stdout.write(text + '\n');
  if (skipped > 0) process.stdout.write(`\n(깨진 라인 ${skipped}개 건너뜀)\n`);
  if (errors.length > 0) process.stderr.write('\n' + errors.join('\n') + '\n');

  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { main, locate };
