#!/usr/bin/env node
// disarm.js - turn the recursive-eval loop OFF for the project in the current dir.
// Removes the lock file (and any stale running-marker). Run from the project root.

const fs = require('fs');
const sentinel = require('./lib/sentinel');

const cwd = process.cwd();

try {
  fs.unlinkSync(sentinel.lockPath(cwd));
  console.log('[recursive-eval] DISARMED (lock removed)');
} catch {
  console.log('[recursive-eval] already disarmed (no lock file)');
}

sentinel.clearMarker(cwd);
