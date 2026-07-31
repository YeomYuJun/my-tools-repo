// engine.js - run convention rules against an edited file's content.
//
// Rule shape:
//   { id, checker: 'regex'|'structural'|'semantic', pattern, flags, mustMatch, message }
//
// Only 'regex' rules are evaluated here (cheap, deterministic). mustMatch:true means
// the pattern SHOULD be present (absence = violation); mustMatch:false means the
// pattern should NOT be present (presence = violation). 'structural'/'semantic'
// rules cannot be judged cheaply, so they are never blocking - the caller surfaces
// them as advisory for a human or companion agent.

function runRule(content, rule) {
  if (!rule || !rule.id) return null;
  if (rule.checker !== 'regex' || !rule.pattern) return null;

  let re;
  try {
    re = new RegExp(rule.pattern, rule.flags || 'm');
  } catch {
    return null; // bad pattern - do not block on it
  }

  const found = re.test(content);
  const violated = rule.mustMatch ? !found : found;
  if (!violated) return null;

  return { ruleId: rule.id, message: rule.message || `convention rule ${rule.id}` };
}

// enforcedRules -> blocking, draftRules -> advisory (draft never blocks).
function runRules(content, enforcedRules, draftRules) {
  const blocking = [];
  const advisory = [];

  for (const r of enforcedRules || []) {
    const v = runRule(content, r);
    if (v) blocking.push(v);
  }
  for (const r of draftRules || []) {
    const v = runRule(content, r);
    if (v) advisory.push(v);
  }

  return { blocking, advisory };
}

module.exports = { runRule, runRules };
