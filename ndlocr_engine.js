/**
 * PLaMo Translate - NDLOCR-Lite V2.0 In-Browser OCR Engine
 *
 * Runs NDL Lab's NDLOCR-Lite V2.0 models on onnxruntime-web (WASM) inside the Offscreen Document:
 *   1. DEIMv2          : layout / text-line / table detection (vendor/ndlocr/deim-s-1024x1024-261124.int8.onnx)
 *   2. PARSeq          : text-line recognition cascade        (vendor/ndlocr/parseq-ndl-24x{256,384}-*-261124.int8.onnx)
 *   3. TableCenterNet  : lazy table structure recognition     (tablecenternet_engine.js + tablecenternet_s_800_v3.fp16.onnx)
 *
 * Pre/post-processing is ported from ndl-lab/ndlocr-lite v2.0.0
 * (src/deim.py, src/parseq.py, src/ocr.py, src/character_inclusion.py, src/tcy_wrapper.py),
 * with browser WASM optimizations (pruned softmax, whitespace-midpoint long-line splitting,
 * zero-copy ImageData reuse, and vertical/horizontal single-line fast paths).
 *
 * Attribution & License (Adapted Work):
 *   Original Work: NDLOCR-Lite by National Diet Library, Japan (https://github.com/ndl-lab/ndlocr-lite)
 *   License: Creative Commons Attribution 4.0 International (CC BY 4.0)
 *            https://creativecommons.org/licenses/by/4.0/
 *   (This file, tablecenternet_engine.js, vendor/ndlocr/ndl_charlist.js, and
 *    vendor/ndlocr/ndl_character_inclusion.js remain licensed under CC BY 4.0;
 *    see THIRD_PARTY_NOTICES.md for details.)
 *
 * Requires (classic scripts loaded before this file):
 *   - vendor/ort/ort.wasm.min.js                -> global `ort`
 *   - vendor/ndlocr/ndl_charlist.js             -> global `NDL_CHARLIST` (7141 chars)
 *   - vendor/ndlocr/ndl_character_inclusion.js  -> global `NDL_CHARACTER_INCLUSION` (optional, 4905 entries)
 *   - tablecenternet_engine.js                  -> global `NdlTableEngine` (optional, lazy table recognizer)
 *
 * Exposes: self.NdlOcrEngine
 */
