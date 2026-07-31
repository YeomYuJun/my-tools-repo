#!/usr/bin/env node
// inject.js - SessionStart + UserPromptSubmit hook entry for state-injector.
//
// Reads the project's session state and emits it as additionalContext so the
// state is present at session start (and on resume) and re-asserted each turn
// (so it survives context compaction) - "system prompt"-like persistence that a
// Skill alone cannot provide.
//
// State is kept small by design, so the full block is injected every turn. For
// large state, switch to store.digest() + the lastInjectedHash gate (see README).

const fs = require('fs');
const store = require('./lib/store');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function emit(eventName, context) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: eventName, additionalContext: context },
    })
  );
}

function main() {
  const raw = readStdin();
  let payload = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    // no payload - nothing to key on
  }

  const cwd = payload.cwd || process.cwd();
  // Input field name is unverified across versions - accept snake or camel case.
  const eventName = payload.hook_event_name || payload.hookEventName || 'SessionStart';

  const state = store.read(cwd);
  const context = store.fullContext(state);
  if (!context) process.exit(0); // no state -> stay silent

  emit(eventName, context);
  process.exit(0);
}

main();
