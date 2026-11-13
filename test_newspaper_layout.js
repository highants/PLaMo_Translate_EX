/**
 * Unit tests for Japanese Newspaper Layout (Tategaki prose merging)
 * Tests:
 *   - mergeVerticalProseLinesIfAppropriate in offscreen.js
 *   - Chunichi Shimbun layout structure simulation
 */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');

// Extract mergeVerticalProseLinesIfAppropriate from offscreen.js
const offscreenSrc = fs.readFileSync(path.join(__dirname, 'offscreen.js'), 'utf8');
const match = offscreenSrc.match(/(function mergeVerticalProseLinesIfAppropriate[\s\S]*?\n\})/);
if (!match) {
  console.error('FAIL: Could not locate mergeVerticalProseLinesIfAppropriate in offscreen.js');
  process.exit(1);
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(match[1] + '\nglobalThis.mergeVerticalProseLinesIfAppropriate = mergeVerticalProseLinesIfAppropriate;', sandbox);
const mergeVerticalProseLinesIfAppropriate = sandbox.mergeVerticalProseLinesIfAppropriate;

// Also extract horizontal mergeProseLinesIfAppropriate and its required regexes for end-to-end simulation
const matchRegexes = offscreenSrc.match(/(const CJK_CHAR_REGEX[\s\S]*?const COLON_END_REGEX = [^;]+;)/);
const matchHoriz = offscreenSrc.match(/(function mergeProseLinesIfAppropriate[\s\S]*?\n\})/);
if (matchRegexes) {
  vm.runInContext(matchRegexes[1], sandbox);
}
if (matchHoriz) {
  vm.runInContext(matchHoriz[1] + '\nglobalThis.mergeProseLinesIfAppropriate = mergeProseLinesIfAppropriate;', sandbox);
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

console.log('Running Japanese Newspaper Layout (Tategaki Merging) Tests...\n');

// -------------------------------------------------------------
// Model Chunichi Shimbun Layout Structure:
// 1. 大見出し (Major Headline banner, w=65, y0: 30, y1: 280)
// 2. 中見出し (Medium Headline, w=35, y0: 50, y1: 240)
// 3. 上段本文 6列 (Upper tier body cols 1-6, w=18, y0: 100, y1: 280)
//    - Col 2 ends with '。'
//    - Col 3 is indented (y0: 114) -> represents paragraph break
// 4. サブ見出し (Sub Headline, w=35, y0: 100, y1: 220)
// 5. 上段本文 4列 (Upper tier body cols 7-10, w=18, y0: 100, y1: 280)
// 6. 下段本文 10列 (Lower tier body cols 1-10, w=18, y0: 350, y1: 550)
// 7. 横書き囲み枠 (Horizontal Callout box at lower left)
// -------------------------------------------------------------

const h1_major = {
  text: '次世代ＡＩモデル国産開発へ',
  confidence: 98,
  bbox: { x0: 720, y0: 30, x1: 785, y1: 280 }, // w = 65
  isVertical: true
};

const h2_medium = {
  text: '産学官で計算基盤構築',
  confidence: 96,
  bbox: { x0: 670, y0: 50, x1: 705, y1: 240 }, // w = 35
  isVertical: true
};

const upperBodyPart1 = [
  { text: '政府は十二日、国内の人工知能（ＡＩ）開発体制を大幅に', confidence: 95, bbox: { x0: 630, y0: 100, x1: 648, y1: 280 }, isVertical: true },
  { text: '強化する新たな基本計画の骨子案を明らかにした。', confidence: 95, bbox: { x0: 606, y0: 100, x1: 624, y1: 280 }, isVertical: true },
  // Indented by 14px (paragraph break!)
  { text: '米巨大ＩＴ企業に対抗するため、スーパーコンピューター', confidence: 94, bbox: { x0: 582, y0: 114, x1: 600, y1: 280 }, isVertical: true },
  { text: 'の整備費用を補助し、先端半導体の調達支援を拡充する。', confidence: 95, bbox: { x0: 558, y0: 100, x1: 576, y1: 280 }, isVertical: true },
  { text: 'これにより基礎モデルの計算資源不足を解消し、安全で', confidence: 93, bbox: { x0: 534, y0: 100, x1: 552, y1: 280 }, isVertical: true },
  { text: '信頼性の高い独自技術の確立を目指す方針だ。', confidence: 94, bbox: { x0: 510, y0: 100, x1: 528, y1: 280 }, isVertical: true }
];

const h3_sub = {
  text: '【半導体調達も支援】',
  confidence: 95,
  bbox: { x0: 455, y0: 100, x1: 490, y1: 220 }, // w = 35
  isVertical: true
};

const upperBodyPart2 = [
  { text: '計画案では産学官が連携するコンソーシアムを新設し、', confidence: 95, bbox: { x0: 425, y0: 100, x1: 443, y1: 280 }, isVertical: true },
  { text: '大学やスタートアップ企業にも計算環境を開放する。', confidence: 95, bbox: { x0: 401, y0: 100, x1: 419, y1: 280 }, isVertical: true },
  { text: '関係省庁は年内に詳細をまとめ、来年度予算案に関連費用', confidence: 94, bbox: { x0: 377, y0: 100, x1: 395, y1: 280 }, isVertical: true },
  { text: 'を盛り込む方向で財務省との最終調整に入る。', confidence: 95, bbox: { x0: 353, y0: 100, x1: 371, y1: 280 }, isVertical: true }
];

const lowerBodyCols = [];
for (let c = 0; c < 10; c++) {
  const x1 = 738 - c * 24;
  const x0 = x1 - 18;
  lowerBodyCols.push({
    text: `下段本文第${c + 1}列の記述内容。`,
    confidence: 94,
    bbox: { x0, y0: 350, x1, y1: 550 },
    isVertical: true
  });
}

const horizontalCallout = [
  { text: '◆ 関連記事：次世代半導体の国際共同開発ロードマップ', confidence: 92, bbox: { x0: 50, y0: 460, x1: 320, y1: 480 }, isVertical: false },
  { text: '日米欧の主要研究機関が参画し二〇二七年の量産を目指す', confidence: 93, bbox: { x0: 50, y0: 490, x1: 310, y1: 510 }, isVertical: false }
];

// Test 1: 大見出し・中見出しがフォントサイズ比率（minW / maxW < 0.55）により本文と混ざらず単独ブロックになること
runTest('1. 大見出し・中見出し・サブ見出しがフォントサイズ比率（minW / maxW < 0.55）により本文と混ざらず単独ブロックになること', () => {
  const allVert = [h1_major, h2_medium, ...upperBodyPart1, h3_sub, ...upperBodyPart2, ...lowerBodyCols];
  const merged = mergeVerticalProseLinesIfAppropriate(allVert, 600);

  // Block 0: 大見出し
  const b0 = merged[0];
  assert.strictEqual(b0.text, '次世代ＡＩモデル国産開発へ');
  assert.strictEqual(b0.bbox.x0, 720);
  assert.strictEqual(b0.bbox.x1, 785);

  // Block 1: 中見出し
  const b1 = merged[1];
  assert.strictEqual(b1.text, '産学官で計算基盤構築');
  assert.strictEqual(b1.bbox.x0, 670);
  assert.strictEqual(b1.bbox.x1, 705);

  // Block 3: サブ見出し
  const b3 = merged[3];
  assert.strictEqual(b3.text, '【半導体調達も支援】');
  assert.strictEqual(b3.bbox.x0, 455);
  assert.strictEqual(b3.bbox.x1, 490);
});

// Test 2: 上段本文の列が右から左へ1つのまとまり（isMultiLine: true）に統合され、矩形全体に拡張されること
runTest('2. 上段本文の列が右から左へ1つのまとまり（isMultiLine: true）に統合され、バウンディングボックスが矩形全体に拡張されること', () => {
  const allVert = [h1_major, h2_medium, ...upperBodyPart1, h3_sub, ...upperBodyPart2, ...lowerBodyCols];
  const merged = mergeVerticalProseLinesIfAppropriate(allVert, 600);

  // Block 2: 上段本文パート1 (6列)
  const b2 = merged[2];
  assert.strictEqual(b2.isMultiLine, true);
  // Spans from Col 6 (x0=510) to Col 1 (x1=648)
  assert.strictEqual(b2.bbox.x0, 510);
  assert.strictEqual(b2.bbox.x1, 648);
  assert.strictEqual(b2.bbox.y0, 100);
  assert.strictEqual(b2.bbox.y1, 280);
  assert.ok(b2.text.startsWith('政府は十二日'));
  assert.ok(b2.text.endsWith('目指す方針だ。'));

  // Block 4: 上段本文パート2 (4列)
  const b4 = merged[4];
  assert.strictEqual(b4.isMultiLine, true);
  // Spans from Col 10 (x0=353) to Col 7 (x1=443)
  assert.strictEqual(b4.bbox.x0, 353);
  assert.strictEqual(b4.bbox.x1, 443);
  assert.strictEqual(b4.bbox.y0, 100);
  assert.strictEqual(b4.bbox.y1, 280);
  assert.ok(b4.text.startsWith('計画案では産学官が'));
  assert.ok(b4.text.endsWith('最終調整に入る。'));
});

// Test 3: 下段本文の列が右から左へ1つのまとまりに統合され、上段とは混ざらないこと
runTest('3. 下段本文の10列が右から左へ1つのまとまりに統合され、段落境界ルールにより上段とは一切混ざらないこと', () => {
  const allVert = [h1_major, h2_medium, ...upperBodyPart1, h3_sub, ...upperBodyPart2, ...lowerBodyCols];
  const merged = mergeVerticalProseLinesIfAppropriate(allVert, 600);

  // Block 5: 下段本文 (10列)
  const b5 = merged[5];
  assert.strictEqual(b5.isMultiLine, true);
  // Spans from Col 10 (x0=504) to Col 1 (x1=738)
  assert.strictEqual(b5.bbox.x0, 504);
  assert.strictEqual(b5.bbox.x1, 738);
  assert.strictEqual(b5.bbox.y0, 350);
  assert.strictEqual(b5.bbox.y1, 550);
  assert.ok(b5.text.startsWith('下段本文第1列'));
  assert.ok(b5.text.endsWith('下段本文第10列の記述内容。'));

  // Must NOT contain any text from upper tier
  assert.ok(!b5.text.includes('政府は十二日'));
  assert.ok(!b5.text.includes('計画案では'));
});

// Test 4: 句点（。）＋字下げの段落境界が正しく認識されること
runTest('4. 句点（。）＋字下げの段落境界が正しく認識され、改行コード（\\n）が挿入されること', () => {
  const allVert = [h1_major, h2_medium, ...upperBodyPart1, h3_sub, ...upperBodyPart2, ...lowerBodyCols];
  const merged = mergeVerticalProseLinesIfAppropriate(allVert, 600);

  const b2 = merged[2]; // upperBodyPart1
  assert.ok(b2.text.includes('\n'), 'Must contain a newline representing paragraph break');
  const paragraphs = b2.text.split('\n');
  assert.strictEqual(paragraphs.length, 2, 'Should be split into 2 paragraphs');
  assert.ok(paragraphs[0].endsWith('明らかにした。'));
  assert.ok(paragraphs[1].startsWith('米巨大ＩＴ企業に対抗するため'));
});

// Test 5: エンドツーエンドのパイプライン検証（横書き囲み枠と縦書き本文の共存）
runTest('5. エンドツーエンド検証: 縦書き段組み記事と横書き囲み枠がそれぞれのバッファで正しく統合されること', () => {
  const fullArticle = [
    h1_major,
    h2_medium,
    ...upperBodyPart1,
    h3_sub,
    ...upperBodyPart2,
    ...lowerBodyCols,
    ...horizontalCallout
  ];

  // Simulate offscreen.js lineBlocks routing
  const blocks = [];
  let horizBuffer = [];
  let vertBuffer = [];

  function flushHorizBuffer() {
    if (horizBuffer.length > 0) {
      blocks.push(...sandbox.mergeProseLinesIfAppropriate(horizBuffer, 800));
      horizBuffer = [];
    }
  }
  function flushVertBuffer() {
    if (vertBuffer.length > 0) {
      blocks.push(...mergeVerticalProseLinesIfAppropriate(vertBuffer, 600));
      vertBuffer = [];
    }
  }

  for (const blk of fullArticle) {
    if (blk.isVertical) {
      flushHorizBuffer();
      vertBuffer.push(blk);
    } else {
      flushVertBuffer();
      horizBuffer.push(blk);
    }
  }
  flushHorizBuffer();
  flushVertBuffer();

  // 6 vertical blocks + 1 horizontal callout block = 7 blocks total
  assert.strictEqual(blocks.length, 7, `Expected 7 blocks total, got ${blocks.length}`);

  const calloutBlock = blocks[6];
  assert.strictEqual(calloutBlock.isMultiLine, true);
  assert.ok(calloutBlock.text.includes('◆ 関連記事：次世代半導体の国際共同開発ロードマップ'));
  assert.ok(calloutBlock.text.includes('二〇二七年の量産を目指す'));
  assert.strictEqual(calloutBlock.bbox.x0, 50);
  assert.strictEqual(calloutBlock.bbox.y0, 460);
  assert.strictEqual(calloutBlock.bbox.y1, 510);
});

console.log(`\nTest Summary: ${passCount} passed, ${failCount} failed.`);
if (failCount > 0) {
  process.exit(1);
} else {
  console.log('All Japanese newspaper layout tests passed successfully!');
}
