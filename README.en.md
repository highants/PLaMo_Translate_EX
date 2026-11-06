# PLaMo Translate (LM Studio)

English | [日本語](README.md)

A privacy-first, zero-cloud-dependency Chrome extension (Manifest V3 / Vanilla JS) that brings Preferred Networks (PFN)'s state-of-the-art open-weight translation model **PLaMo 3 Translate (0.8B / 2B / 8B / 31B)** directly into your browser via **LM Studio**'s local inference server.

Translate sensitive business documents, source code, and confidential text **100% locally on your machine with zero data leakage, high speed, and zero API costs**.

---

## PLaMo 3 Translate Model Family

This extension is fully compatible with all parameter sizes and quantized GGUF variants (`Q4_K_M`, `Q8_0`, `FP16`, etc.) in the PLaMo 3 Translate family. Choose the model size that fits your local hardware (CPU / GPU / VRAM) and translation needs:

| Model Size | Parameters | Characteristics & Recommended Hardware |
| :--- | :--- | :--- |
| **PLaMo 3 Translate 0.8B** | 800M | **Ultra-lightweight & ultra-fast**. Runs smoothly even on standard laptop CPUs and low-memory environments. Perfect for instant web browsing translation. |
| **PLaMo 3 Translate 2B** | 2 Billion | **Best balance of speed and accuracy**. Ideal for everyday desktop use with consumer GPUs. |
| **PLaMo 3 Translate 8B** | 8 Billion | **High accuracy & expressive nuance**. Excels at translating complex clauses, academic literature, and specialized technical contexts (8GB–16GB VRAM recommended). |
| **PLaMo 3 Translate 31B** | 31 Billion | **Flagship translation quality**. Designed for high-performance workstations and local GPU servers. |

* All models share the exact same **PFML3 prompt architecture**, **53-language bidirectional translation**, **Japanese polite/plain style control**, and **Context / Glossary term enforcement**.
* The extension automatically detects whichever model is currently loaded in LM Studio via the `/v1/models` endpoint.

---

## Key Features

1. **Native PFML3 Prompt Format**:
   - Strictly constructs Preferred Networks' native markup tags (`<|plamo:tag|>`, `<|plamo:msg|>`, `<|plamo:key|>`, `<|plamo:val|>`) to unleash the full translation capability of PLaMo 3.
2. **Japanese Politeness & Form Control**:
   - Explicitly choose Japanese sentence styling: **Polite** (`polite`: です/ます調) or **Plain** (`plain`: だ/である調).
3. **Context & Glossary Support**:
   - Supply background domain context (e.g., "Medical device user manual") or enforce custom term mapping pairs (e.g., `LLM=Large Language Model`).
4. **In-Page Floating Selection Translation**:
   - Select text on any web page to display a floating `🌐 PLaMo` button or instant translation card.
   - Inside input fields (`<input>`, `<textarea>`, `contenteditable`), a single click on **"✍️ Replace"** directly replaces your text with the translation.
5. **Full-Page Inline Paragraph Translation**:
   - Scans visible paragraphs and headings, translating them **viewport-first** so you see immediate results as you scroll.
   - Injects clean bilingual inline blocks beneath the original paragraphs.
   - Includes a floating control pill to **Pause/Resume**, **Hide/Show Original**, or **Restore** the page to its original DOM state.
6. **Smart Auto Ja↔En Language Swap**:
   - Automatically flips the target language to English when Japanese text is entered while target is set to Japanese.
7. **Bilingual UI (English & Japanese)**:
   - Complete interface available in English and Japanese. Automatically matches your browser language or can be set manually in Settings.
8. **CSP / Mixed-Content Immune**:
   - All network calls to `http://localhost:1234` are routed through the background service worker, ensuring seamless operation even on strict HTTPS and Content Security Policy (CSP) websites.
9. **Dual Workspace (Popup & Full-Screen Tab)**:
   - Use the compact toolbar popup or click the **🗗** button to expand into a widescreen two-column translation workspace.

---

## Supported Languages (53 Languages)

All 53 languages officially supported by PLaMo 3 Translate are available:

> **Common**: English (`en`), Japanese (`ja`), Chinese (`zh`), Korean (`ko`), French (`fr`), German (`de`), Spanish (`es`), Italian (`it`), Russian (`ru`), Vietnamese (`vi`), Thai (`th`), Indonesian (`id`), Arabic (`ar`), Dutch (`nl`), Polish (`pl`), Portuguese (`pt`), Turkish (`tr`), Hindi (`hi`), Ukrainian (`uk`), and 34 other supported languages.

---

## Getting Started

### 1. Prepare Model in LM Studio

