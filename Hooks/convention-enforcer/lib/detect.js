// detect.js - map an edited file path to its convention layer.
// Layer definitions (pathGlobs) come from conventions/layers.json, so layers are
// data, not code. Returns the first matching layer name, or null.

// Convert a glob to a RegExp anchored at both ends.
//   '**/' -> zero or more leading path segments, so a file directly in the layer
//            dir ('api/controller/Foo.java') AND a nested one
//            ('api/controller/sub/Foo.java') both match.
//   '**'  -> anything, across segments (bare, no trailing slash).
//   '*'   -> anything within a single segment.
// A glob meant to match at any depth must start with '**/' (the layers.json
// convention); that leading '**/' absorbs drive letters and parent dirs
// (e.g. 'D:/proj/api/controller/Foo.java'). The start anchor prevents matching a
// layer name embedded in a longer segment (e.g. 'mycontroller/Foo.java').
function globToRegExp(glob) {
  let re = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++; // consume the second '*'
        if (glob[i + 1] === '/') {
          i++; // consume the '/'
          re += '(?:.*/)?'; // '**/' -> optional path segments (including zero)
        } else {
          re += '.*'; // bare '**'
        }
      } else {
        re += '[^/]*'; // single '*' stays within a segment
      }
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += '\\' + c; // escape regex specials, keep '/' and the handled '*'
    } else {
      re += c;
    }
  }
  return new RegExp(re + '$');
}

function detectLayer(filePath, layers) {
  if (!filePath) return null;
  const norm = filePath.replace(/\\/g, '/');

  // Skip hook/tool infrastructure - never lint our own config or .claude internals.
  if (norm.includes('/.claude/')) return null;

  for (const [layer, def] of Object.entries(layers || {})) {
    if (layer.startsWith('_')) continue; // _comment etc.
    const globs = (def && def.pathGlobs) || [];
    for (const g of globs) {
      try {
        if (globToRegExp(g).test(norm)) return layer;
      } catch {
        // bad glob - skip
      }
    }
  }
  return null;
}

module.exports = { detectLayer, globToRegExp };
