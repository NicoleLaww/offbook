---
name: audit-four-perspectives
description: "Audit Offbook (or a specific feature/change in it) from four lenses — acting coach, actress (the actual user), PM, and dev. Use when the user asks for a critique, review, audit, or 'what would you improve' on this app, or asks to run this from multiple perspectives / the four perspectives."
---

# Four-perspective audit — Offbook

Offbook is a single-file (`index.html`) static app for actors: upload a PDF of audition sides, mark your lines, rehearse against a fuzzy speech-scored line drill, and get AI-generated craft breakdowns (Scene Work) grounded in specific acting/writing texts (McKee, Meisner, Mamet, Donnellan, Adler, Guskin, Hagen, Shurtleff, Chubbuck — see `CRAFT_PROMPT`/`STORY_PROMPT` in `index.html`).

This skill produces a critique in four voices, each with a genuinely different job — not four restatements of the same list with different headers. Every finding must be traceable to real code or real behavior, not generic software-review filler.

## Scope

- If the user names a specific feature/change ("audit the rename feature," "audit what we just built"), scope the read to that area plus its direct dependents (what calls it, what it calls).
- If the user asks for a whole-app audit, read `index.html` in full — it is a few thousand lines; read it in sequential chunks rather than sampling, since the value of this audit is catching things a skim would miss (see prior findings below for the kind of thing only a full read catches: an unfiltered cache key, an unescaped HTML attribute, a re-entrant render).
- Skim `test-scorer.mjs` if present — it documents what's already covered and what isn't.
- Check `git log --oneline -20` and `git diff` (if anything is uncommitted) for what's actually new since the last audit, so findings don't re-flag already-fixed issues.

## The four lenses

**Acting coach** — judges the craft content and pedagogy, not the code. Does this feature encourage good acting practice or work against it (e.g., does more structure risk over-intellectualizing when Guskin's whole point, already baked into `STORY_PROMPT`, is instinct-over-intellect)? Is a new prompt addition genuinely grounded in a named source or just asserted? Does a feature's design match the app's own established values (anti-over-preparation, action over psychology) or quietly work against them?

**Actress (the user, under real conditions)** — practical usability on an actual audition day: time pressure, spotty wifi, a same-day self-tape, script revisions arriving with no warning, phone vs. laptop, what she'll actually reach for at 11pm vs. what took the most engineering effort. Prefer findings grounded in how the acting industry actually works (revisions reuse filenames, sides arrive incomplete, casting calls happen fast) over generic UX complaints.

**PM** — scope and risk, not taste. Has anything shipped without real-world validation (a live API call, not just a mocked one)? Is the backlog accumulating aging, unaddressed asks? Is a new feature's cost/complexity proportionate to how often it'll actually be used? Does the file's size/structure still support making changes safely?

**Dev** — correctness and maintainability. Read the actual data flow, not just the function in isolation — the strongest findings this app has produced came from tracing one piece of state (a cut flag, an HTML-escaped value, an in-flight async job) through every place that reads it, not from reviewing a function by itself. Look specifically for: unfiltered pools/caches that a sibling function DOES filter, HTML built via string interpolation into attribute values (escaping gap risk), re-entrancy in anything that tears down and rebuilds DOM, async operations with no guard against overlapping/racing themselves, and silent failure paths (a catch block that swallows an error with no user-visible sign anything went wrong).

## Process

1. Read the code per Scope above. Don't rely on memory of prior audits — behavior changes.
2. For each lens, actually exercise suspicious code paths where feasible (a local `python3 -m http.server`, the Claude Browser tool, and a mocked `craftLLM` — same method used throughout this project's history) rather than asserting a finding from reading alone. A finding that turns out wrong when tested is worse than not finding it — say so and correct course if a live check contradicts your read of the code, the way the phrase-mode threshold arithmetic and the "does removal fire blur" assumption were both wrong on first guess earlier in this project's history until actually tested.
3. Write findings per lens, ranked most-important first within each. Every finding needs: what's wrong, the concrete failure scenario (not "could be an issue" — an actual input/state that breaks), and the file/function it lives in.
4. Skip filler. If a lens genuinely has nothing significant to add, say so in one line rather than padding with minor style notes.
5. End with a single named top pick across all four lenses — the one thing worth doing next if only one gets picked — and say why it beats the others (usually: real risk to work already done > new feature; a silent-failure bug > a cosmetic one).
6. Do not start implementing fixes unless the user asks. This skill produces the audit; fixing what it finds is a separate, explicit ask — for anything beyond a trivial one-line fix, use Plan Mode before writing code, matching how every non-trivial feature in this project has been built.
