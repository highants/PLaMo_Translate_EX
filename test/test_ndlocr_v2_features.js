/**
 * Unit & contract tests for NDLOCR-Lite V2.0 integration in PlaMo_translate:
 *   1. Character inclusion (異体字包摂): ndl_character_inclusion.js + applyCharacterInclusion
 *   2. Japanese punctuation space cleanup & wide horizontal line whitespace split
 *   3. TableCenterNet engine: region merging, official decoder, logical grid, Markdown & HTML rendering
 *   4. offscreen.js V2.0 English 1-pass auto routing & markdownStyle merge boundaries
 *   5. Settings, HTML, background, and i18n contracts (default ON for characterInclusion, TCY, table)
 */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');

const { NDL_CHARACTER_INCLUSION } = require('../vendor/ndlocr/ndl_character_inclusion.js');
const { NdlTableEngine } = require('../tablecenternet_engine.js');

// Load ndlocr_engine.js into VM with NDL_CHARACTER_INCLUSION exposed
const ndlSrc = fs.readFileSync(path.join(__dirname, '..', 'ndlocr_engine.js'), 'utf8');
const ndlSandbox = {
  console,
  Uint8Array,
  Int32Array,
  Float32Array,
  Uint8ClampedArray,
  BigInt64Array,
  Set,
  Map,
  Math,
  RegExp,
  Object,
  Array,
  Number,
  String,
  Boolean,
  NDL_CHARACTER_INCLUSION
};
ndlSandbox.self = ndlSandbox;
ndlSandbox.globalThis = ndlSandbox;
vm.createContext(ndlSandbox);
vm.runInContext(ndlSrc, ndlSandbox);
const NdlOcrEngine = ndlSandbox.NdlOcrEngine;

