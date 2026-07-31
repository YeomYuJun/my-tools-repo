'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { summarizeDiff, classifyCandidates, formatBundle } = require('./handoff.js');

const SAMPLE = {
  cwd: '/x',
  git: {
    isRepo: false,
    status: [],
    diff: { files: [], total: { files: 0, added: 0, removed: 0 }, truncated: false },
  },
  anchors: { ledgers: ['c.md'], stateFiles: [], handoffDocs: [], memory: [], recentMd: [] },
  memoryIndex: null,
};

test('summarizeDiff: numstat 파싱과 합계', () => {
  const r = summarizeDiff('10\t2\tsrc/a.js\n5\t5\tsrc/b.js');
  assert.equal(r.total.files, 2);
  assert.equal(r.total.added, 15);
  assert.equal(r.total.removed, 7);
  assert.equal(r.truncated, false);
});

test('summarizeDiff: maxFiles 상한과 truncated', () => {
  const input = Array.from({ length: 5 }, (_, i) => `${i}\t0\tf${i}.js`).join('\n');
  const r = summarizeDiff(input, 3);
  assert.equal(r.files.length, 3);
  assert.equal(r.truncated, true);
  assert.equal(r.files[0].path, 'f4.js'); // added+removed 내림차순
});

test('summarizeDiff: 바이너리(-) 처리', () => {
  const r = summarizeDiff('-\t-\timg.png');
  assert.equal(r.files[0].added, null);
  assert.equal(r.files[0].removed, null);
  assert.equal(r.total.added, 0);
});

test('classifyCandidates: 패턴별 버킷', () => {
  const b = classifyCandidates([
    'checker-fix-checklist-v2.md',
    'checker-fix-handoff.md',
    '.state/session-state.json',
    'MEMORY.md',
    'notes.md',
  ]);
  assert.deepEqual(b.ledgers, ['checker-fix-checklist-v2.md']);
  assert.deepEqual(b.handoffDocs, ['checker-fix-handoff.md']);
  assert.deepEqual(b.stateFiles, ['.state/session-state.json']);
  assert.deepEqual(b.memory, ['MEMORY.md']);
  assert.deepEqual(b.recentMd, ['notes.md']);
});

test('classifyCandidates: 윈도우 역슬래시 .state 경로', () => {
  const b = classifyCandidates(['.state\\session-state.json']);
  assert.equal(b.stateFiles.length, 1);
});

test('classifyCandidates: plan 이름은 원장 후보, design은 아님', () => {
  const b = classifyCandidates(['PLAN.md', 'DESIGN.md', 'explanation.md']);
  assert.deepEqual(b.ledgers, ['PLAN.md']);
  assert.deepEqual(b.recentMd, ['DESIGN.md', 'explanation.md']);
});

test('formatBundle: 비-git 및 섹션 렌더', () => {
  const out = formatBundle(SAMPLE);
  assert.match(out, /not a git repository/);
  assert.match(out, /ledger candidates: c\.md/);
});

test('formatBundle: json 모드', () => {
  const out = formatBundle(SAMPLE, { json: true });
  assert.equal(JSON.parse(out).cwd, '/x');
});
