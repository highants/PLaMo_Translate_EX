/**
 * PLaMo Translate - Out-of-Process Popover Card Script
 * Runs inside popover.html (Extension Context OOPIF)
 * Since this is an extension-origin iframe, Chromium treats it as a Visible View,
 * granting the entire extension process ProcessPriority::kForeground automatically!
 */

(() => {
  const cardEl = document.getElementById('popoverCard');
  const cardBody = document.getElementById('cardBody');
  const targetLangSelect = document.getElementById('targetLangSelect');
  const formSelect = document.getElementById('formSelect');
  const cardStatus = document.getElementById('cardStatus');
  const btnReplace = document.getElementById('btnReplace');
  const btnReload = document.getElementById('btnReload');
  const btnCopy = document.getElementById('btnCopy');
  const loadingSpan = document.getElementById('loadingSpan');

  let currentSettings = { ...DEFAULT_SETTINGS };
  let currentText = '';
  let isEditable = false;
  let isWindowMode = false;
  let targetTabId = null;
  let translatedText = '';
  let activeRequestId = 0;

  // 1. Parse initial payload from URL hash
  try {
    const rawHash = location.hash ? location.hash.substring(1) : '';
    if (rawHash) {
      const payload = JSON.parse(decodeURIComponent(rawHash));
      currentText = payload.text || '';
      isEditable = Boolean(payload.isEditable);
      isWindowMode = Boolean(payload.isWindowMode);
      targetTabId = payload.tabId || null;
    }
  } catch (err) {
    console.warn('[PLaMo Popover] Failed to parse hash payload:', err);
  }

  if (isWindowMode) {
    document.body.classList.add('is-window-mode');
  }

  // 2. i18n Translation Helper
  function t(key, params = {}) {
    const lang = (typeof PlamoI18n !== 'undefined' && PlamoI18n.resolveUiLang)
      ? PlamoI18n.resolveUiLang(currentSettings.uiLang)
      : 'ja';
    return (typeof PlamoI18n !== 'undefined' && PlamoI18n.t)
      ? PlamoI18n.t(key, params, lang)
      : key;
  }

  function escapeHtml(str) {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // 3. Post size changes to parent content script (iframe mode only)
  function notifyDimensions() {
    if (isWindowMode) return;
    if (!cardEl) return;
    const isTranslating = cardEl.classList.contains('is-translating');
    const minH = isTranslating ? 36 : 120;
    const height = Math.min(450, Math.max(minH, cardEl.offsetHeight));
    const width = isTranslating ? 300 : 400;
    window.parent.postMessage({ type: 'PLAMO_RESIZE', height, width, isTranslating }, '*');
  }

  function notifyHeight() {
    notifyDimensions();
  }

  // Active focus retention to guarantee Chromium grants foreground priority
  function requestFocus() {
    try {
      window.focus();
      if (cardEl && typeof cardEl.focus === 'function') {
        cardEl.focus();
      }
      if (!isWindowMode) {
        window.parent.postMessage({ type: 'PLAMO_REQUEST_FOCUS' }, '*');
      }
    } catch {}
  }

  const resizeObserver = new ResizeObserver(() => {
    notifyDimensions();
  });
  resizeObserver.observe(cardEl);

  // 4. Initialize Controls
  function initControls() {
    const uiLang = (typeof PlamoI18n !== 'undefined' && PlamoI18n.resolveUiLang)
      ? PlamoI18n.resolveUiLang(currentSettings.uiLang)
      : 'ja';

    const targetLang = currentSettings.targetLang || 'ja';
    const form = currentSettings.form || 'none';

    // Populate Languages
    targetLangSelect.innerHTML = PLAMO_LANGUAGES.map(lang => {
      const selected = lang.code === targetLang ? 'selected' : '';
      const label = (typeof getLanguageDisplayName === 'function')
        ? getLanguageDisplayName(lang.code, uiLang)
        : `${lang.name} (${lang.code})`;
      return `<option value="${lang.code}" ${selected}>${label}</option>`;
    }).join('');

    // Populate Forms
    formSelect.innerHTML = `
      <option value="none" ${form === 'none' ? 'selected' : ''}>${t('formNoneShort')}</option>
      <option value="polite" ${form === 'polite' ? 'selected' : ''}>${t('formPoliteShort')}</option>
      <option value="plain" ${form === 'plain' ? 'selected' : ''}>${t('formPlainShort')}</option>
      <option value="easy" ${form === 'easy' ? 'selected' : ''}>${t('formEasyShort')}</option>
    `;
    formSelect.style.display = targetLang === 'ja' ? '' : 'none';

    // Replace button visibility
    btnReplace.style.display = isEditable ? 'inline-flex' : 'none';
    btnReplace.textContent = t('btnReplace');
    btnReload.textContent = t('btnReload');
    btnCopy.textContent = t('btnCopy');

    // Initial Engine Status
    const initialEngineLabel = (currentSettings.engineMode === 'wllama')
      ? (uiLang === 'en' ? 'PLaMo 0.8B (In-browser)' : 'PLaMo 0.8B (ブラウザ内蔵)')
      : 'LM Studio';
    cardStatus.textContent = initialEngineLabel;
  }

  // 5. Execute Translation
  let focusRetentionTimer = null;

  function startFocusRetention() {
    stopFocusRetention();
    requestFocus();
    focusRetentionTimer = setInterval(requestFocus, 120);
  }

  function stopFocusRetention() {
    if (focusRetentionTimer) {
      clearInterval(focusRetentionTimer);
      focusRetentionTimer = null;
    }
  }

  async function performTranslate() {
    const requestId = ++activeRequestId;
    const uiLang = (typeof PlamoI18n !== 'undefined' && PlamoI18n.resolveUiLang)
      ? PlamoI18n.resolveUiLang(currentSettings.uiLang)
      : 'ja';

    const targetLang = targetLangSelect.value;
    const form = formSelect.value;

    // In iframe mode, display sleek minimal operating indicator
    if (!isWindowMode) {
      cardEl.classList.remove('is-ready');
      cardEl.classList.add('is-translating');
      cardBody.innerHTML = `
        <div class="plamo-ext-indicator-bar">
          <span class="plamo-ext-brand-icon">🌐</span>
          <div class="plamo-ext-spinner"></div>
          <span id="loadingSpan" class="plamo-ext-loading-text">${t('cardTranslating')}</span>
          <button class="plamo-ext-btn-cancel-translating" id="btnCancelTranslating" title="${t('btnCloseWindow') || '閉じる (Esc)'}">✕</button>
        </div>
      `;

      const btnCancel = document.getElementById('btnCancelTranslating');
      if (btnCancel) {
        btnCancel.addEventListener('click', (e) => {
          e.stopPropagation();
          stopFocusRetention();
          window.parent.postMessage({ type: 'PLAMO_CLOSE' }, '*');
        });
      }
    } else {
      cardBody.innerHTML = `
        <div class="plamo-ext-loading">
          <div class="plamo-ext-spinner"></div>
          <span id="loadingSpan">${t('cardTranslating')}</span>
        </div>
      `;
    }

    notifyDimensions();
    startFocusRetention();

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'TRANSLATE_TEXT',
        text: currentText,
        targetLang,
        form,
        sourceLang: currentSettings.sourceLang || 'auto',
        engineMode: currentSettings.engineMode
      });

      if (requestId !== activeRequestId) return;

      stopFocusRetention();
      cardEl.classList.remove('is-translating');
      cardEl.classList.add('is-ready');

      if (response && response.ok) {
        translatedText = response.translatedText || t('outputPlaceholder');
        const autoSwitched = response.effectiveTargetLang && response.effectiveTargetLang !== targetLang;

        let autoNoticeHtml = '';
        if (autoSwitched) {
          autoNoticeHtml = `<div class="plamo-ext-auto-badge">${t('autoSwitchedBadge')}</div>`;
        }

        cardBody.innerHTML = `
          ${autoNoticeHtml}
          <div class="plamo-ext-result-content" style="white-space: pre-wrap;">${escapeHtml(translatedText)}</div>
          <details class="plamo-ext-source-details">
            <summary>${t('showSource', { n: currentText.length })}</summary>
            <div class="plamo-ext-source-text">${escapeHtml(currentText)}</div>
          </details>
        `;

        const rawStatus = response.modelUsed || 'PLaMo';
        cardStatus.textContent = rawStatus;
        cardStatus.title = `${rawStatus} (${response.apiModeUsed || 'completions'})`;
      } else {
        const errorMsg = response ? response.error : (uiLang === 'en' ? 'No response from translation service' : '翻訳サービスから応答がありません');
        const hint = (currentSettings.engineMode === 'wllama')
          ? (uiLang === 'en' ? 'Check if WebGPU/WASM is supported or reload the model in settings.' : 'WebGPU/WASMがサポートされているか、設定でモデル再読込を確認してください。')
          : (uiLang === 'en' ? 'Ensure LM Studio server is running on port 1234.' : 'LM Studio (ポート 1234) でサーバーが実行されているか確認してください。');
        cardBody.innerHTML = `
          <div class="plamo-ext-error-msg">
            <strong>${uiLang === 'en' ? 'Translation Error:' : '翻訳エラー:'}</strong><br>
            ${escapeHtml(errorMsg)}
            <div style="margin-top: 6px; font-size: 11px; opacity: 0.85;">
              ${escapeHtml(hint)}
            </div>
          </div>
        `;
      }
    } catch (err) {
      if (requestId !== activeRequestId) return;
      stopFocusRetention();
      cardEl.classList.remove('is-translating');
      cardEl.classList.add('is-ready');

      cardBody.innerHTML = `
        <div class="plamo-ext-error-msg">
          <strong>${uiLang === 'en' ? 'Communication Error:' : '通信エラー:'}</strong><br>
          ${escapeHtml(err.message || String(err))}
        </div>
      `;
    } finally {
      stopFocusRetention();
      setTimeout(notifyDimensions, 30);
    }
  }

  // 6. Listen for Wllama Progress
  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== 'WLLAMA_PROGRESS' || !message.state) return;
    const state = message.state;
    const span = document.getElementById('loadingSpan');
    if (!span) return;

    const uiLang = (typeof PlamoI18n !== 'undefined' && PlamoI18n.resolveUiLang)
      ? PlamoI18n.resolveUiLang(currentSettings.uiLang)
      : 'ja';

    if (state.status === 'downloading' || state.status === 'loading') {
      const percent = state.percent || 0;
      const label = state.status === 'downloading'
        ? (uiLang === 'en' ? `Downloading model: ${percent}%...` : `モデルDL中: ${percent}%...`)
        : (uiLang === 'en' ? `Initializing model: ${percent}%...` : `モデル読込中: ${percent}%...`);
      span.textContent = label;
      notifyDimensions();
    }
  });

  // 7. Wire UI Events
  targetLangSelect.addEventListener('change', () => {
    formSelect.style.display = targetLangSelect.value === 'ja' ? '' : 'none';
    performTranslate();
  });

  formSelect.addEventListener('change', () => {
    performTranslate();
  });

  btnReload.addEventListener('click', () => {
    performTranslate();
  });

  btnCopy.addEventListener('click', async () => {
    if (!translatedText) return;
    try {
      await navigator.clipboard.writeText(translatedText);
      const origText = btnCopy.textContent;
      btnCopy.textContent = t('btnCopySuccess');
      btnCopy.classList.add('plamo-ext-btn-success');
      setTimeout(() => {
        btnCopy.textContent = origText;
        btnCopy.classList.remove('plamo-ext-btn-success');
      }, 1800);
    } catch (err) {
      console.warn('Failed to copy to clipboard:', err);
    }
  });

  btnReplace.addEventListener('click', async () => {
    if (!translatedText) return;
    if (isWindowMode && targetTabId) {
      try {
        await chrome.tabs.sendMessage(targetTabId, {
          type: 'PLAMO_REPLACE_TEXT',
          text: translatedText
        });
      } catch (err) {
        console.warn('[PLaMo Popover] Failed to send replace text to tab:', err);
      }
      window.close();
    } else {
      window.parent.postMessage({ type: 'PLAMO_REPLACE_TEXT', text: translatedText }, '*');
    }
  });

  const btnCloseWindow = document.getElementById('btnCloseWindow');
  if (btnCloseWindow) {
    btnCloseWindow.addEventListener('click', () => {
      if (isWindowMode) {
        window.close();
      } else {
        window.parent.postMessage({ type: 'PLAMO_CLOSE' }, '*');
      }
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (isWindowMode) {
        window.close();
      } else {
        window.parent.postMessage({ type: 'PLAMO_CLOSE' }, '*');
      }
    }
  });

  // 8. Start
  if (!isWindowMode) {
    cardEl.classList.add('is-translating');
  }

  chrome.storage.local.get(DEFAULT_SETTINGS, (stored) => {
    if (stored) {
      currentSettings = { ...DEFAULT_SETTINGS, ...stored };
    }
    initControls();
    notifyDimensions();
    requestFocus();

    if (currentText) {
      performTranslate();
    }
  });
})();

