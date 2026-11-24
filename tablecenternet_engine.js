/**
 * PLaMo Translate - NDLOCR-Lite V2.0 TableCenterNet In-Browser Engine
 *
 * Runs NDL Lab's TableCenterNet-S ONNX model on onnxruntime-web (WASM) inside the Offscreen Document
 * lazily (loaded ONLY when DEIMv2 detects a `block_table` / class 15 region).
 *
 * Preprocessing, official corner-relocation decoder, logical-grid OCR line assignment,
 * missing-cell recovery, and HTML/Markdown table rendering are ported from:
 *   ndl-lab/ndlocr-lite (src/tablecenternet.py, v2.0.0)
 *
 * Attribution & License (Adapted Work):
 *   Original Work: NDLOCR-Lite by National Diet Library, Japan (https://github.com/ndl-lab/ndlocr-lite)
 *   Reference Paper: TableCenterNet (arXiv:2504.17522)
 *   License: Creative Commons Attribution 4.0 International (CC BY 4.0)
 *            https://creativecommons.org/licenses/by/4.0/
 *
 * Exposes: self.NdlTableEngine
 */
(function (global) {
  'use strict';

  const MODEL_BASE = 'vendor/ndlocr/';
  const TABLE_MODEL_FILE = 'tablecenternet_s_800_v3.fp16.onnx';
  const DEFAULT_INPUT_SIZE = 800;

  // Official TableCenterNet BGR normalization constants (tablecenternet.py)
  const BGR_MEAN = [0.40789654, 0.44719302, 0.47026115];
  const BGR_STD = [0.28863828, 0.27408164, 0.27809835];

  const DEFAULT_CENTER_K = 3000;
  const DEFAULT_CORNER_K = 5000;
  const DEFAULT_CENTER_THRESH = 0.2;
  const DEFAULT_CORNER_THRESH = 0.3;
  const CELL_MIN_OPTIMIZE_COUNT = 2;
  const CELL_DECAY = 0.4;

  let tableSession = null;
  let tableSessionPromise = null;
  let pooledTableCanvas = null;
  let pooledTableCtx = null;
  let pooledTableBuf = null;

  // -------------------------------------------------------------------------
  // Session management (lazy-loaded on first table detection)
  // -------------------------------------------------------------------------
  function configureOrtIfNeeded() {
    if (typeof ort === 'undefined' || !ort.InferenceSession) {
      throw new Error('onnxruntime-web (ort) is not loaded');
    }
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      if (!ort.env.wasm.wasmPaths) {
        ort.env.wasm.wasmPaths = chrome.runtime.getURL('vendor/ort/');
      }
    }
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
  }

  async function getTableSession(onProgress) {
    if (tableSession) return tableSession;
    if (!tableSessionPromise) {
      tableSessionPromise = (async () => {
        configureOrtIfNeeded();
        if (onProgress) onProgress(`loading TableCenterNet model: ${TABLE_MODEL_FILE}`, 0);
        const url = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
          ? chrome.runtime.getURL(MODEL_BASE + TABLE_MODEL_FILE)
          : MODEL_BASE + TABLE_MODEL_FILE;
        const resp = await fetch(url);
        if (!resp.ok) {
          throw new Error(`TableCenterNet model not found: ${TABLE_MODEL_FILE} (HTTP ${resp.status})`);
        }
        const buf = await resp.arrayBuffer();
        const session = await ort.InferenceSession.create(new Uint8Array(buf), {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all'
        });
        tableSession = session;
        if (onProgress) onProgress(`loaded TableCenterNet model: ${TABLE_MODEL_FILE}`, 100);
        return session;
      })().catch((err) => {
        tableSessionPromise = null;
        throw err;
      });
    }
    return tableSessionPromise;
  }

  async function isAvailable() {
    try {
      if (typeof ort === 'undefined' || typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.getURL) {
        return false;
      }
      const resp = await fetch(chrome.runtime.getURL(MODEL_BASE + TABLE_MODEL_FILE), { method: 'HEAD' });
      return resp.ok;
    } catch {
      return false;
    }
  }

  function getPooledTableContext(size) {
    if (!pooledTableCanvas || pooledTableCanvas.width !== size) {
      pooledTableCanvas = document.createElement('canvas');
      pooledTableCanvas.width = size;
      pooledTableCanvas.height = size;
      pooledTableCtx = pooledTableCanvas.getContext('2d', { willReadFrequently: true });
      pooledTableCtx.imageSmoothingEnabled = true;
      pooledTableCtx.imageSmoothingQuality = 'high';
      pooledTableBuf = new Float32Array(3 * size * size);
    }
    return { canvas: pooledTableCanvas, ctx: pooledTableCtx, data: pooledTableBuf };
  }

  function getTableInputSize(session) {
    try {
      const meta = session.inputMetadata;
      const first = Array.isArray(meta) ? meta[0] : (meta && meta[session.inputNames[0]]);
      const shape = first && (first.shape || first.dims);
      if (shape && typeof shape[2] === 'number' && shape[2] > 0) {
        return shape[2];
      }
    } catch {
      // fallback
    }
    return DEFAULT_INPUT_SIZE;
  }

  // -------------------------------------------------------------------------
  // Preprocessing: exact centered square affine warp in BGR channel order
  // -------------------------------------------------------------------------
  function buildTableTensor(srcCanvas, cropX0, cropY0, cropW, cropH, size) {
    const scale = Math.max(cropW, cropH, 1);
    const ratio = size / scale;
    const drawW = cropW * ratio;
    const drawH = cropH * ratio;
    const drawX = (size - drawW) * 0.5;
    const drawY = (size - drawH) * 0.5;

    const { ctx, data } = getPooledTableContext(size);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(srcCanvas, cropX0, cropY0, cropW, cropH, drawX, drawY, drawW, drawH);

    const px = ctx.getImageData(0, 0, size, size).data;
    const area = size * size;
    // OpenCV BGR order: ch0 = B (px[p+2]), ch1 = G (px[p+1]), ch2 = R (px[p])
    const invStdB = 1 / (255 * BGR_STD[0]);
    const invStdG = 1 / (255 * BGR_STD[1]);
    const invStdR = 1 / (255 * BGR_STD[2]);
    const offB = -BGR_MEAN[0] / BGR_STD[0];
    const offG = -BGR_MEAN[1] / BGR_STD[1];
    const offR = -BGR_MEAN[2] / BGR_STD[2];

    for (let i = 0; i < area; i++) {
      const p = i << 2;
      data[i] = px[p + 2] * invStdB + offB;
      data[area + i] = px[p + 1] * invStdG + offG;
      data[2 * area + i] = px[p] * invStdR + offR;
    }

    return {
      tensor: new ort.Tensor('float32', data, [1, 3, size, size]),
      meta: {
        centerX: cropW * 0.5,
        centerY: cropH * 0.5,
        scale,
        inputSize: size
      }
    };
  }

  // -------------------------------------------------------------------------
  // Fast CenterNet 3x3 NMS + Official Corner-Relocation Decoder
  // -------------------------------------------------------------------------
  function sigmoidScalar(x) {
    const c = x < -50 ? -50 : (x > 50 ? 50 : x);
    return 1.0 / (1.0 + Math.exp(-c));
  }

  function logitFromProb(p) {
    return Math.log(p / (1.0 - p));
  }

  /** Round half to even (matches NumPy np.rint / PyTorch torch.round) */
  function roundHalfToEven(v) {
    const f = Math.floor(v);
    const diff = v - f;
    if (diff > 0.5) return f + 1;
    if (diff < 0.5) return f;
    return (f % 2 === 0) ? f : f + 1;
  }

  function roundAtLeastOne(v) {
    return Math.max(1, roundHalfToEven(v));
  }

  /**
   * Optimized 3x3 local-maxima extraction + polygon decoding on a single heatmap channel.
   * Uses monotonic logit pre-filtering to skip >99% of background pixels before sigmoid/sorting.
   */
  function extractPeaksAndPolygons(hmData, chOffset, H, W, vecData, regData, thresh, maxK) {
    const logitThresh = logitFromProb(thresh);
    const area = H * W;
    const peaks = [];

    for (let y = 0; y < H; y++) {
      const rowOff = chOffset + y * W;
      const yMin = y > 0 ? y - 1 : 0;
      const yMax = y < H - 1 ? y + 1 : H - 1;
      for (let x = 0; x < W; x++) {
        const val = hmData[rowOff + x];
        if (val < logitThresh) continue;

        // 3x3 max check (border value = 0 in probability space -> -Infinity in logit space,
        // so only compare against actual neighbors)
        let isMax = true;
        const xMin = x > 0 ? x - 1 : 0;
        const xMax = x < W - 1 ? x + 1 : W - 1;
        for (let ny = yMin; ny <= yMax && isMax; ny++) {
          const nRow = chOffset + ny * W;
          for (let nx = xMin; nx <= xMax; nx++) {
            if (hmData[nRow + nx] > val) {
              isMax = false;
              break;
            }
          }
        }
        if (isMax) {
          peaks.push({
            score: sigmoidScalar(val),
            x,
            y,
            idx: y * W + x
          });
        }
      }
    }

    peaks.sort((a, b) => b.score - a.score);
    if (peaks.length > maxK) peaks.length = maxK;

    const n = peaks.length;
    const scores = new Float32Array(n);
    const xs = new Int32Array(n);
    const ys = new Int32Array(n);
    const pxs = new Float32Array(n);
    const pys = new Float32Array(n);
    const polys = new Float32Array(n * 8);
    const aabbs = new Float32Array(n * 4); // [minX, minY, maxX, maxY]

    for (let i = 0; i < n; i++) {
      const pk = peaks[i];
      const idx = pk.idx;
      scores[i] = pk.score;
      xs[i] = pk.x;
      ys[i] = pk.y;

      const px = pk.x + regData[idx];
      const py = pk.y + regData[area + idx];
      pxs[i] = px;
      pys[i] = py;

      const po = i * 8;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let j = 0; j < 4; j++) {
        const vx = px - vecData[(2 * j) * area + idx];
        const vy = py - vecData[(2 * j + 1) * area + idx];
        polys[po + 2 * j] = vx;
        polys[po + 2 * j + 1] = vy;
        if (vx < minX) minX = vx;
        if (vx > maxX) maxX = vx;
        if (vy < minY) minY = vy;
        if (vy > maxY) maxY = vy;
      }
      const ao = i * 4;
      aabbs[ao] = minX;
      aabbs[ao + 1] = minY;
      aabbs[ao + 2] = maxX;
      aabbs[ao + 3] = maxY;
    }

    return { n, scores, xs, ys, pxs, pys, polys, aabbs };
  }

  /** Strictly inside polygon check matching cv2.pointPolygonTest(..., False) > 0 */
  function pointStrictlyInsideQuad(px, py, polys, off) {
    let inside = false;
    for (let i = 0, j = 3; i < 4; j = i++) {
      const xi = polys[off + 2 * i];
      const yi = polys[off + 2 * i + 1];
      const xj = polys[off + 2 * j];
      const yj = polys[off + 2 * j + 1];

      // On-edge check (returns false since strictly inside is required)
      const dx = xj - xi;
      const dy = yj - yi;
      const cross = (px - xi) * dy - (py - yi) * dx;
      if (Math.abs(cross) < 1e-6) {
        if (
          px >= Math.min(xi, xj) - 1e-6 && px <= Math.max(xi, xj) + 1e-6 &&
          py >= Math.min(yi, yj) - 1e-6 && py <= Math.max(yi, yj) + 1e-6
        ) {
          return false;
        }
      }

      if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  }

  function anyCornerStrictlyInside(originPolys, originOff, candPolys, candOff) {
    for (let k = 0; k < 4; k++) {
      const cx = candPolys[candOff + 2 * k];
      const cy = candPolys[candOff + 2 * k + 1];
      if (pointStrictlyInsideQuad(cx, cy, originPolys, originOff)) {
        return true;
      }
    }
    return false;
  }

  function sampleLcAtPolygon(lcData, H, W, poly8, outLc) {
    const area = H * W;
    for (let j = 0; j < 4; j++) {
      let xi = Math.trunc(poly8[2 * j]);
      let yi = Math.trunc(poly8[2 * j + 1]);
      if (xi < 0) xi = 0; else if (xi >= W) xi = W - 1;
      if (yi < 0) yi = 0; else if (yi >= H) yi = H - 1;
      const idx = yi * W + xi;
      outLc[2 * j] = lcData[idx];
      outLc[2 * j + 1] = lcData[area + idx];
    }
  }

  function getLogicCoords(lc8, spanCol, spanRow) {
    const colSpan = roundAtLeastOne(spanCol);
    const rowSpan = roundAtLeastOne(spanRow);

    const c0 = roundAtLeastOne(lc8[0]);
    const c1 = roundAtLeastOne(lc8[2]);
    const c2 = roundAtLeastOne(lc8[4]);
    const c3 = roundAtLeastOne(lc8[6]);

    const r0 = roundAtLeastOne(lc8[1]);
    const r1 = roundAtLeastOne(lc8[3]);
    const r2 = roundAtLeastOne(lc8[5]);
    const r3 = roundAtLeastOne(lc8[7]);

    let startCol, endCol;
    if (c0 === c3) {
      startCol = c0;
      endCol = startCol + colSpan - 1;
    } else if (c1 === c2) {
      endCol = Math.max(colSpan + 1, c1) - 1;
      startCol = endCol + 1 - colSpan;
    } else if (Math.abs(lc8[0] - lc8[6]) <= Math.abs(lc8[2] - lc8[4])) {
      startCol = roundAtLeastOne((lc8[0] + lc8[6]) * 0.5);
      endCol = startCol + colSpan - 1;
    } else {
      endCol = Math.max(colSpan + 1, roundHalfToEven((lc8[2] + lc8[4]) * 0.5)) - 1;
      startCol = endCol + 1 - colSpan;
    }

    let startRow, endRow;
    if (r0 === r1) {
      startRow = r0;
      endRow = startRow + rowSpan - 1;
    } else if (r2 === r3) {
      endRow = Math.max(rowSpan + 1, r2) - 1;
      startRow = endRow + 1 - rowSpan;
    } else if (Math.abs(lc8[1] - lc8[3]) <= Math.abs(lc8[5] - lc8[7])) {
      startRow = roundAtLeastOne((lc8[1] + lc8[3]) * 0.5);
      endRow = startRow + rowSpan - 1;
    } else {
      endRow = Math.max(rowSpan + 1, roundHalfToEven((lc8[5] + lc8[7]) * 0.5)) - 1;
      startRow = endRow + 1 - rowSpan;
    }

    return [startCol, endCol, startRow, endRow];
  }

  /**
   * Port of TableCenterNet `decode_official` + inverse affine mapping to crop-local coordinates.
   */
  function decodeOfficial(outputs, meta, options = {}) {
    const centerK = options.centerK || DEFAULT_CENTER_K;
    const cornerK = options.cornerK || DEFAULT_CORNER_K;
    const centerThresh = options.centerThresh ?? DEFAULT_CENTER_THRESH;
    const cornerThresh = options.cornerThresh ?? DEFAULT_CORNER_THRESH;

    const hm = outputs.hm;
    const reg = outputs.reg;
    const ct2cn = outputs.ct2cn;
    const cn2ct = outputs.cn2ct;
    const lc = outputs.lc;
    const sp = outputs.sp;

    const H = hm.dims[2];
    const W = hm.dims[3];
    const area = H * W;

    const centers = extractPeaksAndPolygons(hm.data, 0, H, W, ct2cn.data, reg.data, centerThresh, centerK);
    const corners = extractPeaksAndPolygons(hm.data, area, H, W, cn2ct.data, reg.data, cornerThresh, cornerK);

    const cornerLogicX = new Float32Array(corners.n);
    const cornerLogicY = new Float32Array(corners.n);
    for (let j = 0; j < corners.n; j++) {
      const idx = corners.ys[j] * W + corners.xs[j];
      cornerLogicX[j] = lc.data[idx];
      cornerLogicY[j] = lc.data[area + idx];
    }

    const results = [];
    const fixed = new Float32Array(8);
    const lcBuf = new Float32Array(8);
    const fallbackLc = new Float32Array(8);
    const hasLc = new Uint8Array(4);

    const invScaleX = meta.scale / W;
    const invScaleY = meta.scale / H;
    const halfW = W * 0.5;
    const halfH = H * 0.5;

    for (let i = 0; i < centers.n; i++) {
      const oOff = i * 8;
      const aOff = i * 4;
      const oMinX = centers.aabbs[aOff];
      const oMinY = centers.aabbs[aOff + 1];
      const oMaxX = centers.aabbs[aOff + 2];
      const oMaxY = centers.aabbs[aOff + 3];

      for (let k = 0; k < 8; k++) fixed[k] = centers.polys[oOff + k];
      hasLc.fill(0);

      let firstFixes = 0;
      let replaceFixes = 0;

      for (let j = 0; j < corners.n; j++) {
        const ca = j * 4;
        if (
          oMinX > corners.aabbs[ca + 2] ||
          corners.aabbs[ca] > oMaxX ||
          oMinY > corners.aabbs[ca + 3] ||
          corners.aabbs[ca + 1] > oMaxY
        ) {
          continue;
        }
        const cOff = j * 8;
        if (!anyCornerStrictlyInside(centers.polys, oOff, corners.polys, cOff)) {
          continue;
        }

        const cx = corners.pxs[j];
        const cy = corners.pys[j];
        // Find nearest corner index among 4 corners of origin polygon
        let bestCi = 0;
        let bestD2 = Infinity;
        for (let ci = 0; ci < 4; ci++) {
          const dx = centers.polys[oOff + 2 * ci] - cx;
          const dy = centers.polys[oOff + 2 * ci + 1] - cy;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD2) {
            bestD2 = d2;
            bestCi = ci;
          }
        }

        const ox = centers.polys[oOff + 2 * bestCi];
        const oy = centers.polys[oOff + 2 * bestCi + 1];
        const curX = fixed[2 * bestCi];
        const curY = fixed[2 * bestCi + 1];

        if (curX === ox && curY === oy) {
          firstFixes++;
          fixed[2 * bestCi] = cx;
          fixed[2 * bestCi + 1] = cy;
          lcBuf[2 * bestCi] = cornerLogicX[j];
          lcBuf[2 * bestCi + 1] = cornerLogicY[j];
          hasLc[bestCi] = 1;
        } else {
          const oldD2 = (ox - curX) * (ox - curX) + (oy - curY) * (oy - curY);
          const newD2 = (ox - cx) * (ox - cx) + (oy - cy) * (oy - cy);
          if (oldD2 >= newD2) {
            replaceFixes++;
            fixed[2 * bestCi] = cx;
            fixed[2 * bestCi + 1] = cy;
            lcBuf[2 * bestCi] = cornerLogicX[j];
            lcBuf[2 * bestCi + 1] = cornerLogicY[j];
            hasLc[bestCi] = 1;
          }
        }
      }

      let score = centers.scores[i];
      if ((firstFixes + replaceFixes) <= CELL_MIN_OPTIMIZE_COUNT) {
        score *= CELL_DECAY;
      }
      if (score < centerThresh) continue;

      if (!hasLc[0] || !hasLc[1] || !hasLc[2] || !hasLc[3]) {
        sampleLcAtPolygon(lc.data, H, W, fixed, fallbackLc);
        for (let k = 0; k < 4; k++) {
          if (!hasLc[k]) {
            lcBuf[2 * k] = fallbackLc[2 * k];
            lcBuf[2 * k + 1] = fallbackLc[2 * k + 1];
          }
        }
      }

      const cIdx = centers.ys[i] * W + centers.xs[i];
      const logic1 = getLogicCoords(lcBuf, sp.data[cIdx], sp.data[area + cIdx]);
      const logic0 = [logic1[0] - 1, logic1[1] - 1, logic1[2] - 1, logic1[3] - 1];

      // Inverse affine map from feature map (W x H) back to crop-local image coordinates
      const mappedCorners = [
        [(fixed[0] - halfW) * invScaleX + meta.centerX, (fixed[1] - halfH) * invScaleY + meta.centerY],
        [(fixed[2] - halfW) * invScaleX + meta.centerX, (fixed[3] - halfH) * invScaleY + meta.centerY],
        [(fixed[4] - halfW) * invScaleX + meta.centerX, (fixed[5] - halfH) * invScaleY + meta.centerY],
        [(fixed[6] - halfW) * invScaleX + meta.centerX, (fixed[7] - halfH) * invScaleY + meta.centerY]
      ];

      results.push({
        score,
        corners: mappedCorners,
        logic_axis_1based: logic1,
        logic_axis_0based: logic0,
        start_col: logic1[0],
        end_col: logic1[1],
        start_row: logic1[2],
        end_row: logic1[3]
      });
    }

    results.sort((a, b) => b.score - a.score);
    return results;
  }

  // -------------------------------------------------------------------------
  // Table region merging, logical grid reconstruction & OCR line assignment
  // -------------------------------------------------------------------------
  function bboxesOverlap(a, b) {
    return Math.max(a[0], b[0]) < Math.min(a[2], b[2]) && Math.max(a[1], b[1]) < Math.min(a[3], b[3]);
  }

  function mergeOverlappingTableRegions(regions) {
    if (!regions || regions.length === 0) return [];
    const visited = new Uint8Array(regions.length);
    const merged = [];

    for (let start = 0; start < regions.length; start++) {
      if (visited[start]) continue;
      const comp = [];
      const stack = [start];
      visited[start] = 1;
      while (stack.length > 0) {
        const cur = stack.pop();
        comp.push(cur);
        const curBox = regions[cur].bbox;
        for (let cand = 0; cand < regions.length; cand++) {
          if (visited[cand]) continue;
          if (bboxesOverlap(curBox, regions[cand].bbox)) {
            visited[cand] = 1;
            stack.push(cand);
          }
        }
      }
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      let maxConf = 0;
      for (const idx of comp) {
        const b = regions[idx].bbox;
        if (b[0] < x0) x0 = b[0];
        if (b[1] < y0) y0 = b[1];
        if (b[2] > x1) x1 = b[2];
        if (b[3] > y1) y1 = b[3];
        if ((regions[idx].confidence || 0) > maxConf) maxConf = regions[idx].confidence || 0;
      }
      merged.push({
        bbox: [Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1)],
        confidence: maxConf
      });
    }
    return merged;
  }

  function median(arr) {
    if (!arr || arr.length === 0) return 0;
    const s = arr.slice().sort((a, b) => a - b);
    const mid = s.length >> 1;
    return (s.length & 1) ? s[mid] : (s[mid - 1] + s[mid]) * 0.5;
  }

  function cellGridRange(cell) {
    const logic = cell && cell.logic_axis_0based;
    if (!Array.isArray(logic) || logic.length < 4) return null;
    const c1 = Math.min(logic[0] | 0, logic[1] | 0);
    const c2 = Math.max(logic[0] | 0, logic[1] | 0);
    const r1 = Math.min(logic[2] | 0, logic[3] | 0);
    const r2 = Math.max(logic[2] | 0, logic[3] | 0);
    if (c1 < 0 || r1 < 0 || c2 > 255 || r2 > 255) return null;
    return [c1, c2, r1, r2];
  }

  function repopulateAxis(votesMap, count, lo, hi) {
    const res = new Float32Array(count);
    const known = new Uint8Array(count);
    res[0] = lo;
    known[0] = 1;
    if (count > 1) {
      res[count - 1] = hi;
      known[count - 1] = 1;
    }
    const span = Math.max(hi - lo, 1.0);
    const eps = Math.max(span * 1e-5, 1e-3);

    for (const [kStr, vals] of votesMap.entries()) {
      const idx = Number(kStr);
      if (idx > 0 && idx < count - 1 && vals.length > 0) {
        const med = median(vals);
        res[idx] = Math.min(Math.max(med, lo + eps), hi - eps);
        known[idx] = 1;
      }
    }

    // Linear interpolation for missing interior ticks
    let prev = 0;
    for (let i = 1; i < count; i++) {
      if (known[i]) {
        if (i - prev > 1) {
          const step = (res[i] - res[prev]) / (i - prev);
          for (let m = prev + 1; m < i; m++) {
            res[m] = res[prev] + step * (m - prev);
          }
        }
        prev = i;
      }
    }

    // Enforce strict monotonicity while keeping endpoints pinned
    for (let i = 1; i < count - 1; i++) {
      const minAllowed = res[i - 1] + eps;
      const maxAllowed = hi - eps * (count - 1 - i);
      res[i] = Math.min(Math.max(res[i], minAllowed), maxAllowed);
    }
    res[0] = lo;
    if (count > 1) res[count - 1] = hi;
    return res;
  }

  function bboxIntersectionRatio(a, b) {
    const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
    const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    const area = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
    return area > 0 ? (ix * iy) / area : 0;
  }

  function bboxIou(a, b) {
    const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
    const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    const inter = ix * iy;
    if (inter <= 0) return 0;
    const ua = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]) +
               Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]) - inter;
    return ua > 0 ? inter / ua : 0;
  }

  function buildLogicalOcrGrid(cells, tableBbox, ocrLines) {
    const xVotes = new Map();
    const yVotes = new Map();
    const allX = [];
    const allY = [];
    const unitWs = [];
    const unitHs = [];
    let maxCol = -1;
    let maxRow = -1;

    const addVote = (map, k, v1, v2) => {
      let arr = map.get(k);
      if (!arr) {
        arr = [];
        map.set(k, arr);
      }
      arr.push(v1, v2);
    };

    for (const cell of cells) {
      const range = cellGridRange(cell);
      if (!range || !Array.isArray(cell.corners) || cell.corners.length !== 4) continue;
      const [c1, c2, r1, r2] = range;
      const [tl, tr, br, bl] = cell.corners;
      if (!Number.isFinite(tl[0]) || !Number.isFinite(br[1])) continue;

      if (c2 > maxCol) maxCol = c2;
      if (r2 > maxRow) maxRow = r2;
      addVote(xVotes, c1, tl[0], bl[0]);
      addVote(xVotes, c2 + 1, tr[0], br[0]);
      addVote(yVotes, r1, tl[1], tr[1]);
      addVote(yVotes, r2 + 1, bl[1], br[1]);
      allX.push(tl[0], tr[0], br[0], bl[0]);
      allY.push(tl[1], tr[1], br[1], bl[1]);

      const colSpan = Math.max(1, c2 - c1 + 1);
      const rowSpan = Math.max(1, r2 - r1 + 1);
      const leftX = (tl[0] + bl[0]) * 0.5;
      const rightX = (tr[0] + br[0]) * 0.5;
      const topY = (tl[1] + tr[1]) * 0.5;
      const bottomY = (bl[1] + br[1]) * 0.5;
      if (rightX > leftX) unitWs.push((rightX - leftX) / colSpan);
      if (bottomY > topY) unitHs.push((bottomY - topY) / rowSpan);
    }

    if (maxCol < 0 || maxRow < 0 || allX.length === 0) return null;

    let tx1, ty1, tx2, ty2;
    if (Array.isArray(tableBbox) && tableBbox.length >= 4 && tableBbox[2] > tableBbox[0] && tableBbox[3] > tableBbox[1]) {
      [tx1, ty1, tx2, ty2] = tableBbox;
    } else {
      tx1 = Math.min(...allX);
      ty1 = Math.min(...allY);
      tx2 = Math.max(...allX);
      ty2 = Math.max(...allY);
    }

    const baseCols = maxCol + 1;
    const baseRows = maxRow + 1;
    const medW = Math.max(1, unitWs.length ? median(unitWs) : (tx2 - tx1) / Math.max(1, baseCols));
    const medH = Math.max(1, unitHs.length ? median(unitHs) : (ty2 - ty1) / Math.max(1, baseRows));

    let detectedRight = -Infinity;
    for (const vals of xVotes.values()) {
      for (const v of vals) if (v > detectedRight) detectedRight = v;
    }
    let detectedBottom = -Infinity;
    for (const vals of yVotes.values()) {
      for (const v of vals) if (v > detectedBottom) detectedBottom = v;
    }

    const hasOcrInBand = (axis, start, end) => {
      if (end <= start) return false;
      for (const line of ocrLines) {
        const b = line.bbox;
        if (!b) continue;
        const cx = (b.x0 + b.x1) * 0.5;
        const cy = (b.y0 + b.y1) * 0.5;
        if (axis === 'x') {
          if (cx >= start && cx <= end && cy >= ty1 && cy <= ty2) return true;
        } else {
          if (cy >= start && cy <= end && cx >= tx1 && cx <= tx2) return true;
        }
      }
      return false;
    };

    let extraCols = 0;
    const rightGap = Math.max(0, tx2 - detectedRight);
    if (rightGap >= medW * 0.55 && hasOcrInBand('x', detectedRight, tx2)) {
      extraCols = Math.min(32, Math.max(1, roundHalfToEven(rightGap / medW)));
    }
    let extraRows = 0;
    const bottomGap = Math.max(0, ty2 - detectedBottom);
    if (bottomGap >= medH * 0.55 && hasOcrInBand('y', detectedBottom, ty2)) {
      extraRows = Math.min(32, Math.max(1, roundHalfToEven(bottomGap / medH)));
    }

    const cols = baseCols + extraCols;
    const rows = baseRows + extraRows;
    const xBounds = repopulateAxis(xVotes, cols + 1, tx1, tx2);
    const yBounds = repopulateAxis(yVotes, rows + 1, ty1, ty2);
    const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => []));
    return { xBounds, yBounds, grid, rows, cols };
  }

  function findSlotIndex(bounds, val, count) {
    let lo = 0, hi = count - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (val >= bounds[mid + 1]) lo = mid + 1;
      else if (val < bounds[mid]) hi = mid - 1;
      else return mid;
    }
    return Math.min(Math.max(lo, 0), count - 1);
  }

  function assignOcrLinesToCells(cells, ocrLines, tableBbox, iouThreshold = 0.5) {
    for (const cell of cells) cell._ocrLines = [];
    const built = buildLogicalOcrGrid(cells, tableBbox, ocrLines || []);
    if (!built) return;
    const { xBounds, yBounds, grid, rows, cols } = built;

    // Assign each OCR line to one elementary grid slot
    const assigned = [];
    for (let order = 0; order < (ocrLines || []).length; order++) {
      const line = ocrLines[order];
      const b = line && line.bbox;
      if (!b) continue;
      const arr = [b.x0, b.y0, b.x1, b.y1];
      const cx = (b.x0 + b.x1) * 0.5;
      const cy = (b.y0 + b.y1) * 0.5;
      let r = -1, c = -1;
      if (cx >= xBounds[0] && cx <= xBounds[cols] && cy >= yBounds[0] && cy <= yBounds[rows]) {
        c = findSlotIndex(xBounds, cx, cols);
        r = findSlotIndex(yBounds, cy, rows);
      } else {
        let bestRatio = 0;
        for (let rr = 0; rr < rows; rr++) {
          for (let cc = 0; cc < cols; cc++) {
            const ratio = bboxIntersectionRatio(arr, [xBounds[cc], yBounds[rr], xBounds[cc + 1], yBounds[rr + 1]]);
            if (ratio > bestRatio) {
              bestRatio = ratio;
              r = rr;
              c = cc;
            }
          }
        }
        if (bestRatio < 0.2) continue;
      }
      if (r >= 0 && c >= 0) {
        const area = Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
        assigned.push({ area, order, r, c, line, arr });
      }
    }

    // Deduplicate overlapping assigned OCR lines (larger area wins)
    assigned.sort((a, b) => (b.area - a.area) || (a.order - b.order));
    const kept = [];
    for (const item of assigned) {
      if (kept.some((k) => bboxIou(item.arr, k.arr) >= iouThreshold)) continue;
      kept.push(item);
    }
    kept.sort((a, b) => a.order - b.order);

    for (const item of kept) {
      grid[item.r][item.c].push(item.line);
    }

    // Sort lines within each slot
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const slot = grid[r][c];
        if (slot.length <= 1) continue;
        const vertCount = slot.filter((l) => l.isVertical).length;
        if (vertCount > slot.length * 0.5) {
          slot.sort((a, b) => (b.bbox.x0 - a.bbox.x0) || (a.bbox.y0 - b.bbox.y0));
        } else {
          slot.sort((a, b) => (a.bbox.y0 - b.bbox.y0) || (a.bbox.x0 - b.bbox.x0));
        }
      }
    }

    // Recover missing cells that contain OCR lines and have >= 2 structural supports
    const occupied = new Uint8Array(rows * cols);
    for (const cell of cells) {
      const range = cellGridRange(cell);
      if (!range) continue;
      const [c1, c2, r1, r2] = range;
      const rr2 = Math.min(r2, rows - 1);
      const cc2 = Math.min(c2, cols - 1);
      for (let rr = r1; rr <= rr2; rr++) {
        for (let cc = c1; cc <= cc2; cc++) {
          occupied[rr * cols + cc] = 1;
        }
      }
    }

    const outerSupport = Boolean(tableBbox);
    const supportCount = (r, c) => {
      let s = 0;
      if (r > 0 && occupied[(r - 1) * cols + c]) s++;
      if (r + 1 < rows && occupied[(r + 1) * cols + c]) s++;
      if (c > 0 && occupied[r * cols + (c - 1)]) s++;
      if (c + 1 < cols && occupied[r * cols + (c + 1)]) s++;
      if (outerSupport && (r === 0 || r === rows - 1 || c === 0 || c === cols - 1)) s++;
      return s;
    };

    let changed = true;
    while (changed) {
      changed = false;
      const cands = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (occupied[r * cols + c] || grid[r][c].length === 0) continue;
          const sup = supportCount(r, c);
          if (sup >= 2) cands.push([sup, r, c]);
        }
      }
      cands.sort((a, b) => (b[0] - a[0]) || (a[1] - b[1]) || (a[2] - b[2]));
      for (const [, r, c] of cands) {
        if (occupied[r * cols + c] || supportCount(r, c) < 2) continue;
        const x1 = xBounds[c], x2 = xBounds[c + 1];
        const y1 = yBounds[r], y2 = yBounds[r + 1];
        if (!(x2 > x1 && y2 > y1)) continue;
        cells.push({
          score: 0.0,
          corners: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]],
          logic_axis_0based: [c, c, r, r],
          logic_axis_1based: [c + 1, c + 1, r + 1, r + 1],
          start_col: c + 1,
          end_col: c + 1,
          start_row: r + 1,
          end_row: r + 1,
          synthetic: true,
          _ocrLines: []
        });
        occupied[r * cols + c] = 1;
        changed = true;
      }
    }

    // Collect assigned lines per cell
    for (const cell of cells) {
      const range = cellGridRange(cell);
      if (!range) continue;
      const [c1, c2, r1, r2] = range;
      if (r2 >= rows || c2 >= cols) continue;
      const covered = [];
      for (let rr = r1; rr <= r2; rr++) {
        for (let cc = c1; cc <= c2; cc++) {
          for (const ln of grid[rr][cc]) covered.push(ln);
        }
      }
      const isVert = covered.length > 0 && covered.filter((l) => l.isVertical).length > covered.length * 0.5;
      const ordered = [];
      if (isVert) {
        for (let cc = c2; cc >= c1; cc--) {
          for (let rr = r1; rr <= r2; rr++) ordered.push(...grid[rr][cc]);
        }
      } else {
        for (let rr = r1; rr <= r2; rr++) {
          for (let cc = c1; cc <= c2; cc++) ordered.push(...grid[rr][cc]);
        }
      }
      const seen = new Set();
      const unique = [];
      for (const ln of ordered) {
        if (seen.has(ln)) continue;
        seen.add(ln);
        unique.push(ln);
      }
      cell._ocrLines = unique;
      cell._ocrLinesOrdered = true;
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeMarkdownCell(str) {
    return String(str)
      .replace(/\\/g, '\\\\')
      .replace(/\|/g, '\\|')
      .replace(/\r/g, '')
      .replace(/\n/g, '<br>');
  }

  function getOrderedCellLines(cell) {
    const raw = cell._ocrLines || [];
    if (raw.length <= 1 || cell._ocrLinesOrdered) return raw;
    const vertCount = raw.filter((l) => l && l.isVertical).length;
    if (vertCount > raw.length * 0.5) {
      return raw.slice().sort((a, b) => (b.bbox.x0 - a.bbox.x0) || (a.bbox.y0 - b.bbox.y0));
    }
    return raw.slice().sort((a, b) => (a.bbox.y0 - b.bbox.y0) || (a.bbox.x0 - b.bbox.x0));
  }

  function formatCellLines(cell, joiner) {
    const lines = getOrderedCellLines(cell);
    return lines.map((l) => (l.text || '').trim()).filter(Boolean).join(joiner);
  }

  function buildCellStarts(cells) {
    const starts = new Map();
    let maxRow = 0;
    let maxCol = 0;
    const sorted = cells.slice().sort((a, b) => (b.score || 0) - (a.score || 0));
    for (const cell of sorted) {
      const range = cellGridRange(cell);
      if (!range) continue;
      const [c1, c2, r1, r2] = range;
      const key = `${r1},${c1}`;
      if (!starts.has(key)) {
        cell._grid = [c1, c2, r1, r2];
        starts.set(key, cell);
        if (r2 > maxRow) maxRow = r2;
        if (c2 > maxCol) maxCol = c2;
      }
    }
    return { starts, rows: starts.size ? maxRow + 1 : 0, cols: starts.size ? maxCol + 1 : 0 };
  }

  function getNonEmptyGridIndices(starts, rows, cols) {
    const rowHasText = new Uint8Array(rows);
    const colHasText = new Uint8Array(cols);
    for (const cell of starts.values()) {
      const txt = formatCellLines(cell, ' ');
      if (!txt) continue;
      const [c1, c2, r1, r2] = cell._grid;
      for (let rr = r1; rr <= r2; rr++) rowHasText[rr] = 1;
      for (let cc = c1; cc <= c2; cc++) colHasText[cc] = 1;
    }
    const keptRows = [];
    for (let r = 0; r < rows; r++) if (rowHasText[r]) keptRows.push(r);
    const keptCols = [];
    for (let c = 0; c < cols; c++) if (colHasText[c]) keptCols.push(c);
    // If all cells were empty, preserve original indices
    if (keptRows.length === 0 || keptCols.length === 0) {
      return {
        keptRows: Array.from({ length: rows }, (_, i) => i),
        keptCols: Array.from({ length: cols }, (_, i) => i)
      };
    }
    return { keptRows, keptCols };
  }

  function cellsToMarkdown(cells, ocrLines = null, options = {}) {
    if (!cells || cells.length === 0) return '';
    if (ocrLines !== null) {
      assignOcrLinesToCells(cells, ocrLines, options.tableBbox || null, options.iouThreshold ?? 0.5);
    }
    const { starts, rows, cols } = buildCellStarts(cells);
    if (rows === 0 || cols === 0) return '';

    const fullGrid = Array.from({ length: rows }, () => Array(cols).fill(''));
    for (const cell of starts.values()) {
      const [c1, c2, r1, r2] = cell._grid;
      const txt = escapeMarkdownCell(formatCellLines(cell, '<br>'));
      for (let rr = r1; rr <= r2; rr++) {
        for (let cc = c1; cc <= c2; cc++) {
          fullGrid[rr][cc] = txt;
        }
      }
    }

    const { keptRows, keptCols } = getNonEmptyGridIndices(starts, rows, cols);
    const grid = keptRows.map((r) => keptCols.map((c) => fullGrid[r][c]));
    const outCols = keptCols.length;
    const header = '| ' + grid[0].join(' | ') + ' |';
    const sep = '| ' + Array(outCols).fill('---').join(' | ') + ' |';
    const body = grid.slice(1).map((row) => '| ' + row.join(' | ') + ' |');
    return [header, sep, ...body].join('\n');
  }

  function cellsToHtml(cells, ocrLines = null, options = {}) {
    if (!cells || cells.length === 0) return '<table class="tablecenternet"><tbody></tbody></table>';
    if (ocrLines !== null) {
      assignOcrLinesToCells(cells, ocrLines, options.tableBbox || null, options.iouThreshold ?? 0.5);
    }
    const { starts, rows, cols } = buildCellStarts(cells);
    if (rows === 0 || cols === 0) return '<table class="tablecenternet"><tbody></tbody></table>';

    const { keptRows, keptCols } = getNonEmptyGridIndices(starts, rows, cols);
    const rowSet = new Set(keptRows);
    const colSet = new Set(keptCols);
    const occupied = new Uint8Array(rows * cols);
    const out = ['<table class="tablecenternet">', '  <tbody>'];
    for (const r of keptRows) {
      out.push('    <tr>');
      for (const c of keptCols) {
        if (occupied[r * cols + c]) continue;
        const cell = starts.get(`${r},${c}`);
        if (!cell) {
          out.push('      <td></td>');
          continue;
        }
        const [c1, c2, r1, r2] = cell._grid;
        let rowspan = 0;
        for (let rr = r1; rr <= r2; rr++) if (rowSet.has(rr)) rowspan++;
        let colspan = 0;
        for (let cc = c1; cc <= c2; cc++) if (colSet.has(cc)) colspan++;
        const attrs = [];
        if (rowspan > 1) attrs.push(`rowspan="${rowspan}"`);
        if (colspan > 1) attrs.push(`colspan="${colspan}"`);
        const attrStr = attrs.length ? ' ' + attrs.join(' ') : '';
        const content = getOrderedCellLines(cell)
          .map((l) => escapeHtml((l.text || '').trim()))
          .filter(Boolean)
          .join('<br>');
        out.push(`      <td${attrStr}>${content}</td>`);
        for (let rr = r1; rr <= r2; rr++) {
          for (let cc = c1; cc <= c2; cc++) occupied[rr * cols + cc] = 1;
        }
      }
      out.push('    </tr>');
    }
    out.push('  </tbody>', '</table>');
    return out.join('\n');
  }

  // -------------------------------------------------------------------------
  // High-level API: infer structured tables for DEIM-detected `block_table` regions
  // -------------------------------------------------------------------------
  async function inferTables(srcCanvas, imgW, imgH, tableRegions, ocrLineBlocks, options = {}) {
    const mergedRegions = mergeOverlappingTableRegions(tableRegions);
    if (mergedRegions.length === 0) return [];

    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const cropPadding = options.cropPadding ?? 8;
    const session = await getTableSession(onProgress);
    const inputSize = getTableInputSize(session);
    const inputName = session.inputNames[0];

    const tables = [];
    for (let idx = 0; idx < mergedRegions.length; idx++) {
      const reg = mergedRegions[idx];
      const [bx1, by1, bx2, by2] = reg.bbox;
      const tw = Math.max(1, bx2 - bx1);
      const th = Math.max(1, by2 - by1);
      const marginX = Math.max(cropPadding, Math.round(tw * 0.02));
      const marginY = Math.max(cropPadding, Math.round(th * 0.02));
      const x1 = Math.max(0, bx1 - marginX);
      const y1 = Math.max(0, by1 - marginY);
      const x2 = Math.min(imgW, bx2 + marginX);
      const y2 = Math.min(imgH, by2 + marginY);

      if (onProgress) onProgress(`analyzing table structure (${idx + 1}/${mergedRegions.length})`, Math.round((idx / mergedRegions.length) * 100));

      const { tensor, meta } = buildTableTensor(srcCanvas, x1, y1, x2 - x1, y2 - y1, inputSize);
      const out = await session.run({ [inputName]: tensor });

      const localCells = decodeOfficial(out, meta, options);
      const globalCells = localCells.map((cell) => ({
        ...cell,
        corners: cell.corners.map(([px, py]) => [px + x1, py + y1])
      }));

      // Keep OCR lines whose center falls inside this table layout region
      const tableLines = (ocrLineBlocks || []).filter((ln) => {
        if (!ln || !ln.bbox) return false;
        const cx = (ln.bbox.x0 + ln.bbox.x1) * 0.5;
        const cy = (ln.bbox.y0 + ln.bbox.y1) * 0.5;
        return cx >= bx1 && cx <= bx2 && cy >= by1 && cy <= by2;
      });

      assignOcrLinesToCells(globalCells, tableLines, [bx1, by1, bx2, by2]);
      const { starts: builtStarts, rows: rawRows, cols: rawCols } = buildCellStarts(globalCells);
      const { keptRows, keptCols } = getNonEmptyGridIndices(builtStarts, rawRows, rawCols);
      const rows = keptRows.length;
      const cols = keptCols.length;
      if (rows < 2 && cols < 2) continue;

      const markdown = cellsToMarkdown(globalCells);
      const html = cellsToHtml(globalCells);

      tables.push({
        tableIndex: idx + 1,
        bbox: { x0: bx1, y0: by1, x1: bx2, y1: by2 },
        rows,
        cols,
        numCells: globalCells.length,
        markdown,
        html
      });
    }
    return tables;
  }

  const api = {
    TABLE_MODEL_FILE,
    inferTables,
    decodeOfficial,
    assignOcrLinesToCells,
    cellsToMarkdown,
    cellsToHtml,
    mergeOverlappingTableRegions,
    isAvailable
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { NdlTableEngine: api };
  }
  if (global) {
    global.NdlTableEngine = api;
  }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
