/**
 * Unit & contract tests for:
 *   Part A: offscreen.js singleBlock OCR mode (combineOcrResultAsSingleBlock & runOcrRecognition)
 *   Part B: background.js & offscreen.js singleBlock message wiring
 *   Part C: content.js, content.css, and i18n.js block-delete & add-region contracts
 */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');

const offscreenSrc = fs.readFileSync(path.join(__dirname, 'offscreen.js'), 'utf8');
const backgroundSrc = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');
const contentSrc = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');
const contentCss = fs.readFileSync(path.join(__dirname, 'content.css'), 'utf8');
const i18nSrc = fs.readFileSync(path.join(__dirname, 'i18n.js'), 'utf8');

// ---------------------------------------------------------------------------
// Extract OCR_LANG_MAP..resolveTesseractLangs and isLikelyEnglishText..runOcrRecognition
// ---------------------------------------------------------------------------
const matchLangMap = offscreenSrc.match(
  /(const OCR_LANG_MAP\s*=\s*\{[\s\S]*?function resolveTesseractLangs\([\s\S]*?\r?\n\})/
);
if (!matchLangMap) {
  console.error('FAIL: Could not locate OCR_LANG_MAP / resolveTesseractLangs in offscreen.js');
  process.exit(1);
}

const matchRouting = offscreenSrc.match(
  /(function isLikelyEnglishText\([\s\S]*?function runOcrRecognition\([\s\S]*?\r?\n\})/
);
if (!matchRouting) {
  console.error('FAIL: Could not locate isLikelyEnglishText..runOcrRecognition in offscreen.js');
  process.exit(1);
}

const sandbox = {
  console: {
    warn: () => {},
    log: () => {},
    error: () => {}
  },
  Math,
  mockRunNdlOcr: async () => ({ text: '', blocks: [] }),
  mockRunTesseractOcr: async () => ({ text: '', blocks: [] })
};
vm.createContext(sandbox);
vm.runInContext(
  `
  let ocrQueue = Promise.resolve();
  function runNdlOcr(imageDataUrl) {
    return mockRunNdlOcr(imageDataUrl);
  }
  function runTesseractOcr(imageDataUrl, ocrLang) {
    return mockRunTesseractOcr(imageDataUrl, ocrLang);
  }
  ${matchLangMap[1]}
  ${matchRouting[1]}
  globalThis.OCR_LANG_MAP = OCR_LANG_MAP;
  globalThis.resolveTesseractLangs = resolveTesseractLangs;
  globalThis.isLikelyEnglishText = isLikelyEnglishText;
  globalThis.combineOcrResultAsSingleBlock = combineOcrResultAsSingleBlock;
  globalThis.runOcrRecognition = runOcrRecognition;
  `,
  sandbox
);

const { runOcrRecognition, combineOcrResultAsSingleBlock } = sandbox;
assert.strictEqual(typeof runOcrRecognition, 'function', 'runOcrRecognition must be extracted');
assert.strictEqual(typeof combineOcrResultAsSingleBlock, 'function', 'combineOcrResultAsSingleBlock must be extracted');

let passCount = 0;
let failCount = 0;

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passCount++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failCount++;
  }
}

