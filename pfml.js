/**
 * PLaMo-3-Translate-2B PFML3 Prompt Builder & LM Studio API Client
 * Specification: https://huggingface.co/pfnet/plamo-3-translate-2b
 */

// PFML3 Special Tokens
const PFML_TAG = '<|plamo:tag|>';
const PFML_MSG = '<|plamo:msg|>';
const PFML_KEY = '<|plamo:key|>';
const PFML_VAL = '<|plamo:val|>';

// Stop tokens for model generation
const STOP_TOKENS = [
  '<|plamo:tag|>',
  '<|plamo:bos|>',
  '<|plamo:eos|>',
  '<|endoftext|>'
];

// Official 53 Supported Languages for pfnet/plamo-3-translate-2b
// Prioritized with common languages at the top
const PLAMO_LANGUAGES = [
  // Frequently used
  { code: 'ja', name: '日本語', enName: 'Japanese' },
  { code: 'en', name: '英語', enName: 'English' },
  { code: 'zh', name: '中国語', enName: 'Chinese' },
  { code: 'ko', name: '韓国語', enName: 'Korean' },
  { code: 'fr', name: 'フランス語', enName: 'French' },
  { code: 'de', name: 'ドイツ語', enName: 'German' },
  { code: 'es', name: 'スペイン語', enName: 'Spanish' },
  { code: 'it', name: 'イタリア語', enName: 'Italian' },
  { code: 'ru', name: 'ロシア語', enName: 'Russian' },
  { code: 'vi', name: 'ベトナム語', enName: 'Vietnamese' },
  { code: 'th', name: 'タイ語', enName: 'Thai' },
  { code: 'id', name: 'インドネシア語', enName: 'Indonesian' },
  { code: 'ar', name: 'アラビア語', enName: 'Arabic' },
  { code: 'nl', name: 'オランダ語', enName: 'Dutch' },
  { code: 'pl', name: 'ポーランド語', enName: 'Polish' },
  { code: 'pt', name: 'ポルトガル語', enName: 'Portuguese' },
  { code: 'tr', name: 'トルコ語', enName: 'Turkish' },
  { code: 'hi', name: 'ヒンディー語', enName: 'Hindi' },
  { code: 'uk', name: 'ウクライナ語', enName: 'Ukrainian' },

  // Remaining supported languages
  { code: 'az', name: 'アゼルバイジャン語', enName: 'Azerbaijani' },
  { code: 'be', name: 'ベラルーシ語', enName: 'Belarusian' },
  { code: 'bg', name: 'ブルガリア語', enName: 'Bulgarian' },
  { code: 'bn', name: 'ベンガル語', enName: 'Bengali' },
  { code: 'ca', name: 'カタルーニャ語', enName: 'Catalan' },
  { code: 'ceb', name: 'セブアノ語', enName: 'Cebuano' },
  { code: 'et', name: 'エストニア語', enName: 'Estonian' },
  { code: 'eu', name: 'バスク語', enName: 'Basque' },
  { code: 'fa', name: 'ペルシャ語', enName: 'Persian' },
  { code: 'gu', name: 'グジャラート語', enName: 'Gujarati' },
  { code: 'he', name: 'ヘブライ語', enName: 'Hebrew' },
  { code: 'hr', name: 'クロアチア語', enName: 'Croatian' },
  { code: 'hu', name: 'ハンガリー語', enName: 'Hungarian' },
  { code: 'hy', name: 'アルメニア語', enName: 'Armenian' },
  { code: 'jv', name: 'ジャワ語', enName: 'Javanese' },
  { code: 'ka', name: 'ジョージア語', enName: 'Georgian' },
  { code: 'kk', name: 'カザフ語', enName: 'Kazakh' },
  { code: 'km', name: 'クメール語', enName: 'Khmer' },
  { code: 'lt', name: 'リトアニア語', enName: 'Lithuanian' },
  { code: 'lv', name: 'ラトビア語', enName: 'Latvian' },
  { code: 'ml', name: 'マラヤーラム語', enName: 'Malayalam' },
  { code: 'mr', name: 'マラーティー語', enName: 'Marathi' },
  { code: 'ms', name: 'マレー語', enName: 'Malay' },
  { code: 'my', name: 'ミャンマー語', enName: 'Burmese' },
  { code: 'ne', name: 'ネパール語', enName: 'Nepali' },
  { code: 'pa', name: 'パンジャブ語', enName: 'Punjabi' },
  { code: 'si', name: 'シンハラ語', enName: 'Sinhala' },
  { code: 'sk', name: 'スロバキア語', enName: 'Slovak' },
  { code: 'sl', name: 'スロベニア語', enName: 'Slovenian' },
  { code: 'sr', name: 'セルビア語', enName: 'Serbian' },
  { code: 'sw', name: 'スワヒリ語', enName: 'Swahili' },
  { code: 'ta', name: 'タミル語', enName: 'Tamil' },
  { code: 'te', name: 'テルグ語', enName: 'Telugu' },
  { code: 'tl', name: 'タガログ語', enName: 'Tagalog' },
  { code: 'ur', name: 'ウルドゥー語', enName: 'Urdu' },
  { code: 'uz', name: 'ウズベク語', enName: 'Uzbek' }
];

