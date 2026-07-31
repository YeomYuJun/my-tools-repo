/**
 * detect.js — 파일 경로로부터 서비스 ID와 언어를 결정.
 * 매핑은 config/services.json 에서 읽어 캐시.
 */

const fs = require('fs');
const path = require('path');

const CFG_PATH = path.join(__dirname, '..', 'config', 'services.json');

let cache = null;
function loadConfig() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
  } catch {
    cache = { services: [], extensionToLanguage: {}, applyWithoutService: false };
  }
  return cache;
}

function detectContext(filePath) {
  if (!filePath) return null;
  const normalized = filePath.replace(/\\/g, '/');

  // .claude/ 내부는 hook 인프라 자체이므로 검사 제외.
  // (룰 파일의 메타 주석이 자기 룰에 걸리는 self-block 회피)
  if (normalized.includes('/.claude/')) return null;

  const cfg = loadConfig();

  const ext = path.extname(normalized).toLowerCase();
  const extLang = cfg.extensionToLanguage ? cfg.extensionToLanguage[ext] : null;

  for (const svc of cfg.services || []) {
    if (!svc.prefix) continue;
    if (normalized.includes(svc.prefix)) {
      const language = extLang || svc.defaultLanguage || null;
      if (!language) return null;
      return { service: svc.id, language, filePath: normalized };
    }
  }

  if (cfg.applyWithoutService && extLang) {
    return { service: 'unknown', language: extLang, filePath: normalized };
  }

  return null;
}

module.exports = { detectContext };
