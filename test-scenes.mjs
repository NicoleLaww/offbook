// Regression tests for scene-boundary and save/carryover logic in index.html:
// recomputeScenes() (the derive-scenes-from-sceneStart-flags engine
// everything else sits on), sceneFingerprint()/bestFuzzySceneMatch() (exact
// and fuzzy matching deciding whether a re-uploaded revision's scene carries
// its Scene Work forward — a wrong match silently misattaches one scene's
// breakdown to a different scene, worse than losing it outright),
// findMergeCandidate() (the merge-reversion suggestion), computeSavedUpdate()
// (the exact spot a bare object rebuild once silently dropped a script's
// genre tag on every save), and cleanChar() (character-name cleanup).
//
// No test framework, no build step — same shape as test-scorer.mjs, and for
// the same reason: it extracts the ACTUAL current implementation straight out
// of index.html, so this can never silently drift from the real code.
//   node test-scenes.mjs
//
// NOT covered here (same boundary test-scorer.mjs draws): anything that
// touches the DOM or IndexedDB directly (buildScript, saveCurrent,
// toggleSceneStart/undoMerge's own wrapper, loadScript). Those are exercised
// live (local server + Claude Browser tool) each time they change, per this
// project's standing convention — this file is for the pure logic underneath
// them, cheap enough to run on every commit.

import { readFileSync } from 'fs';

const src = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

// Extracts one top-level `function name(...){...}` body verbatim out of the
// real source. This codebase's functions are consistently unindented at the
// top level, so a real closing brace is either on the SAME line as the
// opening one (a one-liner) or alone at column 0 on its own line — neither
// pattern is fooled by an indented inner `});` or (norm's case) a literal
// `{`/`}` sitting inside a regex character class, both of which have
// something else on their line besides the brace.
function extractFn(name) {
  const startMarker = `function ${name}(`;
  const start = src.indexOf(startMarker);
  if (start === -1) throw new Error(`Could not find function ${name}() in index.html — renamed or moved?`);
  const openBrace = src.indexOf('{', start);
  const nextNewline = src.indexOf('\n', openBrace);
  const sameLineClose = src.indexOf('}', openBrace);
  let end;
  if (sameLineClose !== -1 && (nextNewline === -1 || sameLineClose < nextNewline)) {
    end = sameLineClose + 1; // one-liner
  } else {
    const closeAtCol0 = src.indexOf('\n}', openBrace);
    if (closeAtCol0 === -1) throw new Error(`Could not find the end of ${name}() — did its formatting change?`);
    end = closeAtCol0 + 2; // include the "\n}"
  }
  return src.slice(start, end);
}
// Same idea as extractFn but for a single-statement `const NAME=...;` — used
// for FREE_RETRY_BACKOFF, which nextRetryDecision() closes over.
function extractConst(name) {
  const startMarker = `const ${name}=`;
  const start = src.indexOf(startMarker);
  if (start === -1) throw new Error(`Could not find const ${name} in index.html — renamed or moved?`);
  const end = src.indexOf(';', start) + 1;
  return src.slice(start, end);
}

const scope = new Function(`
  ${extractFn('norm')}
  ${extractFn('cleanChar')}
  ${extractFn('sceneFingerprint')}
  ${extractFn('findMergeCandidate')}
  ${extractFn('computeSavedUpdate')}
  ${extractFn('tokenize')}
  ${extractFn('lev')}
  ${extractFn('wordsClose')}
  ${extractFn('weq')}
  ${extractFn('lcs')}
  ${extractFn('bestMatches')}
  ${extractFn('sceneTokens')}
  ${extractFn('bestFuzzySceneMatch')}
  ${extractFn('carryLineFlags')}
  ${extractFn('isOverloadMsg')}
  ${extractFn('isQuotaMsg')}
  ${extractConst('FREE_RETRY_BACKOFF')}
  ${extractFn('nextRetryDecision')}
  let SL;
  ${extractFn('recomputeScenes')}
  let _scriptsCache;
  ${extractFn('loadSaved')}
  ${extractFn('checklistCount')}
  ${extractFn('genreCounts')}
  ${extractFn('pickCarriedGenre')}
  ${extractFn('cleanGemErr')}
  ${extractFn('parsePretakeReply')}
  ${extractFn('getScriptRoute')}
  let curName='';
  let _sessionWork={};
  ${extractFn('workKey')}
  ${extractFn('getWork')}
  let _sceneFilter='all';
  ${extractFn('currentSceneLines')}
  ${extractFn('sceneText')}
  let _logView='date';
  ${extractFn('logGroupKey')}
  return { norm, cleanChar, sceneFingerprint, findMergeCandidate, computeSavedUpdate, sceneTokens, bestFuzzySceneMatch, carryLineFlags, isOverloadMsg, isQuotaMsg, nextRetryDecision, FREE_RETRY_BACKOFF, recomputeScenes, setSL: v => SL = v, getSL: () => SL, checklistCount, genreCounts, pickCarriedGenre, cleanGemErr, parsePretakeReply, getScriptRoute, getWork, currentSceneLines, sceneText, logGroupKey, setScriptsCache: v => _scriptsCache = v, setCurName: v => curName = v, setSessionWork: v => _sessionWork = v, setSceneFilter: v => _sceneFilter = v, setLogView: v => _logView = v };
`)();
const { cleanChar, sceneFingerprint, findMergeCandidate, computeSavedUpdate, sceneTokens, bestFuzzySceneMatch, carryLineFlags, isOverloadMsg, isQuotaMsg, nextRetryDecision, FREE_RETRY_BACKOFF, setSL, getSL, recomputeScenes, checklistCount, genreCounts, pickCarriedGenre, cleanGemErr, parsePretakeReply, getScriptRoute, getWork, currentSceneLines, sceneText, logGroupKey, setScriptsCache, setCurName, setSessionWork, setSceneFilter, setLogView } = scope;

