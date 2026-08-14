'use strict';

const fs = require('node:fs');

/** 사용자 발화에 하네스가 덧붙이는 래퍼. 검색 대상도 표시 대상도 아니다. */
const NOISE_TAGS = [
  'system-reminder',
  'ide_opened_file',
  'ide_selection',
  'local-command-stdout',
];

const NOISE_RE = new RegExp(
  `<(${NOISE_TAGS.join('|')})>[\\s\\S]*?</\\1>`,
  'g'
);

function stripNoise(text) {
  return text.replace(NOISE_RE, ' ').replace(/[ \t]+/g, ' ').trim();
}

/**
 * 내장 검색의 wgE() 와 같은 규칙으로 발화 텍스트를 뽑는다.
 * content 가 문자열이면 그대로, 배열이면 .text 를 가진 블록만.
 * tool_result 블록은 .content 를 쓰므로 여기서 자연히 빠진다.
 */
function extractText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (typeof block === 'string') parts.push(block);
    else if (block && typeof block.text === 'string') parts.push(block.text);
  }
  return parts.join(' ');
}

function describeTool(name, input) {
  if (!input || typeof input !== 'object') return '';
  const pick = (...keys) => {
    for (const k of keys) {
      if (typeof input[k] === 'string' && input[k].trim()) return input[k].trim();
    }
    return null;
  };
  const byName =
    pick('description') ||
    pick('file_path', 'path') ||
    pick('pattern', 'query') ||
    pick('command') ||
    pick('prompt', 'url');
  if (byName) return byName;

  for (const value of Object.values(input)) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function resultToText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((b) => (typeof b === 'string' ? b : typeof b?.text === 'string' ? b.text : ''))
    .filter(Boolean)
    .join('\n');
}

/**
 * 트랜스크립트 한 파일을 정규화된 발화 배열로 만든다.
 * 발화 = user/assistant 레코드 중 텍스트가 남는 것. tool_result 전용 user 레코드,
 * attachment, queue-operation, isMeta 는 발화가 아니다.
 */
function parseTranscript(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    return { messages: [], skipped: 0, error: err.message };
  }

  const lines = raw.split('\n');
  const messages = [];
  const pendingTools = new Map();
  let skipped = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }

    if (rec.type !== 'user' && rec.type !== 'assistant') continue;

    const content = rec.message?.content;

    if (Array.isArray(content)) {
      for (const block of content) {
        if (block?.type === 'tool_result' && block.tool_use_id) {
          pendingTools.set(block.tool_use_id, resultToText(block.content));
        }
      }
    }

    if (rec.isMeta === true) continue;

    const text = stripNoise(extractText(content));
    const tools = [];

    if (Array.isArray(content)) {
      for (const block of content) {
        if (block?.type === 'tool_use') {
          tools.push({
            id: block.id,
            name: block.name || '?',
            desc: describeTool(block.name, block.input),
          });
        }
      }
    }

    if (!text && tools.length === 0) continue;

    messages.push({
      line: i + 1,
      uuid: typeof rec.uuid === 'string' ? rec.uuid : '',
      role: rec.type,
      ts: rec.timestamp || null,
      text,
      tools,
    });
  }

  for (const msg of messages) {
    for (const tool of msg.tools) {
      const result = pendingTools.get(tool.id);
      tool.resultText = result ?? null;
      tool.resultLines = result ? result.split('\n').length : null;
    }
  }

  return { messages, skipped, error: null };
}

/**
 * 1패스. JSON 파싱 없이 원문 문자열만 보고 후보 파일을 거른다.
 * 한글은 대소문자가 없어 대개 정확일치에서 끝나고, 실패할 때만 소문자 비교로 넘어간다.
 */
function fileMayContain(file, needle) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return false;
  }
  if (raw.includes(needle)) return true;
  return raw.toLowerCase().includes(needle.toLowerCase());
}

function matchesQuery(text, needleLower) {
  return text.toLowerCase().includes(needleLower);
}

module.exports = {
  stripNoise,
  extractText,
  describeTool,
  parseTranscript,
  fileMayContain,
  matchesQuery,
};
