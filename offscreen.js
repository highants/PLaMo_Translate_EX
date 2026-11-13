/**
 * PLaMo Translate - Offscreen Document Wllama Worker
 * Runs @wllama/wllama in an offscreen document with WebAssembly / WebGPU
 */

import { Wllama } from './vendor/wllama/esm/index.js';

// Configuration for local WebAssembly binary bundled inside the Chrome extension
const WASM_PATH_CONFIG = {
  default: chrome.runtime.getURL('vendor/wllama/esm/wasm/wllama.wasm')
};

// Fallback model URL if not provided by settings
const FALLBACK_MODEL_URL =
  (typeof DEFAULT_SETTINGS !== 'undefined' && DEFAULT_SETTINGS.wllamaModelUrl) ||
  'https://huggingface.co/pfnet/plamo-3-translate-0.8b-GGUF/resolve/main/plamo-3-translate-0.8b-Q4_K_M.gguf';

// Global state of the Wllama instance
const wllamaState = {
  status: 'idle', // 'idle' | 'downloading' | 'loading' | 'ready' | 'error'
  loaded: 0,
  total: 0,
  percent: 0,
  modelUrl: '',
  backend: null, // 'WebGPU' | 'WASM (CPU)' | null
  error: null
};

// Active instances and load tracking
let wllamaInstance = null;
let loadedModelUrl = null;
let loadedUseWebGpu = null;
let activeLoadPromise = null;

// Throttled progress broadcast
let lastBroadcastTime = 0;
let lastBroadcastStatus = null;
let lastBroadcastPercent = -1;

/**
 * Broadcast current Wllama progress/status to extension components (popup, background)
 * Throttles high-frequency progress updates to at most once per 120ms
 * @param {boolean} [force=false]
 */
function broadcastProgress(force = false) {
  const now = Date.now();
  const isTransition = wllamaState.status !== lastBroadcastStatus;
  const isComplete = wllamaState.percent >= 100 && lastBroadcastPercent < 100;

  if (!force && !isTransition && !isComplete && (now - lastBroadcastTime < 120)) {
    return;
  }

  lastBroadcastTime = now;
  lastBroadcastStatus = wllamaState.status;
  lastBroadcastPercent = wllamaState.percent;

  chrome.runtime.sendMessage({
    type: 'WLLAMA_PROGRESS',
    state: { ...wllamaState }
  }).catch(() => {
    // Ignore error if no listener (e.g., popup closed)
  });
}

/**
 * Extract human-readable filename or concise model tag
 * @param {string} url
 * @returns {string}
 */
function getShortModelName(url) {
  if (!url || typeof url !== 'string') return 'PLaMo-3';
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    const parts = pathname.split('/').filter(Boolean);
    const filename = parts.length > 0 ? parts[parts.length - 1] : url;
    // Extract concise name like "PLaMo-3 0.8B (Q4_K_M)"
    const match = filename.match(/plamo-3.*?-0\.8b-([a-zA-Z0-9_]+)\.gguf/i);
    if (match) {
      return `PLaMo-3 0.8B (${match[1]})`;
    }
    return filename.replace(/\.gguf$/i, '');
  } catch {
    const match = url.match(/plamo-3.*?-0\.8b-([a-zA-Z0-9_]+)\.gguf/i);
    if (match) {
      return `PLaMo-3 0.8B (${match[1]})`;
    }
    return 'PLaMo-3 0.8B';
  }
}

/**
 * Helper to get clean translation output using pfml.js or fallback
 * @param {string} rawText
 * @returns {string}
 */
function getCleanText(rawText) {
  if (typeof cleanTranslationOutput === 'function') {
    return cleanTranslationOutput(rawText);
  }
  if (!rawText || typeof rawText !== 'string') return '';
  let cleaned = rawText;
  const stopIndex = cleaned.search(/(?:<\/s>|<\|plamo:tag|<\|plamo:bos|<\|plamo:eos|<\|endoftext)/);
  if (stopIndex !== -1) {
    cleaned = cleaned.substring(0, stopIndex);
  }
  return cleaned
    .replace(/<\/s>/g, '')
    .replace(/<\|plamo:[^>]+?>/g, '')
    .replace(/<\|endoftext\|>/g, '')
    .replace(/<\|[a-z_]+?\|>/g, '')
    .trim();
}

/**
 * Helper to get stop tokens from pfml.js or fallback
 * @returns {string[]}
 */
function getStopTokens() {
  if (typeof STOP_TOKENS !== 'undefined' && Array.isArray(STOP_TOKENS)) {
    return STOP_TOKENS;
  }
  return [
    '</s>',
    '<|plamo:tag|>',
    '<|plamo:bos|>',
    '<|plamo:eos|>',
    '<|endoftext|>'
  ];
}

/**
 * Inspect cached models in storage
 * @returns {Promise<Array<{ url: string, size: number }>>}
 */
async function getCachedModelsList() {
  try {
    const mgr = wllamaInstance || new Wllama(WASM_PATH_CONFIG, {
      suppressNativeLog: true,
      allowOffline: true
    });
    mgr.setCompat(null);

    const models = await mgr.modelManager.getModels();
    return (models || [])
      .filter(m => {
        try {
          return m && (typeof m.validate === 'function' ? m.validate() === 'valid' : true) && m.size > 0;
        } catch {
          return false;
        }
      })
      .map(m => ({
        url: m.url,
        size: m.size
      }));
  } catch (err) {
    console.warn('[Offscreen] Failed to retrieve cached models:', err);
    return [];
  }
}

/**
 * Ensure the requested model is loaded into memory and ready for inference
 * @param {object} options
 * @param {string} options.modelUrl
 * @param {boolean} [options.useWebGpu=true]
 * @param {number} [options.nCtx=2048]
 * @returns {Promise<typeof wllamaState>}
 */
