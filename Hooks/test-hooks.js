#!/usr/bin/env node
// test-hooks.js - deterministic inspection test for the state-injector and
// convention-enforcer hooks (+ their skills' contracts).
//
// Black-box: drives the hook scripts via child_process.spawnSync (stdin JSON ->
// exit code / stdout / stderr), avoiding shell quoting. Pure functions are unit
// tested via require(). The one end-to-end path through convention-enforcer's
// index.js backs up / seeds / restores the real rule files in a finally block.
//
//   node Hooks/test-hooks.js
//
// Exit 0 = all green, exit 1 = at least one failure.

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = __dirname.replace(/\\/g, '/');
const ENF = ROOT + '/convention-enforcer';
const SI = ROOT + '/state-injector';
const NODE = process.execPath;

const detect = require(ENF + '/lib/detect.js');
const engine = require(ENF + '/lib/engine.js');
const load = require(ENF + '/lib/load.js');
const store = require(SI + '/lib/store.js');
const layers = JSON.parse(fs.readFileSync(ENF + '/conventions/layers.json', 'utf8'));

let pass = 0;
const fails = [];
function ok(cond, name) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fails.push(name); console.log('  FAIL  ' + name); }
}
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  ok(a === e, a === e ? name : `${name}  [got ${a}, want ${e}]`);
}
function section(t) { console.log('\n=== ' + t + ' ==='); }
function mktmp(p) { return fs.mkdtempSync(path.join(os.tmpdir(), p)); }
function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch {} }

// ---------------------------------------------------------------------------
section('convention-enforcer / detectLayer (glob regression)');
eq(detect.detectLayer('proj/api/controller/UserController.java', layers), 'controller', 'direct controller file matches');
eq(detect.detectLayer('proj/api/controller/sub/Foo.java', layers), 'controller', 'nested controller file matches');
eq(detect.detectLayer('D:/proj/api/controller/Foo.java', layers), 'controller', 'absolute path with drive matches');
eq(detect.detectLayer('proj/service/FooService.java', layers), 'service', 'direct service file matches');
eq(detect.detectLayer('proj/domain/dto/FooDto.java', layers), 'dto', 'direct dto file matches');
eq(detect.detectLayer('proj/mapper/FooMapper.java', layers), 'mapper', 'direct mapper file matches');
eq(detect.detectLayer('proj/converter/FooConverter.java', layers), 'converter', 'direct converter file matches');
eq(detect.detectLayer('proj/domain/entity/Foo.java', layers), 'entity', 'direct entity file matches');
eq(detect.detectLayer('proj/src/main/resources/mapper/Foo.xml', layers), 'mapperXml', 'mapper xml matches');
eq(detect.detectLayer('proj/mycontroller/Foo.java', layers), null, 'embedded layer name does NOT match (left boundary)');
eq(detect.detectLayer('x/.claude/hooks/Foo.java', layers), null, '.claude path skipped');
eq(detect.detectLayer('proj/random/Foo.java', layers), null, 'unknown path -> null');
eq(detect.detectLayer('', layers), null, 'empty path -> null');

// ---------------------------------------------------------------------------
section('convention-enforcer / engine.runRule');
ok(engine.runRule('x ApiResponse.success y', { id: 'r', checker: 'regex', pattern: 'ApiResponse', mustMatch: true }) === null, 'mustMatch:true & present -> ok');
ok((engine.runRule('nothing', { id: 'r', checker: 'regex', pattern: 'ApiResponse', mustMatch: true }) || {}).ruleId === 'r', 'mustMatch:true & absent -> violation');
ok((engine.runRule('has setFoo()', { id: 'r2', checker: 'regex', pattern: 'set[A-Z]', mustMatch: false }) || {}).ruleId === 'r2', 'mustMatch:false & present -> violation');
ok(engine.runRule('no setters', { id: 'r2', checker: 'regex', pattern: 'set[A-Z]', mustMatch: false }) === null, 'mustMatch:false & absent -> ok');
ok(engine.runRule('x', { id: 'r3', checker: 'regex', pattern: '(', mustMatch: true }) === null, 'invalid regex -> null (no throw)');
ok(engine.runRule('x', { id: 'r4', checker: 'structural', pattern: 'x', mustMatch: true }) === null, 'non-regex checker -> not evaluated');

section('convention-enforcer / engine.runRules (enforced=block, draft=advisory)');
const split = engine.runRules('plain text',
  [{ id: 'e1', checker: 'regex', pattern: 'MUSTHAVE', mustMatch: true }],
  [{ id: 'd1', checker: 'regex', pattern: 'MUSTHAVE', mustMatch: true }]);
eq(split.blocking.map((b) => b.ruleId), ['e1'], 'enforced violation -> blocking');
eq(split.advisory.map((a) => a.ruleId), ['d1'], 'draft violation -> advisory');

