# NDLOCR-Lite V2.0 ONNX Model Quantization & WASM Optimization Notes

English | [日本語](NDLOCR_QUANTIZATION.md) · [← Back to README](README.en.md)

> **Author**: Antigravity (Google Deepmind) — Browser porting, custom ONNX quantization pipeline implementation, TableCenterNet integration, and WASM benchmarking for NDLOCR-Lite V2.0 in this project.

This document summarizes the **NDLOCR-Lite V2.0 (released 2026-11-24)** model quantization pipeline, idle-CPU single-threaded `onnxruntime-web` WASM (`ort.wasm.min.js` v1.31.1, `numThreads: 1`) benchmarks, and browser-side speedups implemented in `PlaMo_translate`.

---

## 1. Upgrading to NDLOCR-Lite V2.0 in Browser WASM

**NDLOCR-Lite v2.0.0** dramatically improves handwritten Japanese and English recognition while introducing **variant character normalization (異体字包摂)**, **Tate-Chuu-Yoko (縦中横)**, and **TableCenterNet table structure recognition**. However, the unmodified FP32 ONNX binaries across all 4 models total **143.31 MB** (114.83 MB for the core 3 models alone).

Our V2.0 browser optimization achieves four goals:
1. **Keep the core 3 models (`DEIMv2` + `PARSeq-256` + `PARSeq-384`) under 50 MB total (48.83 MB, -57.5%)** while retaining **99.83%–99.99%** character match against FP32.
2. **Compress and lazy-load `TableCenterNet` (28.48 MB → 14.39 MB FP16, -49.5%)**, incurring **0 ms / 0 MB** runtime cost on pages without tables.
3. **Avoid bundling the 42.6 MB `PARSeq-768` (100-char) model** by adding a fast (<0.1 ms) **whitespace-valley midpoint splitter** (`findVerticalSplitX`) for wide horizontal lines (`charCount === 1` or aspect `>= 21`), enabling `PARSeq-384` to read 70–100+ character English/Japanese lines accurately.
4. **1-Pass English Auto-Routing**: Verified on English UI and prose benchmarks, confident English output (`>= 60`) from NDLOCR-Lite V2.0 is returned directly in `auto` mode without a redundant Tesseract re-run (~1.5–2.5 s saved per English image).

---

## 2. Summary Benchmarks (Idle-CPU ORT Web WASM v1.31.1, `numThreads: 1`)

Accuracy was measured against FP32 baselines across 8 real-world domains (163 text lines: Japanese UI, NDL magazine scan, handwritten vertical/horizontal Japanese, English prose/UI, Japanese table, and vertical old-kanji + Tate-Chuu-Yoko).

| Model (`vendor/ndlocr/`) | Original (FP32) | Optimized Size | Reduction | Optimization Method | WASM Load | WASM Warm Inference | Accuracy vs. FP32 |
| :--- | :---: | :---: | :---: | :--- | :---: | :---: | :--- |
| **DEIMv2**<br>`deim-s-1024x1024-261124.int8.onnx` | 40.28 MB | **12.86 MB** | **-68.1%** | `MatMul`+`Gemm` `QUInt8` Dynamic INT8 + **`Conv` FP16 storage** | 1,841ms → **1,006ms**<br>(**1.83x faster**) | 4,790ms → **4,082ms**<br>(first 5,343 → 4,307ms) | 110/111 doc/hw/EN/table lines<br>Mean IoU **0.963–0.984** |
| **PARSeq-256**<br>`parseq-ndl-24x256-30-tiny-499epoch-261124.int8.onnx` | 36.74 MB | **17.37 MB** | **-52.7%** | Hybrid (`/head` `MatMulInteger` QInt8 + per-row Int8 `Gather` + FP16 Encoder/Decoder) | 1,394ms → **1,131ms** | 159ms → **144ms**<br>(**faster than FP32**) | 159/163 exact (97.5%)<br>**99.83%** char match |
| **PARSeq-384**<br>`parseq-ndl-24x384-50-tiny-278epoch-261124.int8.onnx` | 37.81 MB | **18.60 MB** | **-50.8%** | Hybrid (`/head` `MatMulInteger` QInt8 + per-row Int8 `Gather` + FP16 Encoder/Decoder) | 1,542ms → **1,700ms** | 193ms → **192ms** | 162/163 exact (99.4%)<br>**99.99%** char match |
| **Core 3-Model Subtotal** | **114.83 MB** | **48.83 MB** | **-57.5%** | — | — | — | **< 50 MB (smaller than v1.2)** |
| **TableCenterNet (Lazy)**<br>`tablecenternet_s_800_v3.fp16.onnx` | 28.48 MB | **14.39 MB** | **-49.5%** | FP16 weight storage (`Conv` + `DeformConv` `Cast float16→float32`) | 51ms → **56ms** | 2,654ms → **2,637ms** | **138/138 peaks identical**<br>max prob diff **0.0007** |
| **All 4 Models Total** | **143.31 MB** | **63.22 MB** | **-55.9%** | — | — | — | **~80.1 MB saved** |

> [!NOTE]
> - `tablecenternet_s_800_v3.onnx` contains 16 ONNX opset-19 `DeformConv` operators, verified to run natively on bundled `ort.wasm.min.js` v1.31.1.
> - Quantization runs purely on CPU (Python 3.13 + `onnx` + `onnxruntime` + `numpy`) in a few minutes.

