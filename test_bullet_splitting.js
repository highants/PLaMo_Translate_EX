/**
 * Unit tests for bullet / list-item splitting and visual bullet detection
 * across offscreen.js and ndlocr_engine.js
 */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');

// ---------------------------------------------------------------------------
// 1. Load ndlocr_engine.js into a vm sandbox (no chrome mock needed)
// ---------------------------------------------------------------------------
const ndlEnginePath = path.join(__dirname, 'ndlocr_engine.js');
const ndlSrc = fs.readFileSync(ndlEnginePath, 'utf8');

const ndlSandbox = {
  console,
  Uint8Array,
  Int32Array,
  Uint8ClampedArray,
  Set,
  Map,
  Math
};
ndlSandbox.self = ndlSandbox;
ndlSandbox.globalThis = ndlSandbox;
vm.createContext(ndlSandbox);
vm.runInContext(ndlSrc, ndlSandbox);

const { NdlOcrEngine } = ndlSandbox;
if (!NdlOcrEngine || typeof NdlOcrEngine.detectVisualBulletLeftOfLine !== 'function') {
  console.error('FAIL: NdlOcrEngine.detectVisualBulletLeftOfLine was not properly exposed.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. Extract segmentation & merging functions from offscreen.js into a vm sandbox
// ---------------------------------------------------------------------------
const offscreenPath = path.join(__dirname, 'offscreen.js');
const offscreenSrc = fs.readFileSync(offscreenPath, 'utf8');

const extractMatch = offscreenSrc.match(
  /(const ICON_NOISE_CHAR_REGEX[\s\S]*?function mergeVerticalProseLinesIfAppropriate[\s\S]*?\r?\n\})/
);
if (!extractMatch) {
  console.error('FAIL: Could not locate ICON_NOISE_CHAR_REGEX..mergeVerticalProseLinesIfAppropriate in offscreen.js');
  process.exit(1);
}

const offscreenSandbox = {
  Set,
  Math,
  Infinity
};
vm.createContext(offscreenSandbox);
vm.runInContext(
  extractMatch[1] +
    '\nglobalThis.extractSegmentsFromLine = extractSegmentsFromLine;\n' +
    'globalThis.mergeProseLinesIfAppropriate = mergeProseLinesIfAppropriate;\n' +
    'globalThis.mergeVerticalProseLinesIfAppropriate = mergeVerticalProseLinesIfAppropriate;\n' +
    'globalThis.LIST_MARKER_REGEX = LIST_MARKER_REGEX;\n' +
    'globalThis.BULLET_CHAR_REGEX = BULLET_CHAR_REGEX;\n' +
    'globalThis.stripLeadingIconArtifacts = stripLeadingIconArtifacts;',
  offscreenSandbox
);

const {
  extractSegmentsFromLine,
  mergeProseLinesIfAppropriate,
  mergeVerticalProseLinesIfAppropriate,
  LIST_MARKER_REGEX,
  BULLET_CHAR_REGEX
} = offscreenSandbox;

for (const [name, val] of Object.entries({
  extractSegmentsFromLine,
  mergeProseLinesIfAppropriate,
  mergeVerticalProseLinesIfAppropriate
})) {
  if (typeof val !== 'function') {
    console.error(`FAIL: ${name} was not properly extracted.`);
    process.exit(1);
  }
}
assert.ok(LIST_MARKER_REGEX && typeof LIST_MARKER_REGEX.test === 'function', 'LIST_MARKER_REGEX should be a RegExp');
assert.ok(BULLET_CHAR_REGEX && typeof BULLET_CHAR_REGEX.test === 'function', 'BULLET_CHAR_REGEX should be a RegExp');

// ---------------------------------------------------------------------------
// Test harness & synthetic helpers
// ---------------------------------------------------------------------------
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

/**
 * Build a synthetic Tesseract-like line with per-character symbol boxes.
 */
function makeSymbolLine(text, x0, y0, charWidth = 16, lineHeight = 18, confidence = 94) {
  const symbols = [];
  let cursorX = x0;
  let wordIdx = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === ' ') {
      cursorX += Math.round(charWidth * 0.45);
      wordIdx++;
      continue;
    }
    symbols.push({
      text: ch,
      confidence,
      bbox: { x0: cursorX, y0, x1: cursorX + charWidth, y1: y0 + lineHeight }
    });
    cursorX += charWidth;
  }
  const lastX1 = symbols.length > 0 ? symbols[symbols.length - 1].bbox.x1 : x0;
  return {
    text,
    confidence,
    bbox: { x0, y0, x1: lastX1, y1: y0 + lineHeight },
    words: [{ text, confidence, symbols }]
  };
}

