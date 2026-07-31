#!/usr/bin/env node
// state.js - control surface for session state. Run from the project root.
// State is stored under <cwd>/.state/session-state.json (auto-created; no co-dev/ needed).
//   node <path>/state.js set <key> <value...>
//   node <path>/state.js show
//   node <path>/state.js clear [key]

const store = require('./lib/store');

const cwd = process.cwd();
const [cmd, key, ...rest] = process.argv.slice(2);
const value = rest.join(' ');

if (cmd === 'set') {
  if (!key || !value) {
    console.error('usage: state.js set <key> <value...>');
    process.exit(1);
  }
  store.upsert(cwd, key, value);
  console.log(`[state] set ${key} = ${value}`);
} else if (cmd === 'show') {
  const s = store.read(cwd);
  if (!s.entries.length) {
    console.log('[state] (empty)');
  } else {
    for (const e of s.entries) console.log(`  ${e.key}: ${e.value}`);
  }
} else if (cmd === 'clear') {
  store.remove(cwd, key || null);
  console.log(key ? `[state] cleared ${key}` : '[state] cleared all');
} else {
  console.error('usage: state.js set|show|clear');
  process.exit(1);
}
