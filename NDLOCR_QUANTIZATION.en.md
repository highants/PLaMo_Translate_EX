# NDLOCR-Lite ONNX Model Quantization & WASM Optimization Notes

English | [日本語](NDLOCR_QUANTIZATION.md) · [← Back to README](README.en.md)

> **Author**: Antigravity (Google Deepmind) — Browser porting, custom ONNX quantization pipeline implementation, and WASM benchmarking for NDLOCR-Lite in this project.

This document explains **why these quantized models were created**, **how the custom graph-rewriting and quantization pipeline was built**, and the verified engineering benchmarks and pitfalls learned while optimizing **NDLOCR-Lite** (`DEIMv2` text detection + `PARSeq` 24x256 / 24x384 recognition) for single-threaded `onnxruntime-web` WASM inside the `PlaMo_translate` Chrome extension.

---

## 1. Background & Motivation

When building 100% local, zero-cloud image and screen-area OCR translation inside a Chrome Extension (Manifest V3), we faced three practical constraints:

1. **Limitations of Tesseract.js on Japanese Layouts**:
   - While bundled `Tesseract.js` performs well on English and Latin scripts, Japanese vertical text (newspaper columns, manga, books) and mixed UI screenshots suffered from missed line ordering and recognition inaccuracies.
2. **Weight Footprint of Unmodified NDLOCR-Lite**:
   - The National Diet Library's **NDLOCR-Lite** (`DEIMv2` + `PARSeq-256` + `PARSeq-384`) delivers top-tier accuracy on both vertical and horizontal Japanese, but the unmodified FP32 ONNX weights total **114.52 MB** (40.26 MB + 36.46 MB + 37.81 MB).
3. **Single-Threaded Browser WASM Bottlenecks & Quantizer Pitfalls**:
   - Running 114.52 MB FP32 models inside Chrome's Offscreen Document (`ort.wasm.min.js`, `numThreads: 1`, `proxy: false`) created heavy bundle size, slow cold-start session loads, and >7.5s detection latency on `DEIMv2`.
   - Meanwhile, running stock `onnxruntime.quantization` directly either broke PARSeq output completely (`0/30` gibberish) or made WASM inference 1.4x–2.8x *slower* than FP32.

Our goal was to **shrink all 3 models under 50 MB total while speeding up single-threaded browser WASM inference and preserving 98.8–99.6% character accuracy**.

---

## 2. How the Quantized Models Were Built

Instead of tuning blindly on Python CPU, every iteration was benchmarked directly inside the target runtime (`ort.wasm.min.js`, `numThreads: 1`, `proxy: false`) on a real validation set of 78 Japanese newspaper + UI text lines (43 detection lines):

### Step 1: Baseline Profiling & Graph Inspection
- Measured FP32 baselines in ORT Web WASM (`DEIMv2`: 7,529 ms; `PARSeq-256`: 107 ms; `PARSeq-384`: 235 ms).
- Audited the exported ONNX graphs to identify shared decoder `Gemm` nodes across 32 unrolled autoregressive steps, the 5.49 MB `text_embed` `Gather` table, the 5.49 MB `/head` projection, and sensitivity of the ViT-Tiny encoder blocks.

### Step 2: Detection Model (`DEIMv2`) via `dynamic-det`
- Quantizing `Conv + MatMul + Gemm` reduced size to 11.59 MB, but WASM `ConvInteger` execution caused **5,488 ms inference (1.4x slower than excluding `Conv`)**.
- Keeping `Conv` in FP32 and running `quant_pre_process(..., skip_symbolic_shape=True)` + `QUInt8` dynamic quantization strictly on `MatMul` + `Gemm` (`MatMulConstBOnly: True`) produced a **15.52 MB (-61.5%)** model that runs **~2x faster (3,744 ms, Mean IoU 0.964)**.

### Step 3: Custom Hybrid Pipeline for Recognition (`PARSeq-256` / `PARSeq-384`)
Using Python (`onnx` + `onnxruntime` + `numpy`), we built a dedicated 5-stage graph transformation pipeline to work around stock quantizer bugs and WASM kernel bottlenecks:

