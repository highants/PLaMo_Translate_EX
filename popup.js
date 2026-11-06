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

  const sourceLangSelect = document.getElementById('sourceLangSelect');
  const targetLangSelect = document.getElementById('targetLangSelect');
  const btnSwapLang = document.getElementById('btnSwapLang');
  const formGroup = document.getElementById('formGroup');
  const formSelect = document.getElementById('formSelect');

  const inputText = document.getElementById('inputText');
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
  const settingBaseUrl = document.getElementById('settingBaseUrl');
  const btnTestConnection = document.getElementById('btnTestConnection');
  const settingModel = document.getElementById('settingModel');
  const settingModelCustom = document.getElementById('settingModelCustom');
  const settingApiMode = document.getElementById('settingApiMode');
  const settingSelectionMode = document.getElementById('settingSelectionMode');
  const settingAutoSwitchJaEn = document.getElementById('settingAutoSwitchJaEn');
  const settingTemperature = document.getElementById('settingTemperature');
  const settingMaxTokens = document.getElementById('settingMaxTokens');
  const btnSaveSettings = document.getElementById('btnSaveSettings');
  const settingsSaveStatus = document.getElementById('settingsSaveStatus');

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
  }

  function updateCharCount() {
    const count = inputText.value.length;
    charCount.textContent = PlamoI18n.t('charCountUnit', { n: count }, currentUiLang);
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
    settingBaseUrl.value = currentSettings.baseUrl || 'http://localhost:1234';
    settingApiMode.value = currentSettings.apiMode || 'completions';
    settingSelectionMode.value = currentSettings.selectionMode || 'button';
    settingAutoSwitchJaEn.checked = !!currentSettings.autoSwitchJaEn;
    settingTemperature.value = currentSettings.temperature !== undefined ? currentSettings.temperature : 0;
    settingMaxTokens.value = currentSettings.maxTokens || 1024;

    updateFormGroupVisibility();
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
        const isSwitched = response.effectiveTargetLang && response.effectiveTargetLang !== targetLang;
        effectiveTargetBadge.textContent = isSwitched
          ? (currentUiLang === 'en' ? `Auto: ${response.effectiveTargetLang.toUpperCase()}` : `自動切替: ${response.effectiveTargetLang.toUpperCase()}`)
          : targetLang.toUpperCase();
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
      src = tgt === 'ja' ? 'en' : 'ja';
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
      console.error('Failed to copy text:', err);
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

  // Settings Panel Toggle
  btnToggleSettings.addEventListener('click', () => {
    const isHidden = settingsPanel.style.display === 'none';
    settingsPanel.style.display = isHidden ? 'block' : 'none';
    if (isHidden) {
      settingsPanel.scrollIntoView({ behavior: 'smooth' });
    }
  });

  btnCloseSettings.addEventListener('click', () => {
    settingsPanel.style.display = 'none';
  });

  btnTestConnection.addEventListener('click', () => checkConnection(false));

  settingModel.addEventListener('change', () => {
    settingModelCustom.style.display = settingModel.value === '__custom__' ? 'block' : 'none';
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

    const updated = {
      uiLang: settingUiLang.value,
      baseUrl: settingBaseUrl.value.trim(),
      model: chosenModel,
      apiMode: settingApiMode.value,
      selectionMode: settingSelectionMode.value,
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

    settingsSaveStatus.textContent = PlamoI18n.t('saveStatusSuccess', {}, currentUiLang);
    settingsSaveStatus.style.display = 'inline';
    setTimeout(() => {
      settingsSaveStatus.style.display = 'none';
    }, 2000);
  });

  // -------------------------------------------------------------
  // Startup
  // -------------------------------------------------------------
  await loadSettings();
  checkConnection(true); // Silent connection check on popup open
});
