// Regression tests for scene-boundary logic in index.html: recomputeScenes()
// (the derive-scenes-from-sceneStart-flags engine everything else sits on —
// the script view, Scene Work, Audio Export, and the merge/undo-merge pair
// added this session all depend on it), sceneFingerprint() (what decides
// whether a re-uploaded revision's scene matches an old saved one closely
// enough to carry its Scene Work forward — a wrong match silently misattaches
// one scene's breakdown to a different scene, worse than losing it outright),
// and cleanChar() (character-name cleanup feeding line grouping/coloring).
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

const scope = new Function(`
  ${extractFn('norm')}
  ${extractFn('cleanChar')}
  ${extractFn('sceneFingerprint')}
  let SL;
  ${extractFn('recomputeScenes')}
  return { norm, cleanChar, sceneFingerprint, recomputeScenes, setSL: v => SL = v, getSL: () => SL };
`)();
const { cleanChar, sceneFingerprint, setSL, getSL, recomputeScenes } = scope;

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