// Default Extension Settings
const DEFAULT_SETTINGS = {
  baseUrl: 'http://localhost:1234',
  model: '', // Empty means auto-select currently loaded model from /v1/models
  apiMode: 'completions', // 'completions' (PFML3 raw, recommended) | 'chat' (/v1/chat/completions)
  uiLang: 'auto', // 'auto' | 'ja' | 'en'
  sourceLang: 'auto',
  targetLang: 'ja',
  autoSwitchJaEn: true, // If input is Japanese and target is 'ja', automatically translate to 'en'
  form: 'none', // 'none' | 'polite' | 'plain' (Only effective when targetLang is 'ja')
  context: '',
  glossaryText: '',
  temperature: 0,
  maxTokens: 1024,
  selectionMode: 'button' // 'button' | 'instant' | 'off'
};

/**
 * Get language display name based on current UI language
 * @param {string} code
 * @param {'ja'|'en'} [uiLang='ja']
 * @returns {string}
 */
function getLanguageDisplayName(code, uiLang = 'ja') {
  const lang = PLAMO_LANGUAGES.find(l => l.code === code);
  if (!lang) return code;
  if (uiLang === 'en') {
    return `${lang.enName} (${lang.code})`;
  }
  return `${lang.name} (${lang.code})`;
}

/**
 * Parse glossary from either a multiline string ("source=target", "source\ttarget", "source: target")
 * or an array of { source, target } objects.
 */
function parseGlossary(input) {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.filter(item => item && item.source && item.target);
  }
  if (typeof input !== 'string') return [];

  const lines = input.split(/\r?\n/);
  const result = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;

    let src = '';
    let tgt = '';

    if (line.includes('=')) {
      const idx = line.indexOf('=');
      src = line.substring(0, idx).trim();
      tgt = line.substring(idx + 1).trim();
    } else if (line.includes('\t')) {
      const idx = line.indexOf('\t');
      src = line.substring(0, idx).trim();
      tgt = line.substring(idx + 1).trim();
    } else if (line.includes(':')) {
      const idx = line.indexOf(':');
      src = line.substring(0, idx).trim();
      tgt = line.substring(idx + 1).trim();
    }

    if (src && tgt) {
      result.push({ source: src, target: tgt });
    }
  }
  return result;
}

/**
 * Determine if text contains significant Japanese characters (Hiragana / Katakana >= 15%)
 */