section('convention-enforcer / load.rulesForLayer');
eq(load.rulesForLayer({ controller: [{ id: 'a' }] }, 'controller').length, 1, 'array returned for layer');
eq(load.rulesForLayer({ _comment: 'x' }, 'controller'), [], 'missing layer -> []');
eq(load.rulesForLayer({ controller: 'notarray' }, 'controller'), [], 'non-array -> []');

// ---------------------------------------------------------------------------
section('convention-enforcer / index.js end-to-end (seeded + restored)');
function runIndex(filePath, toolName) {
  return spawnSync(NODE, [ENF + '/index.js'], {
    input: JSON.stringify({ tool_name: toolName || 'Write', tool_input: { file_path: filePath } }),
    encoding: 'utf8',
  });
}
const enfPath = ENF + '/conventions/enforced.json';
const draftPath = ENF + '/conventions/draft.json';
const enfBak = fs.readFileSync(enfPath, 'utf8');
const draftBak = fs.readFileSync(draftPath, 'utf8');
const proj = mktmp('conv-e2e-');
try {
  const ctrlDir = path.join(proj, 'api', 'controller');
  fs.mkdirSync(ctrlDir, { recursive: true });
  const badFile = path.join(ctrlDir, 'FooController.java');
  fs.writeFileSync(badFile, 'public class FooController { String hi(){ return "x"; } }'); // no ApiResponse

  // silent paths (independent of rules)
  eq(runIndex(badFile, 'Read').status, 0, 'non-Edit/Write tool -> exit 0');
  eq(runIndex(path.join(proj, 'random', 'Foo.java'), 'Write').status, 0, 'out-of-layer file -> exit 0');

  // enforced violation -> blocking (exit 2 + stderr)
  fs.writeFileSync(enfPath, JSON.stringify({ controller: [
    { id: 'controller-apiresponse', checker: 'regex', pattern: 'ApiResponse', mustMatch: true, severity: 'block', message: 'Controller must use ApiResponse' },
  ] }));
  fs.writeFileSync(draftPath, JSON.stringify({}));
  let r = runIndex(badFile, 'Write');
  eq(r.status, 2, 'enforced violation -> exit 2 (block)');
  ok(/convention-enforcer/.test(r.stderr) && /controller-apiresponse/.test(r.stderr), 'block writes ruleId to stderr');

  // enforced satisfied -> no block
  const goodFile = path.join(ctrlDir, 'GoodController.java');
  fs.writeFileSync(goodFile, 'class GoodController { Object ok(){ return ApiResponse.success(); } }');
  eq(runIndex(goodFile, 'Write').status, 0, 'enforced satisfied -> exit 0');

  // draft violation -> advisory (exit 0 + stdout, NOT stderr)
  fs.writeFileSync(enfPath, JSON.stringify({}));
  fs.writeFileSync(draftPath, JSON.stringify({ controller: [
    { id: 'controller-draft', checker: 'regex', pattern: 'ApiResponse', mustMatch: true, severity: 'advisory', message: 'draft: prefer ApiResponse', confidence: 0.8, evidence: '9/10' },
  ] }));
  r = runIndex(badFile, 'Write');
  eq(r.status, 0, 'draft violation -> exit 0 (never blocks)');
  ok(/advisory/.test(r.stdout) && /controller-draft/.test(r.stdout), 'advisory written to stdout');
  ok(r.stderr.trim() === '', 'draft violation writes nothing to stderr');

  // KEYSTONE: draft rule mislabeled severity:"block" is STILL advisory only
  fs.writeFileSync(draftPath, JSON.stringify({ controller: [
    { id: 'controller-draft-mislabeled', checker: 'regex', pattern: 'ApiResponse', mustMatch: true, severity: 'block', message: 'draft mislabeled as block' },
  ] }));
  r = runIndex(badFile, 'Write');
  eq(r.status, 0, 'draft severity:"block" is ignored -> still exit 0 (safety contract)');
  ok(/advisory/.test(r.stdout), 'draft severity:"block" surfaces as advisory, never blocks');
} finally {
  fs.writeFileSync(enfPath, enfBak);
  fs.writeFileSync(draftPath, draftBak);
  rmrf(proj);
}

