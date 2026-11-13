/**
 * Unit tests for OCR engine/language routing and UI localization checks:
 *   - OCR_LANG_MAP & resolveTesseractLangs in offscreen.js
 *   - isLikelyEnglishText & runOcrRecognition in offscreen.js
 *   - Model name labels in i18n.js and ja-tesseract option in content.js
 */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');

// 1. Extract OCR_LANG_MAP + resolveTesseractLangs and isLikelyEnglishText + runOcrRecognition from offscreen.js
const offscreenSrc = fs.readFileSync(path.join(__dirname, 'offscreen.js'), 'utf8');

const matchLangMap = offscreenSrc.match(
  /(const OCR_LANG_MAP\s*=\s*\{[\s\S]*?function resolveTesseractLangs\([\s\S]*?\n\})/
);
if (!matchLangMap) {
  console.error('FAIL: Could not locate OCR_LANG_MAP / resolveTesseractLangs in offscreen.js');
  process.exit(1);
}

const matchRouting = offscreenSrc.match(
  /(function isLikelyEnglishText\([\s\S]*?function runOcrRecognition\([\s\S]*?\n\})/
);
if (!matchRouting) {
  console.error('FAIL: Could not locate isLikelyEnglishText / runOcrRecognition in offscreen.js');
  process.exit(1);
}

const sandbox = {
  console: {
    warn: () => {},
    log: () => {},
    error: () => {}
  },
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
  globalThis.runOcrRecognition = runOcrRecognition;
  `,
  sandbox
);

const { resolveTesseractLangs, isLikelyEnglishText, runOcrRecognition } = sandbox;

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
  console.log('Running OCR Engine / Language Routing Unit Tests...\n');

  // --- TEST SET 1: resolveTesseractLangs ---
  await runTest("1a. resolveTesseractLangs('ja-tesseract') === 'jpn+eng'", () => {
    assert.strictEqual(resolveTesseractLangs('ja-tesseract'), 'jpn+eng');
  });

  await runTest("1b. resolveTesseractLangs('ja') === 'jpn+eng'", () => {
    assert.strictEqual(resolveTesseractLangs('ja'), 'jpn+eng');
  });

  await runTest("1c. resolveTesseractLangs('en') === 'eng'", () => {
    assert.strictEqual(resolveTesseractLangs('en'), 'eng');
  });

  // --- TEST SET 2: isLikelyEnglishText ---
  await runTest('2a. isLikelyEnglishText returns true for English prose and labels', () => {
    assert.strictEqual(isLikelyEnglishText('How teams are building with the Decisions API'), true);
    assert.strictEqual(isLikelyEnglishText('Decisions API\n123'), true);
  });

  await runTest('2b. isLikelyEnglishText returns true for English text with 1 stray kanji artifact', () => {
    assert.strictEqual(isLikelyEnglishText('Decisions API 見'), true);
  });

  await runTest('2c. isLikelyEnglishText returns false for Japanese, Korean, and empty text', () => {
    assert.strictEqual(isLikelyEnglishText('日本語のテキスト'), false);
    assert.strictEqual(isLikelyEnglishText('設定'), false);
    assert.strictEqual(isLikelyEnglishText('설정'), false);
    assert.strictEqual(isLikelyEnglishText(''), false);
    assert.strictEqual(isLikelyEnglishText('   '), false);
  });

  // --- TEST SET 3: runOcrRecognition routing ---
  await runTest("3a. 'en' routes to runTesseractOcr(..., 'en') even when engine === 'ndlocr'", async () => {
    const calls = [];
    sandbox.mockRunNdlOcr = async () => {
      calls.push({ engine: 'ndl' });
      return { text: 'should not run', blocks: [] };
    };
    sandbox.mockRunTesseractOcr = async (img, lang) => {
      calls.push({ engine: 'tesseract', img, lang });
      return { text: 'Hello World', blocks: [{ text: 'Hello World' }] };
    };

    const res = await runOcrRecognition('data:image/png;base64,AAA', 'en', 'ndlocr');
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0], { engine: 'tesseract', img: 'data:image/png;base64,AAA', lang: 'en' });
    assert.strictEqual(res.detectedOcrLang, 'en');
    assert.strictEqual(res.text, 'Hello World');
  });

  await runTest("3b. 'ja-tesseract' routes to runTesseractOcr(..., 'ja-tesseract') even when engine === 'ndlocr'", async () => {
    const calls = [];
    sandbox.mockRunNdlOcr = async () => {
      calls.push({ engine: 'ndl' });
      return { text: 'should not run', blocks: [] };
    };
    sandbox.mockRunTesseractOcr = async (img, lang) => {
      calls.push({ engine: 'tesseract', img, lang });
      return { text: '日本語テスト', blocks: [{ text: '日本語テスト' }] };
    };

    const res = await runOcrRecognition('data:image/png;base64,BBB', 'ja-tesseract', 'ndlocr');
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0], { engine: 'tesseract', img: 'data:image/png;base64,BBB', lang: 'ja-tesseract' });
    assert.strictEqual(res.detectedOcrLang, 'ja-tesseract');
    assert.strictEqual(res.text, '日本語テスト');
  });

  await runTest("3c. 'ja' routes to runNdlOcr even when engine === 'tesseract'", async () => {
    const calls = [];
    sandbox.mockRunNdlOcr = async (img) => {
      calls.push({ engine: 'ndl', img });
      return { text: '日本語の文章', blocks: [{ text: '日本語の文章' }] };
    };
    sandbox.mockRunTesseractOcr = async (img, lang) => {
      calls.push({ engine: 'tesseract', img, lang });
      return { text: 'fallback', blocks: [] };
    };

    const res = await runOcrRecognition('data:image/png;base64,CCC', 'ja', 'tesseract');
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0], { engine: 'ndl', img: 'data:image/png;base64,CCC' });
    assert.strictEqual(res.detectedOcrLang, 'ja');
    assert.strictEqual(res.text, '日本語の文章');
  });

  await runTest("3d. 'ja' falls back to runTesseractOcr(..., 'ja-tesseract') when runNdlOcr rejects", async () => {
    const calls = [];
    sandbox.mockRunNdlOcr = async (img) => {
      calls.push({ engine: 'ndl', img });
      throw new Error('NDLOCR failed');
    };
    sandbox.mockRunTesseractOcr = async (img, lang) => {
      calls.push({ engine: 'tesseract', img, lang });
      return { text: 'フォールバック結果', blocks: [{ text: 'フォールバック結果' }] };
    };

    const res = await runOcrRecognition('data:image/png;base64,DDD', 'ja', 'tesseract');
    assert.strictEqual(calls.length, 2);
    assert.deepStrictEqual(calls[0], { engine: 'ndl', img: 'data:image/png;base64,DDD' });
    assert.deepStrictEqual(calls[1], { engine: 'tesseract', img: 'data:image/png;base64,DDD', lang: 'ja-tesseract' });
    assert.strictEqual(res.detectedOcrLang, 'ja-tesseract');
    assert.strictEqual(res.text, 'フォールバック結果');
  });

  await runTest("3e. 'auto' with engine === 'ndlocr' switches to runTesseractOcr(..., 'en') when NDLOCR returns English text", async () => {
    const calls = [];
    sandbox.mockRunNdlOcr = async (img) => {
      calls.push({ engine: 'ndl', img });
      return { text: 'How teams are building with the Decisions API', blocks: [] };
    };
    sandbox.mockRunTesseractOcr = async (img, lang) => {
      calls.push({ engine: 'tesseract', img, lang });
      return { text: 'How teams are building with the Decisions API', blocks: [] };
    };

    const res = await runOcrRecognition('data:image/png;base64,EEE', 'auto', 'ndlocr');
    assert.strictEqual(calls.length, 2);
    assert.deepStrictEqual(calls[0], { engine: 'ndl', img: 'data:image/png;base64,EEE' });
    assert.deepStrictEqual(calls[1], { engine: 'tesseract', img: 'data:image/png;base64,EEE', lang: 'en' });
    assert.strictEqual(res.detectedOcrLang, 'en');
  });

  await runTest("3f. 'auto' with engine === 'ndlocr' keeps NDLOCR result when NDLOCR returns Japanese text", async () => {
    const calls = [];
    sandbox.mockRunNdlOcr = async (img) => {
      calls.push({ engine: 'ndl', img });
      return { text: 'これは日本語のテキストです', blocks: [{ text: 'これは日本語のテキストです' }] };
    };
    sandbox.mockRunTesseractOcr = async (img, lang) => {
      calls.push({ engine: 'tesseract', img, lang });
      return { text: 'should not run', blocks: [] };
    };

    const res = await runOcrRecognition('data:image/png;base64,FFF', 'auto', 'ndlocr');
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0], { engine: 'ndl', img: 'data:image/png;base64,FFF' });
    assert.strictEqual(res.detectedOcrLang, 'ja');
    assert.strictEqual(res.text, 'これは日本語のテキストです');
  });

  await runTest("3g. 'auto' with engine === 'tesseract' runs runTesseractOcr(..., 'auto')", async () => {
    const calls = [];
    sandbox.mockRunNdlOcr = async () => {
      calls.push({ engine: 'ndl' });
      return { text: 'should not run', blocks: [] };
    };
    sandbox.mockRunTesseractOcr = async (img, lang) => {
      calls.push({ engine: 'tesseract', img, lang });
      return { text: 'Auto Tesseract result', blocks: [] };
    };

    const res = await runOcrRecognition('data:image/png;base64,GGG', 'auto', 'tesseract');
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0], { engine: 'tesseract', img: 'data:image/png;base64,GGG', lang: 'auto' });
    assert.strictEqual(res.text, 'Auto Tesseract result');
  });

  // --- TEST SET 4: i18n.js and content.js UI assertions ---
  await runTest('4a. i18n.js (ja & en) OCR language options include model names (NDLOCR-Lite or Tesseract)', () => {
    const i18nSrc = fs.readFileSync(path.join(__dirname, 'i18n.js'), 'utf8');
    const i18nModule = { exports: {} };
    const i18nSandbox = { module: i18nModule, exports: i18nModule.exports };
    vm.createContext(i18nSandbox);
    vm.runInContext(i18nSrc, i18nSandbox);
    const { MESSAGES } = i18nSandbox.module.exports;

    const keys = ['optOcrLangJa', 'optOcrLangJaTesseract', 'optOcrLangEn', 'optOcrLangAuto'];
    for (const locale of ['ja', 'en']) {
      for (const key of keys) {
        const label = MESSAGES[locale][key];
        assert.strictEqual(typeof label, 'string', `${locale}.${key} must be a string`);
        assert.ok(
          /NDLOCR-Lite|Tesseract/.test(label),
          `${locale}.${key} ("${label}") must include NDLOCR-Lite or Tesseract`
        );
      }
    }
  });

  await runTest('4b. content.js includes value="ja-tesseract"', () => {
    const contentSrc = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');
    assert.ok(
      contentSrc.includes('value="ja-tesseract"'),
      'content.js must include value="ja-tesseract"'
    );
  });

  // --- TEST SET 5: Source language resolution (preventing NDLOCR-Lite ZH->EN misclassification) ---
  await runTest('5a. background.js resolveDetectedLanguage overrides CLD "zh" to "ja" when text contains kana', async () => {
    const bgSrc = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');
    const pfmlSrc = fs.readFileSync(path.join(__dirname, 'pfml.js'), 'utf8');
    const fnMatch = bgSrc.match(/(async function resolveDetectedLanguage\([\s\S]*?\r?\n\})/);
    assert.ok(fnMatch, 'Could not extract resolveDetectedLanguage from background.js');

    let mockLanguages = [{ language: 'zh', percentage: 90 }];
    const bgSandbox = {
      chrome: {
        i18n: {
          detectLanguage: (_txt, cb) => cb({ languages: mockLanguages })
        }
      },
      console: { warn: () => {} }
    };
    vm.createContext(bgSandbox);
    vm.runInContext(`${pfmlSrc}\n${fnMatch[1]}\nglobalThis.resolveDetectedLanguage = resolveDetectedLanguage;`, bgSandbox);

    assert.strictEqual(await bgSandbox.resolveDetectedLanguage('新機能一覧の設定', 'auto'), 'ja');
    mockLanguages = [{ language: 'zh-TW', percentage: 95 }];
    assert.strictEqual(await bgSandbox.resolveDetectedLanguage('東京都の本社', 'auto'), 'ja');
    mockLanguages = [{ language: 'zh', percentage: 95 }];
    assert.strictEqual(await bgSandbox.resolveDetectedLanguage('简体中文测试文本', 'auto'), 'zh');
    assert.strictEqual(await bgSandbox.resolveDetectedLanguage('東京都渋谷区', 'ja'), 'ja');
  });

  await runTest('5b. content.js resolves overlay sourceLang to "ja" for NDLOCR-Lite / CJK blocks and aggregates pairCounts', () => {
    const contentSrc = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');
    const helperMatch = contentSrc.match(
      /const KANA_LETTER_REGEX = (\/[\s\S]*?\/);[\s\S]*?const CJK_SCRIPT_REGEX = (\/[\s\S]*?\/);[\s\S]*?(function resolveOverlaySourceLang\([\s\S]*?\r?\n\s{4}\})/
    );
    assert.ok(helperMatch, 'Could not locate resolveOverlaySourceLang in content.js');

    const ovSandbox = {
      activeOcrLang: 'auto',
      lastOcrDetectedLang: 'ja',
      allText: '設定の保存\n東京都',
      pageLang: '',
      KANA_LETTER_REGEX: null,
      CJK_SCRIPT_REGEX: null
    };
    vm.createContext(ovSandbox);
    vm.runInContext(`
      const KANA_LETTER_REGEX = ${helperMatch[1]};
      const CJK_SCRIPT_REGEX = ${helperMatch[2]};
      function getActiveOriginalText() { return globalThis.allText; }
      function getOverlayPageLang() { return globalThis.pageLang; }
      ${helperMatch[3]}
      globalThis.resolveOverlaySourceLang = resolveOverlaySourceLang;
    `, ovSandbox);

    // Kanji-only block inside a Japanese NDLOCR-Lite session -> 'ja'
    assert.strictEqual(ovSandbox.resolveOverlaySourceLang('東京都'), 'ja');
    // Pure Kanji single-crop on non-zh page when NDLOCR-Lite ran -> 'ja'
    ovSandbox.allText = '会社概要';
    assert.strictEqual(ovSandbox.resolveOverlaySourceLang('会社概要'), 'ja');
    // Pure English block inside Japanese image stays undefined ('auto' -> 'en')
    assert.strictEqual(ovSandbox.resolveOverlaySourceLang('Architecture'), undefined);
    // Chinese page with no Kana and NDLOCR fallback -> undefined (allows 'zh')
    ovSandbox.pageLang = 'zh-cn';
    assert.strictEqual(ovSandbox.resolveOverlaySourceLang('系统设置'), undefined);

    assert.match(contentSrc, /lastOcrDetectedLang\s*=\s*ocrRes\.detectedOcrLang\s*\|\|\s*''/);
    assert.match(contentSrc, /resolveOverlaySourceLang\(blk\.text\)/);
    assert.match(contentSrc, /resolveOverlaySourceLang\(batchText\)/);
    assert.match(contentSrc, /pickBestPair\s*=\s*\(\)\s*=>/);
  });

  // --- TEST SET 6: Sidebar/Popup layout & keep-open contracts ---
  await runTest('6a. popup.js keeps sidebar open when triggering Area OCR translation (no window.close)', () => {
    const popupJs = fs.readFileSync(path.join(__dirname, 'popup.js'), 'utf8');
    const ocrBlockMatch = popupJs.match(/if\s*\(\s*btnAreaOcrTranslate\s*\)\s*\{([\s\S]*?)\r?\n\s{2}\}/);
    assert.ok(ocrBlockMatch, 'Could not locate btnAreaOcrTranslate handler in popup.js');
    assert.ok(
      ocrBlockMatch[1].includes("type: 'START_AREA_OCR_TRANSLATION'"),
      'btnAreaOcrTranslate must send START_AREA_OCR_TRANSLATION'
    );
    assert.ok(
      !/window\.close\s*\(/.test(ocrBlockMatch[1]),
      'btnAreaOcrTranslate must NOT call window.close() so the sidebar remains open'
    );
  });

  await runTest('6b. popup.html places engine-mode-pills next to header-status and btnAreaOcrTranslate directly right of btnGrabSelection', () => {
    const popupHtml = fs.readFileSync(path.join(__dirname, 'popup.html'), 'utf8');
    const headerRowMatch = popupHtml.match(/<div class="header-engine-row">([\s\S]*?)<\/div>\s*<\/header>/);
    assert.ok(headerRowMatch, 'popup.html must define .header-engine-row inside header');
    assert.ok(headerRowMatch[1].includes('class="engine-mode-pills"'), '.header-engine-row must contain .engine-mode-pills');
    assert.ok(headerRowMatch[1].includes('class="header-status"'), '.header-engine-row must contain .header-status');

    const toolsMatch = popupHtml.match(/<section class="quick-tools-bar">([\s\S]*?)<\/section>/);
    assert.ok(toolsMatch, 'popup.html must define .quick-tools-bar');
    const grabIdx = toolsMatch[1].indexOf('id="btnGrabSelection"');
    const ocrIdx = toolsMatch[1].indexOf('id="btnAreaOcrTranslate"');
    const pageIdx = toolsMatch[1].indexOf('id="btnPageTranslate"');
    assert.ok(grabIdx !== -1 && ocrIdx !== -1 && pageIdx !== -1, 'All 3 quick tool buttons must be present');
    assert.ok(grabIdx < ocrIdx && ocrIdx < pageIdx, 'btnAreaOcrTranslate must sit immediately right of btnGrabSelection before btnPageTranslate');
  });

  await runTest('6c. popup.html places #settingsPanel at top right after header (before quick-tools-bar & main)', () => {
    const popupHtml = fs.readFileSync(path.join(__dirname, 'popup.html'), 'utf8');
    const headerEndIdx = popupHtml.indexOf('</header>');
    const settingsIdx = popupHtml.indexOf('id="settingsPanel"');
    const toolsIdx = popupHtml.indexOf('class="quick-tools-bar"');
    const mainIdx = popupHtml.indexOf('<main class="translation-workspace"');
    assert.ok(headerEndIdx !== -1 && settingsIdx !== -1 && toolsIdx !== -1 && mainIdx !== -1);
    assert.ok(headerEndIdx < settingsIdx && settingsIdx < toolsIdx && toolsIdx < mainIdx, '#settingsPanel must appear directly after header above quick-tools-bar and main');
    assert.match(popupHtml, /id="btnToggleSettings"[^>]*aria-expanded="false"/, 'btnToggleSettings must include aria-expanded="false"');
  });

  await runTest('6d. quick-tools-bar buttons have distinct color variant classes and light/dark styles', () => {
    const popupHtml = fs.readFileSync(path.join(__dirname, 'popup.html'), 'utf8');
    const popupCss = fs.readFileSync(path.join(__dirname, 'popup.css'), 'utf8');
    assert.match(popupHtml, /id="btnGrabSelection"[^>]*class="[^"]*\bbtn-tool-selection\b/);
    assert.match(popupHtml, /id="btnAreaOcrTranslate"[^>]*class="[^"]*\bbtn-tool-ocr\b/);
    assert.match(popupHtml, /id="btnPageTranslate"[^>]*class="[^"]*\bbtn-tool-page\b/);

    for (const cls of ['.btn-tool-selection', '.btn-tool-ocr', '.btn-tool-page']) {
      assert.ok(popupCss.includes(`${cls} {`), `popup.css must define ${cls}`);
      assert.ok(popupCss.includes(`${cls}:hover {`), `popup.css must define ${cls}:hover`);
      assert.ok(popupCss.includes(`${cls}:focus-visible {`), `popup.css must define ${cls}:focus-visible`);
    }
    const darkBlock = popupCss.match(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{[\s\S]*\.btn-tool-selection[\s\S]*\.btn-tool-ocr[\s\S]*\.btn-tool-page[\s\S]*\}/);
    assert.ok(darkBlock, 'popup.css must include dark mode styles for all 3 quick tool buttons');
  });

  console.log(`\nSummary: ${passCount} passed, ${failCount} failed`);
  if (failCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