/**
 * Build a synthetic RGBA imageData buffer (default white background).
 */
function createSyntheticImageData(width, height, bg = [255, 255, 255, 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const base = i * 4;
    data[base] = bg[0];
    data[base + 1] = bg[1];
    data[base + 2] = bg[2];
    data[base + 3] = bg[3];
  }
  return { data, width, height };
}

function fillRect(imageData, x0, y0, x1, y1, rgba = [20, 20, 20, 255]) {
  const { data, width, height } = imageData;
  const rx0 = Math.max(0, x0);
  const ry0 = Math.max(0, y0);
  const rx1 = Math.min(width - 1, x1);
  const ry1 = Math.min(height - 1, y1);
  for (let y = ry0; y <= ry1; y++) {
    for (let x = rx0; x <= rx1; x++) {
      const idx = (y * width + x) * 4;
      data[idx] = rgba[0];
      data[idx + 1] = rgba[1];
      data[idx + 2] = rgba[2];
      data[idx + 3] = rgba[3];
    }
  }
}

console.log('Running Bullet Splitting & Visual Bullet Detection Tests...\n');

// ---------------------------------------------------------------------------
// Test 1: Consecutive Japanese bullet lines stay 3 distinct groups
// ---------------------------------------------------------------------------
runTest('1. 連続する日本語箇条書き（・項目1/2/3）は「・」除去後も isListItem=true により3グループに分かれる', () => {
  const naturalWidth = 800;
  const naturalHeight = 400;
  const lines = [
    makeSymbolLine('・項目1のテキスト内容', 40, 20),
    makeSymbolLine('・項目2のテキスト内容', 40, 44),
    makeSymbolLine('・項目3のテキスト内容', 40, 68)
  ];

  const segments = lines.flatMap(l => extractSegmentsFromLine(l, 1, naturalWidth, naturalHeight));
  assert.strictEqual(segments.length, 3, `Expected 3 extracted segments, got ${segments.length}`);
  segments.forEach((seg, idx) => {
    assert.strictEqual(seg.isListItem, true, `Segment ${idx} should retain isListItem === true`);
    assert.ok(!seg.text.startsWith('・'), `Segment ${idx} should have leading '・' stripped, got "${seg.text}"`);
  });

  const merged = mergeProseLinesIfAppropriate(segments, naturalWidth);
  assert.strictEqual(merged.length, 3, `Expected 3 distinct merged groups, got ${merged.length}`);
  assert.strictEqual(merged[0].text, '項目1のテキスト内容');
  assert.strictEqual(merged[1].text, '項目2のテキスト内容');
  assert.strictEqual(merged[2].text, '項目3のテキスト内容');
});

// ---------------------------------------------------------------------------
// Test 2: Wrapped bullet items merge their own continuation lines -> 2 groups
// ---------------------------------------------------------------------------
runTest('2. 折り返しを含む2つの箇条書き項目はそれぞれ結合され、計2グループ（1でも4でもなく）になる', () => {
  const naturalWidth = 800;
  const naturalHeight = 400;
  const lines = [
    makeSymbolLine('• Bullet 1 line 1', 40, 20, 12, 18),
    makeSymbolLine('continuation line 2', 58, 44, 12, 18),
    makeSymbolLine('• Bullet 2 line 1', 40, 74, 12, 18),
    makeSymbolLine('continuation line 2', 58, 98, 12, 18)
  ];

  const segments = lines.flatMap(l => extractSegmentsFromLine(l, 1, naturalWidth, naturalHeight));
  assert.strictEqual(segments.length, 4, `Expected 4 extracted segments, got ${segments.length}`);
  assert.strictEqual(segments[0].isListItem, true);
  assert.strictEqual(segments[1].isListItem, false);
  assert.strictEqual(segments[2].isListItem, true);
  assert.strictEqual(segments[3].isListItem, false);

  const merged = mergeProseLinesIfAppropriate(segments, naturalWidth);
  assert.strictEqual(merged.length, 2, `Expected 2 merged groups, got ${merged.length}`);
  assert.strictEqual(merged[0].isMultiLine, true);
  assert.strictEqual(merged[1].isMultiLine, true);
  assert.ok(merged[0].text.includes('Bullet 1 line 1') && merged[0].text.includes('continuation line 2'));
  assert.ok(merged[1].text.includes('Bullet 2 line 1') && merged[1].text.includes('continuation line 2'));
  assert.ok(!merged[0].text.includes('Bullet 2'));
});