1. **Safe Non-Mutating `Gemm(transB=1)` Expansion**: Replaced shared `Gemm` nodes with `MatMul + Add` using a single deduplicated `<weight>__T` initializer instead of mutating shared weights in place.
2. **Constant `Identity` Chain Stripping**: Bypassed 342 redundant `Identity` nodes so shared constant `/head` weights were directly visible to constant-B quantization filters.
3. **On-Demand Row-Wise Int8 `Gather` Compression**: Quantized the `[7144, 192]` character embedding row-by-row to `int8` + `row_scale`, rewriting `Gather(W_fp32, idx)` into `Gather(W_int8, idx) → Cast(float32) → Mul(Gather(row_scale, idx))` so only 192 floats are dequantized per step (~4x size reduction with zero runtime slowdown).
4. **FP16 Weight Storage for Sensitive Layers**: Packed remaining ViT encoder, decoder, and `Conv` weights as `float16` initializers with graph-entry `Cast(to=FLOAT)` nodes, halving load time while matching FP32 inference speed and avoiding dynamic activation quantization loss.
5. **Width-Specific Selective `MatMulInteger` (`QInt8`, per-channel)**: Guided by layer-wise ablation, quantized `/head` + `/proj/` + `blocks.6..11/mlp/fc1` on `24x256` (98.78%, 94 ms), while keeping `24x384` encoder layers in FP16 and quantizing `/head` only to prevent error drift on long lines (99.57%, 165 ms).

### Step 4: Integration & End-to-End Verification
- Bundled the three `.int8.onnx` models in `PlaMo_translate/vendor/ndlocr/`, wired them into [ndlocr_engine.js](ndlocr_engine.js), and validated end-to-end Japanese/English OCR, vertical newspaper column ordering, bullet grouping, UI icon stripping, and extension unit/contract suites.

---

## 3. Summary Benchmarks

| Model | Original (FP32) | Quantized Size | Reduction | Optimization Method | WASM Load Time | WASM Inference | Accuracy vs. FP32 |
| :--- | :---: | :---: | :---: | :--- | :---: | :---: | :--- |
| **DEIMv2** (`deim-s-1024x1024.int8.onnx`) | 40.26 MB | **15.52 MB** | **-61.5%** | `MatMul` + `Gemm` Dynamic INT8 (`QUInt8`) | 1,546ms → **1,070ms** | 7,529ms → **3,744ms** (**~2x faster**) | Line count 43/43 match / Mean IoU **0.964** |
| **PARSeq-256** (`parseq-ndl-24x256-...int8.onnx`) | 36.46 MB | **15.69 MB** | **-57.0%** | Hybrid (`MatMulInteger` QInt8 + row-wise Int8 `Gather` + FP16 weights) | 1,320ms → **782–910ms** | 107ms → **94ms** (warm avg) | 71/78 exact lines / **98.78%** char accuracy |
| **PARSeq-384** (`parseq-ndl-24x384-...int8.onnx`) | 37.81 MB | **18.60 MB** | **-50.8%** | Hybrid (`/head` `MatMulInteger` QInt8 + row-wise Int8 `Gather` + FP16 weights) | 2,219ms → **1,342–1,505ms** | 235ms → **165ms** (run 2) | 73/78 exact lines / **99.57%** char accuracy |
| **Total (3 Models)** | **114.52 MB** | **49.80 MB** | **-56.5%** | — | — | — | **~64.7 MB saved (< 50 MB total)** |

> [!NOTE]
> - All sizes and timings were measured on `PlaMo_translate/vendor/ort/ort.wasm.min.js` (v1.31.1, `numThreads: 1`, `proxy: false`).
> - Quantization runs purely on CPU (no GPU needed; tested with Python 3.13 + `onnx==1.23.2` + `onnxruntime==1.31.1`) and completes in a few minutes.

---

## 4. Key Engineering Findings & Pitfalls Solved