async function main() {
  console.log('Running Block Delete, Add Region & SingleBlock Mode Tests...\n');

  // -------------------------------------------------------------------------
  // Part A: offscreen.js singleBlock mode
  // -------------------------------------------------------------------------
  await runTest('A1. singleBlock: true combines heading + 2 body blocks into 1 block with union bbox and \\n joins', async () => {
    sandbox.mockRunTesseractOcr = async () => ({
      width: 400,
      height: 120,
      text: 'Overview\nFirst body line\nSecond body line',
      blocks: [
        { text: 'Overview', bbox: { x0: 24, y0: 10, x1: 160, y1: 32 }, confidence: 92, isMultiLine: false },
        { text: 'First body line', bbox: { x0: 14, y0: 44, x1: 280, y1: 62 }, confidence: 90, isMultiLine: false },
        { text: 'Second body line', bbox: { x0: 18, y0: 68, x1: 250, y1: 86 }, confidence: 88, isMultiLine: false }
      ]
    });

    const res = await runOcrRecognition('data:image/png;base64,AAA', 'en', 'ndlocr', { singleBlock: true });
    assert.strictEqual(res.blocks.length, 1, `Expected 1 combined block, got ${res.blocks.length}`);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(res.blocks[0].bbox)), { x0: 14, y0: 10, x1: 280, y1: 86 });
    assert.strictEqual(res.blocks[0].text, 'Overview\nFirst body line\nSecond body line');
    assert.strictEqual(res.text, 'Overview\nFirst body line\nSecond body line');
    assert.strictEqual(res.blocks[0].isMultiLine, true);
    assert.strictEqual(res.blocks[0].confidence, 90);
  });

  await runTest('A2. singleBlock: true combines 2 bullet blocks + trailing line into 1 block joined by \\n', async () => {
    sandbox.mockRunTesseractOcr = async () => ({
      width: 320,
      height: 100,
      text: '• First item\n• Second item\n• Third item',
      blocks: [
        { text: '• First item', bbox: { x0: 12, y0: 8, x1: 140, y1: 26 }, confidence: 94 },
        { text: '• Second item', bbox: { x0: 12, y0: 34, x1: 155, y1: 52 }, confidence: 96 },
        { text: '• Third item', bbox: { x0: 12, y0: 60, x1: 135, y1: 78 }, confidence: 92 }
      ]
    });

    const res = await runOcrRecognition('data:image/png;base64,BBB', 'en', 'ndlocr', { singleBlock: true });
    assert.strictEqual(res.blocks.length, 1);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(res.blocks[0].bbox)), { x0: 12, y0: 8, x1: 155, y1: 78 });
    assert.strictEqual(res.blocks[0].text, '• First item\n• Second item\n• Third item');
    assert.strictEqual(res.text, res.blocks[0].text);
  });

  await runTest('A3. singleBlock: true joins same-row fragments with space and next-row fragment with \\n', async () => {
    sandbox.mockRunTesseractOcr = async () => ({
      width: 300,
      height: 90,
      text: 'Hello\nWorld\nNext row',
      blocks: [
        { text: 'Hello', bbox: { x0: 10, y0: 16, x1: 60, y1: 34 }, confidence: 95 },
        { text: 'World', bbox: { x0: 68, y0: 17, x1: 128, y1: 35 }, confidence: 93 },
        { text: 'Next row', bbox: { x0: 10, y0: 46, x1: 105, y1: 64 }, confidence: 91 }
      ]
    });

    const res = await runOcrRecognition('data:image/png;base64,CCC', 'en', 'ndlocr', { singleBlock: true });
    assert.strictEqual(res.blocks.length, 1);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(res.blocks[0].bbox)), { x0: 10, y0: 16, x1: 128, y1: 64 });
    assert.strictEqual(res.blocks[0].text, 'Hello World\nNext row');
    assert.strictEqual(res.text, 'Hello World\nNext row');
  });

  await runTest('A4. singleBlock: true merges soft-hyphen split ("opti-" + "mal") cleanly', async () => {
    sandbox.mockRunTesseractOcr = async () => ({
      width: 320,
      height: 80,
      text: 'Achieve opti-\nmal speed\ntoday.',
      blocks: [
        { text: 'Achieve opti-', bbox: { x0: 10, y0: 10, x1: 150, y1: 28 }, confidence: 92 },
        { text: 'mal speed', bbox: { x0: 10, y0: 32, x1: 110, y1: 50 }, confidence: 90 },
        { text: 'today.', bbox: { x0: 118, y0: 32, x1: 175, y1: 50 }, confidence: 94 }
      ]
    });

    const res = await runOcrRecognition('data:image/png;base64,DDD', 'en', 'ndlocr', { singleBlock: true });
    assert.strictEqual(res.blocks.length, 1);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(res.blocks[0].bbox)), { x0: 10, y0: 10, x1: 175, y1: 50 });
    assert.strictEqual(res.blocks[0].text, 'Achieve optimal speed today.');
    assert.strictEqual(res.text, 'Achieve optimal speed today.');
  });

  await runTest('A5. singleBlock: true with empty blocks: [] returns { blocks: [], text: "" }', async () => {
    sandbox.mockRunTesseractOcr = async () => ({
      width: 200,
      height: 50,
      text: '',
      blocks: []
    });

    const res = await runOcrRecognition('data:image/png;base64,EEE', 'en', 'ndlocr', { singleBlock: true });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(res.blocks)), []);
    assert.strictEqual(res.text, '');
  });

  // -------------------------------------------------------------------------
  // Part B: background.js & offscreen.js wiring
  // -------------------------------------------------------------------------
  await runTest('B1. background.js forwards singleBlock: Boolean(message.singleBlock) in OCR_RECOGNIZE_IMAGE', () => {
    const bgMatch = backgroundSrc.match(/case\s+'OCR_RECOGNIZE_IMAGE'\s*:\s*\{([\s\S]*?)break;\s*\}/);
    assert.ok(bgMatch, 'Could not locate case OCR_RECOGNIZE_IMAGE in background.js');
    assert.match(
      bgMatch[1],
      /sendToOffscreen\(\s*\{[\s\S]*?type:\s*'OFFSCREEN_OCR_RECOGNIZE'[\s\S]*?singleBlock:\s*Boolean\(message\.singleBlock\)/,
      'background.js OCR_RECOGNIZE_IMAGE must forward singleBlock: Boolean(message.singleBlock) to OFFSCREEN_OCR_RECOGNIZE'
    );
  });

  await runTest('B2. offscreen.js passes { singleBlock: Boolean(message.singleBlock) } to runOcrRecognition', () => {
    const offMatch = offscreenSrc.match(/case\s+'OFFSCREEN_OCR_RECOGNIZE'\s*:\s*\{([\s\S]*?)return true;\s*\}/);
    assert.ok(offMatch, 'Could not locate case OFFSCREEN_OCR_RECOGNIZE in offscreen.js');
    assert.match(
      offMatch[1],
      /runOcrRecognition\([\s\S]*?\{\s*singleBlock:\s*Boolean\(message\.singleBlock\)\s*\}/,
      'offscreen.js OFFSCREEN_OCR_RECOGNIZE must pass { singleBlock: Boolean(message.singleBlock) } to runOcrRecognition'
    );
  });

  // -------------------------------------------------------------------------
  // Part C: content.js, content.css, i18n.js contracts
  // -------------------------------------------------------------------------
  await runTest('C1. i18n.js defines overlayDeleteBlock, overlayAddRegion, areaAddRegionHint in both ja and en', () => {
    const i18nModule = { exports: {} };
    const i18nSandbox = { module: i18nModule, exports: i18nModule.exports };
    vm.createContext(i18nSandbox);
    vm.runInContext(i18nSrc, i18nSandbox);
    const { MESSAGES } = i18nSandbox.module.exports;

    for (const locale of ['ja', 'en']) {
      for (const key of ['overlayDeleteBlock', 'overlayAddRegion', 'areaAddRegionHint']) {
        assert.strictEqual(typeof MESSAGES[locale][key], 'string', `${locale}.${key} must be defined`);
        assert.ok(MESSAGES[locale][key].trim().length > 0, `${locale}.${key} must be non-empty`);
      }
    }
  });

  await runTest('C2. content.js renders [data-box-action="delete"] (aria-label) + .plamo-ext-img-box-text and updates textSpan.textContent', () => {
    assert.ok(
      contentSrc.includes("textSpan.className = 'plamo-ext-img-box-text';"),
      'content.js must create .plamo-ext-img-box-text span inside overlay box'
    );
    assert.ok(
      contentSrc.includes("deleteBtn.setAttribute('data-box-action', 'delete');"),
      'content.js must set data-box-action="delete" on delete button'
    );
    assert.ok(
      contentSrc.includes("deleteBtn.setAttribute('aria-label', t('overlayDeleteBlock'));"),
      'content.js must set aria-label on delete button'
    );
    assert.ok(
      contentSrc.includes('boxEl.appendChild(textSpan);') && contentSrc.includes('boxEl.appendChild(deleteBtn);'),
      'content.js must append both textSpan and deleteBtn inside boxEl'
    );
    assert.match(
      contentSrc,
      /const\s+setBoxDisplayText\s*=\s*\(item,\s*text\)\s*=>\s*\{[\s\S]*?item\.textSpan\.textContent\s*=\s*text;/,
      'setBoxDisplayText must update item.textSpan.textContent instead of overwriting boxEl.textContent'
    );
    assert.ok(
      !/boxEl\.textContent\s*=/.test(contentSrc),
      'content.js must never overwrite boxEl.textContent (which would wipe child buttons)'
    );
  });

  await runTest('C3. content.js renders [data-action="add-region"] (aria-label, svg aria-hidden="true") and captures singleBlock with visibility restore', () => {
    const addBtnMatch = contentSrc.match(/<button[^>]*data-action="add-region"[^>]*>([\s\S]*?)<\/button>/);
    assert.ok(addBtnMatch, 'content.js must render button[data-action="add-region"]');
    assert.ok(addBtnMatch[0].includes('aria-label='), 'add-region button must include aria-label');
    assert.match(addBtnMatch[1], /<svg[^>]*aria-hidden="true"/, 'add-region SVG icon must include aria-hidden="true"');

    const appendFnMatch = contentSrc.match(/function\s+startAppendRegionCapture\s*\(\)\s*\{([\s\S]*?)\r?\n\s{4}\}/);
    assert.ok(appendFnMatch, 'Could not locate startAppendRegionCapture() in content.js');
    const appendBody = appendFnMatch[1];

    assert.match(appendBody, /container\.style\.visibility\s*=\s*'hidden'/, 'startAppendRegionCapture must hide container before capture');
    assert.match(appendBody, /container\.style\.visibility\s*=\s*''/, 'startAppendRegionCapture must restore container visibility');
    assert.match(appendBody, /promptScreenAreaSelection\s*\(/, 'startAppendRegionCapture must call promptScreenAreaSelection');
    assert.match(appendBody, /onCancel:\s*restoreVisibility/, 'promptScreenAreaSelection must pass onCancel: restoreVisibility');
    assert.match(appendBody, /onAfterCapture:\s*restoreVisibility/, 'promptScreenAreaSelection must pass onAfterCapture: restoreVisibility');
    assert.match(
      appendBody,
      /type:\s*'OCR_RECOGNIZE_IMAGE'[\s\S]*?singleBlock:\s*true/,
      'startAppendRegionCapture must pass singleBlock: true in OCR_RECOGNIZE_IMAGE'
    );
  });

  await runTest('C4. content.css defines .plamo-ext-img-box-delete hover/focus-within reveal, >=30px right hover padding, and focus-visible outline', () => {
    const delBaseMatch = contentCss.match(/(?:^|\r?\n)\.plamo-ext-img-box-delete\s*\{([^}]*)\}/);
    assert.ok(delBaseMatch, 'Could not find .plamo-ext-img-box-delete rule in content.css');
    assert.match(delBaseMatch[1], /opacity:\s*0\s*;/, '.plamo-ext-img-box-delete must default to opacity: 0');
    assert.match(delBaseMatch[1], /pointer-events:\s*none\s*;/, '.plamo-ext-img-box-delete must default to pointer-events: none');

    const delRevealMatch = contentCss.match(
      /\.plamo-ext-image-overlay-box:hover\s+\.plamo-ext-img-box-delete\s*,\s*[\r\n]+\s*\.plamo-ext-image-overlay-box:focus-within\s+\.plamo-ext-img-box-delete\s*\{([^}]*)\}/
    );
    assert.ok(delRevealMatch, 'Could not find :hover / :focus-within reveal rule for .plamo-ext-img-box-delete');
    assert.match(delRevealMatch[1], /opacity:\s*1\s*;/, 'Reveal rule must set opacity: 1');
    assert.match(delRevealMatch[1], /pointer-events:\s*auto\s*;/, 'Reveal rule must set pointer-events: auto');

    const boxHoverMatch = contentCss.match(
      /\.plamo-ext-image-overlay-box:hover\s*,\s*[\r\n]+\s*\.plamo-ext-image-overlay-box\.is-single-line:hover\s*\{([^}]*)\}/
    );
    assert.ok(boxHoverMatch, 'Could not find .plamo-ext-image-overlay-box:hover rule');
    const padMatch = boxHoverMatch[1].match(/padding:\s*(\d+)px\s+(\d+)px\s+(\d+)px\s+(\d+)px\s*;/);
    assert.ok(padMatch, 'Hover rule must define explicit 4-value padding');
    assert.ok(Number(padMatch[2]) >= 30, `Hover right padding must be >= 30px to clear delete button, got ${padMatch[2]}px`);

    const delFocusMatch = contentCss.match(/\.plamo-ext-img-box-delete:focus-visible\s*\{([^}]*)\}/);
    assert.ok(delFocusMatch, 'Could not find .plamo-ext-img-box-delete:focus-visible rule');
    assert.match(delFocusMatch[1], /outline:\s*[^;]+;/, '.plamo-ext-img-box-delete:focus-visible must define outline');
  });

  await runTest('C5. content.js supports right-click (contextmenu) deletion on overlay boxEl', () => {
    assert.match(
      contentSrc,
      /boxEl\.addEventListener\('contextmenu',\s*\(e\)\s*=>\s*\{[\s\S]*?e\.preventDefault\(\);[\s\S]*?e\.stopPropagation\(\);[\s\S]*?deleteBoxItem\(item\);[\s\S]*?\}\);/,
      'boxEl contextmenu handler must preventDefault, stopPropagation, and call deleteBoxItem(item)'
    );
  });

  await runTest('C6. content.js makes the expanded full-text drawer textarea editable with accessible label and copy sync', () => {
    const textareaTagMatch = contentSrc.match(/<textarea[^>]*class="plamo-ext-img-ov-textarea"[^>]*>/);
    assert.ok(textareaTagMatch, 'Could not find .plamo-ext-img-ov-textarea element in content.js');
    assert.ok(!/\breadonly\b/i.test(textareaTagMatch[0]), 'Drawer textarea must NOT have readonly attribute');
    assert.ok(/\baria-label="/.test(textareaTagMatch[0]), 'Drawer textarea must have aria-label');
    assert.match(contentSrc, /data-action="toggle-drawer"[^>]*aria-expanded="false"/, 'Drawer toggle button must initialize aria-expanded="false"');
    assert.match(contentSrc, /textareaEl\.addEventListener\('input'/, 'content.js must track edits via textarea input listener');
    assert.match(contentSrc, /const getEffectiveTranslatedText\s*=\s*\(\)/, 'content.js must expose getEffectiveTranslatedText for copy-current');
  });

  console.log(`\nTest Summary: ${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
