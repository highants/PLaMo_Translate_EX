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
 * Extract human-readable filename from a full model URL
 * @param {string} url
 * @returns {string}
 */
function getShortModelName(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    const parts = pathname.split('/').filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : url;
  } catch {
    const parts = url.split('/').filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : url;
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
  return rawText
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

        const stop = getStopTokens();
        const res = await wllamaInstance.createCompletion({
          prompt: message.prompt,
          max_tokens: Number(message.maxTokens) || 1024,
          temperature: Number(message.temperature) || 0,
          stop
        });

        const rawText = res?.choices?.[0]?.text || '';
        const translatedText = getCleanText(rawText);

        return {
          ok: true,
          translatedText,
          rawText,
          modelUsed: `Wllama: ${getShortModelName(loadedModelUrl)} (${wllamaState.backend || 'WASM'})`,
          apiModeUsed: `wllama-${(wllamaState.backend || 'wasm').toLowerCase()}`
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

    default:
      sendResponse({
        ok: false,
        error: `Unknown offscreen message type: ${message.type}`
      });
      return false;
  }
});

