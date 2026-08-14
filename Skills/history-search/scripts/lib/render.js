'use strict';

const BUDGET = {
  snippetChars: 120,
  snippetsPerSession: 2,
  utteranceChars: 2000,
  pickTotalChars: 25000,
};

const UUID_HEAD = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-/;

/**
 * uuid 세션은 앞 8자로 충분히 구분되지만 subagents 의 'agent-a1220dfbf30a28b8f' 는
 * 앞 8자가 전부 'agent-a1' 이라 서로 충돌한다. uuid 형태가 아니면 자르지 않는다.
 */
function shortId(sessionId) {
  return UUID_HEAD.test(sessionId) ? sessionId.slice(0, 8) : sessionId;
}

function anchorOf(sessionId, message) {
  const uuid = (message.uuid || '').replace(/-/g, '').slice(0, 8) || 'nouuid00';
  return `@${shortId(sessionId)}#${message.line}.${uuid}`;
}

function parseAnchor(raw) {
  // 세션ID 는 uuid 만이 아니다. subagents/ 의 'agent-a1220dfb' 처럼 하이픈과 영문이 섞인다.
  const m = /^@?([0-9a-zA-Z-]{4,})#(\d+)(?:\.([0-9a-zA-Z]+))?$/.exec(raw.trim());
  if (!m) return null;
  return { session: m[1], line: Number(m[2]), uuid: m[3] || null };
}

function stamp(date) {
  if (!date) return '??-?? ??:??';
  const d = new Date(date);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function oneLine(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function clip(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...[+${text.length - max}자]`;
}

function roleMark(role) {
  return role === 'user' ? 'U' : 'A';
}

function renderSearch(sessions, { query, scopeLabel, scanned, skipped }) {
  const out = [];
  out.push(`검색어 "${query}" / 범위 ${scopeLabel} / 스캔 ${scanned}개 파일`);
  out.push('');

  if (sessions.length === 0) {
    out.push('매칭 없음.');
    out.push('');
    out.push('  - 범위를 넓히려면 --all');
    out.push('  - 툴 결과와 파일 내용까지 보려면 --tools');
    out.push('  - 30일 넘은 세션은 리텐션(cleanupPeriodDays 기본 30)으로');
    out.push('    이미 삭제됐을 수 있습니다.');
    return out.join('\n');
  }

  sessions.forEach((s, i) => {
    out.push(
      `[${i + 1}] ${s.project}  ${stamp(s.mtime)}  hits ${s.hits}   ${s.anchor}`
    );
    for (const snip of s.snippets) {
      out.push(`    ${roleMark(snip.role)}> "${clip(oneLine(snip.text), BUDGET.snippetChars)}"`);
    }
  });

  out.push('');
  out.push(`픽업: pick.js ${sessions[0].anchor}   (전후 맥락과 함께 컨텍스트로)`);
  out.push(`이어받기: claude -r ${sessions[0].sessionId}`);
  if (skipped > 0) out.push(`(깨진 라인 ${skipped}개 건너뜀)`);

  return out.join('\n');
}

function renderToolLine(tool, ref) {
  const desc = tool.desc ? `  "${clip(oneLine(tool.desc), 70)}"` : '';
  const size = tool.resultLines ? `  -> ${tool.resultLines}행` : '';
  return `    · ${tool.name}${desc}${size} [${ref}]`;
}

/**
 * blocks: [{ project, sessionId, mtime, center, messages }]
 * center 는 매칭 발화의 line. 그 발화만 화살표로 표시한다.
 * 툴 참조번호(t1, t2...)는 픽업 전체에서 연번이며, 같은 인자로 다시 실행하면 같은 번호가 나온다.
 */
function renderPick(blocks, { ctx }) {
  const out = [];
  const toolIndex = new Map();
  let toolSeq = 0;
  let budget = BUDGET.pickTotalChars;
  let truncatedAt = null;

  for (const block of blocks) {
    const header = `\n=== ${shortId(block.sessionId)} · ${stamp(block.mtime)} · ${block.project} ===\n`;
    out.push(header);
    budget -= header.length;

    for (const msg of block.messages) {
      if (budget <= 0) {
        truncatedAt = block.sessionId;
        break;
      }

      const marker = msg.line === block.center ? '>' : ' ';
      const body = clip(oneLine(msg.text), BUDGET.utteranceChars);
      if (body) {
        const line = `${marker}${roleMark(msg.role)}> ${body}`;
        out.push(line);
        budget -= line.length;
      }

      for (const tool of msg.tools) {
        toolSeq += 1;
        const ref = `t${toolSeq}`;
        toolIndex.set(ref, { anchor: anchorOf(block.sessionId, msg), tool });
        const line = renderToolLine(tool, ref);
        out.push(line);
        budget -= line.length;
      }
    }

    if (truncatedAt) break;
  }

  if (truncatedAt) {
    out.push('');
    out.push(
      `[예산 ${BUDGET.pickTotalChars}자 초과로 중단] --ctx ${Math.max(1, ctx - 1)} 로 줄이거나 앵커를 나눠서 픽업하세요.`
    );
  }

  // tN 번호는 --ctx 가 정하는 창 안에서만 유효하다. 힌트에 ctx 를 박아야 재실행이 같은 창을 연다.
  if (toolSeq > 0) {
    out.push('');
    out.push(`툴 결과 전문이 필요하면: pick.js <같은 앵커> --ctx ${ctx} --tool t1`);
  }

  return { text: out.join('\n'), toolIndex };
}

function renderToolDump(entry, ref) {
  const { tool } = entry;
  const out = [];
  out.push(`=== [${ref}] ${tool.name} ===`);
  if (tool.desc) out.push(`설명: ${oneLine(tool.desc)}`);
  out.push('');
  out.push(tool.resultText ?? '(결과 없음 - 이 세션에 tool_result 가 기록되지 않았습니다)');
  return out.join('\n');
}

module.exports = {
  BUDGET,
  shortId,
  anchorOf,
  parseAnchor,
  stamp,
  oneLine,
  clip,
  renderSearch,
  renderPick,
  renderToolDump,
};
