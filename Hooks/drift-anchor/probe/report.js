#!/usr/bin/env node
// report.js - out/probe.jsonl 을 읽어 두 가정에 직접 답한다.
//
//   node report.js
//
// 가정 1(PreCompact 발화)은 레코드 유무로 답이 나온다.
// 가정 2(에러 필드명)는 문자열 필드를 전부 훑어 "에러 본문일 가능성이 높은"
// 경로를 길이순으로 제시한다 - errorSignature 가 무엇을 해싱할지 고르는 근거.

const fs = require('fs');
const path = require('path');

const OUT_FILE = path.join(__dirname, 'out', 'probe.jsonl');

function load() {
  let raw;
  try {
    raw = fs.readFileSync(OUT_FILE, 'utf8');
  } catch {
    console.log('out/probe.jsonl 이 없습니다. 훅을 등록하고 세션을 한 번 돌리세요.');
    process.exit(0);
  }
  return raw
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// 중첩 객체를 [경로, 문자열값] 쌍으로 평탄화. 배열 인덱스도 경로에 포함.
function walkStrings(obj, base, acc) {
  if (obj === null || typeof obj !== 'object') return acc;
  for (const [k, v] of Object.entries(obj)) {
    const p = base ? `${base}.${k}` : k;
    if (typeof v === 'string') acc.push([p, v]);
    else if (typeof v === 'object') walkStrings(v, p, acc);
  }
  return acc;
}

const ERROR_HINT = /error|stderr|message|reason|exception|traceback|failed|failure/i;

function section(title) {
  console.log('\n' + '='.repeat(60));
  console.log(title);
  console.log('='.repeat(60));
}

function main() {
  const records = load();
  console.log(`총 ${records.length}건 수집 (${OUT_FILE})`);

  const byLabel = {};
  for (const r of records) (byLabel[r.label] ||= []).push(r);
  console.log('라벨별:', Object.entries(byLabel).map(([k, v]) => `${k}=${v.length}`).join(', ') || '없음');

  // ---- 가정 1: PreCompact 발화 여부 ----
  section('가정 1 - PreCompact 가 발화하는가');
  const compact = records.filter((r) => /compact/i.test(r.label));
  if (!compact.length) {
    console.log('❌ 발화 기록 없음.');
    console.log('   → 훅 등록을 확인하고 /compact 를 한 번 실행한 뒤 다시 보세요.');
    console.log('   → 등록이 맞는데도 안 잡히면 가정 1은 거짓 → 환기는 턴 카운터(N=12)로만 축소.');
  } else {
    console.log(`✅ 발화 ${compact.length}회.`);
    for (const r of compact) {
      console.log(`   - ${r.at}  label=${r.label}  event=${r.eventFromPayload}  cwd=${r.cwd}`);
    }
    const keys = new Set();
    compact.forEach((r) => (r.topLevelKeys || []).forEach((k) => keys.add(k)));
    console.log('   최상위 키 합집합:', [...keys].join(', ') || '(없음)');
    console.log('   → 참이면 설계대로: PreCompact 가 플래그만 쓰고, 다음 UserPromptSubmit 이 전문 재주장.');
  }

  // ---- 가정 2: PostToolUseFailure 에러 필드명 ----
  section('가정 2 - PostToolUseFailure 의 에러 필드명');
  const fails = records.filter((r) => /fail/i.test(r.label));
  if (!fails.length) {
    console.log('❌ 수집 없음. 훅 등록 후 실패하는 도구 호출을 한 번 일으키세요.');
    console.log('   예) 존재하지 않는 파일 Read, 또는 실패하는 Bash 명령.');
  } else {
    console.log(`✅ 수집 ${fails.length}건.`);
    const keys = new Set();
    fails.forEach((r) => (r.topLevelKeys || []).forEach((k) => keys.add(k)));
    console.log('최상위 키 합집합:', [...keys].join(', '));

    // 경로별로 관측된 최대 길이와 샘플을 모은다.
    const paths = new Map();
    for (const r of fails) {
      for (const [p, v] of walkStrings(r.payload, '', [])) {
        const cur = paths.get(p);
        if (!cur || v.length > cur.len) paths.set(p, { len: v.length, sample: v });
      }
    }

    const ranked = [...paths.entries()]
      .map(([p, info]) => ({ p, ...info, hinted: ERROR_HINT.test(p) }))
      // 이름이 에러를 암시하는 것 우선, 그다음 값이 긴 것 우선.
      .sort((a, b) => (b.hinted - a.hinted) || (b.len - a.len))
      .slice(0, 12);

    console.log('\nerrorSignature 후보 (이름 힌트 > 값 길이 순):');
    for (const c of ranked) {
      const mark = c.hinted ? '★' : ' ';
      console.log(`  ${mark} ${c.p}  (${c.len}자)`);
      console.log(`      "${c.sample.slice(0, 110).replace(/\s+/g, ' ')}"`);
    }
    console.log('\n→ ★ 중 가장 안정적인 하나를 골라 errorSignature 의 원천으로 고정할 것.');
    console.log('  (경로·숫자·해시를 정규화한 뒤 앞 120자의 sha1 앞 8자)');
  }

  console.log('');
}

main();