async function ensureModelLoaded({ modelUrl, useWebGpu = true, nCtx = 2048 }) {
  const targetModelUrl = modelUrl || (typeof DEFAULT_SETTINGS !== 'undefined' && DEFAULT_SETTINGS.wllamaModelUrl) || FALLBACK_MODEL_URL;
  const wantWebGpu = Boolean(useWebGpu);
  const targetCtx = Number(nCtx) || 2048;

  // 1. If a model loading operation is already running, await it
  if (activeLoadPromise) {
    await activeLoadPromise;
    return wllamaState;
  }

  // 2. If the model is already loaded with matching configuration, reuse it
  if (
    wllamaInstance &&
    wllamaInstance.isModelLoaded() &&
    loadedModelUrl === targetModelUrl &&
    loadedUseWebGpu === wantWebGpu
  ) {
    return wllamaState;
  }

  // 3. Unload any existing model if parameters changed
  if (wllamaInstance) {
    await wllamaInstance.exit().catch(() => { });
    wllamaInstance = null;
    loadedModelUrl = null;
    loadedUseWebGpu = null;
  }

  // 4. Start load process
  activeLoadPromise = (async () => {
    try {
      wllamaState.status = 'downloading';
      wllamaState.loaded = 0;
      wllamaState.total = 0;
      wllamaState.percent = 0;
      wllamaState.modelUrl = targetModelUrl;
      wllamaState.backend = null;
      wllamaState.error = null;
      broadcastProgress(true);

      const progressCallback = ({ loaded, total }) => {
        wllamaState.loaded = loaded;
        wllamaState.total = total;
        wllamaState.percent = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
        wllamaState.status = wllamaState.percent >= 100 ? 'loading' : 'downloading';
        broadcastProgress();
      };

      let instance = new Wllama(WASM_PATH_CONFIG, {
        suppressNativeLog: true,
        allowOffline: true
      });
      instance.setCompat(null);

      const webGpuSupported = Boolean(navigator.gpu) && (
        typeof instance.isSupportWebGPU === 'function' ? instance.isSupportWebGPU() : false
      );
      let actualGpuUsed = false;

      // Attempt loading with WebGPU if requested and supported
      if (wantWebGpu && webGpuSupported) {
        let gpuLoadTimeoutId = null;
        try {
          console.log('[Offscreen] Attempting to load model with WebGPU (n_gpu_layers: 99)...');
          const gpuTimeoutPromise = new Promise((_, reject) => {
            const wrappedProgress = ({ loaded, total }) => {
              progressCallback({ loaded, total });
              if (total > 0 && loaded >= total && !gpuLoadTimeoutId) {
                gpuLoadTimeoutId = setTimeout(() => {
                  reject(new Error('WebGPU initialization timed out after download completed'));
                }, 25000);
              }
            };
            instance._wrappedProgress = wrappedProgress;
          });
          await Promise.race([
            instance.loadModelFromUrl(targetModelUrl, {
              n_gpu_layers: 99,
              n_ctx: targetCtx,
              n_threads: 1,
              n_parallel: 1,
              useCache: true,
              progressCallback: instance._wrappedProgress || progressCallback
            }),
            gpuTimeoutPromise
          ]);
          actualGpuUsed = true;
        } catch (gpuErr) {
          console.warn('[Offscreen] WebGPU loading failed, falling back to CPU:', gpuErr);
          await instance.exit().catch(() => { });
          instance = new Wllama(WASM_PATH_CONFIG, {
            suppressNativeLog: true,
            allowOffline: true
          });
          instance.setCompat(null);
          actualGpuUsed = false;
        } finally {
          if (gpuLoadTimeoutId) {
            clearTimeout(gpuLoadTimeoutId);
          }
        }
      }

      // Load using CPU if WebGPU was not requested, not supported, or failed
      if (!actualGpuUsed) {
        console.log('[Offscreen] Loading model with WASM CPU (n_gpu_layers: 0)...');
        await instance.loadModelFromUrl(targetModelUrl, {
          n_gpu_layers: 0,
          n_ctx: targetCtx,
          n_threads: 1,
          n_parallel: 1,
          useCache: true,
          progressCallback
        });
      }

      wllamaInstance = instance;
      loadedModelUrl = targetModelUrl;
      loadedUseWebGpu = wantWebGpu;

      wllamaState.status = 'ready';
      wllamaState.loaded = wllamaState.total || 1;
      wllamaState.total = wllamaState.total || 1;
      wllamaState.percent = 100;
      wllamaState.modelUrl = targetModelUrl;
      wllamaState.backend = actualGpuUsed ? 'WebGPU' : 'WASM (CPU)';
      wllamaState.error = null;
      broadcastProgress(true);

      return wllamaState;
    } catch (err) {
      console.warn('[Offscreen] Failed to load Wllama model:', err);
      if (wllamaInstance) {
        await wllamaInstance.exit().catch(() => { });
        wllamaInstance = null;
      }
      loadedModelUrl = null;
      loadedUseWebGpu = null;

      wllamaState.status = 'error';
      wllamaState.error = err?.message || String(err);
      broadcastProgress(true);
      throw err;
    } finally {
      activeLoadPromise = null;
    }
  })();

  return activeLoadPromise;
}

// Mutex queue to serialize inference requests and prevent context corruption
let inferenceQueue = Promise.resolve();

/**
 * Execute an inference task exclusively via the mutex queue
 * @template T
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
function runInferenceLocked(task) {
  const next = inferenceQueue.then(task, task);
  inferenceQueue = next.catch(() => { });
  return next;
}

// Runtime Message Listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== 'offscreen') {
    return false;
  }

  const defaultModelUrl = (typeof DEFAULT_SETTINGS !== 'undefined' && DEFAULT_SETTINGS.wllamaModelUrl) || FALLBACK_MODEL_URL;

  switch (message.type) {
    case 'OFFSCREEN_WLLAMA_STATUS': {
      (async () => {
        const cachedModels = await getCachedModelsList();
        const webGpuSupported = Boolean(navigator.gpu);
        sendResponse({
          ok: true,
          state: { ...wllamaState },
          isModelLoaded: Boolean(wllamaInstance && wllamaInstance.isModelLoaded()),
          loadedModelUrl,
          webGpuSupported,
          cachedModels
        });
      })().catch(err => {
        sendResponse({
          ok: false,
          error: err?.message || String(err)
        });
      });
      return true;
    }

    case 'OFFSCREEN_WLLAMA_LOAD_MODEL': {
      (async () => {
        const state = await ensureModelLoaded({
          modelUrl: message.modelUrl || defaultModelUrl,
          useWebGpu: message.useWebGpu !== false,
          nCtx: message.nCtx || 2048
        });
        sendResponse({
          ok: true,
          state
        });
      })().catch(err => {
        sendResponse({
          ok: false,
          error: err?.message || String(err),
          state: { ...wllamaState }
        });
      });
      return true;
    }

    case 'OFFSCREEN_WLLAMA_UNLOAD_MODEL': {
      (async () => {
        if (wllamaInstance) {
          await wllamaInstance.exit().catch(() => { });
          wllamaInstance = null;
        }
        loadedModelUrl = null;
        loadedUseWebGpu = null;

        wllamaState.status = 'idle';
        wllamaState.loaded = 0;
        wllamaState.total = 0;
        wllamaState.percent = 0;
        wllamaState.modelUrl = '';
        wllamaState.backend = null;
        wllamaState.error = null;
        broadcastProgress(true);

        sendResponse({
          ok: true,
          state: { ...wllamaState }
        });
      })().catch(err => {
        sendResponse({
          ok: false,
          error: err?.message || String(err)
        });
      });
      return true;
    }

    case 'OFFSCREEN_WLLAMA_CLEAR_CACHE': {
      (async () => {
        if (wllamaInstance) {
          await wllamaInstance.exit().catch(() => { });
          wllamaInstance = null;
        }
        loadedModelUrl = null;
        loadedUseWebGpu = null;

        const mgr = new Wllama(WASM_PATH_CONFIG, {
          suppressNativeLog: true,
          allowOffline: true
        });
        mgr.setCompat(null);

        if (mgr.modelManager && typeof mgr.modelManager.clear === 'function') {
          await mgr.modelManager.clear().catch(() => { });
        }
        if (mgr.cacheManager && typeof mgr.cacheManager.clear === 'function') {
          await mgr.cacheManager.clear().catch(() => { });
        }

        wllamaState.status = 'idle';
        wllamaState.loaded = 0;
        wllamaState.total = 0;
        wllamaState.percent = 0;
        wllamaState.modelUrl = '';
        wllamaState.backend = null;
        wllamaState.error = null;
        broadcastProgress(true);

        sendResponse({
          ok: true,
          state: { ...wllamaState }
        });
      })().catch(err => {
        sendResponse({
          ok: false,
          error: err?.message || String(err)
        });
      });
      return true;
    }

    case 'OFFSCREEN_WLLAMA_TRANSLATE': {
      runInferenceLocked(async () => {
        const targetModelUrl = message.modelUrl || defaultModelUrl;
        await ensureModelLoaded({
          modelUrl: targetModelUrl,
          useWebGpu: message.useWebGpu !== false,
          nCtx: message.nCtx || 2048
        });

        // Cap runaway generations for short text if stop tokens are somehow bypassed
        const requestedMax = Number(message.maxTokens) || 1024;
        const estimatedNeeded = Math.max(128, Math.ceil((message.prompt || '').length * 1.5));
        const effectiveMaxTokens = Math.min(requestedMax, estimatedNeeded);

        const stop = getStopTokens();
        const abortController = new AbortController();
        let accumulatedRaw = '';
        let earlyStopped = false;

        // PLaMo-3 stop markers regex: abort IMMEDIATELY on first occurrence
        const stopMarkerRegex = /(?:<\/s>|<\|plamo:tag|<\|plamo:bos|<\|plamo:eos|<\|endoftext)/;

        try {
          await wllamaInstance.createCompletion({
            prompt: message.prompt,
            max_tokens: effectiveMaxTokens,
            temperature: Number(message.temperature) || 0,
            stop,
            stream: true,
            abortSignal: abortController.signal,
            onData: (chunk) => {
              if (earlyStopped) return;
              const piece = chunk?.choices?.[0]?.text || '';
              accumulatedRaw += piece;

              const cleanCurrent = getCleanText(accumulatedRaw);

              // Broadcast real-time streaming tokens to sidebar / popup / content overlay
              chrome.runtime.sendMessage({
                type: 'WLLAMA_STREAM_CHUNK',
                chunk: piece,
                currentText: cleanCurrent,
                requestId: message.requestId || null,
                targetTabId: message.targetTabId || null
              }).catch(() => { });

              // Hardware-level Early-Stop: If model emits </s> or structural tags, abort instantly!
              if (stopMarkerRegex.test(accumulatedRaw)) {
                earlyStopped = true;
                abortController.abort();
              }
            }
          });
        } catch (err) {
          const isAbort = err?.name === 'WllamaAbortError' ||
            err?.name === 'AbortError' ||
            String(err?.message || err).includes('abort');
          if (!isAbort) {
            throw err;
          }
        }

        const translatedText = getCleanText(accumulatedRaw);

        return {
          ok: true,
          translatedText,
          rawText: accumulatedRaw,
          modelUsed: `${getShortModelName(loadedModelUrl)} [${wllamaState.backend || 'WASM'}]`,
          apiModeUsed: 'wllama'
        };
      })
        .then(result => sendResponse(result))
        .catch(err => {
          console.warn('[Offscreen] Translation inference failed:', err);
          sendResponse({
            ok: false,
            error: err?.message || String(err)
          });
        });
      return true;
    }

    case 'OFFSCREEN_OCR_RECOGNIZE': {
      runOcrRecognition(message.imageDataUrl, message.ocrLang || 'auto', message.ocrEngine || 'ndlocr', {
        singleBlock: Boolean(message.singleBlock)
      })
        .then(result => sendResponse(result))
        .catch(err => {
          console.warn('[Offscreen] OCR recognition failed:', err);
          sendResponse({
            ok: false,
            error: err?.message || String(err)
          });
        });
      return true;
    }

    default:
      sendResponse({
        ok: false,
        error: `Unknown offscreen message type: ${message.type}`
      });
      return false;
  }
});

// ---------------------------------------------------------------------------
// In-Browser OCR Engine (Tesseract.js WASM in Offscreen Document)
// ---------------------------------------------------------------------------
let ocrWorker = null;
let loadedOcrLangs = null;
let ocrInitPromise = null;
let ocrQueue = Promise.resolve();

const OCR_LANG_MAP = {
  // Prioritize jpn first in auto mode so Japanese Kanji/Kana are not misread as Latin letters,
  // while still recognizing English/ASCII accurately via jpn+eng.
  auto: 'jpn+eng',
  en: 'eng',
  ja: 'jpn+eng',
  'ja-ndlocr': 'jpn+eng',
  'ja-tesseract': 'jpn+eng',
  'ja-easy': 'jpn+eng',
  zh: 'chi_sim+eng',
  'zh-CN': 'chi_sim+eng',
  'zh-TW': 'chi_tra+eng',
  ko: 'kor+eng',
  fr: 'fra+eng',
  de: 'deu+eng',
  es: 'spa+eng',
  it: 'ita+eng',
  pt: 'por+eng',
  ru: 'rus+eng',
  vi: 'vie+eng'
};

function resolveTesseractLangs(langCode) {
  if (!langCode) return 'jpn+eng';
  if (OCR_LANG_MAP[langCode]) return OCR_LANG_MAP[langCode];
  if (langCode.includes('+')) return langCode;
  return 'jpn+eng';
}

async function ensureOcrWorker(langCode) {
  const targetLangs = resolveTesseractLangs(langCode);
  if (ocrWorker && loadedOcrLangs === targetLangs) {
    return ocrWorker;
  }

  if (ocrInitPromise) {
    await ocrInitPromise;
    if (ocrWorker && loadedOcrLangs === targetLangs) {
      return ocrWorker;
    }
  }

  ocrInitPromise = (async () => {
    if (ocrWorker) {
      await ocrWorker.terminate().catch(() => { });
      ocrWorker = null;
      loadedOcrLangs = null;
    }

    if (typeof Tesseract === 'undefined' || !Tesseract.createWorker) {
      throw new Error('Tesseract.js library is not loaded in offscreen document');
    }

    const worker = await Tesseract.createWorker(targetLangs, 1, {
      workerPath: chrome.runtime.getURL('vendor/tesseract/worker.min.js'),
      corePath: chrome.runtime.getURL('vendor/tesseract'),
      workerBlobURL: false,
      logger: (m) => {
        if (m && m.status) {
          chrome.runtime.sendMessage({
            type: 'OCR_PROGRESS',
            status: m.status,
            progress: typeof m.progress === 'number' ? Math.round(m.progress * 100) : 0
          }).catch(() => { });
        }
      }
    });

    ocrWorker = worker;
    loadedOcrLangs = targetLangs;
    return worker;
  })();

  try {
    return await ocrInitPromise;
  } finally {
    ocrInitPromise = null;
  }
}

/**
 * Detect and erase solid-filled circular or square bullet/icon blobs on the OCR canvas
 * before passing to Tesseract so colored bullets (🟠, 🔴, etc.) are not misread as text
 * and do not distort adjacent short Kanji baseline normalization.
 */
