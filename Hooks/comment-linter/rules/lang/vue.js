/**
 * lang/vue.js — Vue SFC 전용 주석 룰 슬롯.
 *
 * 1차는 비어있음. 향후 추가 후보:
 *   - <template> 내부의 디버깅 잔여 (<!-- console.log ... -->) 금지
 *   - <script setup> 상단의 파일 헤더 주석 금지
 *
 * 룰 인터페이스:
 *   { id, severity, check(snippet, ctx) => violation | null }
 */

module.exports = [];