### Finding 1: Always Benchmark in Real Single-Threaded ORT Web WASM, Not Python CPU

Quantization operators that look fast in Python `CPUExecutionProvider` behave very differently under single-threaded `onnxruntime-web` WASM (`numThreads: 1`, `proxy: false`):

| Tested Strategy | File Size | WASM Inference | Evaluation |
| :--- | :---: | :---: | :--- |
| **DEIMv2: `Conv+MatMul+Gemm` INT8** | 11.59 MB | 5,488 ms | `ConvInteger` WASM overhead makes inference **~1.4x slower** than quantizing `MatMul+Gemm` only (3,808 ms). |
| **DEIMv2: `MatMul+Gemm` INT8 Only** | **15.52 MB** | **3,744–3,808 ms** | **Fastest** (~2x speedup over FP32 7,529 ms). Keeping `Conv` in FP32 is significantly faster in WASM. |
| **PARSeq: Static QDQ (const `MatMul`)** | 15.48 MB | 234 ms | **>2x slower** than FP32 (107 ms) in WASM and lower accuracy (88.93%). |
| **PARSeq: Full Weight-Only INT8 (`DequantizeLinear`)** | 10.74 MB | 293–303 ms | `DequantizeLinear` re-expands all weights and the `7144x192` embedding table (`Gather`) every inference (**~2.8x slower**). |
| **PARSeq: FP16 Weights (`Cast float16→float32`)** | 19.15 MB | **108 ms** | Folded efficiently at load time (load time halved: 1,320ms → 693ms), matches FP32 speed with **99.78%** accuracy (76/78 exact lines). |

---

### Finding 2: Shared `Gemm(transB=1)` In-Place Transpose Bug in `quantize_dynamic`

Applying `quantize_dynamic` directly to unrolled autoregressive decoders like PARSeq corrupts output completely (`0/30` exact match):

1. **In-place transpose of shared decoder weights**: All 32 unrolled decoder steps share the same `out_proj.weight` across `Gemm(transB=1)` nodes. ORT's internal `Gemm → MatMul` pass transposes the shared initializer `.T` **in place once per node** — 32 transposes cancel each other out and leave the weight untransposed.
2. **Post-fusion renaming by `quant_pre_process`**: Node names passed to `nodes_to_quantize` / `nodes_to_exclude` fail to match after `MatMulAddFusion` / `_MatMul` renaming.
3. **`Identity` chains hiding constant weights**: Output head `/head_0..31/MatMul` weights (`[192, 7142]`, 5.49 MB) sit behind `Identity` nodes, causing naive `n.input[1] in initializers` checks to miss them.

**Fix**: Run custom ONNX pre-passes before `quantize_dynamic`:
- Safely expand `Gemm` into `MatMul + Add` using a single newly created `<weight>__T` initializer (without mutating the original).
- Bypass redundant `Identity` nodes (342 nodes) chained from constant initializers.

---

### Finding 3: Transformer Encoder Sensitivity & On-Demand Row-Wise `Gather`

- **ViT-Tiny Encoder (21.58 MB)** is sensitive to dynamic activation quantization (`fc2` outliers degrade accuracy), whereas the **Output Head `/head` (5.49 MB)** tolerates `MatMulInteger` (`QInt8`, per-channel) at ~100% accuracy.
- **Character Embedding `text_embed` (`Gather`, 5.49 MB)**: Replacing `Gather(W_fp32, idx)` with **`Gather(W_int8, idx) → Cast(float32) → Mul(Gather(row_scale, idx))`** dequantizes only the single active 192-d token row per autoregressive step, cutting embedding size by ~4x (~1.4 MB) with `<0.1ms` runtime cost.
- **Width boundary (`24x256` vs `24x384`)**:
  - `24x256` (short lines): `MatMulInteger` on `/head` + `/proj/` + `blocks.6..11/mlp/fc1` achieves **98.78%** accuracy at **94ms** (faster than FP32).
  - `24x384` (long lines): Keep the entire encoder in FP16 and quantize only `/head` with `MatMulInteger` to prevent error accumulation over longer sequences, achieving **99.57%** accuracy (73/78 exact lines) at **165ms**.

