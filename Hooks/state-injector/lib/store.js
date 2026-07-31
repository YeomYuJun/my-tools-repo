// store.js - read/write the user-controlled session state.
//
// Data lives under the target project (cwd), not next to this code, so the hook
// is reusable across projects AND `state` works standalone - no co-dev/ required.
// The store auto-creates its own directory:
//
//   <cwd>/.state/session-state.json
//
// For backward compatibility it still READS the legacy co-dev location when the
// new file is absent (older projects seeded under co-dev/). Writes always go to
// .state/, so the first write migrates a project forward.
//
// Project-scoped (one file per project) survives session resume regardless of
// whether session_id is stable. (Per-session keying by session_id is possible
// only if a spike confirms the id is stable across resume - see README.)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STATE_DIR = '.state';

function statePath(cwd) {
  return path.join(cwd, STATE_DIR, 'session-state.json');
}

// Legacy location from the co-dev-coupled era. Read-only fallback for migration.
function legacyStatePath(cwd) {
  return path.join(cwd, 'co-dev', '.session-state.json');
}

function readFrom(p) {
  const s = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!Array.isArray(s.entries)) s.entries = [];
  return s;
}

function read(cwd) {
  try {
    return readFrom(statePath(cwd));
  } catch {
    try {
      return readFrom(legacyStatePath(cwd)); // migrate-forward on next write
    } catch {
      return { entries: [] };
    }
  }
}

function write(cwd, obj) {
  const p = statePath(cwd);
  fs.mkdirSync(path.dirname(p), { recursive: true }); // auto-create .state/
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

function upsert(cwd, key, value) {
  const s = read(cwd);
  const now = new Date().toISOString();
  const e = s.entries.find((x) => x.key === key);
  if (e) {
    e.value = value;
    e.addedAt = now;
  } else {
    s.entries.push({ key, value, addedAt: now });
  }
  s.updatedAt = now;
  write(cwd, s);
  return s;
}

function remove(cwd, key) {
  const s = read(cwd);
  s.entries = key ? s.entries.filter((x) => x.key !== key) : [];
  s.updatedAt = new Date().toISOString();
  write(cwd, s);
  return s;
}

// Full block for SessionStart (and per-turn injection while state is small).
function fullContext(state) {
  const items = (state.entries || []).map((e) => `- ${e.key}: ${e.value}`).join('\n');
  return items ? `[session-state]\n${items}` : '';
}

// Compact one-liner for the optional digest mode (large state).
function digest(state) {
  const keys = (state.entries || []).map((e) => e.key).join(', ');
  return keys ? `[session-state] active: ${keys}` : '';
}

function hashOf(str) {
  return crypto.createHash('sha1').update(str || '').digest('hex').slice(0, 12);
}

function markInjected(cwd, hash) {
  const s = read(cwd);
  s.lastInjectedHash = hash;
  write(cwd, s);
}

module.exports = {
  statePath,
  legacyStatePath,
  read,
  write,
  upsert,
  remove,
  fullContext,
  digest,
  hashOf,
  markInjected,
};
