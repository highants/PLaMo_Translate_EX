/**
 * PLaMo Translate - Background Service Worker (Manifest V3)
 * Handles Context Menus and LM Studio API routing to avoid Page CSP/Mixed Content issues
 */

importScripts('i18n.js', 'pfml.js');

// 1. Setup Context Menus with i18n support
async function setupContextMenus() {
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
    console.error('Failed to setup context menus:', err);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  setupContextMenus();
});

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
      console.warn('Could not send message to tab, injecting script or opening popup:', err);
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

// 3. Message Router
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  // Handle asynchronous requests via IIFE
  (async () => {
    try {
      switch (message.type) {
        case 'TEST_CONNECTION':
        case 'FETCH_MODELS': {
          const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
          const baseUrl = message.baseUrl || stored.baseUrl || DEFAULT_SETTINGS.baseUrl;
          const result = await fetchLmStudioModels(baseUrl);
          sendResponse(result);
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

          const effectiveTargetLang = resolveTargetLang(text, sourceLang, targetLang, autoSwitchJaEn);

          const pfmlPrompt = buildPfml3Prompt({
            text,
            sourceLang,
            targetLang: effectiveTargetLang,
            form,
            context,
            glossary: glossaryText
          });

          const res = await executePlamoTranslation({
            baseUrl: message.baseUrl || settings.baseUrl,
            model: message.model !== undefined ? message.model : settings.model,
            apiMode: message.apiMode || settings.apiMode,
            prompt: pfmlPrompt,
            effectiveTargetLang,
            sourceLang,
            temperature: message.temperature !== undefined ? message.temperature : settings.temperature,
            maxTokens: message.maxTokens !== undefined ? message.maxTokens : settings.maxTokens
          });

          sendResponse({
            ok: true,
            translatedText: res.translatedText,
            prompt: pfmlPrompt,
            effectiveTargetLang,
            modelUsed: res.modelUsed,
            apiModeUsed: res.apiModeUsed
          });
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
      console.error('Background processing error:', err);
      sendResponse({
        ok: false,
        error: err.message || String(err)
      });
    }
  })();

  return true; // Keep channel open for async sendResponse
});