1. **Launch LM Studio**:
   - Download and start [LM Studio](https://lmstudio.ai/) on your PC.
2. **Download Model**:
   - In the search bar (magnifier icon), search for your preferred size:
     - `plamo-3-translate-0.8b`
     - `plamo-3-translate-2b`
     - `plamo-3-translate-8b`
     - `plamo-3-translate-31b`
     - or `pfnet/plamo-3-translate`
   - Download a GGUF quantization (e.g., `Q4_K_M` for speed, `Q8_0` or `FP16` for maximum precision).
3. **Start Local Inference Server**:
   - Navigate to the **Local Server** tab (`<->` icon).
   - Load your downloaded PLaMo 3 Translate model.
   - Ensure the server port is set to `1234` (default) and click **Start Server**.
   - (Optional) Confirm CORS is enabled (enabled by default in LM Studio).

### 2. Install Chrome Extension

1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Toggle on **Developer mode** in the top-right corner.
3. Click **Load unpacked** in the top-left corner.
4. Select the downloaded/cloned folder (`PlaMo_translate`).
5. Pin the **PLaMo Translate** icon to your browser toolbar.
6. Click the extension icon, open **⚙️ Settings**, and click **🔌 Test Connection** to automatically detect your running model.

---

## Usage Guide

### 1. Toolbar Popup
- Click the extension icon in the toolbar.
- Enter source text and press `Ctrl + Enter` (or click **Translate**).
- Click **🗗 Open in Full Tab** for longer documents.
- Expand **🛠️ Context & Glossary** to enforce custom translations (e.g., `LLM=Large Language Model`).

### 2. In-Page Selection Translation
- Highlight any text on a webpage.
- Click the floating `🌐 PLaMo` button near your selection to open the popover card.
- Switch target languages or polite/plain styling on the fly, and click **🔄 Retranslate**.
- When editing text in form fields, click **✍️ Replace** to substitute text directly.

### 3. Whole-Page Paragraph Translation
- Click **🌐 Translate Whole Page** in the popup, or right-click anywhere on the page and select **Translate this page with PLaMo Translate**.
- Bilingual translation blocks will appear below each paragraph.
- Use the bottom-right control pill to:
  - **Hide / Show Original**: Focus solely on the translated text.
  - **Pause / Resume**: Temporarily stop translating long articles.
  - **Restore**: Completely remove all injected translations and restore original DOM.

---

## PFML3 Prompt Specification

This extension formats raw completion prompts according to Preferred Networks' official PFML3 specification (shared across 0.8B, 2B, 8B, and 31B models):

```text
<|plamo:tag|>dataset<|plamo:msg|>translation
<|plamo:tag|>context<|plamo:msg|>{context}
<|plamo:tag|>glossary<|plamo:key|>{source1}<|plamo:val|>{target1}<|plamo:key|>{source2}<|plamo:val|>{target2}
<|plamo:tag|>input<|plamo:key|>lang<|plamo:val|>{source_lang}<|plamo:msg|>{source_text}
<|plamo:tag|>output<|plamo:key|>lang<|plamo:val|>{target_lang}<|plamo:key|>form<|plamo:val|>{polite/plain}<|plamo:msg|>
```

### Stop Tokens
To avoid over-generation, the following sequences are supplied as stop tokens:
- `<|plamo:tag|>`
- `<|plamo:bos|>`
- `<|plamo:eos|>`
- `<|endoftext|>`

---

## Extension Settings

Access **⚙️ Settings** in the popup to configure:

| Setting | Default | Description |
| :--- | :--- | :--- |
| **UI Language** | `Auto` | Interface language (`Auto` / `Japanese` / `English`) |
| **LM Studio Server URL** | `http://localhost:1234` | Local inference server endpoint |
| **Model** | Auto-detect | Select from `/v1/models` or enter custom model string |
| **API Mode** | `completions` (Recommended) | `/v1/completions` (PFML3 raw) or `/v1/chat/completions` |
| **In-Page Translation Mode**| `button` | `button` (icon on select), `instant` (immediate popover), `off` |
| **Auto Ja↔En Switch** | `true` (Enabled) | Automatically flip target to English when input is Japanese |
| **Temperature** | `0.0` | Output determinism (0.0 is best for translation fidelity) |
| **Max Tokens** | `1024` | Maximum tokens generated per translation call |

---

## Troubleshooting

### Q1. Status shows "Disconnected"
- Confirm that LM Studio local server is started (**Start Server** button is active).
- If your port is not `1234`, adjust the URL in Settings accordingly.
- Click **🔌 Test Connection** in Settings to inspect response status.

### Q2. In-page translation does not work on certain pages
- Due to Chrome security restrictions, content scripts are disabled on:
  - `chrome://` internal browser settings and web store pages.
  - Local file URLs (can be enabled via Chrome Extension settings: "Allow access to file URLs").
- Standard `http://` and `https://` websites work normally.

### Q3. Error with Completions API
- If your backend does not expose `/v1/completions`, switch the API Mode in Settings to **Chat API (/v1/chat/completions)**. The extension also has built-in auto-fallback.

---

## References & Credits

- **Preferred Networks Tech Blog**:  
  [PLaMo 3 Translate: Open-Weight Release and Development Story](https://www.preferred.jp/ja/blog/tech/plamo-3-translate-weight-release)
- **Hugging Face Model Repositories**:  
  [Preferred Networks (pfnet) on Hugging Face](https://huggingface.co/pfnet)
- **Licenses**:
  - Extension Code: [MIT License](LICENSE)
  - Translation Models: PLaMo Community License (free for research, learning, and non-commercial use; free commercial use available for businesses/individuals with revenue under 1 billion JPY upon registration).