// ---------------------------------------------------------------------------
// Test 3: Standalone separated bullet symbol carries isListItem to Item text
// ---------------------------------------------------------------------------
runTest('3. gap > lineHeight * 1.3 で分離した単独バレット記号（• / ・）も後続セグメントに isListItem=true を引き継ぐ', () => {
  const naturalWidth = 800;
  const naturalHeight = 400;
  const lineHeight = 18;
  const gap = Math.round(lineHeight * 1.45); // 26px > lineHeight * 1.3 (23.4) and colGapThreshold (22)

  function makeSeparatedBulletLine(bulletChar, itemText, y0) {
    const bulletBox = { x0: 40, y0, x1: 50, y1: y0 + lineHeight };
    const textStartX = bulletBox.x1 + gap;
    const itemLine = makeSymbolLine(itemText, textStartX, y0, 14, lineHeight, 95);
    const bulletSym = { text: bulletChar, confidence: 95, bbox: bulletBox };
    return {
      text: `${bulletChar} ${itemText}`,
      confidence: 95,
      bbox: { x0: 40, y0, x1: itemLine.bbox.x1, y1: y0 + lineHeight },
      words: [
        { text: bulletChar, confidence: 95, bbox: bulletBox, symbols: [bulletSym] },
        ...itemLine.words
      ]
    };
  }

  const lineA = makeSeparatedBulletLine('•', 'Item one text', 20);
  const lineB = makeSeparatedBulletLine('・', '項目二のテキスト', 46);

  const segsA = extractSegmentsFromLine(lineA, 1, naturalWidth, naturalHeight);
  const segsB = extractSegmentsFromLine(lineB, 1, naturalWidth, naturalHeight);
  assert.strictEqual(segsA.length, 1);
  assert.strictEqual(segsB.length, 1);
  assert.strictEqual(segsA[0].text, 'Item one text');
  assert.strictEqual(segsA[0].isListItem, true, 'Separated "•" must carry isListItem=true to "Item one text"');
  assert.strictEqual(segsB[0].text, '項目二のテキスト');
  assert.strictEqual(segsB[0].isListItem, true, 'Separated "・" must carry isListItem=true to "項目二のテキスト"');

  const merged = mergeProseLinesIfAppropriate([...segsA, ...segsB], naturalWidth);
  assert.strictEqual(merged.length, 2, `Expected 2 separate items, got ${merged.length}`);
});

// ---------------------------------------------------------------------------
// Test 4: Short trailing wrapped line fallback splits without periods or markers
// ---------------------------------------------------------------------------
runTest('4. 句点や先頭記号がない短い末尾折り返し行（w=400,110,395,130）も2つのまとまりへ分割される', () => {
  const segments = [
    {
      text: 'First bullet item content that spans nearly the entire column width',
      confidence: 94,
      bbox: { x0: 50, y0: 20, x1: 450, y1: 38 }, // w = 400, h = 18
      isMultiLine: false
    },
    {
      text: 'Short tail one',
      confidence: 93,
      bbox: { x0: 50, y0: 44, x1: 160, y1: 62 }, // w = 110, vGap = 6, no period
      isMultiLine: false
    },
    {
      text: 'Second bullet item content that also spans nearly full column width',
      confidence: 95,
      bbox: { x0: 50, y0: 68, x1: 445, y1: 86 }, // w = 395, vGap = 6
      isMultiLine: false
    },
    {
      text: 'Short tail two',
      confidence: 92,
      bbox: { x0: 50, y0: 92, x1: 180, y1: 110 }, // w = 130, vGap = 6, no period
      isMultiLine: false
    }
  ];

  const merged = mergeProseLinesIfAppropriate(segments, 800);
  assert.strictEqual(merged.length, 2, `Expected 2 separate items, got ${merged.length}`);
  assert.strictEqual(merged[0].isMultiLine, true);
  assert.strictEqual(merged[1].isMultiLine, true);
  assert.ok(merged[0].text.includes('First bullet item') && merged[0].text.includes('Short tail one'));
  assert.ok(merged[1].text.includes('Second bullet item') && merged[1].text.includes('Short tail two'));
  assert.ok(!merged[0].text.includes('Second bullet item'));
});

