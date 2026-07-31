#!/usr/bin/env node
// index.js - PostToolUse(Edit|Write) hook entry for convention-enforcer.
//
// Generalizes comment-linter from comment rules to per-layer business conventions.
// Conventions are DATA (conventions/*.json), not code. ONLY human-promoted rules
// (enforced.json) block; generated draft rules are advisory at most.
//
//   exit 2 + stderr  -> blocking violation (Claude auto-corrects)
//   exit 0 + stdout  -> advisory (draft findings, surfaced as context)
//   exit 0 silent    -> no findings / out-of-scope file

const fs = require('fs');
const { detectLayer } = require('./lib/detect');
const { loadLayers, loadRules, rulesForLayer } = require('./lib/load');
const { runRules } = require('./lib/engine');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main() {
  const raw = readStdin();
  if (!raw) process.exit(0);

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  if (payload.tool_name !== 'Edit' && payload.tool_name !== 'Write') process.exit(0);

  const filePath = payload.tool_input && payload.tool_input.file_path;
  if (!filePath) process.exit(0);

  const layer = detectLayer(filePath, loadLayers());
  if (!layer) process.exit(0);

  const enforcedRules = rulesForLayer(loadRules().enforced, layer);
  const draftRules = rulesForLayer(loadRules().draft, layer);
  if (enforcedRules.length === 0 && draftRules.length === 0) process.exit(0);

  // PostToolUse fires after the write succeeded, so the file on disk is current.
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    process.exit(0);
  }

  const { blocking, advisory } = runRules(content, enforcedRules, draftRules);

  if (blocking.length > 0) {
    process.stderr.write(formatBlock(filePath, layer, blocking));
    process.exit(2);
  }
  if (advisory.length > 0) {
    process.stdout.write(formatAdvisory(filePath, layer, advisory));
  }
  process.exit(0);
}

function formatBlock(filePath, layer, violations) {
  let out = `[convention-enforcer] ${filePath} (${layer}) - 컨벤션 위반\n`;
  for (const v of violations) {
    out += `  [${v.ruleId}] ${v.message}\n`;
  }
  out += `\n위 컨벤션에 맞게 수정 후 다시 편집하세요. (룰: .claude/hooks/convention-enforcer/conventions/enforced.json)\n`;
  return out;
}

function formatAdvisory(filePath, layer, findings) {
  let out = `[convention-enforcer advisory] ${filePath} (${layer})\n`;
  out += `생성된(draft) 컨벤션 후보와 어긋납니다. 검토 후 필요시 enforced로 승격하세요:\n`;
  for (const f of findings) {
    out += `  [${f.ruleId}] ${f.message}\n`;
  }
  return out;
}

main();
