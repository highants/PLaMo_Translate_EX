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

  // 3. Post height changes to parent content script (iframe mode only)
  let userHasResizedHeight = false;

  function notifyHeight() {
    if (isWindowMode) return;
    if (!cardEl) return;
    if (userHasResizedHeight) return; // Retain user-specified custom height
    const height = Math.min(420, Math.max(140, cardEl.offsetHeight));
    window.parent.postMessage({ type: 'PLAMO_RESIZE', height }, '*');
  }

  const resizeObserver = new ResizeObserver(() => {
    notifyHeight();
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
  async function performTranslate() {
    const requestId = ++activeRequestId;
    const uiLang = (typeof PlamoI18n !== 'undefined' && PlamoI18n.resolveUiLang)
      ? PlamoI18n.resolveUiLang(currentSettings.uiLang)
      : 'ja';

    const targetLang = targetLangSelect.value;
    const form = formSelect.value;

    cardBody.innerHTML = `
      <div class="plamo-ext-loading">
        <div class="plamo-ext-spinner"></div>
        <span id="loadingSpan">${t('cardTranslating')}</span>
      </div>
    `;
    notifyHeight();

    try {
      window.focus();
    } catch {}

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

      if (response && response.ok) {
        translatedText = response.translatedText || t('outputPlaceholder');
        // Only show auto-switch notice if actual Japanese -> English flip occurred
        const autoSwitched = Boolean(response.autoSwitched);

        let autoNoticeHtml = '';
        if (autoSwitched) {
          autoNoticeHtml = `<div class="plamo-ext-auto-badge">${t('autoSwitchedBadge')}</div>`;
        }

        const detectedLangCode = response.detectedSourceLang || (typeof detectLanguage === 'function' ? detectLanguage(currentText) : 'auto');
        const sourceLangLabel = (typeof getLanguageSimpleName === 'function')
          ? getLanguageSimpleName(detectedLangCode, uiLang)
          : (typeof getLanguageDisplayName === 'function' ? getLanguageDisplayName(detectedLangCode, uiLang) : detectedLangCode);

        cardBody.innerHTML = `
          ${autoNoticeHtml}
          <div class="plamo-ext-result-content" style="white-space: pre-wrap;">${escapeHtml(translatedText)}</div>
          <details class="plamo-ext-source-details">
            <summary>
              <span>${t('showSource', { n: currentText.length })}</span>
              <span class="plamo-ext-source-lang-badge">${escapeHtml(sourceLangLabel)}</span>
            </summary>
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
      cardBody.innerHTML = `
        <div class="plamo-ext-error-msg">
          <strong>${uiLang === 'en' ? 'Communication Error:' : '通信エラー:'}</strong><br>
          ${escapeHtml(err.message || String(err))}
        </div>
      `;
    } finally {
      setTimeout(notifyHeight, 20);
    }
  }

  // 6. Listen for Progress and Real-time Streaming Chunks (Wllama & LM Studio)
  chrome.runtime.onMessage.addListener((message) => {
    if (!message) return;

    if ((message.type === 'WLLAMA_STREAM_CHUNK' || message.type === 'PLAMO_STREAM_CHUNK') && message.currentText) {
      let streamingContent = document.getElementById('streamingContent');
      if (!streamingContent) {
        const detectedLangCode = (typeof detectLanguage === 'function') ? detectLanguage(currentText) : 'auto';
        const uiLang = (typeof PlamoI18n !== 'undefined' && PlamoI18n.resolveUiLang)
          ? PlamoI18n.resolveUiLang(currentSettings.uiLang)
          : 'ja';
        const sourceLangLabel = (typeof getLanguageSimpleName === 'function')
          ? getLanguageSimpleName(detectedLangCode, uiLang)
          : (typeof getLanguageDisplayName === 'function' ? getLanguageDisplayName(detectedLangCode, uiLang) : detectedLangCode);

        cardBody.innerHTML = `
          <div class="plamo-ext-result-content" id="streamingContent" style="white-space: pre-wrap;"></div>
          <details class="plamo-ext-source-details">
            <summary>
              <span>${t('showSource', { n: currentText.length })}</span>
              <span class="plamo-ext-source-lang-badge">${escapeHtml(sourceLangLabel)}</span>
            </summary>
            <div class="plamo-ext-source-text">${escapeHtml(currentText)}</div>
          </details>
        `;
        streamingContent = document.getElementById('streamingContent');
      }
      if (streamingContent) {
        streamingContent.textContent = message.currentText;
        notifyHeight();
      }
      return;
    }

    if (message.type === 'WLLAMA_PROGRESS' && message.state) {
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
        notifyHeight();
      }
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

  // 7. Interactive Resize Handle (iframe mode)
  function initResizeHandle() {
    const handle = document.getElementById('resizeHandle');
    if (!handle || isWindowMode) return;

    let isDragging = false;
    let startScreenX = 0;
    let startScreenY = 0;
    let startW = 0;
    let startH = 0;

    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      isDragging = true;
      userHasResizedHeight = true;

      startScreenX = (typeof e.screenX === 'number' && e.screenX !== 0) ? e.screenX : e.clientX;
      startScreenY = (typeof e.screenY === 'number' && e.screenY !== 0) ? e.screenY : e.clientY;
      startW = document.documentElement.clientWidth || window.innerWidth;
      startH = document.documentElement.clientHeight || window.innerHeight;

      try {
        handle.setPointerCapture(e.pointerId);
      } catch {}

      e.preventDefault();
      e.stopPropagation();
    });

    handle.addEventListener('pointermove', (e) => {
      if (!isDragging) return;

      const currentScreenX = (typeof e.screenX === 'number' && e.screenX !== 0) ? e.screenX : e.clientX;
      const currentScreenY = (typeof e.screenY === 'number' && e.screenY !== 0) ? e.screenY : e.clientY;

      const dx = currentScreenX - startScreenX;
      const dy = currentScreenY - startScreenY;

      const newW = Math.max(300, Math.min(window.screen.availWidth - 40, Math.round(startW + dx)));
      const newH = Math.max(140, Math.min(window.screen.availHeight - 80, Math.round(startH + dy)));

      window.parent.postMessage({ type: 'PLAMO_USER_RESIZE', width: newW, height: newH }, '*');
    });

    const endDrag = (e) => {
      if (!isDragging) return;
      isDragging = false;
      try {
        handle.releasePointerCapture(e.pointerId);
      } catch {}

      const finalW = document.documentElement.clientWidth || window.innerWidth;
      const finalH = document.documentElement.clientHeight || window.innerHeight;

      chrome.storage.local.set({
        popoverCustomWidth: finalW,
        popoverCustomHeight: finalH
      }).catch(() => {});
    };

    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
  }

  // 7.2 Interactive Window Move / Drag (iframe mode)
  function initDragMove() {
    const header = document.querySelector('.plamo-ext-card-header');
    if (!header || isWindowMode) return;

    let isMoving = false;
    let lastScreenX = 0;
    let lastScreenY = 0;

    header.addEventListener('pointerdown', (e) => {
      // Ignore if clicking on interactive controls (language select, form select, close button, etc.)
      if (e.target.closest('select, button, input, a')) return;
      if (e.button !== 0) return; // Only primary button

      isMoving = true;
      lastScreenX = (typeof e.screenX === 'number' && e.screenX !== 0) ? e.screenX : e.clientX;
      lastScreenY = (typeof e.screenY === 'number' && e.screenY !== 0) ? e.screenY : e.clientY;

      try {
        header.setPointerCapture(e.pointerId);
      } catch {}

      e.preventDefault();
      e.stopPropagation();
    });

    header.addEventListener('pointermove', (e) => {
      if (!isMoving) return;

      const currentScreenX = (typeof e.screenX === 'number' && e.screenX !== 0) ? e.screenX : e.clientX;
      const currentScreenY = (typeof e.screenY === 'number' && e.screenY !== 0) ? e.screenY : e.clientY;

      const deltaX = currentScreenX - lastScreenX;
      const deltaY = currentScreenY - lastScreenY;

      lastScreenX = currentScreenX;
      lastScreenY = currentScreenY;

      if (deltaX !== 0 || deltaY !== 0) {
        window.parent.postMessage({ type: 'PLAMO_USER_MOVE', deltaX, deltaY }, '*');
      }
    });

    const endMove = (e) => {
      if (!isMoving) return;
      isMoving = false;
      try {
        header.releasePointerCapture(e.pointerId);
      } catch {}
    };

    header.addEventListener('pointerup', endMove);
    header.addEventListener('pointercancel', endMove);
  }

  // 8. Start
  chrome.storage.local.get(DEFAULT_SETTINGS, (stored) => {
    if (stored) {
      currentSettings = { ...DEFAULT_SETTINGS, ...stored };
    }
    if (currentSettings.popoverCustomHeight && currentSettings.popoverCustomHeight > 0) {
      userHasResizedHeight = true;
    }
    initControls();
    initResizeHandle();
    initDragMove();
    notifyHeight();

    // Focus window and card container to trigger foreground priority in Chromium (Approach C)
    try {
      window.focus();
      if (cardEl && typeof cardEl.focus === 'function') {
        cardEl.focus();
      }
    } catch {}

    if (currentText) {
      performTranslate();
    }
  });
})();

