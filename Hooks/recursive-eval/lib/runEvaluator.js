// runEvaluator.js - spawn a headless claude evaluator and extract its verdict.
//
// Notes:
// - win32: `claude` is a .cmd shim, not an .exe, so spawn MUST use shell:true.
// - The evaluator reads the live session transcript plus the project's TASK.md
//   and CLAUDE.md (all absolute paths passed in the prompt), then returns a
//   single JSON verdict object.
// - RECURSIVE_EVAL_CHILD=1 is set on the child env as a secondary re-entrancy
//   guard (the primary guard is the running-marker file managed by index.js).

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'evaluator.md');

function buildPrompt(cwd, transcriptPath, targetTask) {
  const base = fs.readFileSync(PROMPT_PATH, 'utf8');
  const taskMd = path.join(cwd, 'co-dev', 'TASK.md');
  const claudeMd = path.join(cwd, 'CLAUDE.md');
  return [
    base,
    '',
    '## Context for this run',
    `- Session transcript (JSONL; read the MOST RECENT activity): ${transcriptPath}`,
    `- Work schedule (TASK.md): ${taskMd}`,
    `- Conventions (CLAUDE.md): ${claudeMd}`,
    `- Target task: ${targetTask || '(none - follow TASK.md dependency order)'}`,
    '',
    'Output ONLY the JSON verdict object. No prose, no code fences.',
  ].join('\n');
}

// Pull a JSON object out of arbitrary text: try whole-string parse first, then
// fall back to the outermost {...} slice.
function extractJson(text) {
  const t = (text || '').trim();
  try {
    return JSON.parse(t);
  } catch {
    // fall through to slice
  }
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(t.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

// Returns the verdict object { verdict, summary, feedback, next, done } or null
// on any failure (timeout, non-zero exit, unparseable output). index.js treats
// null as "do not block" so a broken evaluator never traps the session.
function runEvaluator({ cwd, transcriptPath, model, targetTask, timeoutMs = 540000 }) {
  const prompt = buildPrompt(cwd, transcriptPath, targetTask);

  // The prompt is large and multiline with quotes/braces/paths. Passing it as an
  // argv element does not survive cmd.exe parsing on win32, so it goes on stdin
  // (claude -p reads the prompt from stdin in print mode). argv keeps only flags.
  const args = [
    '-p',
    '--model', model || 'sonnet',
    '--output-format', 'json',
    '--allowedTools', 'Read,Grep,Glob',
    '--permission-mode', 'bypassPermissions',
    // Fallback guard: if a spike ever shows neither marker nor env stops the
    // child's Stop hook, add '--settings', path.join(__dirname,'..','hooks-free.json')
  ];

  const res = spawnSync('claude', args, {
    cwd,
    shell: true,
    encoding: 'utf8',
    input: prompt,
    timeout: timeoutMs,
    env: { ...process.env, RECURSIVE_EVAL_CHILD: '1' },
    maxBuffer: 16 * 1024 * 1024,
  });

  if (res.error || res.status !== 0 || !res.stdout) return null;

  // --output-format json wraps the model output in an envelope { result: "..." }.
  const envelope = extractJson(res.stdout);
  const resultText =
    envelope && typeof envelope.result === 'string' ? envelope.result : res.stdout;
  return extractJson(resultText);
}

module.exports = { runEvaluator, extractJson, buildPrompt };
