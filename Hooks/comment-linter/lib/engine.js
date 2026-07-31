/**
 * engine.js — 룰 합성 및 실행.
 *
 * 룰 계층 (적용 순서):
 *   1. 프로젝트 공통 하드룰   (rules/common.js)
 *   2. 언어별 룰              (rules/lang/{language}.js)
 *   3. 서비스별 정적 룰        (rules/service/{service}.js)
 *   4. 사용자 정의 정규식 룰   (config/user-rules.json)
 *
 * 룰 인터페이스:
 *   { id: string, severity: 'block' | 'advisory', check(snippet, ctx) => violation | null }
 *
 * violation 구조:
 *   { ruleId, severity, message }
 */

const fs = require('fs');
const path = require('path');

const commonRules = require('../rules/common');
const langJava = require('../rules/lang/java');
const langVue  = require('../rules/lang/vue');
const langJs   = require('../rules/lang/js');

const LANG_RULES = { java: langJava, vue: langVue, js: langJs };

const SERVICE_RULES_DIR = path.join(__dirname, '..', 'rules', 'service');
const USER_RULES_PATH   = path.join(__dirname, '..', 'config', 'user-rules.json');

function loadServiceRules(serviceId) {
  if (!serviceId || serviceId === 'unknown') return [];
  const file = path.join(SERVICE_RULES_DIR, `${serviceId}.js`);
  if (!fs.existsSync(file)) return [];
  try {
    const mod = require(file);
    return Array.isArray(mod) ? mod : [];
  } catch {
    return [];
  }
}

function loadUserRules(ctx) {
  if (!fs.existsSync(USER_RULES_PATH)) return [];
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(USER_RULES_PATH, 'utf8'));
  } catch {
    return [];
  }
  const defs = Array.isArray(cfg.rules) ? cfg.rules : [];
  return defs
    .filter(d => d && d.id && d.pattern)
    .filter(d => matchesScope(d.appliesTo, ctx))
    .map(toRegexRule)
    .filter(Boolean);
}

function matchesScope(appliesTo, ctx) {
  if (!appliesTo) return true;
  const ok = (list, value) =>
    !list || !Array.isArray(list) || list.length === 0 ||
    list.includes('*') || list.includes(value);
  return ok(appliesTo.services, ctx.service) && ok(appliesTo.languages, ctx.language);
}

function toRegexRule(def) {
  let re;
  try {
    re = new RegExp(def.pattern, def.flags || '');
  } catch {
    return null;
  }
  const severity = def.severity === 'advisory' ? 'advisory' : 'block';
  return {
    id: def.id,
    severity,
    check(snippet) {
      return re.test(snippet)
        ? { ruleId: def.id, severity, message: def.message || `Rule ${def.id} matched.` }
        : null;
    },
  };
}

function runRules(comments, ctx) {
  const rules = [
    ...commonRules,
    ...(LANG_RULES[ctx.language] || []),
    ...loadServiceRules(ctx.service),
    ...loadUserRules(ctx),
  ];

  const blocking = [];
  const advisory = [];

  for (const c of comments) {
    for (const r of rules) {
      let v;
      try { v = r.check(c.snippet, ctx); }
      catch { continue; }
      if (!v) continue;
      const record = { line: c.line, snippet: c.snippet, ...v };
      if (v.severity === 'block') blocking.push(record);
      else advisory.push(record);
    }
  }

  return { blocking, advisory };
}

module.exports = { runRules };
