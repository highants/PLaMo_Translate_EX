/**
 * PLaMo Translate - Popup Script
 * Handles UI events, settings synchronization, LM Studio connection,
 * translation orchestration, active tab integration, and i18n localization.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements
  const connectionDot = document.getElementById('connectionDot');
  const connectionStatus = document.getElementById('connectionStatus');
  const btnOpenTab = document.getElementById('btnOpenTab');
  const btnToggleSettings = document.getElementById('btnToggleSettings');

  const btnGrabSelection = document.getElementById('btnGrabSelection');
  const btnPageTranslate = document.getElementById('btnPageTranslate');
  const btnAreaOcrTranslate = document.getElementById('btnAreaOcrTranslate');
  const btnModeLmStudio = document.getElementById('btnModeLmStudio');
  const btnModeWllama = document.getElementById('btnModeWllama');

  const sourceLangSelect = document.getElementById('sourceLangSelect');
  const targetLangSelect = document.getElementById('targetLangSelect');
  const btnSwapLang = document.getElementById('btnSwapLang');
  const formGroup = document.getElementById('formGroup');
  const formSelect = document.getElementById('formSelect');

  const inputText = document.getElementById('inputText');
  const detectedLangBadge = document.getElementById('detectedLangBadge');
  const charCount = document.getElementById('charCount');
  const btnClearInput = document.getElementById('btnClearInput');
  const contextInput = document.getElementById('contextInput');
  const glossaryInput = document.getElementById('glossaryInput');
  const btnTranslate = document.getElementById('btnTranslate');

  const outputLoading = document.getElementById('outputLoading');
  const outputError = document.getElementById('outputError');
  const outputErrorText = document.getElementById('outputErrorText');
  const outputPlaceholder = document.getElementById('outputPlaceholder');
  const outputText = document.getElementById('outputText');
  const effectiveTargetBadge = document.getElementById('effectiveTargetBadge');
  const modelUsedBadge = document.getElementById('modelUsedBadge');
  const btnCopyOutput = document.getElementById('btnCopyOutput');
  const btnClearOutput = document.getElementById('btnClearOutput');

  const promptDetails = document.getElementById('promptDetails');
  const promptPreview = document.getElementById('promptPreview');

  // Settings DOM
  const settingsPanel = document.getElementById('settingsPanel');
  const btnCloseSettings = document.getElementById('btnCloseSettings');
  const settingUiLang = document.getElementById('settingUiLang');
  const settingEngineMode = document.getElementById('settingEngineMode');
  const lmStudioSettingsGroup = document.getElementById('lmStudioSettingsGroup');
  const wllamaSettingsGroup = document.getElementById('wllamaSettingsGroup');
  const settingBaseUrl = document.getElementById('settingBaseUrl');
  const btnTestConnection = document.getElementById('btnTestConnection');
  const settingModel = document.getElementById('settingModel');
  const settingModelCustom = document.getElementById('settingModelCustom');
  const settingApiMode = document.getElementById('settingApiMode');
  const settingWllamaModel = document.getElementById('settingWllamaModel');
  const settingWllamaModelCustom = document.getElementById('settingWllamaModelCustom');
  const settingWllamaWebGpu = document.getElementById('settingWllamaWebGpu');
  const btnWllamaLoad = document.getElementById('btnWllamaLoad');
  const btnWllamaUnload = document.getElementById('btnWllamaUnload');
  const btnWllamaClearCache = document.getElementById('btnWllamaClearCache');
  const wllamaProgressWrap = document.getElementById('wllamaProgressWrap');
  const wllamaProgressBar = document.getElementById('wllamaProgressBar');
  const wllamaStatusText = document.getElementById('wllamaStatusText');
  const settingSelectionMode = document.getElementById('settingSelectionMode');
  const settingInlineDisplayMode = document.getElementById('settingInlineDisplayMode');
  const settingImageHoverBtn = document.getElementById('settingImageHoverBtn');
  const settingOcrEngine = document.getElementById('settingOcrEngine');
  const settingAutoSwitchJaEn = document.getElementById('settingAutoSwitchJaEn');
  const settingTemperature = document.getElementById('settingTemperature');
  const settingMaxTokens = document.getElementById('settingMaxTokens');
  const btnSaveSettings = document.getElementById('btnSaveSettings');
  const settingsSaveStatus = document.getElementById('settingsSaveStatus');
  const loadingTextEl = outputLoading.querySelector('[data-i18n="loadingText"]');

  let currentSettings = { ...DEFAULT_SETTINGS };
  let currentUiLang = 'ja';

  // -------------------------------------------------------------
  // 1. i18n Localization Engine
  // -------------------------------------------------------------
  function applyUiLanguage(preference) {
    currentUiLang = PlamoI18n.resolveUiLang(preference || currentSettings.uiLang);
    document.documentElement.lang = currentUiLang;

    // Apply text content
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (key) {
        el.textContent = PlamoI18n.t(key, {}, currentUiLang);
      }
    });

    // Apply title attributes
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      if (key) {
        el.setAttribute('title', PlamoI18n.t(key, {}, currentUiLang));
      }
    });

    // Apply placeholder attributes
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key) {
        el.setAttribute('placeholder', PlamoI18n.t(key, {}, currentUiLang));
      }
    });

    // Update dynamic text
    updateCharCount();
    populateLanguageDropdowns();
    populateWllamaPresets();
  }

  function populateWllamaPresets() {
    if (!settingWllamaModel || typeof WLLAMA_MODEL_PRESETS === 'undefined') return;
    const currentUrl = currentSettings.wllamaModelUrl || DEFAULT_SETTINGS.wllamaModelUrl;
    settingWllamaModel.innerHTML = '';

    let matchedPreset = false;
    WLLAMA_MODEL_PRESETS.forEach(preset => {
      const opt = document.createElement('option');
      opt.value = preset.url;
      opt.textContent = currentUiLang === 'en' ? preset.enName : preset.name;
      if (preset.url === currentUrl) {
        opt.selected = true;
        matchedPreset = true;
      }
      settingWllamaModel.appendChild(opt);
    });

    const customOpt = document.createElement('option');
    customOpt.value = '__custom__';
    customOpt.textContent = currentUiLang === 'en' ? '✎ Custom GGUF URL...' : '✎ カスタム GGUF URL...';
    settingWllamaModel.appendChild(customOpt);

    if (currentUrl && !matchedPreset) {
      customOpt.selected = true;
      settingWllamaModelCustom.style.display = 'block';
      settingWllamaModelCustom.value = currentUrl;
    } else {
      settingWllamaModelCustom.style.display = 'none';
    }
  }

  function getSelectedWllamaModelUrl() {
    if (!settingWllamaModel) return DEFAULT_SETTINGS.wllamaModelUrl;
    if (settingWllamaModel.value === '__custom__') {
      return settingWllamaModelCustom.value.trim() || DEFAULT_SETTINGS.wllamaModelUrl;
    }
    return settingWllamaModel.value || DEFAULT_SETTINGS.wllamaModelUrl;
  }

  function applyEngineModeVisibility(mode) {
    const isWllama = mode === 'wllama';
    if (settingEngineMode) settingEngineMode.value = isWllama ? 'wllama' : 'lmstudio';
    if (btnModeLmStudio) {
      btnModeLmStudio.classList.toggle('active', !isWllama);
      btnModeLmStudio.setAttribute('aria-pressed', String(!isWllama));
    }
    if (btnModeWllama) {
      btnModeWllama.classList.toggle('active', isWllama);
      btnModeWllama.setAttribute('aria-pressed', String(isWllama));
    }
    if (lmStudioSettingsGroup) lmStudioSettingsGroup.style.display = isWllama ? 'none' : 'flex';
    if (wllamaSettingsGroup) wllamaSettingsGroup.style.display = isWllama ? 'flex' : 'none';
  }

  function updateCharCount() {
    const val = inputText.value;
    const count = val.length;
    charCount.textContent = PlamoI18n.t('charCountUnit', { n: count }, currentUiLang);

    if (detectedLangBadge) {
      if (count > 0 && typeof detectLanguage === 'function') {
        const detected = detectLanguage(val);
        const name = (typeof getLanguageSimpleName === 'function')
          ? getLanguageSimpleName(detected, currentUiLang)
          : detected;
        detectedLangBadge.textContent = name;
        detectedLangBadge.style.display = 'inline-flex';
      } else {
        detectedLangBadge.style.display = 'none';
      }
    }
  }

  // -------------------------------------------------------------
  // 2. Initialize Language Selectors
  // -------------------------------------------------------------
  function populateLanguageDropdowns() {
    const curSrc = sourceLangSelect.value || currentSettings.sourceLang || 'auto';
    const curTgt = targetLangSelect.value || currentSettings.targetLang || 'ja';

    // Populate Source (Auto + 53 languages)
    sourceLangSelect.innerHTML = `<option value="auto">${PlamoI18n.t('optAutoDetect', {}, currentUiLang)}</option>`;
    PLAMO_LANGUAGES.forEach(lang => {
      const opt = document.createElement('option');
      opt.value = lang.code;
      opt.textContent = getLanguageDisplayName(lang.code, currentUiLang);
      sourceLangSelect.appendChild(opt);
    });

    // Populate Target (53 languages)
    targetLangSelect.innerHTML = '';
    PLAMO_LANGUAGES.forEach(lang => {
      const opt = document.createElement('option');
      opt.value = lang.code;
      opt.textContent = getLanguageDisplayName(lang.code, currentUiLang);
      targetLangSelect.appendChild(opt);
    });

    sourceLangSelect.value = curSrc;
    targetLangSelect.value = curTgt;
  }

  // -------------------------------------------------------------
  // 3. Load & Apply Settings
  // -------------------------------------------------------------
  async function loadSettings() {
    const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
    currentSettings = { ...DEFAULT_SETTINGS, ...stored };

    // Apply UI language first
    settingUiLang.value = currentSettings.uiLang || 'auto';
    applyUiLanguage(currentSettings.uiLang);

    // Apply to Main Controls
    sourceLangSelect.value = currentSettings.sourceLang || 'auto';
    targetLangSelect.value = currentSettings.targetLang || 'ja';
    formSelect.value = currentSettings.form || 'none';
    contextInput.value = currentSettings.context || '';
    glossaryInput.value = currentSettings.glossaryText || '';

    // Apply to Settings Panel
    const engineMode = currentSettings.engineMode || 'lmstudio';
    applyEngineModeVisibility(engineMode);
    settingBaseUrl.value = currentSettings.baseUrl || 'http://localhost:1234';
    settingApiMode.value = currentSettings.apiMode || 'completions';
    if (settingWllamaWebGpu) {
      settingWllamaWebGpu.checked = currentSettings.wllamaUseWebGpu !== false;
    }
    populateWllamaPresets();
    settingSelectionMode.value = currentSettings.selectionMode || 'button';
    if (settingInlineDisplayMode) {
      settingInlineDisplayMode.value = currentSettings.inlineDisplayMode || 'window';
    }
    if (settingImageHoverBtn) {
      settingImageHoverBtn.checked = currentSettings.enableImageHoverButton !== false;
    }
    if (settingOcrEngine) {
      settingOcrEngine.value = currentSettings.ocrEngine || 'ndlocr';
    }
    settingAutoSwitchJaEn.checked = !!currentSettings.autoSwitchJaEn;
    settingTemperature.value = currentSettings.temperature !== undefined ? currentSettings.temperature : 0;
    settingMaxTokens.value = currentSettings.maxTokens || 1024;

    updateFormGroupVisibility();
  }

  function formatMB(bytes) {
    if (!bytes || bytes <= 0) return '0 MB';
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function renderWllamaState(state, cachedModels = []) {
    if (!state) return;
    const isWllamaMode = (currentSettings.engineMode || 'lmstudio') === 'wllama';
    const selectedUrl = getSelectedWllamaModelUrl();
    const cachedEntry = Array.isArray(cachedModels)
      ? cachedModels.find(m => m.url === selectedUrl)
      : null;

    if (state.status === 'downloading' || state.status === 'loading') {
      const pct = state.percent || 0;
      wllamaProgressWrap.style.display = 'block';
      wllamaProgressBar.style.width = `${pct}%`;
      const phaseLabel = state.status === 'downloading'
        ? (currentUiLang === 'en' ? 'Downloading' : 'ダウンロード中')
        : (currentUiLang === 'en' ? 'Initializing WASM/WebGPU' : 'メモリへ展開中');
      const sizeStr = state.total > 0 ? ` (${formatMB(state.loaded)} / ${formatMB(state.total)})` : '';
      const msg = `${phaseLabel}: ${pct}%${sizeStr}`;
      wllamaStatusText.textContent = msg;
      if (loadingTextEl && isWllamaMode) {
        loadingTextEl.textContent = msg;
      }
      if (isWllamaMode) {
        connectionDot.className = 'status-dot connected';
        connectionStatus.textContent = `${phaseLabel} ${pct}%`;
      }
    } else if (state.status === 'ready') {
      wllamaProgressWrap.style.display = 'none';
      wllamaProgressBar.style.width = '100%';
      const backendLabel = state.backend || 'WASM';
      wllamaStatusText.textContent = currentUiLang === 'en'
        ? `✓ Loaded in browser (${backendLabel})`
        : `✓ ブラウザ内にロード完了 (${backendLabel})`;
      if (loadingTextEl) {
        loadingTextEl.textContent = PlamoI18n.t('loadingText', {}, currentUiLang);
      }
      if (isWllamaMode) {
        connectionDot.className = 'status-dot connected';
        connectionStatus.textContent = `Wllama 0.8B (${backendLabel})`;
      }
    } else if (state.status === 'error') {
      wllamaProgressWrap.style.display = 'none';
      wllamaStatusText.textContent = `⚠️ ${state.error || 'Error'}`;
      if (isWllamaMode) {
        connectionDot.className = 'status-dot disconnected';
        connectionStatus.textContent = currentUiLang === 'en' ? 'Wllama Error' : 'Wllama エラー';
      }
    } else {
      wllamaProgressWrap.style.display = 'none';
      if (cachedEntry && cachedEntry.size > 0) {
        wllamaStatusText.textContent = currentUiLang === 'en'
          ? `📦 Cached in OPFS (${formatMB(cachedEntry.size)}) - Ready to load`
          : `📦 OPFSキャッシュ済 (${formatMB(cachedEntry.size)}) - 即時ロード可能`;
      } else {
        wllamaStatusText.textContent = PlamoI18n.t('wllamaStatusIdle', {}, currentUiLang);
      }
      if (isWllamaMode) {
        connectionDot.className = 'status-dot connected';
        connectionStatus.textContent = cachedEntry
          ? (currentUiLang === 'en' ? 'Wllama 0.8B (Cached)' : 'Wllama 0.8B (キャッシュ済)')
          : (currentUiLang === 'en' ? 'Wllama 0.8B (Standby)' : 'Wllama 0.8B (待機中)');
      }
    }
  }

  async function refreshWllamaStatus() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'WLLAMA_GET_STATUS' });
      if (res && res.ok) {
        renderWllamaState(res.state, res.cachedModels || []);
      }
    } catch (err) {
      console.warn('Could not query Wllama status:', err);
    }
  }

  function updateFormGroupVisibility() {
    const isJapanese = targetLangSelect.value === 'ja';
    formGroup.style.display = isJapanese ? 'flex' : 'none';
  }

  // -------------------------------------------------------------
  // 4. Connection & Model Management
  // -------------------------------------------------------------
  async function checkConnection(quiet = false) {
    if (!quiet) {
      connectionStatus.textContent = currentUiLang === 'en' ? 'Checking...' : '接続確認中...';
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'TEST_CONNECTION',
        baseUrl: settingBaseUrl.value.trim()
      });

      if (response && response.ok) {
        connectionDot.className = 'status-dot connected';
        connectionStatus.textContent = currentUiLang === 'en' ? 'LM Studio Connected' : 'LM Studio 接続中';
        updateModelOptions(response.models);
        return true;
      } else {
        connectionDot.className = 'status-dot disconnected';
        connectionStatus.textContent = PlamoI18n.t('statusDisconnected', {}, currentUiLang);
        if (!quiet) {
          const failMsg = currentUiLang === 'en'
            ? `Connection Failed: ${response ? response.error : 'No response from LM Studio'}\nURL: ${settingBaseUrl.value}`
            : `接続失敗: ${response ? response.error : 'LM Studio に応答がありません'}\nURL: ${settingBaseUrl.value}`;
          alert(failMsg);
        }
        return false;
      }
    } catch (err) {
      connectionDot.className = 'status-dot disconnected';
      connectionStatus.textContent = PlamoI18n.t('statusDisconnected', {}, currentUiLang);
      if (!quiet) {
        alert(`${currentUiLang === 'en' ? 'Connection Error' : '接続エラー'}: ${err.message}`);
      }
      return false;
    }
  }

  function updateModelOptions(models = []) {
    const autoLabel = PlamoI18n.t('optModelAuto', {}, currentUiLang);
    settingModel.innerHTML = `<option value="">${autoLabel}</option>`;

    let foundCurrent = false;
    models.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      if (m === currentSettings.model) {
        opt.selected = true;
        foundCurrent = true;
      }
      settingModel.appendChild(opt);
    });

    // Custom option
    const customOpt = document.createElement('option');
    customOpt.value = '__custom__';
    customOpt.textContent = currentUiLang === 'en' ? '✎ Custom model...' : '✎ 手動入力...';
    settingModel.appendChild(customOpt);

    if (currentSettings.model && !foundCurrent) {
      customOpt.selected = true;
      settingModelCustom.style.display = 'block';
      settingModelCustom.value = currentSettings.model;
    } else {
      settingModelCustom.style.display = 'none';
    }
  }

  // -------------------------------------------------------------
  // 5. Translation Logic
  // -------------------------------------------------------------
  async function performTranslation() {
    const text = inputText.value.trim();
    if (!text) {
      inputText.focus();
      return;
    }

    // Set UI to loading state
    outputPlaceholder.style.display = 'none';
    outputError.style.display = 'none';
    outputText.style.display = 'none';
    outputLoading.style.display = 'flex';
    effectiveTargetBadge.style.display = 'none';
    modelUsedBadge.style.display = 'none';
    btnTranslate.disabled = true;

    const sourceLang = sourceLangSelect.value;
    const targetLang = targetLangSelect.value;
    const form = formSelect.value;
    const context = contextInput.value.trim();
    const glossaryText = glossaryInput.value.trim();

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'TRANSLATE_TEXT',
        text,
        sourceLang,
        targetLang,
        form,
        context,
        glossaryText
      });

      outputLoading.style.display = 'none';
      btnTranslate.disabled = false;

      if (response && response.ok) {
        outputText.textContent = response.translatedText || (currentUiLang === 'en' ? '(Empty translation)' : '（翻訳結果が空です）');
        outputText.style.display = 'block';

        // Badges
        const isSwitched = Boolean(response.autoSwitched);
        effectiveTargetBadge.textContent = isSwitched
          ? (currentUiLang === 'en' ? `Auto: ${response.effectiveTargetLang.toUpperCase()}` : `自動切替: ${response.effectiveTargetLang.toUpperCase()}`)
          : (response.effectiveTargetLang || targetLang).toUpperCase();
        effectiveTargetBadge.style.display = 'inline-flex';

        if (response.modelUsed) {
          modelUsedBadge.textContent = response.modelUsed;
          modelUsedBadge.style.display = 'inline-flex';
        }

        // Prompt Preview
        if (response.prompt) {
          promptPreview.textContent = response.prompt;
          promptDetails.style.display = 'block';
        }
      } else {
        const defaultErr = currentUiLang === 'en' ? 'No response from translation service' : '翻訳サービスから応答がありませんでした';
        outputErrorText.textContent = response ? response.error : defaultErr;
        outputError.style.display = 'block';
      }
    } catch (err) {
      outputLoading.style.display = 'none';
      btnTranslate.disabled = false;
      outputErrorText.textContent = err.message || String(err);
      outputError.style.display = 'block';
    }
  }

  // -------------------------------------------------------------
  // 6. Event Handlers
  // -------------------------------------------------------------

  // Input Character Count & Auto Shortcut
  inputText.addEventListener('input', updateCharCount);

  inputText.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      performTranslation();
    }
  });

  btnClearInput.addEventListener('click', () => {
    inputText.value = '';
    updateCharCount();
    inputText.focus();
  });

  btnTranslate.addEventListener('click', performTranslation);

  // Swap Languages
  btnSwapLang.addEventListener('click', () => {
    let src = sourceLangSelect.value;
    let tgt = targetLangSelect.value;

    if (src === 'auto') {
      src = (tgt === 'ja' || tgt === 'ja-easy') ? 'en' : 'ja';
    }

    sourceLangSelect.value = tgt;
    targetLangSelect.value = src;
    updateFormGroupVisibility();

    // If there is translated text, put it back into input and retranslate
    const currentOut = outputText.textContent.trim();
    if (currentOut && outputText.style.display !== 'none') {
      inputText.value = currentOut;
      updateCharCount();
      performTranslation();
    }
  });

  targetLangSelect.addEventListener('change', updateFormGroupVisibility);

  // Copy Output
  btnCopyOutput.addEventListener('click', async () => {
    const textToCopy = outputText.textContent;
    if (!textToCopy) return;

    try {
      await navigator.clipboard.writeText(textToCopy);
      const originalText = btnCopyOutput.textContent;
      btnCopyOutput.textContent = PlamoI18n.t('btnCopySuccess', {}, currentUiLang);
      setTimeout(() => {
        btnCopyOutput.textContent = originalText;
      }, 1800);
    } catch (err) {
      console.warn('Failed to copy text:', err);
    }
  });

  btnClearOutput.addEventListener('click', () => {
    outputText.textContent = '';
    outputText.style.display = 'none';
    outputPlaceholder.style.display = 'block';
    effectiveTargetBadge.style.display = 'none';
    modelUsedBadge.style.display = 'none';
    promptDetails.style.display = 'none';
  });

  // Open in New Full Tab
  btnOpenTab.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
  });

  // Grab selection from active tab
  btnGrabSelection.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) return;

      const [injection] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.getSelection().toString()
      });

      if (injection && injection.result && injection.result.trim()) {
        inputText.value = injection.result.trim();
        updateCharCount();
        performTranslation();
      } else {
        alert(currentUiLang === 'en' ? 'No text selected on current web page.' : '閲覧中のページでテキストが選択されていません。');
      }
    } catch (err) {
      alert(`${currentUiLang === 'en' ? 'Failed to grab selected text' : '選択テキストを取得できませんでした'}: ${err.message}`);
    }
  });

  // Page Translation Toggle
  btnPageTranslate.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) return;

      await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PAGE_TRANSLATION' });
      window.close(); // Close popup so user sees the page translation immediately
    } catch (err) {
      alert(`${currentUiLang === 'en' ? 'Could not start page translation' : 'ページ翻訳を開始できませんでした'}: ${err.message}\n(May be restricted on chrome:// URLs)`);
    }
  });

  // Area OCR Drag Selection Translation (keep sidebar open so user can manage OCR flow)
  if (btnAreaOcrTranslate) {
    btnAreaOcrTranslate.addEventListener('click', async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) return;

        await chrome.tabs.sendMessage(tab.id, { type: 'START_AREA_OCR_TRANSLATION' });
      } catch (err) {
        alert(`${currentUiLang === 'en' ? 'Could not start area OCR translation' : '範囲選択OCR翻訳を開始できませんでした'}: ${err.message}\n(May be restricted on chrome:// URLs)`);
      }
    });
  }

  // Settings Panel Toggle (displays at top below header)
  btnToggleSettings.addEventListener('click', () => {
    const isHidden = settingsPanel.style.display === 'none';
    settingsPanel.style.display = isHidden ? 'block' : 'none';
    btnToggleSettings.setAttribute('aria-expanded', String(isHidden));
    if (isHidden) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  btnCloseSettings.addEventListener('click', () => {
    settingsPanel.style.display = 'none';
    btnToggleSettings.setAttribute('aria-expanded', 'false');
  });

  btnTestConnection.addEventListener('click', () => checkConnection(false));

  settingModel.addEventListener('change', () => {
    settingModelCustom.style.display = settingModel.value === '__custom__' ? 'block' : 'none';
  });

  if (settingWllamaModel) {
    settingWllamaModel.addEventListener('change', () => {
      settingWllamaModelCustom.style.display = settingWllamaModel.value === '__custom__' ? 'block' : 'none';
      refreshWllamaStatus();
    });
  }

  async function switchEngineMode(newMode) {
    const mode = newMode === 'wllama' ? 'wllama' : 'lmstudio';
    currentSettings.engineMode = mode;
    applyEngineModeVisibility(mode);
    await chrome.storage.local.set({ engineMode: mode });
    if (mode === 'wllama') {
      await refreshWllamaStatus();
    } else {
      await checkConnection(true);
    }
  }

  if (btnModeLmStudio) {
    btnModeLmStudio.addEventListener('click', () => switchEngineMode('lmstudio'));
  }
  if (btnModeWllama) {
    btnModeWllama.addEventListener('click', () => switchEngineMode('wllama'));
  }
  if (settingEngineMode) {
    settingEngineMode.addEventListener('change', () => switchEngineMode(settingEngineMode.value));
  }

  if (btnWllamaLoad) {
    btnWllamaLoad.addEventListener('click', async () => {
      const modelUrl = getSelectedWllamaModelUrl();
      const useWebGpu = settingWllamaWebGpu ? settingWllamaWebGpu.checked : true;
      btnWllamaLoad.disabled = true;
      try {
        await chrome.storage.local.set({
          wllamaModelUrl: modelUrl,
          wllamaUseWebGpu: useWebGpu
        });
        currentSettings.wllamaModelUrl = modelUrl;
        currentSettings.wllamaUseWebGpu = useWebGpu;
        const res = await chrome.runtime.sendMessage({
          type: 'WLLAMA_LOAD_MODEL',
          modelUrl,
          useWebGpu
        });
        if (res && res.ok) {
          await refreshWllamaStatus();
        } else if (res && res.error) {
          wllamaStatusText.textContent = `⚠️ ${res.error}`;
        }
      } catch (err) {
        wllamaStatusText.textContent = `⚠️ ${err.message}`;
      } finally {
        btnWllamaLoad.disabled = false;
      }
    });
  }

  if (btnWllamaUnload) {
    btnWllamaUnload.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'WLLAMA_UNLOAD_MODEL' });
      await refreshWllamaStatus();
    });
  }

  if (btnWllamaClearCache) {
    btnWllamaClearCache.addEventListener('click', async () => {
      const confirmMsg = currentUiLang === 'en'
        ? 'Clear cached GGUF models from browser OPFS storage?'
        : 'ブラウザ (OPFS) にキャッシュされた GGUF モデルを削除しますか？';
      if (!confirm(confirmMsg)) return;
      await chrome.runtime.sendMessage({ type: 'WLLAMA_CLEAR_CACHE' });
      await refreshWllamaStatus();
    });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'WLLAMA_PROGRESS' && message.state) {
      renderWllamaState(message.state);
    }
  });

  // UI Language Switch Handler
  settingUiLang.addEventListener('change', () => {
    applyUiLanguage(settingUiLang.value);
  });

  // Save Settings
  btnSaveSettings.addEventListener('click', async () => {
    let chosenModel = settingModel.value;
    if (chosenModel === '__custom__') {
      chosenModel = settingModelCustom.value.trim();
    }

    const chosenEngineMode = settingEngineMode ? settingEngineMode.value : (currentSettings.engineMode || 'lmstudio');
    const chosenWllamaUrl = getSelectedWllamaModelUrl();
    const chosenWllamaWebGpu = settingWllamaWebGpu ? settingWllamaWebGpu.checked : true;

    const updated = {
      uiLang: settingUiLang.value,
      engineMode: chosenEngineMode,
      baseUrl: settingBaseUrl.value.trim(),
      model: chosenModel,
      apiMode: settingApiMode.value,
      wllamaModelUrl: chosenWllamaUrl,
      wllamaUseWebGpu: chosenWllamaWebGpu,
      selectionMode: settingSelectionMode.value,
      inlineDisplayMode: settingInlineDisplayMode ? settingInlineDisplayMode.value : 'window',
      enableImageHoverButton: settingImageHoverBtn ? settingImageHoverBtn.checked : true,
      ocrEngine: settingOcrEngine ? settingOcrEngine.value : (currentSettings.ocrEngine || 'ndlocr'),
      autoSwitchJaEn: settingAutoSwitchJaEn.checked,
      temperature: parseFloat(settingTemperature.value) || 0,
      maxTokens: parseInt(settingMaxTokens.value, 10) || 1024,
      sourceLang: sourceLangSelect.value,
      targetLang: targetLangSelect.value,
      form: formSelect.value,
      context: contextInput.value.trim(),
      glossaryText: glossaryInput.value.trim()
    };

    await chrome.storage.local.set(updated);
    currentSettings = { ...currentSettings, ...updated };
    applyEngineModeVisibility(chosenEngineMode);

    settingsSaveStatus.textContent = PlamoI18n.t('saveStatusSuccess', {}, currentUiLang);
    settingsSaveStatus.style.display = 'inline';
    setTimeout(() => {
      settingsSaveStatus.style.display = 'none';
    }, 2000);

    if (chosenEngineMode === 'wllama') {
      refreshWllamaStatus();
    } else {
      checkConnection(true);
    }
  });

  // -------------------------------------------------------------
  // Side Panel Auto-Translate Receiver
  // -------------------------------------------------------------
  async function checkPendingSidebarText() {
    try {
      const data = await chrome.storage.local.get(['pendingSidebarText', 'pendingSidebarTimestamp']);
      if (data.pendingSidebarText && (Date.now() - (data.pendingSidebarTimestamp || 0) < 10000)) {
        await chrome.storage.local.remove(['pendingSidebarText', 'pendingSidebarTimestamp']);
        inputText.value = data.pendingSidebarText;
        updateCharCount();
        performTranslation();
      }
    } catch { }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'PLAMO_SIDE_PANEL_AUTO_TRANSLATE' && message.text) {
      inputText.value = message.text;
      updateCharCount();
      performTranslation();
    } else if (message && (message.type === 'WLLAMA_STREAM_CHUNK' || message.type === 'PLAMO_STREAM_CHUNK')) {
      if (message.currentText) {
        outputPlaceholder.style.display = 'none';
        outputLoading.style.display = 'none';
        outputText.style.display = 'block';
        outputText.textContent = message.currentText;
      }
    }
  });

  // -------------------------------------------------------------
  // Startup
  // -------------------------------------------------------------
  await loadSettings();
  if ((currentSettings.engineMode || 'lmstudio') === 'wllama') {
    refreshWllamaStatus();
  } else {
    checkConnection(true); // Silent connection check on popup open
  }
  await checkPendingSidebarText();
});
