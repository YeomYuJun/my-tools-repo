#!/usr/bin/env node
/**
 * usage-audit / report.js
 * Renders the audit JSON into a self-contained, theme-aware HTML report.
 *
 * Usage: node report.js [--in <audit.json>] [--out <report.html>]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const args = process.argv.slice(2);
const argVal = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const IN = argVal('--in', path.join(os.homedir(), '.claude', 'usage-audit', 'latest.json'));
const OUT = argVal('--out', path.join(os.homedir(), '.claude', 'usage-audit', 'report.html'));

const j = JSON.parse(fs.readFileSync(IN, 'utf8'));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n = (x) => (typeof x === 'number' ? x.toLocaleString() : x);
const pct = (x) => (x * 100).toFixed(1) + '%';

const sev = { high: '높음', medium: '중간', low: '낮음', info: '정보' };

// ---- sections -------------------------------------------------------------
const u = j.usage, w = j.wire, cfg = j.config;

const rateQ = (j.analysis.errorRateByQuartile || []).map((r) => (r * 100));
const maxRate = Math.max(0.001, ...rateQ);
const bars = rateQ.map((r, i) => {
  const h = Math.round((r / maxRate) * 130);
  const x = 90 + i * 120;
  const cls = i >= 2 ? 'barB' : 'barA';
  return `<rect class="${cls}" x="${x}" y="${170 - h}" width="76" height="${h}"/>
    <text class="val" x="${x + 38}" y="${162 - h}" text-anchor="middle">${r.toFixed(2)}%</text>
    <text class="lbl" x="${x + 38}" y="188" text-anchor="middle">Q${i + 1}</text>`;
}).join('\n');

const findingRows = j.analysis.findings.map((f) => `
  <tr class="sev-${f.kind === 'external_mcp' ? 'info' : f.severity}">
    <td><span class="pill ${f.severity}">${sev[f.severity] || f.severity}</span></td>
    <td class="mono">${esc(f.kind)}</td>
    <td>${esc(f.detail)}</td>
  </tr>`).join('');

const serverRows = w ? Object.entries(w.byServer).map(([k, v]) => {
  const used = u.mcpUsage[k];
  const usedTxt = k === '(builtin)' ? '—' : (used ? `${used}회` : '<b class="zero">0회</b>');
  return `<tr>
    <td class="mono">${esc(k)}</td>
    <td class="num">${v.tools}</td>
    <td class="num">${n(v.tokens)}</td>
    <td class="num">${n(v.perTool)}</td>
    <td class="num">${usedTxt}</td>
  </tr>`;
}).join('') : '';

const toolRows = Object.entries(u.byTool)
  .filter(([, v]) => v.calls >= 10)
  .sort((a, b) => (b[1].errors / b[1].calls) - (a[1].errors / a[1].calls))
  .slice(0, 12)
  .map(([name, v]) => {
    const r = v.errors / v.calls;
    const cls = r >= 0.2 ? 'zero' : r >= 0.1 ? 'warn' : '';
    return `<tr><td class="mono">${esc(name)}</td><td class="num">${n(v.calls)}</td><td class="num">${v.errors}</td><td class="num ${cls}">${pct(r)}</td></tr>`;
  }).join('');

const errCatRows = Object.entries(u.errorCats).sort((a, b) => b[1] - a[1]).slice(0, 10)
  .map(([c, v]) => `<tr><td class="mono">${esc(c)}</td><td class="num">${v}</td><td class="num">${pct(v / Math.max(u.toolErrors, 1))}</td></tr>`).join('');

const injRows = w ? w.injectedBlocks.map((b) =>
  `<tr><td>${esc(b.label)}</td><td class="num">${n(b.chars)}</td><td class="num">${n(b.tokens)}</td></tr>`).join('') : '';

const html = `<title>Claude Code 사용 감사 리포트</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root{--bg:#f6f6f4;--panel:#fff;--panel2:#ecebe7;--ink:#16160f;--soft:#4c4b41;--faint:#807e72;
--rule:#e0dfd8;--rule2:#c6c4ba;--accent:#3d6b52;--accent-soft:#3d6b5214;--bad:#b23b3b;--warn:#9a6212;--good:#1f7a3d;
--mono:'SF Mono',ui-monospace,'Cascadia Code',Menlo,Consolas,monospace;
--sans:-apple-system,BlinkMacSystemFont,'Segoe UI','Pretendard','Malgun Gothic',system-ui,sans-serif;
--serif:'Iowan Old Style','Palatino Linotype',Palatino,Georgia,serif;}
@media (prefers-color-scheme:dark){:root{--bg:#101210;--panel:#181a18;--panel2:#212421;--ink:#e8eae7;--soft:#aeb2ac;--faint:#7a7e78;
--rule:#262a26;--rule2:#353a35;--accent:#6fc496;--accent-soft:#6fc4961a;--bad:#ec7272;--warn:#e3ad57;--good:#57c97e;}}
:root[data-theme="light"]{--bg:#f6f6f4;--panel:#fff;--panel2:#ecebe7;--ink:#16160f;--soft:#4c4b41;--faint:#807e72;--rule:#e0dfd8;--rule2:#c6c4ba;--accent:#3d6b52;--accent-soft:#3d6b5214;--bad:#b23b3b;--warn:#9a6212;--good:#1f7a3d;}
:root[data-theme="dark"]{--bg:#101210;--panel:#181a18;--panel2:#212421;--ink:#e8eae7;--soft:#aeb2ac;--faint:#7a7e78;--rule:#262a26;--rule2:#353a35;--accent:#6fc496;--accent-soft:#6fc4961a;--bad:#ec7272;--warn:#e3ad57;--good:#57c97e;}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.6;font-size:15px}
.wrap{max-width:860px;margin:0 auto;padding:44px 22px 90px}
h1{font-family:var(--serif);font-size:clamp(26px,5vw,38px);margin:0 0 12px;font-weight:600;letter-spacing:-.015em}
.eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin:0 0 16px}
.meta{display:flex;flex-wrap:wrap;gap:6px 22px;font-family:var(--mono);font-size:12px;color:var(--faint);
border-top:1px solid var(--rule);border-bottom:1px solid var(--rule);padding:11px 0;margin:20px 0 34px}
.meta b{color:var(--ink)}
h2{font-family:var(--serif);font-size:22px;margin:44px 0 6px;font-weight:600;border-top:1px solid var(--rule);padding-top:20px}
p{margin:10px 0}.lead{color:var(--soft)}
code,.mono{font-family:var(--mono);font-size:.87em}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:11px;margin:22px 0}
.card{border:1px solid var(--rule);border-radius:11px;background:var(--panel);padding:14px 16px;border-top:3px solid var(--accent)}
.card .n{font-family:var(--mono);font-size:23px;font-weight:700;letter-spacing:-.02em}
.card .l{font-size:12.5px;color:var(--soft);margin-top:4px}
.card.bad{border-top-color:var(--bad)}.card.bad .n{color:var(--bad)}
.tw{overflow-x:auto;margin:16px 0;border:1px solid var(--rule);border-radius:10px}
table{border-collapse:collapse;width:100%;font-size:13.2px}
th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--rule);vertical-align:top}
thead th{background:var(--panel2);font-family:var(--mono);font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--soft);font-weight:600;white-space:nowrap}
tbody tr{background:var(--panel)}tbody tr:last-child td{border-bottom:none}
.num{font-family:var(--mono);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
.zero{color:var(--bad);font-weight:650}.warn{color:var(--warn);font-weight:640}
.pill{font-family:var(--mono);font-size:10.5px;font-weight:600;padding:2px 8px;border-radius:20px;white-space:nowrap}
.pill.high{color:var(--bad);background:color-mix(in srgb,var(--bad) 12%,transparent)}
.pill.medium{color:var(--warn);background:color-mix(in srgb,var(--warn) 12%,transparent)}
.pill.low{color:var(--soft);background:var(--panel2)}
.pill.info{color:var(--accent);background:var(--accent-soft)}
.plot{background:var(--panel);border:1px solid var(--rule);border-radius:11px;padding:16px;margin:18px 0}
.plot svg{display:block;width:100%;height:auto}
.plot .barA{fill:var(--accent);opacity:.85}.plot .barB{fill:var(--bad);opacity:.85}
.plot .lbl{fill:var(--faint);font-family:var(--mono);font-size:11px}
.plot .val{fill:var(--ink);font-family:var(--mono);font-size:11px;font-weight:600}
.plot .ax{stroke:var(--rule2);stroke-width:1}
.note{background:var(--accent-soft);border:1px solid var(--rule);border-left:3px solid var(--accent);border-radius:8px;padding:13px 16px;margin:18px 0;font-size:14px}
.foot{margin-top:50px;padding-top:18px;border-top:1px solid var(--rule2);font-size:12.5px;color:var(--faint)}
</style>
<div class="wrap">
<p class="eyebrow">usage-audit · 자동 생성 리포트</p>
<h1>Claude Code 사용 감사</h1>
<div class="meta">
  <span>생성 <b>${esc(j.startedAt.slice(0, 16).replace('T', ' '))}</b></span>
  <span>범위 <b>${esc(j.scope)}</b></span>
  <span>세션 <b>${n(u.sessions)}</b></span>
  <span>도구호출 <b>${n(u.toolCalls)}</b></span>
  <span>발견 <b>${j.analysis.findings.length}</b></span>
</div>

<div class="cards">
  ${w ? `<div class="card"><div class="n">${w.composition.toolsPct}%</div><div class="l">요청에서 도구 정의 비중 (${n(w.composition.toolsTokens)} tok)</div></div>` : ''}
  <div class="card ${u.errorRate > 0.05 ? 'bad' : ''}"><div class="n">${pct(u.errorRate)}</div><div class="l">도구 오류율 (${u.toolErrors}/${n(u.toolCalls)})</div></div>
  <div class="card ${j.analysis.driftRatio > 1.4 ? 'bad' : ''}"><div class="n">${j.analysis.driftRatio ? j.analysis.driftRatio.toFixed(1) + '×' : '—'}</div><div class="l">세션 후반 오류율 배수</div></div>
  <div class="card"><div class="n">${u.compactions}</div><div class="l">compaction 발생 (적을수록 좋음)</div></div>
</div>

<h2>발견 사항</h2>
<div class="tw"><table>
<thead><tr><th>심각도</th><th>유형</th><th>내용</th></tr></thead>
<tbody>${findingRows || '<tr><td colspan="3">발견 없음</td></tr>'}</tbody>
</table></div>

${w ? `
<h2>요청 구성 — 무엇이 매 요청에 실리는가</h2>
<p class="lead">와이어 프로브로 측정한 실제 요청 구성이다. 토큰은 보정 비율 ${j.charsPerToken} chars/token으로 환산했다.</p>
<div class="tw"><table>
<thead><tr><th>블록</th><th class="num">chars</th><th class="num">토큰</th><th class="num">비중</th></tr></thead>
<tbody>
<tr><td><b>tools</b> (도구 정의 ${w.toolCount}개)</td><td class="num">${n(w.composition.toolsChars)}</td><td class="num">${n(w.composition.toolsTokens)}</td><td class="num zero">${w.composition.toolsPct}%</td></tr>
<tr><td>system (시스템 프롬프트)</td><td class="num">${n(w.composition.systemChars)}</td><td class="num">${n(w.composition.systemTokens)}</td><td class="num">${w.composition.systemPct}%</td></tr>
<tr><td>messages (주입 ${n(w.composition.injectedTokens)} tok 포함)</td><td class="num">${n(w.composition.messagesChars)}</td><td class="num">${n(w.composition.messagesTokens)}</td><td class="num">${w.composition.messagesPct}%</td></tr>
</tbody></table></div>

<h2>서버별 도구 블록 — 개수가 아니라 바이트가 비용</h2>
<div class="tw"><table>
<thead><tr><th>서버</th><th class="num">도구</th><th class="num">토큰</th><th class="num">도구당</th><th class="num">실사용</th></tr></thead>
<tbody>${serverRows}</tbody>
</table></div>
${w.duplicates.count ? `<div class="note"><b>중복 등록 ${w.duplicates.count}건</b> — 같은 도구 이름이 두 서버에 올라와 있어 <b>${n(w.duplicates.tokens)} 토큰</b>이 매 요청 낭비된다. 예: ${w.duplicates.examples.slice(0, 3).map((e) => esc(e.leaf)).join(', ')}</div>` : ''}

<h2>주입 블록 — MCP 외 확장 표면</h2>
<div class="tw"><table>
<thead><tr><th>블록</th><th class="num">chars</th><th class="num">토큰</th></tr></thead>
<tbody>${injRows}</tbody>
</table></div>
` : `<div class="note">와이어 측정이 없습니다. <code>node probe.js</code>를 실행하면 요청 구성·서버별 바이트 지분이 이 리포트에 추가됩니다.</div>`}

<h2>세션이 길어질 때의 신뢰도</h2>
<p class="lead">세션을 4등분한 도구 오류율. 호출량으로 정규화했으므로 "후반에 일이 많아서"가 아니다.</p>
<div class="plot"><svg viewBox="0 0 620 210" role="img" aria-label="세션 사분면별 오류율">
<line class="ax" x1="80" y1="170" x2="600" y2="170"/>
<line class="ax" x1="80" y1="24" x2="80" y2="170"/>
${bars}
</svg></div>
<div class="tw"><table>
<thead><tr><th>사분면</th><th class="num">Q1</th><th class="num">Q2</th><th class="num">Q3</th><th class="num">Q4</th></tr></thead>
<tbody>
<tr><td>도구 호출</td>${u.callsByQuartile.map((x) => `<td class="num">${n(x)}</td>`).join('')}</tr>
<tr><td>오류</td>${u.errorsByQuartile.map((x) => `<td class="num">${x}</td>`).join('')}</tr>
<tr><td>미독(未讀) 편집 시도</td>${u.editBeforeReadByQuartile.map((x) => `<td class="num">${x}</td>`).join('')}</tr>
</tbody></table></div>

<h2>도구별 실패율 (호출 10회 이상)</h2>
<div class="tw"><table>
<thead><tr><th>도구</th><th class="num">호출</th><th class="num">오류</th><th class="num">실패율</th></tr></thead>
<tbody>${toolRows}</tbody>
</table></div>

<h2>오류 유형 분포</h2>
<div class="tw"><table>
<thead><tr><th>유형</th><th class="num">건수</th><th class="num">비중</th></tr></thead>
<tbody>${errCatRows}</tbody>
</table></div>

<h2>설정 표면</h2>
<div class="tw"><table>
<thead><tr><th>항목</th><th class="num">수</th><th>비고</th></tr></thead>
<tbody>
<tr><td>MCP 서버</td><td class="num">${cfg.mcpServers.length}</td><td class="mono">${esc(cfg.mcpServers.join(', '))}</td></tr>
<tr><td>스킬</td><td class="num">${cfg.skills.length}</td><td>설명 합계 ~${n(j.resident.skillListTokens)} tok (매 세션 상주)</td></tr>
<tr><td>서브에이전트</td><td class="num">${cfg.agents.length}</td><td>설명 합계 ~${n(j.resident.agentListTokens)} tok</td></tr>
<tr><td>훅</td><td class="num">${cfg.hooks.length}</td><td>${esc([...new Set(cfg.hooks.map((h) => h.event))].join(', '))}</td></tr>
<tr><td>활성 플러그인</td><td class="num">${cfg.plugins.filter((p) => p.enabled).length}</td><td class="mono">${esc(cfg.plugins.filter((p) => p.enabled).map((p) => p.name.split('@')[0]).join(', '))}</td></tr>
<tr><td>permission allow 규칙</td><td class="num">${cfg.permissionsAllow}</td><td>+ local ${cfg.localPermissionsAllow}</td></tr>
</tbody></table></div>

<div class="foot">
<p><strong>측정 방법.</strong> 설정은 <code>~/.claude.json</code>·<code>settings.json</code>에서, 사용 실적은 <code>~/.claude/projects</code>의 세션 JSONL에서 집계. 오류율은 같은 사분면의 <code>tool_use</code> 호출 수로 정규화. 토큰 환산은 실측 보정 비율 ${j.charsPerToken} chars/token.</p>
<p><strong>한계.</strong> "사용 0회"는 분석 범위 내 기록일 뿐 영구 불필요를 뜻하지 않는다. 와이어 측정은 <code>-p</code> 모드 1회 실행 기준이며, 대화형 세션은 지연 로딩(deferred tools) 때문에 도구 구성이 다를 수 있다. 이 리포트는 설정을 변경하지 않는다.</p>
</div>
</div>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
console.log('리포트 생성 →', OUT);
