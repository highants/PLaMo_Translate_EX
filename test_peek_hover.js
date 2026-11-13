/**
 * Static CSS & JS contract tests for peek-original hover visibility
 * in content.css and content.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const css = fs.readFileSync(path.join(__dirname, 'content.css'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');

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

console.log('Running Peek-Original Hover CSS & JS Contract Tests...\n');

// 1. Base .plamo-ext-image-overlay-box keeps pointer-events: auto;
runTest('1. .plamo-ext-image-overlay-box keeps pointer-events: auto', () => {
  const baseMatch = css.match(/(?:^|\r?\n)\.plamo-ext-image-overlay-box\s*\{([^}]*)\}/);
  assert.ok(baseMatch, 'Could not find base .plamo-ext-image-overlay-box rule in content.css');
  assert.match(baseMatch[1], /pointer-events:\s*auto\s*;/, 'Base box rule must keep pointer-events: auto;');
});

// 2. Base :hover rule includes opacity: 1 and z-index: 25
runTest('2. .plamo-ext-image-overlay-box:hover includes opacity: 1 and z-index: 25', () => {
  const hoverMatch = css.match(
    /\.plamo-ext-image-overlay-box:hover\s*,\s*[\r\n]+\s*\.plamo-ext-image-overlay-box\.is-single-line:hover\s*\{([^}]*)\}/
  );
  assert.ok(hoverMatch, 'Could not find .plamo-ext-image-overlay-box:hover rule block in content.css');
  assert.match(hoverMatch[1], /opacity:\s*1\s*;/, 'Hover rule must set opacity: 1;');
  assert.match(hoverMatch[1], /z-index:\s*25\s*;/, 'Hover rule must set z-index: 25;');
});

// 3. .is-peek-original dims boxes to opacity: 0.08
runTest('3. .is-peek-original sets .plamo-ext-image-overlay-box opacity: 0.08', () => {
  const peekMatch = css.match(
    /\.plamo-ext-image-overlay-container\.is-peek-original\s+\.plamo-ext-image-overlay-box\s*\{([^}]*)\}/
  );
  assert.ok(peekMatch, 'Could not find .is-peek-original box rule in content.css');
  assert.match(peekMatch[1], /opacity:\s*0\.08\s*;/, 'Peek rule must set opacity: 0.08;');
});

// 4. .is-peek-original hover/focus-within/focus-visible override appears AFTER the 0.08 rule and sets opacity: 1
runTest('4. .is-peek-original hover & focus override appears after 0.08 rule and restores opacity: 1', () => {
  const peekBasePattern = /\.plamo-ext-image-overlay-container\.is-peek-original\s+\.plamo-ext-image-overlay-box\s*\{[^}]*\}/;
  const peekHoverPattern = new RegExp(
    '\\.plamo-ext-image-overlay-container\\.is-peek-original\\s+\\.plamo-ext-image-overlay-box:hover\\s*,\\s*[\\r\\n]+\\s*' +
    '\\.plamo-ext-image-overlay-container\\.is-peek-original\\s+\\.plamo-ext-image-overlay-box\\.is-single-line:hover\\s*,\\s*[\\r\\n]+\\s*' +
    '(?:\\.plamo-ext-image-overlay-container\\.is-peek-original\\s+\\.plamo-ext-image-overlay-box:focus-within\\s*,\\s*[\\r\\n]+\\s*)?' +
    '\\.plamo-ext-image-overlay-container\\.is-peek-original\\s+\\.plamo-ext-image-overlay-box:focus-visible\\s*\\{([^}]*)\\}'
  );

  const peekBaseMatch = css.match(peekBasePattern);
  const peekHoverMatch = css.match(peekHoverPattern);
  assert.ok(peekBaseMatch, 'Could not find .is-peek-original base rule in content.css');
  assert.ok(peekHoverMatch, 'Could not find .is-peek-original :hover / .is-single-line:hover / :focus-within / :focus-visible override rule in content.css');
  assert.match(peekHoverMatch[1], /opacity:\s*1\s*;/, 'Peek hover/focus override must set opacity: 1;');
  assert.ok(
    peekBaseMatch.index < peekHoverMatch.index,
    'Peek base rule (opacity: 0.08) must appear BEFORE hover/focus override rule (opacity: 1)'
  );
});

// 5. content.js includes data-action="peek" button and toggles is-peek-original
runTest('5. content.js defines data-action="peek" and toggles is-peek-original', () => {
  assert.ok(js.includes('data-action="peek"'), 'content.js must include data-action="peek" control');
  const peekHandlerMatch = js.match(/else\s+if\s*\(\s*action\s*===\s*'peek'\s*\)\s*\{([\s\S]*?)\}\s*else\s+if/);
  assert.ok(peekHandlerMatch, 'Could not find action === "peek" handler in content.js');
  assert.match(
    peekHandlerMatch[1],
    /container\.classList\.toggle\(\s*'is-peek-original'\s*,\s*isPeekingOriginal\s*\)/,
    'peek handler must toggle is-peek-original on container'
  );
});

console.log(`\nTest Summary: ${passCount} passed, ${failCount} failed.`);
if (failCount > 0) {
  process.exit(1);
} else {
  console.log('All peek-original hover checks passed successfully!');
}
