/**
 * Unit tests for leading icon artifact cleansing (stripLeadingIconArtifacts)
 * Covers:
 *   - offscreen.js: stripLeadingIconArtifacts
 *   - ndlocr_engine.js: stripLeadingIconArtifacts
 */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');

// Extract stripLeadingIconArtifacts from offscreen.js
const offscreenSrc = fs.readFileSync(path.join(__dirname, 'offscreen.js'), 'utf8');
const matchOff = offscreenSrc.match(/(const LEADING_ICON_ARTIFACT_REGEX[\s\S]*?function stripLeadingIconArtifacts[\s\S]*?\n\})/);
if (!matchOff) {
  console.error('FAIL: Could not locate stripLeadingIconArtifacts in offscreen.js');
  process.exit(1);
}
const sandboxOff = {};
vm.createContext(sandboxOff);
vm.runInContext(matchOff[1] + '\nglobalThis.stripLeadingIconArtifacts = stripLeadingIconArtifacts;', sandboxOff);
const stripOffscreen = sandboxOff.stripLeadingIconArtifacts;

// Extract stripLeadingIconArtifacts from ndlocr_engine.js
const ndlSrc = fs.readFileSync(path.join(__dirname, 'ndlocr_engine.js'), 'utf8');
const matchNdl = ndlSrc.match(/(const LEADING_BULLET_REGEX[\s\S]*?function stripLeadingIconArtifacts[\s\S]*?\n  \})/);
if (!matchNdl) {
  console.error('FAIL: Could not locate stripLeadingIconArtifacts in ndlocr_engine.js');
  process.exit(1);
}
const sandboxNdl = {};
vm.createContext(sandboxNdl);
vm.runInContext(matchNdl[1] + '\nglobalThis.stripLeadingIconArtifacts = stripLeadingIconArtifacts;', sandboxNdl);
const stripNdl = sandboxNdl.stripLeadingIconArtifacts;

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

console.log('Running Leading Icon Cleansing Unit Tests...\n');

const cleanCases = [
  { input: 'Q 検索', expected: '検索' },
  { input: 'Q検索', expected: '検索' },
  { input: '8= リスト', expected: 'リスト' },
  { input: '② プロフィール', expected: 'プロフィール' },
  { input: 'Q Search', expected: 'Search' },
  { input: '8= List', expected: 'List' },
  { input: '② Profile', expected: 'Profile' },
  { input: 'o Settings', expected: 'Settings' },
  { input: 'x Close', expected: 'Close' }
];

const preserveCases = [
  'Q. 質問',
  'Q: 問い合わせ',
  'Q&A',
  '1. はじめに',
  'A. 選択肢',
  '(1) 概要',
  'A book',
  'I have a dream',
  'Tシャツ',
  '# Feed'
];

// Test Suite 1: offscreen.js implementation
runTest('1. offscreen.js: ユーザー画像で発生していた先頭アイコン誤認が綺麗にクレンジングされること', () => {
  for (const { input, expected } of cleanCases) {
    const actual = stripOffscreen(input);
    assert.strictEqual(actual, expected, `offscreen: expected '${input}' -> '${expected}', but got '${actual}'`);
  }
});

runTest('2. offscreen.js: 正当なテキスト・記号プレフィックスが誤って削られず保持されること', () => {
  for (const text of preserveCases) {
    const actual = stripOffscreen(text);
    assert.strictEqual(actual, text, `offscreen: expected '${text}' to be preserved, but got '${actual}'`);
  }
});

// Test Suite 2: ndlocr_engine.js implementation
runTest('3. ndlocr_engine.js: ユーザー画像で発生していた先頭アイコン誤認が綺麗にクレンジングされること', () => {
  for (const { input, expected } of cleanCases) {
    const actual = stripNdl(input);
    assert.strictEqual(actual, expected, `ndlocr: expected '${input}' -> '${expected}', but got '${actual}'`);
  }
});

runTest('4. ndlocr_engine.js: 正当なテキスト・記号プレフィックスが誤って削られず保持されること', () => {
  for (const text of preserveCases) {
    const actual = stripNdl(text);
    assert.strictEqual(actual, text, `ndlocr: expected '${text}' to be preserved, but got '${actual}'`);
  }
});

console.log(`\nTest Summary: ${passCount} passed, ${failCount} failed.`);
if (failCount > 0) {
  process.exit(1);
} else {
  console.log('All leading icon cleansing tests passed successfully!');
}