---

## 5. Quantization Recipes

### DEIMv2 (`deim-s-1024x1024.int8.onnx`)
1. `quant_pre_process(..., skip_symbolic_shape=True)`
2. `quantize_dynamic(..., op_types_to_quantize=['MatMul', 'Gemm'], weight_type=QuantType.QUInt8, extra_options={'MatMulConstBOnly': True})` *(excluding `Conv`)*

### PARSeq (`parseq-ndl-24x{256,384}-...int8.onnx`)
1. Safely expand `Gemm(transB=1)` into `MatMul + Add` without mutating shared initializers.
2. Short-circuit redundant constant `Identity` nodes.
3. Convert `model.text_embed.embedding.weight` `Gather` into row-wise `int8` on-demand decode (`Gather(int8) -> Cast(f32) -> Mul(Gather(row_scale))`).
4. Pack remaining large FP32 weights (encoder, decoder, `Conv`) as `float16` initializers with `Cast(to=FLOAT)`.
5. Apply `quantize_dynamic(..., op_types_to_quantize=['MatMul'], weight_type=QuantType.QInt8, per_channel=True, extra_options={'MatMulConstBOnly': True})` selectively:
   - **`24x256`**: `/head` + `/encoder/` `/proj/` & `blocks.6..11/mlp/fc1`
   - **`24x384`**: `/head` only

---

## 6. Extension Integration, GitHub Distribution & Verification

- **Model Directory**: `PlaMo_translate/vendor/ndlocr/`
  - `deim-s-1024x1024.int8.onnx` (15,517,172 bytes / ~15.52 MB)
  - `parseq-ndl-24x256-30-tiny-189epoch-tegaki3-r8data-202604.int8.onnx` (15,690,595 bytes / ~15.69 MB)
  - `parseq-ndl-24x384-50-tiny-300epoch-tegaki3-r8data-202604.int8.onnx` (18,595,504 bytes / ~18.60 MB)
- **GitHub Repository Setup**: `.gitignore` excludes `vendor/ndlocr/*.onnx` and `vendor/ort/*.jsep.*` from Git tracking. Download the quantized `.int8.onnx` files from the GitHub Releases package into `PlaMo_translate/vendor/ndlocr/` when setting up from a fresh clone (if unavailable, Japanese OCR falls back to bundled `Tesseract.js`).
- **Engine Configuration**: [ndlocr_engine.js](ndlocr_engine.js) loads these `.int8.onnx` weights for `DET_MODEL_FILE`, `REC_SHORT.file`, and `REC_MEDIUM.file`.
- **Verification**:
  - End-to-end inference & `NDL_CHARLIST` decoding verified under `ort.wasm.min.js` (`numThreads: 1`)
  - Syntax checks (`node -c ndlocr_engine.js`, `node -c content.js`) clean
  - All 12 unit & contract test suites passing (`test_area_marquee_selection.js`, `test_block_delete_and_add_region.js`, `test_block_merging.js`, `test_bullet_splitting.js`, `test_cursor_svg.js`, `test_icon_filter.js`, `test_leading_icon_strip.js`, `test_newspaper_layout.js`, `test_ocr_routing.js`, `test_peek_hover.js`, `test_reading_order.js`, `test_toolbar_drag_and_clamp.js`)
- **License & Attribution**:
  - Original models & pipeline: National Diet Library, Japan ([ndl-lab/ndlocr-lite](https://github.com/ndl-lab/ndlocr-lite)), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
  - **Modifications**: Quantized and transformed `DEIMv2` / `PARSeq` models to INT8/FP16 for single-threaded `onnxruntime-web` WASM (v1.31.1, MIT License) and ported pre/post-processing to [ndlocr_engine.js](ndlocr_engine.js).
  - Pretrained layout detection weights include distilled **DINOv3** components subject to the Meta **DINOv3 License** as noted in `ndl-lab/ndlocr-lite` (see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for full third-party notices).