function removeSolidBulletBlobsFromCanvas(ctx, width, height) {
  if (width < 24 || height < 24 || width * height > 4800000) return;
  try {
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    // 1. Estimate per-row background RGB (75th-percentile luminance sample across each row)
    const rowBgR = new Uint8Array(height);
    const rowBgG = new Uint8Array(height);
    const rowBgB = new Uint8Array(height);
    const stepX = Math.max(1, Math.floor(width / 32));

    for (let y = 0; y < height; y++) {
      const samples = [];
      const rowOffset = y * width * 4;
      for (let x = 0; x < width; x += stepX) {
        const idx = rowOffset + x * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const lum = (r * 77 + g * 150 + b * 29) >> 8;
        samples.push({ lum, r, g, b });
      }
      samples.sort((a, b) => a.lum - b.lum);
      const pick = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.75))];
      rowBgR[y] = pick.r;
      rowBgG[y] = pick.g;
      rowBgB[y] = pick.b;
    }

    // 2. Build foreground mask (pixels differing significantly from row background)
    const totalPixels = width * height;
    const mask = new Uint8Array(totalPixels);
    for (let y = 0; y < height; y++) {
      const bgR = rowBgR[y];
      const bgG = rowBgG[y];
      const bgB = rowBgB[y];
      const rowStart = y * width;
      for (let x = 0; x < width; x++) {
        const pIdx = (rowStart + x) * 4;
        const diff = Math.abs(data[pIdx] - bgR) + Math.abs(data[pIdx + 1] - bgG) + Math.abs(data[pIdx + 2] - bgB);
        if (diff > 65) {
          mask[rowStart + x] = 1;
        }
      }
    }

    // 3. Connected-component flood fill to find solid filled circular/square bullets
    const visited = new Uint8Array(totalPixels);
    const queue = new Int32Array(Math.min(totalPixels, 65536));
    let modified = false;

    for (let y = 0; y < height; y++) {
      const rowStart = y * width;
      for (let x = 0; x < width; x++) {
        const startIdx = rowStart + x;
        if (!mask[startIdx] || visited[startIdx]) continue;

        let qHead = 0;
        let qTail = 0;
        queue[qTail++] = startIdx;
        visited[startIdx] = 1;

        let minX = x;
        let maxX = x;
        let minY = y;
        let maxY = y;
        let count = 0;
        let overflowed = false;

        while (qHead < qTail) {
          const curr = queue[qHead++];
          count++;
          const cy = Math.floor(curr / width);
          const cx = curr - cy * width;

          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;

          // Neighbors (4-connected)
          const neighbors = [
            cx > 0 ? curr - 1 : -1,
            cx + 1 < width ? curr + 1 : -1,
            cy > 0 ? curr - width : -1,
            cy + 1 < height ? curr + width : -1
          ];

          for (let n = 0; n < 4; n++) {
            const nb = neighbors[n];
            if (nb >= 0 && mask[nb] && !visited[nb]) {
              visited[nb] = 1;
              if (qTail < queue.length) {
                queue[qTail++] = nb;
              } else {
                overflowed = true;
              }
            }
          }
        }

        if (overflowed) continue;

        const compW = maxX - minX + 1;
        const compH = maxY - minY + 1;

        // Candidate bullet size & near-square aspect ratio check
        if (compW < 12 || compH < 12 || compW > 110 || compH > 110) continue;
        const aspect = compW / compH;
        if (aspect < 0.72 || aspect > 1.38) continue;

        const bboxArea = compW * compH;
        const fillRatio = count / bboxArea;
        // A filled circle has pi/4 (~0.785) fill; a filled rounded square has ~0.85-0.98 fill
        if (fillRatio < 0.58 || fillRatio > 0.99) continue;

        // Check central 56% core: a solid bullet has >= 90% uniform foreground in its core,
        // whereas real characters have background holes or stroke gaps in their interior.
        const coreX0 = Math.round(minX + compW * 0.22);
        const coreX1 = Math.round(minX + compW * 0.78);
        const coreY0 = Math.round(minY + compH * 0.22);
        const coreY1 = Math.round(minY + compH * 0.78);
        const midX = Math.round((minX + maxX) / 2);
        const midY = Math.round((minY + maxY) / 2);
        const midP = (midY * width + midX) * 4;
        const midR = data[midP];
        const midG = data[midP + 1];
        const midB = data[midP + 2];

        let coreTotal = 0;
        let coreUniformFg = 0;
        for (let cy = coreY0; cy <= coreY1; cy++) {
          for (let cx = coreX0; cx <= coreX1; cx++) {
            coreTotal++;
            const cIdx = cy * width + cx;
            if (mask[cIdx]) {
              const p = cIdx * 4;
              const colorDiff = Math.abs(data[p] - midR) + Math.abs(data[p + 1] - midG) + Math.abs(data[p + 2] - midB);
              if (colorDiff < 80) {
                coreUniformFg++;
              }
            }
          }
        }

        if (coreTotal > 0 && (coreUniformFg / coreTotal) >= 0.90) {
          // Erase solid bullet component to local row background color (including 1px anti-aliased halo)
          const padX0 = Math.max(0, minX - 1);
          const padX1 = Math.min(width - 1, maxX + 1);
          const padY0 = Math.max(0, minY - 1);
          const padY1 = Math.min(height - 1, maxY + 1);
          for (let py = padY0; py <= padY1; py++) {
            const bgR = rowBgR[py];
            const bgG = rowBgG[py];
            const bgB = rowBgB[py];
            for (let px = padX0; px <= padX1; px++) {
              const p = (py * width + px) * 4;
              data[p] = bgR;
              data[p + 1] = bgG;
              data[p + 2] = bgB;
            }
          }
          modified = true;
        }
      }
    }

    if (modified) {
      ctx.putImageData(imgData, 0, 0);
    }
  } catch (err) {
    console.warn('[Offscreen OCR] Bullet filter skipped:', err);
  }
}

