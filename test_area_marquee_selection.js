/**
 * Unit & contract tests for multi-rect marquee selection, subtraction,
 * perimeter background sampling, and UI/CSS/i18n contracts
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const contentSrc = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');
const contentCss = fs.readFileSync(path.join(__dirname, 'content.css'), 'utf8');
const i18nSrc = fs.readFileSync(path.join(__dirname, 'i18n.js'), 'utf8');

// ---------------------------------------------------------------------------
// Extract geometry & perimeter sampling helpers from content.js into vm
// ---------------------------------------------------------------------------
const helperMatch = contentSrc.match(
  /(function normalizeDragRect\([\s\S]*?function sampleRegionPerimeterBackground\([\s\S]*?\r?\n\s{2}\})(?=\s*\r?\n\s{2}function cropAndMaskDataUrlRects)/
);
if (!helperMatch) {
  console.error('FAIL: Could not locate normalizeDragRect..sampleRegionPerimeterBackground in content.js');
  process.exit(1);
}

const sandbox = { Math, Number, Array, Infinity };
vm.createContext(sandbox);
vm.runInContext(
  helperMatch[1] +
    '\nglobalThis.normalizeDragRect = normalizeDragRect;\n' +
    'globalThis.subtractRectFromList = subtractRectFromList;\n' +
    'globalThis.findRectIndexAtPoint = findRectIndexAtPoint;\n' +
    'globalThis.computeSelectionBoundingRect = computeSelectionBoundingRect;\n' +
    'globalThis.sampleRegionPerimeterBackground = sampleRegionPerimeterBackground;',
  sandbox
);

const {
  normalizeDragRect,
  subtractRectFromList,
  findRectIndexAtPoint,
  computeSelectionBoundingRect,
  sampleRegionPerimeterBackground
} = sandbox;

for (const [name, fn] of Object.entries({
  normalizeDragRect,
  subtractRectFromList,
  findRectIndexAtPoint,
  computeSelectionBoundingRect,
  sampleRegionPerimeterBackground
})) {
  assert.strictEqual(typeof fn, 'function', `${name} must be extracted as a function`);
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

function fromVm(val) {
  return JSON.parse(JSON.stringify(val));
}

function rectArea(r) {
  return r.width * r.height;
}

function rectsOverlap(a, b) {
  const ix0 = Math.max(a.left, b.left);
  const iy0 = Math.max(a.top, b.top);
  const ix1 = Math.min(a.left + a.width, b.left + b.width);
  const iy1 = Math.min(a.top + a.height, b.top + b.height);
  return ix1 > ix0 && iy1 > iy0;
}

function createSolidImageData(sw, sh, rgb) {
  const data = new Uint8ClampedArray(sw * sh * 4);
  for (let i = 0; i < sw * sh; i++) {
    const base = i * 4;
    data[base] = rgb[0];
    data[base + 1] = rgb[1];
    data[base + 2] = rgb[2];
    data[base + 3] = 255;
  }
  return { data, width: sw, height: sh };
}

function paintRect(imgData, rx, ry, rw, rh, rgb) {
  const { data, width, height } = imgData;
  const x0 = Math.max(0, rx);
  const y0 = Math.max(0, ry);
  const x1 = Math.min(width - 1, rx + rw - 1);
  const y1 = Math.min(height - 1, ry + rh - 1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const idx = (y * width + x) * 4;
      data[idx] = rgb[0];
      data[idx + 1] = rgb[1];
      data[idx + 2] = rgb[2];
    }
  }
}

console.log('Running Area Marquee Selection & Subtraction Tests...\n');

// 1. normalizeDragRect
runTest('1. normalizeDragRect handles reverse drag (x1 < x0, y1 < y0) accurately', () => {
  assert.deepStrictEqual(fromVm(normalizeDragRect(300, 250, 120, 90)), {
    left: 120,
    top: 90,
    width: 180,
    height: 160
  });
  assert.deepStrictEqual(fromVm(normalizeDragRect(10, 20, 110, 80)), {
    left: 10,
    top: 20,
    width: 100,
    height: 60
  });
});

// 2. subtractRectFromList - no overlap
runTest('2. subtractRectFromList leaves non-overlapping rects untouched', () => {
  const initial = [
    { left: 10, top: 10, width: 100, height: 80 },
    { left: 200, top: 50, width: 80, height: 60 }
  ];
  const sub = { left: 120, top: 10, width: 60, height: 80 };
  const result = fromVm(subtractRectFromList(initial, sub, 8));
  assert.deepStrictEqual(result, initial);
});

// 3. subtractRectFromList - full coverage
runTest('3. subtractRectFromList deletes a rect cleanly when fully covered ([])', () => {
  const initial = [{ left: 50, top: 50, width: 100, height: 80 }];
  const sub = { left: 40, top: 40, width: 140, height: 120 };
  const result = fromVm(subtractRectFromList(initial, sub, 8));
  assert.deepStrictEqual(result, []);
});

// 4. subtractRectFromList - interior hole splits into 4 valid non-overlapping pieces
runTest('4. subtractRectFromList splits interior hole into 4 non-overlapping pieces preserving total area', () => {
  const orig = { left: 0, top: 0, width: 200, height: 160 };
  const sub = { left: 50, top: 40, width: 80, height: 60 };
  const pieces = fromVm(subtractRectFromList([orig], sub, 8));

  assert.strictEqual(pieces.length, 4, `Expected 4 split pieces, got ${pieces.length}`);
  const totalPieceArea = pieces.reduce((sum, p) => sum + rectArea(p), 0);
  assert.strictEqual(totalPieceArea + rectArea(sub), rectArea(orig), 'Sum of pieces + sub area must equal original area');

  for (let i = 0; i < pieces.length; i++) {
    assert.ok(!rectsOverlap(pieces[i], sub), `Piece ${i} must not overlap subtracted hole`);
    for (let j = i + 1; j < pieces.length; j++) {
      assert.ok(!rectsOverlap(pieces[i], pieces[j]), `Pieces ${i} and ${j} must not overlap each other`);
    }
  }
});

// 5. subtractRectFromList - thin remaining slivers (< minSize = 8) dropped
runTest('5. subtractRectFromList drops thin remaining slivers (< minSize = 8) cleanly', () => {
  const orig = { left: 100, top: 100, width: 100, height: 80 };
  // Leaves 5px on left, 4px on top, 6px on bottom, and 45px on right
  const sub = { left: 105, top: 104, width: 50, height: 70 };
  const pieces = fromVm(subtractRectFromList([orig], sub, 8));

  assert.strictEqual(pieces.length, 1, `Expected only 1 piece >= 8px, got ${pieces.length}`);
  assert.deepStrictEqual(pieces[0], { left: 155, top: 104, width: 45, height: 70 });
});

// 6. computeSelectionBoundingRect
runTest('6. computeSelectionBoundingRect returns exact tight union across multiple rects (or null when empty)', () => {
  assert.strictEqual(computeSelectionBoundingRect([]), null);
  const union = fromVm(
    computeSelectionBoundingRect([
      { left: 40, top: 60, width: 80, height: 40 },
      { left: 15, top: 20, width: 50, height: 100 },
      { left: 140, top: 30, width: 60, height: 50 }
    ])
  );
  assert.deepStrictEqual(union, { left: 15, top: 20, width: 185, height: 100 });
});

// 7. sampleRegionPerimeterBackground
runTest('7. sampleRegionPerimeterBackground picks median perimeter color (dark vs light theme)', () => {
  // Light-theme image with a small dark object strictly in the middle
  const lightImg = createSolidImageData(120, 80, [248, 250, 252]);
  paintRect(lightImg, 35, 25, 30, 20, [15, 23, 42]);
  const lightBg = sampleRegionPerimeterBackground(lightImg, 120, 80, [{ rx: 10, ry: 10, rw: 90, rh: 60 }]);
  assert.strictEqual(lightBg, 'rgb(248, 250, 252)');

  // Dark-theme image with a light badge strictly inside the perimeter
  const darkImg = createSolidImageData(120, 80, [17, 24, 39]);
  paintRect(darkImg, 40, 25, 25, 18, [255, 255, 255]);
  const darkBg = sampleRegionPerimeterBackground(darkImg, 120, 80, [{ rx: 10, ry: 10, rw: 90, rh: 60 }]);
  assert.strictEqual(darkBg, 'rgb(17, 24, 39)');
});

// 8. i18n.js keys
runTest('8. i18n.js defines areaSelectionCount, areaSelectionGuide, areaBtnConfirm, areaBtnUndo, areaBtnClear, areaBtnCancel in ja & en', () => {
  const i18nModule = { exports: {} };
  const i18nSandbox = { module: i18nModule, exports: i18nModule.exports };
  vm.createContext(i18nSandbox);
  vm.runInContext(i18nSrc, i18nSandbox);
  const { MESSAGES } = i18nSandbox.module.exports;

  const keys = [
    'areaSelectionCount',
    'areaSelectionGuide',
    'areaBtnConfirm',
    'areaBtnUndo',
    'areaBtnClear',
    'areaBtnCancel'
  ];
  for (const locale of ['ja', 'en']) {
    for (const key of keys) {
      assert.strictEqual(typeof MESSAGES[locale][key], 'string', `${locale}.${key} must be a string`);
      assert.ok(MESSAGES[locale][key].trim().length > 0, `${locale}.${key} must be non-empty`);
    }
  }
});

// 9. content.js promptScreenAreaSelection contract
runTest('9. content.js promptScreenAreaSelection appends rect on each drag and deletes hovered rect on right-click (no Shift/Alt)', () => {
  const rects = [
    { left: 10, top: 10, width: 100, height: 100 },
    { left: 50, top: 50, width: 80, height: 80 }
  ];
  assert.strictEqual(findRectIndexAtPoint(rects, 60, 60), 1, 'Topmost overlapping rect (last added) should hit first');
  assert.strictEqual(findRectIndexAtPoint(rects, 20, 20), 0, 'First rect hit when outside second rect');
  assert.strictEqual(findRectIndexAtPoint(rects, 200, 200), -1, 'Outside point must return -1');

  const fnMatch = contentSrc.match(/function\s+promptScreenAreaSelection\s*\([^)]*\)\s*\{([\s\S]*?)\r?\n\s{2}\}/);
  assert.ok(fnMatch, 'Could not locate promptScreenAreaSelection() in content.js');
  const body = fnMatch[1];

  assert.ok(
    body.includes('<svg class="plamo-ext-area-backdrop" aria-hidden="true">'),
    'Selector must render <svg class="plamo-ext-area-backdrop" aria-hidden="true">'
  );
  assert.ok(body.includes('data-area-action="confirm"'), 'Bar must include Confirm button (data-area-action="confirm")');
  assert.ok(!/e\.shiftKey|e\.altKey/.test(body), 'Selector must NOT depend on Shift or Alt keys');
  assert.match(body, /activeRects\s*=\s*\[\.\.\.activeRects,\s*dragRect\]/, 'Every drag must append dragRect to activeRects');
  assert.match(
    body,
    /areaSelectorEl\.addEventListener\('contextmenu',\s*\(e\)\s*=>\s*\{[\s\S]*?findRectIndexAtPoint\(activeRects,\s*e\.clientX,\s*e\.clientY\)[\s\S]*?activeRects\.filter\(/,
    'Right-click (contextmenu) must hit-test activeRects and delete targeted selection rect'
  );
  assert.match(body, /e\.key\s*===\s*'Enter'[\s\S]*?confirmSelection\(\)/, 'Enter key must trigger confirmSelection()');
  assert.match(
    body,
    /\(e\.ctrlKey\s*\|\|\s*e\.metaKey\)\s*&&\s*e\.key\.toLowerCase\(\)\s*===\s*'z'/,
    'Ctrl/Cmd+Z must undo last selection step'
  );
  assert.ok(body.includes("areaSelectorEl.classList.add('is-dragging')"), 'mousedown must add is-dragging');
  assert.ok(body.includes("areaSelectorEl.classList.remove('is-dragging')"), 'mouseup must remove is-dragging');
});

// 10. content.css marquee selector contract
runTest('10. content.css keeps cursor SVG, defines .plamo-ext-area-bar, .is-dragging .plamo-ext-area-bar, .plamo-ext-area-rect.is-hovered, and :focus-visible', () => {
  const selectorIdx = contentCss.lastIndexOf('.plamo-ext-area-selector {');
  assert.ok(selectorIdx !== -1, 'Could not find .plamo-ext-area-selector rule');
  const selectorBlock = contentCss.slice(selectorIdx, contentCss.indexOf('}', selectorIdx) + 1);
  assert.match(selectorBlock, /cursor:\s*url\("data:image\/svg\+xml,[^"]+"\)\s*16\s+16/, 'Cursor SVG data URI must remain intact');

  assert.match(contentCss, /(?:^|\r?\n)\.plamo-ext-area-bar\s*\{/, 'Missing .plamo-ext-area-bar rule');
  assert.match(
    contentCss,
    /(?:^|\r?\n)\.plamo-ext-area-selector\.is-dragging\s+\.plamo-ext-area-bar\s*\{[^}]*pointer-events:\s*none\s*;/,
    'Missing .plamo-ext-area-selector.is-dragging .plamo-ext-area-bar pointer-events: none rule'
  );
  assert.match(contentCss, /(?:^|\r?\n)\.plamo-ext-area-rect\.is-hovered\s*\{/, 'Missing .plamo-ext-area-rect.is-hovered rule');
  assert.match(
    contentCss,
    /(?:^|\r?\n)\.plamo-ext-area-btn:focus-visible\s*\{[^}]*outline:\s*[^;]+;/,
    'Missing :focus-visible outline rule on .plamo-ext-area-btn'
  );
});

console.log(`\nTest Summary: ${passCount} passed, ${failCount} failed.`);
if (failCount > 0) {
  process.exit(1);
} else {
  console.log('All area marquee selection tests passed successfully!');
}
