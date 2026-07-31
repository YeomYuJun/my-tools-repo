/**
 * lang/js.js — JS/TS 전용 주석 룰 슬롯.
 *
 * 1차는 비어있음. 향후 추가 후보:
 *   - JSDoc @param 타입과 실제 시그니처 불일치 (advisory)
 *   - 파일 헤더 주석 금지
 *   - 명백한 console.log 주변의 디버깅 주석
 *
 * 룰 인터페이스:
 *   { id, severity, check(snippet, ctx) => violation | null }
 */

module.exports = [];