// Extract offscreen.js routing & merge functions
const offscreenSrc = fs.readFileSync(path.join(__dirname, '..', 'offscreen.js'), 'utf8');
const matchLangMap = offscreenSrc.match(/(const OCR_LANG_MAP\s*=\s*\{[\s\S]*?function resolveTesseractLangs\([\s\S]*?\r?\n\})/);
const matchRouting = offscreenSrc.match(/(function isLikelyEnglishText\([\s\S]*?function runOcrRecognition\([\s\S]*?\r?\n\})/);
const matchMerge = offscreenSrc.match(/(const CJK_CHAR_REGEX[\s\S]*?function mergeVerticalProseLinesIfAppropriate\([\s\S]*?\r?\n\})/);
assert.ok(matchLangMap && matchRouting && matchMerge, 'Failed to extract offscreen.js functions');

const offSandbox = {
  console: { warn: () => {}, log: () => {}, error: () => {} },
  Math,
  mockRunNdlOcr: async () => ({ text: '', blocks: [] }),
  mockRunTesseractOcr: async () => ({ text: '', blocks: [] })
};
vm.createContext(offSandbox);
vm.runInContext(`
  let ocrQueue = Promise.resolve();
  function runNdlOcr(imageDataUrl, opts) { return mockRunNdlOcr(imageDataUrl, opts); }
  function runTesseractOcr(imageDataUrl, ocrLang) { return mockRunTesseractOcr(imageDataUrl, ocrLang); }
  ${matchLangMap[1]}
  ${matchMerge[1]}
  ${matchRouting[1]}
  globalThis.runOcrRecognition = runOcrRecognition;
  globalThis.mergeProseLinesIfAppropriate = mergeProseLinesIfAppropriate;
  globalThis.mergeVerticalProseLinesIfAppropriate = mergeVerticalProseLinesIfAppropriate;
`, offSandbox);

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

async function main() {
  console.log('Running NDLOCR-Lite V2.0 Feature & Contract Tests...\n');

  // --- 1. Character Inclusion (異体字包摂) ---
  await test('1a. ndl_character_inclusion.js contains 4,900+ entries without touching ASCII or Kana', () => {
    const singleCount = Object.keys(NDL_CHARACTER_INCLUSION.single).length;
    const multiCount = Object.keys(NDL_CHARACTER_INCLUSION.multi).length;
    assert.ok(singleCount >= 4800, `Expected >=4800 single entries, got ${singleCount}`);
    assert.ok(multiCount >= 50, `Expected >=50 multi entries, got ${multiCount}`);
    assert.strictEqual(NDL_CHARACTER_INCLUSION.single['A'], undefined);
    assert.strictEqual(NDL_CHARACTER_INCLUSION.single['あ'], undefined);
  });

  await test('1b. applyCharacterInclusion converts old kanji to modern forms cleanly', () => {
    assert.strictEqual(
      NdlOcrEngine.applyCharacterInclusion('國立國會圖書館・學問の實踐と經驗の蓄積（舊字體）'),
      '国立国会図書館・学問の実践と経験の蓄積（旧字体）'
    );
    assert.strictEqual(
      NdlOcrEngine.applyCharacterInclusion('昭和25年11月24日發行'),
      '昭和25年11月24日発行'
    );
  });

  await test('1c. applyCharacterInclusion applies longest-match multi-char before single-char and leaves modern/English untouched', () => {
    assert.strictEqual(NdlOcrEngine.applyCharacterInclusion('Hello World 2026! 現代日本語のテスト。'), 'Hello World 2026! 現代日本語のテスト。');
    assert.strictEqual(NdlOcrEngine.applyCharacterInclusion(''), '');
    const customDict = { single: { A: 'x', B: 'y' }, multi: { AB: 'LONG', ABC: 'LONGER' } };
    assert.strictEqual(NdlOcrEngine.applyCharacterInclusion('ABC AB A', customDict), 'LONGER LONG x');
  });

  // --- 2. Punctuation cleanup & Whitespace split ---
  await test('2a. removeAsciiSpacesAroundJapanesePunctuation strips ASCII spaces around 、 and 。', () => {
    assert.strictEqual(
      NdlOcrEngine.removeAsciiSpacesAroundJapanesePunctuation('日本語 、 テスト 。 次の文'),
      '日本語、テスト。次の文'
    );
    assert.strictEqual(
      NdlOcrEngine.removeAsciiSpacesAroundJapanesePunctuation('English, sentence. Next'),
      'English, sentence. Next'
    );
  });

  await test('2b. findVerticalSplitX finds blank word valley near midpoint of wide crop', () => {
    const w = 200, h = 24;
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    // Draw dark ink everywhere in [10..95] and [105..190], leaving blank valley at x=96..104 (center 100)
    for (let y = 4; y < 20; y++) {
      for (let x = 10; x < 190; x++) {
        if (x >= 96 && x <= 104) continue;
        const p = (y * w + x) * 4;
        data[p] = 20; data[p + 1] = 20; data[p + 2] = 20;
      }
    }
    const res = NdlOcrEngine.findVerticalSplitX({ data, width: w, height: h }, { x0: 0, y0: 0, w, h });
    assert.ok(res, 'Expected split result');
    assert.strictEqual(res.minInk, 0);
    assert.ok(res.splitOffset >= 96 && res.splitOffset <= 104, `Expected split near 100, got ${res.splitOffset}`);
    assert.ok(res.gapLen >= 8, `Expected gapLen >= 8, got ${res.gapLen}`);

    // Pure-black (#000000, lum === 0) dark-mode UI screenshot must NOT coerce bgLum to 255
    const darkBuf = new Uint8ClampedArray(w * h * 4);
    for (let i = 3; i < darkBuf.length; i += 4) darkBuf[i] = 255; // #000000 opaque background
    for (let y = 4; y < 20; y++) {
      for (let x = 10; x < 95; x++) {
        const p = (y * w + x) * 4;
        darkBuf[p] = darkBuf[p + 1] = darkBuf[p + 2] = 240; // light text
      }
      for (let x = 105; x < 190; x++) {
        const p = (y * w + x) * 4;
        darkBuf[p] = darkBuf[p + 1] = darkBuf[p + 2] = 240;
      }
    }
    const darkRes = NdlOcrEngine.findVerticalSplitX({ data: darkBuf, width: w, height: h }, { x0: 0, y0: 0, w, h });
    assert.strictEqual(darkRes.minInk, 0, 'Dark-mode #000000 background must yield minInk=0 in word gap');
    assert.ok(darkRes.splitOffset >= 96 && darkRes.splitOffset <= 104, `Expected dark-mode split near 100, got ${darkRes.splitOffset}`);
  });

  // --- 3. TableCenterNet Engine ---
  await test('3a. mergeOverlappingTableRegions merges overlapping envelopes and keeps disjoint tables separate', () => {
    const merged = NdlTableEngine.mergeOverlappingTableRegions([
      { bbox: [10, 10, 100, 100], confidence: 0.7 },
      { bbox: [80, 50, 200, 150], confidence: 0.9 },
      { bbox: [300, 300, 500, 450], confidence: 0.85 }
    ]);
    assert.strictEqual(merged.length, 2);
    assert.deepStrictEqual(merged[0].bbox, [10, 10, 200, 150]);
    assert.strictEqual(merged[0].confidence, 0.9);
    assert.deepStrictEqual(merged[1].bbox, [300, 300, 500, 450]);
  });

  await test('3b. cellsToMarkdown & cellsToHtml assign OCR lines cleanly, handle colspan/rowspan, and escape | & HTML', () => {
    const cells = [
      { score: 0.95, corners: [[0, 0], [200, 0], [200, 40], [0, 40]], logic_axis_0based: [0, 1, 0, 0] }, // colspan=2 header
      { score: 0.92, corners: [[0, 40], [100, 40], [100, 80], [0, 80]], logic_axis_0based: [0, 0, 1, 1] },
      { score: 0.91, corners: [[100, 40], [200, 40], [200, 80], [100, 80]], logic_axis_0based: [1, 1, 1, 1] }
    ];
    const ocrLines = [
      { text: 'Header | <Title>', bbox: { x0: 20, y0: 10, x1: 180, y1: 30 }, isVertical: false },
      { text: 'Cell A', bbox: { x0: 10, y0: 50, x1: 80, y1: 70 }, isVertical: false },
      { text: 'Cell B', bbox: { x0: 110, y0: 50, x1: 180, y1: 70 }, isVertical: false }
    ];
    const md = NdlTableEngine.cellsToMarkdown(cells, ocrLines, { tableBbox: [0, 0, 200, 80] });
    assert.strictEqual(
      md,
      '| Header \\| <Title> | Header \\| <Title> |\n| --- | --- |\n| Cell A | Cell B |'
    );
    const html = NdlTableEngine.cellsToHtml(cells, ocrLines, { tableBbox: [0, 0, 200, 80] });
    assert.ok(html.includes('colspan="2"'), 'HTML must preserve colspan="2"');
    assert.ok(html.includes('Header | &lt;Title&gt;'), 'HTML must escape < and >');
    assert.ok(html.includes('<td>Cell A</td>') && html.includes('<td>Cell B</td>'));

    // Multi-column vertical Japanese inside a cell must preserve right-to-left reading order
    const vCells = [
      { score: 0.95, corners: [[0, 0], [100, 0], [100, 120], [0, 120]], logic_axis_0based: [0, 0, 0, 0] },
      { score: 0.95, corners: [[100, 0], [200, 0], [200, 120], [100, 120]], logic_axis_0based: [1, 1, 0, 0] }
    ];
    const vLines = [
      { text: '二列目', bbox: { x0: 15, y0: 10, x1: 40, y1: 100 }, isVertical: true },
      { text: '一列目', bbox: { x0: 60, y0: 10, x1: 85, y1: 100 }, isVertical: true },
      { text: '右セル', bbox: { x0: 140, y0: 10, x1: 165, y1: 100 }, isVertical: true }
    ];
    const vMd = NdlTableEngine.cellsToMarkdown(vCells, vLines, { tableBbox: [0, 0, 200, 120] });
    const vHtml = NdlTableEngine.cellsToHtml(vCells);
    assert.ok(vMd.includes('一列目<br>二列目'), `Vertical cell Markdown order reversed: ${vMd}`);
    assert.ok(vHtml.includes('<td>一列目<br>二列目</td>'), `Vertical cell HTML order reversed: ${vHtml}`);
  });

  await test('3c. decodeOfficial decodes synthetic 2x2 table heatmap + corner relocation cleanly', () => {
    const H = 20, W = 20, area = H * W;
    const hm = new Float32Array(2 * area).fill(-10);
    const reg = new Float32Array(2 * area).fill(0);
    const ct2cn = new Float32Array(8 * area).fill(0);
    const cn2ct = new Float32Array(8 * area).fill(0);
    const lc = new Float32Array(2 * area).fill(1);
    const sp = new Float32Array(2 * area).fill(1);

    // Put 1 cell center at (10, 10) with polygon corners at (6,6),(14,6),(14,14),(6,14)
    const cIdx = 10 * W + 10;
    hm[cIdx] = 3.0; // sigmoid(3) ~ 0.953
    // vectors = center - corner: TL(+4,+4), TR(-4,+4), BR(-4,-4), BL(+4,-4)
    const vecs = [[4, 4], [-4, 4], [-4, -4], [4, -4]];
    vecs.forEach(([vx, vy], k) => {
      ct2cn[(2 * k) * area + cIdx] = vx;
      ct2cn[(2 * k + 1) * area + cIdx] = vy;
    });
    sp[cIdx] = 1.0; sp[area + cIdx] = 1.0;
    // Place 3 corners with cn2ct pointing inward (10, 10) so relocation fixes >= 3 (> CELL_MIN_OPTIMIZE_COUNT=2)
    const cornerPts = [[6, 6, 1, 1], [14, 6, 2, 1], [14, 14, 2, 2], [6, 14, 1, 2]];
    for (const [cx, cy, lx, ly] of cornerPts) {
      const kIdx = cy * W + cx;
      hm[area + kIdx] = 3.0;
      lc[kIdx] = lx; lc[area + kIdx] = ly;
      // corner - center -> each of 4 cn2ct vectors points to (10, 10)
      for (let k = 0; k < 4; k++) {
        cn2ct[(2 * k) * area + kIdx] = cx - 10;
        cn2ct[(2 * k + 1) * area + kIdx] = cy - 10;
      }
    }
    const outputs = {
      hm: { data: hm, dims: [1, 2, H, W] },
      reg: { data: reg, dims: [1, 2, H, W] },
      ct2cn: { data: ct2cn, dims: [1, 8, H, W] },
      cn2ct: { data: cn2ct, dims: [1, 8, H, W] },
      lc: { data: lc, dims: [1, 2, H, W] },
      sp: { data: sp, dims: [1, 2, H, W] }
    };
    const cells = NdlTableEngine.decodeOfficial(outputs, { centerX: 100, centerY: 100, scale: 200 });
    assert.strictEqual(cells.length, 1);
    assert.deepStrictEqual(cells[0].logic_axis_1based, [1, 1, 1, 1]);
    assert.ok(cells[0].score > 0.9);
  });

  // --- 4. V2.0 English 1-pass auto routing & markdownStyle boundaries ---
  await test('4a. auto mode keeps confident NDLOCR-Lite V2.0 English directly in 1 pass (0 Tesseract calls)', async () => {
    const calls = [];
    offSandbox.mockRunNdlOcr = async () => {
      calls.push('ndl');
      return {
        text: 'Release Notes: Local Browser OCR Engine v2.0',
        blocks: [{ text: 'Release Notes: Local Browser OCR Engine v2.0', confidence: 96, bbox: { x0: 0, y0: 0, x1: 300, y1: 24 } }]
      };
    };
    offSandbox.mockRunTesseractOcr = async () => {
      calls.push('tesseract');
      return { text: 'should not run', blocks: [] };
    };
    const res = await offSandbox.runOcrRecognition('data:image/png;base64,V2EN', 'auto', 'ndlocr');
    assert.deepStrictEqual(calls, ['ndl']);
    assert.strictEqual(res.detectedOcrLang, 'en');
    assert.strictEqual(res.text, 'Release Notes: Local Browser OCR Engine v2.0');
  });

  await test('4b. auto mode falls back to Tesseract en when NDLOCR English confidence is low (< 60)', async () => {
    const calls = [];
    offSandbox.mockRunNdlOcr = async () => {
      calls.push('ndl');
      return {
        text: 'Blurry English sample text',
        blocks: [{ text: 'Blurry English sample text', confidence: 48, bbox: { x0: 0, y0: 0, x1: 200, y1: 20 } }]
      };
    };
    offSandbox.mockRunTesseractOcr = async (_img, lang) => {
      calls.push(`tesseract:${lang}`);
      return { text: 'Clear English fallback', blocks: [{ text: 'Clear English fallback', confidence: 88 }] };
    };
    const res = await offSandbox.runOcrRecognition('data:image/png;base64,V2LOW', 'auto', 'ndlocr');
    assert.deepStrictEqual(calls, ['ndl', 'tesseract:en']);
    assert.strictEqual(res.detectedOcrLang, 'en');
    assert.strictEqual(res.text, 'Clear English fallback');
  });

  await test('4c. mergeProseLinesIfAppropriate respects markdownStyle h2 heading and join_br breaks', () => {
    const segs = [
      { text: 'Section Heading', confidence: 95, bbox: { x0: 20, y0: 10, x1: 220, y1: 30 }, markdownStyle: 5 },
      { text: 'First paragraph line', confidence: 95, bbox: { x0: 20, y0: 36, x1: 240, y1: 56 }, markdownStyle: 2 },
      { text: 'Second paragraph after join_br', confidence: 95, bbox: { x0: 20, y0: 62, x1: 260, y1: 82 }, markdownStyle: 1 }
    ];
    const merged = offSandbox.mergeProseLinesIfAppropriate(segs, 500);
    assert.strictEqual(merged.length, 3, 'h2 heading and join_br must keep all 3 blocks separate');

    // Multi-line paragraph where line 1 is join (1) and line 2 is join_br (2): line 3 must NOT merge into 1+2
    const segs2 = [
      { text: 'First line of paragraph one', confidence: 95, bbox: { x0: 20, y0: 10, x1: 240, y1: 30 }, markdownStyle: 1 },
      { text: 'Second line ends with join_br', confidence: 95, bbox: { x0: 20, y0: 36, x1: 240, y1: 56 }, markdownStyle: 2 },
      { text: 'Start of paragraph two', confidence: 95, bbox: { x0: 20, y0: 62, x1: 240, y1: 82 }, markdownStyle: 1 }
    ];
    const merged2 = offSandbox.mergeProseLinesIfAppropriate(segs2, 500);
    assert.strictEqual(merged2.length, 2, 'join_br on line 2 must break before line 3');
    assert.ok(merged2[0].text.includes('First line') && merged2[0].text.includes('Second line'));
    assert.strictEqual(merged2[1].text, 'Start of paragraph two');
  });

  // --- 5. Settings, HTML, and i18n contracts ---
  await test('5a. DEFAULT_SETTINGS defaults ocrCharacterInclusion, ocrEnableTcy, ocrEnableTableStructure to true', () => {
    const pfmlSrc = fs.readFileSync(path.join(__dirname, '..', 'pfml.js'), 'utf8');
    const s = {};
    vm.createContext(s);
    vm.runInContext(`${pfmlSrc}\nglobalThis.DEFAULT_SETTINGS = DEFAULT_SETTINGS;`, s);
    assert.strictEqual(s.DEFAULT_SETTINGS.ocrCharacterInclusion, true);
    assert.strictEqual(s.DEFAULT_SETTINGS.ocrEnableTcy, true);
    assert.strictEqual(s.DEFAULT_SETTINGS.ocrEnableTableStructure, true);
  });

  await test('5b. offscreen.html loads ndl_character_inclusion.js and tablecenternet_engine.js before ndlocr_engine.js', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'offscreen.html'), 'utf8');
    const incIdx = html.indexOf('vendor/ndlocr/ndl_character_inclusion.js');
    const tblIdx = html.indexOf('tablecenternet_engine.js');
    const engIdx = html.indexOf('ndlocr_engine.js');
    assert.ok(incIdx !== -1 && tblIdx !== -1 && engIdx !== -1);
    assert.ok(incIdx < engIdx && tblIdx < engIdx);
  });

  await test('5c. popup.html & popup.js wire all 3 V2.0 checkboxes (checked by default)', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'popup.html'), 'utf8');
    const js = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
    for (const id of ['settingOcrCharacterInclusion', 'settingOcrEnableTcy', 'settingOcrEnableTableStructure']) {
      assert.ok(html.includes(`id="${id}" checked`), `popup.html missing checked checkbox #${id}`);
      assert.ok(js.includes(`getElementById('${id}')`), `popup.js missing ref to #${id}`);
    }
  });

  await test('5d. content.js guards deleted tables, appended regions, and NDLOCR 1-pass English toolbar state', () => {
    const contentSrc = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
    assert.ok(contentSrc.includes("if (activeItems.length === 0) return '';"), 'content.js must return empty string when all blocks are deleted');
    assert.ok(contentSrc.includes('newItem.isAppendedRegion = true;'), 'content.js must flag appended regions');
    assert.ok(contentSrc.includes('if (b && !it.isAppendedRegion)'), 'content.js must skip table bbox matching for appended regions');
    assert.ok(
      contentSrc.includes("effectiveReqLang === 'auto' && ocrRes.detectedOcrLang === 'en' && ocrRes.engine === 'tesseract'"),
      'content.js must only switch toolbar dropdown to en when Tesseract actually ran'
    );
  });

  console.log(`\nSummary: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