function loadImageDimensionsAndCanvas(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const naturalWidth = img.naturalWidth || img.width || 1;
      const naturalHeight = img.naturalHeight || img.height || 1;
      // Upscale images under 900px width so 12-15px UI/Kanji glyphs reach optimal ~28-32px height for LSTM OCR
      const scale = (naturalWidth < 550 || naturalHeight < 220)
        ? 2
        : (naturalWidth < 950 ? 1.5 : 1);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(naturalWidth * scale);
      canvas.height = Math.round(naturalHeight * scale);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      // NOTE: Do not erase bullet blobs so list markers (•, ·, ●) are preserved for block structure detection.
      let imageData = null;
      try {
        imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      } catch {
        imageData = null;
      }
      resolve({
        naturalWidth,
        naturalHeight,
        scale,
        imageData,
        processedDataUrl: canvas.toDataURL('image/png')
      });
    };
    img.onerror = () => reject(new Error('Failed to decode image for OCR'));
    img.src = dataUrl;
  });
}

// Regex matching decorative symbols, bullets, circles, and OCR icon artifacts
const ICON_NOISE_CHAR_REGEX = /^[\s@©®™•·∙・●○◎◇◆■□▲△▼▽▪▫◦‣⁃❖➢➤✔✓☑※†‡§¶\u2500-\u25FF①-⑳㉑-㊿❶-❾|_~^=<>\[\]{}()【】〖〗〔〕「」『』:;.,'"!?/\\+-]+$/;
const CJK_CHAR_REGEX = /[\u3040-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/;
const LIST_MARKER_REGEX = /^[\s]*([•·∙・●○◎◇◆■□▲△▼▽▪▫◦‣⁃❖➢➤✔✓☑※†‡§¶*–—\-]|[①-⑳㉑-㊿❶-❾]|\d{1,3}[\.\)]|\([0-9a-zA-Z]{1,3}\)|[a-zA-Z][\.\)])\s*/;
const BULLET_CHAR_REGEX = /^[•·∙・●○◎◇◆■□▲△▼▽▪▫◦‣⁃❖➢➤✔✓☑※†‡§¶*–—\-①-⑳㉑-㊿❶-❾]$/;
const LEADING_ICON_ARTIFACT_REGEX = /^(?:[①-⑳❶-❾ⓐ-ⓩⒶ-Ⓩ]\s*|[b-hj-zB-HJ-Z0-9]\s+(?=[A-Za-z\u3040-\u9FFF])|[oO0Qq]\s*(?=[\u3040-\u9FFF])|(?:[8B][=~-]|[:;=~^|_/\\><«»❯❮]{1,3}[=~-]?|[+])\s+(?=[A-Za-z\u3040-\u9FFF]))(?![.\):&])/;

function stripLeadingIconArtifacts(text) {
  if (!text) return '';
  return text
    .replace(/^[\s●○◎◆◇■□▲△▼▽・•·▪▫◦‣⁃∙❖➢➤✔✓☑]+/, '')
    .replace(LEADING_ICON_ARTIFACT_REGEX, '')
    .trim();
}

const VALID_ONE_LETTER_WORDS = new Set(['a', 'A', 'I']);
const VALID_TWO_LETTER_WORDS = new Set([
  'am', 'an', 'as', 'at', 'be', 'by', 'do', 'go', 'he', 'hi',
  'if', 'in', 'is', 'it', 'me', 'my', 'no', 'of', 'on', 'or',
  'ox', 'so', 'to', 'up', 'us', 'we', 'ok', 'id', 'ai', 'ui', 'tv'
]);

function isLikelyIconArtifactToken(text, confidence, hasMainCjk) {
  const trimmed = (text || '').trim();
  if (!trimmed) return true;
  // Always preserve bullet and list marker symbols
  if (BULLET_CHAR_REGEX.test(trimmed) || LIST_MARKER_REGEX.test(trimmed)) return false;
  if (ICON_NOISE_CHAR_REGEX.test(trimmed)) return true;
  // Single or 2-char token with low/medium confidence right before a word (e.g. "oG", "pV", "=n", "0", "⑥⑰")
  if (trimmed.length <= 2 && confidence < 78) {
    const isCommon = VALID_ONE_LETTER_WORDS.has(trimmed) || VALID_TWO_LETTER_WORDS.has(trimmed.toLowerCase());
    if (!isCommon && !CJK_CHAR_REGEX.test(trimmed)) {
      return true;
    }
  }
  // Isolated single letter/symbol mistaken from an icon/badge (e.g. "o", "O", "Q", "v", "V", "x", "X")
  if (/^[oO0QqvVxXpP|lI~=_+\-^><]{1,2}$/.test(trimmed) && confidence < 82) {
    return true;
  }
  return false;
}

function isLikelyIconArtifactSegment(text, bbox, confidence, hasCjk) {
  const trimmed = (text || '').trim();
  if (!trimmed) return true;

  // List items (e.g. "•", "1.", "-") are handled by prose merging, preserve them
  if (LIST_MARKER_REGEX.test(trimmed) || BULLET_CHAR_REGEX.test(trimmed)) {
    return false;
  }

  const w = bbox.x1 - bbox.x0;
  const h = bbox.y1 - bbox.y0;
  const aspect = w / Math.max(1, h);
  const isNearSquare = aspect >= 0.65 && aspect <= 1.45;

  // Single Latin character: only 'a', 'A', 'I' are valid words
  if (!hasCjk && trimmed.length === 1 && /[a-zA-Z]/.test(trimmed)) {
    if (!VALID_ONE_LETTER_WORDS.has(trimmed)) {
      return true; // Discard isolated letters like 'o', 'x', 'v', 'Q', 'd', 'l', etc.
    }
  }

  // Pure symbols/punctuation without letters/numbers
  if (!/[\p{L}\p{N}]/u.test(trimmed)) {
    return true;
  }

  // Near-square short ASCII tokens (typically 1-2 chars misread from icons, e.g. "oG", "pV")
  if (!hasCjk && trimmed.length <= 2 && isNearSquare && confidence < 85) {
    if (!VALID_TWO_LETTER_WORDS.has(trimmed.toLowerCase()) && !VALID_ONE_LETTER_WORDS.has(trimmed)) {
      return true;
    }
  }

  // Tiny isolated graphic box with low/medium confidence
  if (w <= 24 && h <= 24 && confidence < 78 && !CJK_CHAR_REGEX.test(trimmed)) {
    if (!VALID_TWO_LETTER_WORDS.has(trimmed.toLowerCase()) && !VALID_ONE_LETTER_WORDS.has(trimmed)) {
      return true;
    }
  }

  // CJK 1-char icon hallucination: square box with low confidence symbol
  if (hasCjk && trimmed.length === 1 && isNearSquare && confidence < 65) {
    if (/^[口〇一・○十大小八人レ×□■△▲▽▼◇◆]$/.test(trimmed)) {
      return true;
    }
  }

  return false;
}

