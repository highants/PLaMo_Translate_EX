const fs = require('fs');
const assert = require('assert');

const css = fs.readFileSync(__dirname + '/content.css', 'utf8');
const selectorIdx = css.lastIndexOf('.plamo-ext-area-selector {');
const selectorBlock = css.slice(selectorIdx, selectorIdx + 1500);

const match = selectorBlock.match(/cursor:\s*url\("data:image\/svg\+xml,([^"]+)"\)\s*(\d+)\s+(\d+)/);
if (!match) {
  console.error('FAIL: Could not find cursor SVG data URI in content.css');
  process.exit(1);
}

const encodedSvg = match[1];
const hotspotX = Number(match[2]);
const hotspotY = Number(match[3]);
const decodedSvg = decodeURIComponent(encodedSvg);

console.log('--- CURSOR SVG VALIDATION ---');
console.log('Hotspot coordinates:', hotspotX, hotspotY);
console.log('Decoded SVG content:\n' + decodedSvg + '\n');

// 1. Hotspot verification
assert.strictEqual(hotspotX, 16, 'Hotspot X must be center 16');
assert.strictEqual(hotspotY, 16, 'Hotspot Y must be center 16');

// 2. SVG XML Well-formedness checks
assert.ok(decodedSvg.startsWith("<svg xmlns='http://www.w3.org/2000/svg'"), 'SVG must define xmlns namespace');
assert.ok(decodedSvg.includes("width='32'") && decodedSvg.includes("height='32'"), 'SVG dimensions 32x32');
assert.ok(decodedSvg.includes("viewBox='0 0 32 32'"), 'SVG viewBox 0 0 32 32');
assert.ok(decodedSvg.endsWith('</svg>'), 'SVG must close properly with </svg>');

// 3. Dual-stroke paths and elements verification
// Outer black stroke (3.5px)
assert.ok(decodedSvg.includes("stroke='#000000'"), 'Contains black stroke');
assert.ok(decodedSvg.includes("stroke-width='3.5'"), 'Outer stroke width 3.5px');

// Inner white stroke (1.5px)
assert.ok(decodedSvg.includes("stroke='#FFFFFF'"), 'Contains white stroke');
assert.ok(decodedSvg.includes("stroke-width='1.5'"), 'Inner stroke width 1.5px');

// Center dual dots
assert.ok(decodedSvg.includes("r='2.5'"), 'Black outer center dot radius 2.5');
assert.ok(decodedSvg.includes("r='1.2'"), 'White inner center dot radius 1.2');

// 4. XML tag matching check
const openTags = (decodedSvg.match(/<[a-zA-Z]+/g) || []).map(t => t.slice(1));
const closeTags = (decodedSvg.match(/<\/[a-zA-Z]+/g) || []).map(t => t.slice(2));
const selfClosingTags = (decodedSvg.match(/<[a-zA-Z]+[^>]*\/>/g) || []);

console.log('Found tags:', openTags);
console.log('Self-closing tags count:', selfClosingTags.length);
console.log('Closing tags:', closeTags);

// <svg> is container, and <path .../>, <circle .../> are self-closing
assert.strictEqual(openTags.length - selfClosingTags.length, 1, 'Only <svg> is non-self-closing');
assert.strictEqual(closeTags.length, 1, 'Only </svg> is closing');
assert.strictEqual(closeTags[0], 'svg');

console.log('\n✓ All cursor SVG syntax and structure checks passed successfully!');
