/**
 * PLaMo Translate - Background Service Worker (Manifest V3)
 * Handles Context Menus and LM Studio API routing to avoid Page CSP/Mixed Content issues
 */

importScripts('i18n.js', 'pfml.js');

// 1. Setup Context Menus and Side Panel Behavior with i18n support
async function configureSidePanel() {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    try {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    } catch (err) {
      console.warn('Failed to configure side panel behavior:', err);
    }
  }
}

async function setupContextMenus() {
  await configureSidePanel();
  try {
    const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
    const lang = PlamoI18n.resolveUiLang(stored.uiLang || DEFAULT_SETTINGS.uiLang);

    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: 'plamo-translate-selection',
        title: PlamoI18n.t('menuTranslateSelection', {}, lang),
        contexts: ['selection']
      });

      chrome.contextMenus.create({
        id: 'plamo-translate-page',
        title: PlamoI18n.t('menuTranslatePage', {}, lang),
        contexts: ['page']
      });
    });
  } catch (err) {
    console.warn('Failed to setup context menus:', err);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  setupContextMenus();
});

// Also ensure side panel behavior is set on service worker start
configureSidePanel();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.uiLang) {
    setupContextMenus();
  }
});

// 2. Handle Context Menu Actions
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || !tab.id) return;

  if (info.menuItemId === 'plamo-translate-selection') {
    const selectedText = info.selectionText ? info.selectionText.trim() : '';
    if (!selectedText) return;

    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'SHOW_INLINE_TRANSLATION',
        text: selectedText
      });
    } catch (err) {
      console.warn('Could not send message to tab, opening side panel:', err);
      if (chrome.sidePanel && chrome.sidePanel.open) {
        await chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
      }
      chrome.runtime.sendMessage({
        type: 'PLAMO_SIDE_PANEL_AUTO_TRANSLATE',
        text: selectedText
      }).catch(() => {});
    }
  } else if (info.menuItemId === 'plamo-translate-page') {
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'TOGGLE_PAGE_TRANSLATION'
      });
    } catch (err) {
      console.warn('Could not send message to tab for page translation:', err);
    }
  }
});

// 3. Offscreen Document Management for Mode B (In-Browser Wllama)
const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
let creatingOffscreenPromise = null;

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);

  if (chrome.runtime.getContexts) {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl]
    });
    if (existingContexts && existingContexts.length > 0) {
      return;
    }
  } else if (chrome.offscreen && chrome.offscreen.hasDocument) {
    const hasDoc = await chrome.offscreen.hasDocument();
    if (hasDoc) return;
  }

  if (creatingOffscreenPromise) {
    await creatingOffscreenPromise;
    return;
  }

  creatingOffscreenPromise = chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: ['WORKERS', 'BLOBS'],
    justification: 'Run Wllama (llama.cpp WebAssembly/WebGPU) in-browser inference and OPFS model caching'
  });

  try {
    await creatingOffscreenPromise;
  } catch (err) {
    const errMsg = String(err?.message || err);
    if (!errMsg.includes('single offscreen document') && !errMsg.includes('already exists')) {
      throw err;
    }
  } finally {
    creatingOffscreenPromise = null;
  }
}

async function sendToOffscreen(payload) {
  await ensureOffscreenDocument();
  return await chrome.runtime.sendMessage({
    ...payload,
    target: 'offscreen'
  });
}

/**
 * Detect language using Chrome native i18n CLD API with heuristic fallback
 * @param {string} text
 * @param {string} [specifiedSourceLang='auto']
 * @returns {Promise<string>}
 */
async function resolveDetectedLanguage(text, specifiedSourceLang) {
  if (specifiedSourceLang && specifiedSourceLang !== 'auto') {
    return specifiedSourceLang;
  }
  if (!text || typeof text !== 'string') return 'auto';

  // 1. Try Chrome native i18n CLD API (supports 100+ languages accurately)
  if (typeof chrome !== 'undefined' && chrome.i18n && typeof chrome.i18n.detectLanguage === 'function') {
    try {
      const res = await new Promise((resolve) => {
        chrome.i18n.detectLanguage(text, (result) => resolve(result));
      });
      if (res && Array.isArray(res.languages) && res.languages.length > 0) {
        const top = res.languages[0];
        if (top && top.language && top.language !== 'und' && top.percentage > 30) {
          return top.language;
        }
      }
    } catch (err) {
      console.warn('chrome.i18n.detectLanguage failed, using fallback:', err);
    }
  }

  // 2. Fallback to Unicode heuristic detector
  if (typeof detectLanguage === 'function') {
    return detectLanguage(text);
  }
  return 'auto';
}