function isJapaneseText(text) {
  if (!text || typeof text !== 'string') return false;
  const nonSpace = text.replace(/[\s\d\p{P}]/gu, '');
  if (!nonSpace) return false;
  // Count Hiragana & Katakana
  const kanaMatches = nonSpace.match(/[\u3040-\u309F\u30A0-\u30FF]/g) || [];
  return (kanaMatches.length / nonSpace.length) >= 0.15;
}

/**
 * Resolve target language considering auto Japanese/English switching
 */
function resolveTargetLang(text, sourceLang, targetLang, autoSwitchJaEn = true) {
  if (autoSwitchJaEn && (sourceLang === 'auto' || !sourceLang) && targetLang === 'ja') {
    if (isJapaneseText(text)) {
      return 'en';
    }
  }
  return targetLang || 'ja';
}

/**
 * Build the exact PFML3 prompt for pfnet/plamo-3-translate-2b
 * 
 * Prompt format:
 * <|plamo:tag|>dataset<|plamo:msg|>translation
 * (Optional context: <|plamo:tag|>context<|plamo:msg|>{context})
 * (Optional glossary: <|plamo:tag|>glossary<|plamo:key|>{src1}<|plamo:val|>{tgt1}...)
 * (Input: <|plamo:tag|>input[<|plamo:key|>lang<|plamo:val|>{srcLang}]<|plamo:msg|>{text})
 * (Output: <|plamo:tag|>output<|plamo:key|>lang<|plamo:val|>{tgtLang}[<|plamo:key|>form<|plamo:val|>{form}]<|plamo:msg|>)
 */
function buildPfml3Prompt(options = {}) {
  const {
    text = '',
    sourceLang = 'auto',
    targetLang = 'ja',
    form = 'none',
    context = '',
    glossary = []
  } = options;

  let prompt = `${PFML_TAG}dataset${PFML_MSG}translation`;

  // 1. Context (Optional)
  if (context && typeof context === 'string' && context.trim().length > 0) {
    prompt += `${PFML_TAG}context${PFML_MSG}${context.trim()}`;
  }

  // 2. Glossary (Optional)
  const glossaryItems = Array.isArray(glossary) ? glossary : parseGlossary(glossary);
  if (glossaryItems.length > 0) {
    prompt += `${PFML_TAG}glossary`;
    for (const item of glossaryItems) {
      if (item.source && item.target) {
        prompt += `${PFML_KEY}${item.source.trim()}${PFML_VAL}${item.target.trim()}`;
      }
    }
  }

  // 3. Input
  prompt += `${PFML_TAG}input`;
  if (sourceLang && sourceLang !== 'auto') {
    prompt += `${PFML_KEY}lang${PFML_VAL}${sourceLang.trim()}`;
  }
  prompt += `${PFML_MSG}${text}`;

  // 4. Output
  prompt += `${PFML_TAG}output${PFML_KEY}lang${PFML_VAL}${targetLang.trim()}`;
  if (targetLang === 'ja' && (form === 'polite' || form === 'plain')) {
    prompt += `${PFML_KEY}form${PFML_VAL}${form.trim()}`;
  }
  prompt += `${PFML_MSG}`;

  return prompt;
}

/**
 * Clean up raw model generation output
 * Strips accidental PFML tags, EOS tokens, and trims whitespace
 */
function cleanTranslationOutput(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';
  let cleaned = rawText;

  // Remove any remaining PFML tokens
  cleaned = cleaned.replace(/<\|plamo:[^>]+?>/g, '');
  cleaned = cleaned.replace(/<\|endoftext\|>/g, '');
  cleaned = cleaned.replace(/<\|[a-z_]+?\|>/g, '');

  return cleaned.trim();
}

/**
 * Fetch available models from LM Studio /v1/models endpoint
 */
