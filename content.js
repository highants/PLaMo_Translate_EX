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

  function cropDataUrlRect(fullDataUrl, viewportRect) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const dpr = window.devicePixelRatio || 1;
        const sx = Math.max(0, Math.round(viewportRect.left * dpr));
        const sy = Math.max(0, Math.round(viewportRect.top * dpr));
        const sw = Math.min(img.width - sx, Math.max(1, Math.round(viewportRect.width * dpr)));
        const sh = Math.min(img.height - sy, Math.max(1, Math.round(viewportRect.height * dpr)));

        const canvas = document.createElement('canvas');
        canvas.width = sw;
        canvas.height = sh;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('Failed to crop captured screenshot'));
      img.src = fullDataUrl;
    });
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
      const pageLang = ((imgEl && imgEl.closest && imgEl.closest('[lang]') && imgEl.closest('[lang]').getAttribute('lang'))
        || document.documentElement.lang
        || '').trim().toLowerCase();
      if (/^en(?:\b|-|_)/.test(pageLang)) {
        return 'en';
      }
      return 'auto';
    };

    let activeOcrLang = detectInitialOcrLang(currentSettings.ocrLang || 'auto', targetImgEl);
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
          <button type="button" class="plamo-ext-img-ov-btn" data-action="toggle-drawer" title="${escapeHtml(t('overlayViewText'))}">📑</button>
          <button type="button" class="plamo-ext-img-ov-btn" data-action="copy-current" title="${escapeHtml(t('overlayCopyCurrentText'))}">📋</button>
          <button type="button" class="plamo-ext-img-ov-btn" data-action="peek" title="${escapeHtml(t('overlayToggleOriginal'))}">👁</button>
          <button type="button" class="plamo-ext-img-ov-btn plamo-ext-img-ov-close" data-action="close" title="${escapeHtml(t('pageBarCloseTitle'))}">×</button>
        </div>
        <div class="plamo-ext-img-ov-drawer" data-role="drawer" style="display:none;">
          <textarea class="plamo-ext-img-ov-textarea" readonly spellcheck="false" placeholder="${escapeHtml(t('ocrStatusNoText'))}"></textarea>
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
    let rawOcrText = '';
    let currentBoxItems = [];
    const translatedSegments = [];
    let aborted = false;

    const toolbarEl = container.querySelector('.plamo-ext-img-ov-toolbar');

    const applyDrawerDimensions = () => {
      if (!drawerEl || !toolbarEl) return;
      const tRect = toolbarEl.getBoundingClientRect();
      const toolbarW = tRect.width || toolbarEl.offsetWidth || 450;
      const toolbarH = tRect.height || toolbarEl.offsetHeight || 40;
      const targetTotalH = Math.round(toolbarW * 0.75); // 4:3 ratio: W : TotalH = 4 : 3
      const maxAllowedH = Math.max(100, window.innerHeight - 80);
      const targetDrawerH = Math.min(maxAllowedH, Math.max(100, targetTotalH - Math.round(toolbarH)));
      drawerEl.style.height = `${targetDrawerH}px`;
    };

    const updateDrawerContent = () => {
      if (!drawerEl || !textareaEl) return;
      const text = isShowingOriginalText
        ? rawOcrText
        : (translatedSegments.filter(Boolean).join('\n\n') || rawOcrText);
      textareaEl.value = text || t('ocrStatusNoText');
    };

    const updateTextMode = (showOriginal) => {
      isShowingOriginalText = Boolean(showOriginal);
      if (toggleSwitch) toggleSwitch.checked = !showOriginal;
      if (labelOcr) labelOcr.classList.toggle('is-active', showOriginal);
      if (labelTrans) labelTrans.classList.toggle('is-active', !showOriginal);
      container.classList.toggle('is-mode-original', showOriginal);

      for (const item of currentBoxItems) {
        if (!item || !item.boxEl) continue;
        item.boxEl.textContent = showOriginal
          ? (item.boxEl.dataset.originalText || '')
          : (item.boxEl.dataset.translatedText || item.boxEl.dataset.originalText || '');
      }
      updateDrawerContent();
    };

    const adjustLayoutPositions = () => {
      if (!toolbarEl || !document.body.contains(container)) return;
      const cRect = container.getBoundingClientRect();
      const tRect = toolbarEl.getBoundingClientRect();

      // Check if toolbar would be clipped on top of window (viewport top < 54px)
      if (cRect.top < 54) {
        container.classList.add('is-toolbar-bottom');
      } else {
        container.classList.remove('is-toolbar-bottom');
      }

      // Check if toolbar overflows right edge of viewport
      const viewportW = window.innerWidth;
      const overflowRight = (cRect.left + tRect.width) - (viewportW - 12);
      if (overflowRight > 0) {
        const maxShift = cRect.left - 12;
        const shift = Math.min(overflowRight, Math.max(0, maxShift));
        toolbarEl.style.left = `${-shift}px`;
      } else {
        toolbarEl.style.left = '0px';
      }

      if (drawerEl && drawerEl.style.display !== 'none') {
        applyDrawerDimensions();
      }
    };

    window.addEventListener('resize', adjustLayoutPositions, { passive: true });

    // Keep overlay synced if anchored to an <img> element
    let syncPositionId = null;
    if (targetImgEl) {
      const syncFn = () => {
        if (!document.body.contains(container) || !document.body.contains(targetImgEl)) return;
        const r = targetImgEl.getBoundingClientRect();
        container.style.top = `${window.scrollY + r.top}px`;
        container.style.left = `${window.scrollX + r.left}px`;
        container.style.width = `${r.width}px`;
        container.style.height = `${r.height}px`;
        adjustLayoutPositions();
      };
      window.addEventListener('resize', syncFn, { passive: true });
      syncPositionId = () => window.removeEventListener('resize', syncFn);
    }

    const cleanupOverlay = () => {
      aborted = true;
      window.removeEventListener('resize', adjustLayoutPositions);
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
      } else if (action === 'peek') {
        isPeekingOriginal = !isPeekingOriginal;
        btn.classList.toggle('is-active', isPeekingOriginal);
        container.classList.toggle('is-peek-original', isPeekingOriginal);
        if (drawerEl && drawerEl.style.display !== 'none') {
          drawerEl.style.display = 'none';
          if (toggleDrawerBtn) {
            toggleDrawerBtn.classList.remove('is-active');
          }
        }
      } else if (action === 'toggle-drawer') {
        const isShown = drawerEl && drawerEl.style.display !== 'none';
        if (drawerEl) {
          if (isShown) {
            drawerEl.style.display = 'none';
            btn.classList.remove('is-active');
          } else {
            drawerEl.style.display = 'flex';
            btn.classList.add('is-active');
            applyDrawerDimensions();
            updateDrawerContent();
            if (textareaEl) {
              textareaEl.focus();
            }
          }
        }
      } else if (action === 'copy-current') {
        const textToCopy = isShowingOriginalText
          ? rawOcrText
          : (translatedSegments.filter(Boolean).join('\n\n') || rawOcrText);
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
    requestAnimationFrame(adjustLayoutPositions);

    let cachedImageDataUrl = null;

    async function executeOcrPipeline(langToUse) {
      canvasLayer.innerHTML = '';
      currentBoxItems = [];
      translatedSegments.length = 0;
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

        if (ocrRes.detectedOcrLang && langSelect) {
          if ((effectiveReqLang === 'auto' && ocrRes.detectedOcrLang === 'en') ||
              (effectiveReqLang === 'ja' && ocrRes.detectedOcrLang === 'ja-tesseract')) {
            activeOcrLang = ocrRes.detectedOcrLang;
            langSelect.value = ocrRes.detectedOcrLang;
          }
        }

        const LEADING_ICON_CLEAN_REGEX = /^(?:[①-⑳❶-❾ⓐ-ⓩⒶ-Ⓩ]\s*|[b-hj-zB-HJ-Z0-9]\s+(?=[A-Za-z\u3040-\u9FFF])|[oO0Qq]\s*(?=[\u3040-\u9FFF])|(?:[8B][=~-]|[:;=~^|_/\\><«»❯❮]{1,3}[=~-]?|[+])\s+(?=[A-Za-z\u3040-\u9FFF]))(?![.\):&])/;
        const blocks = (Array.isArray(ocrRes.blocks) ? ocrRes.blocks : [])
          .map(b => {
            const cleanText = (b.text || '').replace(/^[\s●○◎◆◇■□▲△▼▽・•]+/, '').replace(LEADING_ICON_CLEAN_REGEX, '').trim();
            return { ...b, text: cleanText };
          })
          .filter(b => {
            const t = b.text;
            if (!t) return false;
            // Discard isolated single Latin letter that is not 'a', 'A', 'I' (common icon artifacts: Q, x, v, o, etc.)
            if (t.length === 1 && /[a-zA-Z]/.test(t) && !/^[aAiI]$/.test(t)) return false;
            // Discard pure non-letter/number symbol tokens unless it's a known bullet/list marker
            if (!/[\p{L}\p{N}]/u.test(t) && !/^[•·●○◎◇◆■□▲△▼▽※†‡§¶*–—\-]$/.test(t)) return false;
            return true;
          });
        rawOcrText = (ocrRes.text || blocks.map(b => b.text).join('\n')).trim();
        updateDrawerContent();

        if (blocks.length === 0) {
          if (statusEl) {
            statusEl.textContent = `ℹ️ ${t('ocrStatusNoText')}`;
          }
          return;
        }

        const srcW = ocrRes.width || docRect.width || 1;
        const srcH = ocrRes.height || docRect.height || 1;

        const boxItems = blocks.map((blk, idx) => {
          const leftPct = Math.max(0, Math.min(97, (blk.bbox.x0 / srcW) * 100));
          const topPct = Math.max(0, Math.min(97.5, (blk.bbox.y0 / srcH) * 100));
          const widthPct = Math.max(3, Math.min(100 - leftPct, ((blk.bbox.x1 - blk.bbox.x0) / srcW) * 100));
          const heightPct = Math.max(2.5, Math.min(100 - topPct, ((blk.bbox.y1 - blk.bbox.y0) / srcH) * 100));

          const renderedBoxH = (heightPct / 100) * docRect.height;
          const renderedBoxW = (widthPct / 100) * docRect.width;
          const isSingleLine = !blk.isMultiLine;

          let estimatedFontPx;
          if (isSingleLine) {
            estimatedFontPx = Math.max(10, Math.min(20, Math.round(renderedBoxH * 0.66)));
          } else {
            const areaPerChar = Math.max(36, (renderedBoxW * renderedBoxH) / Math.max(1, blk.text.length));
            estimatedFontPx = Math.max(10, Math.min(19, Math.round(Math.sqrt(areaPerChar) * 0.72)));
          }

          const boxEl = document.createElement('div');
          boxEl.className = `plamo-ext-image-overlay-box is-loading${isSingleLine ? ' is-single-line' : ''}`;
          boxEl.style.left = `${leftPct.toFixed(2)}%`;
          boxEl.style.top = `${topPct.toFixed(2)}%`;
          boxEl.style.setProperty('--plamo-box-w', `${widthPct.toFixed(2)}%`);
          boxEl.style.setProperty('--plamo-box-h', `${heightPct.toFixed(2)}%`);
          boxEl.style.setProperty('--plamo-box-font', `${estimatedFontPx}px`);
          boxEl.dataset.originalText = blk.text;
          boxEl.dataset.translatedText = '…';
          boxEl.textContent = isShowingOriginalText ? blk.text : '…';

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
          return { blk, boxEl, idx };
        });

        currentBoxItems = boxItems;

        if (!userOverrodeTargetLang) {
          const autoEffTarget = (typeof resolveTargetLang === 'function')
            ? resolveTargetLang(
              rawOcrText,
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

    async function translateBoxItems(targetLang) {
      if (currentBoxItems.length === 0 || aborted) return;
      translateEpoch++;
      const currentEpoch = translateEpoch;

      let lastDetectedPair = '';
      for (const item of currentBoxItems) {
        if (!item || !item.boxEl) continue;
        item.boxEl.classList.add('is-loading');
        if (!isShowingOriginalText) {
          item.boxEl.textContent = '…';
        }
      }

      const translateSingleItem = async (item) => {
        if (aborted || currentEpoch !== translateEpoch) return;
        const { blk, boxEl, idx } = item;

        if (targetLang === 'en' && /^[A-Za-z0-9\s&/+#.-]{1,8}$/.test(blk.text)) {
          boxEl.classList.remove('is-loading');
          boxEl.dataset.translatedText = blk.text;
          if (!isShowingOriginalText) {
            boxEl.textContent = blk.text;
          }
          translatedSegments[idx] = blk.text;
          updateDrawerContent();
          return;
        }

        const requestId = `img-ov-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`;
        activeOverlayStreamHandlers.set(requestId, ({ currentText }) => {
          if (aborted || currentEpoch !== translateEpoch || !currentText) return;
          boxEl.classList.remove('is-loading');
          boxEl.dataset.translatedText = currentText;
          if (!isShowingOriginalText) {
            boxEl.textContent = currentText;
          }
        });

        try {
          const trRes = await chrome.runtime.sendMessage({
            type: 'TRANSLATE_TEXT',
            text: blk.text,
            targetLang: targetLang,
            autoSwitchJaEn: false,
            requestId
          });
          activeOverlayStreamHandlers.delete(requestId);
          if (aborted || currentEpoch !== translateEpoch) return;

          boxEl.classList.remove('is-loading');
          if (trRes && trRes.ok && trRes.translatedText) {
            boxEl.dataset.translatedText = trRes.translatedText;
            if (!isShowingOriginalText) {
              boxEl.textContent = trRes.translatedText;
            }
            translatedSegments[idx] = trRes.translatedText;
            updateDrawerContent();
            const det = (trRes.detectedSourceLang || 'auto').toUpperCase();
            const tgt = (trRes.effectiveTargetLang || targetLang || 'ja').toUpperCase();
            lastDetectedPair = `${det} → ${tgt}`;
          } else {
            boxEl.dataset.translatedText = blk.text;
            if (!isShowingOriginalText) {
              boxEl.textContent = blk.text;
            }
            translatedSegments[idx] = blk.text;
            updateDrawerContent();
          }
        } catch {
          activeOverlayStreamHandlers.delete(requestId);
          if (aborted || currentEpoch !== translateEpoch) return;
          boxEl.classList.remove('is-loading');
          boxEl.dataset.translatedText = blk.text;
          if (!isShowingOriginalText) {
            boxEl.textContent = blk.text;
          }
          translatedSegments[idx] = blk.text;
          updateDrawerContent();
        }
      };

      const BATCH_SIZE = 6;
      let i = 0;
      while (i < currentBoxItems.length) {
        if (aborted || currentEpoch !== translateEpoch) return;
        if (statusEl) {
          statusEl.textContent = `🌐 ${t('ocrStatusTranslating', { current: Math.min(i + 1, currentBoxItems.length), total: currentBoxItems.length })}`;
        }

        const firstItem = currentBoxItems[i];
        if (firstItem.blk.isMultiLine || firstItem.blk.text.length > 32 || currentBoxItems.length === 1) {
          await translateSingleItem(firstItem);
          i++;
          continue;
        }

        const batch = [];
        while (
          i < currentBoxItems.length &&
          batch.length < BATCH_SIZE &&
          !currentBoxItems[i].blk.isMultiLine &&
          currentBoxItems[i].blk.text.length <= 32
        ) {
          batch.push(currentBoxItems[i]);
          i++;
        }

        if (batch.length === 1) {
          await translateSingleItem(batch[0]);
          continue;
        }

        const batchText = batch.map(it => it.blk.text.replace(/\r?\n/g, ' ').trim()).join('\n');
        const batchReqId = `img-batch-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`;

        activeOverlayStreamHandlers.set(batchReqId, ({ currentText }) => {
          if (aborted || currentEpoch !== translateEpoch || !currentText) return;
          const partialLines = currentText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
          for (let k = 0; k < Math.min(batch.length, partialLines.length); k++) {
            batch[k].boxEl.classList.remove('is-loading');
            batch[k].boxEl.dataset.translatedText = partialLines[k];
            if (!isShowingOriginalText) {
              batch[k].boxEl.textContent = partialLines[k];
            }
          }
        });

        let batchSucceeded = false;
        try {
          const trRes = await chrome.runtime.sendMessage({
            type: 'TRANSLATE_TEXT',
            text: batchText,
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
                batch[k].boxEl.classList.remove('is-loading');
                batch[k].boxEl.dataset.translatedText = outLines[k];
                if (!isShowingOriginalText) {
                  batch[k].boxEl.textContent = outLines[k];
                }
                translatedSegments[batch[k].idx] = outLines[k];
              }
              updateDrawerContent();
              const det = (trRes.detectedSourceLang || 'auto').toUpperCase();
              const tgt = (trRes.effectiveTargetLang || targetLang || 'ja').toUpperCase();
              lastDetectedPair = `${det} → ${tgt}`;
              batchSucceeded = true;
            }
          }
        } catch {
          activeOverlayStreamHandlers.delete(batchReqId);
        }

        if (!batchSucceeded && !aborted && currentEpoch === translateEpoch) {
          for (const item of batch) {
            await translateSingleItem(item);
          }
        }
      }

      if (statusEl && !aborted && currentEpoch === translateEpoch) {
        statusEl.textContent = `✅ ${t('ocrStatusDone')}${lastDetectedPair ? ` (${lastDetectedPair})` : ''}`;
      }
    }

    await executeOcrPipeline(activeOcrLang);
  }

  function startAreaCaptureMode() {
    removeAreaSelector();
    removeFloatingTrigger();
    removePopoverCard();
    removeAllImageOverlays();
    chrome.runtime.sendMessage({ type: 'OCR_PIPELINE_STARTED' }).catch(() => { });

    areaSelectorEl = document.createElement('div');
    areaSelectorEl.className = 'plamo-ext-area-selector';
    areaSelectorEl.innerHTML = `
      <div class="plamo-ext-area-hint">${escapeHtml(t('areaCaptureHint'))}</div>
      <div class="plamo-ext-area-box" style="display:none;"></div>
    `;

    const boxEl = areaSelectorEl.querySelector('.plamo-ext-area-box');
    let startX = 0;
    let startY = 0;
    let isDragging = false;

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        removeAreaSelector();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    areaSelectorEl._cleanupKey = () => window.removeEventListener('keydown', onKeyDown, true);

    areaSelectorEl.addEventListener('mousedown', (e) => {
      if (e.button !== 0) {
        removeAreaSelector();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      boxEl.style.left = `${startX}px`;
      boxEl.style.top = `${startY}px`;
      boxEl.style.width = '0px';
      boxEl.style.height = '0px';
      boxEl.style.display = 'block';
    });

    areaSelectorEl.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      e.preventDefault();
      const curX = e.clientX;
      const curY = e.clientY;
      const left = Math.min(startX, curX);
      const top = Math.min(startY, curY);
      const width = Math.abs(curX - startX);
      const height = Math.abs(curY - startY);
      boxEl.style.left = `${left}px`;
      boxEl.style.top = `${top}px`;
      boxEl.style.width = `${width}px`;
      boxEl.style.height = `${height}px`;
    });

    areaSelectorEl.addEventListener('mouseup', async (e) => {
      if (!isDragging) return;
      isDragging = false;
      e.preventDefault();
      e.stopPropagation();

      const curX = e.clientX;
      const curY = e.clientY;
      const viewportRect = {
        left: Math.min(startX, curX),
        top: Math.min(startY, curY),
        width: Math.abs(curX - startX),
        height: Math.abs(curY - startY)
      };

      removeAreaSelector();

      if (viewportRect.width < 16 || viewportRect.height < 16) {
        return;
      }

      // Wait one animation frame so the selector overlay is gone before capturing screenshot
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

      const docRect = {
        top: window.scrollY + viewportRect.top,
        left: window.scrollX + viewportRect.left,
        width: viewportRect.width,
        height: viewportRect.height
      };

      await runOcrOverlayPipeline({
        targetImgEl: null,
        docRect,
        getDataUrlFn: async () => {
          const capRes = await chrome.runtime.sendMessage({ type: 'CAPTURE_VISIBLE_TAB' });
          if (!capRes || !capRes.ok || !capRes.dataUrl) {
            throw new Error((capRes && capRes.error) || 'Failed to capture visible tab');
          }
          return await cropDataUrlRect(capRes.dataUrl, viewportRect);
        }
      });
    });

    document.body.appendChild(areaSelectorEl);
  }

  function removeAreaSelector() {
    if (areaSelectorEl) {
      if (areaSelectorEl._cleanupKey) areaSelectorEl._cleanupKey();
      removeElement(areaSelectorEl);
      areaSelectorEl = null;
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
