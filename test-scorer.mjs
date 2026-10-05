// Regression tests for the rehearsal line-scorer (norm/tokenize/lev/wordsClose/
// lcs/bestMatches/chk/dYou/dScr) in index.html. No test framework, no build
// step — matches the app's own "single static file" philosophy. Run with:
//   node test-scorer.mjs
//
// It extracts the ACTUAL current implementation straight out of index.html
// (not a hand-copied duplicate) so this can never silently drift from the
// real code. If chk() starts mis-scoring a line as right when it was wrong
// (or vice versa) with no crash to warn you, this is what would catch it.
// Same for dYou()/dScr() — the word-by-word green/red highlighting shown
// after every rehearsed line. They index into bestMatches()'s output
// independently (matchedA from m[0], matchedB from m[1]) rather than sharing
// chk()'s pass/fail math, so a correct chk() verdict doesn't guarantee the
// highlighting shown alongside it is correct.

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

// Extracts one top-level `function name(...){...}` body verbatim — same
// one-liner-or-column-0-close heuristic as test-scenes.mjs's extractFn.
// Used for esc/dYou/dScr, which sit further down the file than chk().
function extractFn(name) {
  const fstart = src.indexOf(`function ${name}(`);
  if (fstart === -1) throw new Error(`Could not find function ${name}() in index.html — renamed or moved?`);
  const openBrace = src.indexOf('{', fstart);
  const nextNewline = src.indexOf('\n', openBrace);
  const sameLineClose = src.indexOf('}', openBrace);
  let end;
  if (sameLineClose !== -1 && (nextNewline === -1 || sameLineClose < nextNewline)) {
    end = sameLineClose + 1;
  } else {
    const closeAtCol0 = src.indexOf('\n}', openBrace);
    if (closeAtCol0 === -1) throw new Error(`Could not find the end of ${name}() — did its formatting change?`);
    end = closeAtCol0 + 2;
  }
  return src.slice(fstart, end);
}
const dyeSrc = `${scorerSrc}\n${extractFn('esc')}\n${extractFn('dYou')}\n${extractFn('dScr')}`;