/**
 * Split a Tesseract Line into horizontal segments (columns / UI labels) using word & symbol gaps,
 * strip leading/trailing bullet/icon artifacts, and compute tight bounding boxes per segment.
 */
function extractSegmentsFromLine(line, scale, naturalWidth, naturalHeight) {
  const lineBox = line.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 };
  const lineHeight = Math.max(8, (lineBox.y1 - lineBox.y0));

  // Flatten symbols while keeping track of parent word boundaries
  const allSymbols = [];
  const words = Array.isArray(line.words) ? line.words : [];

  if (words.length > 0) {
    words.forEach((w, wIdx) => {
      if (Array.isArray(w.symbols) && w.symbols.length > 0) {
        w.symbols.forEach((s) => {
          if (s && s.text && s.bbox) {
            allSymbols.push({
              text: s.text,
              confidence: typeof s.confidence === 'number' ? s.confidence : (w.confidence || 0),
              bbox: s.bbox,
              wordIdx: wIdx
            });
          }
        });
      } else if (w && w.text && w.bbox) {
        allSymbols.push({
          text: w.text.trim(),
          confidence: typeof w.confidence === 'number' ? w.confidence : (line.confidence || 0),
          bbox: w.bbox,
          wordIdx: wIdx
        });
      }
    });
  }

  // Fallback if no words/symbols array is populated
  if (allSymbols.length === 0) {
    const rawText = (line.text || '').trim();
    if (!rawText) return [];
    return [{
      text: rawText,
      confidence: typeof line.confidence === 'number' ? line.confidence : 50,
      bbox: {
        x0: Math.max(0, Math.round(lineBox.x0 / scale)),
        y0: Math.max(0, Math.round(lineBox.y0 / scale)),
        x1: Math.min(naturalWidth, Math.round(lineBox.x1 / scale)),
        y1: Math.min(naturalHeight, Math.round(lineBox.y1 / scale))
      },
      isMultiLine: false
    }];
  }

  // Sort symbols left-to-right
  allSymbols.sort((a, b) => a.bbox.x0 - b.bbox.x0);

  // 1. Split line into horizontal column segments wherever horizontal gap exceeds column threshold
  const colGapThreshold = Math.max(lineHeight * 1.15, 22 * scale);
  const rawSegments = [];
  let currentSeg = [allSymbols[0]];

  for (let i = 1; i < allSymbols.length; i++) {
    const prev = allSymbols[i - 1];
    const curr = allSymbols[i];
    const gap = curr.bbox.x0 - prev.bbox.x1;

    if (gap > colGapThreshold) {
      rawSegments.push(currentSeg);
      currentSeg = [curr];
    } else {
      currentSeg.push(curr);
    }
  }
  if (currentSeg.length > 0) {
    rawSegments.push(currentSeg);
  }

  const results = [];
  let pendingBulletX1 = null;

  for (const segSymbols of rawSegments) {
    // Check if segment contains CJK characters
    const fullSegStr = segSymbols.map(s => s.text).join('');
    const hasCjk = CJK_CHAR_REGEX.test(fullSegStr);
    const segFirstX0 = segSymbols[0].bbox.x0;
    const segLastX1 = segSymbols[segSymbols.length - 1].bbox.x1;
    const segSpanW = segLastX1 - segFirstX0;

    // Preserve marker if an immediately preceding bullet/dot segment on the same line was split off
    let hasPendingBullet = pendingBulletX1 !== null && (segFirstX0 - pendingBulletX1) <= lineHeight * 3.8;
    pendingBulletX1 = null;

    // 2. Check if there is a leading bullet/icon sub-chunk separated by a small icon gap (e.g. "● 有料メンバー")
    let startIdx = 0;
    let hadStrippedLeadingMarker = false;
    const iconGapThreshold = lineHeight * 0.28;
    for (let i = 0; i < Math.min(3, segSymbols.length - 1); i++) {
      const gapAfter = segSymbols[i + 1].bbox.x0 - segSymbols[i].bbox.x1;
      const prefixText = segSymbols.slice(0, i + 1).map(s => s.text).join('');
      const prefixConf = segSymbols.slice(0, i + 1).reduce((acc, s) => acc + s.confidence, 0) / (i + 1);
      if (gapAfter >= iconGapThreshold && isLikelyIconArtifactToken(prefixText, prefixConf, hasCjk)) {
        startIdx = i + 1;
        if (BULLET_CHAR_REGEX.test(prefixText.trim()) || LIST_MARKER_REGEX.test(prefixText.trim()) || /^[oO0Qq•·∙・●○◎◇◆■□▲△▼▽▪▫◦‣⁃]+$/.test(prefixText.trim())) {
          hadStrippedLeadingMarker = true;
        }
      }
    }

    let trimmed = segSymbols.slice(startIdx);

    // 3. Strip leading and trailing pure noise/bullet symbols so bbox tightly wraps real text
    while (trimmed.length > 0 && isLikelyIconArtifactToken(trimmed[0].text, trimmed[0].confidence, hasCjk)) {
      const dropped = trimmed.shift();
      if (BULLET_CHAR_REGEX.test((dropped.text || '').trim()) || /^[oO0Qq•·∙・●○◎◇◆■□▲△▼▽▪▫◦‣⁃]+$/.test((dropped.text || '').trim())) {
        hadStrippedLeadingMarker = true;
      }
    }
    while (trimmed.length > 0 && ICON_NOISE_CHAR_REGEX.test(trimmed[trimmed.length - 1].text)) {
      trimmed.pop();
    }

    if (trimmed.length === 0) {
      const trimmedSegStr = fullSegStr.trim();
      if (segSpanW <= lineHeight * 1.6 && (BULLET_CHAR_REGEX.test(trimmedSegStr) || LIST_MARKER_REGEX.test(trimmedSegStr) || /^[•·∙・●○◎◇◆■□▲△▼▽▪▫◦‣⁃oO0Qq①-⑳㉑-㊿❶-❾]+$/.test(trimmedSegStr))) {
        pendingBulletX1 = segLastX1;
      }
      continue;
    }

    // 4. Reconstruct clean text with proper spacing (no spaces between CJK, single space between Latin words)
    let text = '';
    let confSum = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (let i = 0; i < trimmed.length; i++) {
      const sym = trimmed[i];
      const ch = sym.text.trim();
      if (!ch) continue;

      if (text.length > 0) {
        const prevSym = trimmed[i - 1];
        const prevCh = text.slice(-1);
        const symGap = sym.bbox.x0 - prevSym.bbox.x1;
        const differentWord = sym.wordIdx !== prevSym.wordIdx;
        const bothLatinOrNum = /[a-zA-Z0-9]/.test(prevCh) && /[a-zA-Z0-9]/.test(ch.charAt(0));
        if ((differentWord || symGap >= lineHeight * 0.22) && bothLatinOrNum) {
          text += ' ';
        }
      }

      text += ch;
      confSum += sym.confidence;
      if (sym.bbox.x0 < minX) minX = sym.bbox.x0;
      if (sym.bbox.y0 < minY) minY = sym.bbox.y0;
      if (sym.bbox.x1 > maxX) maxX = sym.bbox.x1;
      if (sym.bbox.y1 > maxY) maxY = sym.bbox.y1;
    }

    const isListItem = Boolean(
      hasPendingBullet ||
      hadStrippedLeadingMarker ||
      LIST_MARKER_REGEX.test(text) ||
      BULLET_CHAR_REGEX.test(text.trim()) ||
      LEADING_ICON_ARTIFACT_REGEX.test(text)
    );

    text = stripLeadingIconArtifacts(text);
    if (!text) {
      const trimmedSegStr = fullSegStr.trim();
      if (segSpanW <= lineHeight * 1.6 && (BULLET_CHAR_REGEX.test(trimmedSegStr) || LIST_MARKER_REGEX.test(trimmedSegStr) || /^[•·∙・●○◎◇◆■□▲△▼▽▪▫◦‣⁃oO0Qq①-⑳㉑-㊿❶-❾]+$/.test(trimmedSegStr))) {
        pendingBulletX1 = segLastX1;
      }
      continue;
    }
    if (text.length < 2 && !CJK_CHAR_REGEX.test(text)) {
      if (BULLET_CHAR_REGEX.test(text) || /^[oO0Qq•·∙・▪▫◦‣⁃]$/.test(text)) {
        pendingBulletX1 = segLastX1;
      }
      continue;
    }
    if (!/[\p{L}\p{N}]/u.test(text)) {
      if (BULLET_CHAR_REGEX.test(text) || /^[•·∙・●○◎◇◆■□▲△▼▽▪▫◦‣⁃]+$/.test(text)) {
        pendingBulletX1 = segLastX1;
      }
      continue;
    }

    const avgConf = confSum / trimmed.length;
    if (avgConf < 32) continue;
    // Filter out short low-confidence ASCII gibberish
    if (!CJK_CHAR_REGEX.test(text) && text.length <= 3 && avgConf < 55) continue;

    const bbox = {
      x0: Math.max(0, Math.round(minX / scale)),
      y0: Math.max(0, Math.round(minY / scale)),
      x1: Math.min(naturalWidth, Math.round(maxX / scale)),
      y1: Math.min(naturalHeight, Math.round(maxY / scale))
    };

    if (bbox.x1 <= bbox.x0 || bbox.y1 <= bbox.y0) continue;

    // Filter out isolated icons, buttons, and decorative badges misread as text
    if (isLikelyIconArtifactSegment(text, bbox, avgConf, hasCjk)) {
      continue;
    }

    results.push({
      text,
      confidence: Math.round(avgConf),
      bbox,
      isMultiLine: false,
      isListItem
    });
  }

  return results;
}

