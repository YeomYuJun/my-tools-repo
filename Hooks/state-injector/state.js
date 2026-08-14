#!/usr/bin/env node
// state.js - control surface for session state. Run from the project root.
// State is stored under <cwd>/.state/session-state.json (auto-created; no co-dev/ needed).
//   node <path>/state.js set <key> <value...>
//   node <path>/state.js show
//   node <path>/state.js clear [key]
//
// Every mutation reprints the whole state: a lone "set" line only echoes what
// was just typed, while the full list shows what is actually steering the
// session - which is the part that goes stale unnoticed.

const store = require('./lib/store');

const cwd = process.cwd();
const [cmd, key, ...rest] = process.argv.slice(2);
const value = rest.join(' ');

// Same renderer the SessionStart hook uses, so both views can never drift apart.
function printAll() {
  console.log(store.userSummary(store.read(cwd)) || '[state] (empty)');
}

if (cmd === 'set') {
  if (!key || !value) {
    console.error('usage: state.js set <key> <value...>');
    process.exit(1);
  }
  store.upsert(cwd, key, value);
  console.log(`[state] set ${key}`);
  printAll();
} else if (cmd === 'show') {
  printAll();
} else if (cmd === 'clear') {
  store.remove(cwd, key || null);
  console.log(key ? `[state] cleared ${key}` : '[state] cleared all');
  printAll();
} else {
  console.error('usage: state.js set|show|clear');
  process.exit(1);
}