let pass = 0, fail = 0;
function t(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; }
  else { fail++; console.error(`✗ ${desc}\n    expected: ${JSON.stringify(expected)}\n    got:      ${JSON.stringify(actual)}`); }
}

// --- cleanChar(): character-cue cleanup ---
t('cleanChar strips a trailing (CONT\'D)', cleanChar("PORTIA (CONT'D)"), 'PORTIA');
t('cleanChar strips a trailing parenthetical of any kind', cleanChar('LIAM (O.S.)'), 'LIAM');
t('cleanChar collapses internal double spaces', cleanChar('DR.  AHMED'), 'DR. AHMED');
t('cleanChar trims surrounding whitespace', cleanChar('  PEG  '), 'PEG');
t('cleanChar leaves an already-clean name untouched', cleanChar('PEG'), 'PEG');

// --- recomputeScenes(): the derive-scenes-from-flags engine everything else
// (script view, Scene Work, Audio Export, merge/undo-merge) sits on ---
function line(char, sceneStart) { return { char, sceneStart }; }

setSL([line('PEG', false), line('LIAM', false), line('PEG', true), line('AHMED', false)]);
recomputeScenes();
t('recomputeScenes: line 0 is always scene 1\'s start regardless of its own flag',
  getSL().map(l => l.scene), [1, 1, 2, 2]);
t('recomputeScenes: _sceneFirst is set only on each scene\'s first line',
  getSL().map(l => l._sceneFirst), [true, false, true, false]);

// Merge: what toggleSceneStart(id) does when it flips a start line to false —
// the two scenes above should collapse into one.
setSL([line('PEG', false), line('LIAM', false), line('PEG', true), line('AHMED', false)]);
getSL()[2].sceneStart = false; // merge scene 2 into scene 1
recomputeScenes();
t('merge (sceneStart true -> false) collapses two scenes into one',
  getSL().map(l => l.scene), [1, 1, 1, 1]);

// Undo merge: flipping that same flag back should restore the EXACT original
// split — this is the whole premise undoMerge() relies on (a plain boolean
// flip has no other state to lose), and it's worth pinning down as a real
// test since it's the guarantee the whole feature is built on.
getSL()[2].sceneStart = true; // undo the merge
recomputeScenes();
t('undo-merge (flipping sceneStart back) restores the original split exactly',
  getSL().map(l => l.scene), [1, 1, 2, 2]);

// A 3-scene script, merging the MIDDLE scene into the first — the third
// scene must renumber down by one, not keep a gap.
setSL([line('A', false), line('B', true), line('C', true), line('D', false)]);
recomputeScenes();
t('sanity: 3 scenes (A|B,D|C,D split as 1,2,3,3) before any merge', getSL().map(l => l.scene), [1, 2, 3, 3]);
getSL()[1].sceneStart = false; // merge scene 2 (B) into scene 1
recomputeScenes();
t('merging the middle scene renumbers the trailing scene down, no gap',
  getSL().map(l => l.scene), [1, 1, 2, 2]);

// --- sceneFingerprint(): exact-match gate for revision carryover ---
const scriptA = [{ scene: 1, text: 'Vitals stable.' }, { scene: 1, text: 'Okay.' }, { scene: 2, text: 'I accepted the job.' }];
const scriptB = [{ scene: 1, text: 'Vitals stable.' }, { scene: 1, text: 'Okay.' }, { scene: 2, text: 'I accepted the job.' }];
const scriptC = [{ scene: 1, text: 'Vitals stable.' }, { scene: 1, text: 'Okay, fine.' }, { scene: 2, text: 'I accepted the job.' }];