---

## 3. Key V2.0 Engineering Findings & Speedups

1. **`DEIMv2` `QUInt8` + `Conv` FP16 Storage (15.53 MB → 12.86 MB)**:
   - Storing the 5.40 MB of `Conv` weights in FP16 (`Cast(FLOAT)`) alongside `QUInt8` `MatMul`/`Gemm` avoids WASM `ConvInteger` slowdowns while cutting an extra 2.67 MB and accelerating cold load by **1.83x** (1,841ms → 1,006ms).
   - Note: `per_channel=True` (`QInt8`) triggers an ORT `ShapeInferenceError` on DEIMv2's 3D `integral/Reshape_1` node; `QUInt8` per-tensor avoids this cleanly.
2. **Tighter Encoder Sensitivity on V2.0 `PARSeq-256` (`499epoch`)**:
   - Unlike v1.2 (`189epoch`), quantizing `/proj/` and `blocks.6..11/mlp/fc1` on V2.0 `499epoch` dropped accuracy to 95.98%. Keeping the encoder/decoder in FP16 and quantizing only `/head` (`MatMulInteger` QInt8 per-channel) + per-row Int8 `Gather` restores **99.83%** accuracy while still running **faster than FP32** (144ms vs. 159ms).
   - Both `PARSeq` models still require our custom non-mutating `Gemm(transB=1)` → `MatMul + Add` expansion (82 / 104 `Gemm`s) and constant `Identity` chain stripping (450 / 562 nodes) prior to `quantize_dynamic`.
3. **`TableCenterNet` FP16 Storage & Fast Logit-Space NMS**:
   - 99.8% of `TableCenterNet` weights belong to `Conv` (25.01 MB) and `DeformConv` (3.28 MB). FP16 weight storage halves disk size to **14.39 MB** with 56ms load time and virtually lossless outputs (max heatmap probability delta `0.0007`).
   - [tablecenternet_engine.js](tablecenternet_engine.js) pre-filters heatmap logits using `val >= logit(thresh)` prior to 3×3 local-maxima NMS, skipping >99.5% of background pixels (<1ms JS decode) and compacting empty phantom grid columns/rows.
4. **JavaScript Pipeline Optimizations**:
   - **Pruned Softmax (`decodeParseq`)**: Skips `Math.exp()` for logits with `diff <= -20` (~99.8% fewer `Math.exp` calls per line, identical confidence).
   - **Whitespace-Midpoint Long-Line Splitting (`findVerticalSplitX`)**: Cleanly splits wide horizontal lines (`charCount === 1` / aspect `>= 21` / `>= 45`-char overflow) at blank column valleys for `PARSeq-384` without needing `PARSeq-768`.
   - **Vertical + Horizontal Single-Line Fast Paths**: Skips ~4s `DEIMv2` detection on narrow single-line horizontal or vertical area captures.
   - **Single `ImageData` Snapshot Reuse & Guarded Tate-Chuu-Yoko**: Shares one `getImageData` read across visual bullet detection, long-line split, and TCY; TCY skips immediately when `confidence >= 0.90` and validates candidate horizontal sub-chunks as genuine short ASCII/digits (`/^[A-Za-z0-9.,%!?]{2,4}$/`, `>= 0.80`) to prevent false splits on handwritten kanji.

---

## 4. Extension Integration, Distribution & Verification

- **Model Directory**: `PlaMo_translate/vendor/ndlocr/`
  - `deim-s-1024x1024-261124.int8.onnx` (12,855,692 bytes / ~12.86 MB)
  - `parseq-ndl-24x256-30-tiny-499epoch-261124.int8.onnx` (17,366,917 bytes / ~17.37 MB)
  - `parseq-ndl-24x384-50-tiny-278epoch-261124.int8.onnx` (18,595,504 bytes / ~18.60 MB)
  - `tablecenternet_s_800_v3.fp16.onnx` (14,392,963 bytes / ~14.39 MB, lazy-loaded)
  - `ndl_charlist.js` (7,141 chars, verified identical to V2.0 `NDLmoji.yaml`)
  - `ndl_character_inclusion.js` (4,905 entries / 58.4 KB, V2.0 variant character inclusion map)
  - `LICENSE.md` (Meta DINOv3 License)
- **GitHub Repository Setup**: `.gitignore` excludes `vendor/ndlocr/*.onnx` and `vendor/*.zip`. Extract `ndlocr.zip` from GitHub Releases into `PlaMo_translate/vendor/ndlocr/` when running from a fresh clone.
- **Verification**:
  - End-to-end ORT Web WASM inference verified across all 4 models (variant inclusion ON/OFF, 5×4 TableCenterNet Markdown/HTML, long English whitespace splitting, English UI, handwritten vertical Japanese)
  - Clean `node -c` syntax checks across all 10 JS files
  - All 13 unit & contract test suites under `test/` passing (existing 12 suites + `test/test_ndlocr_v2_features.js`)
- **License & Attribution**:
  - Original models, dictionaries & algorithms: National Diet Library, Japan ([ndl-lab/ndlocr-lite](https://github.com/ndl-lab/ndlocr-lite) v2.0.0), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
  - Pretrained `DEIMv2` layout detection weights include distilled **DINOv3** components subject to the Meta **DINOv3 License** (see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).
