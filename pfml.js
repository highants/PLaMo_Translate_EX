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
  '</s>',
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
  { code: 'ja-easy', name: 'やさしい日本語', enName: 'Japanese (Easy)' },
  { code: 'en', name: '英語', enName: 'English' },
  { code: 'zh-hans', name: '中国語（簡体字）', enName: 'Chinese (Simplified)' },
  { code: 'zh-hant', name: '中国語（繁体字）', enName: 'Chinese (Traditional)' },
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

// Official PLaMo 3 Translate 0.8B GGUF Presets for In-Browser Wllama (Mode B)
const WLLAMA_MODEL_PRESETS = [
  {
    id: 'q4_k_m',
    name: 'PLaMo 3 Translate 0.8B (Q4_K_M / 約547MB - 推奨)',
    enName: 'PLaMo 3 Translate 0.8B (Q4_K_M / ~547MB - Recommended)',
    url: 'https://huggingface.co/pfnet/plamo-3-translate-0.8b-GGUF/resolve/main/plamo-3-translate-0.8b-Q4_K_M.gguf',
    sizeMB: 547
  },
  {
    id: 'q4_0',
    name: 'PLaMo 3 Translate 0.8B (Q4_0 / 約522MB)',
    enName: 'PLaMo 3 Translate 0.8B (Q4_0 / ~522MB)',
    url: 'https://huggingface.co/pfnet/plamo-3-translate-0.8b-GGUF/resolve/main/plamo-3-translate-0.8b-Q4_0.gguf',
    sizeMB: 522
  },
  {
    id: 'q3_k_m',
    name: 'PLaMo 3 Translate 0.8B (Q3_K_M / 約464MB - 軽量)',
    enName: 'PLaMo 3 Translate 0.8B (Q3_K_M / ~464MB - Lightweight)',
    url: 'https://huggingface.co/pfnet/plamo-3-translate-0.8b-GGUF/resolve/main/plamo-3-translate-0.8b-Q3_K_M.gguf',
    sizeMB: 464
  },
  {
    id: 'q2_k',
    name: 'PLaMo 3 Translate 0.8B (Q2_K / 約391MB - 超軽量)',
    enName: 'PLaMo 3 Translate 0.8B (Q2_K / ~391MB - Ultra Light)',
    url: 'https://huggingface.co/pfnet/plamo-3-translate-0.8b-GGUF/resolve/main/plamo-3-translate-0.8b-Q2_K.gguf',
    sizeMB: 391
  }
];

// Default Extension Settings
const DEFAULT_SETTINGS = {
  engineMode: 'lmstudio', // 'lmstudio' (Mode A: Local Server) | 'wllama' (Mode B: In-Browser Offscreen Wllama)
  baseUrl: 'http://localhost:1234',
  model: '', // Empty means auto-select currently loaded model from /v1/models
  apiMode: 'completions', // 'completions' (PFML3 raw, recommended) | 'chat' (/v1/chat/completions)
  wllamaModelUrl: WLLAMA_MODEL_PRESETS[0].url,
  wllamaUseWebGpu: true,
  wllamaContextSize: 2048,
  uiLang: 'auto', // 'auto' | 'ja' | 'en'
  sourceLang: 'auto',
  targetLang: 'ja',
  autoSwitchJaEn: true, // If input is Japanese and target is 'ja', automatically translate to 'en'
  form: 'none', // 'none' | 'polite' | 'plain' (Only effective when targetLang is 'ja')
  context: '',
  glossaryText: '',
  temperature: 0,
  maxTokens: 1024,
  selectionMode: 'button', // 'button' | 'instant' | 'off'
  inlineDisplayMode: 'window', // 'window' | 'iframe' (Native Float Window or In-page OOPIF)
  enableImageHoverButton: true,
  ocrLang: 'auto',
  ocrEngine: 'ndlocr', // 'ndlocr' (NDLOCR-Lite ONNX, default; falls back to Tesseract) | 'tesseract'
  popoverCustomWidth: 440,
  popoverCustomHeight: 0
};

