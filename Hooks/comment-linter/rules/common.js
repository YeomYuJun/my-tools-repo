/**
 * common.js — 프로젝트 공통 하드룰 (서비스/언어 무관).
 *
 * 룰 인터페이스:
 *   { id, severity: 'block' | 'advisory', check(snippet, ctx) => violation | null }
 *
 * 그룹:
 *   A. 컨텍스트 누설  — 티켓/세션/요청자 멘션
 *   B. 빈 마커        — 내용 없는 TODO/FIXME
 *   C. 타이포그래피   — 이모지, em-dash, smart quotes 등
 */

const RULES = [
  // === A. Context Leak ===
  {
    id: 'no-ticket-mention',
    severity: 'block',
    pattern: /\b(?:TASK|JIRA|ISSUE|PR|CR|SFR|BUG)-?\d+\b|(?:^|[^\w#])#\d{2,}\b/i,
    message: '주석에 티켓/이슈 번호 멘션 금지. 변경 사유는 커밋 메시지에.',
  },
  {
    id: 'no-session-leak',
    severity: 'block',
    pattern: /(어제|방금|아까|이전\s*세션|이전\s*대화|위에서\s*본|위에\s*있는|이전에\s*(?:논의|결정|얘기|말한)|논의(?:한|된)\s*대로|결정(?:한|된)\s*대로)/,
    message: '주석에 세션/대화 흐름 누설 금지 (어제/방금/이전 세션 등).',
  },
  {
    id: 'no-requester-mention',
    severity: 'block',
    pattern: /(사용자(?:가|는|께서)\s*(?:요청|시킨|원하는|원했|말한|요구)|요청자(?:가|는)|담당자가\s*요청)/,
    message: '주석에 요청자/사용자 멘션 금지.',
  },

  // === B. Empty Markers ===
  {
    id: 'todo-empty',
    severity: 'block',
    pattern: /\b(?:TODO|FIXME|XXX|HACK)\b\s*:?\s*$/i,
    message: 'TODO/FIXME에 내용 필수. 예: TODO(owner): 설명',
  },

  // === C. Typographic Style ===
  // LLM이 자주 삽입하는 typographic 문자 차단. 코드/주석에선 ASCII 등가물 사용.
  {
    id: 'no-emoji',
    severity: 'block',
    pattern: /\p{Extended_Pictographic}/u,
    message: '주석에 이모지 사용 금지.',
  },
  {
    id: 'no-em-dash',
    severity: 'block',
    // U+2010(hyphen) ~ U+2015(horizontal bar): em-dash, en-dash, figure dash 등.
    pattern: /[‐-―]/,
    message: 'typographic dash 금지 (em-dash, en-dash 등). ASCII 하이픈(-) 사용.',
  },
  {
    id: 'no-fancy-punct',
    severity: 'block',
    // U+2018-201F: smart quotes / U+2022,2023,2043,25E6: bullets
    // U+2026: ellipsis / U+2190-21FF: arrows
    pattern: /[‘-‟•‣…◦⁃←-⇿]/,
    message: 'typographic 특수문자 금지 (smart quotes, ellipsis, arrows, bullets). ASCII 대체: "", \'\', ..., ->, * 등.',
  },
];

module.exports = RULES.map(r => ({
  id: r.id,
  severity: r.severity,
  check: (snippet) =>
    r.pattern.test(snippet)
      ? { ruleId: r.id, severity: r.severity, message: r.message }
      : null,
}));
