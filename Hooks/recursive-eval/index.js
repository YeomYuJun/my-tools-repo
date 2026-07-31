#!/usr/bin/env node
// index.js - Stop hook entry for the recursive-eval loop.
//
// Forces the main session to keep working until the evaluator approves and no
// tasks remain. Output protocol:
//   - print {"decision":"block","reason":...} on stdout, exit 0  -> session continues
//   - plain exit 0 (no stdout)                                   -> session may stop
//
// Re-entrancy is guarded twice so the evaluator's own headless session never
// re-triggers this loop:
//   1. a running-marker file under the project, present for the whole
//      synchronous spawn window (primary, env-independent)
//   2. the RECURSIVE_EVAL_CHILD env var set on the child process (secondary)

const fs = require('fs');
const sentinel = require('./lib/sentinel');
const { runEvaluator } = require('./lib/runEvaluator');
const { blockReason } = require('./lib/format');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function block(reason) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  process.exit(0);
}

function main() {
  // Guard 2 (cheap, env-based): never recurse inside the evaluator's session.
  if (process.env.RECURSIVE_EVAL_CHILD) process.exit(0);

  const raw = readStdin();
  let payload = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    // no/!json payload - treat as empty
  }
  const cwd = payload.cwd || process.cwd();

  // Guard 1 (primary): a previous round's evaluator is still being spawned.
  if (sentinel.markerExists(cwd)) process.exit(0);

  // Gate: loop is off when not armed (missing lock or armed:false = escape hatch).
  if (!sentinel.isArmed(cwd)) process.exit(0);
  const s = sentinel.read(cwd);

  // Hard cap: exhausted -> disarm and let the session stop.
  if ((s.iteration || 0) >= s.maxIter) {
    sentinel.disarm(cwd);
    process.stderr.write(`[recursive-eval] maxIter ${s.maxIter} reached - loop disarmed.\n`);
    process.exit(0);
  }

  let verdict = null;
  sentinel.setMarker(cwd);
  try {
    verdict = runEvaluator({
      cwd,
      transcriptPath: payload.transcript_path,
      model: s.model,
      targetTask: s.targetTask,
    });
  } catch {
    verdict = null;
  } finally {
    sentinel.clearMarker(cwd);
  }

  // Evaluator failure: do NOT block. A silent never-ending session is worse
  // than stopping and letting the human notice the broken setup.
  if (!verdict || !verdict.verdict) {
    process.stderr.write(
      '[recursive-eval] evaluator failed or unparseable - allowing stop. Check setup.\n'
    );
    process.exit(0);
  }

  // Approved with nothing actionable left (done, or no usable next) -> stop.
  const hasNext = verdict.next && verdict.next.instruction;
  if (verdict.verdict === 'approved' && (verdict.done || !hasNext)) {
    sentinel.disarm(cwd);
    process.exit(0);
  }

  const iteration = sentinel.increment(cwd);
  block(blockReason(verdict, iteration, s.maxIter));
}

main();