t('sceneFingerprint: word-for-word identical scenes match',
  sceneFingerprint(scriptA, 1) === sceneFingerprint(scriptB, 1), true);
t('sceneFingerprint: a single changed word breaks the exact match (by design — carryover would rather lose a scene\'s work than risk misattaching it)',
  sceneFingerprint(scriptA, 1) === sceneFingerprint(scriptC, 1), false);
t('sceneFingerprint: punctuation/case noise is ignored (built on norm())',
  sceneFingerprint(scriptA, 1) === sceneFingerprint([{ scene: 1, text: 'VITALS STABLE' }, { scene: 1, text: "OKAY?" }], 1), true);
t('sceneFingerprint: different scenes of the same script never collide',
  sceneFingerprint(scriptA, 1) === sceneFingerprint(scriptA, 2), false);

// --- findMergeCandidate(): the merge-reversion-suggestion detector. Feeds
// the "This revision split Scene N back into two — merge them again like
// before?" banner — a wrong positive here would offer to merge scenes that
// were never actually one, a wrong negative would silently drop the
// suggestion the whole feature exists for. ---
function nl(id, scene, sceneFirst, text) { return { id, scene, _sceneFirst: sceneFirst, text }; }
function ol(scene, sceneFirst, text) { return { scene, _sceneFirst: sceneFirst, text }; }

const newLinesBasic = [
  nl(0, 1, true, 'Vitals stable.'),
  nl(1, 1, false, 'Okay.'),
  nl(2, 2, true, 'I accepted the job.'),
  nl(3, 2, false, 'Fuck. Thats soon.'),
  nl(4, 3, true, 'Come with me.'),
];
// This old script had scene 1 merged (originally two scenes' worth of
// dialogue) and a separate scene 2 that a normal exact match already
// claimed before findMergeCandidate ever runs — mirroring doPDF's real
// call order (it only looks at scenes the earlier exact/fuzzy passes left).
const oldLinesMerged = [
  ol(1, true, 'Vitals stable.'), ol(1, false, 'Okay.'), ol(1, false, 'I accepted the job.'), ol(1, false, 'Fuck. Thats soon.'),
  ol(2, true, 'Come with me.'),
];
const preparedBasic = [{ oldLines: oldLinesMerged, oldScenes: [1, 2], claimed: new Set([2]) }];

const found = findMergeCandidate(newLinesBasic, preparedBasic, [1, 2]);
t('findMergeCandidate: detects two adjacent unmatched new scenes that recombine into an old merged scene',
  found && { aId: found.aId, bId: found.bId, sceneNum: found.sceneNum },
  { aId: 0, bId: 2, sceneNum: 1 });

t('findMergeCandidate: no candidate when the two unmatched scenes aren\'t adjacent (1 and 3, skipping 2)',
  findMergeCandidate(newLinesBasic, preparedBasic, [1, 3]), null);

t('findMergeCandidate: no candidate when the content genuinely differs (never force a false merge)',
  findMergeCandidate(
    [nl(0, 1, true, 'Totally different line.'), nl(1, 2, true, 'Also different.')],
    preparedBasic, [1, 2]
  ), null);

t('findMergeCandidate: an already-claimed old scene is never offered, even if its text would otherwise match',
  findMergeCandidate(newLinesBasic, [{ oldLines: oldLinesMerged, oldScenes: [1, 2], claimed: new Set([1, 2]) }], [1, 2]),
  null);

// --- computeSavedUpdate(): the exact spot a bare {name,work,lines} rebuild
// once silently dropped a script's genre (and would have dropped route too)
// on every save, including the one buildScript() fires on a plain Load. ---
const dummyLine = { char: 'PEG', text: 'Vitals stable.', isMine: true, cut: false, sceneStart: true };

{
  const arr = [{ name: 'Script.pdf', genre: 'medical drama', route: 'free', work: { '1::PEG': { messages: ['x'] } }, lines: [] }];
  const { updated } = computeSavedUpdate(arr, 'Script.pdf', [dummyLine], undefined);
  t('computeSavedUpdate: saving new lines preserves an existing genre tag (the regression this guards)',
    updated[0].genre, 'medical drama');
  t('computeSavedUpdate: preserves existing route when no override is given',
    updated[0].route, 'free');
  t('computeSavedUpdate: preserves existing Scene Work untouched',
    updated[0].work, { '1::PEG': { messages: ['x'] } });
}
{
  const arr = [{ name: 'Script.pdf', genre: 'medical drama', route: 'free', work: {}, lines: [] }];
  const { updated } = computeSavedUpdate(arr, 'Script.pdf', [dummyLine], 'paid');
  t('computeSavedUpdate: an explicit routeOverride (doPDF, upload time) wins over the existing route',
    updated[0].route, 'paid');
}
t('computeSavedUpdate: a brand-new script with no override defaults to paid (the safe choice)',
  computeSavedUpdate([], 'New.pdf', [dummyLine], undefined).updated[0].route, 'paid');