let mode = 'word'; // chk()/dYou()/dScr() read this as a free variable, same as they do live in the app
const scope = new Function('mode', `${dyeSrc}\nreturn {norm,tokenize,lev,wordsClose,weq,lcs,bestMatches,chk,dYou,dScr};`);
const { norm, tokenize, lev, wordsClose, chk, dYou, dScr } = scope(mode);
// chk()/dYou()/dScr() close over `mode` as a free variable at call time via
// the Function's own scope — since we can't mutate that closure's `mode`
// from out here, re-derive fresh whenever a test needs a different mode.
function chkWithMode(m, s, c) {
  return new Function('mode', `${scorerSrc}\nreturn chk(${JSON.stringify(s)}, ${JSON.stringify(c)});`)(m);
}
function dYouWithMode(m, s, c) {
  return new Function('mode', `${dyeSrc}\nreturn dYou(${JSON.stringify(s)}, ${JSON.stringify(c)});`)(m);
}
function dScrWithMode(m, s, c) {
  return new Function('mode', `${dyeSrc}\nreturn dScr(${JSON.stringify(s)}, ${JSON.stringify(c)});`)(m);
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

// --- dYou()/dScr(): the word-by-word <span class="wo/ww/wf"> highlighting
// shown after every rehearsed line. Verified against the real extracted
// functions first (node, by hand), then pinned here — these build matchedA/
// matchedB from bestMatches()'s [spoken-index, script-index] pairs
// independently of chk(), so a passing chk() verdict doesn't guarantee this
// highlighting is right. ---
t('dYou word mode: verbatim marks every word right (wo)',
  dYouWithMode('word', LINE, LINE),
  '<span class="wo">You </span><span class="wo">said </span><span class="wo">you&#39;d </span><span class="wo">be </span><span class="wo">here </span><span class="wo">an </span><span class="wo">hour </span><span class="wo">ago. </span>');

t('dYou word mode: a dropped trailing word leaves the spoken words that ARE there marked right',
  dYouWithMode('word', "You said you'd be here an hour.", LINE),
  '<span class="wo">You </span><span class="wo">said </span><span class="wo">you&#39;d </span><span class="wo">be </span><span class="wo">here </span><span class="wo">an </span><span class="wo">hour. </span>');
t('dScr word mode: the script word she never said is flagged missing (wf), not silently matched',
  dScrWithMode('word', "You said you'd be here an hour.", LINE),
  '<span class="wo">You </span><span class="wo">said </span><span class="wo">you&#39;d </span><span class="wo">be </span><span class="wo">here </span><span class="wo">an </span><span class="wo">hour </span><span class="wf">ago. </span>');

t('dYou word mode: a totally different reading marks every spoken word wrong (ww)',
  dYouWithMode('word', 'Nothing like that at all.', LINE),
  '<span class="ww">Nothing </span><span class="ww">like </span><span class="ww">that </span><span class="ww">at </span><span class="ww">all. </span>');
t('dScr word mode: with nothing matched, every script word is flagged missing',
  dScrWithMode('word', 'Nothing like that at all.', LINE),
  '<span class="wf">You </span><span class="wf">said </span><span class="wf">you&#39;d </span><span class="wf">be </span><span class="wf">here </span><span class="wf">an </span><span class="wf">hour </span><span class="wf">ago. </span>');

t('dYou word mode: a Whisper-style mishearing ("our" for "hour") is marked right on BOTH sides, not flagged as a miss',
  dYouWithMode('word', "You said you'd be here an our ago.", LINE),
  '<span class="wo">You </span><span class="wo">said </span><span class="wo">you&#39;d </span><span class="wo">be </span><span class="wo">here </span><span class="wo">an </span><span class="wo">our </span><span class="wo">ago. </span>');
t('dScr word mode: the fuzzy-matched script word is marked right, not missing',
  dScrWithMode('word', "You said you'd be here an our ago.", LINE),
  '<span class="wo">You </span><span class="wo">said </span><span class="wo">you&#39;d </span><span class="wo">be </span><span class="wo">here </span><span class="wo">an </span><span class="wo">hour </span><span class="wo">ago. </span>');

// A leading extra word shifts every later spoken-word index one ahead of its
// matching script-word index (spoken[1]="you" matches script[0]="you", etc).
// This is the case that would actually catch matchedA/matchedB being built
// from the wrong element of bestMatches()'s [a,b] pairs — in every case
// above, the matched spoken/script indices happen to coincide, so a swapped
// index lookup would accidentally still "work".
const SPOKEN_WITH_LEADING_EXTRA = "Well you said you'd be here an hour ago.";
t('dYou word mode: an inserted leading word is marked wrong even though every later word\'s index is now offset from the script\'s',
  dYouWithMode('word', SPOKEN_WITH_LEADING_EXTRA, LINE),
  '<span class="ww">Well </span><span class="wo">you </span><span class="wo">said </span><span class="wo">you&#39;d </span><span class="wo">be </span><span class="wo">here </span><span class="wo">an </span><span class="wo">hour </span><span class="wo">ago. </span>');
t('dScr word mode: despite that index offset, every real script word is still correctly matched, none wrongly flagged missing',
  dScrWithMode('word', SPOKEN_WITH_LEADING_EXTRA, LINE),
  '<span class="wo">You </span><span class="wo">said </span><span class="wo">you&#39;d </span><span class="wo">be </span><span class="wo">here </span><span class="wo">an </span><span class="wo">hour </span><span class="wo">ago. </span>');

t('dYou: HTML special characters in a word are escaped, not injected raw into the rendered span',
  dYouWithMode('word', 'Rock & roll is <loud>.', 'Rock & roll is <loud>.'),
  '<span class="wo">Rock </span><span class="wo">&amp; </span><span class="wo">roll </span><span class="wo">is </span><span class="wo">&lt;loud&gt;. </span>');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
