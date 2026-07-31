#!/usr/bin/env node
/**
 * usage-audit / audit.js
 * Offline audit of the Claude Code extension surface and actual usage.
 * No network. Reads config + transcripts only. Writes a JSON result file.
 *
 * Usage: node audit.js [--out <path>] [--days N] [--quiet]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude');
const PROJECTS = path.join(CLAUDE_DIR, 'projects');

// Calibrated empirically: tool-schema JSON averages ~3.35 chars per token.
// (derived from a measured 150,170-char / 45,457-token tool-block delta)
const CHARS_PER_TOKEN = 3.35;
const tok = (chars) => Math.round(chars / CHARS_PER_TOKEN);

const args = process.argv.slice(2);
const argVal = (flag, def) => { const i = args.indexOf(flag); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
const QUIET = args.includes('--quiet');
const DAYS = parseInt(argVal('--days', '0'), 10) || 0; // 0 = all history
const OUT = argVal('--out', path.join(CLAUDE_DIR, 'usage-audit', 'latest.json'));

const log = (...a) => { if (!QUIET) console.log(...a); };

function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; }
}
function safeStat(p) { try { return fs.statSync(p); } catch (e) { return null; } }

// ---------------------------------------------------------------- config side
function readConfigSurface() {
  const dotClaude = readJSON(path.join(HOME, '.claude.json'), {});
  const settings = readJSON(path.join(CLAUDE_DIR, 'settings.json'), {});
  const settingsLocal = readJSON(path.join(CLAUDE_DIR, 'settings.local.json'), {});

  // --- MCP servers
  const mcpServers = Object.keys(dotClaude.mcpServers || {});

  // --- skills: each skill's frontmatter description is resident every session
  const skills = [];
  const skillRoots = [path.join(CLAUDE_DIR, 'skills')];
  for (const root of skillRoots) {
    if (!safeStat(root)) continue;
    for (const entry of fs.readdirSync(root)) {
      const md = path.join(root, entry, 'SKILL.md');
      if (!safeStat(md)) continue;
      let text = '';
      try { text = fs.readFileSync(md, 'utf8'); } catch (e) { continue; }
      const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      const block = fm ? fm[1] : '';
      const nameM = block.match(/^name:\s*(.+)$/m);
      const descM = block.match(/^description:\s*([\s\S]*?)(?=\n\w+:|$)/m);
      const desc = descM ? descM[1].trim() : '';
      skills.push({
        name: nameM ? nameM[1].trim() : entry,
        dir: entry,
        descChars: desc.length,
        bodyChars: text.length - block.length,
        totalChars: text.length,
      });
    }
  }

  // --- subagents
  const agents = [];
  const agentDir = path.join(CLAUDE_DIR, 'agents');
  if (safeStat(agentDir)) {
    for (const f of fs.readdirSync(agentDir)) {
      if (!f.endsWith('.md')) continue;
      let text = ''; try { text = fs.readFileSync(path.join(agentDir, f), 'utf8'); } catch (e) { continue; }
      const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      const block = fm ? fm[1] : '';
      const descM = block.match(/^description:\s*([\s\S]*?)(?=\n\w+:|$)/m);
      agents.push({ name: f.replace(/\.md$/, ''), descChars: (descM ? descM[1].trim() : '').length, totalChars: text.length });
    }
  }

  // --- hooks: count commands per event (context cost ~0, but they execute per event)
  const hooks = [];
  for (const [event, entries] of Object.entries(settings.hooks || {})) {
    for (const e of (entries || [])) {
      for (const h of (e.hooks || [])) {
        hooks.push({ event, matcher: e.matcher || '(all)', command: h.command || '', timeout: h.timeout || null });
      }
    }
  }

  // --- plugins
  const plugins = Object.entries(settings.enabledPlugins || {}).map(([k, v]) => ({ name: k, enabled: !!v }));

  return {
    mcpServers,
    skills,
    agents,
    hooks,
    plugins,
    statusLine: settings.statusLine ? settings.statusLine.command : null,
    permissionsAllow: (settings.permissions && settings.permissions.allow || []).length,
    additionalDirectories: (settings.permissions && settings.permissions.additionalDirectories || []).length,
    localPermissionsAllow: (settingsLocal.permissions && settingsLocal.permissions.allow || []).length,
    usageCounters: {
      skillUsage: dotClaude.skillUsage || {},
      pluginUsage: dotClaude.pluginUsage || {},
    },
  };
}

// ------------------------------------------------------------ transcript side
function classifyError(s) {
  const t = String(s).toLowerCase();
  if (/user doesn't want to proceed|tool use was rejected/.test(t)) return 'USER_REJECTED';
  if (/permission .*denied|blocked by classifier|not allowed/.test(t)) return 'PERMISSION_DENIED';
  if (/has not been read yet|read it first/.test(t)) return 'EDIT_BEFORE_READ';
  if (/string to replace not found/.test(t)) return 'EDIT_STRING_NOT_FOUND';
  if (/found \d+ matches of the string|replace_all is false/.test(t)) return 'EDIT_AMBIGUOUS_MATCH';
  if (/file does not exist|no such file|cannot find path|enoent/.test(t)) return 'FILE_NOT_FOUND';
  if (/has been modified since|modified externally/.test(t)) return 'FILE_CHANGED_EXTERNALLY';
  if (/inputvalidationerror|could not be parsed as json/.test(t)) return 'INPUT_VALIDATION';
  if (/timed out|timeout|etimedout/.test(t)) return 'TIMEOUT';
  if (/syntaxerror|invalid syntax|unexpected token/.test(t)) return 'SYNTAX_ERROR';
  if (/npm error|yarn error|pnpm error/.test(t)) return 'PKG_MANAGER_ERROR';
  if (/command not found|is not recognized/.test(t)) return 'COMMAND_NOT_FOUND';
  if (/connection|econnrefused|network|fetch failed|50[234]/.test(t)) return 'NETWORK';
  if (/exit code [1-9]/.test(t)) return 'NONZERO_EXIT';
  return 'OTHER';
}

function scanTranscript(file, acc, cutoffMs) {
  return new Promise((resolve) => {
    const st = safeStat(file);
    if (!st) return resolve();
    if (cutoffMs && st.mtimeMs < cutoffMs) return resolve();

    const lines = [];
    const rd = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
    rd.on('line', (l) => { if (l.trim()) lines.push(l); });
    rd.on('error', () => resolve());
    rd.on('close', () => {
      const n = lines.length || 1;
      acc.sessions++;
      acc.sessionSizes.push(n);
      const pendingTool = new Map();

      lines.forEach((line, idx) => {
        let j; try { j = JSON.parse(line); } catch (e) { return; }
        acc.records++;
        const q = Math.min(3, Math.floor((idx / n) * 4));

        if (j.type === 'summary' || j.subtype === 'compact_boundary' || j.isCompactSummary) acc.compactions++;

        if (j.type === 'assistant' && j.message && Array.isArray(j.message.content)) {
          for (const b of j.message.content) {
            if (b.type !== 'tool_use') continue;
            acc.toolCalls++;
            acc.callsByQuartile[q]++;
            acc.byTool[b.name] = acc.byTool[b.name] || { calls: 0, errors: 0 };
            acc.byTool[b.name].calls++;
            if (b.name && b.name.startsWith('mcp__')) {
              const server = b.name.split('__')[1];
              acc.mcpUsage[server] = (acc.mcpUsage[server] || 0) + 1;
            }
            if (b.id) pendingTool.set(b.id, b.name);
          }
        }

        if (j.type === 'user' && j.message && Array.isArray(j.message.content)) {
          for (const b of j.message.content) {
            if (b.type !== 'tool_result' || !b.is_error) continue;
            acc.toolErrors++;
            acc.errorsByQuartile[q]++;
            const s = typeof b.content === 'string' ? b.content : JSON.stringify(b.content || '');
            const cat = classifyError(s);
            acc.errorCats[cat] = (acc.errorCats[cat] || 0) + 1;
            if (cat === 'EDIT_BEFORE_READ') acc.editBeforeReadByQuartile[q]++;
            const nm = pendingTool.get(b.tool_use_id);
            if (nm) { acc.byTool[nm] = acc.byTool[nm] || { calls: 0, errors: 0 }; acc.byTool[nm].errors++; }
          }
        }
      });
      resolve();
    });
  });
}

async function scanAllTranscripts() {
  const acc = {
    sessions: 0, records: 0, toolCalls: 0, toolErrors: 0, compactions: 0,
    sessionSizes: [], byTool: {}, mcpUsage: {}, errorCats: {},
    callsByQuartile: [0, 0, 0, 0], errorsByQuartile: [0, 0, 0, 0], editBeforeReadByQuartile: [0, 0, 0, 0],
  };
  if (!safeStat(PROJECTS)) return acc;
  const cutoff = DAYS ? Date.now() - DAYS * 86400000 : 0;
  for (const proj of fs.readdirSync(PROJECTS)) {
    const dir = path.join(PROJECTS, proj);
    const st = safeStat(dir);
    if (!st || !st.isDirectory()) continue;
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch (e) { continue; }
    for (const f of files) await scanTranscript(path.join(dir, f), acc, cutoff);
  }
  return acc;
}

// ------------------------------------------------------------------- analysis
function analyze(cfg, usage) {
  const findings = [];

  // 1) MCP servers configured but unused
  for (const s of cfg.mcpServers) {
    const used = usage.mcpUsage[s] || 0;
    if (used === 0) {
      findings.push({ kind: 'unused_mcp', severity: 'high', subject: s,
        detail: `MCP 서버 '${s}'가 설정돼 있으나 분석 범위에서 도구 호출 0회` });
    } else if (used <= 2) {
      findings.push({ kind: 'rare_mcp', severity: 'medium', subject: s,
        detail: `MCP 서버 '${s}' 사용 ${used}회로 희소` });
    }
  }

  // 2) MCP servers used but NOT in local config (connectors / plugin-provided)
  for (const [s, n] of Object.entries(usage.mcpUsage)) {
    if (!cfg.mcpServers.includes(s)) {
      findings.push({ kind: 'external_mcp', severity: 'info', subject: s,
        detail: `'${s}'는 로컬 mcpServers에 없음 (커넥터/플러그인 제공) — 사용 ${n}회` });
    }
  }

  // 3) duplicate tool namespaces (same leaf name under two servers)
  const servers = Object.keys(usage.mcpUsage);
  const dupPairs = [];
  for (const a of servers) for (const b of servers) {
    if (a >= b) continue;
    if (b.includes(a) || a.includes(b)) dupPairs.push([a, b]);
  }
  for (const [a, b] of dupPairs) {
    findings.push({ kind: 'possible_duplicate', severity: 'high', subject: `${a} / ${b}`,
      detail: `서버 이름이 포함관계 — 같은 도구가 이중 등록됐을 가능성` });
  }

  // 4) skills never used
  const skillUse = cfg.usageCounters.skillUsage || {};
  const usedSkillNames = new Set(Object.keys(skillUse));
  for (const sk of cfg.skills) {
    const rec = skillUse[sk.name] || skillUse[sk.dir];
    const count = rec && rec.usageCount ? rec.usageCount : 0;
    if (count === 0) {
      findings.push({ kind: 'unused_skill', severity: 'low', subject: sk.name,
        detail: `스킬 '${sk.name}' 사용 0회 — 설명 ${sk.descChars}자(~${tok(sk.descChars)} tok)가 매 세션 상주` });
    }
  }

  // 5) plugins enabled but unused
  const pu = cfg.usageCounters.pluginUsage || {};
  for (const p of cfg.plugins) {
    if (!p.enabled) continue;
    const rec = pu[p.name];
    const count = rec && rec.usageCount ? rec.usageCount : 0;
    const starts = rec && rec.lastUsedNumStartups ? rec.lastUsedNumStartups : 0;
    if (count === 0 && starts > 5) {
      findings.push({ kind: 'unused_plugin', severity: 'medium', subject: p.name,
        detail: `플러그인 '${p.name}' 활성화 상태이나 사용 0회 (${starts} 세션 시작 동안)` });
    }
  }

  // 6) drift: error rate by quartile
  const rate = usage.callsByQuartile.map((c, i) => (c ? usage.errorsByQuartile[i] / c : 0));
  const driftRatio = rate[0] > 0 ? rate[3] / rate[0] : null;
  if (driftRatio && driftRatio > 1.4) {
    findings.push({ kind: 'session_drift', severity: 'medium', subject: 'session length',
      detail: `세션 후반 오류율이 초반의 ${driftRatio.toFixed(1)}배 — 긴 세션 분할 검토` });
  }

  // 7) high-failure tools
  for (const [name, v] of Object.entries(usage.byTool)) {
    if (v.calls < 20) continue;
    const r = v.errors / v.calls;
    if (r >= 0.10) {
      findings.push({ kind: 'flaky_tool', severity: r >= 0.2 ? 'high' : 'medium', subject: name,
        detail: `'${name}' 실패율 ${(r * 100).toFixed(1)}% (${v.errors}/${v.calls})` });
    }
  }

  const order = { high: 0, medium: 1, low: 2, info: 3 };
  findings.sort((a, b) => (order[a.severity] - order[b.severity]));
  return { findings, errorRateByQuartile: rate, driftRatio };
}

// ---------------------------------------------------------------------- main
(async function main() {
  const startedAt = new Date().toISOString();
  log('usage-audit: 설정 표면 수집 중...');
  const cfg = readConfigSurface();
  log(`  MCP 서버 ${cfg.mcpServers.length} · 스킬 ${cfg.skills.length} · 에이전트 ${cfg.agents.length} · 훅 ${cfg.hooks.length} · 플러그인 ${cfg.plugins.filter(p => p.enabled).length}개 활성`);

  log('usage-audit: 트랜스크립트 스캔 중' + (DAYS ? ` (최근 ${DAYS}일)` : ' (전체)') + '...');
  const usage = await scanAllTranscripts();
  log(`  세션 ${usage.sessions} · 레코드 ${usage.records.toLocaleString()} · 도구호출 ${usage.toolCalls.toLocaleString()} · 오류 ${usage.toolErrors}`);

  const analysis = analyze(cfg, usage);

  // resident cost estimate (what we can measure without the wire)
  const skillDescChars = cfg.skills.reduce((s, x) => s + x.descChars, 0);
  const agentDescChars = cfg.agents.reduce((s, x) => s + x.descChars, 0);
  const resident = {
    skillListChars: skillDescChars,
    skillListTokens: tok(skillDescChars),
    agentListChars: agentDescChars,
    agentListTokens: tok(agentDescChars),
    note: 'MCP 도구 블록의 정확한 바이트는 probe.js(와이어 캡처)로만 측정 가능',
  };

  const sizes = usage.sessionSizes.slice().sort((a, b) => a - b);
  const result = {
    schema: 'usage-audit/1',
    startedAt,
    scope: DAYS ? `최근 ${DAYS}일` : '전체 이력',
    charsPerToken: CHARS_PER_TOKEN,
    config: cfg,
    usage: {
      sessions: usage.sessions,
      records: usage.records,
      toolCalls: usage.toolCalls,
      toolErrors: usage.toolErrors,
      errorRate: usage.toolCalls ? usage.toolErrors / usage.toolCalls : 0,
      compactions: usage.compactions,
      medianSessionRecords: sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0,
      maxSessionRecords: sizes.length ? sizes[sizes.length - 1] : 0,
      mcpUsage: usage.mcpUsage,
      byTool: usage.byTool,
      errorCats: usage.errorCats,
      callsByQuartile: usage.callsByQuartile,
      errorsByQuartile: usage.errorsByQuartile,
      editBeforeReadByQuartile: usage.editBeforeReadByQuartile,
    },
    resident,
    analysis,
    // Preserve any wire measurement from a previous probe.js run so that
    // re-running audit.js does not silently discard it. Marked with its own
    // timestamp so a stale probe is visible in the report.
    wire: (readJSON(OUT, {}) || {}).wire || null,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  // keep a dated history copy alongside latest.json
  const stamp = startedAt.replace(/[:.]/g, '-');
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  const histDir = path.join(path.dirname(OUT), 'history');
  fs.mkdirSync(histDir, { recursive: true });
  fs.writeFileSync(path.join(histDir, `audit-${stamp}.json`), JSON.stringify(result, null, 2));

  log(`\nusage-audit: 결과 → ${OUT}`);
  log(`  발견 ${analysis.findings.length}건 (high ${analysis.findings.filter(f => f.severity === 'high').length})`);
  if (!QUIET) {
    for (const f of analysis.findings.slice(0, 12)) {
      log(`   [${f.severity}] ${f.kind}: ${f.detail}`);
    }
  }
})().catch((e) => { console.error('usage-audit failed:', e.message); process.exit(1); });
