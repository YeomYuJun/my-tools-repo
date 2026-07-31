#!/usr/bin/env node
'use strict';

function summarizeDiff(numstat, maxFiles = 20) {
  const rows = String(numstat)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t');
      const added = parts[0];
      const removed = parts[1];
      const p = parts.slice(2).join('\t');
      return {
        path: p,
        added: added === '-' ? null : Number(added),
        removed: removed === '-' ? null : Number(removed),
      };
    })
    .filter((r) => r.path);
  const total = rows.reduce(
    (acc, r) => ({
      files: acc.files + 1,
      added: acc.added + (r.added || 0),
      removed: acc.removed + (r.removed || 0),
    }),
    { files: 0, added: 0, removed: 0 }
  );
  const sorted = [...rows].sort(
    (a, b) => (b.added || 0) + (b.removed || 0) - ((a.added || 0) + (a.removed || 0))
  );
  return { files: sorted.slice(0, maxFiles), total, truncated: rows.length > maxFiles };
}

function classifyCandidates(paths) {
  const buckets = { ledgers: [], stateFiles: [], handoffDocs: [], memory: [], recentMd: [] };
  for (const p of paths) {
    const base = p.split(/[\\/]/).pop() || '';
    const lower = base.toLowerCase();
    const norm = p.replace(/\\/g, '/');
    if (norm.includes('.state/') || lower === 'session-state.json') {
      buckets.stateFiles.push(p);
    } else if (/handoff/i.test(base)) {
      buckets.handoffDocs.push(p);
    } else if (/checklist|todo|progress|tasks?\b|\bplan\b/i.test(base)) {
      buckets.ledgers.push(p);
    } else if (base === 'MEMORY.md') {
      buckets.memory.push(p);
    } else if (lower.endsWith('.md')) {
      buckets.recentMd.push(p);
    }
  }
  return buckets;
}

function formatBundle(bundle, opts = {}) {
  if (opts.json) return JSON.stringify(bundle, null, 2);
  const L = [];
  L.push('# handoff discovery bundle');
  L.push(`cwd: ${bundle.cwd}`);
  L.push('');
  L.push('## git');
  if (!bundle.git.isRepo) {
    L.push('(not a git repository)');
  } else {
    L.push('### status');
    L.push(bundle.git.status.length ? bundle.git.status.join('\n') : '(no changes)');
    L.push('');
    L.push(`### diff summary (added/removed, top ${bundle.git.diff.files.length})`);
    for (const f of bundle.git.diff.files) {
      L.push(`  +${f.added ?? '-'} -${f.removed ?? '-'}  ${f.path}`);
    }
    if (bundle.git.diff.truncated) L.push('  … (more, truncated)');
    const t = bundle.git.diff.total;
    L.push(`  total: ${t.files} files +${t.added} -${t.removed}`);
  }
  L.push('');
  L.push('## candidate anchors');
  const a = bundle.anchors;
  L.push(`- ledger candidates: ${a.ledgers.join(', ') || '(none)'}`);
  L.push(`- handoff docs: ${a.handoffDocs.join(', ') || '(none)'}`);
  L.push(`- state files: ${a.stateFiles.join(', ') || '(none)'}`);
  L.push(`- memory: ${a.memory.join(', ') || '(none)'}`);
  L.push(`- recent .md: ${a.recentMd.slice(0, 10).join(', ') || '(none)'}`);
  L.push('');
  L.push('## MEMORY.md index');
  L.push(bundle.memoryIndex || '(none)');
  return L.join('\n');
}

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function collectGit(cwd) {
  const empty = { files: [], total: { files: 0, added: 0, removed: 0 }, truncated: false };
  try {
    git(['rev-parse', '--is-inside-work-tree'], cwd);
  } catch {
    return { isRepo: false, status: [], diff: empty };
  }
  let status = [];
  try {
    status = git(['status', '--porcelain'], cwd).split('\n').map((s) => s.trimEnd()).filter(Boolean);
  } catch {}
  let numstat = '';
  try {
    numstat = git(['diff', 'HEAD', '--numstat'], cwd);
  } catch {}
  return { isRepo: true, status, diff: summarizeDiff(numstat) };
}

function safeMtime(f) {
  try {
    return fs.statSync(f).mtimeMs;
  } catch {
    return 0;
  }
}

function walk(dir, maxDepth, depth, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (depth < maxDepth) walk(full, maxDepth, depth + 1, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

function collectAnchors(cwd) {
  const files = walk(cwd, 3, 0, []);
  const rel = files.map((f) => path.relative(cwd, f));
  const candidates = rel.filter(
    (p) => /\.(md|json)$/i.test(p) || p.replace(/\\/g, '/').includes('.state/')
  );
  const buckets = classifyCandidates(candidates);
  buckets.recentMd = buckets.recentMd
    .map((p) => ({ p, m: safeMtime(path.join(cwd, p)) }))
    .sort((a, b) => b.m - a.m)
    .map((x) => x.p);
  return buckets;
}

function readMemoryIndex(cwd) {
  try {
    return fs.readFileSync(path.join(cwd, 'MEMORY.md'), 'utf8').slice(0, 4000);
  } catch {
    return null;
  }
}

function buildBundle(cwd) {
  return {
    cwd,
    git: collectGit(cwd),
    anchors: collectAnchors(cwd),
    memoryIndex: readMemoryIndex(cwd),
  };
}

function main(argv) {
  const opts = { json: argv.includes('--json') };
  const bundle = buildBundle(process.cwd());
  process.stdout.write(formatBundle(bundle, opts) + '\n');
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { summarizeDiff, classifyCandidates, formatBundle };
