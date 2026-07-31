#!/usr/bin/env node
/**
 * usage-audit / probe.js
 * OPTIONAL wire probe: measures the EXACT byte/token share of the request
 * (tools block per MCP server, system prompt, injected reminder blocks).
 *
 * How it works: starts a throwaway logging reverse-proxy on a free localhost
 * port, runs one short `claude -p` through it via ANTHROPIC_BASE_URL, captures
 * the request bodies, then shuts the proxy down and deletes the raw capture
 * (which contains an auth token) after extracting only aggregate numbers.
 *
 * NOTHING in the user's configuration is modified.
 *
 * Usage: node probe.js [--merge <audit.json>] [--model haiku] [--keep-raw]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');

const CHARS_PER_TOKEN = 3.35;
const tok = (c) => Math.round(c / CHARS_PER_TOKEN);

const args = process.argv.slice(2);
const argVal = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const MERGE = argVal('--merge', path.join(os.homedir(), '.claude', 'usage-audit', 'latest.json'));
const MODEL = argVal('--model', 'haiku');
const KEEP_RAW = args.includes('--keep-raw');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-audit-probe-'));
const captures = [];

function startProxy() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        if (req.method === 'POST' && /\/v1\/messages/.test(req.url)) captures.push(body);
      });
      const headers = Object.assign({}, req.headers, { host: 'api.anthropic.com' });
      delete headers['connection']; delete headers['proxy-connection'];
      const up = https.request(
        { hostname: 'api.anthropic.com', port: 443, path: req.url, method: req.method, headers },
        (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); }
      );
      up.on('error', (e) => { if (!res.headersSent) res.writeHead(502); res.end(String(e.message)); });
      req.pipe(up);
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function runClaude(port) {
  return new Promise((resolve) => {
    const env = Object.assign({}, process.env, { ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}` });
    // A tool call forces a 2nd turn, which is when the MCP tool set has settled.
    // Turn 1 alone would under-count servers that are still connecting (cold-start race).
    const p = spawn('claude', ['--model', MODEL, '--permission-mode', 'bypassPermissions',
      '-p', "Run the bash command 'echo probe' and report the output."],
      { env, shell: true, stdio: 'ignore' });
    const timer = setTimeout(() => { try { p.kill(); } catch (e) {} resolve(false); }, 180000);
    p.on('close', () => { clearTimeout(timer); resolve(true); });
    p.on('error', () => { clearTimeout(timer); resolve(false); });
  });
}

function labelBlock(t) {
  if (/^<system-reminder>\s*SessionStart hook/.test(t)) return 'SessionStart 훅 출력';
  if (/Available agent types/.test(t)) return '서브에이전트 목록';
  if (/The following skills are available/.test(t)) return 'Skills 목록';
  if (/deferred tools|ToolSearch/.test(t)) return 'Deferred 도구 명단';
  if (/still connecting|MCP servers/.test(t)) return 'MCP 연결 상태';
  if (/^<system-reminder>/.test(t)) return 'system-reminder (기타)';
  return '실제 사용자 프롬프트';
}

function analyzeRequest(buf) {
  let b; try { b = JSON.parse(buf.toString('utf8')); } catch (e) { return null; }
  if (!b || !Array.isArray(b.tools) || !b.messages) return null;

  const toolsChars = JSON.stringify(b.tools).length;
  const sysChars = JSON.stringify(b.system).length;
  const msgChars = JSON.stringify(b.messages).length;

  // per-server breakdown
  const byServer = {};
  for (const t of b.tools) {
    const key = t.name && t.name.startsWith('mcp__') ? t.name.split('__')[1] : '(builtin)';
    const size = JSON.stringify(t).length;
    const g = byServer[key] || (byServer[key] = { tools: 0, chars: 0 });
    g.tools++; g.chars += size;
  }

  // duplicate leaf-name detection across servers
  const leaves = {};
  for (const t of b.tools) {
    if (!t.name || !t.name.startsWith('mcp__')) continue;
    const leaf = t.name.split('__').slice(2).join('__');
    (leaves[leaf] = leaves[leaf] || []).push(t.name);
  }
  let dupChars = 0, dupCount = 0;
  const dupExamples = [];
  for (const [leaf, names] of Object.entries(leaves)) {
    if (names.length < 2) continue;
    for (const n of names.slice(1)) {
      const t = b.tools.find((x) => x.name === n);
      if (t) { dupChars += JSON.stringify(t).length; dupCount++; }
    }
    if (dupExamples.length < 5) dupExamples.push({ leaf, names });
  }

  // injected blocks in the first user turn
  const blocks = [];
  const first = b.messages[0];
  if (first && Array.isArray(first.content)) {
    for (const c of first.content) {
      const t = c.text || '';
      blocks.push({ label: labelBlock(t), chars: t.length, tokens: tok(t.length) });
    }
  }
  const injectedChars = blocks.filter((x) => x.label !== '실제 사용자 프롬프트').reduce((s, x) => s + x.chars, 0);

  // heaviest individual tools
  const heaviest = b.tools
    .map((t) => ({ name: t.name, chars: JSON.stringify(t).length }))
    .sort((a, b2) => b2.chars - a.chars).slice(0, 12);

  const total = toolsChars + sysChars + msgChars;
  return {
    model: b.model,
    toolCount: b.tools.length,
    composition: {
      toolsChars, toolsTokens: tok(toolsChars), toolsPct: +(100 * toolsChars / total).toFixed(1),
      systemChars: sysChars, systemTokens: tok(sysChars), systemPct: +(100 * sysChars / total).toFixed(1),
      messagesChars: msgChars, messagesTokens: tok(msgChars), messagesPct: +(100 * msgChars / total).toFixed(1),
      injectedChars, injectedTokens: tok(injectedChars),
      totalChars: total, totalTokens: tok(total),
    },
    byServer: Object.fromEntries(Object.entries(byServer)
      .sort((a, b2) => b2[1].chars - a[1].chars)
      .map(([k, v]) => [k, { tools: v.tools, chars: v.chars, tokens: tok(v.chars), perTool: Math.round(v.chars / v.tools) }])),
    duplicates: { count: dupCount, chars: dupChars, tokens: tok(dupChars), examples: dupExamples },
    injectedBlocks: blocks,
    heaviestTools: heaviest.map((h) => ({ name: h.name, chars: h.chars, tokens: tok(h.chars) })),
  };
}

(async function main() {
  console.log('usage-audit probe: 임시 프록시 기동...');
  let server;
  try { server = await startProxy(); } catch (e) { console.error('프록시 기동 실패:', e.message); process.exit(1); }
  const port = server.address().port;
  console.log(`  127.0.0.1:${port} → api.anthropic.com`);

  console.log('usage-audit probe: 짧은 세션 1회 실행 (설정 변경 없음)...');
  const ok = await runClaude(port);
  await new Promise((r) => setTimeout(r, 500));
  server.close();

  if (!captures.length) {
    console.error('요청을 캡처하지 못했습니다. claude CLI가 PATH에 있는지, 로그인 상태인지 확인하세요.');
    process.exit(2);
  }

  // pick the largest captured request (the main-model call, not the background classifier)
  const main = captures.slice().sort((a, b) => b.length - a.length)[0];
  const wire = analyzeRequest(main);
  if (!wire) { console.error('요청 파싱 실패'); process.exit(3); }
  wire.capturedRequests = captures.length;
  wire.probedAt = new Date().toISOString();

  console.log('\n=== 요청 구성 (실측) ===');
  const c = wire.composition;
  console.log(`  tools     ${String(c.toolsTokens).padStart(7)} tok  ${String(c.toolsPct).padStart(5)}%   (도구 ${wire.toolCount}개)`);
  console.log(`  system    ${String(c.systemTokens).padStart(7)} tok  ${String(c.systemPct).padStart(5)}%`);
  console.log(`  messages  ${String(c.messagesTokens).padStart(7)} tok  ${String(c.messagesPct).padStart(5)}%  (주입 ${c.injectedTokens} tok)`);
  console.log('\n=== 서버별 도구 블록 ===');
  for (const [k, v] of Object.entries(wire.byServer)) {
    console.log(`  ${k.padEnd(40)} ${String(v.tools).padStart(4)} tools ${String(v.tokens).padStart(7)} tok  (${v.perTool}/tool)`);
  }
  if (wire.duplicates.count) {
    console.log(`\n  ⚠ 중복 등록 ${wire.duplicates.count}건 · 낭비 ${wire.duplicates.tokens} tok`);
  }

  // merge into the audit result
  if (fs.existsSync(MERGE)) {
    try {
      const j = JSON.parse(fs.readFileSync(MERGE, 'utf8'));
      j.wire = wire;
      fs.writeFileSync(MERGE, JSON.stringify(j, null, 2));
      console.log(`\n병합 완료 → ${MERGE}`);
    } catch (e) { console.error('병합 실패:', e.message); }
  } else {
    const out = path.join(os.homedir(), '.claude', 'usage-audit', 'wire-only.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ schema: 'usage-audit/wire-1', wire }, null, 2));
    console.log(`\naudit.json이 없어 단독 저장 → ${out}`);
  }

  // raw capture holds an auth token — discard unless explicitly kept
  if (!KEEP_RAW) {
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
    console.log('원본 캡처(인증 토큰 포함)는 메모리에서만 사용했고 디스크에 남기지 않았습니다.');
  }
})().catch((e) => { console.error('probe failed:', e.message); process.exit(1); });