// ---------------------------------------------------------------------------
// Test 5: NdlOcrEngine.detectVisualBulletLeftOfLine synthetic RGBA tests
// ---------------------------------------------------------------------------
runTest('5a. detectVisualBulletLeftOfLine: 左余白が空の場合は false', () => {
  const img = createSyntheticImageData(200, 60);
  const bbox = { x0: 60, y0: 15, x1: 180, y1: 35 };
  assert.strictEqual(NdlOcrEngine.detectVisualBulletLeftOfLine(img, bbox), false);
});

runTest('5b. detectVisualBulletLeftOfLine: bbox.x0=60 の 8px 左に孤立した 6x6 暗色矩形ドットがある場合は true', () => {
  const img = createSyntheticImageData(200, 60);
  const bbox = { x0: 60, y0: 15, x1: 180, y1: 35 };
  // stripX1 = 60, gapToText = (60 - 1) - 51 = 8px, width = 51 - 46 + 1 = 6px, height = 27 - 22 + 1 = 6px
  fillRect(img, 46, 22, 51, 27, [20, 20, 20, 255]);
  assert.strictEqual(NdlOcrEngine.detectVisualBulletLeftOfLine(img, bbox), true);
});

runTest('5c. detectVisualBulletLeftOfLine: bbox.x0 の 14px 左に全高 2px 縦罫線のみがある場合は false', () => {
  const img = createSyntheticImageData(200, 60);
  const bbox = { x0: 60, y0: 15, x1: 180, y1: 35 };
  // 2px full-height vertical border at x=45..46 (14px left of x0=60)
  fillRect(img, 45, 0, 46, 59, [40, 40, 40, 255]);
  assert.strictEqual(NdlOcrEngine.detectVisualBulletLeftOfLine(img, bbox), false);
});

runTest('5d. detectVisualBulletLeftOfLine: x=36 の縦罫線 + x=44..50 の 6x6 ドット（bbox.x0=58）がある場合は true', () => {
  const img = createSyntheticImageData(200, 60);
  const bbox = { x0: 58, y0: 15, x1: 180, y1: 35 };
  // Full-height 2px vertical border at x=36..37
  fillRect(img, 36, 0, 37, 59, [120, 120, 120, 255]);
  // Colored 6x6 dot at x=44..49 (or 44..50), y=22..27
  fillRect(img, 44, 22, 49, 27, [37, 99, 235, 255]);
  assert.strictEqual(NdlOcrEngine.detectVisualBulletLeftOfLine(img, bbox), true);
});

runTest('5e. detectVisualBulletLeftOfLine: bbox.x0 の左に複数の細い文字ストローク（隣接テキスト単語）がある場合は false', () => {
  const img = createSyntheticImageData(200, 60);
  const bbox = { x0: 60, y0: 15, x1: 180, y1: 35 };
  // 4 separate narrow character strokes in guard strip left of x0=60
  fillRect(img, 34, 18, 35, 31, [20, 20, 20, 255]);
  fillRect(img, 40, 18, 41, 31, [20, 20, 20, 255]);
  fillRect(img, 46, 18, 47, 31, [20, 20, 20, 255]);
  fillRect(img, 52, 18, 53, 31, [20, 20, 20, 255]);
  assert.strictEqual(NdlOcrEngine.detectVisualBulletLeftOfLine(img, bbox), false);
});

// ---------------------------------------------------------------------------
// Test 6: Vertical prose merging preserves consecutive vertical list items
// ---------------------------------------------------------------------------
runTest('6. 縦書き結合（mergeVerticalProseLinesIfAppropriate）でも isListItem=true の連続列は分割保持される', () => {
  const verticalSegments = [
    {
      text: '縦書き項目1',
      confidence: 95,
      bbox: { x0: 300, y0: 40, x1: 320, y1: 220 },
      isMultiLine: false,
      isListItem: true
    },
    {
      text: '縦書き項目2',
      confidence: 95,
      bbox: { x0: 272, y0: 40, x1: 292, y1: 220 },
      isMultiLine: false,
      isListItem: true
    }
  ];

  const merged = mergeVerticalProseLinesIfAppropriate(verticalSegments, 400);
  assert.strictEqual(merged.length, 2, `Expected 2 separate vertical list items, got ${merged.length}`);
});

console.log(`\nTest Summary: ${passCount} passed, ${failCount} failed.`);
if (failCount > 0) {
  process.exit(1);
} else {
  console.log('All bullet splitting tests passed successfully!');
}