t('computeSavedUpdate: a saved line\'s optional fields default to empty string / false, never undefined',
  computeSavedUpdate([], 'New.pdf', [{ char: 'X', text: 'hi' }], undefined).updated[0].lines[0],
  { char: 'X', direction: undefined, text: 'hi', before: '', after: '', isMine: false, cut: false, sceneStart: false, sceneHeading: '', sceneLabel: '', carried: false, carriedFrom: '', carriedFuzzy: false });
{
  // 500 unrelated existing scripts + saving a new one = 501 -> the oldest
  // (last in array order, since unshift always puts the current save first)
  // gets evicted and the array is capped back to 500.
  const many = Array.from({ length: 500 }, (_, i) => ({ name: `old-${i}.pdf`, lines: [] }));
  const { updated, evicted } = computeSavedUpdate(many, 'New.pdf', [dummyLine], undefined);
  t('computeSavedUpdate: stays capped at 500 scripts', updated.length, 500);
  t('computeSavedUpdate: evicts the oldest (last-in-order) script once past the cap', evicted, 'old-499.pdf');
}
t('computeSavedUpdate: no eviction below the cap', computeSavedUpdate([{ name: 'a.pdf', lines: [] }], 'New.pdf', [dummyLine], undefined).evicted, null);

// --- bestFuzzySceneMatch(): the fuzzy carryover fallback used only after an
// exact sceneFingerprint match fails — misattaching a whole scene's Scene
// Work to the wrong scene is explicitly worse than a rehearsal false-pass
// (see doPDF's own comment on FUZZY_THRESHOLD, 0.92), so the ratio math
// itself is worth pinning down, not just exercised live. ---
function scene(n, text) { return { scene: n, text }; }
const nsTokensFor = text => sceneTokens([scene(1, text)], 1);

const baseText = 'the quick brown fox jumps over the lazy dog near the old fence'; // 13 words
const oneWordChanged = 'the quick brown fox jumps over the lazy cat near the old fence'; // dog -> cat, not fuzzy-close
const twoWordsChanged = 'the quick brown fox jumps over the lazy cat near the new fence'; // + old -> new

t('bestFuzzySceneMatch: identical text is a perfect (1.0) match',
  bestFuzzySceneMatch(nsTokensFor(baseText), [{ oldLines: [scene(1, baseText)], oldScenes: [1], claimed: new Set() }]).ratio, 1);

const oneWordResult = bestFuzzySceneMatch(nsTokensFor(oneWordChanged), [{ oldLines: [scene(1, baseText)], oldScenes: [1], claimed: new Set() }]);
t('bestFuzzySceneMatch: one non-fuzzy-close word swapped in 13 lands just above the 0.92 fuzzy-carryover bar (12/13 ≈ 0.923)',
  oneWordResult.ratio >= 0.92, true);

const twoWordsResult = bestFuzzySceneMatch(nsTokensFor(twoWordsChanged), [{ oldLines: [scene(1, baseText)], oldScenes: [1], claimed: new Set() }]);
t('bestFuzzySceneMatch: two words swapped in 13 falls below the 0.92 bar (11/13 ≈ 0.846) — the caller would correctly reject this',
  twoWordsResult.ratio >= 0.92, false);

t('bestFuzzySceneMatch: an already-claimed old scene is never offered',
  bestFuzzySceneMatch(nsTokensFor(baseText), [{ oldLines: [scene(1, baseText)], oldScenes: [1], claimed: new Set([1]) }]), null);

t('bestFuzzySceneMatch: nothing overlapping at all returns null, not a false-positive scrape',
  bestFuzzySceneMatch(nsTokensFor(baseText), [{ oldLines: [scene(1, 'completely unrelated dialogue about something else')], oldScenes: [1], claimed: new Set() }]), null);

t('bestFuzzySceneMatch: picks the higher-ratio candidate among several old scenes',
  bestFuzzySceneMatch(nsTokensFor(baseText), [{
    oldLines: [scene(1, 'completely unrelated dialogue about something else'), scene(2, baseText)],
    oldScenes: [1, 2], claimed: new Set()
  }]).os, 2);

