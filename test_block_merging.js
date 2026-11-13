/**
 * Unit tests for smart block merging logic (mergeProseLinesIfAppropriate) in offscreen.js
 */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');

// Read offscreen.js and extract the merging logic and regex constants
const offscreenPath = path.join(__dirname, 'offscreen.js');
const src = fs.readFileSync(offscreenPath, 'utf8');

const regexAndFuncMatch = src.match(/(const CJK_CHAR_REGEX[\s\S]*?function mergeProseLinesIfAppropriate[\s\S]*?\n\})/);
if (!regexAndFuncMatch) {
  console.error('FAIL: Could not locate mergeProseLinesIfAppropriate and its regex constants in offscreen.js');
  process.exit(1);
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(
  regexAndFuncMatch[1] + '\nglobalThis.mergeProseLinesIfAppropriate = mergeProseLinesIfAppropriate;\n' +
  'globalThis.LIST_MARKER_REGEX = LIST_MARKER_REGEX;',
  sandbox
);

const { mergeProseLinesIfAppropriate, LIST_MARKER_REGEX } = sandbox;

if (typeof mergeProseLinesIfAppropriate !== 'function') {
  console.error('FAIL: mergeProseLinesIfAppropriate was not properly extracted.');
  process.exit(1);
}

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

console.log('Running Smart Prose/List Block Merging Tests...\n');

// Prepare dummy segments matching the user's article image layout:
// - 1 Heading (large font)
// - 1 Intro paragraph (3 lines, with hyphenated word split)
// - 1 List item 1 (3 lines, bullet + hanging indent)
// - 1 List item 2 (3 lines, bullet + hanging indent)

const dummySegments = [
  // 1. Heading (large font: height = 36px)
  {
    text: 'Top-level Design of Next-Gen Architecture',
    confidence: 96,
    bbox: { x0: 50, y0: 20, x1: 650, y1: 56 }, // h = 36
    isMultiLine: false
  },

  // 2. Intro paragraph (3 lines, body font: height = 18px)
  {
    text: 'In this comprehensive guide, we explore modern methods to achieve opti-',
    confidence: 94,
    bbox: { x0: 50, y0: 80, x1: 700, y1: 98 }, // h = 18
    isMultiLine: false
  },
  {
    text: 'mal performance across distributed web systems while maintaining high',
    confidence: 93,
    bbox: { x0: 50, y0: 104, x1: 690, y1: 122 }, // h = 18, vGap = 6
    isMultiLine: false
  },
  {
    text: 'scalability and fault tolerance for enterprise workloads.',
    confidence: 95,
    bbox: { x0: 50, y0: 128, x1: 480, y1: 146 }, // h = 18, vGap = 6
    isMultiLine: false
  },

  // 3. List Item 1 (3 lines, starts with bullet '•', hanging indent)
  {
    text: '• Modular architecture with decoupled service boundaries allows teams',
    confidence: 92,
    bbox: { x0: 50, y0: 176, x1: 695, y1: 194 }, // h = 18
    isMultiLine: false
  },
  {
    text: 'to deploy independently without risking cross-service regression',
    confidence: 93,
    bbox: { x0: 70, y0: 200, x1: 690, y1: 218 }, // h = 18, hanging indent x0 = 70
    isMultiLine: false
  },
  {
    text: 'or cascading database connection pool exhaustion.',
    confidence: 91,
    bbox: { x0: 70, y0: 224, x1: 450, y1: 242 }, // h = 18, hanging indent x0 = 70
    isMultiLine: false
  },

  // 4. List Item 2 (3 lines, starts with bullet '•', hanging indent)
  {
    text: '• Event-driven messaging ensures resilient background data pipelines',
    confidence: 94,
    bbox: { x0: 50, y0: 260, x1: 685, y1: 278 }, // h = 18
    isMultiLine: false
  },
  {
    text: 'providing asynchronous decoupling and backpressure management',
    confidence: 92,
    bbox: { x0: 70, y0: 284, x1: 690, y1: 302 }, // h = 18, hanging indent x0 = 70
    isMultiLine: false
  },
  {
    text: 'across multiple consumer replicas in real time.',
    confidence: 95,
    bbox: { x0: 70, y0: 308, x1: 510, y1: 326 }, // h = 18, hanging indent x0 = 70
    isMultiLine: false
  }
];

const naturalWidth = 800;
const mergedResults = mergeProseLinesIfAppropriate(dummySegments, naturalWidth);

// Verification 1: Overall block count
runTest('1. 全体で想定通りの4ブロック（大見出し、導入、リスト1、リスト2）に統合されること', () => {
  assert.strictEqual(mergedResults.length, 4, `Expected 4 merged blocks, got ${mergedResults.length}`);
});

// Verification 2: 大見出しが単独の1ブロックになること
runTest('2. 大見出しがフォントサイズ比率（Heading vs Body）により単独ブロックとして保持されること', () => {
  const headingBlock = mergedResults[0];
  assert.strictEqual(headingBlock.text, 'Top-level Design of Next-Gen Architecture');
  assert.strictEqual(headingBlock.isMultiLine, false);
  assert.strictEqual(headingBlock.bbox.y0, 20);
  assert.strictEqual(headingBlock.bbox.y1, 56);
});

// Verification 3: 導入段落の3行が1つのまとまり（isMultiLine: true）になること
runTest('3. 導入段落の3行が1つのまとまり（isMultiLine: true）に結合され、bounding boxが正しく拡張されること', () => {
  const introBlock = mergedResults[1];
  assert.strictEqual(introBlock.isMultiLine, true);
  assert.strictEqual(introBlock.bbox.x0, 50);
  assert.strictEqual(introBlock.bbox.y0, 80);
  assert.strictEqual(introBlock.bbox.x1, 700);
  assert.strictEqual(introBlock.bbox.y1, 146);
  assert.ok(introBlock.text.startsWith('In this comprehensive guide'));
  assert.ok(introBlock.text.endsWith('for enterprise workloads.'));
});

// Verification 4: ハイフンで切れた単語（opti- と mal）が optimal として正しく結合されること
runTest('4. 行末ハイフンで分割された英単語（opti- + mal）が「optimal」として正しく結合されること', () => {
  const introBlock = mergedResults[1];
  assert.ok(introBlock.text.includes('achieve optimal performance'),
    `Expected "achieve optimal performance", but got: "${introBlock.text}"`);
  assert.ok(!introBlock.text.includes('opti-'), 'Hyphen should be removed');
  assert.ok(!introBlock.text.includes('opti mal'), 'Should not contain a space inside optimal');
});

// Verification 5: リスト項目1（• ...）の複数行が1つのまとまりになり、リスト項目2（• ...）とは混ざらないこと
runTest('5. リスト項目1の3行がぶら下げインデントを維持して1つにまとまり、リスト項目2とは混ざらないこと', () => {
  const list1Block = mergedResults[2];
  assert.strictEqual(list1Block.isMultiLine, true);
  assert.ok(list1Block.text.startsWith('• Modular architecture'));
  assert.ok(list1Block.text.endsWith('connection pool exhaustion.'));
  assert.strictEqual(list1Block.bbox.x0, 50);
  assert.strictEqual(list1Block.bbox.y0, 176);
  assert.strictEqual(list1Block.bbox.y1, 242);

  // Must NOT contain text from list item 2
  assert.ok(!list1Block.text.includes('Event-driven messaging'), 'List 1 should not contain List 2 text');
});

// Verification 6: リスト項目2の複数行が独立した1つのまとまりになること
runTest('6. リスト項目2の複数行が先頭記号（LIST_MARKER_REGEX）により分割され、独立した1つのまとまりになること', () => {
  const list2Block = mergedResults[3];
  assert.strictEqual(list2Block.isMultiLine, true);
  assert.ok(list2Block.text.startsWith('• Event-driven messaging'));
  assert.ok(list2Block.text.endsWith('in real time.'));
  assert.strictEqual(list2Block.bbox.x0, 50);
  assert.strictEqual(list2Block.bbox.y0, 260);
  assert.strictEqual(list2Block.bbox.y1, 326);

  // Must NOT contain text from list item 1
  assert.ok(!list2Block.text.includes('Modular architecture'), 'List 2 should not contain List 1 text');
});

console.log(`\nTest Summary: ${passCount} passed, ${failCount} failed.`);
if (failCount > 0) {
  process.exit(1);
} else {
  console.log('All block merging tests passed successfully!');
}
