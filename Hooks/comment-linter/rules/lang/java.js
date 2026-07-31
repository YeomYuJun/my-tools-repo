/**
 * lang/java.js — Java 전용 주석 룰 슬롯.
 *
 * 1차는 비어있음. 향후 추가 후보:
 *   - Javadoc @param 이름이 시그니처의 파라미터와 불일치 (advisory)
 *   - @author 태그 금지 (git blame 사용)
 *   - getter/setter 위의 빈 Javadoc 금지
 *
 * 룰 인터페이스:
 *   { id, severity, check(snippet, ctx) => violation | null }
 */

module.exports = [];
