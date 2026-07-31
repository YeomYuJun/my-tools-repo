// sentinel.js - read/write the recursive-eval lock and running-marker files.
//
// Data lives under the TARGET project, not next to this code (this hook is a
// generic tool that operates on whatever project the session runs in). So all
// paths derive from a caller-supplied project root (cwd), never from __dirname.
//
// Lock file:    <cwd>/co-dev/.recursive-eval.lock     - armed state + knobs + counter
// Running mark: <cwd>/co-dev/.recursive-eval.running   - re-entrancy guard while the
//                                                        evaluator subprocess is alive
//
// "armed" gate is OFF when the lock is missing OR armed:false, so deleting the
// lock from another terminal is a hard stop (escape hatch).

const fs = require('fs');
const path = require('path');

function lockPath(cwd) {
  return path.join(cwd, 'co-dev', '.recursive-eval.lock');
}

function markerPath(cwd) {
  return path.join(cwd, 'co-dev', '.recursive-eval.running');
}

function read(cwd) {
  try {
    return JSON.parse(fs.readFileSync(lockPath(cwd), 'utf8'));
  } catch {
    return null;
  }
}

function write(cwd, obj) {
  fs.writeFileSync(lockPath(cwd), JSON.stringify(obj, null, 2));
}

function isArmed(cwd) {
  const s = read(cwd);
  return !!(s && s.armed === true);
}

function increment(cwd) {
  const s = read(cwd);
  if (!s) return 0;
  s.iteration = (s.iteration || 0) + 1;
  write(cwd, s);
  return s.iteration;
}

function disarm(cwd) {
  const s = read(cwd);
  if (!s) return;
  s.armed = false;
  write(cwd, s);
}

// Re-entrancy marker. Present only while a parent hook is blocked waiting on the
// evaluator subprocess. spawnSync is synchronous, so the marker is guaranteed to
// exist for the whole window in which the child could fire its own Stop hook.
function markerExists(cwd) {
  return fs.existsSync(markerPath(cwd));
}

function setMarker(cwd) {
  fs.writeFileSync(markerPath(cwd), String(Date.now()));
}

function clearMarker(cwd) {
  try {
    fs.unlinkSync(markerPath(cwd));
  } catch {
    // already gone - fine
  }
}

module.exports = {
  lockPath,
  markerPath,
  read,
  write,
  isArmed,
  increment,
  disarm,
  markerExists,
  setMarker,
  clearMarker,
};