const SENTENCE_END_REGEX = /[.!?。！？]\s*$/;
const COLON_END_REGEX = /[:：]\s*$/;

/**
 * Merge vertically consecutive text lines into cohesive paragraphs and list items.
 * Uses font size (line height), line spacing, indentation, bullet/list markers,
 * and punctuation continuity to preserve natural discourse units for translation.
 */
function mergeProseLinesIfAppropriate(segments, naturalWidth) {
  if (segments.length <= 1) return segments;

  // 1. Detect multi-column items: segments that share horizontal alignment (same vertical band)
  const hasHorizontalSibling = new Array(segments.length).fill(false);
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i].bbox;
      const b = segments[j].bbox;
      const overlapY = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      const minH = Math.min(a.y1 - a.y0, b.y1 - b.y0);
      if (minH > 0 && overlapY > minH * 0.4) {
        hasHorizontalSibling[i] = true;
        hasHorizontalSibling[j] = true;
      }
    }
  }

  const merged = [];
  let i = 0;

  while (i < segments.length) {
    const curr = { ...segments[i], bbox: { ...segments[i].bbox } };
    let currLineH = curr.bbox.y1 - curr.bbox.y0;
    let currW = curr.bbox.x1 - curr.bbox.x0;
    const isCurrListItem = Boolean(curr.isListItem) || LIST_MARKER_REGEX.test(curr.text);
    let prevLineLeft = curr.bbox.x0;
    let currMaxLineW = currW;
    let lastLineW = currW;
    let lastLineText = (curr.text || '').trim();

    // Only merge non-column text segments
    if (!hasHorizontalSibling[i]) {
      while (i + 1 < segments.length && !hasHorizontalSibling[i + 1]) {
        const next = segments[i + 1];
        const nextH = next.bbox.y1 - next.bbox.y0;
        const nextW = next.bbox.x1 - next.bbox.x0;
        const isNextListItem = Boolean(next.isListItem) || LIST_MARKER_REGEX.test(next.text);

        // RULE 1: If the next line starts a new list item (bullet/number), NEVER merge it!
        if (isNextListItem) {
          break;
        }

        // RULE 2: Font size compatibility (Heading vs Body)
        // Lines within the same paragraph/item must have comparable font height (within ~38% ratio)
        const maxH = Math.max(currLineH, nextH);
        const minH = Math.min(currLineH, nextH);
        if (minH / maxH < 0.58) {
          // Significant font size difference -> Heading or label, do not merge
          break;
        }

        // RULE 3: Vertical line spacing (vGap)
        // Typical body text line-height is 1.3 - 1.8x font height.
        // vGap between bounding boxes should be between -0.35*H (slight overlap) and 1.35*H.
        const vGap = next.bbox.y0 - curr.bbox.y1;
        if (vGap < -maxH * 0.35 || vGap > maxH * 1.35) {
          // Lines are too far apart -> distinct paragraphs or sections
          break;
        }

        // RULE 4: Horizontal alignment and indentation
        // Standard paragraph: same left alignment
        const leftDiff = Math.abs(next.bbox.x0 - curr.bbox.x0);
        // Hanging indent: first line has bullet/number, continuation lines are indented to the right
        const isHangingIndent = isCurrListItem && (next.bbox.x0 >= curr.bbox.x0 - 4) && (next.bbox.x0 <= curr.bbox.x0 + maxH * 3.5);
        // Indentation drop / reset: if previous continuation line was indented, and next line jumps significantly to the left
        const isIndentReset = (prevLineLeft > curr.bbox.x0 + maxH * 0.8) && (next.bbox.x0 < prevLineLeft - maxH * 0.8);
        if (isIndentReset) {
          break;
        }

        // Horizontal overlap check: lines must vertically stack within the same column area
        const overlapX = Math.min(curr.bbox.x1, next.bbox.x1) - Math.max(curr.bbox.x0, next.bbox.x0);
        const isAligned = (leftDiff <= maxH * 1.8) || isHangingIndent;
        if (!isAligned || overlapX <= 0) {
          break;
        }

        // RULE 5: Punctuation and Continuation Signals
        const trimmedCurr = curr.text.trim();
        const trimmedNext = next.text.trim();
        const isHyphenated = trimmedCurr.endsWith('-');
        const endsWithPeriod = SENTENCE_END_REGEX.test(trimmedCurr);
        const endsWithColon = COLON_END_REGEX.test(trimmedCurr);
        const startsWithLowerCase = /^[a-z]/.test(trimmedNext);

        // If current line ends with a colon (':') and next line has a noticeable gap, keep separate
        if (endsWithColon && vGap > maxH * 0.75) {
          break;
        }

        // If current line ends with a sentence terminator and next line has a large paragraph-spacing gap
        if (endsWithPeriod && vGap > maxH * 0.95 && !startsWithLowerCase) {
          break;
        }

        // RULE 5b: Short trailing line followed by a full-width line signals a finished list item or paragraph
        if (
          currMaxLineW > maxH * 6 &&
          lastLineW <= currMaxLineW * 0.62 &&
          nextW >= currMaxLineW * 0.72 &&
          !/[,、，\-‐—（(「『]\s*$/.test(lastLineText) &&
          !startsWithLowerCase
        ) {
          break;
        }

        // --- MERGE ACCEPTED ---
        const prevLast = curr.text.slice(-1);
        const nextFirst = next.text.charAt(0);

        if (isHyphenated && /[a-zA-Z]/.test(nextFirst)) {
          // Join hyphenated English word: "opti-" + "mal" -> "optimal"
          curr.text = curr.text.replace(/-+$/, '') + next.text;
        } else if (CJK_CHAR_REGEX.test(prevLast) || CJK_CHAR_REGEX.test(nextFirst)) {
          // CJK text without space
          curr.text += next.text;
        } else {
          // Latin text with single space
          curr.text += ' ' + next.text;
        }

        curr.bbox.x0 = Math.min(curr.bbox.x0, next.bbox.x0);
        curr.bbox.y0 = Math.min(curr.bbox.y0, next.bbox.y0);
        curr.bbox.x1 = Math.max(curr.bbox.x1, next.bbox.x1);
        curr.bbox.y1 = Math.max(curr.bbox.y1, next.bbox.y1);
        curr.confidence = Math.round((curr.confidence + next.confidence) / 2);
        curr.isMultiLine = true;

        prevLineLeft = next.bbox.x0;
        currLineH = nextH;
        currW = curr.bbox.x1 - curr.bbox.x0;
        currMaxLineW = Math.max(currMaxLineW, nextW);
        lastLineW = nextW;
        lastLineText = trimmedNext;
        i++;
      }
    }

    merged.push(curr);
    i++;
  }

  return merged;
}