// --- carryLineFlags(): per-line isMine/cut carryover for a matched scene —
// a scene showing "carried over" used to still silently wipe which lines
// were marked hers and which were cut, on EVERY revision including a
// 100%-unchanged one. ---
function ln(char, isMine, cut) { return { char, isMine, cut }; }

{
  const oldLines = [ln('PEG', true, false), ln('LIAM', false, true)];
  const newLines = [ln('PEG', false, false), ln('LIAM', false, false)];
  carryLineFlags(oldLines, newLines);
  t('carryLineFlags: carries isMine across when the character at that position matches',
    newLines[0], { char: 'PEG', isMine: true, cut: false });
  t('carryLineFlags: carries cut across when the character at that position matches',
    newLines[1], { char: 'LIAM', isMine: false, cut: true });
}
{
  // A shifted line (an extra stage direction split differently) means the
  // character at position 0 no longer matches — must skip that pair rather
  // than hand PEG's mark to LIAM's line.
  const oldLines = [ln('PEG', true, false)];
  const newLines = [ln('LIAM', false, false)];
  carryLineFlags(oldLines, newLines);
  t('carryLineFlags: a character mismatch at a position is skipped, never misattributed',
    newLines[0], { char: 'LIAM', isMine: false, cut: false });
}
{
  // Old scene shorter than the new one (a line got added) — positions past
  // the old scene's length are left completely untouched.
  const oldLines = [ln('PEG', true, false)];
  const newLines = [ln('PEG', false, false), ln('LIAM', true, true)];
  carryLineFlags(oldLines, newLines);
  t('carryLineFlags: carries the overlapping position', newLines[0].isMine, true);
  t('carryLineFlags: never touches a new line past the old scene\'s length',
    newLines[1], { char: 'LIAM', isMine: true, cut: true });
}
t('carryLineFlags: coerces a missing/undefined isMine to false, never leaves it undefined',
  (() => { const nl = [ln('PEG', undefined, undefined)]; carryLineFlags([ln('PEG', undefined, undefined)], nl); return nl[0]; })(),
  { char: 'PEG', isMine: false, cut: false });

// --- isOverloadMsg() / isQuotaMsg(): which error gets which one-click fix in
// wkRenderError (⚡ Switch to paid & retry vs the same button under different
// copy vs a dead-end generic message). A regex edit that lets these overlap,
// or stops matching the real provider wording, silently changes which button
// — or none at all — a real error shows. ---
t('isOverloadMsg: matches Gemini\'s "high demand" overload wording', isOverloadMsg('The model is overloaded. Please try again later.'), true);
t('isOverloadMsg: matches "please try again" alone', isOverloadMsg('Please try again in a few seconds.'), true);
t('isOverloadMsg: does not match a quota error (the two must stay mutually exclusive)',
  isOverloadMsg('Free Gemini tier has no quota on this key (it reports limit 0).'), false);
t('isOverloadMsg: does not match an unrelated generic error', isOverloadMsg('Invalid API key.'), false);
t('isOverloadMsg: never throws on a missing/undefined message', isOverloadMsg(undefined), false);

t('isQuotaMsg: matches the app\'s own cleaned "no quota" message', isQuotaMsg('Free Gemini tier has no quota on this key (it reports limit 0).'), true);
t('isQuotaMsg: matches Google\'s real raw "limit: 0" wording', isQuotaMsg('You exceeded your current quota, limit: 0, please check your plan and billing details.'), true);
t('isQuotaMsg: does not match an overload error (the two must stay mutually exclusive)',
  isQuotaMsg('The model is overloaded. Please try again later.'), false);
t('isQuotaMsg: does not match an unrelated generic error', isQuotaMsg('Invalid API key.'), false);

// --- nextRetryDecision(): craftLLM's free-tier queue — "retry or give up,
// wait how long" for the one error type (overload) that's actually worth
// retrying. A subtle bug here means either giving up too early (worse
// experience than the queue was built for) or retrying forever (silently
// eats the ~50s budget the comment on FREE_RETRY_BACKOFF promises, or worse,
// never gives up at all). ---
t('sanity: FREE_RETRY_BACKOFF is the 5-try queue the comments describe', FREE_RETRY_BACKOFF, [2000, 4000, 8000, 16000, 30000]);

t('nextRetryDecision: first attempt (retries=0) waits the first backoff step and reports attempt 1 of 5',
  nextRetryDecision(0, true), { wait: 2000, attempt: 1, max: 5 });
t('nextRetryDecision: the very first real call passes _retries as undefined — treated the same as 0',
  nextRetryDecision(undefined, true), { wait: 2000, attempt: 1, max: 5 });
t('nextRetryDecision: a later attempt (retries=1) advances to the next backoff step',
  nextRetryDecision(1, true), { wait: 4000, attempt: 2, max: 5 });
