#!/usr/bin/env node
/**
 * comment-linter — PostToolUse hook entry point
 * Receives: Claude Code hook payload via stdin (JSON).
 * Behavior:
 *   - exit 2 + stderr → blocking violation (Claude auto-corrects)
 *   - exit 0 + stdout → advisory (sent back as system reminder)
 *   - exit 0 silently → no findings or out-of-scope file
 */

const fs = require('fs');

const { detectContext } = require('./lib/detect');
const { extractAddedComments } = require('./lib/extract');
const { runRules } = require('./lib/engine');

function readStdinSync() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main() {
  const raw = readStdinSync();
  if (!raw) process.exit(0);

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const toolName = payload.tool_name;
  if (toolName !== 'Edit' && toolName !== 'Write') process.exit(0);

  const ti = payload.tool_input || {};
  const filePath = ti.file_path;
  if (!filePath) process.exit(0);

  const ctx = detectContext(filePath);
  if (!ctx) process.exit(0);

  const comments = extractAddedComments(toolName, ti, ctx.language);
  if (comments.length === 0) process.exit(0);

  const { blocking, advisory } = runRules(comments, ctx);

  if (blocking.length > 0) {
    process.stderr.write(formatBlock(blocking, filePath));
    process.exit(2);
  }

  if (advisory.length > 0) {
    process.stdout.write(formatAdvisory(advisory, filePath));
  }

  process.exit(0);
}

function formatBlock(violations, filePath) {
  let out = `[comment-linter] ${filePath} — 주석 컨벤션 위반\n`;
  for (const v of violations) {
    out += `  L${v.line} [${v.ruleId}] ${v.message}\n`;
    out += `    > ${truncate(v.snippet, 160)}\n`;
  }
  out += `\n위 주석을 제거하거나 컨벤션에 맞게 수정 후 다시 편집하세요.\n`;
  out += `(룰 정의: .claude/hooks/comment-linter/rules/)\n`;
  return out;
}

function formatAdvisory(findings, filePath) {
  let out = `[comment-linter advisory] ${filePath}\n`;
  out += `다음 주석은 의미 판단이 필요합니다. WHAT-주석이거나 시그니처/실제 동작과 어긋나는지 검토하세요:\n`;
  for (const f of findings) {
    out += `  L${f.line}: ${truncate(f.snippet, 160)}\n`;
  }
  return out;
}

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}

main();
