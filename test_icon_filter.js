/**
 * Unit tests for multi-layered icon noise filtering logic:
 *   - isLikelyIconArtifactSegment in offscreen.js
 *   - isNoiseText in ndlocr_engine.js
 */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');

// 1. Extract isLikelyIconArtifactSegment from offscreen.js
const offscreenSrc = fs.readFileSync(path.join(__dirname, 'offscreen.js'), 'utf8');
const matchOffscreen = offscreenSrc.match(/(const ICON_NOISE_CHAR_REGEX[\s\S]*?function isLikelyIconArtifactSegment[\s\S]*?\n\})/);
if (!matchOffscreen) {
  console.error('FAIL: Could not locate isLikelyIconArtifactSegment in offscreen.js');
  process.exit(1);
}
const sandboxOff = {};
vm.createContext(sandboxOff);
vm.runInContext(matchOffscreen[1] + '\nglobalThis.isLikelyIconArtifactSegment = isLikelyIconArtifactSegment;', sandboxOff);
const isLikelyIconArtifactSegment = sandboxOff.isLikelyIconArtifactSegment;

// 2. Extract isNoiseText from ndlocr_engine.js
const ndlSrc = fs.readFileSync(path.join(__dirname, 'ndlocr_engine.js'), 'utf8');
const matchNdl = ndlSrc.match(/(const VALID_ONE_LETTER_WORDS[\s\S]*?function isNoiseText[\s\S]*?\n  \})/);
if (!matchNdl) {
  console.error('FAIL: Could not locate isNoiseText in ndlocr_engine.js');
  process.exit(1);
}
const sandboxNdl = {};
vm.createContext(sandboxNdl);
vm.runInContext(matchNdl[1] + '\nglobalThis.isNoiseText = isNoiseText;', sandboxNdl);
const isNoiseText = sandboxNdl.isNoiseText;

let passCount = 0;
let failCount = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passCount++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failCount++;
  }
}

console.log('Running Icon Filter & Noise Rejection Unit Tests...\n');

// Standard bounding boxes for testing
const squareBbox = { x0: 10, y0: 10, x1: 30, y1: 30 }; // 20x20, aspect = 1.0 (typical icon)
const wideBbox = { x0: 10, y0: 10, x1: 90, y1: 30 };   // 80x20, aspect = 4.0 (text word)
const lineSquare = { x0: 10, y0: 10, x1: 30, y1: 30 }; // for ndlocr line bbox

// --- TEST SET 1: isLikelyIconArtifactSegment (offscreen.js) ---

runTest('1a. offscreen.js: 単独のアイコン誤認識文字（Q, o, O, x, X, v, V, d, l, m）が除外（true）されること', () => {
  const badSingles = ['Q', 'o', 'O', 'x', 'X', 'v', 'V', 'd', 'l', 'm'];
  for (const ch of badSingles) {
    const res = isLikelyIconArtifactSegment(ch, squareBbox, 75, false);
    assert.strictEqual(res, true, `Expected '${ch}' to be discarded (true), but got ${res}`);
  }
});

runTest('1b. offscreen.js: 記号・矢印などの非文字トークン（=, >>, ///）が除外（true）されること', () => {
  const badSymbols = ['=', '>>', '///', '===', '++'];
  for (const sym of badSymbols) {
    const res = isLikelyIconArtifactSegment(sym, squareBbox, 70, false);
    assert.strictEqual(res, true, `Expected '${sym}' to be discarded (true), but got ${res}`);
  }
});

runTest('1c. offscreen.js: アイコンから誤読された正方形短トークン（oG, pV, =n）が除外（true）されること', () => {
  const iconArtifacts = ['oG', 'pV', '=n'];
  for (const token of iconArtifacts) {
    const res = isLikelyIconArtifactSegment(token, squareBbox, 72, false);
    assert.strictEqual(res, true, `Expected '${token}' to be discarded (true), but got ${res}`);
  }
});

