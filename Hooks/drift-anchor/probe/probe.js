#!/usr/bin/env node
// probe.js - payload dumper for drift-anchor's two open assumptions.
//
//   가정 1: PreCompact 가 이 설치본에서 실제로 발화하는가
//   가정 2: PostToolUseFailure 페이로드의 에러 필드명은 무엇인가
//
// 한 스크립트를 argv 라벨만 바꿔 두 이벤트에 등록한다. 관측 전용:
// stdout 을 절대 쓰지 않고(주입/차단 오염 방지) 항상 exit 0 한다.
// 출력은 이 스크립트 옆 out/probe.jsonl 로만 간다 - 세션의 cwd 와 무관하게
// 어느 프로젝트에서 발화하든 한 곳에 모인다.

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, 'out');
const OUT_FILE = path.join(OUT_DIR, 'probe.jsonl');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main() {
  const label = process.argv[2] || 'unlabeled';
  const raw = readStdin();

  let payload = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    // 파싱 실패해도 원문을 남긴다 - 페이로드 형태 자체가 관측 대상이다.
  }

  const record = {
    label,
    at: new Date().toISOString(),
    // 이벤트명은 snake/camel 양쪽을 받는다 (버전 간 미확정).
    eventFromPayload:
      (payload && (payload.hook_event_name || payload.hookEventName)) || null,
    cwd: (payload && payload.cwd) || null,
    topLevelKeys: payload ? Object.keys(payload) : null,
    payload: payload || { _unparsed: raw.slice(0, 4000) },
  };

  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.appendFileSync(OUT_FILE, JSON.stringify(record) + '\n');
  } catch {
    // 프로브가 세션을 깨뜨리는 일은 없어야 한다. 조용히 포기.
  }

  process.exit(0);
}

main();
