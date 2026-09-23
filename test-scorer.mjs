// Regression tests for the rehearsal line-scorer (norm/tokenize/lev/wordsClose/
// lcs/bestMatches/chk) in index.html. No test framework, no build step — matches
// the app's own "single static file" philosophy. Run with:
//   node test-scorer.mjs
//
// It extracts the ACTUAL current implementation straight out of index.html
// (not a hand-copied duplicate) so this can never silently drift from the
// real code. If chk() starts mis-scoring a line as right when it was wrong
// (or vice versa) with no crash to warn you, this is what would catch it.

import { readFileSync } from 'fs';

const src = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

const start = src.indexOf('function norm(s){');
const chkStart = src.indexOf('\nfunction chk(s,c){');
if (start === -1 || chkStart === -1) {
  console.error('Could not find the scorer functions in index.html — did they get renamed or moved?');
  process.exit(1);
}
// chk(s,c) has no nested braces in its own body, so the first close-brace
// after its opening one is its end — but find it by counting, not guessing,
// so this still works if the body ever grows a nested block.
let i = src.indexOf('{', chkStart), depth = 0, chkEnd = -1;
for (; i < src.length; i++) {
  if (src[i] === '{') depth++;
  else if (src[i] === '}') { depth--; if (depth === 0) { chkEnd = i + 1; break; } }
}
if (chkEnd === -1) { console.error('Could not find the end of chk() — brace mismatch?'); process.exit(1); }

const scorerSrc = src.slice(start, chkEnd);
let mode = 'word'; // chk() reads this as a free variable, same as it does live in the app
const scope = new Function('mode', `${scorerSrc}\nreturn {norm,tokenize,lev,wordsClose,weq,lcs,bestMatches,chk};`);
const { norm, tokenize, lev, wordsClose, chk } = scope(mode);
// chk() closes over `mode` as a free variable at call time via the Function's
// own scope — since we can't mutate that closure's `mode` from out here,
// re-derive chk fresh whenever a test needs a different mode.
function chkWithMode(m, s, c) {
  return new Function('mode', `${scorerSrc}\nreturn chk(${JSON.stringify(s)}, ${JSON.stringify(c)});`)(m);
}

let pass = 0, fail = 0;
function t(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; }
  else { fail++; console.error(`✗ ${desc}\n    expected: ${JSON.stringify(expected)}\n    got:      ${JSON.stringify(actual)}`); }
}

// --- norm(): the normalization every comparison is built on ---
t('norm lowercases', norm('HELLO'), 'hello');
t('norm strips curly apostrophe', norm("don’t"), 'dont');
t('norm strips straight apostrophe', norm("don't"), 'dont');
t('norm strips punctuation', norm('Hi! Are you there?'), 'hi are you there');
t('norm collapses em-dash to space', norm('Don—stop'), 'don stop');
t('norm collapses whitespace', norm('  hi   there  '), 'hi there');

// --- tokenize(): display vs normalized word pairing ---
t('tokenize keeps display casing, normalizes match form', tokenize("Don't stop.").map(w=>w.n), ['dont','stop']);
t('tokenize drops empty tokens', tokenize('  ').length, 0);

// --- lev(): edit distance ---
t('lev identical strings', lev('thing','thing'), 0);
t('lev one substitution', lev('thing','thang'), 1);
t('lev empty vs word', lev('','thing'), 5);

// --- wordsClose(): the fuzzy-typo/dialect tolerance ---
t('wordsClose exact match', wordsClose('thing','thing'), true);
t('wordsClose one-letter slip counts (dialect/Whisper slip)', wordsClose('thing','thang'), true);
t('wordsClose totally different words do not match', wordsClose('thing','purple'), false);
t('wordsClose short words (<3 chars) never fuzzy-match — avoids "a"≈"I" noise', wordsClose('a','i'), false);
t('wordsClose short words still match if identical', wordsClose('to','to'), true);

// --- chk(): the actual pass/fail gate evalLine() uses ---
const LINE = "You said you'd be here an hour ago.";

t('chk exact mode: verbatim passes', chkWithMode('exact', LINE, LINE), true);
t('chk exact mode: contraction spelled out still counts (norm strips apostrophes first)',
  chkWithMode('exact', "You said you'd be here an hour ago.", "You said youd be here an hour ago."), true);
t('chk exact mode: a genuinely different line fails', chkWithMode('exact', 'Nothing like that at all.', LINE), false);

t('chk word mode: verbatim passes', chkWithMode('word', LINE, LINE), true);
t('chk word mode: one dropped word near the end still passes (>=82% of words matched)',
  chkWithMode('word', "You said you'd be here an hour.", LINE), true);
t('chk word mode: several missing words fails', chkWithMode('word', "You said you'd be here.", LINE), false);
t('chk word mode: a Whisper-style mishearing on one word still passes',
  chkWithMode('word', "You said you'd be here an our ago.", LINE), true);

// 6 of 8 script words matched (dropped "you'd"/"be") = 0.75 — below word
// mode's 0.82 bar, above phrase mode's 0.65 bar. Verified by hand against
// the actual match count before asserting, not guessed.
const TWO_WORDS_DROPPED = 'You said here an hour ago.';
t('chk word mode: 2 of 8 words dropped (75% match) fails the stricter 82% bar',
  chkWithMode('word', TWO_WORDS_DROPPED, LINE), false);
t('chk phrase mode: same 75% match passes the looser 65% bar',
  chkWithMode('phrase', TWO_WORDS_DROPPED, LINE), true);

t('chk empty spoken input never crashes and fails cleanly', chkWithMode('word', '', LINE), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