/**
 * Normalize language code (e.g. ja(easy) -> ja-easy)
 * @param {string} code
 * @returns {string}
 */
function normalizeLanguageCode(code) {
  if (!code || typeof code !== 'string') return '';
  const trimmed = code.trim().toLowerCase();
  if (trimmed === 'ja(easy)' || trimmed === 'ja-easy') return 'ja-easy';
  return trimmed;
}

/**
 * Get language display name based on current UI language
 * @param {string} code
 * @param {'ja'|'en'} [uiLang='ja']
 * @returns {string}
 */
function getLanguageDisplayName(code, uiLang = 'ja') {
  const norm = normalizeLanguageCode(code);
  const lang = PLAMO_LANGUAGES.find(l => l.code === norm);
  if (!lang) return code;
  if (uiLang === 'en') {
    return `${lang.enName} (${lang.code})`;
  }
  return `${lang.name} (${lang.code})`;
}

/**
 * Get concise language name without code suffix (e.g. '日本語', 'English')
 * @param {string} code
 * @param {'ja'|'en'} [uiLang='ja']
 * @returns {string}
 */
function getLanguageSimpleName(code, uiLang = 'ja') {
  const norm = normalizeLanguageCode(code);
  const lang = PLAMO_LANGUAGES.find(l => l.code === norm);
  if (!lang) return code;
  return uiLang === 'en' ? lang.enName : lang.name;
}

/**
 * Heuristic Language Detector for input text
 * Inspects character scripts and Unicode ranges to accurately identify source language
 * @param {string} text
 * @returns {string} ISO language code e.g. 'ja', 'en', 'zh', 'ko', 'ru', etc.
 */
function detectLanguage(text) {
  if (!text || typeof text !== 'string') return 'auto';
  const clean = text.trim();
  if (!clean) return 'auto';

  // 1. Japanese (Hiragana or Katakana present)
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(clean)) {
    return 'ja';
  }
  // 2. Korean (Hangul syllables or jamo)
  if (/[\uAC00-\uD7AF\u1100-\u11FF]/.test(clean)) {
    return 'ko';
  }
  // 3. Chinese (Hanzi without Japanese kana)
  if (/[\u4E00-\u9FFF]/.test(clean)) {
    return 'zh';
  }
  // 4. Cyrillic (Russian, Ukrainian, etc.)
  if (/[\u0400-\u04FF]/.test(clean)) {
    return 'ru';
  }
  // 5. Arabic script
  if (/[\u0600-\u06FF]/.test(clean)) {
    return 'ar';
  }
  // 6. Thai script
  if (/[\u0E00-\u0E7F]/.test(clean)) {
    return 'th';
  }
  // 7. Devanagari (Hindi)
  if (/[\u0900-\u097F]/.test(clean)) {
    return 'hi';
  }
  // 8. Greek
  if (/[\u0370-\u03FF]/.test(clean)) {
    return 'el';
  }
  // 9. Vietnamese (Latin Extended Additional: \u1EA0-\u1EF9 and đ/Đ - 100% unique to Vietnamese)
  if (/[\u1EA0-\u1EF9đĐ]/.test(clean)) {
    return 'vi';
  }
  // 10. Spanish unique characters (ñ/Ñ, ¿, ¡)
  if (/[ñÑ¿¡]/.test(clean)) {
    return 'es';
  }
  // 11. German umlauts & Eszett (ä, ö, ü, ß)
  if (/[äöüßÄÖÜ]/.test(clean)) {
    return 'de';
  }
  // 12. French unique ligatures & cedilla (ç/Ç, œ/Œ, æ/Æ)
  if (/[çÇœŒæÆ]/.test(clean)) {
    return 'fr';
  }
  // 13. Portuguese unique nasal tildes (ã/Ã, õ/Õ)
  if (/[ãõÃÕ]/.test(clean)) {
    return 'pt';
  }

  // 14. High-frequency word heuristics for Latin-based European languages
  if (/\b(el|la|los|las|un|una|unos|unas|del|por|para|con|este|esta|esto|pero|más|está|están|como|en|amigo|hola|gracias|buenos|días|noches|usted)\b/i.test(clean)) {
    return 'es';
  }
  if (/\b(le|la|les|un|une|des|du|dans|avec|pour|est|sont|sur|cette|ces|mais|qui|bonjour|merci|monsieur|oui)\b/i.test(clean)) {
    return 'fr';
  }
  if (/\b(der|die|das|ein|eine|eines|einer|und|ist|sind|nicht|mit|für|auf|dass|wie|hallo|danke|bitte|guten)\b/i.test(clean)) {
    return 'de';
  }
  if (/\b(il|lo|la|i|gli|le|un|uno|una|di|del|della|per|con|su|sono|questo|questa|ciao|grazie|buongiorno)\b/i.test(clean)) {
    return 'it';
  }
  if (/\b(o|a|os|as|um|uma|do|da|dos|das|em|para|com|por|não|sim|obrigado|olá|bom|dia)\b/i.test(clean)) {
    return 'pt';
  }

  // Common acute accents in Spanish/Portuguese (á, é, í, ó, ú)
  if (/[áéíóúÁÉÍÓÚ]/.test(clean)) {
    return 'es';
  }

  // Default to English if Latin alphabet is predominant
  if (/[a-zA-Z]/.test(clean)) {
    return 'en';
  }

  return 'auto';
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
 * Resolve target language considering auto Japanese/English switching and Easy Japanese form
 * @param {string} text
 * @param {string} sourceLang
 * @param {string} targetLang
 * @param {boolean} [autoSwitchJaEn=true]
 * @param {string} [form='none']
 * @returns {string}
 */
