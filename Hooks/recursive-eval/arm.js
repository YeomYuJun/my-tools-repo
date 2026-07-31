#!/usr/bin/env node
// arm.js - turn the recursive-eval loop ON for the project in the current dir.
// Run from the project root (the dir that contains co-dev/TASK.md):
//   node <path>/arm.js <TASK-ID|all> [--model sonnet|opus|haiku] [--max N]

const fs = require('fs');
const path = require('path');
const sentinel = require('./lib/sentinel');

const cwd = process.cwd();
const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const targetTask = positional[0] && positional[0] !== 'all' ? positional[0] : null;

function flag(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}

const codevDir = path.join(cwd, 'co-dev');
if (!fs.existsSync(codevDir)) {
  console.error(
    `[recursive-eval] no co-dev/ under ${cwd}. Run from the project root that has co-dev/TASK.md.`
  );
  process.exit(1);
}

const model = flag('model', 'sonnet');
const maxIter = parseInt(flag('max', '10'), 10);

sentinel.write(cwd, {
  armed: true,
  targetTask,
  model,
  maxIter,
  iteration: 0,
  armedAt: new Date().toISOString(),
});
sentinel.clearMarker(cwd);

console.log(
  `[recursive-eval] ARMED target=${targetTask || 'TASK.md order'} model=${model} maxIter=${maxIter}`
);
console.log(`  lock: ${sentinel.lockPath(cwd)}`);
