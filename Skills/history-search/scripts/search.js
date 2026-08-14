'use strict';

const { parseArgs } = require('node:util');

const projects = require('./lib/projects');
const transcript = require('./lib/transcript');
const render = require('./lib/render');

const USAGE = `사용법: node search.js "<쿼리>" [옵션]

  --all         전체 프로젝트 (기본은 현재 프로젝트 + 하위)
  --days N      최근 N일로 제한 (파일 mtime 기준)
  --tools       툴 결과와 파일 내용까지 검색 대상에 포함
  --top N       표시할 세션 수 (기본 8)
  --root PATH   projects 디렉토리 경로 (테스트용)
  --cwd PATH    현재 프로젝트 판정에 쓸 경로 (테스트용)
`;

function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        all: { type: 'boolean', default: false },
        days: { type: 'string' },
        tools: { type: 'boolean', default: false },
        top: { type: 'string', default: '8' },
        root: { type: 'string' },
        cwd: { type: 'string' },
      },
    });
  } catch (err) {
    process.stderr.write(`${err.message}\n\n${USAGE}`);
    return 1;
  }

  const query = parsed.positionals.join(' ').trim();
  if (!query) {
    process.stderr.write(USAGE);
    return 1;
  }

  const root = parsed.values.root || projects.PROJECTS_DIR;
  const top = Number(parsed.values.top) || 8;
  const days = parsed.values.days ? Number(parsed.values.days) : undefined;
  const needleLower = query.toLowerCase();
  const cwd = parsed.values.cwd || process.cwd();

  let scope;
  try {
    scope = projects.resolveScope({ cwd, all: parsed.values.all, root });
  } catch (err) {
    process.stderr.write(`projects 디렉토리를 읽을 수 없습니다: ${root}\n${err.message}\n`);
    return 1;
  }

  if (scope.length === 0) {
    process.stdout.write(
      `현재 프로젝트(${projects.encodeCwd(cwd)})에 해당하는 세션 기록이 없습니다.\n` +
        `전체를 검색하려면 --all 을 붙이세요.\n`
    );
    return 0;
  }

  const files = projects.listTranscripts(scope, { root, days });
  const sessions = [];
  let skipped = 0;

  for (const meta of files) {
    if (!transcript.fileMayContain(meta.file, query)) continue;

    const { messages, skipped: fileSkipped } = transcript.parseTranscript(meta.file);
    skipped += fileSkipped;

    const matches = messages.filter((msg) => {
      if (transcript.matchesQuery(msg.text, needleLower)) return true;
      if (!parsed.values.tools) return false;
      return msg.tools.some(
        (t) =>
          transcript.matchesQuery(t.desc || '', needleLower) ||
          transcript.matchesQuery(t.resultText || '', needleLower)
      );
    });

    if (matches.length === 0) continue;

    sessions.push({
      project: meta.project,
      sessionId: meta.sessionId,
      mtime: meta.mtime,
      hits: matches.length,
      anchor: render.anchorOf(meta.sessionId, matches[0]),
      snippets: matches.slice(0, render.BUDGET.snippetsPerSession).map((m) => ({
        role: m.role,
        text: m.text,
      })),
    });
  }

  sessions.sort((a, b) => b.hits - a.hits || b.mtime - a.mtime);

  const scopeLabel = parsed.values.all ? '전체 프로젝트' : scope.join(', ');
  process.stdout.write(
    render.renderSearch(sessions.slice(0, top), {
      query,
      scopeLabel,
      scanned: files.length,
      skipped,
    }) + '\n'
  );

  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { main };