// Active Native Float Window tracker
let activeFloatWindowId = null;

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === activeFloatWindowId) {
    activeFloatWindowId = null;
  }
});

// 4. Message Router
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  // Ignore messages targeted at the Offscreen Document or broadcast progress events
  if (message.target === 'offscreen' || message.type === 'WLLAMA_PROGRESS') {
    return false;
  }

  // Handle asynchronous requests via IIFE
  (async () => {
    try {
      switch (message.type) {
        case 'OPEN_FLOAT_WINDOW': {
          const text = message.text || '';
          const isEditable = Boolean(message.isEditable);
          const tabId = sender.tab ? sender.tab.id : null;

          const width = 430;
          const height = 310;
          const reqX = typeof message.screenX === 'number' ? message.screenX : 200;
          const reqY = typeof message.screenY === 'number' ? message.screenY : 200;

          // Close existing float window if open
          if (activeFloatWindowId !== null) {
            try {
              await chrome.windows.remove(activeFloatWindowId);
            } catch {
              // Ignore if already closed
            }
            activeFloatWindowId = null;
          }

          const payload = {
            text,
            isEditable,
            tabId,
            isWindowMode: true
          };

          const win = await chrome.windows.create({
            url: chrome.runtime.getURL('popover.html') + '#' + encodeURIComponent(JSON.stringify(payload)),
            type: 'popup',
            width,
            height,
            left: Math.max(10, reqX),
            top: Math.max(10, reqY),
            focused: true
          });

          activeFloatWindowId = win.id;
          sendResponse({ ok: true, windowId: win.id });
          break;
        }
        case 'TEST_CONNECTION':
        case 'FETCH_MODELS': {
          const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
          const baseUrl = message.baseUrl || stored.baseUrl || DEFAULT_SETTINGS.baseUrl;
          const result = await fetchLmStudioModels(baseUrl);
          sendResponse(result);
          break;
        }

        case 'WLLAMA_GET_STATUS': {
          const res = await sendToOffscreen({ type: 'OFFSCREEN_WLLAMA_STATUS' });
          sendResponse(res);
          break;
        }

        case 'WLLAMA_LOAD_MODEL': {
          const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
          const res = await sendToOffscreen({
            type: 'OFFSCREEN_WLLAMA_LOAD_MODEL',
            modelUrl: message.modelUrl || stored.wllamaModelUrl || DEFAULT_SETTINGS.wllamaModelUrl,
            useWebGpu: message.useWebGpu !== undefined ? message.useWebGpu : stored.wllamaUseWebGpu,
            nCtx: message.nCtx || stored.wllamaContextSize || DEFAULT_SETTINGS.wllamaContextSize
          });
          sendResponse(res);
          break;
        }

        case 'WLLAMA_UNLOAD_MODEL': {
          const res = await sendToOffscreen({ type: 'OFFSCREEN_WLLAMA_UNLOAD_MODEL' });
          sendResponse(res);
          break;
        }

        case 'WLLAMA_CLEAR_CACHE': {
          const res = await sendToOffscreen({ type: 'OFFSCREEN_WLLAMA_CLEAR_CACHE' });
          sendResponse(res);
          break;
        }

        case 'TRANSLATE_TEXT': {
          const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
          const settings = { ...DEFAULT_SETTINGS, ...stored };

          const text = message.text || '';
          if (!text.trim()) {
            sendResponse({ ok: false, error: '翻訳対象テキストが空です' });
            return;
          }

          const sourceLang = message.sourceLang !== undefined ? message.sourceLang : settings.sourceLang;
          const targetLang = message.targetLang !== undefined ? message.targetLang : settings.targetLang;
          const autoSwitchJaEn = message.autoSwitchJaEn !== undefined ? message.autoSwitchJaEn : settings.autoSwitchJaEn;
          const form = message.form !== undefined ? message.form : settings.form;
          const context = message.context !== undefined ? message.context : settings.context;
          const glossaryText = message.glossaryText !== undefined ? message.glossaryText : settings.glossaryText;
          const engineMode = message.engineMode || settings.engineMode || 'lmstudio';

          const effectiveTargetLang = resolveTargetLang(text, sourceLang, targetLang, autoSwitchJaEn, form);
          const detectedSourceLang = await resolveDetectedLanguage(text, sourceLang);
          const normTarget = normalizeLanguageCode(targetLang);
          const autoSwitched = Boolean(autoSwitchJaEn && (sourceLang === 'auto' || !sourceLang) && normTarget === 'ja' && isJapaneseText(text) && effectiveTargetLang === 'en');

          const pfmlPrompt = buildPfml3Prompt({
            text,
            sourceLang,
            targetLang: effectiveTargetLang,
            form,
            context,
            glossary: glossaryText
          });

          if (engineMode === 'wllama') {
            const offRes = await sendToOffscreen({
              type: 'OFFSCREEN_WLLAMA_TRANSLATE',
              prompt: pfmlPrompt,
              modelUrl: message.wllamaModelUrl || settings.wllamaModelUrl || DEFAULT_SETTINGS.wllamaModelUrl,
              useWebGpu: message.wllamaUseWebGpu !== undefined ? message.wllamaUseWebGpu : settings.wllamaUseWebGpu,
              nCtx: settings.wllamaContextSize || DEFAULT_SETTINGS.wllamaContextSize,
              temperature: message.temperature !== undefined ? message.temperature : settings.temperature,
              maxTokens: message.maxTokens !== undefined ? message.maxTokens : settings.maxTokens
            });

            if (!offRes || !offRes.ok) {
              throw new Error(offRes ? offRes.error : 'Wllama (Offscreen) 推論に失敗しました');
            }

            sendResponse({
              ok: true,
              translatedText: offRes.translatedText,
              prompt: pfmlPrompt,
              effectiveTargetLang,
              detectedSourceLang,
              autoSwitched,
              modelUsed: offRes.modelUsed,
              apiModeUsed: offRes.apiModeUsed
            });
          } else {
            const res = await executePlamoTranslation({
              baseUrl: message.baseUrl || settings.baseUrl,
              model: message.model !== undefined ? message.model : settings.model,
              apiMode: message.apiMode || settings.apiMode,
              prompt: pfmlPrompt,
              effectiveTargetLang,
              sourceLang,
              temperature: message.temperature !== undefined ? message.temperature : settings.temperature,
              maxTokens: message.maxTokens !== undefined ? message.maxTokens : settings.maxTokens,
              stream: true,
              onChunk: ({ chunk, currentText }) => {
                // Broadcast real-time streaming tokens to sidebar / popover
                chrome.runtime.sendMessage({
                  type: 'PLAMO_STREAM_CHUNK',
                  chunk,
                  currentText,
                  engineMode: 'lmstudio'
                }).catch(() => {});
                // Also broadcast WLLAMA_STREAM_CHUNK for complete backward compatibility
                chrome.runtime.sendMessage({
                  type: 'WLLAMA_STREAM_CHUNK',
                  chunk,
                  currentText,
                  engineMode: 'lmstudio'
                }).catch(() => {});
              }
            });

            sendResponse({
              ok: true,
              translatedText: res.translatedText,
              prompt: pfmlPrompt,
              effectiveTargetLang,
              detectedSourceLang,
              autoSwitched,
              modelUsed: res.modelUsed,
              apiModeUsed: res.apiModeUsed
            });
          }
          break;
        }

        case 'GET_SETTINGS': {
          const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
          sendResponse({ ok: true, settings: { ...DEFAULT_SETTINGS, ...stored } });
          break;
        }

        case 'SAVE_SETTINGS': {
          const newSettings = message.settings || {};
          await chrome.storage.local.set(newSettings);
          sendResponse({ ok: true });
          break;
        }

        default:
          sendResponse({ ok: false, error: `不明なメッセージタイプ: ${message.type}` });
          break;
      }
    } catch (err) {
      console.warn('Background processing error:', err);
      sendResponse({
        ok: false,
        error: err.message || String(err)
      });
    }
  })();

  return true; // Keep channel open for async sendResponse
});
