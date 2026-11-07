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
      optSelectionModeOff: '無効 (右クリックメニューまたはポップアップから翻訳)',

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
      menuTranslatePage: 'PLaMo Translate でこのページを翻訳'
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
      optSelectionModeOff: 'Disabled (Use right-click menu or popup)',

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
      menuTranslatePage: 'Translate this page with PLaMo Translate'
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

