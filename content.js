/**
 * PLaMo Translate - Content Script
 * Implements selection floating button, translation popover card,
 * context menu trigger, and whole-page paragraph translation.
 */

(() => {
  // Guard against multiple injections
  if (window.__plamoTranslateInjected) return;
  window.__plamoTranslateInjected = true;

  // Active state
  let currentSettings = { ...DEFAULT_SETTINGS };
  let floatingTriggerEl = null;
  let popoverCardEl = null;
  let pageBarEl = null;
  let lastSelectionData = null;
  let isPageTranslationActive = false;
  let isPageTranslationPaused = false;
  let pageTranslationAbortController = null;

  // Initialize Settings
  chrome.storage.local.get(DEFAULT_SETTINGS, (stored) => {
    if (stored) {
      currentSettings = { ...DEFAULT_SETTINGS, ...stored };
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      for (const [key, change] of Object.entries(changes)) {
        currentSettings[key] = change.newValue;
      }
    }
  });

  // i18n Translation Helper
  function t(key, params = {}) {
    const lang = (typeof PlamoI18n !== 'undefined' && PlamoI18n.resolveUiLang)
      ? PlamoI18n.resolveUiLang(currentSettings.uiLang)
      : 'ja';
    return (typeof PlamoI18n !== 'undefined' && PlamoI18n.t)
      ? PlamoI18n.t(key, params, lang)
      : key;
  }

  // -------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------
  function removeElement(el) {
    if (el && el.parentNode) {
      el.parentNode.removeChild(el);
    }
  }

  function getActiveSelection() {
    const activeEl = document.activeElement;
    const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');

    if (isInput) {
      const start = activeEl.selectionStart;
      const end = activeEl.selectionEnd;
      if (typeof start === 'number' && typeof end === 'number' && end > start) {
        const text = activeEl.value.substring(start, end).trim();
        const rect = activeEl.getBoundingClientRect();
        return {
          text,
          rect,
          isEditable: true,
          inputElement: activeEl,
          selectionStart: start,
          selectionEnd: end
        };
      }
    }

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return null;

    const text = selection.toString().trim();
    if (!text || text.length < 1 || text.length > 8000) return null;

    try {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const isEditable = !!(selection.anchorNode && selection.anchorNode.parentElement && selection.anchorNode.parentElement.closest('[contenteditable="true"]'));

      return {
        text,
        rect,
        range: range.cloneRange(),
        isEditable,
        editableContainer: isEditable ? selection.anchorNode.parentElement.closest('[contenteditable="true"]') : null
      };
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------
  // Floating Trigger Button
  // -------------------------------------------------------------
  function showFloatingTrigger(selectionData) {
    removeFloatingTrigger();
    if (currentSettings.selectionMode === 'off') return;

    const rect = selectionData.rect;
    if (!rect || (rect.width === 0 && rect.height === 0)) return;

    floatingTriggerEl = document.createElement('div');
    floatingTriggerEl.className = 'plamo-ext-floating-trigger';
    floatingTriggerEl.setAttribute('role', 'button');
    floatingTriggerEl.setAttribute('title', t('floatingTriggerTitle'));
    floatingTriggerEl.innerHTML = `
      <span class="plamo-ext-trigger-icon">🌐</span>
      <span class="plamo-ext-trigger-label">PLaMo</span>
    `;

    // Position near the selection
    const top = window.scrollY + rect.bottom + 6;
    let left = window.scrollX + rect.right - 20;

    // Boundary check
    if (left + 80 > window.innerWidth) {
      left = window.innerWidth - 90;
    }
    if (left < 10) left = 10;

    floatingTriggerEl.style.top = `${top}px`;
    floatingTriggerEl.style.left = `${left}px`;

    floatingTriggerEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    floatingTriggerEl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      removeFloatingTrigger();
      openPopoverCard(selectionData);
    });

    document.body.appendChild(floatingTriggerEl);
  }

  function removeFloatingTrigger() {
    if (floatingTriggerEl) {
      removeElement(floatingTriggerEl);
      floatingTriggerEl = null;
    }
  }

  // -------------------------------------------------------------
  // Floating Translation Popover Card
  // -------------------------------------------------------------
  function openPopoverCard(selectionData, overrideOptions = {}) {
    removeFloatingTrigger();
    removePopoverCard();

    lastSelectionData = selectionData;
    const text = selectionData.text;
    const rect = selectionData.rect;

    popoverCardEl = document.createElement('div');
    popoverCardEl.className = 'plamo-ext-popover-card';

    // Build Languages options
    const targetLang = overrideOptions.targetLang || currentSettings.targetLang || 'ja';
    const form = overrideOptions.form || currentSettings.form || 'none';
    const uiLang = (typeof PlamoI18n !== 'undefined' && PlamoI18n.resolveUiLang)
      ? PlamoI18n.resolveUiLang(currentSettings.uiLang)
      : 'ja';

    const langOptionsHtml = PLAMO_LANGUAGES.map(lang => {
      const selected = lang.code === targetLang ? 'selected' : '';
      const label = (typeof getLanguageDisplayName === 'function')
        ? getLanguageDisplayName(lang.code, uiLang)
        : `${lang.name} (${lang.code})`;
      return `<option value="${lang.code}" ${selected}>${label}</option>`;
    }).join('');

    popoverCardEl.innerHTML = `
      <div class="plamo-ext-card-header">
        <div class="plamo-ext-header-brand">
          <span class="plamo-ext-brand-icon">🌐</span>
          <span class="plamo-ext-brand-name">PLaMo</span>
        </div>
        <div class="plamo-ext-header-controls">
          <select class="plamo-ext-select plamo-ext-card-target-lang" title="${t('cardTargetLangTitle')}">
            ${langOptionsHtml}
          </select>
          <select class="plamo-ext-select plamo-ext-card-form" title="${t('formTitleTooltip')}" style="${targetLang === 'ja' ? '' : 'display:none;'}">
            <option value="none" ${form === 'none' ? 'selected' : ''}>${t('formNoneShort')}</option>
            <option value="polite" ${form === 'polite' ? 'selected' : ''}>${t('formPoliteShort')}</option>
            <option value="plain" ${form === 'plain' ? 'selected' : ''}>${t('formPlainShort')}</option>
          </select>
        </div>
      </div>
      <div class="plamo-ext-card-body">
        <div class="plamo-ext-loading">
          <div class="plamo-ext-spinner"></div>
          <span>${t('cardTranslating')}</span>
        </div>
      </div>
      <div class="plamo-ext-card-footer">
        <span class="plamo-ext-card-status" style="font-size:11px; color:#64748b;">LM Studio</span>
        <div class="plamo-ext-footer-actions">
          ${selectionData.isEditable ? `<button class="plamo-ext-btn plamo-ext-card-replace">${t('btnReplace')}</button>` : ''}
          <button class="plamo-ext-btn plamo-ext-card-reload" title="${t('btnReload')}">${t('btnReload')}</button>
          <button class="plamo-ext-btn plamo-ext-btn-primary plamo-ext-card-copy">${t('btnCopy')}</button>
        </div>
      </div>
    `;

    // Position Card near selection
    let cardTop = window.scrollY + rect.bottom + 8;
    let cardLeft = window.scrollX + rect.left;

    // Check bottom overflow
    const estimatedHeight = 220;
    if (rect.bottom + estimatedHeight > window.innerHeight && rect.top > estimatedHeight) {
      cardTop = window.scrollY + rect.top - estimatedHeight - 8;
    }

    // Check right overflow & clamp to viewport
    const cardWidth = 400;
    const maxLeft = window.scrollX + window.innerWidth - cardWidth - 16;
    if (cardLeft > maxLeft) {
      cardLeft = maxLeft;
    }
    if (cardLeft < window.scrollX + 10) {
      cardLeft = window.scrollX + 10;
    }

    popoverCardEl.style.top = `${cardTop}px`;
    popoverCardEl.style.left = `${cardLeft}px`;

    // Prevent selection events inside card from bubbling
    popoverCardEl.addEventListener('mousedown', (e) => e.stopPropagation());
    popoverCardEl.addEventListener('mouseup', (e) => e.stopPropagation());

    // Wire events
    const targetSelect = popoverCardEl.querySelector('.plamo-ext-card-target-lang');
    const formSelect = popoverCardEl.querySelector('.plamo-ext-card-form');
    const reloadBtn = popoverCardEl.querySelector('.plamo-ext-card-reload');
    const copyBtn = popoverCardEl.querySelector('.plamo-ext-card-copy');
    const replaceBtn = popoverCardEl.querySelector('.plamo-ext-card-replace');

    targetSelect.addEventListener('change', () => {
      formSelect.style.display = targetSelect.value === 'ja' ? '' : 'none';
      triggerPopoverTranslate(text, targetSelect.value, formSelect.value);
    });

    formSelect.addEventListener('change', () => {
      triggerPopoverTranslate(text, targetSelect.value, formSelect.value);
    });

    reloadBtn.addEventListener('click', () => {
      triggerPopoverTranslate(text, targetSelect.value, formSelect.value);
    });

    document.body.appendChild(popoverCardEl);

    // Initial Translation Trigger
    triggerPopoverTranslate(text, targetLang, form);
  }

  function removePopoverCard() {
    if (popoverCardEl) {
      removeElement(popoverCardEl);
      popoverCardEl = null;
    }
  }

  async function triggerPopoverTranslate(text, targetLang, form) {
    if (!popoverCardEl) return;
    const bodyEl = popoverCardEl.querySelector('.plamo-ext-card-body');
    const copyBtn = popoverCardEl.querySelector('.plamo-ext-card-copy');
    const replaceBtn = popoverCardEl.querySelector('.plamo-ext-card-replace');
    const statusEl = popoverCardEl.querySelector('.plamo-ext-card-status');

    bodyEl.innerHTML = `
      <div class="plamo-ext-loading">
        <div class="plamo-ext-spinner"></div>
        <span>${t('cardTranslating')}</span>
      </div>
    `;

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'TRANSLATE_TEXT',
        text,
        targetLang,
        form
      });

      if (!popoverCardEl) return;

      if (response && response.ok) {
        const translated = response.translatedText || t('outputPlaceholder');
        const autoSwitched = response.effectiveTargetLang && response.effectiveTargetLang !== targetLang;

        let autoNoticeHtml = '';
        if (autoSwitched) {
          autoNoticeHtml = `<div class="plamo-ext-auto-badge">${t('autoSwitchedBadge')}</div>`;
        }

        bodyEl.innerHTML = `
          ${autoNoticeHtml}
          <div class="plamo-ext-result-content" style="white-space: pre-wrap;">${escapeHtml(translated)}</div>
          <details class="plamo-ext-source-details">
            <summary>${t('showSource', { n: text.length })}</summary>
            <div class="plamo-ext-source-text">${escapeHtml(text)}</div>
          </details>
        `;

        if (statusEl) {
          statusEl.textContent = `${response.modelUsed || 'PLaMo'} (${response.apiModeUsed || 'completions'})`;
        }

        // Copy button action
        copyBtn.onclick = async () => {
          try {
            await navigator.clipboard.writeText(translated);
            const origText = copyBtn.innerHTML;
            copyBtn.innerHTML = t('btnCopySuccess');
            copyBtn.classList.add('plamo-ext-btn-success');
            setTimeout(() => {
              if (copyBtn) {
                copyBtn.innerHTML = origText;
                copyBtn.classList.remove('plamo-ext-btn-success');
              }
            }, 2000);
          } catch (err) {
            console.warn('Failed to copy to clipboard:', err);
          }
        };

        // Replace button action (if inside editable field)
        if (replaceBtn && lastSelectionData) {
          replaceBtn.onclick = () => {
            handleTextReplacement(lastSelectionData, translated);
            removePopoverCard();
          };
        }
      } else {
        const errorMsg = response ? response.error : '翻訳サービスから応答がありません';
        bodyEl.innerHTML = `
          <div class="plamo-ext-error-msg">
            <strong>翻訳エラー:</strong><br>
            ${escapeHtml(errorMsg)}
            <div style="margin-top: 6px; font-size: 11px; opacity: 0.85;">
              LM Studio (ポート 1234) でサーバーが実行されているか確認してください。
            </div>
          </div>
        `;
      }
    } catch (err) {
      if (!popoverCardEl) return;
      bodyEl.innerHTML = `
        <div class="plamo-ext-error-msg">
          <strong>通信エラー:</strong><br>
          ${escapeHtml(err.message || String(err))}
        </div>
      `;
    }
  }

  function handleTextReplacement(selectionData, newText) {
    if (!selectionData) return;

    if (selectionData.inputElement) {
      const input = selectionData.inputElement;
      const start = selectionData.selectionStart;
      const end = selectionData.selectionEnd;
      const oldVal = input.value;
      input.value = oldVal.substring(0, start) + newText + oldVal.substring(end);
      input.setSelectionRange(start + newText.length, start + newText.length);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.focus();
    } else if (selectionData.range) {
      selectionData.range.deleteContents();
      selectionData.range.insertNode(document.createTextNode(newText));
    }
  }

  function escapeHtml(str) {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // -------------------------------------------------------------
  // Mouse & Selection Event Listeners
  // -------------------------------------------------------------
  document.addEventListener('mouseup', (e) => {
    // If clicking inside our popup card or trigger, don't re-trigger
    if (e.target.closest('.plamo-ext-popover-card') || e.target.closest('.plamo-ext-floating-trigger')) {
      return;
    }

    setTimeout(() => {
      const selData = getActiveSelection();
      if (selData && selData.text.length > 0) {
        if (currentSettings.selectionMode === 'instant') {
          openPopoverCard(selData);
        } else if (currentSettings.selectionMode === 'button') {
          showFloatingTrigger(selData);
        }
      } else {
        removeFloatingTrigger();
      }
    }, 10);
  });

  document.addEventListener('mousedown', (e) => {
    if (floatingTriggerEl && !floatingTriggerEl.contains(e.target)) {
      removeFloatingTrigger();
    }
    if (popoverCardEl && !popoverCardEl.contains(e.target)) {
      removePopoverCard();
    }
  });

  // -------------------------------------------------------------
  // Whole-Page Translation
  // -------------------------------------------------------------
  function findTranslatableElements() {
    const selector = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, td, figcaption';
    const all = Array.from(document.querySelectorAll(selector));

    return all.filter(el => {
      // Ignore elements inside unwanted containers
      if (el.closest('header, nav, footer, script, style, code, pre, noscript, [contenteditable="true"]')) {
        return false;
      }
      // Ignore elements inside extension UI
      if (el.closest('.plamo-ext-popover-card, .plamo-ext-floating-trigger, .plamo-ext-page-bar, .plamo-ext-inline-translation')) {
        return false;
      }
      // Ignore if already marked or has next sibling translation block
      if (el.getAttribute('data-plamo-origin') === 'true') {
        return false;
      }
      const next = el.nextElementSibling;
      if (next && next.classList.contains('plamo-ext-inline-translation')) {
        return false;
      }

      // Check text content length & visibility
      const text = el.innerText ? el.innerText.trim() : '';
      if (text.length < 10) return false;
      // Skip if mostly numbers or symbols
      if (/^[\d\s\p{P}]+$/u.test(text)) return false;

      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
      }

      return true;
    });
  }

  function sortElementsByViewport(elements) {
    const vh = window.innerHeight;
    return elements.sort((a, b) => {
      const rectA = a.getBoundingClientRect();
      const rectB = b.getBoundingClientRect();

      const inViewA = rectA.bottom > 0 && rectA.top < vh;
      const inViewB = rectB.bottom > 0 && rectB.top < vh;

      if (inViewA && !inViewB) return -1;
      if (!inViewA && inViewB) return 1;
      return rectA.top - rectB.top;
    });
  }

  function togglePageTranslation() {
    if (isPageTranslationActive) {
      // Toggle pause / resume
      isPageTranslationPaused = !isPageTranslationPaused;
      updatePageBar();
      return;
    }

    startPageTranslation();
  }

  async function startPageTranslation() {
    const elements = sortElementsByViewport(findTranslatableElements());
    if (elements.length === 0) {
      alert('翻訳可能なテキストブロックが見つかりませんでした。');
      return;
    }

    isPageTranslationActive = true;
    isPageTranslationPaused = false;
    pageTranslationAbortController = new AbortController();

    renderPageBar(elements.length);

    let completedCount = 0;
    const totalCount = elements.length;

    for (let i = 0; i < elements.length; i++) {
      if (!isPageTranslationActive) break;

      // Handle pause loop
      while (isPageTranslationPaused && isPageTranslationActive) {
        await new Promise(r => setTimeout(r, 400));
      }

      if (!isPageTranslationActive) break;

      const el = elements[i];
      const text = el.innerText.trim();
      el.setAttribute('data-plamo-origin', 'true');

      // Create placeholder block
      const inlineEl = document.createElement('div');
      inlineEl.className = 'plamo-ext-inline-translation';
      inlineEl.setAttribute('data-plamo-state', 'translating');
      inlineEl.innerHTML = `
        <span class="plamo-ext-inline-badge">PLaMo 訳</span>
        <span class="plamo-ext-inline-content">翻訳中...</span>
      `;
      el.parentNode.insertBefore(inlineEl, el.nextSibling);

      try {
        const response = await chrome.runtime.sendMessage({
          type: 'TRANSLATE_TEXT',
          text,
          targetLang: currentSettings.targetLang || 'ja',
          form: currentSettings.form || 'none'
        });

        if (!isPageTranslationActive) {
          removeElement(inlineEl);
          break;
        }

        if (response && response.ok) {
          inlineEl.setAttribute('data-plamo-state', 'done');
          const contentEl = inlineEl.querySelector('.plamo-ext-inline-content');
          if (contentEl) {
            contentEl.textContent = response.translatedText;
          }
        } else {
          inlineEl.setAttribute('data-plamo-state', 'error');
          inlineEl.innerHTML = `
            <span class="plamo-ext-inline-badge" style="background:#fee2e2;color:#b91c1c;">エラー</span>
            <span class="plamo-ext-inline-content" style="color:#ef4444;">${escapeHtml(response ? response.error : '応答なし')}</span>
          `;
        }
      } catch (err) {
        if (!isPageTranslationActive) {
          removeElement(inlineEl);
          break;
        }
        inlineEl.setAttribute('data-plamo-state', 'error');
        inlineEl.innerHTML = `
          <span class="plamo-ext-inline-badge" style="background:#fee2e2;color:#b91c1c;">エラー</span>
          <span class="plamo-ext-inline-content" style="color:#ef4444;">${escapeHtml(err.message || String(err))}</span>
        `;
      }

      completedCount++;
      updatePageBar(completedCount, totalCount);

      // Short delay between blocks to avoid overloading LM Studio
      await new Promise(r => setTimeout(r, 60));
    }

    if (isPageTranslationActive) {
      updatePageBar(completedCount, totalCount, true);
    }
  }

  function renderPageBar(total) {
    removePageBar();

    pageBarEl = document.createElement('div');
    pageBarEl.className = 'plamo-ext-page-bar';
    pageBarEl.innerHTML = `
      <span class="plamo-ext-page-title">🌐 PLaMo</span>
      <span class="plamo-ext-page-progress">${t('pageTranslatingProgress', { current: 0, total })}</span>
      <button class="plamo-ext-btn-sm plamo-ext-page-toggle-src" title="${t('btnHideOriginal')}">${t('btnHideOriginal')}</button>
      <button class="plamo-ext-btn-sm plamo-ext-page-pause" title="${t('btnPause')}">${t('btnPause')}</button>
      <button class="plamo-ext-btn-sm plamo-ext-page-restore" title="${t('btnRestore')}">${t('btnRestore')}</button>
    `;

    const toggleSrcBtn = pageBarEl.querySelector('.plamo-ext-page-toggle-src');
    const pauseBtn = pageBarEl.querySelector('.plamo-ext-page-pause');
    const restoreBtn = pageBarEl.querySelector('.plamo-ext-page-restore');

    toggleSrcBtn.addEventListener('click', () => {
      document.body.classList.toggle('plamo-ext-hide-original');
      const isHidden = document.body.classList.contains('plamo-ext-hide-original');
      toggleSrcBtn.textContent = isHidden ? t('btnShowOriginal') : t('btnHideOriginal');
    });

    pauseBtn.addEventListener('click', () => {
      isPageTranslationPaused = !isPageTranslationPaused;
      pauseBtn.textContent = isPageTranslationPaused ? t('btnResume') : t('btnPause');
    });

    restoreBtn.addEventListener('click', () => {
      restorePageTranslation();
    });

    document.body.appendChild(pageBarEl);
  }

  function updatePageBar(current = 0, total = 0, isFinished = false) {
    if (!pageBarEl) return;
    const progressEl = pageBarEl.querySelector('.plamo-ext-page-progress');
    const pauseBtn = pageBarEl.querySelector('.plamo-ext-page-pause');

    if (progressEl) {
      if (isFinished) {
        progressEl.textContent = t('pageTranslationComplete', { total });
      } else {
        progressEl.textContent = t('pageTranslatingProgress', { current, total });
      }
    }

    if (pauseBtn && isFinished) {
      pauseBtn.style.display = 'none';
    }
  }

  function removePageBar() {
    if (pageBarEl) {
      removeElement(pageBarEl);
      pageBarEl = null;
    }
  }

  function restorePageTranslation() {
    isPageTranslationActive = false;
    isPageTranslationPaused = false;
    if (pageTranslationAbortController) {
      pageTranslationAbortController.abort();
      pageTranslationAbortController = null;
    }

    document.body.classList.remove('plamo-ext-hide-original');

    // Remove all injected inline blocks
    const inlines = document.querySelectorAll('.plamo-ext-inline-translation');
    inlines.forEach(el => removeElement(el));

    // Remove origin markers
    const origins = document.querySelectorAll('[data-plamo-origin="true"]');
    origins.forEach(el => el.removeAttribute('data-plamo-origin'));

    removePageBar();
  }

  // -------------------------------------------------------------
  // Listen for Background Commands
  // -------------------------------------------------------------
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) return;

    if (message.type === 'SHOW_INLINE_TRANSLATION') {
      const selData = getActiveSelection() || {
        text: message.text,
        rect: { top: 120, bottom: 160, left: window.innerWidth / 2 - 180, width: 360, height: 40 },
        isEditable: false
      };
      openPopoverCard(selData);
      sendResponse({ ok: true });
    } else if (message.type === 'TOGGLE_PAGE_TRANSLATION') {
      togglePageTranslation();
      sendResponse({ ok: true });
    } else if (message.type === 'RESTORE_PAGE_TRANSLATION') {
      restorePageTranslation();
      sendResponse({ ok: true });
    }
  });

})();