t('nextRetryDecision: the last valid attempt (retries=4, the 5th try) uses the longest wait',
  nextRetryDecision(4, true), { wait: 30000, attempt: 5, max: 5 });
t('nextRetryDecision: once the queue is exhausted (retries=5) it gives up, not an infinite retry',
  nextRetryDecision(5, true), null);
t('nextRetryDecision: never retries past exhaustion even if called again (retries=6)',
  nextRetryDecision(6, true), null);
t('nextRetryDecision: a quota wall (not overload) never retries, even on the very first attempt — waiting can\'t fix a 0-quota key',
  nextRetryDecision(0, false), null);

// --- checklistCount(): feeds patternsDataCount(), the staleness check that
// decides whether the Patterns feature thinks there's enough new data since
// the last run to be worth re-querying. The comment above it in index.html
// already flags the risk this guards: the count can look unchanged while the
// underlying content changed (or vice versa), so the count itself needs to
// be right, not just plausible. ---
setScriptsCache([
  { name: 'a.pdf', work: { '1::PEG': { checklist: { verb: 'push' } }, '2::PEG': { checklist: null } } },
  { name: 'b.pdf', work: { '1::LIAM': { checklist: { verb: '', position: '', direction: '', gutCheck: '' } } } },
  { name: 'c.pdf' },
]);
t('checklistCount: counts only entries with at least one filled checklist field, skipping null checklists, all-empty checklists, and scripts with no work at all',
  checklistCount(), 1);

setScriptsCache([]);
t('checklistCount: no saved scripts at all is 0, not a crash', checklistCount(), 0);

setScriptsCache([{ name: 'd.pdf', work: { '1::X': { checklist: { gutCheck: 'yikes' } }, '2::X': { checklist: { verb: 'go' } } } }]);
t('checklistCount: counts multiple filled entries within a single script, not just one per script',
  checklistCount(), 2);

setScriptsCache([{ name: 'e.pdf', work: { '1::X': { checklist: { verb: '', position: 'early', direction: '', gutCheck: '' } } } }]);
t('checklistCount: a single filled field (position only) is enough to count as filled',
  checklistCount(), 1);

// --- genreCounts(): gates the Genre Comparison UI (needs 2+ distinct tagged
// genres) and feeds its "Tagged: X (2), Y (1)" summary line. ---
setScriptsCache([
  { name: 'a.pdf', genre: 'thriller' },
  { name: 'b.pdf', genre: 'Thriller' }, // case-sensitive on purpose — not normalized, she types it free-text
  { name: 'c.pdf', genre: '  ' }, // whitespace-only counts as untagged
  { name: 'd.pdf', genre: '' },
  { name: 'e.pdf' }, // no genre field at all
  { name: 'f.pdf', genre: 'comedy' },
]);
t('genreCounts: counts exact (case-sensitive) genre strings, skipping blank/whitespace-only/missing tags',
  genreCounts(), { thriller: 1, Thriller: 1, comedy: 1 });

setScriptsCache([{ name: 'a.pdf', genre: 'drama' }, { name: 'b.pdf', genre: ' drama ' }]);
t('genreCounts: trims surrounding whitespace before counting, so "drama" and " drama " are the same tag',
  genreCounts(), { drama: 2 });

t('genreCounts: no saved scripts at all is an empty object, not a crash',
  (setScriptsCache([]), genreCounts()), {});

// --- pickCarriedGenre(): the fix for a real bug (see git history) — revision
// carryover's placeholder write ran BEFORE computeSavedUpdate's own
// field-preserving spread, on a bare {name,work,lines} object, so a script's
// genre tag silently vanished on every revision that carried anything over.
// Confirmed live against both the common same-filename reupload and the
// cross-filename "Revision of" pick before this was split out. ---
t('pickCarriedGenre: prefers the tag already saved under THIS exact filename (the common same-filename reupload case)',
  pickCarriedGenre({ name: 'Script.pdf', genre: 'psychological thriller' }, [{ name: 'Script.pdf', genre: 'psychological thriller' }]),
  'psychological thriller');

t('pickCarriedGenre: falls back to a contributing candidate\'s tag when nothing is saved yet under the new filename (the cross-filename "Revision of" case)',
  pickCarriedGenre(undefined, [{ name: 'Draft 1.pdf', genre: 'courtroom drama' }]),
  'courtroom drama');

t('pickCarriedGenre: an existing-under-this-name tag wins over a candidate\'s, even when they differ',
  pickCarriedGenre({ name: 'Script.pdf', genre: 'kept' }, [{ name: 'Draft 1.pdf', genre: 'discarded' }]),
  'kept');

