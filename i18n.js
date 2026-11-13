/**
 * PLaMo Translate - Lightweight i18n Localization Module
 * Supports Japanese (ja) and English (en)
 */

(function (global) {
  'use strict';

  const MESSAGES = {
    ja: {
      // Header & Navigation
      brandTitle: 'PLaMo Translate',
      brandSubtitle: 'pfnet/plamo-3-translate',
      statusDisconnected: '未接続',
      statusConnected: '接続中',
      btnOpenTab: 'タブで全画面表示',
      btnToggleSettings: '設定を開く',
      btnCloseSettings: '設定を閉じる',

      // Quick Tools Bar
      btnGrabSelection: '選択テキスト',
      btnGrabSelectionTitle: '閲覧中タブの選択テキストを取得して翻訳',
      btnPageTranslate: 'ページ全体翻訳',
      btnPageTranslateTitle: '閲覧中タブのWebページ全体を翻訳',

      // Language & Style Controls
      labelSourceLang: '原文',
      optAutoDetect: '🌐 自動検出',
      btnSwapLang: '言語を入れ替え',
      labelTargetLang: '訳文',
      labelForm: '文体 (敬体/常体)',
      formNone: '指定なし',
      formPolite: '丁寧 (です・ます)',
      formPlain: '常体 (だ・である)',
      formEasy: 'やさしい日本語',
      formNoneShort: '文体:標準',
      formPoliteShort: '丁寧語',
      formPlainShort: '常体',
      formEasyShort: 'やさしい日本語',
      formTitleTooltip: '日本語の文体 (丁寧語: です・ます / 常体: だ・である)',

      // Input Card
      inputCardTitle: '原文テキスト',
      charCountUnit: '{n} 文字',
      btnClear: 'クリア',
      inputPlaceholder: '翻訳したいテキストを入力... (Ctrl + Enter で翻訳)',
      detailsContextGlossary: '🛠️ コンテキスト & 用語集 (Glossary)',
      labelContext: 'コンテキスト (Context)',
      placeholderContext: '例: ソフトウェア開発の技術ドキュメント',
      labelGlossary: '用語集 (Glossary - 1行に1組: 原文=訳語)',
      placeholderGlossary: '例:\nLLM=大規模言語モデル\nPrompt=プロンプト\nrepository=リポジトリ',
      btnTranslate: '翻訳する (Ctrl+Enter)',

      // Output Card
      outputCardTitle: '訳文',
      btnCopy: '📋 コピー',
      btnCopySuccess: '✓ コピー完了',
      loadingText: 'PLaMo でローカル翻訳中...',
      errorTitle: '⚠️ 翻訳エラーが発生しました',
      errorHint: 'LM Studio サーバーが起動し、plamo-3-translate がロードされているか確認してください。',
      outputPlaceholder: 'ここに翻訳結果が表示されます',
      promptDetailsTitle: '🔍 送信された PFML3 プロンプトを確認',

      // Settings Panel
      settingsTitle: '⚙️ 拡張機能設定',
      labelUiLang: 'UI 言語 (Interface Language)',
      optUiLangAuto: '自動 (ブラウザ依存 / Auto)',
      optUiLangJa: '日本語 (Japanese)',
      optUiLangEn: 'English (英語)',
      descUiLang: 'ポップアップや画面内翻訳カードの表示言語を切り替えます',

      labelEngineMode: '推論エンジン (Inference Mode)',
      optEngineLmStudio: 'モードA: LM Studio ローカルサーバー',
      optEngineWllama: 'モードB: ブラウザ内蔵 Wllama 0.8B (Offscreen)',
      descEngineMode: 'LM Studio サーバー経由か、ブラウザ単体 (Wllama WebGPU/WASM) で推論するかを切り替えます',
      modeSwitchLmStudio: '🖥️ LM Studio',
      modeSwitchWllama: '🌐 ブラウザ内蔵',

      labelWllamaModel: 'ブラウザ内蔵モデル (PLaMo 3 Translate 0.8B GGUF)',
      placeholderWllamaUrl: 'GGUF モデルの直リンク URL を入力...',
      descWllamaModel: '初回のみ Hugging Face からダウンロードされ、ブラウザの OPFS にキャッシュされます',
      labelWllamaWebGpu: 'WebGPU ハードウェアアクセラレーションを有効化 (推奨)',
      descWllamaWebGpu: '非対応環境または初期化失敗時は自動的に WASM (CPU) へフォールバックします',
      btnWllamaLoad: '📥 モデルをロード / DL',
      btnWllamaUnload: '⏹ メモリ解放',
      btnWllamaClearCache: '🗑 キャッシュ削除',
      wllamaStatusIdle: '未ロード（翻訳時または上のボタンでロードされます）',
      wllamaStatusReady: '✓ ブラウザ内にロード完了',

      labelBaseUrl: 'LM Studio サーバー URL',
      btnTestConnection: '🔌 接続テスト',
      descBaseUrl: 'LM Studio の Local Server (デフォルトポート 1234)',

      labelModel: '使用モデル',
      optModelAuto: '(ロード済みモデルを自動検出)',
      placeholderModelCustom: 'モデル識別名を手動入力...',
      descModel: 'LM Studio にロードされているモデルを選択または手動指定',

      labelApiMode: 'API 呼び出しモード',
      optApiModeCompletions: 'Completions API (/v1/completions) - PFML3推奨',
      optApiModeChat: 'Chat API (/v1/chat/completions)',
      descApiMode: 'PLaMo 3 Translate は PFML3 形式の Completions 呼び出しで最も高い精度を発揮します',

      labelSelectionMode: 'Webページ内での選択テキスト翻訳',
      optSelectionModeButton: 'アイコンボタンを表示 (クリックで翻訳カードを開く)',
      optSelectionModeInstant: '選択時に即座に翻訳カードを開く',
      optSelectionModeOff: '無効 (右クリックメニューまたはサイドバーから翻訳)',

      labelInlineDisplayMode: 'インライン翻訳の表示形式',
      optInlineModeWindow: 'フロート小窓 (P-core最速 / 推奨)',
      optInlineModeIframe: 'ページ内カード (iframe)',
      descInlineDisplayMode: 'デスクトップ小窓にすることでWindowsの効率モード(EcoQoS)を回避し、メイン窓と同じ最高速で推論します',

      labelAutoSwitchJaEn: '日本語を入力した時は自動的に英語へ翻訳する',
      descAutoSwitchJaEn: '翻訳先が「日本語」の状態で日本語を入力した場合、自動で英語に反転します',

      labelTemperature: 'Temperature (温度)',
      descTemperature: '0: 最も確定的・一貫',

      labelMaxTokens: 'Max Tokens',
      descMaxTokens: '最大生成トークン数',

      btnSaveSettings: '設定を保存',
      saveStatusSuccess: '✓ 保存しました',

      // In-page Floating Card
      floatingTriggerTitle: 'PLaMo で翻訳',
      cardTranslating: 'PLaMo で翻訳中...',
      btnReload: '🔄 再翻訳',
      btnReplace: '✍️ 置換',
      showSource: '原文を表示 ({n}文字)',
      autoSwitchedBadge: '⚡ 日本語を検出したため 英語 へ自動切替しました',
      errorHintInline: 'LM Studio (ポート 1234) でサーバーが実行されているか確認してください。',

      // Whole-Page Translation Bar
      pageTranslatingProgress: 'PLaMo ページ翻訳中... ({current}/{total})',
      pageTranslationComplete: 'PLaMo ページ翻訳完了 ({total}件)',
      pageTranslationPaused: 'PLaMo ページ翻訳一時停止中',
      btnPause: '一時停止',
      btnResume: '再開',
      btnHideOriginal: '原文を隠す',
      btnShowOriginal: '原文を表示',
      btnRestore: '元に戻す',

      // Context Menus
      menuTranslateSelection: 'PLaMo Translate で選択テキストを翻訳',
      menuTranslateImage: 'PLaMoでこの画像を翻訳 (OCR重ね表示)',
      menuTranslateArea: 'PLaMoで画面範囲をドラッグして翻訳 (OCR)',
      menuTranslatePage: 'PLaMo Translate でこのページを翻訳',

      // Image Translation (Overlay & OCR)
      overlayToggleOriginal: '原文 / 翻訳の表示切替',
      imgHoverTranslateBtn: '画像翻訳',
      ocrStatusRecognizing: '文字認識中...',
      ocrStatusTranslating: '翻訳中 ({current}/{total})',
      ocrStatusDone: '翻訳完了',
      ocrStatusNoText: '画像内にテキストが見つかりませんでした',
      ocrStatusNoTextShort: '文字未検出',
      ocrStatusError: '文字認識に失敗',
      areaCaptureHint: '翻訳したい画像・画面範囲をドラッグして選択してください (Escでキャンセル)',
      labelImageHoverBtn: '画像にマウスを乗せた時に「🖼️ 画像翻訳」ボタンを表示する',
      labelOcrEngine: '画像翻訳のOCRエンジン',
      ocrEngineNdl: 'NDLOCR-Lite (国立国会図書館・日本語高精度 / 推奨)',
      ocrEngineTesseract: 'Tesseract.js (軽量・英語向け)',
      labelOcrLang: '抽出言語 (手動指定)',
      descOcrLang: '※英語や多言語は標準でTesseractを使用し、日本語はNDLOCR-LiteとTesseractの両方を利用できます。',
      optOcrLangAuto: 'OCR: 自動 (NDLOCR / 英:Tesseract)',
      optOcrLangAutoTesseract: 'OCR: 自動 (Tesseract)',
      optOcrLangJa: 'OCR: 日本語 (NDLOCR-Lite)',
      optOcrLangJaTesseract: 'OCR: 日本語 (Tesseract)',
      optOcrLangEn: 'OCR: 英語 (Tesseract)',
      optOcrLangZh: 'OCR: 中国語(簡) (Tesseract)',
      optOcrLangZhTw: 'OCR: 中国語(繁) (Tesseract)',
      optOcrLangKo: 'OCR: 韓国語 (Tesseract)',
      optOcrLangFr: 'OCR: フランス語 (Tesseract)',
      optOcrLangDe: 'OCR: ドイツ語 (Tesseract)',
      optOcrLangEs: 'OCR: スペイン語 (Tesseract)',
      optOcrLangRu: 'OCR: ロシア語 (Tesseract)',
      optTargetLangJa: '訳: 日本語',
      optTargetLangEn: '訳: 英語',
      optTargetLangZhHans: '訳: 中国語(簡)',
      optTargetLangZhHant: '訳: 中国語(繁)',
      optTargetLangKo: '訳: 韓国語',
      optTargetLangFr: '訳: フランス語',
      optTargetLangDe: '訳: ドイツ語',
      optTargetLangEs: '訳: スペイン語',
      optTargetLangIt: '訳: イタリア語',
      optTargetLangRu: '訳: ロシア語',
      optTargetLangVi: '訳: ベトナム語',
      optTargetLangTh: '訳: タイ語',
      optTargetLangId: '訳: インドネシア語',
      optTargetLangJaEasy: '訳: やさしい日本語',
      overlayCopyCurrentText: '表示中のテキストをコピー',
      overlayViewText: '全文を表示・編集 (展開)',
      overlayDrawerEditLabel: '抽出・翻訳の全文テキスト（編集可能）',
      overlayCloseDrawer: '閉じる',
      overlayDeleteBlock: 'この抽出ブロックを削除（右クリックでも削除可）',
      overlayAddRegion: '範囲を追加して1ブロックで抽出・翻訳',
      toggleLabelOriginal: '原文',
      toggleLabelTranslation: '翻訳',
      overlayToggleTextMode: '原文 ↔ 翻訳の表示切替',
      overlayModeOcr: '原文',
      overlayModeTrans: '翻訳',
      btnAreaOcrTranslate: '📷 範囲選択OCR翻訳',
      btnAreaOcrTranslateTitle: 'ページ上の画像や図表をドラッグ選択してオーバースクリーン翻訳',
      areaAddRegionHint: '追加で抽出・翻訳したい範囲をドラッグ選択し「範囲を確定」を押してください',
      areaSelectionCount: '{count}件の範囲を選択中',
      areaSelectionGuide: 'ドラッグ: 範囲を追加 · 選択範囲を右クリック: 削除 · Enter: 確定 · Esc: キャンセル',
      areaBtnConfirm: '範囲を確定（抽出開始）',
      areaBtnUndo: '戻す',
      areaBtnClear: 'クリア',
      areaBtnCancel: 'キャンセル'
    },

    en: {
      // Header & Navigation
      brandTitle: 'PLaMo Translate',
      brandSubtitle: 'pfnet/plamo-3-translate',
      statusDisconnected: 'Disconnected',
      statusConnected: 'Connected',
      btnOpenTab: 'Open in Full Tab',
      btnToggleSettings: 'Settings',
      btnCloseSettings: 'Close Settings',

      // Quick Tools Bar
      btnGrabSelection: 'Grab Selection',
      btnGrabSelectionTitle: 'Grab selected text from the active tab and translate',
      btnPageTranslate: 'Translate Whole Page',
      btnPageTranslateTitle: 'Translate the entire web page in the active tab',

      // Language & Style Controls
      labelSourceLang: 'Source',
      optAutoDetect: '🌐 Auto Detect',
      btnSwapLang: 'Swap languages',
      labelTargetLang: 'Target',
      labelForm: 'Form (Polite/Plain)',
      formNone: 'Default',
      formPolite: 'Polite (Desu/Masu)',
      formPlain: 'Plain (Da/Dearu)',
      formEasy: 'Easy Japanese',
      formNoneShort: 'Style:Default',
      formPoliteShort: 'Polite',
      formPlainShort: 'Plain',
      formEasyShort: 'Easy Japanese',
      formTitleTooltip: 'Japanese Sentence Style (Polite: desu/masu / Plain: da/dearu)',

      // Input Card
      inputCardTitle: 'Source Text',
      charCountUnit: '{n} chars',
      btnClear: 'Clear',
      inputPlaceholder: 'Enter text to translate... (Ctrl + Enter to translate)',
      detailsContextGlossary: '🛠️ Context & Glossary',
      labelContext: 'Context',
      placeholderContext: 'e.g., Technical software engineering documentation',
      labelGlossary: 'Glossary (1 pair per line: source=target)',
      placeholderGlossary: 'e.g.:\nLLM=Large Language Model\nPrompt=Prompt\nrepository=Repository',
      btnTranslate: 'Translate (Ctrl+Enter)',

      // Output Card
      outputCardTitle: 'Translation',
      btnCopy: '📋 Copy',
      btnCopySuccess: '✓ Copied!',
      loadingText: 'Translating locally with PLaMo...',
      errorTitle: '⚠️ Translation Error',
      errorHint: 'Make sure LM Studio local server is running and a plamo-3-translate model is loaded.',
      outputPlaceholder: 'Translation output will appear here',
      promptDetailsTitle: '🔍 View Submitted PFML3 Prompt',

      // Settings Panel
      settingsTitle: '⚙️ Extension Settings',
      labelUiLang: 'UI Language',
      optUiLangAuto: 'Auto (Browser default)',
      optUiLangJa: 'Japanese (日本語)',
      optUiLangEn: 'English',
      descUiLang: 'Switch display language for popup and in-page UI',

      labelEngineMode: 'Inference Engine Mode',
      optEngineLmStudio: 'Mode A: LM Studio Local Server',
      optEngineWllama: 'Mode B: In-Browser Wllama 0.8B (Offscreen)',
      descEngineMode: 'Choose between LM Studio local server or standalone in-browser Wllama (WebGPU/WASM)',
      modeSwitchLmStudio: '🖥️ LM Studio',
      modeSwitchWllama: '🌐 In-Browser (0.8B)',

      labelWllamaModel: 'In-Browser Model (PLaMo 3 Translate 0.8B GGUF)',
      placeholderWllamaUrl: 'Enter direct GGUF model URL...',
      descWllamaModel: 'Downloaded once from Hugging Face and cached locally in browser OPFS storage',
      labelWllamaWebGpu: 'Enable WebGPU Hardware Acceleration (Recommended)',
      descWllamaWebGpu: 'Automatically falls back to WASM (CPU) if WebGPU is unavailable',
      btnWllamaLoad: '📥 Load / Download Model',
      btnWllamaUnload: '⏹ Unload Memory',
      btnWllamaClearCache: '🗑 Clear Cache',
      wllamaStatusIdle: 'Not loaded in memory (loads on translate or button click)',
      wllamaStatusReady: '✓ Model loaded in browser memory',

      labelBaseUrl: 'LM Studio Server URL',
      btnTestConnection: '🔌 Test Connection',
      descBaseUrl: 'LM Studio Local Server endpoint (Default port: 1234)',

      labelModel: 'Model',
      optModelAuto: '(Auto-detect loaded model)',
      placeholderModelCustom: 'Enter custom model identifier...',
      descModel: 'Select or manually specify the model loaded in LM Studio',

      labelApiMode: 'API Call Mode',
      optApiModeCompletions: 'Completions API (/v1/completions) - Recommended',
      optApiModeChat: 'Chat API (/v1/chat/completions)',
      descApiMode: 'PLaMo 3 Translate achieves maximum accuracy via raw PFML3 completion calls',

      labelSelectionMode: 'In-Page Selection Translation',
      optSelectionModeButton: 'Show floating icon button (Click to translate)',
      optSelectionModeInstant: 'Open translation card immediately on selection',
      optSelectionModeOff: 'Disabled (Use right-click menu or side panel)',

      labelInlineDisplayMode: 'Inline Translation Display Style',
      optInlineModeWindow: 'Floating Window (P-core Fastest / Recommended)',
      optInlineModeIframe: 'In-Page Card (iframe)',
      descInlineDisplayMode: 'Uses a desktop popup window to bypass Windows Efficiency Mode (EcoQoS) for maximum inference speed',

      labelAutoSwitchJaEn: 'Auto-switch target to English when Japanese text is input',
      descAutoSwitchJaEn: 'If target is Japanese and input text is Japanese, target automatically flips to English',

      labelTemperature: 'Temperature',
      descTemperature: '0: Most deterministic & consistent',

      labelMaxTokens: 'Max Tokens',
      descMaxTokens: 'Maximum output tokens generated per request',

      btnSaveSettings: 'Save Settings',
      saveStatusSuccess: '✓ Settings saved',

      // In-page Floating Card
      floatingTriggerTitle: 'Translate with PLaMo',
      cardTranslating: 'Translating with PLaMo...',
      btnReload: '🔄 Retranslate',
      btnReplace: '✍️ Replace',
      showSource: 'Show original ({n} chars)',
      autoSwitchedBadge: '⚡ Japanese detected: target automatically switched to English',
      errorHintInline: 'Please verify that LM Studio server is running on port 1234.',

      // Whole-Page Translation Bar
      pageTranslatingProgress: 'PLaMo Translating Page... ({current}/{total})',
      pageTranslationComplete: 'PLaMo Page Translation Complete ({total} items)',
      pageTranslationPaused: 'PLaMo Page Translation Paused',
      btnPause: 'Pause',
      btnResume: 'Resume',
      btnHideOriginal: 'Hide Original',
      btnShowOriginal: 'Show Original',
      btnRestore: 'Restore',

      // Context Menus
      menuTranslateSelection: 'Translate selection with PLaMo Translate',
      menuTranslateImage: 'Translate This Image with PLaMo (OCR Overlay)',
      menuTranslateArea: 'Select Screen Area to Translate with PLaMo (OCR)',
      menuTranslatePage: 'Translate this page with PLaMo Translate',

      // Image Translation (Overlay & OCR)
      overlayToggleOriginal: 'Toggle Original / Translation',
      imgHoverTranslateBtn: 'Translate Image',
      ocrStatusRecognizing: 'OCR scanning...',
      ocrStatusTranslating: 'Translating ({current}/{total})',
      ocrStatusDone: 'Done',
      ocrStatusNoText: 'No recognizable text found in image',
      ocrStatusNoTextShort: 'No text',
      ocrStatusError: 'OCR failed',
      areaCaptureHint: 'Drag to select the screen area or image to translate (Press Esc to cancel)',
      labelImageHoverBtn: 'Show "🖼️ Translate Image" button when hovering over images',
      labelOcrEngine: 'Image OCR Engine',
      ocrEngineNdl: 'NDLOCR-Lite (NDL, high-accuracy Japanese / Recommended)',
      ocrEngineTesseract: 'Tesseract.js (Lightweight, English-oriented)',
      labelOcrLang: 'Extraction Language (Manual)',
      descOcrLang: '※English and other languages use Tesseract by default. Japanese supports both NDLOCR-Lite and Tesseract.',
      optOcrLangAuto: 'OCR: Auto (NDL / En:Tesseract)',
      optOcrLangAutoTesseract: 'OCR: Auto (Tesseract)',
      optOcrLangJa: 'OCR: Japanese (NDLOCR-Lite)',
      optOcrLangJaTesseract: 'OCR: Japanese (Tesseract)',
      optOcrLangEn: 'OCR: English (Tesseract)',
      optOcrLangZh: 'OCR: Chinese(Simp) (Tesseract)',
      optOcrLangZhTw: 'OCR: Chinese(Trad) (Tesseract)',
      optOcrLangKo: 'OCR: Korean (Tesseract)',
      optOcrLangFr: 'OCR: French (Tesseract)',
      optOcrLangDe: 'OCR: German (Tesseract)',
      optOcrLangEs: 'OCR: Spanish (Tesseract)',
      optOcrLangRu: 'OCR: Russian (Tesseract)',
      optTargetLangJa: 'To: Japanese',
      optTargetLangEn: 'To: English',
      optTargetLangZhHans: 'To: Chinese (Simp)',
      optTargetLangZhHant: 'To: Chinese (Trad)',
      optTargetLangKo: 'To: Korean',
      optTargetLangFr: 'To: French',
      optTargetLangDe: 'To: German',
      optTargetLangEs: 'To: Spanish',
      optTargetLangIt: 'To: Italian',
      optTargetLangRu: 'To: Russian',
      optTargetLangVi: 'To: Vietnamese',
      optTargetLangTh: 'To: Thai',
      optTargetLangId: 'To: Indonesian',
      optTargetLangJaEasy: 'To: Easy JA',
      overlayCopyCurrentText: 'Copy Displayed Text',
      overlayViewText: 'View & Edit Full Text',
      overlayDrawerEditLabel: 'Full extracted / translated text (editable)',
      overlayCloseDrawer: 'Close',
      overlayDeleteBlock: 'Delete this extracted block (or right-click)',
      overlayAddRegion: 'Add selection region as 1 block',
      toggleLabelOriginal: 'Original',
      toggleLabelTranslation: 'Translation',
      overlayToggleTextMode: 'Toggle Original / Translation',
      overlayModeOcr: 'Original',
      overlayModeTrans: 'Translation',
      btnAreaOcrTranslate: '📷 Area OCR Translate',
      btnAreaOcrTranslateTitle: 'Drag-select any image or region on the page to OCR & overlay translate',
      areaAddRegionHint: 'Drag-select region(s) to extract & translate as 1 block, then press Confirm',
      areaSelectionCount: '{count} region(s) selected',
      areaSelectionGuide: 'Drag: Add area · Right-click area: Delete · Enter: Confirm · Esc: Cancel',
      areaBtnConfirm: 'Confirm & Extract',
      areaBtnUndo: 'Undo',
      areaBtnClear: 'Clear',
      areaBtnCancel: 'Cancel'
    }
  };

  /**
   * Determine effective UI language code ('ja' or 'en')
   * @param {string} preference - 'auto' | 'ja' | 'en'
   * @returns {'ja'|'en'}
   */
  function resolveUiLang(preference) {
    if (preference === 'ja') return 'ja';
    if (preference === 'en') return 'en';

    // Auto-detect based on navigator language
    if (typeof navigator !== 'undefined' && navigator.language) {
      if (navigator.language.toLowerCase().startsWith('ja')) {
        return 'ja';
      }
    }
    return 'en';
  }

  /**
   * Get localized string by key
   * @param {string} key
   * @param {Record<string, any>} [params]
   * @param {'ja'|'en'} [lang]
   * @returns {string}
   */
  function t(key, params = {}, lang = 'ja') {
    const dict = MESSAGES[lang] || MESSAGES.en;
    let text = dict[key] || MESSAGES.en[key] || key;

    if (params && typeof params === 'object') {
      Object.keys(params).forEach(pKey => {
        text = text.replace(new RegExp(`\\{${pKey}\\}`, 'g'), params[pKey]);
      });
    }
    return text;
  }

  // Export for Browser window and ServiceWorker global scope
  const PlamoI18n = {
    MESSAGES,
    resolveUiLang,
    t
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PlamoI18n;
  } else {
    global.PlamoI18n = PlamoI18n;
  }
})(typeof self !== 'undefined' ? self : this);

