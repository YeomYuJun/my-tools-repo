---
name: handoff
description: Hand off the current session's work state to a future session. Discovers this session's durable anchors (progress ledger, live rules, git changes, reference docs) — which differ every session — grades each claim against the source it was verified from (✓/~/⚠️), then emits two artifacts, a record document plus a thin bootstrap prompt. Triggers "/handoff", "hand this off to another session", "make a handoff", "인수인계 만들어줘", "핸드오프".
---

## When to use

When a session grows large (compaction risk) and the work must continue in another session, or when pausing work for a later/other session to resume. The handoff this produces is **verified against sources** and lets the next session resume with **minimal tokens**.

Trigger examples: "/handoff", "get this ready to hand off to another session", "make the handoff doc and bootstrap".

## Why this beats a manual summary

- **Recall is done by the discovery bundle, not by the verification grades.** The grades only raise the *precision* of claims you *make*; they do nothing for claims you have *forgotten* (a decision compacted away 200 turns ago produces no `⚠️`, just silence). So first re-surface ground truth via the bundle, then reconstruct.
- **Sources differ every session.** Do not harvest a fixed file set — *discover* what this session's anchors actually are.
- **The highest-value content (accumulated judgment / policies) lives only in the conversation, so it grades `~`. `~` is not second-class — it is where the value concentrates.** Capture it richly.

## Workflow (4 steps)

### 1) DISCOVER — find this session's anchors (this is the recall step)
- Run `node <install-path>/handoff.js` → discovery bundle (git status + diff summary, candidate tracking files, MEMORY.md index). Ledgers outside cwd will not appear — supplement from conversation memory and Read them.
- Candidate axes: progress ledger (checklist/todo/issue-tracker/… or none) · live rules (memory [[links]] / .state / CLAUDE.md / agreed-in-conversation) · this session's changes (git) · reference docs.
- **The bundle's "ledger candidates" bucket is only a hint.** A ledger may have a non-standard name, so also scan the `recent .md` and `handoff docs` candidates and *judge what the real ledger is*. A `(none)` bucket does NOT mean there is no ledger.
- Assign each anchor a confidence. High → adopt automatically. **Low / ambiguous / high-stakes (multiple ledger candidates, unclear whether auth/security rules apply, etc.) → propose to the user and confirm before proceeding.**

### 2) SYNTHESIZE — write the document (equal rigor to VERIFY)
Use the fixed schema below. Capture the **accumulated judgment / policies** that live only in the conversation, concretely. Reference memory rules by `[[link]]` only — do not restate them.

    # <task name> — session handoff
    ## Goal
    ## Reference docs
    ## Rules that must hold            (memory rules as [[link]])
    ## Established per-category policy  (conversation-based judgment — rich)
    ## Workflow
    ## Current state                   (done / remaining — each item tagged ✓ ~ ⚠️)
    ## How the next session starts

### 3) VERIFY — grade each claim against the discovered sources
- `✓` source-verified · `~` inferred (no comparison source; most judgment/policy is here — NOT second-class) · `⚠️` unverifiable or **contradicts a source** (make it loud).
- **A `✓` must cite evidence you actually checked during this VERIFY step** — command output (`git diff` / `git log` / tests), `file:line`, checkbox state, etc. If you cannot confirm the evidence now, **no `✓` — downgrade to `~`.** (Stamping `✓` from memory in a compacted session makes the headline differentiator illusory.)
- If there is no ledger to compare against, everything is `~`/`⚠️` plus a **banner at the top of the document** ("conversation-based handoff, no ledger comparison").

### 4) EMIT — two artifacts
- **Record document** (durable): save next to the discovered ledger. If a prior handoff exists, delta-update it; otherwise create a new one. Propose the path but let the user override.
- **Thin bootstrap** (to paste; must reference — never duplicate — the document):

      <task name> handoff. First read this doc: <path>
      Top rules: 1) … 2) … 3) …
      ⚠️ Unverified: <item>
      After reading, ask me which item to start with, then begin.

## Done when

The record document (with verification grades) and the thin bootstrap are produced, and the user can paste the bootstrap into a new session and resume without re-asking.

## Notes

- Never put secrets (tokens/passwords) in any artifact.
- Keep the bootstrap thin — duplicating the document defeats the token purpose.
- git diff is summarized/capped by handoff.js (never paste a full diff).