t('pickCarriedGenre: skips a blank existing tag and falls through to the candidate instead of carrying nothing',
  pickCarriedGenre({ name: 'Script.pdf', genre: '  ' }, [{ name: 'Draft 1.pdf', genre: 'noir' }]),
  'noir');

t('pickCarriedGenre: picks the FIRST candidate with a real tag when there are several (manualSource tried before sameNameMatch, same order doPDF builds `candidates` in)',
  pickCarriedGenre(undefined, [{ name: 'Draft 1.pdf', genre: '' }, { name: 'Draft 2.pdf', genre: 'heist' }]),
  'heist');

t('pickCarriedGenre: no existing entry and no candidate has a tag — empty string, not undefined/null, so the caller\'s spread (genre ? {genre} : {}) cleanly omits the field',
  pickCarriedGenre(undefined, [{ name: 'Draft 1.pdf' }, { name: 'Draft 2.pdf', genre: '' }]),
  '');

// --- cleanGemErr(): the one place a raw Gemini error becomes the message
// isOverloadMsg/isQuotaMsg/wkRenderError actually classify and show her —
// a regression here silently changes which button (if any) she gets on a
// free-tier failure, same risk as a drift in those two regexes themselves. ---
t('cleanGemErr: a 429 status always gets the friendly no-quota message, regardless of the raw message text',
  cleanGemErr(429, 'some unrelated raw text'),
  'Free Gemini tier has no quota on this key (it reports limit 0). Use the 🔒 Confidential (OpenAI) route, or enable billing on your Google AI Studio key.');

t('cleanGemErr: a non-429 status with "quota" in the message also gets the friendly message',
  cleanGemErr(400, 'You exceeded your current quota, limit: 0, please check your plan and billing details.'),
  'Free Gemini tier has no quota on this key (it reports limit 0). Use the 🔒 Confidential (OpenAI) route, or enable billing on your Google AI Studio key.');

t('cleanGemErr: "rate limit" wording (with or without a hyphen) also matches',
  cleanGemErr(400, 'Rate-limit exceeded, try again later'),
  'Free Gemini tier has no quota on this key (it reports limit 0). Use the 🔒 Confidential (OpenAI) route, or enable billing on your Google AI Studio key.');

t('cleanGemErr: an unrelated error at a non-429 status passes the raw message through unchanged',
  cleanGemErr(500, 'Internal server error'),
  'Internal server error');

t('cleanGemErr: a missing/empty message at a non-429, non-quota status falls back to "Gemini error <status>"',
  cleanGemErr(503, ''),
  'Gemini error 503');

// --- getScriptRoute(): which key (free Gemini vs paid OpenAI) a given saved
// script uses — read on every AI call that script makes, including the
// paid/free routing checks in Patterns/Genre/Tag-suggest. ---
setScriptsCache([{ name: 'A.pdf', route: 'free' }, { name: 'B.pdf' }]);
t('getScriptRoute: returns the script\'s own explicit route', getScriptRoute('A.pdf'), 'free');
t('getScriptRoute: defaults to paid (the safe choice) when a script predates the route field', getScriptRoute('B.pdf'), 'paid');
t('getScriptRoute: a script name that isn\'t saved at all also defaults to paid, not a crash', getScriptRoute('nope.pdf'), 'paid');

// --- getWork()/workKey(): the per-scene-per-character Scene Work lookup.
// Keyed by workKey(scene,char) now, but scripts saved before scenes existed
// stored a thread under the bare character name — scene 1 falls back to that
// old key so nothing already written gets orphaned by the scene-aware rewrite. ---
setScriptsCache([{ name: 'Script.pdf', work: { '2::PEG': { messages: ['scene2 breakdown'] }, 'PEG': { messages: ['pre-scenes breakdown'] } } }]);
setCurName('Script.pdf');
t('getWork: looks up by scene::char when that key exists', getWork(2, 'PEG'), { messages: ['scene2 breakdown'] });
t('getWork: scene 1 falls back to the old bare-char key when the scene-aware key is missing (pre-scenes save)',
  getWork(1, 'PEG'), { messages: ['pre-scenes breakdown'] });
t('getWork: no fallback for any OTHER scene — a pre-scenes save only ever meant scene 1',
  getWork(3, 'PEG'), null);
t('getWork: a character with no saved thread at all returns null, not a crash', getWork(1, 'LIAM'), null);
setCurName('');
setSessionWork({ 'demo|1::PEG': { messages: ['unsaved session draft'] } });
t('getWork: with no curName (an unsaved/demo session), reads from the in-memory session store instead of a saved script',
  getWork(1, 'PEG'), { messages: ['unsaved session draft'] });
setSessionWork({});