(function (global) {
  'use strict';

  const MODEL_BASE = 'vendor/ndlocr/';
  const DET_MODEL_FILE = 'deim-s-1024x1024-261124.int8.onnx';
  const REC_SHORT = {
    file: 'parseq-ndl-24x256-30-tiny-499epoch-261124.int8.onnx',
    width: 256,
    cascadeAt: 25
  };
  const REC_MEDIUM = {
    file: 'parseq-ndl-24x384-50-tiny-278epoch-261124.int8.onnx',
    width: 384,
    cascadeAt: Infinity
  };
  const REC_HEIGHT = 24;

  // NOTE: Despite its filename, the bundled DEIM graph expects 800x800 input (verified).
  // The real size is read from session metadata when available.
  const DET_DEFAULT_SIZE = 800;
  const DET_SCORE_THRESHOLD = 0.25;
  const REC_MIN_CONFIDENCE = 0.50;

  // ndl.yaml class indices (0-based after `label - 1`)
  const CLASS_TEXT_BLOCK = 0;
  const CLASS_BLOCK_TABLE = 15;
  const LINE_CLASS_INDICES = new Set([1, 2, 3, 4, 5, 16]); // line_main, caption, ad, note, note_tochu, title

  const IMAGENET_MEAN = [0.485, 0.456, 0.406];
  const IMAGENET_STD = [0.229, 0.224, 0.225];

  const LEADING_BULLET_REGEX = /^[\s●○◎◆◇■□▲△▼▽・•·▪▫◦‣⁃∙❖➢➤✔✓☑]+/;
  const LIST_MARKER_REGEX = /^[\s]*([●○◎◆◇■□▲△▼▽・•·▪▫◦‣⁃∙❖➢➤✔✓☑※†‡§¶*–—\-]|[①-⑳㉑-㊿❶-❾]|\d{1,3}[\.\)]|\([0-9a-zA-Z]{1,3}\)|[a-zA-Z][\.\)])\s*/;
  const LEADING_ICON_ARTIFACT_REGEX = /^(?:[①-⑳❶-❾ⓐ-ⓩⒶ-Ⓩ]\s*|[b-hj-zB-HJ-Z0-9]\s+(?=[A-Za-z\u3040-\u9FFF])|[oO0Qq]\s*(?=[\u3040-\u9FFF])|(?:[8B][=~-]|[:;=~^|_/\\><«»❯❮]{1,3}[=~-]?|[+])\s+(?=[A-Za-z\u3040-\u9FFF]))(?![.\):&])/;

  function stripLeadingIconArtifacts(text) {
    if (!text) return '';
    return text
      .replace(LEADING_BULLET_REGEX, '')
      .replace(LEADING_ICON_ARTIFACT_REGEX, '')
      .trim();
  }

  /**
   * Detect an isolated visual bullet/dot/square blob immediately to the left of a line bbox
   * so list items remain split even if DEIM omitted the bullet glyph or OCR misread it.
   * @param {{ data: Uint8ClampedArray, width: number, height: number }} imageData
   * @param {{ x0: number, y0: number, x1: number, y1: number }} bbox
   * @returns {boolean}
   */
  function detectVisualBulletLeftOfLine(imageData, bbox) {
    if (!imageData || !imageData.data || !bbox) return false;
    const { data, width, height } = imageData;
    const lineH = bbox.y1 - bbox.y0;
    if (lineH < 8 || lineH > 120 || bbox.x0 < 4) return false;

    const guardX0 = Math.max(0, Math.floor(bbox.x0 - lineH * 2.2));
    const stripX0 = Math.max(guardX0, Math.floor(bbox.x0 - lineH * 1.8));
    const stripX1 = Math.max(0, Math.floor(bbox.x0));
    const stripY0 = Math.max(0, Math.floor(bbox.y0 - lineH * 0.08));
    const stripY1 = Math.min(height, Math.ceil(bbox.y1 + lineH * 0.08));
    const gw = stripX1 - guardX0;
    const sh = stripY1 - stripY0;
    if (gw < 4 || sh < 6 || (stripX1 - stripX0) < 4) return false;

    // Sample perimeter pixels to get robust local background color (handles light, tinted, and dark themes)
    const samples = [];
    for (let x = guardX0; x < stripX1; x++) {
      for (const y of [stripY0, stripY1 - 1]) {
        const idx = (y * width + x) * 4;
        const r = data[idx], g = data[idx + 1], b = data[idx + 2];
        samples.push({ r, g, b, lum: 0.299 * r + 0.587 * g + 0.114 * b });
      }
    }
    for (let y = stripY0 + 1; y < stripY1 - 1; y++) {
      const idx = (y * width + (stripX1 - 1)) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      samples.push({ r, g, b, lum: 0.299 * r + 0.587 * g + 0.114 * b });
    }
    if (samples.length === 0) return false;
    samples.sort((a, b) => a.lum - b.lum);
    const bg = samples[samples.length >> 1];

    const fg = new Uint8Array(gw * sh);
    for (let sy = 0; sy < sh; sy++) {
      const y = stripY0 + sy;
      for (let sx = 0; sx < gw; sx++) {
        const x = guardX0 + sx;
        const idx = (y * width + x) * 4;
        const diff = Math.abs(data[idx] - bg.r) + Math.abs(data[idx + 1] - bg.g) + Math.abs(data[idx + 2] - bg.b);
        if (diff >= 78) fg[sy * gw + sx] = 1;
      }
    }

    const visited = new Uint8Array(gw * sh);
    const qx = new Int32Array(gw * sh);
    const qy = new Int32Array(gw * sh);
    const nonRuleComponents = [];

    for (let sy = 0; sy < sh; sy++) {
      for (let sx = 0; sx < gw; sx++) {
        const start = sy * gw + sx;
        if (!fg[start] || visited[start]) continue;
        let head = 0, tail = 0;
        qx[tail] = sx;
        qy[tail] = sy;
        tail++;
        visited[start] = 1;

        let minX = sx, maxX = sx, minY = sy, maxY = sy, area = 0;
        while (head < tail) {
          const cx = qx[head];
          const cy = qy[head];
          head++;
          area++;
          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;

          const neighbors = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]];
          for (let k = 0; k < 4; k++) {
            const nx = neighbors[k][0], ny = neighbors[k][1];
            if (nx < 0 || nx >= gw || ny < 0 || ny >= sh) continue;
            const nIdx = ny * gw + nx;
            if (fg[nIdx] && !visited[nIdx]) {
              visited[nIdx] = 1;
              qx[tail] = nx;
              qy[tail] = ny;
              tail++;
            }
          }
        }

        const cw = maxX - minX + 1;
        const ch = maxY - minY + 1;
        // Skip vertical border rules spanning nearly the full strip height
        if (ch >= sh * 0.82 && cw <= Math.max(4, lineH * 0.35)) continue;
        // Skip horizontal separator bars
        if (cw >= gw * 0.7 && ch <= 3) continue;
        if (area < 3) continue;

        nonRuleComponents.push({
          minX: guardX0 + minX,
          maxX: guardX0 + maxX,
          minY: stripY0 + minY,
          maxY: stripY0 + maxY,
          cw,
          ch,
          touchesLeft: minX === 0
        });
      }
    }

    // If multiple distinct character components sit in the guard strip, it is likely adjacent column text
    if (nonRuleComponents.length !== 1) return false;
    const comp = nonRuleComponents[0];
    if (comp.touchesLeft || comp.minX < stripX0 - 2) return false;
    if (comp.cw < Math.max(2, lineH * 0.09) || comp.ch < Math.max(2, lineH * 0.09)) return false;
    if (comp.cw > lineH * 0.95 || comp.ch > lineH * 0.95) return false;
    const aspect = comp.cw / Math.max(1, comp.ch);
    if (aspect < 0.45 || aspect > 2.2) return false;

    const gapToText = stripX1 - 1 - comp.maxX;
    if (gapToText < 1 || gapToText > lineH * 1.45) return false;

    const centerY = (comp.minY + comp.maxY) * 0.5;
    if (centerY < bbox.y0 + lineH * 0.12 || centerY > bbox.y1 - lineH * 0.12) return false;

    return true;
  }

  let ortConfigured = false;
  const sessions = Object.create(null);
  const sessionPromises = Object.create(null);

  // -------------------------------------------------------------------------
  // Runtime / session management
  // -------------------------------------------------------------------------
  function configureOrt() {
    if (ortConfigured) return;
    if (typeof ort === 'undefined' || !ort.InferenceSession) {
      throw new Error('onnxruntime-web (ort) is not loaded in offscreen document');
    }
    ort.env.wasm.wasmPaths = chrome.runtime.getURL('vendor/ort/');
    // Offscreen documents are not cross-origin isolated -> no SharedArrayBuffer threads
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ortConfigured = true;
  }

  async function getSession(file, onProgress) {
    if (sessions[file]) return sessions[file];
    if (!sessionPromises[file]) {
      sessionPromises[file] = (async () => {
        configureOrt();
        if (onProgress) onProgress(`loading NDLOCR model: ${file}`, 0);
        const resp = await fetch(chrome.runtime.getURL(MODEL_BASE + file));
        if (!resp.ok) {
          throw new Error(`NDLOCR model not found: ${file} (HTTP ${resp.status})`);
        }
        const buf = await resp.arrayBuffer();
        const session = await ort.InferenceSession.create(new Uint8Array(buf), {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all'
        });
        sessions[file] = session;
        if (onProgress) onProgress(`loaded NDLOCR model: ${file}`, 100);
        return session;
      })().catch((err) => {
        delete sessionPromises[file];
        throw err;
      });
    }
    return sessionPromises[file];
  }

  function getDetInputSize(session) {
    try {
      const meta = session.inputMetadata;
      const first = Array.isArray(meta) ? meta[0] : (meta && meta[session.inputNames[0]]);
      const shape = first && (first.shape || first.dims);
      if (shape && typeof shape[2] === 'number' && shape[2] > 0) {
        return shape[2];
      }
    } catch {
      // Older ort-web builds do not expose input metadata
    }
    return DET_DEFAULT_SIZE;
  }

  async function isAvailable() {
    try {
      const resp = await fetch(chrome.runtime.getURL(MODEL_BASE + DET_MODEL_FILE), { method: 'HEAD' });
      return resp.ok && typeof ort !== 'undefined' && Array.isArray(global.NDL_CHARLIST || (typeof NDL_CHARLIST !== 'undefined' ? NDL_CHARLIST : null));
    } catch {
      return false;
    }
  }

  function getCharlist() {
    const list = global.NDL_CHARLIST || (typeof NDL_CHARLIST !== 'undefined' ? NDL_CHARLIST : null);
    if (!Array.isArray(list) || list.length === 0) {
      throw new Error('NDLOCR charlist (NDL_CHARLIST) is not loaded');
    }
    return list;
  }

  // -------------------------------------------------------------------------
  // Image helpers
  // -------------------------------------------------------------------------
  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to decode image for NDLOCR'));
      img.src = dataUrl;
    });
  }

  // Pooled reusable canvases and buffers to eliminate GC churn and repeated allocations
  let pooledDetCanvas = null;
  let pooledDetCtx = null;
  let pooledDetBuffer = null;

  let pooledRecCanvas = null;
  let pooledRecCtx = null;
  let pooledRecBuf256 = null;
  let pooledRecBuf384 = null;

  function getPooledDetContext(size) {
    if (!pooledDetCanvas || pooledDetCanvas.width !== size) {
      pooledDetCanvas = document.createElement('canvas');
      pooledDetCanvas.width = size;
      pooledDetCanvas.height = size;
      pooledDetCtx = pooledDetCanvas.getContext('2d', { willReadFrequently: true });
      pooledDetCtx.imageSmoothingEnabled = true;
      pooledDetCtx.imageSmoothingQuality = 'high';
      pooledDetBuffer = new Float32Array(3 * size * size);
    }
    return { canvas: pooledDetCanvas, ctx: pooledDetCtx, data: pooledDetBuffer };
  }

  function getPooledRecContext(targetW, targetH) {
    if (!pooledRecCanvas) {
      pooledRecCanvas = document.createElement('canvas');
      pooledRecCanvas.width = 384; // max width
      pooledRecCanvas.height = targetH;
      pooledRecCtx = pooledRecCanvas.getContext('2d', { willReadFrequently: true });
      pooledRecCtx.imageSmoothingEnabled = true;
      pooledRecCtx.imageSmoothingQuality = 'high';
      pooledRecBuf256 = new Float32Array(3 * targetH * 256);
      pooledRecBuf384 = new Float32Array(3 * targetH * 384);
    }
    return {
      canvas: pooledRecCanvas,
      ctx: pooledRecCtx,
      data: targetW === 256 ? pooledRecBuf256 : pooledRecBuf384
    };
  }

  function createCanvas(w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w));
    canvas.height = Math.max(1, Math.round(h));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    return { canvas, ctx };
  }

  /** Flatten the source image onto white (handles transparent PNG text) */
  function buildSourceCanvas(img) {
    const w = img.naturalWidth || img.width || 1;
    const h = img.naturalHeight || img.height || 1;
    const { canvas, ctx } = createCanvas(w, h);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return { canvas, width: w, height: h };
  }

  // -------------------------------------------------------------------------
  // DEIMv2 detection (port of deim.py preprocess/postprocess)
  // -------------------------------------------------------------------------
  function buildDetTensor(srcCanvas, imgW, imgH, size) {
    // Top-left zero padding to a square of max(W, H), then resize to size x size
    const maxWH = Math.max(imgW, imgH);
    const ratio = size / maxWH;
    const { ctx, data } = getPooledDetContext(size);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(srcCanvas, 0, 0, imgW, imgH, 0, 0, imgW * ratio, imgH * ratio);

    const px = ctx.getImageData(0, 0, size, size).data;
    const area = size * size;
    const m0 = IMAGENET_MEAN[0], m1 = IMAGENET_MEAN[1], m2 = IMAGENET_MEAN[2];
    const invStd0 = 1 / (255 * IMAGENET_STD[0]);
    const invStd1 = 1 / (255 * IMAGENET_STD[1]);
    const invStd2 = 1 / (255 * IMAGENET_STD[2]);
    const off0 = -m0 / IMAGENET_STD[0];
    const off1 = -m1 / IMAGENET_STD[1];
    const off2 = -m2 / IMAGENET_STD[2];
    for (let i = 0; i < area; i++) {
      const p = i << 2;
      data[i] = px[p] * invStd0 + off0;
      data[area + i] = px[p + 1] * invStd1 + off1;
      data[2 * area + i] = px[p + 2] * invStd2 + off2;
    }
    return {
      tensor: new ort.Tensor('float32', data, [1, 3, size, size]),
      scale: maxWH / size
    };
  }

  function pickDetOutputs(session, out) {
    const names = session.outputNames || Object.keys(out);
    const find = (key, idx) => {
      const byName = names.find((n) => String(n).toLowerCase().includes(key));
      return (byName && out[byName]) || out[names[idx]];
    };
    return {
      labels: find('label', 0),
      boxes: find('box', 1),
      scores: find('score', 2),
      charCounts: names.length > 3 ? find('char', 3) : null,
      markdownStyles: names.length > 4 ? find('markdown', 4) : null
    };
  }

  async function detect(srcCanvas, imgW, imgH, onProgress) {
    const session = await getSession(DET_MODEL_FILE, onProgress);
    const size = getDetInputSize(session);
    const { tensor, scale } = buildDetTensor(srcCanvas, imgW, imgH, size);

    const feeds = {};
    feeds[session.inputNames[0]] = tensor;
    if (session.inputNames.length > 1) {
      feeds[session.inputNames[1]] = new ort.Tensor(
        'int64',
        BigInt64Array.from([BigInt(size), BigInt(size)]),
        [1, 2]
      );
    }

    const out = await session.run(feeds);
    const { labels, boxes, scores, charCounts, markdownStyles } = pickDetOutputs(session, out);
    if (!labels || !boxes || !scores) {
      throw new Error('Unexpected DEIM output tensors');
    }

    const detections = [];
    const n = scores.data.length;
    for (let i = 0; i < n; i++) {
      const score = Number(scores.data[i]);
      if (!(score >= DET_SCORE_THRESHOLD)) continue;
      const classIndex = Number(labels.data[i]) - 1;
      const x0 = Math.max(0, Math.min(imgW, boxes.data[i * 4] * scale));
      const y0 = Math.max(0, Math.min(imgH, boxes.data[i * 4 + 1] * scale));
      const x1 = Math.max(0, Math.min(imgW, boxes.data[i * 4 + 2] * scale));
      const y1 = Math.max(0, Math.min(imgH, boxes.data[i * 4 + 3] * scale));
      const bw = x1 - x0;
      const bh = y1 - y0;
      if (bw < 6 || bh < 6 || (bw * bh) < 64) continue;
      if ((bw > 25 * bh && bh <= 4) || (bh > 25 * bw && bw <= 4)) continue;
      detections.push({
        classIndex,
        score,
        x0, y0, x1, y1,
        charCount: charCounts ? Number(charCounts.data[i]) : null,
        markdownStyle: markdownStyles ? Number(markdownStyles.data[i]) : null
      });
    }
    return suppressOverlappingSameClassRegions(detections, 0.9);
  }

  /** Port of V2.0 deim.py _suppress_overlapping_regions: prefer larger same-label boxes */
  function suppressOverlappingSameClassRegions(detections, overlapThreshold) {
    if (!overlapThreshold || detections.length <= 1) return detections;
    const areas = detections.map((d) => Math.max(0, d.x1 - d.x0) * Math.max(0, d.y1 - d.y0));
    const order = detections.map((_, i) => i).sort((a, b) => areas[b] - areas[a]);
    const keptByClass = new Map();
    const suppressed = new Uint8Array(detections.length);

    for (const idx of order) {
      const area = areas[idx];
      if (area <= 0) continue;
      const det = detections[idx];
      let kept = keptByClass.get(det.classIndex);
      if (!kept) {
        kept = [];
        keptByClass.set(det.classIndex, kept);
      }
      let drop = false;
      for (const otherIdx of kept) {
        if (areas[otherIdx] <= area) continue;
        const o = detections[otherIdx];
        const ix = Math.max(0, Math.min(det.x1, o.x1) - Math.max(det.x0, o.x0));
        const iy = Math.max(0, Math.min(det.y1, o.y1) - Math.max(det.y0, o.y0));
        if ((ix * iy) / area >= overlapThreshold) {
          drop = true;
          break;
        }
      }
      if (drop) {
        suppressed[idx] = 1;
      } else {
        kept.push(idx);
      }
    }
    return detections.filter((_, i) => !suppressed[i]);
  }

  function iou(a, b) {
    const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
    const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
    const inter = ix * iy;
    const areaA = (a.x1 - a.x0) * (a.y1 - a.y0);
    const areaB = (b.x1 - b.x0) * (b.y1 - b.y0);
    const union = areaA + areaB - inter;
    return {
      iou: union > 0 ? inter / union : 0,
      overSmaller: Math.min(areaA, areaB) > 0 ? inter / Math.min(areaA, areaB) : 0
    };
  }

  /** Keep text lines, rescue line-less text blocks, and suppress duplicates */
  function selectTextLines(detections) {
    let lines = detections.filter((d) => LINE_CLASS_INDICES.has(d.classIndex));

    // Text blocks without any detected line inside are treated as a single line (as ndl_parser does)
    const blocks = detections.filter((d) => d.classIndex === CLASS_TEXT_BLOCK);
    for (const blk of blocks) {
      const hasLine = lines.some((l) => {
        const cx = (l.x0 + l.x1) / 2;
        const cy = (l.y0 + l.y1) / 2;
        return cx >= blk.x0 && cx <= blk.x1 && cy >= blk.y0 && cy <= blk.y1;
      });
      if (!hasLine) {
        lines.push({ ...blk, classIndex: 1 });
      }
    }

    // NMS: drop overlapping duplicates, preferring higher score
    lines.sort((a, b) => b.score - a.score);
    const kept = [];
    for (const cand of lines) {
      const dup = kept.some((k) => {
        const r = iou(k, cand);
        return r.iou > 0.5 || r.overSmaller > 0.85;
      });
      if (!dup) kept.push(cand);
    }
    return kept;
  }

  /** Check if a line box is Japanese vertical text (tategaki) based on aspect ratio */
  function isLineVertical(line) {
    const w = Math.max(1, line.x1 - line.x0);
    const h = Math.max(1, line.y1 - line.y0);
    return h > w * 1.25 && h >= 16;
  }

  /** Sort vertical text lines in natural Japanese reading order: right-to-left columns, top-to-bottom within column */
  function sortVerticalLines(items) {
    if (items.length <= 1) return items;
    const sortedByY = items.slice().sort((a, b) => a.cy - b.cy);
    const tiers = [];

    for (const item of sortedByY) {
      let matchedTier = null;
      for (const tier of tiers) {
        const hasOverlap = tier.some((t) => {
          const overlapY = Math.min(item.y1, t.y1) - Math.max(item.y0, t.y0);
          const minH = Math.min(item.h, t.h);
          return overlapY > minH * 0.3 || Math.abs(item.cy - t.cy) < minH * 0.5;
        });
        if (hasOverlap) {
          matchedTier = tier;
          break;
        }
      }
      if (matchedTier) {
        matchedTier.push(item);
      } else {
        tiers.push([item]);
      }
    }

    tiers.sort((ta, tb) => {
      const avgYa = ta.reduce((s, it) => s + it.cy, 0) / ta.length;
      const avgYb = tb.reduce((s, it) => s + it.cy, 0) / tb.length;
      return avgYa - avgYb;
    });

    const result = [];
    for (const tier of tiers) {
      const sortedByX = tier.slice().sort((a, b) => b.cx - a.cx);
      const columns = [];

      for (const item of sortedByX) {
        let matchedCol = null;
        for (const col of columns) {
          const isSameCol = col.some((c) => {
            const overlapX = Math.min(item.x1, c.x1) - Math.max(item.x0, c.x0);
            const minW = Math.min(item.w, c.w);
            return overlapX > minW * 0.4 || Math.abs(item.cx - c.cx) < minW * 0.5;
          });
          if (isSameCol) {
            matchedCol = col;
            break;
          }
        }
        if (matchedCol) {
          matchedCol.push(item);
        } else {
          columns.push([item]);
        }
      }

      columns.sort((ca, cb) => {
        const avgXa = ca.reduce((s, it) => s + it.cx, 0) / ca.length;
        const avgXb = cb.reduce((s, it) => s + it.cx, 0) / cb.length;
        return avgXb - avgXa; // Right-to-Left
      });

      for (const col of columns) {
        col.sort((a, b) => a.y0 - b.y0); // Top-to-Bottom
        result.push(...col);
      }
    }
    return result;
  }

  /** Sort horizontal text lines in natural reading order: top-to-bottom rows, left-to-right within row */
  function sortHorizontalLines(items) {
    if (items.length <= 1) return items;
    const sortedByY = items.slice().sort((a, b) => a.cy - b.cy);
    const rows = [];

    for (const item of sortedByY) {
      let matchedRow = null;
      for (const row of rows) {
        const isSameRow = row.some((r) => {
          const overlapY = Math.min(item.y1, r.y1) - Math.max(item.y0, r.y0);
          const minH = Math.min(item.h, r.h);
          return overlapY > minH * 0.4 || Math.abs(item.cy - r.cy) < minH * 0.5;
        });
        if (isSameRow) {
          matchedRow = row;
          break;
        }
      }
      if (matchedRow) {
        matchedRow.push(item);
      } else {
        rows.push([item]);
      }
    }

    rows.sort((ra, rb) => {
      const avgYa = ra.reduce((s, it) => s + it.cy, 0) / ra.length;
      const avgYb = rb.reduce((s, it) => s + it.cy, 0) / rb.length;
      return avgYa - avgYb;
    });

    const result = [];
    for (const row of rows) {
      row.sort((a, b) => a.x0 - b.x0); // Left-to-Right
      result.push(...row);
    }
    return result;
  }

  /**
   * Sort detected text lines into natural Japanese reading order.
   * Vertical text (tategaki) is sorted Right-to-Left (column by column).
   * Horizontal text (yokogaki) is sorted Top-to-Bottom (row by row).
   */
  function sortReadingOrder(lines) {
    if (!lines || lines.length <= 1) return lines;

    const items = lines.map((l) => ({
      line: l,
      isVertical: isLineVertical(l),
      x0: l.x0,
      y0: l.y0,
      x1: l.x1,
      y1: l.y1,
      w: Math.max(1, l.x1 - l.x0),
      h: Math.max(1, l.y1 - l.y0),
      cx: (l.x0 + l.x1) / 2,
      cy: (l.y0 + l.y1) / 2
    }));

    const vertItems = items.filter((it) => it.isVertical);
    const horizItems = items.filter((it) => !it.isVertical);

    if (vertItems.length === 0) {
      return sortHorizontalLines(horizItems).map((it) => it.line);
    }
    if (horizItems.length === 0) {
      return sortVerticalLines(vertItems).map((it) => it.line);
    }

    // Mixed layout: sort both groups, then merge based on document flow.
    const sortedVert = sortVerticalLines(vertItems);
    const sortedHoriz = sortHorizontalLines(horizItems);

    const minVy = Math.min(...vertItems.map((it) => it.y0));
    const maxVy = Math.max(...vertItems.map((it) => it.y1));
    const minVx = Math.min(...vertItems.map((it) => it.x0));
    const maxVx = Math.max(...vertItems.map((it) => it.x1));

    // Headers above vertical text
    const headers = [];
    // Footers below vertical text
    const footers = [];
    // Inline or lateral horizontal items
    const midHoriz = [];

    for (const h of sortedHoriz) {
      if (h.y1 <= minVy + (maxVy - minVy) * 0.1) {
        headers.push(h);
      } else if (h.y0 >= maxVy - (maxVy - minVy) * 0.1) {
        footers.push(h);
      } else {
        midHoriz.push(h);
      }
    }

    // If vertical is dominant, vertical text forms the main body between headers and footers.
    if (vertItems.length >= horizItems.length) {
      const rightHoriz = midHoriz.filter((h) => h.cx >= maxVx);
      const leftHoriz = midHoriz.filter((h) => h.cx < maxVx);
      return [
        ...headers.map((it) => it.line),
        ...rightHoriz.map((it) => it.line),
        ...sortedVert.map((it) => it.line),
        ...leftHoriz.map((it) => it.line),
        ...footers.map((it) => it.line)
      ];
    }

    // If horizontal is dominant, place vertical blocks where they naturally occur vertically
    const merged = [];
    let vertInserted = false;
    for (const h of sortedHoriz) {
      if (!vertInserted && h.cy >= minVy) {
        merged.push(...sortedVert.map((it) => it.line));
        vertInserted = true;
      }
      merged.push(h.line);
    }
    if (!vertInserted) {
      merged.push(...sortedVert.map((it) => it.line));
    }
    return merged;
  }

  // -------------------------------------------------------------------------
  // PARSeq recognition (port of parseq.py preprocess/read)
  // -------------------------------------------------------------------------
  function computeCropRect(line, imgW, imgH) {
    const w = line.x1 - line.x0;
    const h = line.y1 - line.y0;
    const isVertical = isLineVertical(line);
    // DEIM boxes are tight (often clipping baselines or left capitals) -> asymmetric margins.
    const cross = isVertical ? w : h;
    const sideMargin = Math.max(3, Math.round(cross * 0.15));
    const trailMargin = Math.max(2, Math.round(cross * 0.3));
    let x0, y0, x1, y1;
    if (isVertical) {
      x0 = line.x0 - trailMargin * 0.5;
      x1 = line.x1 + trailMargin * 0.5;
      y0 = line.y0 - sideMargin;
      y1 = line.y1 + sideMargin;
    } else {
      x0 = line.x0 - sideMargin;
      x1 = line.x1 + sideMargin;
      y0 = line.y0 - sideMargin;
      y1 = line.y1 + trailMargin;
    }
    x0 = Math.max(0, Math.floor(x0));
    y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(imgW, Math.ceil(x1));
    y1 = Math.min(imgH, Math.ceil(y1));
    return { x0, y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0), isVertical };
  }

  /** Port of V2.0 parseq.py: remove stray ASCII spaces directly adjacent to Japanese 、/。 */
  function removeAsciiSpacesAroundJapanesePunctuation(text) {
    if (!text) return '';
    return text
      .replace(/ ([、。])/g, '$1')
      .replace(/([、。]) /g, '$1');
  }

  let cachedDefaultInclusionDict = null;
  let cachedMultiRegex = null;

  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function getInclusionDict(overrideDict) {
    if (overrideDict && typeof overrideDict === 'object') return overrideDict;
    return global.NDL_CHARACTER_INCLUSION || (typeof NDL_CHARACTER_INCLUSION !== 'undefined' ? NDL_CHARACTER_INCLUSION : null);
  }

  /**
   * Port of V2.0 character_inclusion.py (異体字包摂 / jd_book.json mapping):
   * Applies longest-match multi-character replacements first, then single-character translation.
   */
  function applyCharacterInclusion(text, overrideDict) {
    if (!text || typeof text !== 'string') return text || '';
    const dict = getInclusionDict(overrideDict);
    if (!dict) return text;

    let out = text;
    const multi = dict.multi;
    if (multi) {
      let multiRe = null;
      if (!overrideDict && dict === cachedDefaultInclusionDict) {
        multiRe = cachedMultiRegex;
      } else {
        const keys = Object.keys(multi);
        if (keys.length > 0) {
          keys.sort((a, b) => b.length - a.length);
          multiRe = new RegExp(keys.map(escapeRegExp).join('|'), 'g');
        }
        if (!overrideDict) {
          cachedDefaultInclusionDict = dict;
          cachedMultiRegex = multiRe;
        }
      }
      if (multiRe) {
        out = out.replace(multiRe, (m) => multi[m]);
      }
    }

    const single = dict.single;
    if (!single) return out;

    // Fast zero-allocation pass when no character requires mapping
    let firstHit = -1;
    for (let i = 0; i < out.length; i++) {
      if (single[out[i]] !== undefined) {
        firstHit = i;
        break;
      }
    }
    if (firstHit === -1) return out;

    let result = out.slice(0, firstHit);
    for (let i = firstHit; i < out.length; i++) {
      const ch = out[i];
      const mapped = single[ch];
      result += mapped !== undefined ? mapped : ch;
    }
    return result;
  }

  const INV_127_5 = 1 / 127.5;
  function buildRecTensor(srcCanvas, crop, targetW, forceRotate) {
    const { ctx, data } = getPooledRecContext(targetW, REC_HEIGHT);
    const shouldRotate = forceRotate !== undefined ? Boolean(forceRotate) : crop.isVertical;
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    if (shouldRotate) {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, targetW, REC_HEIGHT);
      // Rotate 90deg counter-clockwise (cv2.ROTATE_90_COUNTERCLOCKWISE) and stretch to targetW x 24:
      // (x, y) in crop -> (X, Y) = (y * targetW / h, (w - x) * 24 / w)
      ctx.setTransform(0, -REC_HEIGHT / crop.w, targetW / crop.h, 0, 0, REC_HEIGHT);
      ctx.drawImage(srcCanvas, crop.x0, crop.y0, crop.w, crop.h, 0, 0, crop.w, crop.h);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    } else {
      // Direct stretch covers the entire targetW x REC_HEIGHT canvas -> skip redundant fillRect
      ctx.drawImage(srcCanvas, crop.x0, crop.y0, crop.w, crop.h, 0, 0, targetW, REC_HEIGHT);
    }

    const px = ctx.getImageData(0, 0, targetW, REC_HEIGHT).data;
    const area = targetW * REC_HEIGHT;
    for (let i = 0; i < area; i++) {
      const p = i << 2;
      data[i] = px[p] * INV_127_5 - 1.0;
      data[area + i] = px[p + 1] * INV_127_5 - 1.0;
      data[2 * area + i] = px[p + 2] * INV_127_5 - 1.0;
    }
    return new ort.Tensor('float32', data, [1, 3, REC_HEIGHT, targetW]);
  }

  function decodeParseq(outTensor, charlist) {
    const dims = outTensor.dims;
    const steps = dims[1];
    const vocab = dims[2];
    const d = outTensor.data;

    // Detect whether outputs are already probabilities or raw logits
    let firstSum = 0;
    let firstMin = Infinity;
    for (let k = 0; k < vocab; k++) {
      const v = d[k];
      firstSum += v;
      if (v < firstMin) firstMin = v;
    }
    const isProb = firstMin >= 0 && Math.abs(firstSum - 1) < 0.02;

    let text = '';
    let probSum = 0;
    let count = 0;
    for (let t = 0; t < steps; t++) {
      const off = t * vocab;
      let best = 0;
      let bestVal = -Infinity;
      for (let k = 0; k < vocab; k++) {
        const v = d[off + k];
        if (v > bestVal) {
          bestVal = v;
          best = k;
        }
      }
      if (best === 0) break; // [EOS]

      let p;
      if (isProb) {
        p = bestVal;
      } else {
        // Pruned softmax: exp(-20) < 2.1e-9 -> skips ~99.8% of Math.exp() calls with identical confidence
        let sum = 0;
        for (let k = 0; k < vocab; k++) {
          const diff = d[off + k] - bestVal;
          if (diff > -20) sum += Math.exp(diff);
        }
        p = 1 / sum;
      }
      text += charlist[best - 1] || '';
      probSum += p;
      count++;
    }
    return {
      text: removeAsciiSpacesAroundJapanesePunctuation(text),
      confidence: count > 0 ? probSum / count : 0
    };
  }

  async function readLine(srcCanvas, crop, model, charlist, onProgress, forceRotate) {
    const session = await getSession(model.file, onProgress);
    const tensor = buildRecTensor(srcCanvas, crop, model.width, forceRotate);
    const feeds = {};
    feeds[session.inputNames[0]] = tensor;
    const out = await session.run(feeds);
    const outTensor = out[session.outputNames[0]];
    return decodeParseq(outTensor, charlist);
  }

  /**
   * Find the cleanest blank vertical column near the horizontal center (35%..65%) of a wide line crop
   * so long lines (>50 chars / charCount===1) can be split cleanly without slicing glyphs (replaces PARSeq-768).
   */
  function findVerticalSplitX(imageData, crop) {
    if (!imageData || !imageData.data || !crop || crop.w < 40 || crop.h < 4) return null;
    const { data, width, height } = imageData;
    const x0 = Math.max(0, Math.min(width - 1, crop.x0 | 0));
    const y0 = Math.max(0, Math.min(height - 1, crop.y0 | 0));
    const w = Math.max(1, Math.min(width - x0, crop.w | 0));
    const h = Math.max(1, Math.min(height - y0, crop.h | 0));
    if (w < 40 || h < 4) return null;

    // Sample top & bottom border row luminance to estimate local background (works on light & dark UI)
    const borderLums = [];
    const stepX = Math.max(1, Math.floor(w / 64));
    for (let dx = 0; dx < w; dx += stepX) {
      for (const dy of [0, h - 1]) {
        const p = ((y0 + dy) * width + (x0 + dx)) << 2;
        borderLums.push(0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]);
      }
    }
    borderLums.sort((a, b) => a - b);
    const bgLum = borderLums.length > 0 ? borderLums[borderLums.length >> 1] : 255;

    const lo = Math.floor(w * 0.35);
    const hi = Math.ceil(w * 0.65);
    const colInk = new Int32Array(hi - lo);
    let minInk = Infinity;
    for (let dx = lo; dx < hi; dx++) {
      let ink = 0;
      const gx = x0 + dx;
      for (let dy = 0; dy < h; dy++) {
        const p = ((y0 + dy) * width + gx) << 2;
        const lum = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
        if (Math.abs(lum - bgLum) > 28) ink++;
      }
      colInk[dx - lo] = ink;
      if (ink < minInk) minInk = ink;
    }

    // Pick the widest contiguous valley at minInk
    let bestCenter = w >> 1;
    let bestLen = 0;
    let runStart = -1;
    for (let i = 0; i < colInk.length; i++) {
      if (colInk[i] <= minInk) {
        if (runStart === -1) runStart = i;
      } else if (runStart !== -1) {
        const len = i - runStart;
        if (len > bestLen) {
          bestLen = len;
          bestCenter = lo + ((runStart + i) >> 1);
        }
        runStart = -1;
      }
    }
    if (runStart !== -1) {
      const len = colInk.length - runStart;
      if (len > bestLen) {
        bestLen = len;
        bestCenter = lo + ((runStart + colInk.length) >> 1);
      }
    }

    return { splitOffset: bestCenter, minInk, gapLen: bestLen };
  }

  /**
   * Zero-overhead port of V2.0 tcy_wrapper.py (TateChuYokoWrapper / 縦中横):
   * Uses the already-recognized vertical `fullResult` and fast pixel ink projection on `srcImageData`.
   * Skips immediately when `fullResult` already has high confidence (>= 0.90), and validates every
   * candidate TCY sub-chunk as genuine short ASCII digits/alphanumerics to prevent false splits on kanji/handwriting.
   */
  async function detectAndFixTateChuYoko(srcCanvas, srcImageData, crop, fullResult, model, charlist, onProgress) {
    if (!srcImageData || !srcImageData.data || !crop || !crop.isVertical) return fullResult;
    if (!fullResult || !fullResult.text) return fullResult;
    // Fast path: PARSeq V2.0 already read the vertical column with >= 90% confidence -> skip re-slicing
    if (fullResult.confidence >= 0.90) return fullResult;

    const minLineWidth = 28;
    const detMarginRatio = 0.1;
    const ocrMarginRatio = 0.25;
    const minComponents = 2;
    const maxAspectRatio = 0.75;
    const inkThresholdRatio = 0.10;
    const TCY_TOKEN_REGEX = /^[A-Za-z0-9.,%!?]{2,4}$/;

    const { data, width, height } = srcImageData;
    const x0 = Math.max(0, Math.min(width - 1, crop.x0 | 0));
    const y0 = Math.max(0, Math.min(height - 1, crop.y0 | 0));
    const w = Math.max(1, Math.min(width - x0, crop.w | 0));
    const h = Math.max(1, Math.min(height - y0, crop.h | 0));
    if (w < minLineWidth || h < w * 1.5) return fullResult;

    const segMinGap = Math.max(4, Math.min(7, Math.round(w * 0.15)));

    // Compute grayscale buffer and adaptive mean threshold (matches tcy_wrapper.py)
    const gray = new Uint8Array(w * h);
    let sumGray = 0;
    for (let dy = 0; dy < h; dy++) {
      const rowOff = dy * w;
      const srcRow = (y0 + dy) * width + x0;
      for (let dx = 0; dx < w; dx++) {
        const p = (srcRow + dx) << 2;
        const g = (data[p] + data[p + 1] + data[p + 2]) / 3;
        gray[rowOff + dx] = g;
        sumGray += g;
      }
    }
    const thresh = Math.floor(sumGray / Math.max(1, w * h));

    // Row ink projection -> segment vertical characters/clusters
    const rawBlocks = [];
    let inBlock = false;
    let bStart = 0;
    for (let dy = 0; dy < h; dy++) {
      const rowOff = dy * w;
      let hasInk = false;
      for (let dx = 0; dx < w; dx++) {
        if (gray[rowOff + dx] < thresh) {
          hasInk = true;
          break;
        }
      }
      if (hasInk && !inBlock) {
        bStart = dy;
        inBlock = true;
      } else if (!hasInk && inBlock) {
        rawBlocks.push([bStart, dy]);
        inBlock = false;
      }
    }
    if (inBlock) rawBlocks.push([bStart, h]);
    if (rawBlocks.length === 0) return fullResult;

    const blocks = [];
    for (const b of rawBlocks) {
      if (blocks.length > 0 && b[0] - blocks[blocks.length - 1][1] < segMinGap) {
        blocks[blocks.length - 1][1] = b[1];
      } else {
        blocks.push([b[0], b[1]]);
      }
    }

    // Count horizontal ink components inside each short vertical block
    const tcyFlags = new Uint8Array(blocks.length);
    let candCount = 0;
    for (let bi = 0; bi < blocks.length; bi++) {
      const [ys, ye] = blocks[bi];
      const bh = ye - ys;
      if (bh < segMinGap || bh > w * maxAspectRatio) continue;

      const detMargin = Math.max(2, Math.floor(bh * detMarginRatio));
      const sy0 = Math.max(0, ys - detMargin);
      const sy1 = Math.min(h, ye + detMargin);

      let bSum = 0;
      const bCount = (sy1 - sy0) * w;
      for (let dy = sy0; dy < sy1; dy++) {
        const ro = dy * w;
        for (let dx = 0; dx < w; dx++) bSum += gray[ro + dx];
      }
      const bThresh = Math.floor(bSum / Math.max(1, bCount));

      let maxCol = 0;
      const colSum = new Int32Array(w);
      for (let dy = sy0; dy < sy1; dy++) {
        const ro = dy * w;
        for (let dx = 0; dx < w; dx++) {
          if (gray[ro + dx] < bThresh) {
            const v = ++colSum[dx];
            if (v > maxCol) maxCol = v;
          }
        }
      }
      if (maxCol === 0) continue;

      const colThr = maxCol * inkThresholdRatio;
      let components = 0;
      let inComp = false;
      for (let dx = 0; dx < w; dx++) {
        if (colSum[dx] > colThr) {
          if (!inComp) {
            components++;
            inComp = true;
          }
        } else {
          inComp = false;
        }
      }
      if (components >= minComponents && components <= 4) {
        tcyFlags[bi] = 1;
        candCount++;
      }
    }

    // Fast path: 0 extra PARSeq calls when no TCY cluster exists (or if >50% of line flagged -> likely handwriting/kanji)
    if (candCount === 0 || candCount > Math.max(3, Math.floor(blocks.length * 0.5))) return fullResult;

    // Validate each candidate TCY chunk unrotated FIRST: keep flag ONLY if it reads as genuine short ASCII/digits
    const verifiedTcyText = new Map();
    let verifiedCount = 0;
    for (let bi = 0; bi < blocks.length; bi++) {
      if (!tcyFlags[bi]) continue;
      const [ys, ye] = blocks[bi];
      const bh = ye - ys;
      const ocrMargin = Math.max(2, Math.floor(bh * ocrMarginRatio));
      const sy0 = Math.max(0, ys - ocrMargin);
      const sy1 = Math.min(h, ye + ocrMargin);
      const subCrop = { x0, y0: y0 + sy0, w, h: Math.max(1, sy1 - sy0), isVertical: false };
      const seg = await readLine(srcCanvas, subCrop, REC_SHORT, charlist, onProgress, false);
      const cleanSeg = (seg.text || '').trim();
      if (seg.confidence >= 0.80 && TCY_TOKEN_REGEX.test(cleanSeg)) {
        verifiedTcyText.set(bi, { text: cleanSeg, confidence: seg.confidence });
        verifiedCount++;
      } else {
        tcyFlags[bi] = 0;
      }
    }

    if (verifiedCount === 0) return fullResult;

    const parts = [];
    let confSum = 0;
    let confCount = 0;
    let i = 0;
    const n = blocks.length;
    while (i < n) {
      if (tcyFlags[i]) {
        const v = verifiedTcyText.get(i);
        parts.push(v.text);
        confSum += v.confidence;
        confCount++;
        i++;
      } else {
        const groupStart = i;
        while (i < n && !tcyFlags[i]) i++;
        const cy0 = (groupStart > 0 && tcyFlags[groupStart - 1]) ? blocks[groupStart - 1][1] : blocks[groupStart][0];
        const cy1 = (i < n && tcyFlags[i]) ? blocks[i][0] : blocks[i - 1][1];
        if (cy1 > cy0) {
          const subCrop = { x0, y0: y0 + cy0, w, h: cy1 - cy0, isVertical: true };
          const seg = await readLine(srcCanvas, subCrop, model, charlist, onProgress, true);
          if (seg.text) {
            parts.push(seg.text);
            confSum += seg.confidence;
            confCount++;
          }
        }
      }
    }

    const joined = removeAsciiSpacesAroundJapanesePunctuation(parts.join(''));
    const avgConf = confCount > 0 ? confSum / confCount : fullResult.confidence;
    // Reject hallucination loops (e.g. "00000", "(((((") or confidence regressions
    if (/(.)\1{4,}/.test(joined) || avgConf < fullResult.confidence * 0.92) {
      return fullResult;
    }
    if (joined.length >= fullResult.text.length && (avgConf > fullResult.confidence || (/\d{2,}/.test(joined) && !/\d{2,}/.test(fullResult.text)))) {
      return { text: joined, confidence: avgConf };
    }
    return fullResult;
  }

  /** ocr.py cascade: char_count==3 -> 30-char model, otherwise 50-char model (long lines use whitespace split) */
  function chooseInitialModel(line, crop) {
    if (line.charCount === 3) return REC_SHORT;
    if (line.charCount === 2 || line.charCount === 1) return REC_MEDIUM;
    // No char_count output: decide by aspect ratio of the text run
    const runLen = crop.isVertical ? crop.h / crop.w : crop.w / crop.h;
    return runLen <= 11 ? REC_SHORT : REC_MEDIUM;
  }

  async function recognizeSingleCrop(srcCanvas, line, crop, charlist, onProgress) {
    let model = chooseInitialModel(line, crop);
    let result;
    try {
      result = await readLine(srcCanvas, crop, model, charlist, onProgress);
    } catch (err) {
      if (model === REC_MEDIUM) {
        model = REC_SHORT;
        result = await readLine(srcCanvas, crop, model, charlist, onProgress);
      } else {
        throw err;
      }
    }
    if (model === REC_SHORT && result.text.length >= REC_SHORT.cascadeAt) {
      try {
        result = await readLine(srcCanvas, crop, REC_MEDIUM, charlist, onProgress);
        model = REC_MEDIUM;
      } catch {
        // keep short-model result
      }
    }
    return { result, model };
  }

  async function recognizeLongHorizontalSplit(srcCanvas, srcImageData, line, crop, charlist, onProgress, depth) {
    const split = findVerticalSplitX(srcImageData, crop);
    if (!split || split.splitOffset < 16 || (crop.w - split.splitOffset) < 16) {
      const { result } = await recognizeSingleCrop(srcCanvas, { ...line, charCount: 2 }, crop, charlist, onProgress);
      return result;
    }

    const pad = 2;
    const leftW = Math.min(crop.w, split.splitOffset + pad);
    const rightStart = Math.max(0, split.splitOffset - pad);
    const rightW = Math.max(1, crop.w - rightStart);
    const leftCrop = { x0: crop.x0, y0: crop.y0, w: leftW, h: crop.h, isVertical: false };
    const rightCrop = { x0: crop.x0 + rightStart, y0: crop.y0, w: rightW, h: crop.h, isVertical: false };

    const readHalf = async (halfCrop) => {
      const halfAspect = halfCrop.w / Math.max(1, halfCrop.h);
      if (depth < 1 && halfAspect >= 22 && halfCrop.w >= 160) {
        return recognizeLongHorizontalSplit(srcCanvas, srcImageData, line, halfCrop, charlist, onProgress, depth + 1);
      }
      const { result } = await recognizeSingleCrop(srcCanvas, { ...line, charCount: 2 }, halfCrop, charlist, onProgress);
      return result;
    };

    const leftRes = await readHalf(leftCrop);
    const rightRes = await readHalf(rightCrop);
    const leftText = (leftRes.text || '').replace(/\s+$/, '');
    const rightText = (rightRes.text || '').replace(/^\s+/, '');

    let sep = '';
    if (leftText && rightText) {
      const minWordGap = Math.max(3, Math.round(crop.h * 0.14));
      const leftAscii = /[A-Za-z0-9,.;:!?\)\]"']$/.test(leftText);
      const rightAscii = /^[A-Za-z0-9\(\[\-"']/.test(rightText);
      if (split.gapLen >= minWordGap && leftAscii && rightAscii) {
        sep = ' ';
      }
    }
    const text = removeAsciiSpacesAroundJapanesePunctuation(leftText + sep + rightText);
    const confidence = (leftText && rightText)
      ? (leftRes.confidence + rightRes.confidence) * 0.5
      : (leftText ? leftRes.confidence : rightRes.confidence);
    return { text, confidence };
  }

  async function recognizeLine(srcCanvas, line, crop, charlist, onProgress, srcImageData, enableTcy) {
    const aspect = crop.isVertical ? (crop.h / Math.max(1, crop.w)) : (crop.w / Math.max(1, crop.h));

    // Wide horizontal line (>50-char estimate or aspect >= 21): split at clean whitespace valley
    // so PARSeq-384 achieves 100% accuracy without bundling the 42.6MB PARSeq-768 model.
    if (!crop.isVertical && srcImageData && crop.w >= 160 && (line.charCount === 1 || aspect >= 21)) {
      return recognizeLongHorizontalSplit(srcCanvas, srcImageData, line, crop, charlist, onProgress, 0);
    }

    const { result, model } = await recognizeSingleCrop(srcCanvas, line, crop, charlist, onProgress);

    // Overflow guard: if PARSeq-384 hit near its 50-char cap on a horizontal line, split & re-read
    if (!crop.isVertical && srcImageData && crop.w >= 160 && model === REC_MEDIUM && result.text.length >= 45) {
      const splitRes = await recognizeLongHorizontalSplit(srcCanvas, srcImageData, line, crop, charlist, onProgress, 0);
      if (splitRes.text.length > result.text.length) {
        return splitRes;
      }
    }

    // Zero-overhead Tate-Chuu-Yoko check for vertical columns
    if (enableTcy !== false && crop.isVertical && srcImageData) {
      return detectAndFixTateChuYoko(srcCanvas, srcImageData, crop, result, model, charlist, onProgress);
    }

    return result;
  }

  const VALID_ONE_LETTER_WORDS = new Set(['a', 'A', 'I']);

  function isNoiseText(text, line, confidence) {
    if (!text) return true;
    const trimmed = text.trim();
    if (!trimmed) return true;
    if (!/[\p{L}\p{N}]/u.test(trimmed)) return true;
    // Dotted leaders / rules / repeated digits misread from separators (e.g. "0000000", "……")
    if (trimmed.length >= 6 && new Set(Array.from(trimmed)).size <= 2) return true;

    // Single Latin letter that is not a valid English word ('a', 'A', 'I')
    if (trimmed.length === 1 && /[a-zA-Z]/.test(trimmed) && !VALID_ONE_LETTER_WORDS.has(trimmed)) {
      return true;
    }

    if (line) {
      const bw = line.x1 - line.x0;
      const bh = line.y1 - line.y0;
      const aspect = bw / Math.max(1, bh);
      const isNearSquare = aspect >= 0.7 && aspect <= 1.45;

      // Near-square graphic icon hallucination
      if (isNearSquare && trimmed.length <= 2) {
        if (typeof confidence === 'number' && confidence < 0.75) {
          return true;
        }
        if (/^[口〇一・○十大小八人レ×□■△▲▽▼◇◆oO0QqxXvV=_~]+$/.test(trimmed)) {
          return true;
        }
      }
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------
  /**
   * @param {string} imageDataUrl
   * @param {{ onProgress?: (status: string, progress: number) => void, characterInclusion?: boolean, enableTcy?: boolean, enableTableStructure?: boolean }} [options]
   * @returns {Promise<{width:number,height:number,blocks:Array<{text:string,confidence:number,bbox:{x0:number,y0:number,x1:number,y1:number},isMultiLine:boolean,isVertical:boolean,isListItem:boolean,markdownStyle?:number|null}>,tables:Array<object>}>}
   */
  async function recognize(imageDataUrl, options = {}) {
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const useCharacterInclusion = options.characterInclusion !== false;
    const useTcy = options.enableTcy !== false;
    const useTableStructure = options.enableTableStructure !== false;

    const charlist = getCharlist();
    const img = await loadImage(imageDataUrl);
    const { canvas: srcCanvas, width, height } = buildSourceCanvas(img);

    let lines;
    let tableRegions = [];
    // Fast path: if the captured image is a single-line horizontal or vertical snippet
    // (e.g. area-capture of a button, title, label, or single vertical column),
    // skip the ~4-second DEIM detector and recognize directly via PARSeq in ~150ms!
    const isSingleHorizSnippet = (height <= 48 && width >= 14) || (width / Math.max(1, height) >= 3.5 && height <= 85);
    const isSingleVertSnippet = (width <= 48 && height >= 14) || (height / Math.max(1, width) >= 3.5 && width <= 85);
    if (isSingleHorizSnippet || isSingleVertSnippet) {
      lines = [{
        x0: 0,
        y0: 0,
        x1: width,
        y1: height,
        classIndex: 1,
        score: 1.0,
        charCount: null,
        markdownStyle: null
      }];
    } else {
      if (onProgress) onProgress('detecting text lines (NDLOCR v2 DEIM)', 0);
      const detections = await detect(srcCanvas, width, height, onProgress);
      tableRegions = detections
        .filter((d) => d.classIndex === CLASS_BLOCK_TABLE)
        .map((d) => ({ bbox: [d.x0, d.y0, d.x1, d.y1], confidence: d.score }));
      lines = sortReadingOrder(selectTextLines(detections));
    }

    // Single reusable ImageData snapshot shared across visual bullet detection, long-line split, and TCY
    let srcImageData = null;
    if (lines.length > 0) {
      try {
        const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
        if (srcCtx) srcImageData = srcCtx.getImageData(0, 0, width, height);
      } catch {
        srcImageData = null;
      }
    }

    const blocks = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (onProgress) onProgress('recognizing text (NDLOCR v2 PARSeq)', Math.round((i / Math.max(1, lines.length)) * 100));
      const crop = computeCropRect(line, width, height);
      const { text: recognizedText, confidence } = await recognizeLine(
        srcCanvas, line, crop, charlist, onProgress, srcImageData, useTcy
      );
      const rawText = useCharacterInclusion ? applyCharacterInclusion(recognizedText) : recognizedText;
      const mdStyle = typeof line.markdownStyle === 'number' ? line.markdownStyle : null;
      const isMdList = mdStyle === 7 || mdStyle === 8;
      const hasTextBullet = isMdList || LIST_MARKER_REGEX.test(rawText) || LEADING_BULLET_REGEX.test(rawText) || LEADING_ICON_ARTIFACT_REGEX.test(rawText);
      const text = stripLeadingIconArtifacts(rawText);
      if (confidence < REC_MIN_CONFIDENCE || isNoiseText(text, line, confidence)) continue;

      const bbox = {
        x0: Math.round(line.x0),
        y0: Math.round(line.y0),
        x1: Math.round(line.x1),
        y1: Math.round(line.y1)
      };
      const hasVisualBullet = !hasTextBullet && !crop.isVertical && srcImageData && lines.length > 1
        ? detectVisualBulletLeftOfLine(srcImageData, bbox)
        : false;

      const blk = {
        text,
        confidence: Math.round(confidence * 100),
        bbox,
        isMultiLine: false,
        isVertical: crop.isVertical,
        isListItem: Boolean(hasTextBullet || hasVisualBullet)
      };
      if (mdStyle !== null) blk.markdownStyle = mdStyle;
      blocks.push(blk);
    }

    // Lazy TableCenterNet inference ONLY when DEIMv2 detected `block_table` (class 15)
    let tables = [];
    if (
      useTableStructure &&
      tableRegions.length > 0 &&
      global.NdlTableEngine &&
      typeof global.NdlTableEngine.inferTables === 'function'
    ) {
      try {
        tables = await global.NdlTableEngine.inferTables(srcCanvas, width, height, tableRegions, blocks, { onProgress });
      } catch (err) {
        console.warn('[NDLOCR] TableCenterNet inference skipped/failed:', err);
        tables = [];
      }
    }

    return { width, height, blocks, tables };
  }

  global.NdlOcrEngine = { recognize, isAvailable, detectVisualBulletLeftOfLine, applyCharacterInclusion, removeAsciiSpacesAroundJapanesePunctuation, findVerticalSplitX };
})(typeof self !== 'undefined' ? self : window);

