/**
 * extract.js — Edit/Write tool input에서 "추가된 주석 라인" 추출.
 *
 * Edit: new_string을 검사 (변경 영역).
 * Write: content 전체를 검사 (신규 파일).
 *
 * 추출 대상:
 *   - 단일 라인 // ...
 *   - 블록 /* ... *\/  (단일·복수 라인)
 *   - Vue 파일의 HTML 주석 <!-- ... -->  (단일 라인 한정, 1차)
 *
 * 결과: [{ line, snippet, kind }]
 *   line: tool input 내 상대 라인 번호 (Edit는 new_string 기준)
 *   snippet: trim된 주석 텍스트 (최대 200자)
 *   kind: 'line' | 'block' | 'html'
 */

function extractAddedComments(toolName, toolInput, language) {
  let text = '';
  if (toolName === 'Write') text = toolInput.content || '';
  else if (toolName === 'Edit') text = toolInput.new_string || '';
  else return [];

  if (!text) return [];
  return extractFromText(text, language);
}

function extractFromText(text, language) {
  const lines = text.split(/\r?\n/);
  const results = [];

  let inBlock = false;
  let blockBuf = [];
  let blockStartLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    if (inBlock) {
      const endIdx = line.indexOf('*/');
      if (endIdx >= 0) {
        blockBuf.push(line.slice(0, endIdx + 2));
        results.push({ line: blockStartLine, snippet: clamp(blockBuf.join(' ').trim()), kind: 'block' });
        inBlock = false;
        blockBuf = [];
      } else {
        blockBuf.push(line);
      }
      continue;
    }

    let cursor = 0;
    while (cursor < line.length) {
      const next = scanNext(line, cursor);
      if (!next) break;

      if (next.kind === 'line') {
        const snippet = line.slice(next.start).trim();
        results.push({ line: lineNo, snippet: clamp(snippet), kind: 'line' });
        break;
      }

      if (next.kind === 'block') {
        const rest = line.slice(next.start);
        const endIdx = rest.indexOf('*/', 2);
        if (endIdx >= 0) {
          const full = rest.slice(0, endIdx + 2);
          results.push({ line: lineNo, snippet: clamp(full.trim()), kind: 'block' });
          cursor = next.start + endIdx + 2;
        } else {
          inBlock = true;
          blockBuf = [rest];
          blockStartLine = lineNo;
          break;
        }
        continue;
      }

      if (next.kind === 'html' && language === 'vue') {
        const rest = line.slice(next.start);
        const endIdx = rest.indexOf('-->', 4);
        if (endIdx >= 0) {
          results.push({ line: lineNo, snippet: clamp(rest.slice(0, endIdx + 3).trim()), kind: 'html' });
          cursor = next.start + endIdx + 3;
        } else {
          break;
        }
        continue;
      }

      cursor = next.start + 2;
    }
  }

  return results;
}

function scanNext(line, from) {
  let inStr = null;
  for (let i = from; i < line.length; i++) {
    const c = line[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '/' && line[i + 1] === '/') return { kind: 'line', start: i };
    if (c === '/' && line[i + 1] === '*') return { kind: 'block', start: i };
    if (c === '<' && line.startsWith('<!--', i)) return { kind: 'html', start: i };
  }
  return null;
}

function clamp(s) {
  if (!s) return '';
  return s.length > 200 ? s.slice(0, 200) : s;
}

module.exports = { extractAddedComments };