async function fetchLmStudioModels(baseUrl = 'http://localhost:1234') {
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/models`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    const models = (data.data || []).map(m => m.id || m.name).filter(Boolean);
    return { ok: true, models };
  } catch (err) {
    clearTimeout(timeoutId);
    return {
      ok: false,
      error: err.name === 'AbortError' ? 'タイムアウト (6秒): LM Studioサーバーが起動していない可能性があります' : err.message
    };
  }
}

/**
 * Execute translation call against LM Studio
 */
async function executePlamoTranslation(options = {}) {
  const {
    baseUrl = 'http://localhost:1234',
    model = '',
    apiMode = 'completions',
    prompt = '',
    effectiveTargetLang = 'ja',
    sourceLang = 'auto',
    temperature = 0,
    maxTokens = 1024
  } = options;

  const cleanBaseUrl = baseUrl.replace(/\/+$/, '');
  let resolvedModel = model;

  // Auto-detect model if not explicitly specified
  if (!resolvedModel) {
    const modelsResult = await fetchLmStudioModels(cleanBaseUrl);
    if (modelsResult.ok && modelsResult.models.length > 0) {
      // Look for a model containing 'plamo' first, otherwise use first loaded model
      const plamoModel = modelsResult.models.find(m => m.toLowerCase().includes('plamo'));
      resolvedModel = plamoModel || modelsResult.models[0];
    } else {
      resolvedModel = 'plamo-3-translate-2b';
    }
  }

  // Attempt completions mode first (recommended for raw PFML3)
  if (apiMode === 'completions') {
    try {
      const completionsUrl = `${cleanBaseUrl}/v1/completions`;
      const res = await fetch(completionsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: resolvedModel,
          prompt: prompt,
          temperature: Number(temperature) || 0,
          max_tokens: Number(maxTokens) || 1024,
          stop: STOP_TOKENS,
          stream: false
        })
      });

      if (res.ok) {
        const data = await res.json();
        const rawText = data.choices?.[0]?.text || '';
        return {
          ok: true,
          translatedText: cleanTranslationOutput(rawText),
          rawText,
          modelUsed: resolvedModel,
          apiModeUsed: 'completions'
        };
      }

      // If /v1/completions is not supported (404/405), fall back to chat completions
      if (res.status === 404 || res.status === 405) {
        console.warn('/v1/completions returned 404/405. Falling back to /v1/chat/completions');
      } else {
        const errorText = await res.text();
        throw new Error(`Completions API エラー (${res.status}): ${errorText}`);
      }
    } catch (err) {
      // If error is network unreachable, propagate
      if (err.message && !err.message.includes('404') && !err.message.includes('405')) {
        throw err;
      }
    }
  }

  // Chat completions mode
  const chatUrl = `${cleanBaseUrl}/v1/chat/completions`;
  const chatPayload = {
    model: resolvedModel,
    messages: [
      { role: 'user', content: prompt }
    ],
    temperature: Number(temperature) || 0,
    max_tokens: Number(maxTokens) || 1024,
    stop: STOP_TOKENS,
    stream: false,
    chat_template_kwargs: {
      target_lang: effectiveTargetLang,
      ...(sourceLang && sourceLang !== 'auto' ? { source_lang: sourceLang } : {})
    }
  };

  const res = await fetch(chatUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(chatPayload)
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Chat API エラー (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  const rawText = data.choices?.[0]?.message?.content || '';
  return {
    ok: true,
    translatedText: cleanTranslationOutput(rawText),
    rawText,
    modelUsed: resolvedModel,
    apiModeUsed: 'chat'
  };
}

// Export for Node.js test environment if needed
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PFML_TAG,
    PFML_MSG,
    PFML_KEY,
    PFML_VAL,
    STOP_TOKENS,
    PLAMO_LANGUAGES,
    DEFAULT_SETTINGS,
    getLanguageDisplayName,
    parseGlossary,
    isJapaneseText,
    resolveTargetLang,
    buildPfml3Prompt,
    cleanTranslationOutput,
    fetchLmStudioModels,
    executePlamoTranslation
  };
}
