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
  let userHasMovedPopover = false;
  let isPageTranslationActive = false;
  let isPageTranslationPaused = false;
  let pageTranslationAbortController = null;
  let hoveredImageEl = null;
  let lastRightClickedImageEl = null;
  let imageHoverBtnEl = null;
  let areaSelectorEl = null;
  const activeOverlayStreamHandlers = new Map();
  const activeImageOverlays = new Set();

  function removeAllImageOverlays() {
    for (const ov of Array.from(activeImageOverlays)) {
      if (typeof ov._cleanup === 'function') {
        ov._cleanup();
      } else {
        removeElement(ov);
        activeImageOverlays.delete(ov);
      }
    }
  }

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
    if (left + 100 > window.scrollX + window.innerWidth) {
      left = window.scrollX + window.innerWidth - 110;
    }
    if (left < window.scrollX + 10) left = window.scrollX + 10;

    floatingTriggerEl.style.top = `${top}px`;
    floatingTriggerEl.style.left = `${left}px`;

    floatingTriggerEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    floatingTriggerEl.addEventListener('mouseup', (e) => {
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
  // Supports Approach A (Native Float Window) & Approach B (In-page OOPIF iframe)
  // -------------------------------------------------------------
  function openPopoverCard(selectionData) {
    removeFloatingTrigger();
    removePopoverCard();
    lastSelectionData = selectionData;

    const displayMode = currentSettings.inlineDisplayMode || 'window';
    if (displayMode === 'iframe') {
      openIframePopover(selectionData);
    } else {
      openFloatWindow(selectionData);
    }
  }

  function openFloatWindow(selectionData) {
    const text = selectionData.text;
    const rect = selectionData.rect || { top: 120, bottom: 160, left: 200, width: 400, height: 40 };

    // Calculate approximate screen coordinates based on browser window and selection
    const titleBarOffset = Math.max(0, (window.outerHeight - window.innerHeight));
    const screenX = Math.round(window.screenX + (rect.left || 100));
    const screenY = Math.round(window.screenY + titleBarOffset + (rect.bottom || 100) + 8);

    chrome.runtime.sendMessage({
      type: 'OPEN_FLOAT_WINDOW',
      text,
      isEditable: Boolean(selectionData.isEditable),
      screenX,
      screenY
    }).catch(err => {
      console.warn('[PLaMo Content] Failed to open float window, falling back to iframe:', err);
      openIframePopover(selectionData);
    });
  }

  function openIframePopover(selectionData) {
    const text = selectionData.text;
    const rect = selectionData.rect || { top: 120, bottom: 160, left: window.innerWidth / 2 - 200, width: 400, height: 40 };

    popoverCardEl = document.createElement('iframe');
    popoverCardEl.className = 'plamo-ext-popover-iframe';
    popoverCardEl.setAttribute('allow', 'clipboard-write');
    popoverCardEl.tabIndex = 0;

    const payload = {
      text,
      isEditable: Boolean(selectionData.isEditable),
      isWindowMode: false
    };
    popoverCardEl.src = chrome.runtime.getURL('popover.html') + '#' + encodeURIComponent(JSON.stringify(payload));

    // Position Card near selection
    let cardTop = window.scrollY + rect.bottom + 8;
    let cardLeft = window.scrollX + rect.left;

    // Check bottom overflow
    const estimatedHeight = 180;
    if (rect.bottom + estimatedHeight > window.innerHeight && rect.top > estimatedHeight) {
      cardTop = window.scrollY + rect.top - estimatedHeight - 8;
    }

    // Check right overflow & clamp to viewport
    const cardWidth = Math.max(300, Math.min(window.innerWidth - 30, currentSettings.popoverCustomWidth || 440));
    const customHeight = currentSettings.popoverCustomHeight ? Math.max(140, Math.min(window.innerHeight - 30, currentSettings.popoverCustomHeight)) : 0;
    const maxLeft = window.scrollX + window.innerWidth - cardWidth - 16;
    if (cardLeft > maxLeft) {
      cardLeft = maxLeft;
    }
    if (cardLeft < window.scrollX + 10) {
      cardLeft = window.scrollX + 10;
    }

    popoverCardEl.style.top = `${cardTop}px`;
    popoverCardEl.style.left = `${cardLeft}px`;
    popoverCardEl.style.width = `${cardWidth}px`;
    if (customHeight > 0) {
      popoverCardEl.style.height = `${customHeight}px`;
    }

    // Prevent selection events inside card from bubbling
    popoverCardEl.addEventListener('mousedown', (e) => e.stopPropagation());

    // Auto-focus the iframe on load to promote extension process to foreground in Chromium (Approach C)
    popoverCardEl.addEventListener('load', () => {
      try {
        popoverCardEl.focus();
      } catch { }
    });

    document.body.appendChild(popoverCardEl);
    try {
      popoverCardEl.focus();
    } catch { }
  }

  function removePopoverCard() {
    if (popoverCardEl) {
      removeElement(popoverCardEl);
      popoverCardEl = null;
    }
    userHasMovedPopover = false;
  }

  // Listen for messages from popover.html iframe
  window.addEventListener('message', (e) => {
    if (!e.data || typeof e.data !== 'object') return;
    if (e.data.type === 'PLAMO_RESIZE') {
      if (popoverCardEl && typeof e.data.height === 'number') {
        const newHeight = e.data.height;
        popoverCardEl.style.height = `${newHeight}px`;

        // Adjust top position if height expansion overflows the bottom of viewport (only if user hasn't manually moved it)
        if (!userHasMovedPopover && lastSelectionData && lastSelectionData.rect) {
          const rect = lastSelectionData.rect;
          const currentTop = parseFloat(popoverCardEl.style.top) || 0;
          if (rect.top > newHeight && (currentTop + newHeight > window.scrollY + window.innerHeight - 10)) {
            popoverCardEl.style.top = `${Math.max(window.scrollY + 10, window.scrollY + rect.top - newHeight - 8)}px`;
          }
        }
      }
    } else if (e.data.type === 'PLAMO_USER_MOVE') {
      if (popoverCardEl && typeof e.data.deltaX === 'number' && typeof e.data.deltaY === 'number') {
        userHasMovedPopover = true;
        const currentLeft = parseFloat(popoverCardEl.style.left) || 0;
        const currentTop = parseFloat(popoverCardEl.style.top) || 0;

        const newLeft = currentLeft + e.data.deltaX;
        const newTop = currentTop + e.data.deltaY;

        // Viewport boundaries: keep at least 60px visible horizontally, 40px vertically
        const minLeft = window.scrollX + 10;
        const maxLeft = window.scrollX + window.innerWidth - 60;
        const minTop = window.scrollY + 10;
        const maxTop = window.scrollY + 10 + window.innerHeight - 50;

        popoverCardEl.style.left = `${Math.max(minLeft, Math.min(maxLeft, newLeft))}px`;
        popoverCardEl.style.top = `${Math.max(minTop, Math.min(maxTop, newTop))}px`;
      }
    } else if (e.data.type === 'PLAMO_USER_RESIZE') {
      if (popoverCardEl) {
        if (typeof e.data.width === 'number') {
          const clampedWidth = Math.max(300, Math.min(window.innerWidth - 20, e.data.width));
          popoverCardEl.style.width = `${clampedWidth}px`;
          currentSettings.popoverCustomWidth = clampedWidth;
        }
        if (typeof e.data.height === 'number') {
          const clampedHeight = Math.max(140, Math.min(window.innerHeight - 20, e.data.height));
          popoverCardEl.style.height = `${clampedHeight}px`;
          currentSettings.popoverCustomHeight = clampedHeight;
        }
      }
    } else if (e.data.type === 'PLAMO_REPLACE_TEXT') {
      if (lastSelectionData && e.data.text) {
        handleTextReplacement(lastSelectionData, e.data.text);
        removePopoverCard();
      }
    } else if (e.data.type === 'PLAMO_CLOSE') {
      removePopoverCard();
    }
  });

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
  document.addEventListener('contextmenu', (e) => {
    const img = e.target && e.target.closest ? e.target.closest('img') : null;
    if (img) {
      lastRightClickedImageEl = img;
    }
  }, true);

  document.addEventListener('mouseup', (e) => {
    // If clicking inside our popup iframe, card, overlay, or trigger, don't re-trigger
    if (
      e.target.closest('.plamo-ext-popover-iframe') ||
      e.target.closest('.plamo-ext-popover-card') ||
      e.target.closest('.plamo-ext-floating-trigger') ||
      e.target.closest('.plamo-ext-image-overlay-container') ||
      e.target.closest('.plamo-ext-img-hover-btn') ||
      e.target.closest('.plamo-ext-area-selector')
    ) {
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
  // Whole-Page Translation - Smart Content Extractor
  // -------------------------------------------------------------

  /**
   * Locate the primary content container (article, main, markdown body, etc.)
   * Falls back to document.body if no explicit container is found.
   */
  function findMainContentRoot() {
    const primarySelectors = [
      'article',
      'main',
      '[role="main"]',
      '.article-body',
      '.article-content',
      '.entry-content',
      '.post-content',
      '.post-body',
      '.markdown-body',
      '#content',
      '#main-content',
      '.main-content'
    ];

    for (const sel of primarySelectors) {
      const candidates = document.querySelectorAll(sel);
      for (const el of candidates) {
        // Ensure container has substantial text (> 120 chars) and is visible
        if (el.innerText && el.innerText.trim().length > 120) {
          const style = window.getComputedStyle(el);
          if (style.display !== 'none' && style.visibility !== 'hidden') {
            return el;
          }
        }
      }
    }

    return document.body;
  }

  function findTranslatableElements() {
    const root = findMainContentRoot();
    const selector = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, td, figcaption';
    const all = Array.from(root.querySelectorAll(selector));

    const targetLang = currentSettings.targetLang || 'ja';
    const isTargetJapanese = targetLang === 'ja' || targetLang === 'ja-easy';

    // Comprehensive blacklist selector to filter out navigation, widgets, ads and sidebars
    const noiseSelector = [
      'header',
      'nav',
      'footer',
      'aside',
      'script',
      'style',
      'code',
      'pre',
      'noscript',
      '[contenteditable="true"]',
      '[role="navigation"]',
      '[role="complementary"]',
      '[role="banner"]',
      '[aria-hidden="true"]',
      '.sidebar',
      '#sidebar',
      '.comments',
      '#comments',
      '.comment-list',
      '.ad',
      '.advertisement',
      '.ad-container',
      '.social-share',
      '.share-buttons',
      '.breadcrumb',
      '.breadcrumbs',
      '.pagination',
      '.toc',
      '.table-of-contents',
      '.related-posts',
      '.recommended',
      '.cookie-banner',
      '.modal',
      '.dialog'
    ].join(', ');

    return all.filter(el => {
      // 1. Ignore elements inside noise containers
      if (el.closest(noiseSelector)) {
        return false;
      }

      // 2. Ignore elements inside extension UI
      if (el.closest('.plamo-ext-popover-card, .plamo-ext-floating-trigger, .plamo-ext-page-bar, .plamo-ext-inline-translation, .plamo-ext-popover-iframe')) {
        return false;
      }

      // 3. Ignore if already marked or already has inline translation block
      if (el.getAttribute('data-plamo-origin') === 'true') {
        return false;
      }
      const next = el.nextElementSibling;
      if (next && next.classList.contains('plamo-ext-inline-translation')) {
        return false;
      }

      // 4. Check text content length & visibility
      const text = el.innerText ? el.innerText.trim() : '';
      if (text.length < 15) return false;

      // 5. Skip if mostly numbers or symbols
      if (/^[\d\s\p{P}+<=>~^$]+$/u.test(text)) return false;

      // 6. Link Density check: if >50% of the text is inside <a> tags, it is a navigation/menu list
      const anchorLinks = el.querySelectorAll('a');
      if (anchorLinks.length > 0) {
        let linkCharCount = 0;
        anchorLinks.forEach(a => {
          linkCharCount += (a.innerText || '').trim().length;
        });
        if (linkCharCount / text.length >= 0.5) {
          return false;
        }
      }

      // 7. Skip already-translated language (e.g. Japanese text when target is Japanese)
      if (isTargetJapanese && typeof isJapaneseText === 'function' && isJapaneseText(text)) {
        return false;
      }

      // 8. Visibility check
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
  // Image Hover Trigger & Overscreen OCR Image / Area Translation
  // -------------------------------------------------------------
  function ensureImageHoverButton() {
    if (imageHoverBtnEl) return imageHoverBtnEl;
    imageHoverBtnEl = document.createElement('button');
    imageHoverBtnEl.type = 'button';
    imageHoverBtnEl.className = 'plamo-ext-img-hover-btn';
    imageHoverBtnEl.innerHTML = `<span class="plamo-ext-img-hover-icon">🖼️</span><span class="plamo-ext-img-hover-label">${escapeHtml(t('imgHoverTranslateBtn'))}</span>`;
    imageHoverBtnEl.style.display = 'none';

    imageHoverBtnEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    imageHoverBtnEl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const targetImg = hoveredImageEl;
      hideImageHoverButton();
      if (targetImg) {
        translateImageElement(targetImg);
      }
    });

    document.body.appendChild(imageHoverBtnEl);
    return imageHoverBtnEl;
  }

  function positionImageHoverButton(imgEl) {
    if (!imgEl || !imageHoverBtnEl) return;
    const rect = imgEl.getBoundingClientRect();
    if (rect.width < 120 || rect.height < 60) {
      hideImageHoverButton();
      return;
    }
    imageHoverBtnEl.style.display = 'inline-flex';
    const btnWidth = imageHoverBtnEl.offsetWidth || 108;
    const top = window.scrollY + rect.top + 8;
    const left = Math.max(window.scrollX + rect.left + 8, window.scrollX + rect.right - btnWidth - 8);
    imageHoverBtnEl.style.top = `${top}px`;
    imageHoverBtnEl.style.left = `${left}px`;
  }

  function hideImageHoverButton() {
    if (imageHoverBtnEl) {
      imageHoverBtnEl.style.display = 'none';
    }
  }

  document.addEventListener('mouseover', (e) => {
    if (currentSettings.enableImageHoverButton === false) {
      hideImageHoverButton();
      return;
    }
    if (e.target === imageHoverBtnEl || (imageHoverBtnEl && imageHoverBtnEl.contains(e.target))) {
      return;
    }
    const img = e.target && e.target.closest ? e.target.closest('img') : null;
    if (img && img.clientWidth >= 120 && img.clientHeight >= 60 && !img.dataset.plamoOverlayActive) {
      hoveredImageEl = img;
      ensureImageHoverButton();
      positionImageHoverButton(img);
    } else if (!e.target.closest('.plamo-ext-img-hover-btn')) {
      hideImageHoverButton();
    }
  }, { passive: true });

  function normalizeDragRect(x0, y0, x1, y1) {
    return {
      left: Math.min(x0, x1),
      top: Math.min(y0, y1),
      width: Math.abs(x1 - x0),
      height: Math.abs(y1 - y0)
    };
  }

  function subtractRectFromList(rects, subRect, minSize = 8) {
    if (!Array.isArray(rects) || rects.length === 0 || !subRect) return rects || [];
    const sLeft = subRect.left;
    const sTop = subRect.top;
    const sRight = sLeft + subRect.width;
    const sBottom = sTop + subRect.height;
    const out = [];

    for (const r of rects) {
      if (!r || r.width < minSize || r.height < minSize) continue;
      const rLeft = r.left;
      const rTop = r.top;
      const rRight = rLeft + r.width;
      const rBottom = rTop + r.height;

      const ix0 = Math.max(rLeft, sLeft);
      const iy0 = Math.max(rTop, sTop);
      const ix1 = Math.min(rRight, sRight);
      const iy1 = Math.min(rBottom, sBottom);

      if (ix0 >= ix1 || iy0 >= iy1) {
        out.push(r);
        continue;
      }

      const candidates = [
        { left: rLeft, top: rTop, width: r.width, height: iy0 - rTop },
        { left: rLeft, top: iy1, width: r.width, height: rBottom - iy1 },
        { left: rLeft, top: iy0, width: ix0 - rLeft, height: iy1 - iy0 },
        { left: ix1, top: iy0, width: rRight - ix1, height: iy1 - iy0 }
      ];
      for (const piece of candidates) {
        if (piece.width >= minSize && piece.height >= minSize) {
          out.push(piece);
        }
      }
    }
    return out;
  }

  function findRectIndexAtPoint(rects, x, y) {
    if (!Array.isArray(rects)) return -1;
    for (let i = rects.length - 1; i >= 0; i--) {
      const r = rects[i];
      if (!r) continue;
      if (x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height) {
        return i;
      }
    }
    return -1;
  }

  function computeSelectionBoundingRect(rects) {
    if (!Array.isArray(rects) || rects.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const r of rects) {
      if (!r) continue;
      minX = Math.min(minX, r.left);
      minY = Math.min(minY, r.top);
      maxX = Math.max(maxX, r.left + r.width);
      maxY = Math.max(maxY, r.top + r.height);
    }
    if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) return null;
    return {
      left: minX,
      top: minY,
      width: maxX - minX,
      height: maxY - minY
    };
  }

  function sampleRegionPerimeterBackground(imgData, sw, sh, localRects) {
    const samples = [];
    const data = imgData && imgData.data;
    if (!data || !Array.isArray(localRects)) return 'rgb(255, 255, 255)';

    const pushSample = (px, py) => {
      const x = Math.max(0, Math.min(sw - 1, px));
      const y = Math.max(0, Math.min(sh - 1, py));
      const idx = (y * sw + x) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      samples.push({ r, g, b, lum: 0.299 * r + 0.587 * g + 0.114 * b });
    };

    for (const lr of localRects) {
      const x0 = Math.max(0, lr.rx);
      const y0 = Math.max(0, lr.ry);
      const x1 = Math.min(sw - 1, lr.rx + lr.rw - 1);
      const y1 = Math.min(sh - 1, lr.ry + lr.rh - 1);
      if (x1 < x0 || y1 < y0) continue;
      const stepX = Math.max(1, Math.floor((x1 - x0) / 10));
      const stepY = Math.max(1, Math.floor((y1 - y0) / 10));
      for (let x = x0; x <= x1; x += stepX) {
        pushSample(x, y0);
        pushSample(x, y1);
      }
      for (let y = y0; y <= y1; y += stepY) {
        pushSample(x0, y);
        pushSample(x1, y);
      }
    }
    if (samples.length === 0) return 'rgb(255, 255, 255)';
    samples.sort((a, b) => a.lum - b.lum);
    const bg = samples[samples.length >> 1];
    return `rgb(${bg.r}, ${bg.g}, ${bg.b})`;
  }

  function cropAndMaskDataUrlRects(fullDataUrl, rects) {
    const boundingRect = computeSelectionBoundingRect(rects);
    if (!boundingRect) {
      return Promise.reject(new Error('Selection bounding rectangle is empty'));
    }

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const dpr = window.devicePixelRatio || 1;
        const sx = Math.max(0, Math.round(boundingRect.left * dpr));
        const sy = Math.max(0, Math.round(boundingRect.top * dpr));
        const sw = Math.min(img.width - sx, Math.max(1, Math.round(boundingRect.width * dpr)));
        const sh = Math.min(img.height - sy, Math.max(1, Math.round(boundingRect.height * dpr)));

        const srcCanvas = document.createElement('canvas');
        srcCanvas.width = sw;
        srcCanvas.height = sh;
        const srcCtx = srcCanvas.getContext('2d');
        srcCtx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

        if (rects.length === 1) {
          resolve({ boundingRect, dataUrl: srcCanvas.toDataURL('image/png') });
          return;
        }

        const localRects = rects.map(r => {
          const rx = Math.max(0, Math.round(r.left * dpr) - sx);
          const ry = Math.max(0, Math.round(r.top * dpr) - sy);
          const rw = Math.min(sw - rx, Math.max(1, Math.round(r.width * dpr)));
          const rh = Math.min(sh - ry, Math.max(1, Math.round(r.height * dpr)));
          return { rx, ry, rw, rh };
        }).filter(lr => lr.rw > 0 && lr.rh > 0);

        let fillStyle = 'rgb(255, 255, 255)';
        try {
          const imgData = srcCtx.getImageData(0, 0, sw, sh);
          fillStyle = sampleRegionPerimeterBackground(imgData, sw, sh, localRects);
        } catch { }

        const outCanvas = document.createElement('canvas');
        outCanvas.width = sw;
        outCanvas.height = sh;
        const outCtx = outCanvas.getContext('2d');
        outCtx.fillStyle = fillStyle;
        outCtx.fillRect(0, 0, sw, sh);
        for (const lr of localRects) {
          outCtx.drawImage(srcCanvas, lr.rx, lr.ry, lr.rw, lr.rh, lr.rx, lr.ry, lr.rw, lr.rh);
        }
        resolve({ boundingRect, dataUrl: outCanvas.toDataURL('image/png') });
      };
      img.onerror = () => reject(new Error('Failed to crop captured screenshot'));
      img.src = fullDataUrl;
    });
  }

  function cropDataUrlRect(fullDataUrl, viewportRect) {
    return cropAndMaskDataUrlRects(fullDataUrl, [viewportRect]).then(res => res.dataUrl);
  }

  async function acquireImageElementDataUrl(imgEl) {
    const src = imgEl.currentSrc || imgEl.src || '';
    if (src && !src.startsWith('blob:')) {
      try {
        const res = await chrome.runtime.sendMessage({
          type: 'FETCH_IMAGE_DATA_URL',
          imageUrl: src
        });
        if (res && res.ok && res.dataUrl) {
          return res.dataUrl;
        }
      } catch { }
    }

    // Fallback: try direct canvas draw if same-origin / CORS-allowed
    try {
      const canvas = document.createElement('canvas');
      canvas.width = imgEl.naturalWidth || imgEl.clientWidth || 300;
      canvas.height = imgEl.naturalHeight || imgEl.clientHeight || 200;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(imgEl, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png');
    } catch { }

    // Final Fallback: capture visible tab and crop the image's viewport bounding box
    const rect = imgEl.getBoundingClientRect();
    const capRes = await chrome.runtime.sendMessage({ type: 'CAPTURE_VISIBLE_TAB' });
    if (!capRes || !capRes.ok || !capRes.dataUrl) {
      throw new Error((capRes && capRes.error) || 'Failed to capture image from tab');
    }
    return await cropDataUrlRect(capRes.dataUrl, rect);
  }

  async function translateImageElement(imgEl) {
    if (!imgEl) return;
    removeAreaSelector();
    removeFloatingTrigger();
    removePopoverCard();
    removeAllImageOverlays();
    chrome.runtime.sendMessage({ type: 'OCR_PIPELINE_STARTED' }).catch(() => { });

    const rect = imgEl.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) return;

    const docRect = {
      top: window.scrollY + rect.top,
      left: window.scrollX + rect.left,
      width: rect.width,
      height: rect.height
    };

    await runOcrOverlayPipeline({
      targetImgEl: imgEl,
      docRect,
      getDataUrlFn: () => acquireImageElementDataUrl(imgEl)
    });
  }

  /**
   * Compute viewport-safe position and drawer orientation for the OCR overlay toolbar.
   * Keeps toolbar (and expanded drawer) inside viewport bounds for full-screen images,
   * narrow Side Panel viewports, and manual user drags.
   */
  function computeOverlayToolbarLayout({
    containerRect,
    toolbarSize,
    viewport,
    userOffset = null,
    clampUserToViewport = false,
    margin = 10,
    gap = 6,
    drawerGap = 4,
    minDrawerHeight = 100
  }) {
    const cRect = containerRect || { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    const toolbarW = Math.max(1, (toolbarSize && toolbarSize.width) || 450);
    const toolbarH = Math.max(1, (toolbarSize && toolbarSize.height) || 40);
    const viewportW = Math.max(1, (viewport && viewport.width) || 1024);
    const viewportH = Math.max(1, (viewport && viewport.height) || 768);

    const clamp = (val, min, max) => (min > max ? min : Math.max(min, Math.min(max, val)));

    const maxVpLeft = Math.max(margin, viewportW - toolbarW - margin);
    const maxVpTop = Math.max(margin, viewportH - toolbarH - margin);

    const cWidth = typeof cRect.width === 'number' ? cRect.width : (cRect.right - cRect.left);
    const cHeight = typeof cRect.height === 'number' ? cRect.height : (cRect.bottom - cRect.top);
    const cRight = typeof cRect.right === 'number' ? cRect.right : (cRect.left + cWidth);
    const cBottom = typeof cRect.bottom === 'number' ? cRect.bottom : (cRect.top + cHeight);

    const isContainerVisible = cBottom > margin && cRect.top < viewportH - margin &&
      cRight > margin && cRect.left < viewportW - margin;

    let vpLeft;
    let vpTop;
    let placeBelowContainer = false;

    if (userOffset && typeof userOffset.relLeft === 'number' && typeof userOffset.relTop === 'number') {
      const rawVpLeft = cRect.left + userOffset.relLeft;
      const rawVpTop = cRect.top + userOffset.relTop;
      if (clampUserToViewport) {
        vpLeft = clamp(rawVpLeft, margin, maxVpLeft);
        vpTop = clamp(rawVpTop, margin, maxVpTop);
      } else {
        vpLeft = isContainerVisible ? clamp(rawVpLeft, margin, maxVpLeft) : rawVpLeft;
        vpTop = rawVpTop;
      }
      placeBelowContainer = vpTop >= cRect.top;
    } else {
      const rawVpLeft = cRect.left;
      vpLeft = isContainerVisible ? clamp(rawVpLeft, margin, maxVpLeft) : rawVpLeft;

      const aboveTop = cRect.top - toolbarH - gap;
      const belowTop = cBottom + gap;

      if (!isContainerVisible) {
        vpTop = aboveTop;
      } else if (aboveTop >= margin && aboveTop <= maxVpTop) {
        vpTop = aboveTop;
      } else if (belowTop <= maxVpTop && cHeight < viewportH * 0.65 && aboveTop < margin) {
        vpTop = Math.max(margin, belowTop);
        placeBelowContainer = true;
      } else if (cRect.top >= maxVpTop) {
        vpTop = Math.min(aboveTop, maxVpTop);
      } else {
        const pinnedTop = Math.max(margin, cRect.top + margin);
        const upperTop = Math.min(maxVpTop, cBottom - toolbarH - margin);
        vpTop = upperTop < margin ? upperTop : Math.min(pinnedTop, upperTop);
        placeBelowContainer = true;
      }
    }

    const relLeft = vpLeft - cRect.left;
    const relTop = vpTop - cRect.top;

    const spaceBelow = Math.max(0, viewportH - margin - (vpTop + toolbarH + drawerGap));
    const spaceAbove = Math.max(0, (vpTop - drawerGap) - margin);
    const targetTotalH = Math.round(toolbarW * 0.75);
    const desiredDrawerH = Math.max(minDrawerHeight, targetTotalH - Math.round(toolbarH));
    const openDrawerUpward = spaceBelow < desiredDrawerH && spaceAbove > spaceBelow;
    const availableDirSpace = openDrawerUpward ? spaceAbove : spaceBelow;
    const maxDrawerHeight = Math.max(
      60,
      Math.min(Math.max(minDrawerHeight, viewportH - 80), Math.floor(availableDirSpace || (viewportH - 80)))
    );

    return {
      relLeft,
      relTop,
      viewportLeft: vpLeft,
      viewportTop: vpTop,
      placeBelowContainer,
      openDrawerUpward,
      maxDrawerHeight
    };
  }

  async function runOcrOverlayPipeline({ targetImgEl, docRect, getDataUrlFn }) {
    removeAllImageOverlays();
    chrome.runtime.sendMessage({ type: 'OCR_PIPELINE_STARTED' }).catch(() => { });

    if (targetImgEl) {
      targetImgEl.dataset.plamoOverlayActive = 'true';
    }

    const container = document.createElement('div');
    container.className = 'plamo-ext-image-overlay-container';
    container.style.top = `${docRect.top}px`;
    container.style.left = `${docRect.left}px`;
    container.style.width = `${docRect.width}px`;
    container.style.height = `${docRect.height}px`;

    const detectInitialOcrLang = (savedLang, imgEl) => {
      if (savedLang && savedLang !== 'auto') return savedLang;
      const metaParts = [];
      if (imgEl) {
        if (imgEl.alt) metaParts.push(imgEl.alt);
        if (imgEl.title) metaParts.push(imgEl.title);
        const ariaLabel = imgEl.getAttribute && imgEl.getAttribute('aria-label');
        if (ariaLabel) metaParts.push(ariaLabel);
      }
      const metaText = metaParts.join(' ').trim();
      if (/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(metaText)) {
        return 'auto';
      }
      if (/[A-Za-z]{4,}/.test(metaText)) {
        return 'en';
      }
      if (/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(document.title || '')) {
        return 'auto';
      }
      const pageLang = getOverlayPageLang();
      if (/^en(?:\b|-|_)/.test(pageLang)) {
        return 'en';
      }
      return 'auto';
    };

    const getOverlayPageLang = () => ((targetImgEl && targetImgEl.closest && targetImgEl.closest('[lang]') && targetImgEl.closest('[lang]').getAttribute('lang'))
      || document.documentElement.lang
      || '').trim().toLowerCase();

    let activeOcrLang = detectInitialOcrLang(currentSettings.ocrLang || 'auto', targetImgEl);
    let lastOcrDetectedLang = '';
    let activeTargetLang = currentSettings.targetLang || 'ja';
    let userOverrodeTargetLang = false;

    const uiLang = (typeof PlamoI18n !== 'undefined' && PlamoI18n.resolveUiLang)
      ? PlamoI18n.resolveUiLang(currentSettings.uiLang)
      : 'ja';
    const autoOcrLabel = currentSettings.ocrEngine === 'tesseract'
      ? t('optOcrLangAutoTesseract')
      : t('optOcrLangAuto');
    const targetPrefix = uiLang === 'en' ? 'To: ' : '訳: ';
    const targetLangList = (typeof PLAMO_LANGUAGES !== 'undefined' && Array.isArray(PLAMO_LANGUAGES))
      ? PLAMO_LANGUAGES
      : [
        { code: 'ja', name: '日本語', enName: 'Japanese' },
        { code: 'ja-easy', name: 'やさしい日本語', enName: 'Japanese (Easy)' },
        { code: 'en', name: '英語', enName: 'English' }
      ];

    const targetLangOptionsHtml = targetLangList.map(lang => {
      const isSelected = activeTargetLang === lang.code;
      const simpleName = (typeof getLanguageSimpleName === 'function')
        ? getLanguageSimpleName(lang.code, uiLang)
        : (uiLang === 'en' ? lang.enName : lang.name);
      return `<option value="${escapeHtml(lang.code)}"${isSelected ? ' selected' : ''}>${escapeHtml(targetPrefix + simpleName)}</option>`;
    }).join('');

    container.innerHTML = `
      <div class="plamo-ext-img-ov-toolbar">
        <span class="plamo-ext-img-ov-status" data-role="status">🔍 ${escapeHtml(t('ocrStatusRecognizing'))}</span>
        <div class="plamo-ext-img-ov-actions">
          <select class="plamo-ext-img-ov-lang-select" data-role="lang-select" title="${escapeHtml(t('labelOcrLang'))}">
            <option value="auto"${activeOcrLang === 'auto' ? ' selected' : ''}>${escapeHtml(autoOcrLabel)}</option>
            <option value="ja"${activeOcrLang === 'ja' ? ' selected' : ''}>${escapeHtml(t('optOcrLangJa'))}</option>
            <option value="ja-tesseract"${activeOcrLang === 'ja-tesseract' ? ' selected' : ''}>${escapeHtml(t('optOcrLangJaTesseract'))}</option>
            <option value="en"${activeOcrLang === 'en' ? ' selected' : ''}>${escapeHtml(t('optOcrLangEn'))}</option>
            <option value="zh"${activeOcrLang === 'zh' ? ' selected' : ''}>${escapeHtml(t('optOcrLangZh'))}</option>
            <option value="zh-TW"${activeOcrLang === 'zh-TW' ? ' selected' : ''}>${escapeHtml(t('optOcrLangZhTw'))}</option>
            <option value="ko"${activeOcrLang === 'ko' ? ' selected' : ''}>${escapeHtml(t('optOcrLangKo'))}</option>
            <option value="fr"${activeOcrLang === 'fr' ? ' selected' : ''}>${escapeHtml(t('optOcrLangFr'))}</option>
            <option value="de"${activeOcrLang === 'de' ? ' selected' : ''}>${escapeHtml(t('optOcrLangDe'))}</option>
            <option value="es"${activeOcrLang === 'es' ? ' selected' : ''}>${escapeHtml(t('optOcrLangEs'))}</option>
            <option value="ru"${activeOcrLang === 'ru' ? ' selected' : ''}>${escapeHtml(t('optOcrLangRu'))}</option>
          </select>
          <select class="plamo-ext-img-ov-target-select" data-role="target-select" title="${escapeHtml(t('labelTargetLang'))}">
            ${targetLangOptionsHtml}
          </select>
          <div class="plamo-ext-ov-toggle-wrap" title="${escapeHtml(t('overlayToggleTextMode'))}">
            <span class="plamo-ext-ov-toggle-label" data-label="ocr">${escapeHtml(t('toggleLabelOriginal'))}</span>
            <label class="plamo-ext-ov-switch">
              <input type="checkbox" data-action="toggle-text-mode" checked>
              <span class="plamo-ext-ov-slider"></span>
            </label>
            <span class="plamo-ext-ov-toggle-label is-active" data-label="trans">${escapeHtml(t('toggleLabelTranslation'))}</span>
          </div>
          <button type="button" class="plamo-ext-img-ov-btn plamo-ext-img-ov-add-region" data-action="add-region" title="${escapeHtml(t('overlayAddRegion'))}" aria-label="${escapeHtml(t('overlayAddRegion'))}">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M2 5V3a1 1 0 0 1 1-1h2M11 2h2a1 1 0 0 1 1 1v2M5 14H3a1 1 0 0 1-1-1v-2"/>
              <path d="M11 8v6M8 11h6"/>
            </svg>
          </button>
          <button type="button" class="plamo-ext-img-ov-btn" data-action="toggle-drawer" title="${escapeHtml(t('overlayViewText'))}" aria-expanded="false">📑</button>
          <button type="button" class="plamo-ext-img-ov-btn" data-action="copy-current" title="${escapeHtml(t('overlayCopyCurrentText'))}">📋</button>
          <button type="button" class="plamo-ext-img-ov-btn" data-action="peek" title="${escapeHtml(t('overlayToggleOriginal'))}">👁</button>
          <button type="button" class="plamo-ext-img-ov-btn plamo-ext-img-ov-close" data-action="close" title="${escapeHtml(t('pageBarCloseTitle'))}">×</button>
        </div>
        <div class="plamo-ext-img-ov-drawer" data-role="drawer" style="display:none;">
          <textarea class="plamo-ext-img-ov-textarea" spellcheck="false" aria-label="${escapeHtml(t('overlayDrawerEditLabel'))}" placeholder="${escapeHtml(t('ocrStatusNoText'))}"></textarea>
        </div>
      </div>
      <div class="plamo-ext-img-ov-canvas" data-role="canvas"></div>
    `;

    const statusEl = container.querySelector('[data-role="status"]');
    const canvasLayer = container.querySelector('[data-role="canvas"]');
    const langSelect = container.querySelector('[data-role="lang-select"]');
    const targetSelect = container.querySelector('[data-role="target-select"]');
    const toggleSwitch = container.querySelector('[data-action="toggle-text-mode"]');
    const labelOcr = container.querySelector('.plamo-ext-ov-toggle-label[data-label="ocr"]');
    const labelTrans = container.querySelector('.plamo-ext-ov-toggle-label[data-label="trans"]');
    const drawerEl = container.querySelector('[data-role="drawer"]');
    const textareaEl = drawerEl ? drawerEl.querySelector('.plamo-ext-img-ov-textarea') : null;
    const toggleDrawerBtn = container.querySelector('[data-action="toggle-drawer"]');

    let isPeekingOriginal = false;
    let isShowingOriginalText = false;
    let currentBoxItems = [];
    let nextBoxIdx = 0;
    let aborted = false;
    let editedOriginalText = null;
    let editedTranslatedText = null;

    const toolbarEl = container.querySelector('.plamo-ext-img-ov-toolbar');

    const getActiveOriginalText = () => currentBoxItems
      .filter(it => it && !it.deleted && it.blk && it.blk.text)
      .map(it => it.blk.text)
      .join('\n');

    const getActiveTranslatedText = () => {
      const joined = currentBoxItems
        .filter(it => it && !it.deleted && it.boxEl)
        .map(it => {
          const tr = it.boxEl.dataset.translatedText;
          return (tr && tr !== '…') ? tr : '';
        })
        .filter(Boolean)
        .join('\n\n');
      return joined || getActiveOriginalText();
    };

    const getEffectiveOriginalText = () => (editedOriginalText !== null ? editedOriginalText : getActiveOriginalText());
    const getEffectiveTranslatedText = () => (editedTranslatedText !== null ? editedTranslatedText : getActiveTranslatedText());

    const setBoxDisplayText = (item, text) => {
      if (!item || item.deleted || !item.textSpan) return;
      item.textSpan.textContent = text;
    };

    const applyDrawerDimensions = (maxAllowedOverride) => {
      if (!drawerEl || !toolbarEl) return;
      const tRect = toolbarEl.getBoundingClientRect();
      const toolbarW = tRect.width || toolbarEl.offsetWidth || 450;
      const toolbarH = tRect.height || toolbarEl.offsetHeight || 40;
      const targetTotalH = Math.round(toolbarW * 0.75); // 4:3 ratio: W : TotalH = 4 : 3
      const viewportH = document.documentElement.clientHeight || window.innerHeight;
      const defaultMaxH = Math.max(100, viewportH - 80);
      const maxAllowedH = typeof maxAllowedOverride === 'number'
        ? Math.min(defaultMaxH, Math.max(60, maxAllowedOverride))
        : defaultMaxH;
      const targetDrawerH = Math.min(maxAllowedH, Math.max(60, targetTotalH - Math.round(toolbarH)));
      drawerEl.style.height = `${targetDrawerH}px`;
    };

    const updateDrawerContent = () => {
      if (!drawerEl || !textareaEl) return;
      const text = isShowingOriginalText
        ? getEffectiveOriginalText()
        : getEffectiveTranslatedText();
      textareaEl.value = text || '';
    };

    if (textareaEl) {
      textareaEl.addEventListener('input', () => {
        if (isShowingOriginalText) {
          editedOriginalText = textareaEl.value;
        } else {
          editedTranslatedText = textareaEl.value;
        }
      });
      for (const evtName of ['keydown', 'keyup', 'keypress', 'paste', 'cut']) {
        textareaEl.addEventListener(evtName, (e) => {
          e.stopPropagation();
        });
      }
    }

    const updateTextMode = (showOriginal) => {
      isShowingOriginalText = Boolean(showOriginal);
      if (toggleSwitch) toggleSwitch.checked = !showOriginal;
      if (labelOcr) labelOcr.classList.toggle('is-active', showOriginal);
      if (labelTrans) labelTrans.classList.toggle('is-active', !showOriginal);
      container.classList.toggle('is-mode-original', showOriginal);

      for (const item of currentBoxItems) {
        if (!item || item.deleted || !item.boxEl) continue;
        setBoxDisplayText(
          item,
          showOriginal
            ? (item.boxEl.dataset.originalText || '')
            : (item.boxEl.dataset.translatedText || item.boxEl.dataset.originalText || '')
        );
      }
      updateDrawerContent();
    };

    let userHasMovedToolbar = false;
    let userToolbarOffset = null;
    let isDraggingToolbar = false;
    let dragPointerId = null;
    let dragStartClientX = 0;
    let dragStartClientY = 0;
    let dragStartVpLeft = 0;
    let dragStartVpTop = 0;
    let dragActivated = false;

    const adjustLayoutPositions = ({ clampUserToViewport = true } = {}) => {
      if (!toolbarEl || !document.body.contains(container)) return;
      const viewportW = document.documentElement.clientWidth || window.innerWidth;
      const viewportH = document.documentElement.clientHeight || window.innerHeight;
      const margin = 10;

      const nextMaxWidth = `${Math.max(200, viewportW - margin * 2)}px`;
      if (toolbarEl.style.maxWidth !== nextMaxWidth) {
        toolbarEl.style.maxWidth = nextMaxWidth;
      }

      const cRect = container.getBoundingClientRect();
      const tRect = toolbarEl.getBoundingClientRect();
      const layout = computeOverlayToolbarLayout({
        containerRect: cRect,
        toolbarSize: {
          width: tRect.width || toolbarEl.offsetWidth || 450,
          height: tRect.height || toolbarEl.offsetHeight || 40
        },
        viewport: { width: viewportW, height: viewportH },
        userOffset: userHasMovedToolbar ? userToolbarOffset : null,
        clampUserToViewport,
        margin
      });

      toolbarEl.style.left = `${Math.round(layout.relLeft)}px`;
      toolbarEl.style.top = `${Math.round(layout.relTop)}px`;
      toolbarEl.style.bottom = 'auto';

      container.classList.toggle('is-toolbar-bottom', layout.placeBelowContainer);
      toolbarEl.classList.toggle('is-drawer-up', layout.openDrawerUpward);

      if (drawerEl && drawerEl.style.display !== 'none') {
        applyDrawerDimensions(layout.maxDrawerHeight);
      }
    };

    const endToolbarDrag = (e) => {
      if (!isDraggingToolbar) return;
      if (e && dragPointerId !== null && typeof e.pointerId === 'number' && e.pointerId !== dragPointerId) return;
      isDraggingToolbar = false;
      dragActivated = false;
      dragPointerId = null;
      if (toolbarEl) {
        toolbarEl.classList.remove('is-dragging');
        if (e && typeof e.pointerId === 'number' && toolbarEl.releasePointerCapture) {
          try {
            toolbarEl.releasePointerCapture(e.pointerId);
          } catch {}
        }
      }
    };

    if (toolbarEl) {
      toolbarEl.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        if (e.target && e.target.closest('select, button, input, label, option, textarea, a, .plamo-ext-ov-toggle-wrap, [data-role="drawer"]')) {
          return;
        }
        const tRect = toolbarEl.getBoundingClientRect();
        isDraggingToolbar = true;
        dragActivated = false;
        dragPointerId = typeof e.pointerId === 'number' ? e.pointerId : null;
        dragStartClientX = e.clientX;
        dragStartClientY = e.clientY;
        dragStartVpLeft = tRect.left;
        dragStartVpTop = tRect.top;
        toolbarEl.classList.add('is-dragging');
        if (dragPointerId !== null && toolbarEl.setPointerCapture) {
          try {
            toolbarEl.setPointerCapture(dragPointerId);
          } catch {}
        }
        e.preventDefault();
        e.stopPropagation();
      });

      toolbarEl.addEventListener('pointermove', (e) => {
        if (!isDraggingToolbar) return;
        if (dragPointerId !== null && typeof e.pointerId === 'number' && e.pointerId !== dragPointerId) return;
        const dx = e.clientX - dragStartClientX;
        const dy = e.clientY - dragStartClientY;
        if (!dragActivated && Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
        dragActivated = true;
        userHasMovedToolbar = true;

        const cRect = container.getBoundingClientRect();
        const tRect = toolbarEl.getBoundingClientRect();
        const viewportW = document.documentElement.clientWidth || window.innerWidth;
        const viewportH = document.documentElement.clientHeight || window.innerHeight;
        const toolbarW = tRect.width || toolbarEl.offsetWidth || 450;
        const toolbarH = tRect.height || toolbarEl.offsetHeight || 40;
        const margin = 10;

        const maxVpLeft = Math.max(margin, viewportW - toolbarW - margin);
        const maxVpTop = Math.max(margin, viewportH - toolbarH - margin);
        const clampedVpLeft = Math.max(margin, Math.min(maxVpLeft, dragStartVpLeft + dx));
        const clampedVpTop = Math.max(margin, Math.min(maxVpTop, dragStartVpTop + dy));

        userToolbarOffset = {
          relLeft: clampedVpLeft - cRect.left,
          relTop: clampedVpTop - cRect.top
        };
        adjustLayoutPositions();
      });

      toolbarEl.addEventListener('pointerup', endToolbarDrag);
      toolbarEl.addEventListener('pointercancel', endToolbarDrag);
    }

    const onWindowResize = () => adjustLayoutPositions({ clampUserToViewport: true });
    const onWindowScroll = () => adjustLayoutPositions({ clampUserToViewport: false });

    window.addEventListener('resize', onWindowResize, { passive: true });
    window.addEventListener('scroll', onWindowScroll, { passive: true });
    window.addEventListener('blur', endToolbarDrag);

    let toolbarResizeObserver = null;
    if (toolbarEl && typeof ResizeObserver !== 'undefined') {
      toolbarResizeObserver = new ResizeObserver(() => {
        adjustLayoutPositions({ clampUserToViewport: true });
      });
      toolbarResizeObserver.observe(toolbarEl);
    }

    // Keep overlay synced if anchored to an <img> element
    let syncPositionId = null;
    if (targetImgEl) {
      const syncFn = (clampUser = false) => {
        if (!document.body.contains(container) || !document.body.contains(targetImgEl)) return;
        const r = targetImgEl.getBoundingClientRect();
        container.style.top = `${window.scrollY + r.top}px`;
        container.style.left = `${window.scrollX + r.left}px`;
        container.style.width = `${r.width}px`;
        container.style.height = `${r.height}px`;
        adjustLayoutPositions({ clampUserToViewport: clampUser });
      };
      const syncOnResize = () => syncFn(true);
      const syncOnScroll = () => syncFn(false);
      window.addEventListener('resize', syncOnResize, { passive: true });
      window.addEventListener('scroll', syncOnScroll, { passive: true });
      syncPositionId = () => {
        window.removeEventListener('resize', syncOnResize);
        window.removeEventListener('scroll', syncOnScroll);
      };
    }

    let isSelectingAddRegion = false;

    const cleanupOverlay = () => {
      aborted = true;
      endToolbarDrag();
      if (isSelectingAddRegion) {
        isSelectingAddRegion = false;
        removeAreaSelector();
      }
      window.removeEventListener('resize', onWindowResize);
      window.removeEventListener('scroll', onWindowScroll);
      window.removeEventListener('blur', endToolbarDrag);
      if (toolbarResizeObserver) {
        toolbarResizeObserver.disconnect();
        toolbarResizeObserver = null;
      }
      if (syncPositionId) syncPositionId();
      if (targetImgEl) {
        delete targetImgEl.dataset.plamoOverlayActive;
      }
      activeImageOverlays.delete(container);
      removeElement(container);
    };

    container.addEventListener('mousedown', (e) => e.stopPropagation());
    container.addEventListener('mouseup', (e) => e.stopPropagation());

    container.addEventListener('click', (e) => {
      const toggleLabel = e.target.closest('.plamo-ext-ov-toggle-label');
      if (toggleLabel) {
        e.preventDefault();
        e.stopPropagation();
        const wantsTrans = toggleLabel.getAttribute('data-label') === 'trans';
        updateTextMode(!wantsTrans);
        return;
      }

      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const action = btn.getAttribute('data-action');
      if (action === 'close') {
        cleanupOverlay();
      } else if (action === 'add-region') {
        startAppendRegionCapture();
      } else if (action === 'peek') {
        isPeekingOriginal = !isPeekingOriginal;
        btn.classList.toggle('is-active', isPeekingOriginal);
        container.classList.toggle('is-peek-original', isPeekingOriginal);
        if (drawerEl && drawerEl.style.display !== 'none') {
          drawerEl.style.display = 'none';
          if (toggleDrawerBtn) {
            toggleDrawerBtn.classList.remove('is-active');
            toggleDrawerBtn.setAttribute('aria-expanded', 'false');
          }
        }
      } else if (action === 'toggle-drawer') {
        const isShown = drawerEl && drawerEl.style.display !== 'none';
        if (drawerEl) {
          if (isShown) {
            drawerEl.style.display = 'none';
            btn.classList.remove('is-active');
            btn.setAttribute('aria-expanded', 'false');
          } else {
            drawerEl.style.display = 'flex';
            btn.classList.add('is-active');
            btn.setAttribute('aria-expanded', 'true');
            adjustLayoutPositions();
            updateDrawerContent();
            if (textareaEl) {
              textareaEl.focus();
            }
          }
        }
      } else if (action === 'copy-current') {
        const textToCopy = isShowingOriginalText
          ? getEffectiveOriginalText()
          : getEffectiveTranslatedText();
        if (textToCopy) {
          navigator.clipboard.writeText(textToCopy).then(() => {
            const orig = btn.textContent;
            btn.textContent = '✓';
            setTimeout(() => { btn.textContent = orig; }, 1200);
          }).catch(() => { });
        }
      }
    });

    if (toggleSwitch) {
      toggleSwitch.addEventListener('change', (e) => {
        e.stopPropagation();
        updateTextMode(!toggleSwitch.checked);
      });
    }

    if (langSelect) {
      langSelect.addEventListener('change', async (e) => {
        e.stopPropagation();
        const selectedLang = langSelect.value;
        activeOcrLang = selectedLang;
        currentSettings.ocrLang = selectedLang;
        chrome.storage.local.set({ ocrLang: selectedLang }).catch(() => { });
        await executeOcrPipeline(selectedLang);
      });
    }

    if (targetSelect) {
      targetSelect.addEventListener('change', async (e) => {
        e.stopPropagation();
        const selectedTarget = targetSelect.value;
        activeTargetLang = selectedTarget;
        userOverrodeTargetLang = true;
        currentSettings.targetLang = selectedTarget;
        chrome.storage.local.set({ targetLang: selectedTarget }).catch(() => { });
        if (currentBoxItems.length > 0) {
          await translateBoxItems(selectedTarget);
        }
      });
    }

    container._cleanup = cleanupOverlay;
    document.body.appendChild(container);
    activeImageOverlays.add(container);
    requestAnimationFrame(() => adjustLayoutPositions());

    let cachedImageDataUrl = null;

    const LEADING_ICON_CLEAN_REGEX = /^(?:[①-⑳❶-❾ⓐ-ⓩⒶ-Ⓩ]\s*|[b-hj-zB-HJ-Z0-9]\s+(?=[A-Za-z\u3040-\u9FFF])|[oO0Qq]\s*(?=[\u3040-\u9FFF])|(?:[8B][=~-]|[:;=~^|_/\\><«»❯❮]{1,3}[=~-]?|[+])\s+(?=[A-Za-z\u3040-\u9FFF]))(?![.\):&])/;

    function cleanOcrBlockText(rawText) {
      return (rawText || '')
        .replace(/^[\s●○◎◆◇■□▲△▼▽・•·▪▫◦‣⁃∙❖➢➤✔✓☑]+/, '')
        .replace(LEADING_ICON_CLEAN_REGEX, '')
        .trim();
    }

    function isNoiseOcrBlockText(text) {
      if (!text) return true;
      // Discard isolated single Latin letter that is not 'a', 'A', 'I' (common icon artifacts: Q, x, v, o, etc.)
      if (text.length === 1 && /[a-zA-Z]/.test(text) && !/^[aAiI]$/.test(text)) return true;
      // Discard pure non-letter/number symbol tokens unless it's a known bullet/list marker
      if (!/[\p{L}\p{N}]/u.test(text) && !/^[•·∙・●○◎◇◆■□▲△▼▽▪▫◦‣⁃❖➢➤✔✓☑※†‡§¶*–—\-]$/.test(text)) return true;
      return false;
    }

    function computeBoxFontPx(text, isMultiLine, renderedBoxW, renderedBoxH) {
      if (!isMultiLine) {
        return Math.max(10, Math.min(20, Math.round(renderedBoxH * 0.66)));
      }
      const areaPerChar = Math.max(36, (renderedBoxW * renderedBoxH) / Math.max(1, (text || '').length || 1));
      return Math.max(10, Math.min(19, Math.round(Math.sqrt(areaPerChar) * 0.72)));
    }

    function deleteBoxItem(item) {
      if (!item || item.deleted) return;
      item.deleted = true;
      removeElement(item.boxEl);
      currentBoxItems = currentBoxItems.filter(it => it && !it.deleted);
      editedOriginalText = null;
      editedTranslatedText = null;
      updateDrawerContent();
      if (statusEl && !aborted && currentBoxItems.length === 0) {
        statusEl.textContent = `ℹ️ ${t('ocrStatusNoTextShort')}`;
      }
    }

    function createOverlayBoxItem({ blk, leftPct, topPct, widthPct, heightPct, renderedBoxW, renderedBoxH }) {
      const isSingleLine = !blk.isMultiLine;
      const estimatedFontPx = computeBoxFontPx(blk.text, blk.isMultiLine, renderedBoxW, renderedBoxH);

      const boxEl = document.createElement('div');
      boxEl.className = `plamo-ext-image-overlay-box is-loading${isSingleLine ? ' is-single-line' : ''}`;
      boxEl.style.left = `${leftPct.toFixed(2)}%`;
      boxEl.style.top = `${topPct.toFixed(2)}%`;
      boxEl.style.setProperty('--plamo-box-w', `${widthPct.toFixed(2)}%`);
      boxEl.style.setProperty('--plamo-box-h', `${heightPct.toFixed(2)}%`);
      boxEl.style.setProperty('--plamo-box-font', `${estimatedFontPx}px`);
      boxEl.dataset.originalText = blk.text || '';
      boxEl.dataset.translatedText = '…';

      const textSpan = document.createElement('span');
      textSpan.className = 'plamo-ext-img-box-text';
      textSpan.textContent = isShowingOriginalText ? (blk.text || '…') : '…';

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'plamo-ext-img-box-delete';
      deleteBtn.setAttribute('data-box-action', 'delete');
      deleteBtn.title = t('overlayDeleteBlock');
      deleteBtn.setAttribute('aria-label', t('overlayDeleteBlock'));
      deleteBtn.textContent = '×';

      boxEl.appendChild(textSpan);
      boxEl.appendChild(deleteBtn);

      const item = { blk, boxEl, textSpan, idx: nextBoxIdx++, deleted: false };

      deleteBtn.addEventListener('mousedown', (e) => {
        e.stopPropagation();
      });
      deleteBtn.addEventListener('mouseup', (e) => {
        e.stopPropagation();
      });
      deleteBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        deleteBoxItem(item);
      });
      boxEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        deleteBoxItem(item);
      });

      boxEl.addEventListener('mouseenter', (e) => {
        boxEl.style.setProperty('--plamo-hover-tx', '0px');
        boxEl.style.setProperty('--plamo-hover-ty', '0px');
        const rect = boxEl.getBoundingClientRect();
        const margin = 12;
        let dx = 0;
        let dy = 0;

        if (e && Number.isFinite(e.clientX) && Number.isFinite(e.clientY)) {
          if (e.clientX < rect.left) {
            dx += e.clientX - rect.left - 16;
          } else if (e.clientX > rect.right) {
            dx += e.clientX - rect.right + 16;
          }
          if (e.clientY < rect.top) {
            dy += e.clientY - rect.top - 16;
          } else if (e.clientY > rect.bottom) {
            dy += e.clientY - rect.bottom + 16;
          }
        }

        if (rect.right + dx > window.innerWidth - margin) {
          dx = (window.innerWidth - margin) - rect.right;
        }
        if (rect.left + dx < margin) {
          dx = margin - rect.left;
        }
        if (rect.bottom + dy > window.innerHeight - margin) {
          dy = (window.innerHeight - margin) - rect.bottom;
        }
        if (rect.top + dy < margin) {
          dy = margin - rect.top;
        }

        if (dx !== 0) {
          boxEl.style.setProperty('--plamo-hover-tx', `${Math.round(dx)}px`);
        }
        if (dy !== 0) {
          boxEl.style.setProperty('--plamo-hover-ty', `${Math.round(dy)}px`);
        }
      });

      boxEl.addEventListener('mouseleave', () => {
        boxEl.style.setProperty('--plamo-hover-tx', '0px');
        boxEl.style.setProperty('--plamo-hover-ty', '0px');
      });

      canvasLayer.appendChild(boxEl);
      return item;
    }

    async function executeOcrPipeline(langToUse) {
      canvasLayer.innerHTML = '';
      currentBoxItems = [];
      nextBoxIdx = 0;
      editedOriginalText = null;
      editedTranslatedText = null;
      updateTextMode(false);

      if (statusEl) {
        statusEl.textContent = `🔍 ${t('ocrStatusRecognizing')}`;
      }

      try {
        if (!cachedImageDataUrl) {
          cachedImageDataUrl = await getDataUrlFn();
        }
        const imageDataUrl = cachedImageDataUrl;
        if (aborted) return;

        const effectiveReqLang = langToUse || activeOcrLang || 'auto';
        const ocrRes = await chrome.runtime.sendMessage({
          type: 'OCR_RECOGNIZE_IMAGE',
          imageDataUrl,
          ocrLang: effectiveReqLang,
          ocrEngine: currentSettings.ocrEngine || 'ndlocr'
        });
        if (aborted) return;

        if (!ocrRes || !ocrRes.ok) {
          throw new Error((ocrRes && ocrRes.error) || t('ocrStatusError'));
        }

        lastOcrDetectedLang = ocrRes.detectedOcrLang || '';
        if (ocrRes.detectedOcrLang && langSelect) {
          if ((effectiveReqLang === 'auto' && ocrRes.detectedOcrLang === 'en') ||
              (effectiveReqLang === 'ja' && ocrRes.detectedOcrLang === 'ja-tesseract')) {
            activeOcrLang = ocrRes.detectedOcrLang;
            langSelect.value = ocrRes.detectedOcrLang;
          }
        }

        const blocks = (Array.isArray(ocrRes.blocks) ? ocrRes.blocks : [])
          .map(b => ({ ...b, text: cleanOcrBlockText(b.text) }))
          .filter(b => !isNoiseOcrBlockText(b.text));
        updateDrawerContent();

        if (blocks.length === 0) {
          if (statusEl) {
            statusEl.textContent = `ℹ️ ${t('ocrStatusNoTextShort')}`;
          }
          return;
        }

        const srcW = ocrRes.width || docRect.width || 1;
        const srcH = ocrRes.height || docRect.height || 1;

        currentBoxItems = blocks.map((blk) => {
          const leftPct = Math.max(0, Math.min(97, (blk.bbox.x0 / srcW) * 100));
          const topPct = Math.max(0, Math.min(97.5, (blk.bbox.y0 / srcH) * 100));
          const widthPct = Math.max(3, Math.min(100 - leftPct, ((blk.bbox.x1 - blk.bbox.x0) / srcW) * 100));
          const heightPct = Math.max(2.5, Math.min(100 - topPct, ((blk.bbox.y1 - blk.bbox.y0) / srcH) * 100));
          const renderedBoxH = (heightPct / 100) * docRect.height;
          const renderedBoxW = (widthPct / 100) * docRect.width;
          return createOverlayBoxItem({ blk, leftPct, topPct, widthPct, heightPct, renderedBoxW, renderedBoxH });
        });
        updateDrawerContent();

        if (!userOverrodeTargetLang) {
          const activeOcrText = getActiveOriginalText();
          const autoEffTarget = (typeof resolveTargetLang === 'function')
            ? resolveTargetLang(
              activeOcrText,
              currentSettings.sourceLang || 'auto',
              currentSettings.targetLang || 'ja',
              currentSettings.autoSwitchJaEn !== false,
              currentSettings.form || 'none'
            )
            : (currentSettings.targetLang || 'ja');
          activeTargetLang = autoEffTarget;
          if (targetSelect) {
            targetSelect.value = autoEffTarget;
          }
        }

        await translateBoxItems(activeTargetLang);
      } catch (err) {
        if (statusEl && !aborted) {
          statusEl.textContent = `⚠️ ${err.message || String(err)}`;
        }
      }
    }

    let translateEpoch = 0;

    const KANA_LETTER_REGEX = /[\u3040-\u309F\u30A1-\u30FA\u30FD-\u30FF]/;
    const CJK_SCRIPT_REGEX = /[\u3040-\u30FF\u4E00-\u9FFF]/;

    function resolveOverlaySourceLang(sampleText = '') {
      const req = (activeOcrLang || 'auto').toLowerCase();
      if (req === 'ja' || req === 'ja-tesseract') {
        return (!sampleText || CJK_SCRIPT_REGEX.test(sampleText)) ? 'ja' : undefined;
      }
      if (req === 'en') return 'en';
      if (req === 'zh') return 'zh-hans';
      if (req === 'zh-tw') return 'zh-hant';
      if (req !== 'auto') return activeOcrLang;

      const allText = getActiveOriginalText();
      if (KANA_LETTER_REGEX.test(sampleText) || KANA_LETTER_REGEX.test(allText)) {
        return (!sampleText || CJK_SCRIPT_REGEX.test(sampleText)) ? 'ja' : undefined;
      }
      if (lastOcrDetectedLang === 'en') return 'en';
      if (lastOcrDetectedLang === 'ja-tesseract') {
        return (!sampleText || CJK_SCRIPT_REGEX.test(sampleText)) ? 'ja' : undefined;
      }
      if (lastOcrDetectedLang === 'ja') {
        const pageLang = getOverlayPageLang();
        if (!/^zh(?:\b|-|_)/.test(pageLang) && (!sampleText || CJK_SCRIPT_REGEX.test(sampleText))) {
          return 'ja';
        }
      }
      return undefined;
    }

    async function translateSingleItem(item, targetLang, activeEpoch) {
      const isCancelled = () => aborted || !item || item.deleted || (activeEpoch !== null && activeEpoch !== translateEpoch);
      if (isCancelled()) return '';
      const { blk, boxEl, idx } = item;

      if (targetLang === 'en' && /^[A-Za-z0-9\s&/+#.-]{1,8}$/.test(blk.text)) {
        boxEl.classList.remove('is-loading');
        boxEl.dataset.translatedText = blk.text;
        if (!isShowingOriginalText) {
          setBoxDisplayText(item, blk.text);
        }
        updateDrawerContent();
        return '';
      }

      const requestId = `img-ov-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`;
      activeOverlayStreamHandlers.set(requestId, ({ currentText }) => {
        if (isCancelled() || !currentText) return;
        boxEl.classList.remove('is-loading');
        boxEl.dataset.translatedText = currentText;
        if (!isShowingOriginalText) {
          setBoxDisplayText(item, currentText);
        }
      });

      try {
        const blockSourceLang = resolveOverlaySourceLang(blk.text);
        const trRes = await chrome.runtime.sendMessage({
          type: 'TRANSLATE_TEXT',
          text: blk.text,
          ...(blockSourceLang ? { sourceLang: blockSourceLang } : {}),
          targetLang: targetLang,
          autoSwitchJaEn: false,
          requestId
        });
        activeOverlayStreamHandlers.delete(requestId);
        if (isCancelled()) return '';

        boxEl.classList.remove('is-loading');
        if (trRes && trRes.ok && trRes.translatedText) {
          boxEl.dataset.translatedText = trRes.translatedText;
          if (!isShowingOriginalText) {
            setBoxDisplayText(item, trRes.translatedText);
          }
          updateDrawerContent();
          const det = (trRes.detectedSourceLang || 'auto').toUpperCase();
          const tgt = (trRes.effectiveTargetLang || targetLang || 'ja').toUpperCase();
          return `${det} → ${tgt}`;
        }
        boxEl.dataset.translatedText = blk.text;
        if (!isShowingOriginalText) {
          setBoxDisplayText(item, blk.text);
        }
        updateDrawerContent();
      } catch {
        activeOverlayStreamHandlers.delete(requestId);
        if (isCancelled()) return '';
        boxEl.classList.remove('is-loading');
        boxEl.dataset.translatedText = blk.text;
        if (!isShowingOriginalText) {
          setBoxDisplayText(item, blk.text);
        }
        updateDrawerContent();
      }
      return '';
    }

    async function translateBoxItems(targetLang) {
      const targetItems = currentBoxItems.filter(it => it && !it.deleted && it.boxEl);
      if (targetItems.length === 0 || aborted) return;
      translateEpoch++;
      const currentEpoch = translateEpoch;
      editedTranslatedText = null;

      const pairCounts = new Map();
      const recordPair = (pair, weight = 1) => {
        if (!pair) return;
        pairCounts.set(pair, (pairCounts.get(pair) || 0) + Math.max(1, weight));
      };
      const pickBestPair = () => {
        if (pairCounts.size === 0) return '';
        let bestPair = '';
        let bestScore = -1;
        for (const [pair, count] of pairCounts.entries()) {
          const parts = pair.split('→').map(s => s.trim());
          const isDistinct = parts.length === 2 && parts[0] !== parts[1];
          const score = count + (isDistinct ? 0.5 : 0);
          if (score > bestScore) {
            bestScore = score;
            bestPair = pair;
          }
        }
        return bestPair;
      };

      for (const item of targetItems) {
        item.boxEl.classList.add('is-loading');
        item.boxEl.dataset.translatedText = '…';
        if (!isShowingOriginalText) {
          setBoxDisplayText(item, '…');
        }
      }

      const BATCH_SIZE = 6;
      let i = 0;
      while (i < targetItems.length) {
        if (aborted || currentEpoch !== translateEpoch) return;
        if (statusEl) {
          statusEl.textContent = `🌐 ${t('ocrStatusTranslating', { current: Math.min(i + 1, targetItems.length), total: targetItems.length })}`;
        }

        const firstItem = targetItems[i];
        if (!firstItem || firstItem.deleted) {
          i++;
          continue;
        }
        if (firstItem.blk.isMultiLine || firstItem.blk.text.length > 32 || targetItems.length === 1) {
          const pair = await translateSingleItem(firstItem, targetLang, currentEpoch);
          recordPair(pair, 1);
          i++;
          continue;
        }

        const batch = [];
        while (
          i < targetItems.length &&
          batch.length < BATCH_SIZE
        ) {
          const cand = targetItems[i];
          if (!cand || cand.deleted) {
            i++;
            continue;
          }
          if (cand.blk.isMultiLine || cand.blk.text.length > 32) {
            break;
          }
          batch.push(cand);
          i++;
        }

        if (batch.length === 0) continue;
        if (batch.length === 1) {
          const pair = await translateSingleItem(batch[0], targetLang, currentEpoch);
          recordPair(pair, 1);
          continue;
        }

        const batchText = batch.map(it => it.blk.text.replace(/\r?\n/g, ' ').trim()).join('\n');
        const batchReqId = `img-batch-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`;

        activeOverlayStreamHandlers.set(batchReqId, ({ currentText }) => {
          if (aborted || currentEpoch !== translateEpoch || !currentText) return;
          const partialLines = currentText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
          for (let k = 0; k < Math.min(batch.length, partialLines.length); k++) {
            const batchItem = batch[k];
            if (!batchItem || batchItem.deleted) continue;
            batchItem.boxEl.classList.remove('is-loading');
            batchItem.boxEl.dataset.translatedText = partialLines[k];
            if (!isShowingOriginalText) {
              setBoxDisplayText(batchItem, partialLines[k]);
            }
          }
        });

        let batchSucceeded = false;
        try {
          const batchSourceLang = resolveOverlaySourceLang(batchText);
          const trRes = await chrome.runtime.sendMessage({
            type: 'TRANSLATE_TEXT',
            text: batchText,
            ...(batchSourceLang ? { sourceLang: batchSourceLang } : {}),
            targetLang: targetLang,
            autoSwitchJaEn: false,
            requestId: batchReqId
          });
          activeOverlayStreamHandlers.delete(batchReqId);
          if (aborted || currentEpoch !== translateEpoch) return;

          if (trRes && trRes.ok && trRes.translatedText) {
            const outLines = trRes.translatedText
              .split(/\r?\n/)
              .map(s => s.trim())
              .filter(Boolean);

            if (outLines.length === batch.length) {
              for (let k = 0; k < batch.length; k++) {
                const batchItem = batch[k];
                if (!batchItem || batchItem.deleted) continue;
                batchItem.boxEl.classList.remove('is-loading');
                batchItem.boxEl.dataset.translatedText = outLines[k];
                if (!isShowingOriginalText) {
                  setBoxDisplayText(batchItem, outLines[k]);
                }
              }
              updateDrawerContent();
              const det = (trRes.detectedSourceLang || 'auto').toUpperCase();
              const tgt = (trRes.effectiveTargetLang || targetLang || 'ja').toUpperCase();
              recordPair(`${det} → ${tgt}`, batch.length);
              batchSucceeded = true;
            }
          }
        } catch {
          activeOverlayStreamHandlers.delete(batchReqId);
        }

        if (!batchSucceeded && !aborted && currentEpoch === translateEpoch) {
          for (const item of batch) {
            const pair = await translateSingleItem(item, targetLang, currentEpoch);
            recordPair(pair, 1);
          }
        }
      }

      if (statusEl && !aborted && currentEpoch === translateEpoch) {
        const finalPair = pickBestPair();
        statusEl.textContent = `✅ ${t('ocrStatusDone')}${finalPair ? ` (${finalPair})` : ''}`;
      }
    }

    function startAppendRegionCapture() {
      if (aborted || isSelectingAddRegion) return;
      isSelectingAddRegion = true;
      container.style.visibility = 'hidden';

      const restoreVisibility = () => {
        isSelectingAddRegion = false;
        if (!aborted && document.body.contains(container)) {
          container.style.visibility = '';
        }
      };

      promptScreenAreaSelection({
        hintText: t('areaAddRegionHint'),
        onCancel: restoreVisibility,
        onBeforeCapture: () => {
          const cRect = container.getBoundingClientRect();
          return {
            cRect: {
              left: cRect.left,
              top: cRect.top,
              width: Math.max(1, cRect.width),
              height: Math.max(1, cRect.height)
            }
          };
        },
        onAfterCapture: restoreVisibility,
        onError: (err) => {
          restoreVisibility();
          if (statusEl && !aborted) {
            statusEl.textContent = `⚠️ ${(err && err.message) || String(err)}`;
          }
        },
        onSelected: async (viewportRect, regionDataUrl, extra) => {
          if (aborted || !extra || !extra.cRect) return;
          const { cRect } = extra;
          const leftPct = ((viewportRect.left - cRect.left) / cRect.width) * 100;
          const topPct = ((viewportRect.top - cRect.top) / cRect.height) * 100;
          const widthPct = Math.max(2, (viewportRect.width / cRect.width) * 100);
          const heightPct = Math.max(2, (viewportRect.height / cRect.height) * 100);

          const pendingBlk = {
            text: '',
            bbox: { x0: 0, y0: 0, x1: viewportRect.width, y1: viewportRect.height },
            isMultiLine: viewportRect.height > 36
          };
          const newItem = createOverlayBoxItem({
            blk: pendingBlk,
            leftPct,
            topPct,
            widthPct,
            heightPct,
            renderedBoxW: viewportRect.width,
            renderedBoxH: viewportRect.height
          });
          currentBoxItems.push(newItem);

          if (statusEl) {
            statusEl.textContent = `🔍 ${t('ocrStatusRecognizing')}`;
          }

          try {
            const effectiveReqLang = activeOcrLang || 'auto';
            const ocrRes = await chrome.runtime.sendMessage({
              type: 'OCR_RECOGNIZE_IMAGE',
              imageDataUrl: regionDataUrl,
              ocrLang: effectiveReqLang,
              ocrEngine: currentSettings.ocrEngine || 'ndlocr',
              singleBlock: true
            });
            if (aborted || newItem.deleted) return;

            if (!ocrRes || !ocrRes.ok) {
              throw new Error((ocrRes && ocrRes.error) || t('ocrStatusError'));
            }

            const firstBlock = Array.isArray(ocrRes.blocks) && ocrRes.blocks[0] ? ocrRes.blocks[0] : null;
            const rawBlockText = (firstBlock && firstBlock.text) || ocrRes.text || '';
            const cleanText = cleanOcrBlockText(rawBlockText);
            if (!cleanText || isNoiseOcrBlockText(cleanText)) {
              deleteBoxItem(newItem);
              if (statusEl && !aborted) {
                statusEl.textContent = `ℹ️ ${t('ocrStatusNoTextShort')}`;
              }
              return;
            }

            const isMultiLine = cleanText.includes('\n') || Boolean(firstBlock && firstBlock.isMultiLine) || viewportRect.height > 38;
            newItem.blk = {
              ...(firstBlock || {}),
              text: cleanText,
              isMultiLine
            };
            newItem.boxEl.classList.toggle('is-single-line', !isMultiLine);
            newItem.boxEl.style.setProperty(
              '--plamo-box-font',
              `${computeBoxFontPx(cleanText, isMultiLine, viewportRect.width, viewportRect.height)}px`
            );
            newItem.boxEl.dataset.originalText = cleanText;
            if (isShowingOriginalText) {
              setBoxDisplayText(newItem, cleanText);
            }
            editedOriginalText = null;
            editedTranslatedText = null;
            updateDrawerContent();

            if (statusEl) {
              statusEl.textContent = `🌐 ${t('ocrStatusTranslating', { current: 1, total: 1 })}`;
            }

            const pair = await translateSingleItem(newItem, activeTargetLang, null);
            if (aborted || newItem.deleted) return;
            if (statusEl) {
              statusEl.textContent = `✅ ${t('ocrStatusDone')}${pair ? ` (${pair})` : ''}`;
            }
          } catch (err) {
            deleteBoxItem(newItem);
            if (statusEl && !aborted) {
              statusEl.textContent = `⚠️ ${err.message || String(err)}`;
            }
          }
        }
      });
    }

    await executeOcrPipeline(activeOcrLang);
  }

  function promptScreenAreaSelection({ hintText, onBeforeCapture, onAfterCapture, onCancel, onError, onSelected }) {
    removeAreaSelector();

    const maskId = `plamo-area-mask-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    areaSelectorEl = document.createElement('div');
    areaSelectorEl.className = 'plamo-ext-area-selector';
    areaSelectorEl.innerHTML = `
      <svg class="plamo-ext-area-backdrop" aria-hidden="true">
        <defs>
          <mask id="${maskId}">
            <rect x="0" y="0" width="100%" height="100%" fill="white"></rect>
            <g data-role="mask-cutouts"></g>
          </mask>
        </defs>
        <rect x="0" y="0" width="100%" height="100%" fill="rgba(15, 23, 42, 0.42)" mask="url(#${maskId})"></rect>
      </svg>
      <div class="plamo-ext-area-boxes" data-role="boxes"></div>
      <div class="plamo-ext-area-box" data-role="live-box" style="display:none;"></div>
      <div class="plamo-ext-area-bar" data-role="bar">
        <div class="plamo-ext-area-bar-info">
          <span class="plamo-ext-area-hint" data-role="status">${escapeHtml(hintText || t('areaCaptureHint'))}</span>
          <span class="plamo-ext-area-guide">${escapeHtml(t('areaSelectionGuide'))}</span>
        </div>
        <div class="plamo-ext-area-bar-actions">
          <button type="button" class="plamo-ext-area-btn" data-area-action="undo" disabled>${escapeHtml(t('areaBtnUndo'))}</button>
          <button type="button" class="plamo-ext-area-btn" data-area-action="clear" disabled>${escapeHtml(t('areaBtnClear'))}</button>
          <button type="button" class="plamo-ext-area-btn plamo-ext-area-btn-confirm" data-area-action="confirm" disabled>${escapeHtml(t('areaBtnConfirm'))}</button>
          <button type="button" class="plamo-ext-area-btn plamo-ext-area-btn-cancel" data-area-action="cancel" aria-label="${escapeHtml(t('areaBtnCancel'))}">${escapeHtml(t('areaBtnCancel'))}</button>
        </div>
      </div>
    `;

    const svgNS = 'http://www.w3.org/2000/svg';
    const cutoutsEl = areaSelectorEl.querySelector('[data-role="mask-cutouts"]');
    const boxesLayer = areaSelectorEl.querySelector('[data-role="boxes"]');
    const liveBoxEl = areaSelectorEl.querySelector('[data-role="live-box"]');
    const barEl = areaSelectorEl.querySelector('[data-role="bar"]');
    const statusTextEl = areaSelectorEl.querySelector('[data-role="status"]');
    const undoBtn = areaSelectorEl.querySelector('[data-area-action="undo"]');
    const clearBtn = areaSelectorEl.querySelector('[data-area-action="clear"]');
    const confirmBtn = areaSelectorEl.querySelector('[data-area-action="confirm"]');

    let activeRects = [];
    const history = [];
    let startX = 0;
    let startY = 0;
    let isDragging = false;
    let liveRect = null;
    let hoveredRectIdx = -1;

    const pushHistory = () => {
      history.push(activeRects.map(r => ({ ...r })));
      if (history.length > 30) history.shift();
    };

    const updateHoveredRectClass = (nextIdx) => {
      if (nextIdx === hoveredRectIdx) return;
      if (hoveredRectIdx >= 0 && boxesLayer.children[hoveredRectIdx]) {
        boxesLayer.children[hoveredRectIdx].classList.remove('is-hovered');
      }
      hoveredRectIdx = nextIdx;
      if (hoveredRectIdx >= 0 && boxesLayer.children[hoveredRectIdx]) {
        boxesLayer.children[hoveredRectIdx].classList.add('is-hovered');
      }
    };

    const renderSelection = () => {
      if (!areaSelectorEl) return;

      // Render active selection borders
      boxesLayer.innerHTML = '';
      for (let i = 0; i < activeRects.length; i++) {
        const r = activeRects[i];
        const el = document.createElement('div');
        el.className = i === hoveredRectIdx ? 'plamo-ext-area-rect is-hovered' : 'plamo-ext-area-rect';
        el.style.left = `${r.left}px`;
        el.style.top = `${r.top}px`;
        el.style.width = `${r.width}px`;
        el.style.height = `${r.height}px`;
        boxesLayer.appendChild(el);
      }

      // Render SVG mask cutouts (black = visible/bright, white = dimmed)
      cutoutsEl.innerHTML = '';
      for (const r of activeRects) {
        const cut = document.createElementNS(svgNS, 'rect');
        cut.setAttribute('x', String(r.left));
        cut.setAttribute('y', String(r.top));
        cut.setAttribute('width', String(r.width));
        cut.setAttribute('height', String(r.height));
        cut.setAttribute('rx', '4');
        cut.setAttribute('fill', 'black');
        cutoutsEl.appendChild(cut);
      }

      if (isDragging && liveRect) {
        liveBoxEl.style.left = `${liveRect.left}px`;
        liveBoxEl.style.top = `${liveRect.top}px`;
        liveBoxEl.style.width = `${liveRect.width}px`;
        liveBoxEl.style.height = `${liveRect.height}px`;
        liveBoxEl.style.display = 'block';

        if (liveRect.width >= 4 && liveRect.height >= 4) {
          const previewCut = document.createElementNS(svgNS, 'rect');
          previewCut.setAttribute('x', String(liveRect.left));
          previewCut.setAttribute('y', String(liveRect.top));
          previewCut.setAttribute('width', String(liveRect.width));
          previewCut.setAttribute('height', String(liveRect.height));
          previewCut.setAttribute('rx', '4');
          previewCut.setAttribute('fill', 'black');
          cutoutsEl.appendChild(previewCut);
        }
      } else {
        liveBoxEl.style.display = 'none';
      }

      if (statusTextEl) {
        statusTextEl.textContent = activeRects.length > 0
          ? t('areaSelectionCount', { count: activeRects.length })
          : (hintText || t('areaCaptureHint'));
      }
      if (undoBtn) undoBtn.disabled = history.length === 0;
      if (clearBtn) clearBtn.disabled = activeRects.length === 0;
      if (confirmBtn) confirmBtn.disabled = activeRects.length === 0;
    };

    const cancelSelection = () => {
      removeAreaSelector();
    };

    const confirmSelection = async () => {
      if (activeRects.length === 0) return;
      const rectsToCapture = activeRects.map(r => ({ ...r }));
      const boundingRect = computeSelectionBoundingRect(rectsToCapture);
      if (!boundingRect) return;

      // Suppress cancel callback because we are proceeding to capture
      if (areaSelectorEl) {
        areaSelectorEl._onCancel = null;
      }
      const extraInfo = typeof onBeforeCapture === 'function' ? onBeforeCapture(boundingRect, rectsToCapture) : null;
      removeAreaSelector();

      // Wait animation frames so the selector overlay is gone before capturing screenshot
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

      try {
        let capRes;
        try {
          capRes = await chrome.runtime.sendMessage({ type: 'CAPTURE_VISIBLE_TAB' });
        } finally {
          if (typeof onAfterCapture === 'function') {
            onAfterCapture();
          }
        }

        if (!capRes || !capRes.ok || !capRes.dataUrl) {
          throw new Error((capRes && capRes.error) || 'Failed to capture visible tab');
        }

        const { boundingRect: finalRect, dataUrl: croppedDataUrl } = await cropAndMaskDataUrlRects(capRes.dataUrl, rectsToCapture);
        if (typeof onSelected === 'function') {
          await onSelected(finalRect, croppedDataUrl, extraInfo);
        }
      } catch (err) {
        if (typeof onError === 'function') {
          onError(err);
        } else {
          console.warn('[PLaMo Translate] Area capture error:', err);
        }
      }
    };

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelSelection();
      } else if (e.key === 'Enter' && !isDragging && activeRects.length > 0) {
        e.preventDefault();
        confirmSelection();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && history.length > 0) {
        e.preventDefault();
        activeRects = history.pop();
        renderSelection();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    areaSelectorEl._cleanupKey = () => window.removeEventListener('keydown', onKeyDown, true);
    areaSelectorEl._onCancel = typeof onCancel === 'function' ? onCancel : null;

    if (barEl) {
      barEl.addEventListener('mousedown', (e) => e.stopPropagation());
      barEl.addEventListener('mouseup', (e) => e.stopPropagation());
      barEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      barEl.addEventListener('click', (e) => {
        const actionBtn = e.target.closest('[data-area-action]');
        if (!actionBtn || actionBtn.disabled) return;
        e.preventDefault();
        e.stopPropagation();
        const act = actionBtn.getAttribute('data-area-action');
        if (act === 'confirm') {
          confirmSelection();
        } else if (act === 'undo' && history.length > 0) {
          activeRects = history.pop();
          hoveredRectIdx = -1;
          renderSelection();
        } else if (act === 'clear' && activeRects.length > 0) {
          pushHistory();
          activeRects = [];
          hoveredRectIdx = -1;
          renderSelection();
        } else if (act === 'cancel') {
          cancelSelection();
        }
      });
    }

    areaSelectorEl.addEventListener('mousedown', (e) => {
      if (e.button !== 0) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      isDragging = true;
      updateHoveredRectClass(-1);
      startX = e.clientX;
      startY = e.clientY;
      liveRect = normalizeDragRect(startX, startY, startX, startY);
      areaSelectorEl.classList.add('is-dragging');
      renderSelection();
    });

    areaSelectorEl.addEventListener('mousemove', (e) => {
      if (!isDragging) {
        updateHoveredRectClass(findRectIndexAtPoint(activeRects, e.clientX, e.clientY));
        return;
      }
      e.preventDefault();
      liveRect = normalizeDragRect(startX, startY, e.clientX, e.clientY);
      renderSelection();
    });

    areaSelectorEl.addEventListener('mouseup', (e) => {
      if (!isDragging) return;
      isDragging = false;
      areaSelectorEl.classList.remove('is-dragging');
      e.preventDefault();
      e.stopPropagation();

      const dragRect = normalizeDragRect(startX, startY, e.clientX, e.clientY);
      liveRect = null;

      if (dragRect.width < 12 || dragRect.height < 12) {
        renderSelection();
        return;
      }

      pushHistory();
      activeRects = [...activeRects, dragRect];
      hoveredRectIdx = findRectIndexAtPoint(activeRects, e.clientX, e.clientY);
      renderSelection();
    });

    areaSelectorEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isDragging) return;
      const hitIdx = findRectIndexAtPoint(activeRects, e.clientX, e.clientY);
      if (hitIdx !== -1) {
        pushHistory();
        activeRects = activeRects.filter((_, idx) => idx !== hitIdx);
        hoveredRectIdx = findRectIndexAtPoint(activeRects, e.clientX, e.clientY);
        renderSelection();
      }
    });

    document.body.appendChild(areaSelectorEl);
    renderSelection();
  }

  function startAreaCaptureMode() {
    removeAreaSelector();
    removeFloatingTrigger();
    removePopoverCard();
    removeAllImageOverlays();
    chrome.runtime.sendMessage({ type: 'OCR_PIPELINE_STARTED' }).catch(() => { });

    promptScreenAreaSelection({
      hintText: t('areaCaptureHint'),
      onSelected: async (viewportRect, croppedDataUrl) => {
        const docRect = {
          top: window.scrollY + viewportRect.top,
          left: window.scrollX + viewportRect.left,
          width: viewportRect.width,
          height: viewportRect.height
        };

        await runOcrOverlayPipeline({
          targetImgEl: null,
          docRect,
          getDataUrlFn: async () => croppedDataUrl
        });
      }
    });
  }

  function removeAreaSelector() {
    if (areaSelectorEl) {
      const onCancel = areaSelectorEl._onCancel;
      areaSelectorEl._onCancel = null;
      if (areaSelectorEl._cleanupKey) areaSelectorEl._cleanupKey();
      removeElement(areaSelectorEl);
      areaSelectorEl = null;
      if (typeof onCancel === 'function') {
        onCancel();
      }
    }
  }

  // -------------------------------------------------------------
  // Listen for Background Commands
  // -------------------------------------------------------------
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) return;

    if (message.type === 'PLAMO_OVERLAY_STREAM_CHUNK') {
      const handler = message.requestId ? activeOverlayStreamHandlers.get(message.requestId) : null;
      if (handler) {
        handler(message);
      }
      return;
    }

    if (message.type === 'SHOW_INLINE_TRANSLATION') {
      const selData = getActiveSelection() || {
        text: message.text,
        rect: { top: 120, bottom: 160, left: window.innerWidth / 2 - 180, width: 360, height: 40 },
        isEditable: false
      };
      openPopoverCard(selData);
      sendResponse({ ok: true });
    } else if (message.type === 'TRANSLATE_IMAGE_ELEMENT') {
      let targetImg = lastRightClickedImageEl || hoveredImageEl;
      if (!targetImg && message.srcUrl) {
        const imgs = Array.from(document.querySelectorAll('img'));
        targetImg = imgs.find(img => img.currentSrc === message.srcUrl || img.src === message.srcUrl) || null;
      }
      if (targetImg) {
        translateImageElement(targetImg);
      } else {
        startAreaCaptureMode();
      }
      sendResponse({ ok: true });
    } else if (message.type === 'START_AREA_OCR_TRANSLATION') {
      startAreaCaptureMode();
      sendResponse({ ok: true });
    } else if (message.type === 'CLEAR_OCR_OVERLAYS') {
      removeAllImageOverlays();
      removeAreaSelector();
      sendResponse({ ok: true });
    } else if (message.type === 'PLAMO_REPLACE_TEXT') {
      if (lastSelectionData && message.text) {
        handleTextReplacement(lastSelectionData, message.text);
      }
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