// ---------------------------------------------------------------------------
section('state-injector / store (standalone .state/, no co-dev)');
const sp = mktmp('state-store-');
try {
  ok(!fs.existsSync(path.join(sp, '.state')), 'no .state/ before first write');
  ok(!fs.existsSync(path.join(sp, 'co-dev')), 'no co-dev/ required');
  eq(store.read(sp).entries, [], 'fresh project reads empty');
  store.upsert(sp, 'focus', 'TASK-003 BE only');
  ok(fs.existsSync(store.statePath(sp)), '.state/session-state.json auto-created on write');
  ok(store.statePath(sp).replace(/\\/g, '/').endsWith('/.state/session-state.json'), 'path is <cwd>/.state/session-state.json');
  eq(store.read(sp).entries.map((e) => [e.key, e.value]), [['focus', 'TASK-003 BE only']], 'value persisted');
  store.upsert(sp, 'focus', 'changed');
  eq(store.read(sp).entries.length, 1, 'upsert same key dedups');
  eq(store.read(sp).entries[0].value, 'changed', 'upsert updates value');
  store.upsert(sp, 'constraint', 'no PUT/DELETE');
  const fc = store.fullContext(store.read(sp));
  ok(fc.startsWith('[session-state]'), 'fullContext has header');
  eq(fc.split('\n').length, 3, 'fullContext = header + 2 entries');
  store.remove(sp, 'focus');
  eq(store.read(sp).entries.map((e) => e.key), ['constraint'], 'remove(key) drops one');
  store.remove(sp, null);
  eq(store.read(sp).entries, [], 'remove(null) clears all');
  eq(store.fullContext({ entries: [] }), '', 'empty -> fullContext empty (hook stays silent)');
} finally { rmrf(sp); }

section('state-injector / store legacy co-dev read fallback (migration)');
const lp = mktmp('state-legacy-');
try {
  fs.mkdirSync(path.join(lp, 'co-dev'), { recursive: true });
  fs.writeFileSync(path.join(lp, 'co-dev', '.session-state.json'), JSON.stringify({ entries: [{ key: 'old', value: 'legacy', addedAt: 't' }] }));
  eq(store.read(lp).entries.map((e) => e.key), ['old'], 'reads legacy co-dev state when .state/ absent');
  store.upsert(lp, 'new', 'val');
  ok(fs.existsSync(store.statePath(lp)), 'write migrates forward to .state/');
  eq(store.read(lp).entries.map((e) => e.key).sort(), ['new', 'old'], 'migrated state preserves legacy + new');
} finally { rmrf(lp); }

// ---------------------------------------------------------------------------
section('state-injector / state.js CLI (spawnSync, cwd-based)');
function runCli(cwd, args) {
  return spawnSync(NODE, [SI + '/state.js', ...args], { cwd, encoding: 'utf8' });
}
const cp = mktmp('state-cli-');
try {
  let r = runCli(cp, ['set', 'focus', 'hello world']);
  eq(r.status, 0, 'set exits 0 without co-dev/');
  ok(/set focus = hello world/.test(r.stdout), 'set echoes value');
  ok(fs.existsSync(path.join(cp, '.state', 'session-state.json')), 'set created .state/');
  r = runCli(cp, ['show']);
  ok(/focus: hello world/.test(r.stdout), 'show lists entry');
  r = runCli(cp, ['clear', 'focus']);
  eq(r.status, 0, 'clear key exits 0');
  ok(/\(empty\)/.test(runCli(cp, ['show']).stdout), 'show empty after clear');
  eq(runCli(cp, ['set', 'onlykey']).status, 1, 'set without value -> exit 1');
  eq(runCli(cp, ['bogus']).status, 1, 'unknown command -> exit 1');
} finally { rmrf(cp); }

// ---------------------------------------------------------------------------
section('state-injector / inject.js hook (spawnSync, stdin payload)');
function runInject(payload) {
  return spawnSync(NODE, [SI + '/inject.js'], { input: JSON.stringify(payload), encoding: 'utf8' });
}
const ip = mktmp('state-inject-');
try {
  let r = runInject({ cwd: ip, hook_event_name: 'UserPromptSubmit' });
  eq(r.status, 0, 'no state -> exit 0');
  ok(r.stdout.trim() === '', 'no state -> silent (empty stdout)');

  store.upsert(ip, 'focus', 'TASK-003');
  store.upsert(ip, 'constraint', 'no PUT/DELETE');
  r = runInject({ cwd: ip, hook_event_name: 'UserPromptSubmit' });
  eq(r.status, 0, 'with state -> exit 0');
  const out = JSON.parse(r.stdout);
  eq(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit', 'echoes event name');
  const ctx = out.hookSpecificOutput.additionalContext;
  ok(ctx.includes('[session-state]'), 'additionalContext has header');
  ok(ctx.includes('focus: TASK-003'), 'additionalContext has focus');
  ok(ctx.includes('constraint: no PUT/DELETE'), 'additionalContext has constraint');

  eq(JSON.parse(runInject({ cwd: ip }).stdout).hookSpecificOutput.hookEventName, 'SessionStart', 'defaults event to SessionStart');
  eq(JSON.parse(runInject({ cwd: ip, hookEventName: 'SessionStart' }).stdout).hookSpecificOutput.hookEventName, 'SessionStart', 'accepts camelCase hookEventName');
} finally { rmrf(ip); }

// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(48));
console.log(`TOTAL: ${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log('FAILURES:');
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
console.log('ALL GREEN');
