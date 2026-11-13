/**
 * Unit & contract tests for OCR overlay toolbar dragging and
 * viewport-safe clamping (full-screen images, narrow Chrome Side Panel viewports,
 * drawer orientation, and listener cleanup).
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const contentJs = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');
const contentCss = fs.readFileSync(path.join(__dirname, 'content.css'), 'utf8');

const fnMatch = contentJs.match(
  /(function computeOverlayToolbarLayout\([\s\S]*?)\r?\n\s*async function runOcrOverlayPipeline/
);
if (!fnMatch) {
  console.error('FAIL: Could not extract computeOverlayToolbarLayout from content.js');
  process.exit(1);
}

const sandbox = { Math };
vm.createContext(sandbox);
vm.runInContext(
  `
  ${fnMatch[1]}
  globalThis.computeOverlayToolbarLayout = computeOverlayToolbarLayout;
  `,
  sandbox
);

const { computeOverlayToolbarLayout } = sandbox;
assert.strictEqual(typeof computeOverlayToolbarLayout, 'function', 'computeOverlayToolbarLayout must be extracted');

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

console.log('Running OCR Overlay Toolbar Drag & Viewport Clamping Tests...\n');

runTest('1. Normal mid-screen image positions toolbar above image with downward drawer', () => {
  const layout = computeOverlayToolbarLayout({
    containerRect: { left: 200, top: 250, right: 700, bottom: 550, width: 500, height: 300 },
    toolbarSize: { width: 520, height: 42 },
    viewport: { width: 1280, height: 800 }
  });
  assert.strictEqual(layout.viewportLeft, 200);
  assert.strictEqual(layout.viewportTop, 250 - 42 - 6);
  assert.strictEqual(layout.relLeft, 0);
  assert.strictEqual(layout.relTop, -48);
  assert.strictEqual(layout.placeBelowContainer, false);
  assert.strictEqual(layout.openDrawerUpward, false);
});

runTest('2. Short image near top edge flips toolbar below image without clipping top', () => {
  const layout = computeOverlayToolbarLayout({
    containerRect: { left: 100, top: 12, right: 500, bottom: 212, width: 400, height: 200 },
    toolbarSize: { width: 500, height: 40 },
    viewport: { width: 1280, height: 800 }
  });
  assert.strictEqual(layout.viewportTop, 218);
  assert.strictEqual(layout.placeBelowContainer, true);
  assert.ok(layout.viewportTop >= 10 && layout.viewportTop + 40 <= 790);
});

runTest('3. Full-screen image pins toolbar inside top-left viewport bounds instead of off-screen bottom/top', () => {
  const layout = computeOverlayToolbarLayout({
    containerRect: { left: 0, top: 0, right: 1280, bottom: 800, width: 1280, height: 800 },
    toolbarSize: { width: 560, height: 42 },
    viewport: { width: 1280, height: 800 }
  });
  assert.strictEqual(layout.viewportLeft, 10);
  assert.strictEqual(layout.viewportTop, 10);
  assert.strictEqual(layout.relLeft, 10);
  assert.strictEqual(layout.relTop, 10);
  assert.strictEqual(layout.openDrawerUpward, false);
  assert.ok(layout.maxDrawerHeight <= 800 - 10 - (10 + 42 + 4));
});

runTest('4. Tall scrolled image keeps toolbar pinned near viewport top until image bottom scrolls past', () => {
  const midScroll = computeOverlayToolbarLayout({
    containerRect: { left: 80, top: -450, right: 880, bottom: 750, width: 800, height: 1200 },
    toolbarSize: { width: 540, height: 40 },
    viewport: { width: 1200, height: 800 }
  });
  assert.strictEqual(midScroll.viewportTop, 10);
  assert.strictEqual(midScroll.relTop, 460);

  const scrolledPast = computeOverlayToolbarLayout({
    containerRect: { left: 80, top: -1170, right: 880, bottom: 30, width: 800, height: 1200 },
    toolbarSize: { width: 540, height: 40 },
    viewport: { width: 1200, height: 800 }
  });
  assert.ok(scrolledPast.viewportTop < 0, 'Toolbar glides off top when image almost scrolled away');
});

runTest('5. Narrow Chrome Side Panel viewport clamps right-edge & left-clipped images inside bounds', () => {
  const nearRight = computeOverlayToolbarLayout({
    containerRect: { left: 320, top: 150, right: 540, bottom: 450, width: 220, height: 300 },
    toolbarSize: { width: 460, height: 68 },
    viewport: { width: 560, height: 800 }
  });
  assert.strictEqual(nearRight.viewportLeft, 90);
  assert.strictEqual(nearRight.viewportLeft + 460, 550);

  const leftClipped = computeOverlayToolbarLayout({
    containerRect: { left: -120, top: 0, right: 480, bottom: 800, width: 600, height: 800 },
    toolbarSize: { width: 460, height: 68 },
    viewport: { width: 520, height: 800 }
  });
  assert.strictEqual(leftClipped.viewportLeft, 10);
  assert.strictEqual(leftClipped.viewportTop, 10);
});

runTest('6. Image near bottom of viewport flips drawer upward with bounded height', () => {
  const layout = computeOverlayToolbarLayout({
    containerRect: { left: 100, top: 680, right: 600, bottom: 820, width: 500, height: 140 },
    toolbarSize: { width: 500, height: 40 },
    viewport: { width: 1200, height: 740 }
  });
  assert.strictEqual(layout.viewportTop, 634);
  assert.strictEqual(layout.openDrawerUpward, true);
  assert.ok(layout.maxDrawerHeight <= 634 - 4 - 10);
});

runTest('7. User-dragged offset moves freely below/outside container and clamps to viewport on resize/drag', () => {
  const draggedBelow = computeOverlayToolbarLayout({
    containerRect: { left: 100, top: 100, right: 600, bottom: 450, width: 500, height: 350 },
    toolbarSize: { width: 500, height: 40 },
    viewport: { width: 1280, height: 800 },
    userOffset: { relLeft: 20, relTop: 400 },
    clampUserToViewport: true
  });
  // relTop=400 puts toolbar at vpTop=500 (50px below container bottom=450), NOT trapped inside container
  assert.strictEqual(draggedBelow.viewportLeft, 120);
  assert.strictEqual(draggedBelow.viewportTop, 500);

  const sidePanelOpened = computeOverlayToolbarLayout({
    containerRect: { left: 100, top: 100, right: 600, bottom: 450, width: 500, height: 350 },
    toolbarSize: { width: 500, height: 40 },
    viewport: { width: 640, height: 800 },
    userOffset: { relLeft: 520, relTop: 400 },
    clampUserToViewport: true
  });
  assert.strictEqual(sidePanelOpened.viewportLeft, 130);
  assert.strictEqual(sidePanelOpened.viewportLeft + 500, 630);
  assert.strictEqual(sidePanelOpened.viewportTop, 500);
});

runTest('8. content.css defines grab/grabbing cursors, responsive wrap, drawer cursor reset & is-drawer-up', () => {
  const toolbarMatch = contentCss.match(/\.plamo-ext-img-ov-toolbar\s*\{([^}]*)\}/);
  assert.ok(toolbarMatch, 'Could not find .plamo-ext-img-ov-toolbar rule');
  assert.match(toolbarMatch[1], /cursor:\s*grab\s*;/);
  assert.match(toolbarMatch[1], /touch-action:\s*none\s*;/);
  assert.match(toolbarMatch[1], /flex-wrap:\s*wrap\s*;/);

  assert.match(contentCss, /\.plamo-ext-img-ov-toolbar\.is-dragging\s*\{[^}]*cursor:\s*grabbing\s*;/);
  assert.match(contentCss, /\.plamo-ext-img-ov-actions\s*\{[^}]*flex-wrap:\s*wrap\s*;/);
  assert.match(contentCss, /\.plamo-ext-img-ov-drawer\s*\{[^}]*cursor:\s*default\s*;[^}]*touch-action:\s*auto\s*;/);
  assert.match(contentCss, /\.plamo-ext-img-ov-toolbar\.is-drawer-up\s+\.plamo-ext-img-ov-drawer\s*\{[^}]*bottom:\s*calc\(100%\s*\+\s*4px\)\s*;/);
});

runTest('9. content.js ignores interactive toolbar controls on pointerdown drag and cleans up listeners', () => {
  assert.match(
    contentJs,
    /toolbarEl\.addEventListener\('pointerdown',\s*\(e\)\s*=>\s*\{[\s\S]*?if\s*\(e\.button\s*!==\s*0\)\s*return;[\s\S]*?closest\('select, button, input, label, option, textarea, a, \.plamo-ext-ov-toggle-wrap, \[data-role="drawer"\]'\)/
  );
  assert.match(contentJs, /window\.addEventListener\('scroll',\s*onWindowScroll,\s*\{\s*passive:\s*true\s*\}\)/);
  assert.match(contentJs, /window\.removeEventListener\('scroll',\s*onWindowScroll\)/);
  assert.match(contentJs, /window\.removeEventListener\('resize',\s*onWindowResize\)/);
  assert.match(contentJs, /window\.removeEventListener\('blur',\s*endToolbarDrag\)/);
  assert.match(contentJs, /toolbarResizeObserver\.disconnect\(\)/);
});

console.log(`\nSummary: ${passCount} passed, ${failCount} failed`);
process.exit(failCount > 0 ? 1 : 0);