function resolveTargetLang(text, sourceLang, targetLang, autoSwitchJaEn = true, form = 'none') {
  let normTarget = normalizeLanguageCode(targetLang);

  // If style is explicitly Easy Japanese, map target to ja-easy
  if (normTarget === 'ja' && (form === 'easy' || form === 'ja-easy')) {
    return 'ja-easy';
  }

  // If the user specified any Japanese style/form (polite, plain, etc.),
  // they explicitly request Japanese stylistic rewriting (e.g. Desu/Masu or Da/Dearu).
  // Do NOT auto-switch to English even if input text is detected as Japanese.
  if (normTarget === 'ja' && form && form !== 'none') {
    return 'ja';
  }

  // Auto-switch JA -> EN only if target is standard Japanese ('ja') and no style is selected
  if (autoSwitchJaEn && (sourceLang === 'auto' || !sourceLang) && normTarget === 'ja') {
    if (isJapaneseText(text)) {
      return 'en';
    }
  }
  return normTarget || 'ja';
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
    prompt += `${PFML_KEY}lang${PFML_VAL}${normalizeLanguageCode(sourceLang)}`;
  }
  prompt += `${PFML_MSG}${text}`;

  // 4. Output
  let normTarget = normalizeLanguageCode(targetLang);
  if (normTarget === 'ja' && (form === 'easy' || form === 'ja-easy')) {
    normTarget = 'ja-easy';
  }
  prompt += `${PFML_TAG}output${PFML_KEY}lang${PFML_VAL}${normTarget}`;
  if (normTarget === 'ja' && (form === 'polite' || form === 'plain')) {
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

  // Cut off everything after the first occurrence of any stop marker
  const stopIndex = cleaned.search(/(?:<\/s>|<\|plamo:tag|<\|plamo:bos|<\|plamo:eos|<\|endoftext)/);
  if (stopIndex !== -1) {
    cleaned = cleaned.substring(0, stopIndex);
  }

  // Remove any remaining PFML tokens / special markers
  cleaned = cleaned.replace(/<\/s>/g, '');
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
 * Read SSE (Server-Sent Events) stream from OpenAI-compatible endpoint (LM Studio)
 * Supports real-time token emission and proactive Early-Stop on PLaMo stop markers.
 */
async function readSseStream(response, onChunk, abortController, isChat = false) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let accumulatedRaw = '';
  let earlyStopped = false;

  const stopMarkerRegex = /(?:<\/s>|<\|plamo:tag|<\|plamo:bos|<\|plamo:eos|<\|endoftext)/;

  try {
    while (true) {
      if (earlyStopped || abortController?.signal?.aborted) break;
      const { value, done } = await reader.read();
      if (done) break;

      const textChunk = typeof value === 'string' ? value : decoder.decode(value, { stream: true });
      buffer += textChunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Preserve incomplete trailing chunk

      for (const rawLine of lines) {
        if (earlyStopped) break;
        const line = rawLine.trim();
        if (!line || line.startsWith(':')) continue;

        if (line === 'data: [DONE]') {
          return accumulatedRaw;
        }

        if (line.startsWith('data:')) {
          const jsonStr = line.slice(5).trim();
          try {
            const data = JSON.parse(jsonStr);
            const piece = isChat
              ? (data.choices?.[0]?.delta?.content || '')
              : (data.choices?.[0]?.text || '');

            if (piece) {
              accumulatedRaw += piece;
              const cleanCurrent = cleanTranslationOutput(accumulatedRaw);
              if (onChunk) {
                onChunk({ chunk: piece, currentText: cleanCurrent });
              }

              // Hardware/Network-level Early-Stop for PLaMo tokens
              if (stopMarkerRegex.test(accumulatedRaw)) {
                earlyStopped = true;
                if (abortController) {
                  abortController.abort();
                }
                break;
              }
            }
          } catch {
            // Ignore partial/malformed JSON chunks in stream
          }
        }
      }
    }
  } catch (err) {
    const isAbort = err?.name === 'AbortError' || String(err?.message || err).includes('abort');
    if (!isAbort) {
      throw err;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch { }
  }

  return accumulatedRaw;
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
    maxTokens = 1024,
    stream = true,
    onChunk = null
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
    const abortController = new AbortController();
    try {
      const completionsUrl = `${cleanBaseUrl}/v1/completions`;
      const res = await fetch(completionsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortController.signal,
        body: JSON.stringify({
          model: resolvedModel,
          prompt: prompt,
          temperature: Number(temperature) || 0,
          max_tokens: Number(maxTokens) || 1024,
          stop: STOP_TOKENS,
          stream: Boolean(stream)
        })
      });

      if (res.ok) {
        let rawText = '';
        if (stream && res.body) {
          rawText = await readSseStream(res, onChunk, abortController, false);
        } else {
          const data = await res.json();
          rawText = data.choices?.[0]?.text || '';
        }
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
  const chatAbortController = new AbortController();
  const chatUrl = `${cleanBaseUrl}/v1/chat/completions`;
  const chatPayload = {
    model: resolvedModel,
    messages: [
      { role: 'user', content: prompt }
    ],
    temperature: Number(temperature) || 0,
    max_tokens: Number(maxTokens) || 1024,
    stop: STOP_TOKENS,
    stream: Boolean(stream),
    chat_template_kwargs: {
      target_lang: normalizeLanguageCode(effectiveTargetLang),
      ...(sourceLang && sourceLang !== 'auto' ? { source_lang: normalizeLanguageCode(sourceLang) } : {})
    }
  };

  const res = await fetch(chatUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: chatAbortController.signal,
    body: JSON.stringify(chatPayload)
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Chat API エラー (${res.status}): ${errorText}`);
  }

  let rawText = '';
  if (stream && res.body) {
    rawText = await readSseStream(res, onChunk, chatAbortController, true);
  } else {
    const data = await res.json();
    rawText = data.choices?.[0]?.message?.content || '';
  }

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
    WLLAMA_MODEL_PRESETS,
    DEFAULT_SETTINGS,
    normalizeLanguageCode,
    getLanguageDisplayName,
    getLanguageSimpleName,
    detectLanguage,
    parseGlossary,
    isJapaneseText,
    resolveTargetLang,
    buildPfml3Prompt,
    cleanTranslationOutput,
    readSseStream,
    fetchLmStudioModels,
    executePlamoTranslation
  };
}