/**
 * Merge consecutive Japanese vertical text columns (tategaki / newspaper layout)
 * into cohesive paragraph blocks.
 *
 * Honors:
 *  - Right-to-Left column progression
 *  - Column width (font size) compatibility (keeps large headlines separate from body text)
 *  - Horizontal column pitch (hGap between columns)
 *  - Multi-tier layout (ensures upper tier and lower tier columns remain distinct)
 *  - Sentence endings and indentation
 */
function mergeVerticalProseLinesIfAppropriate(segments, naturalHeight) {
  if (segments.length <= 1) return segments;

  const merged = [];
  let i = 0;

  while (i < segments.length) {
    const curr = { ...segments[i], bbox: { ...segments[i].bbox } };
    let currW = curr.bbox.x1 - curr.bbox.x0;
    let currH = curr.bbox.y1 - curr.bbox.y0;
    let prevColLeft = curr.bbox.x0;
    let currLineW = currW;

    while (i + 1 < segments.length) {
      const next = segments[i + 1];
      const nextW = next.bbox.x1 - next.bbox.x0;
      const nextH = next.bbox.y1 - next.bbox.y0;

      // RULE 0: If the next vertical column starts a new bullet/list item, keep it separate
      if (Boolean(next.isListItem) || LIST_MARKER_REGEX.test(next.text)) {
        break;
      }

      // RULE 1: Right-to-Left progression (next column must be positioned to the left of previous column)
      // If next column jumps back to the right, it belongs to a new section, tier, or separate article
      if (next.bbox.x0 >= prevColLeft - 2) {
        break;
      }

      // RULE 2: Horizontal column pitch (hGap between adjacent columns)
      // In Japanese newspapers/books, adjacent body columns have small gaps (typically 2-15px).
      const hGap = prevColLeft - next.bbox.x1;
      const maxW = Math.max(currLineW, nextW);
      const minW = Math.min(currLineW, nextW);
      if (hGap < -maxW * 0.4 || hGap > maxW * 2.2) {
        // Columns are too far apart (separated by a headline, picture, or column rule)
        break;
      }

      // RULE 3: Font Size / Column Width Compatibility (Headlines vs Body)
      // Large headlines (大見出し・中見出し) have significantly thicker columns (2x-4x) than body text.
      if (minW / maxW < 0.55) {
        // One is a headline and the other is body text, do not merge!
        break;
      }

      // RULE 4: Tier Alignment (Same newspaper tier)
      // Columns within the same tier share vertical span (overlapY).
      const vOverlap = Math.min(curr.bbox.y1, next.bbox.y1) - Math.max(curr.bbox.y0, next.bbox.y0);
      const minH = Math.min(currH, nextH);
      const maxH = Math.max(currH, nextH);
      const topDiff = Math.abs(next.bbox.y0 - curr.bbox.y0);

      if (vOverlap <= 0 || vOverlap < minH * 0.60) {
        // Different tiers (e.g. 上段 vs 下段)
        break;
      }
      // If height difference is drastic (e.g. short headline vs full-height body column)
      if (minH / maxH < 0.50 && topDiff > maxW * 2.0) {
        break;
      }

      // RULE 5: Text Concatenation & Paragraph Break Detection
      const trimmedCurr = curr.text.trim();
      const isParagraphBreak = /[。！？!?」』]\s*$/.test(trimmedCurr) && next.bbox.y0 > curr.bbox.y0 + maxW * 0.6;
      if (isParagraphBreak) {
        curr.text += '\n' + next.text;
      } else {
        curr.text += next.text;
      }

      // Expand bounding box leftward to encompass the new column
      curr.bbox.x0 = Math.min(curr.bbox.x0, next.bbox.x0);
      curr.bbox.y0 = Math.min(curr.bbox.y0, next.bbox.y0);
      curr.bbox.x1 = Math.max(curr.bbox.x1, next.bbox.x1);
      curr.bbox.y1 = Math.max(curr.bbox.y1, next.bbox.y1);
      curr.confidence = Math.round((curr.confidence + next.confidence) / 2);
      curr.isMultiLine = true;

      prevColLeft = next.bbox.x0;
      currLineW = nextW;
      currH = curr.bbox.y1 - curr.bbox.y0;
      currW = curr.bbox.x1 - curr.bbox.x0;
      i++;
    }

    merged.push(curr);
    i++;
  }

  return merged;
}

async function runNdlOcr(imageDataUrl) {
  if (typeof self.NdlOcrEngine === 'undefined') {
    throw new Error('NDLOCR engine is not loaded');
  }
  const { width, height, blocks: lineBlocks } = await self.NdlOcrEngine.recognize(imageDataUrl, {
    onProgress: (status, progress) => {
      chrome.runtime.sendMessage({ type: 'OCR_PROGRESS', status, progress, engine: 'ndlocr' }).catch(() => { });
    }
  });

  // Re-join wrapped prose lines for BOTH horizontal and vertical layouts (newspapers, novels, etc.)
  const blocks = [];
  let horizBuffer = [];
  let vertBuffer = [];

  function flushHorizBuffer() {
    if (horizBuffer.length > 0) {
      blocks.push(...mergeProseLinesIfAppropriate(horizBuffer, width));
      horizBuffer = [];
    }
  }
  function flushVertBuffer() {
    if (vertBuffer.length > 0) {
      blocks.push(...mergeVerticalProseLinesIfAppropriate(vertBuffer, height));
      vertBuffer = [];
    }
  }

  for (const blk of lineBlocks) {
    const rawText = blk.text || '';
    const hasListMarker = Boolean(blk.isListItem) || LIST_MARKER_REGEX.test(rawText) || BULLET_CHAR_REGEX.test(rawText.trim());
    const cleanedText = stripLeadingIconArtifacts(rawText);
    if (!cleanedText) continue;
    const cleanBlk = { ...blk, text: cleanedText, isListItem: hasListMarker };
    if (cleanBlk.isVertical) {
      flushHorizBuffer();
      vertBuffer.push(cleanBlk);
    } else {
      flushVertBuffer();
      horizBuffer.push(cleanBlk);
    }
  }
  flushHorizBuffer();
  flushVertBuffer();

  return {
    ok: true,
    engine: 'ndlocr',
    width,
    height,
    text: blocks.map(b => b.text).join('\n'),
    blocks
  };
}

async function runTesseractOcr(imageDataUrl, ocrLang) {
  const { naturalWidth, naturalHeight, scale, imageData, processedDataUrl } = await loadImageDimensionsAndCanvas(imageDataUrl);
  const worker = await ensureOcrWorker(ocrLang);
  const { data } = await worker.recognize(processedDataUrl);

  const rawLines = (data && Array.isArray(data.lines) && data.lines.length > 0)
    ? data.lines
    : (data && Array.isArray(data.paragraphs) ? data.paragraphs : []);

  const detectVisualBullet = (self.NdlOcrEngine && typeof self.NdlOcrEngine.detectVisualBulletLeftOfLine === 'function')
    ? self.NdlOcrEngine.detectVisualBulletLeftOfLine
    : null;

  const lineSegments = [];
  for (const line of rawLines) {
    const segs = extractSegmentsFromLine(line, scale, naturalWidth, naturalHeight);
    for (const seg of segs) {
      const isVert = (seg.bbox.y1 - seg.bbox.y0) > (seg.bbox.x1 - seg.bbox.x0) * 1.25;
      if (!seg.isListItem && !isVert && imageData && detectVisualBullet) {
        const scaledBbox = {
          x0: seg.bbox.x0 * scale,
          y0: seg.bbox.y0 * scale,
          x1: seg.bbox.x1 * scale,
          y1: seg.bbox.y1 * scale
        };
        if (detectVisualBullet(imageData, scaledBbox)) {
          seg.isListItem = true;
        }
      }
      lineSegments.push(seg);
    }
  }

  const blocks = [];
  let horizBuffer = [];
  let vertBuffer = [];

  function flushHorizBuffer() {
    if (horizBuffer.length > 0) {
      blocks.push(...mergeProseLinesIfAppropriate(horizBuffer, naturalWidth));
      horizBuffer = [];
    }
  }
  function flushVertBuffer() {
    if (vertBuffer.length > 0) {
      blocks.push(...mergeVerticalProseLinesIfAppropriate(vertBuffer, naturalHeight));
      vertBuffer = [];
    }
  }

  for (const seg of lineSegments) {
    const isVert = (seg.bbox.y1 - seg.bbox.y0) > (seg.bbox.x1 - seg.bbox.x0) * 1.25;
    if (isVert) {
      flushHorizBuffer();
      vertBuffer.push({ ...seg, isVertical: true });
    } else {
      flushVertBuffer();
      horizBuffer.push(seg);
    }
  }
  flushHorizBuffer();
  flushVertBuffer();
  return {
    ok: true,
    engine: 'tesseract',
    width: naturalWidth,
    height: naturalHeight,
    text: blocks.map(b => b.text).join('\n'),
    blocks
  };
}