runTest('2a. offscreen.js: 正当な英単語（I, A, a, is, in, to, it, AI, UI, OK など）が保持（false）されること', () => {
  const validWords = ['I', 'A', 'a', 'is', 'in', 'to', 'it', 'AI', 'UI', 'OK', 'tv', 'we', 'no', 'Home', 'Search'];
  for (const word of validWords) {
    const res = isLikelyIconArtifactSegment(word, wideBbox, 85, false);
    assert.strictEqual(res, false, `Expected legitimate word '${word}' to be kept (false), but got ${res}`);
  }
});

runTest('2b. offscreen.js: 日本語の文字・単語（設定, 検索, あ, 漢 など）が保持（false）されること', () => {
  const jpWords = ['設定', '検索', 'あ', '日本語', '漢字', '図', '車'];
  for (const word of jpWords) {
    const res = isLikelyIconArtifactSegment(word, wideBbox, 85, true);
    assert.strictEqual(res, false, `Expected Japanese '${word}' to be kept (false), but got ${res}`);
  }
});

runTest('2c. offscreen.js: リストマーカー（•, 1., -, 2) など）が保持（false）されること', () => {
  const markers = ['•', '1.', '-', '2)', '(a)', 'A.'];
  for (const marker of markers) {
    const res = isLikelyIconArtifactSegment(marker, squareBbox, 90, false);
    assert.strictEqual(res, false, `Expected list marker '${marker}' to be kept (false), but got ${res}`);
  }
});

// --- TEST SET 2: isNoiseText (ndlocr_engine.js) ---

runTest('3a. ndlocr_engine.js: 単独のアイコン誤認識文字（Q, o, O, x, X, v, V, d, l, m）が除外（true）されること', () => {
  const badSingles = ['Q', 'o', 'O', 'x', 'X', 'v', 'V', 'd', 'l', 'm'];
  for (const ch of badSingles) {
    const res = isNoiseText(ch, lineSquare, 0.70);
    assert.strictEqual(res, true, `Expected '${ch}' to be discarded by ndlocr isNoiseText, but got ${res}`);
  }
});

runTest('3b. ndlocr_engine.js: 記号・非文字（=, >>, ……, 0000000）が除外（true）されること', () => {
  const badSymbols = ['=', '>>', '……', '0000000'];
  for (const sym of badSymbols) {
    const res = isNoiseText(sym, lineSquare, 0.65);
    assert.strictEqual(res, true, `Expected '${sym}' to be discarded by ndlocr isNoiseText, but got ${res}`);
  }
});

runTest('3c. ndlocr_engine.js: 正方形状の低信頼度アイコン誤認識（oG）が除外（true）されること', () => {
  const res = isNoiseText('oG', lineSquare, 0.68);
  assert.strictEqual(res, true, `Expected 'oG' on near-square line to be discarded by ndlocr, but got ${res}`);
});

runTest('4a. ndlocr_engine.js: 正当な英単語（I, A, a, is, in, to, it, AI, UI, OK など）が保持（false）されること', () => {
  const validWords = ['I', 'A', 'a', 'is', 'in', 'to', 'it', 'AI', 'UI', 'OK', 'Search', 'Next'];
  for (const word of validWords) {
    const res = isNoiseText(word, lineSquare, 0.90);
    assert.strictEqual(res, false, `Expected legitimate word '${word}' to be kept by ndlocr, but got ${res}`);
  }
});

runTest('4b. ndlocr_engine.js: 日本語（あ, 日本語, 設定, 検索）が保持（false）されること', () => {
  const jpWords = ['あ', '日本語', '設定', '検索'];
  for (const word of jpWords) {
    const res = isNoiseText(word, lineSquare, 0.90);
    assert.strictEqual(res, false, `Expected Japanese '${word}' to be kept by ndlocr, but got ${res}`);
  }
});

console.log(`\nTest Summary: ${passCount} passed, ${failCount} failed.`);
if (failCount > 0) {
  process.exit(1);
} else {
  console.log('All icon filter tests passed successfully!');
}
