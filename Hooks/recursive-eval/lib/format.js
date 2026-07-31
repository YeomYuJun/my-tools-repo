// format.js - render a Stop-hook block reason from an evaluator verdict.
// The returned string becomes the instruction the main session acts on when it
// is forced to continue (decision:block).

function blockReason(verdict, iteration, maxIter) {
  const head = `[recursive-eval] round ${iteration}/${maxIter} - ${verdict.summary || ''}`;

  if (verdict.verdict === 'needs_fix') {
    const items = (verdict.feedback || []).map((f) => `  - ${f}`).join('\n');
    return `${head}\nReview did NOT pass. Fix the following, then finish your turn again:\n${items}`;
  }

  // approved + more work remains
  const n = verdict.next || {};
  return [
    head,
    'Review passed. Continue with the next work unit, then finish your turn again:',
    `  task: ${n.taskId || '(see TASK.md order)'}`,
    `  ${n.instruction || ''}`,
  ].join('\n');
}

module.exports = { blockReason };
