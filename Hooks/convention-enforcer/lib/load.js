// load.js - read the convention data files from conventions/.
//   layers.json   : layer -> { pathGlobs }            (stable, hand-edited)
//   enforced.json : layer -> [rule]   (promoted, can block)
//   draft.json    : layer -> [rule]   (generated, advisory only)

const fs = require('fs');
const path = require('path');

const CONV_DIR = path.join(__dirname, '..', 'conventions');

function readJson(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(CONV_DIR, name), 'utf8'));
  } catch {
    return {};
  }
}

function loadLayers() {
  return readJson('layers.json');
}

// Returns { enforced, draft } where each is { layer: [rule] }.
function loadRules() {
  return { enforced: readJson('enforced.json'), draft: readJson('draft.json') };
}

// Pull the rule array for a layer, ignoring meta keys and non-arrays.
function rulesForLayer(set, layer) {
  const v = set && set[layer];
  return Array.isArray(v) ? v : [];
}

module.exports = { loadLayers, loadRules, rulesForLayer, CONV_DIR };