function isLikelyEnglishText(text) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  // Any Hiragana or Katakana indicates Japanese text
  if (/[\u3040-\u309F\u30A0-\u30FF\uFF66-\uFF9F]/.test(trimmed)) {
    return false;
  }
  // Korean Hangul or explicit CJK-heavy non-Latin text is not English
  if (/[\uAC00-\uD7AF]/.test(trimmed)) {
    return false;
  }
  const latinCount = (trimmed.match(/[A-Za-z]/g) || []).length;
  const kanjiCount = (trimmed.match(/[\u4E00-\u9FAF]/g) || []).length;
  if (latinCount < 3) return false;
  if (kanjiCount === 0) return true;
  // Allow rare 1-3 stray kanji icon hallucinations inside predominantly English paragraphs
  return kanjiCount <= 3 && latinCount >= 8 && latinCount >= kanjiCount * 6;
}

function combineOcrResultAsSingleBlock(ocrRes) {
  if (!ocrRes || !Array.isArray(ocrRes.blocks)) return ocrRes;
  const validBlocks = ocrRes.blocks.filter(b => b && typeof b.text === 'string' && b.text.trim());
  if (validBlocks.length === 0) {
    return { ...ocrRes, text: '', blocks: [] };
  }
  if (validBlocks.length === 1) {
    const only = validBlocks[0];
    const cleanText = only.text.trim();
    return {
      ...ocrRes,
      text: cleanText,
      blocks: [{ ...only, text: cleanText }]
    };
  }

  let combinedText = validBlocks[0].text.trim();
  const mergedBbox = validBlocks[0].bbox
    ? { ...validBlocks[0].bbox }
    : { x0: 0, y0: 0, x1: ocrRes.width || 100, y1: ocrRes.height || 40 };
  let confSum = validBlocks[0].confidence || 80;
  let vertCount = validBlocks[0].isVertical ? 1 : 0;

  for (let i = 1; i < validBlocks.length; i++) {
    const prev = validBlocks[i - 1];
    const curr = validBlocks[i];
    const currText = curr.text.trim();
    if (curr.bbox) {
      mergedBbox.x0 = Math.min(mergedBbox.x0, curr.bbox.x0);
      mergedBbox.y0 = Math.min(mergedBbox.y0, curr.bbox.y0);
      mergedBbox.x1 = Math.max(mergedBbox.x1, curr.bbox.x1);
      mergedBbox.y1 = Math.max(mergedBbox.y1, curr.bbox.y1);
    }
    confSum += curr.confidence || 80;
    if (curr.isVertical) vertCount++;

    if (/[A-Za-z]-$/.test(combinedText) && /^[a-z]/.test(currText)) {
      combinedText = combinedText.slice(0, -1) + currText;
    } else if (!prev.isVertical && !curr.isVertical && prev.bbox && curr.bbox) {
      const prevY = (prev.bbox.y0 + prev.bbox.y1) * 0.5;
      const currY = (curr.bbox.y0 + curr.bbox.y1) * 0.5;
      const rowH = Math.max(prev.bbox.y1 - prev.bbox.y0, curr.bbox.y1 - curr.bbox.y0, 8);
      if (Math.abs(currY - prevY) <= rowH * 0.45 && curr.bbox.x0 >= prev.bbox.x1 - 4) {
        const cjkJoin = /[\u3040-\u30FF\u4E00-\u9FFF]$/.test(combinedText) && /^[\u3040-\u30FF\u4E00-\u9FFF]/.test(currText);
        combinedText += (cjkJoin ? '' : ' ') + currText;
      } else {
        combinedText += '\n' + currText;
      }
    } else {
      combinedText += '\n' + currText;
    }
  }

  const singleBlock = {
    text: combinedText,
    bbox: mergedBbox,
    confidence: Math.round(confSum / validBlocks.length),
    isVertical: vertCount > validBlocks.length / 2,
    isMultiLine: combinedText.includes('\n') || validBlocks.some(b => b.isMultiLine)
  };
  return {
    ...ocrRes,
    text: combinedText,
    blocks: [singleBlock]
  };
}

/**
 * @param {string} imageDataUrl
 * @param {string} ocrLang
 * @param {'ndlocr'|'tesseract'} [engine='ndlocr'] NDLOCR-Lite (default) falls back to Tesseract on failure
 * @param {{ singleBlock?: boolean }} [options]
 */
function runOcrRecognition(imageDataUrl, ocrLang, engine = 'ndlocr', options = {}) {
  const singleBlock = Boolean(options && options.singleBlock);
  const finalizeResult = (res) => (singleBlock ? combineOcrResultAsSingleBlock(res) : res);

  const next = ocrQueue.then(async () => {
    if (!imageDataUrl) {
      throw new Error('Image data is empty');
    }
    const normalizedLang = (ocrLang || 'auto').toLowerCase();

    // Explicit Japanese Tesseract mode
    if (normalizedLang === 'ja-tesseract') {
      const tessJaRes = await runTesseractOcr(imageDataUrl, 'ja-tesseract');
      return finalizeResult({ ...tessJaRes, detectedOcrLang: 'ja-tesseract' });
    }

    // Explicit Japanese NDLOCR-Lite mode (respect toolbar selection regardless of popup default)
    if (normalizedLang === 'ja' || normalizedLang === 'jpn' || normalizedLang === 'ja-ndlocr') {
      try {
        const ndlRes = await runNdlOcr(imageDataUrl);
        return finalizeResult({ ...ndlRes, detectedOcrLang: 'ja' });
      } catch (err) {
        console.warn('[Offscreen OCR] NDLOCR-Lite failed, falling back to Tesseract:', err);
        const fallbackRes = await runTesseractOcr(imageDataUrl, 'ja-tesseract');
        return finalizeResult({ ...fallbackRes, detectedOcrLang: 'ja-tesseract' });
      }
    }

    // Auto mode: run NDLOCR-Lite unless default engine is Tesseract,
    // and automatically switch to Tesseract ('en') when extracted text is English.
    if (normalizedLang === 'auto') {
      if (engine !== 'tesseract') {
        try {
          const ndlRes = await runNdlOcr(imageDataUrl);
          if (isLikelyEnglishText(ndlRes.text)) {
            const tessEnRes = await runTesseractOcr(imageDataUrl, 'en');
            return finalizeResult({ ...tessEnRes, detectedOcrLang: 'en' });
          }
          return finalizeResult({ ...ndlRes, detectedOcrLang: 'ja' });
        } catch (err) {
          console.warn('[Offscreen OCR] NDLOCR-Lite failed, falling back to Tesseract:', err);
        }
      }
      return finalizeResult(await runTesseractOcr(imageDataUrl, 'auto'));
    }

    // English ('en') and all other non-Japanese languages use Tesseract directly
    const tessRes = await runTesseractOcr(imageDataUrl, ocrLang);
    return finalizeResult(normalizedLang === 'en' ? { ...tessRes, detectedOcrLang: 'en' } : tessRes);
  });

  ocrQueue = next.catch(() => { });
  return next;
}