// --- currentSceneLines()/sceneText(): the scene-filter scoping logic that
// Rehearse/Read-Through (via currentSceneLines) and Scene Work's prompt
// (via sceneText) both depend on. A regression here means a rehearsal drill
// or a breakdown request silently pulls in the wrong scene's lines. ---
setSL([{ id: 0, scene: 1, char: 'A' }, { id: 1, scene: 2, char: 'B' }]);
setSceneFilter('all');
t('currentSceneLines: "all" returns every line regardless of scene', currentSceneLines().length, 2);
setSceneFilter(2);
t('currentSceneLines: filtered to one scene returns only that scene\'s lines', currentSceneLines(), [{ id: 1, scene: 2, char: 'B' }]);
setSceneFilter('all');

setSL([
  { scene: 1, char: 'PEG', direction: '', text: 'Vitals stable.', before: '', after: '', cut: false },
  { scene: 1, char: 'LIAM', direction: 'angry', text: 'Okay.', before: 'He stands.', after: '', cut: false },
  { scene: 1, char: 'CUT', direction: '', text: 'should not appear', before: '', after: '', cut: true },
]);
t('sceneText: joins a scene\'s lines with character/direction/before-after context, in order, excluding cut lines',
  sceneText(1), "PEG: Vitals stable.\nHe stands.\nLIAM (angry): Okay.");
t('sceneText: "all" matches a specific scene number when that\'s the only scene present', sceneText('all'), sceneText(1));

// --- logGroupKey(): which bucket a Coaching Log entry falls into for each of
// the four views (Date/Script/Genre/Pattern) — a regression here splits one
// script/genre/theme's notes into multiple repeated headers instead of one group. ---
setLogView('date');
t('logGroupKey date: formats the entry\'s timestamp as a human date',
  logGroupKey({ at: new Date('2026-03-05T12:00:00Z').getTime() }), 'Mar 5, 2026');
setLogView('script');
t('logGroupKey script: groups by the entry\'s tagged script name', logGroupKey({ scriptName: 'X.pdf' }), 'X.pdf');
t('logGroupKey script: an untagged (general) note groups under "General"', logGroupKey({}), 'General');
setLogView('genre');
setScriptsCache([{ name: 'X.pdf', genre: '  noir  ' }]);
t('logGroupKey genre: resolves the genre LIVE from the script\'s own current tag, trimmed — not a copy stored on the note',
  logGroupKey({ scriptName: 'X.pdf' }), 'noir');
t('logGroupKey genre: a tagged script with no genre set groups under "Ungenred"', logGroupKey({ scriptName: 'Y.pdf' }), 'Ungenred');
t('logGroupKey genre: a general (no scriptName) note also groups under "Ungenred"', logGroupKey({}), 'Ungenred');
setLogView('pattern');
t('logGroupKey pattern: groups by the entry\'s theme tag', logGroupKey({ theme: 'escalation' }), 'escalation');
t('logGroupKey pattern: an untagged note groups under "Untagged"', logGroupKey({}), 'Untagged');

// --- parsePretakeReply(): turns the model's reply for the pre-take card
// ("Draft for me") into {who,you,need}. craftLLM has no JSON-mode constraint,
// so replies can arrive bare, fenced, or wrapped in prose — and an unusable
// one must return null so the UI says so instead of filling empty fields. ---
t('parsePretakeReply: a bare JSON object parses',
  parsePretakeReply('{"who":"a nurse","you":"the doctor","need":"her to own it"}'),
  { who: 'a nurse', you: 'the doctor', need: 'her to own it' });
t('parsePretakeReply: JSON inside a ```json fence parses',
  parsePretakeReply('```json\n{"who":"a","you":"b","need":"c"}\n```'),
  { who: 'a', you: 'b', need: 'c' });
t('parsePretakeReply: JSON wrapped in chatty prose parses',
  parsePretakeReply('Sure! Here you go: {"who":"a","you":"b","need":"c"} Hope that helps.'),
  { who: 'a', you: 'b', need: 'c' });
t('parsePretakeReply: trims whitespace and turns non-string/missing fields into empty strings',
  parsePretakeReply('{"who":"  a  ","you":5}'),
  { who: 'a', you: '', need: '' });
t('parsePretakeReply: prose with no JSON at all is null', parsePretakeReply('Sure! Here you go.'), null);
t('parsePretakeReply: an object with every field empty is null (nothing usable to offer)', parsePretakeReply('{"who":"","you":"","need":""}'), null);
t('parsePretakeReply: malformed JSON is null, not a throw', parsePretakeReply('{"who": "a", '), null);
t('parsePretakeReply: empty/undefined reply is null, not a throw', parsePretakeReply(undefined), null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
