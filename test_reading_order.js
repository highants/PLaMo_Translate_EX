/**
 * Unit tests for NDLOCR reading order sorting logic (ndlocr_engine.js)
 */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');

// Load ndlocr_engine.js in sandbox
const scriptPath = path.join(__dirname, 'ndlocr_engine.js');
let code = fs.readFileSync(scriptPath, 'utf8');

// Expose internal functions for unit testing
code = code.replace(
  /global\.NdlOcrEngine\s*=\s*\{[^}]+\};/,
  'global.NdlOcrEngine = { recognize, isAvailable, detectVisualBulletLeftOfLine, sortReadingOrder, sortVerticalLines, sortHorizontalLines, isLineVertical };'
);

const sandbox = {
  self: {},
  document: { createElement: () => ({}) },
  Image: class {},
  chrome: { runtime: { getURL: (p) => p } }
};

vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const { sortReadingOrder, isLineVertical } = sandbox.self.NdlOcrEngine;

if (typeof sortReadingOrder !== 'function') {
  console.error('FAIL: sortReadingOrder function was not exported.');
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

console.log('Running NDLOCR Reading Order Sorting Tests...\n');

// 1. 縦書き3列: 右列 -> 中央列 -> 左列
runTest('1. 縦書き3列が右から左（右列 -> 中央列 -> 左列）にソートされること', () => {
  const rightCol = { id: 'col_right', x0: 200, y0: 0, x1: 220, y1: 100 };
  const centerCol = { id: 'col_center', x0: 100, y0: 0, x1: 120, y1: 100 };
  const leftCol = { id: 'col_left', x0: 0, y0: 0, x1: 20, y1: 100 };

  // All must be identified as vertical
  assert.strictEqual(isLineVertical(rightCol), true, 'rightCol should be vertical');
  assert.strictEqual(isLineVertical(centerCol), true, 'centerCol should be vertical');
  assert.strictEqual(isLineVertical(leftCol), true, 'leftCol should be vertical');

  const input = [leftCol, rightCol, centerCol];
  const sorted = sortReadingOrder(input);
  const ids = Array.from(sorted.map((l) => l.id));

  assert.strictEqual(JSON.stringify(ids), JSON.stringify(['col_right', 'col_center', 'col_left']));
});

// 2. 同一列内の分割行: 上行 -> 下行
runTest('2a. 同一列内の分割行が上から下（上行 -> 下行）にソートされること (単一列)', () => {
  const top = { id: 'split_top', x0: 100, y0: 0, x1: 120, y1: 50 };
  const bottom = { id: 'split_bottom', x0: 100, y0: 60, x1: 120, y1: 100 };

  assert.strictEqual(isLineVertical(top), true, 'top should be vertical');
  assert.strictEqual(isLineVertical(bottom), true, 'bottom should be vertical');

  const input = [bottom, top];
  const sorted = sortReadingOrder(input);
  const ids = Array.from(sorted.map((l) => l.id));

  assert.strictEqual(JSON.stringify(ids), JSON.stringify(['split_top', 'split_bottom']));
});

runTest('2b. 複数列環境で、同一列内の分割行が上から下（上行 -> 下行）にソートされること', () => {
  const rightFull = { id: 'right_full', x0: 200, y0: 0, x1: 220, y1: 100 };
  const leftTop = { id: 'left_top', x0: 100, y0: 0, x1: 120, y1: 50 };
  const leftBottom = { id: 'left_bottom', x0: 100, y0: 60, x1: 120, y1: 100 };

  const input = [leftBottom, rightFull, leftTop];
  const sorted = sortReadingOrder(input);
  const ids = Array.from(sorted.map((l) => l.id));

  assert.strictEqual(JSON.stringify(ids), JSON.stringify(['right_full', 'left_top', 'left_bottom']));
});

// 3. 2段組: 各段で右から左にソートされること (上段右 -> 上段左 -> 下段右 -> 下段左)
runTest('3. 2段組の各段で右から左にソートされること (上段R->上段L->下段R->下段L)', () => {
  const upperRight = { id: 'upper_right', x0: 200, y0: 0, x1: 220, y1: 100 };
  const upperLeft = { id: 'upper_left', x0: 100, y0: 0, x1: 120, y1: 100 };
  const lowerRight = { id: 'lower_right', x0: 200, y0: 150, x1: 220, y1: 250 };
  const lowerLeft = { id: 'lower_left', x0: 100, y0: 150, x1: 120, y1: 250 };

  const input = [lowerLeft, upperRight, lowerRight, upperLeft];
  const sorted = sortReadingOrder(input);
  const ids = Array.from(sorted.map((l) => l.id));

  assert.strictEqual(JSON.stringify(ids), JSON.stringify(['upper_right', 'upper_left', 'lower_right', 'lower_left']));
});

// 4. 横書き行: 上から下、左から右にソートされること
runTest('4. 横書き行が上から下、左から右にソートされること', () => {
  const row1Left = { id: 'r1_left', x0: 0, y0: 0, x1: 100, y1: 20 };
  const row1Right = { id: 'r1_right', x0: 120, y0: 0, x1: 220, y1: 20 };
  const row2Left = { id: 'r2_left', x0: 0, y0: 30, x1: 100, y1: 50 };
  const row2Right = { id: 'r2_right', x0: 120, y0: 30, x1: 220, y1: 50 };

  assert.strictEqual(isLineVertical(row1Left), false, 'row1Left should be horizontal');
  assert.strictEqual(isLineVertical(row1Right), false, 'row1Right should be horizontal');

  const input = [row2Right, row1Left, row2Left, row1Right];
  const sorted = sortReadingOrder(input);
  const ids = Array.from(sorted.map((l) => l.id));

  assert.strictEqual(JSON.stringify(ids), JSON.stringify(['r1_left', 'r1_right', 'r2_left', 'r2_right']));
});

// 5. 混在ケース: ヘッダー横書き、縦書き本文、フッター横書きが適切な順序になること
runTest('5. 混在ケース (ヘッダー横書き -> 縦書き本文R->L -> フッター横書き)', () => {
  const header = { id: 'header', x0: 0, y0: 0, x1: 300, y1: 30 };
  const bodyRight = { id: 'body_right', x0: 200, y0: 60, x1: 220, y1: 200 };
  const bodyCenter = { id: 'body_center', x0: 150, y0: 60, x1: 170, y1: 200 };
  const bodyLeft = { id: 'body_left', x0: 100, y0: 60, x1: 120, y1: 200 };
  const footer = { id: 'footer', x0: 0, y0: 230, x1: 300, y1: 260 };

  assert.strictEqual(isLineVertical(header), false, 'header should be horizontal');
  assert.strictEqual(isLineVertical(bodyRight), true, 'bodyRight should be vertical');
  assert.strictEqual(isLineVertical(bodyCenter), true, 'bodyCenter should be vertical');
  assert.strictEqual(isLineVertical(bodyLeft), true, 'bodyLeft should be vertical');
  assert.strictEqual(isLineVertical(footer), false, 'footer should be horizontal');

  const input = [footer, bodyLeft, header, bodyRight, bodyCenter];
  const sorted = sortReadingOrder(input);
  const ids = Array.from(sorted.map((l) => l.id));

  assert.strictEqual(JSON.stringify(ids), JSON.stringify(['header', 'body_right', 'body_center', 'body_left', 'footer']));
});

console.log(`\nTest Summary: ${passCount} passed, ${failCount} failed.`);
if (failCount > 0) {
  process.exit(1);
} else {
  console.log('All tests passed successfully!');
}
