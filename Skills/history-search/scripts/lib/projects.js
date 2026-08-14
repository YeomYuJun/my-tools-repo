'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

/**
 * Claude Code 가 cwd 를 프로젝트 디렉토리명으로 바꾸는 규칙.
 * 비영숫자를 '-' 로, 대소문자는 cwd 문자열 그대로 (드라이브 문자가 세션마다 달라짐).
 */
function encodeCwd(cwd) {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

function listProjectNames(root = PROJECTS_DIR) {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

/**
 * 스캔할 프로젝트 디렉토리명을 고른다.
 * 기본은 현재 cwd 의 프로젝트 + 그 하위 경로에서 열린 프로젝트.
 * 'd--0--dle' 로 인코딩돼도 실제 디렉토리는 'D--0--dle' 일 수 있어 대소문자를 무시한다.
 */
function resolveScope({ cwd, all = false, root = PROJECTS_DIR } = {}) {
  const names = listProjectNames(root);
  if (all) return names.sort();

  const prefix = encodeCwd(cwd).toLowerCase();
  return names
    .filter((name) => {
      const lower = name.toLowerCase();
      return lower === prefix || lower.startsWith(prefix + '-');
    })
    .sort();
}

function walkJsonl(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJsonl(full, out);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) out.push(full);
  }
}

/**
 * 대상 프로젝트들의 트랜스크립트 목록. subagents/ 같은 하위 디렉토리도 포함한다.
 * days 가 있으면 파일 mtime(세션 마지막 활동) 기준으로 자른다.
 */
function listTranscripts(projectNames, { root = PROJECTS_DIR, days } = {}) {
  const cutoff = days ? Date.now() - days * 86400000 : null;
  const result = [];

  for (const name of projectNames) {
    const files = [];
    walkJsonl(path.join(root, name), files);

    for (const file of files) {
      let stat;
      try {
        stat = fs.statSync(file);
      } catch {
        continue;
      }
      if (cutoff !== null && stat.mtimeMs < cutoff) continue;
      result.push({
        project: name,
        sessionId: path.basename(file, '.jsonl'),
        file,
        mtime: stat.mtime,
        size: stat.size,
      });
    }
  }

  return result.sort((a, b) => b.mtime - a.mtime);
}

/** 앵커의 세션ID 앞 8자로 트랜스크립트 파일을 되찾는다. */
function findBySessionPrefix(prefix, { root = PROJECTS_DIR } = {}) {
  const lower = prefix.toLowerCase();
  const matches = listTranscripts(listProjectNames(root), { root }).filter((t) =>
    t.sessionId.toLowerCase().startsWith(lower)
  );
  return matches;
}

module.exports = {
  PROJECTS_DIR,
  encodeCwd,
  listProjectNames,
  resolveScope,
  listTranscripts,
  findBySessionPrefix,
};
