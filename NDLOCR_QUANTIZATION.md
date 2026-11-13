# NDLOCR-Lite ONNX モデル量子化・最適化 知見まとめ

`PlaMo_translate` に同梱している **NDLOCR-Lite**（文字列検出 `DEIMv2` + 文字列認識 `PARSeq` 2モデル）をブラウザ拡張機能の `onnxruntime-web`（WASM シングルスレッド環境）向けに軽量化・高速化した際の検証結果と実装知見をまとめたドキュメントです。

---

## 1. 結論サマリー

| モデル | 元サイズ (FP32) | 実装後サイズ | 削減率 | 採用した最適化方式 | WASM ロード | WASM 推論時間 | 精度評価（FP32比） |
| :--- | :---: | :---: | :---: | :--- | :---: | :---: | :--- |
| **DEIMv2** (`deim-s-1024x1024.int8.onnx`) | 40.26 MB | **15.52 MB** | **-61.5%** | `MatMul`+`Gemm` 動的 INT8 (`QUInt8`) | 1,546ms → **1,070ms** | 7,529ms → **3,744ms** (**約2倍高速**) | 検出行 43/43 一致 / Mean IoU **0.964** |
| **PARSeq-256** (`parseq-ndl-24x256-...int8.onnx`) | 36.46 MB | **15.69 MB** | **-57.0%** | Hybrid（`MatMulInteger` QInt8 + 行単位Int8埋め込み + FP16重み） | 1,320ms → **782〜910ms** | 107ms → **94ms**（warm平均） | 71/78行完全一致 / 文字一致率 **98.78%** |
| **PARSeq-384** (`parseq-ndl-24x384-...int8.onnx`) | 37.81 MB | **18.60 MB** | **-50.8%** | Hybrid（`/head` `MatMulInteger` QInt8 + 行単位Int8埋め込み + FP16重み） | 2,219ms → **1,342〜1,505ms** | 235ms → **165ms**（run2） | 73/78行完全一致 / 文字一致率 **99.57%** |
| **合計（3モデル）** | **114.52 MB** | **49.80 MB** | **-56.5%** | — | — | — | **約 64.7 MB 削減・50 MB 未満を達成** |

> [!NOTE]
> - モデルサイズ・推論時間は `PlaMo_translate/vendor/ort/ort.wasm.min.js`（v1.31.1, `numThreads: 1`, `proxy: false`）での実測値です。
> - 量子化は GPU 不要・CPU のみ（Python 3.13 + `onnx==1.23.2` + `onnxruntime==1.31.1`）で数分以内に完了します。

---

## 2. 得られた主要知見（落とし穴と解決策）

### 知見 1: Python CPU ではなく「実際の ORT Web WASM（シングルスレッド）」で計測必須

ONNX Runtime の Python (`CPUExecutionProvider`) 上での挙動・速度と、拡張機能内の `onnxruntime-web` WASM（SIMDあり・マルチスレッドなし `numThreads=1`）では最適な演算子（カーネル）が大きく異なります。

| 検証した演算子 / 方式 | ファイルサイズ | WASM 推論速度 | 評価・理由 |
| :--- | :---: | :---: | :--- |
| **DEIMv2: `Conv+MatMul+Gemm` INT8** | 11.59 MB | 5,488 ms | `ConvInteger` 等の WASM 実行オーバーヘッドで `MatMul+Gemm` のみ（3,808ms）より**約1.4倍遅い**。 |
| **DEIMv2: `MatMul+Gemm` のみ INT8** | **15.52 MB** | **3,744〜3,808 ms** | **最速**（FP32 `7,529ms` の約半分）。`Conv` を FP32 に残す方が WASM では圧倒的に有利。 |
| **PARSeq: 静的 QDQ（const MatMul のみ）** | 15.48 MB | 234 ms | WASM 上で `FP32`（107ms）より**2倍以上低速**かつ精度低下（88.93%）。 |
| **PARSeq: 全面 Weight-Only INT8 (`DequantizeLinear`)** | 10.74 MB | 293〜303 ms | `DequantizeLinear` が推論ごとに再評価され、特に `7144x192` の埋め込み表（64箇所の `Gather`）が毎回展開されるため **約2.8倍遅延**。 |
| **PARSeq: FP16重み格納 (`Cast float16→float32`)** | 19.15 MB | **108 ms** | ロード時最適化で高速展開され FP32（107ms）と同等速度、精度は **99.78%**（76/78行一致）を維持。ロード時間も約半減（1,320ms → 693ms）。 |

**教訓**: ブラウザ WASM ターゲットでは、単にモデルを小さくするだけでなく **「WASM カーネルの速度」と「`InferenceSession.create` 時の畳み込み最適化（`Cast` 展開 vs `DequantizeLinear` 展開）」** を実ランタイム（`ort.wasm.min.js`）で実測して選定する必要があります。

---

### 知見 2: `onnxruntime.quantization.quantize_dynamic` における PARSeq 共有重み破壊バグ

PARSeq にそのまま `quantize_dynamic`（または `quant_pre_process` + `quantize_dynamic`）を適用すると、**出力が `0/30`（完全な文字化け）に崩壊**する現象に遭遇しました。

#### 原因の切り分け
1. **デコーダ展開による重み共有 + `Gemm`→`MatMul` 変換時のインプレース転置バグ**:
   - 元モデル（`parseq-ndl-24x256-...onnx`）のデコーダは自己回帰 32 ステップをグラフ展開しており、`/decoder/layers.0/self_attn/Gemm`〜`self_attn_31/Gemm`（32個）および `cross_attn`（32個）が `transB=1` 属性付きで**同一の重みテンソル**（`out_proj.weight`）を共有しています。
   - `quantize_dynamic` 内部の前処理（`Gemm` → `MatMul` 置換）は各 `Gemm` ノードを巡回するたびに**元の initializer 配列をインプレースで転置（`.T`）**してしまうため、共有ノードが **32 回（偶数回）転置されて未転置状態に戻り**、量子化ノード数 0 個の設定（`Gemm` のみ指定など）でも推論が完全に破綻しました。
2. **`quant_pre_process` のリネームによる `nodes_to_exclude` / `nodes_to_quantize` すり抜け**:
   - `quant_pre_process` は `MatMul + Add` を `.../MatMulAddFusion`（`Gemm`）へ融合し、さらに `quantize_dynamic` がフィルタ評価前に `<name>_MatMul` へリネームするため、元のノード名を指定しても除外・限定対象にマッチしないケースがありました。
3. **`Identity` ノードチェーンによる定数重みの隠蔽**:
   - 出力ヘッド `/head_0..31/MatMul` が共有する最大クラス重み `onnx::MatMul_13765`（`[192, 7142]`, `5.49 MB`）は、途中に定数 `Identity` ノードを挟んで参照されていたため、直接 `n.input[1] in initializers` で探索すると見落とされます。

#### 解決策（前処理パイプライン）
`quantize_dynamic` を呼ぶ前に以下を自作 ONNX パスで実行しました：
1. **安全な `Gemm` 展開**: `transB=1` の `Gemm` に対し、元の initializer を書き換えず `<weight_name>__T` という別名の新規 initializer を **1度だけ** 作成・共有し、`MatMul + Add` へ置換する。
2. **定数 `Identity` の除去**: 定数 initializer を中継する `Identity` ノード（342個）を短絡除去し、出力ヘッド重みへの参照を直接化する。

この修正だけで、PARSeq 動的量子化（`QInt8`, per-channel）の精度は **`0/30` (0.0%) → `21/30` (91.78%)** へ回復しました。

---

### 知見 3: 静的 QDQ 量子化の罠（`QLinearMatMul` のスカラー zero_point 制約）

`quantize_static`（`QDQ` 形式）を PARSeq 全域に適用すると、推論時に以下のエラーで停止しました：

> `QLinearMatMul : input zero point must be a scalar or 1D tensor of size 1`

- 原因: Self-Attention 内の `Q * K^T` など**両入力が動的アクティベーションの `MatMul`**（`/decoder/layers.0/self_attn_31/MatMul_2` 等）まで QDQ 対象に含まれてしまい、非スカラー量子化パラメータが `QLinearMatMul` に渡されたためです。
- 対策: `nodes_to_quantize` を「第2引数が定数重みである `MatMul`」に限定すると実行自体は通りましたが、前述の通り WASM 上で低速（`234ms`）かつ精度（`88.93%`）も劣ったため不採用としました。

---

### 知見 4: Transformer 文字認識（ViT-Tiny エンコーダ）の感度とハイブリッド量子化

安全に `Gemm` を展開した上でレイヤー別アブレーション（新聞＋UI画像 計 78 行で計測）を行った結果、PARSeq 内の耐性が明確に分かれました。

#### レイヤー別の役割と容量・耐性（`24x256` モデル）
- **Encoder（ViT-Tiny 12ブロック / 21.58 MB）**: **非常に敏感**。
  - 動的アクティベーション量子化（`DynamicQuantizeLinear`, 活性化を推論時に非対称 `QUInt8` 化）をエンコーダ全体に掛けると **91.25〜92.47%** まで低下。
  - 単一サブレイヤーのみ量子化しても `qkv`（96.57%）、`fc1`（96.12%）、`fc2`（95.46%）と劣化し、特に活性化外れ値が出やすい `fc2` や初期ブロックほど影響が大きい一方、`proj`（97.79%）や後半ブロックの `fc1` は比較的耐性がありました。
- **Decoder 本体（0.31 MB）**: 容量が極めて小さいため量子化するメリットが薄く、FP16 化で十分（0.16 MB 程度）。
- **出力ヘッド `/head`（`[192, 7142]` / 5.49 MB）**: **極めて頑健**。
  - `/head` のみを `MatMulInteger`（`QInt8`, per-channel）にした場合 **30/30 (100.00%)** を維持しつつ、約 `4.1 MB` 削減できます。
- **文字埋め込み表 `text_embed`（`Gather` / `[7144, 192]` / 5.49 MB）**: **オンデマンド行デコードが有効**。
  - 通常の `DequantizeLinear` を `Gather` の前に置くと全 7,144 語彙（約 137万要素）が毎回デクオンタイズされて遅くなります。
  - そこで **`Gather(W_int8, idx) → Cast(float32) → Mul(Gather(row_scale, idx))`** へグラフを書き換えることで、推論ステップごとに**実際に参照した 1 トークン行（192要素）だけ**を逆量子化する構造にし、サイズを約 **1/4（~1.4 MB）** に圧縮しつつ速度劣化ゼロ（`<0.1ms`）を実現しました（単体精度 **98.45%**）。

#### モデル幅（`256` vs `384`）による境界の違い
- `24x256`（`cascadeAt: 25` 文字未満向け）では `/head` + `encoder/**/proj` + `encoder/blocks.6..11/mlp/fc1` を `MatMulInteger` 化しても **`98.78%`**・**`94ms`**（FP32 より高速）を達成しました。
- 一方、`24x384`（長文向け）に同じ `H3` 境界を適用するとトークン長増加に伴い誤差が蓄積して **`94.53%`** に低下したため、`24x384` では `/head` のみを `MatMulInteger` 化しエンコーダを FP16 重みに保つことで **`99.57%`**（73/78 完全一致・`165ms`）を確保しました。

---

## 3. 採用した量子化レシピ（再現手順の要点）

### DEIMv2 (`deim-s-1024x1024.int8.onnx`)
1. `onnxruntime.quantization.shape_inference.quant_pre_process(..., skip_symbolic_shape=True)`
2. `quantize_dynamic(..., op_types_to_quantize=['MatMul', 'Gemm'], weight_type=QuantType.QUInt8, extra_options={'MatMulConstBOnly': True})`
   - ※ ORT WASM での速度低下を防ぐため **`Conv` は量子化対象に含めない**。

### PARSeq (`parseq-ndl-24x{256,384}-...int8.onnx`)
1. `Gemm(transB=1)` を共有重み非破壊（`.T` コピーを別名 initializer としてキャッシュ）で `MatMul + Add` へ安全に展開。
2. 定数 initializer に接続された冗長な `Identity` ノードを短絡除去。
3. `model.text_embed.embedding.weight` の `Gather` を `Gather(int8) -> Cast(f32) -> Mul(Gather(row_scale))` へ置換（行ごとの最大絶対値対称 `int8` 量子化）。
4. 対象 `MatMul` 以外の大容量 FP32 重み（エンコーダ・デコーダ・`Conv`）を **`float16` initializer + `Cast(to=FLOAT)`** へ変換。
5. `quantize_dynamic(..., op_types_to_quantize=['MatMul'], weight_type=QuantType.QInt8, per_channel=True, extra_options={'MatMulConstBOnly': True})` を対象ノードのみに適用：
   - **`24x256`**: `/head` ＋ `/encoder/` 内の `/proj/` および `blocks.6..11/mlp/fc1`
   - **`24x384`**: `/head` のみ

---

## 4. 拡張機能への組み込みと検証記録

- **モデル配置先**: `PlaMo_translate/vendor/ndlocr/`（`.gitignore` で `*.onnx` は追跡除外）
- **エンジン設定更新**: [ndlocr_engine.js](file:///c:/Users/Tetsu/WORKS/Development/PlaMo_translate/ndlocr_engine.js#L20-L31) の `DET_MODEL_FILE`・`REC_SHORT.file`・`REC_MEDIUM.file` を `.int8.onnx` ファイル名へ変更（推論コードや前後処理・`isAvailable()` はそのまま互換）。
- **検証済み項目**:
  - `ort.wasm.min.js`（`numThreads: 1`）上での実画像 E2E 推論＆`NDL_CHARLIST` デコード正常動作
  - `node -c ndlocr_engine.js` / `node -c content.js` 構文エラーなし
  - 全 7 ユニットテストスイート（`test_block_merging.js`, `test_cursor_svg.js`, `test_icon_filter.js`, `test_leading_icon_strip.js`, `test_newspaper_layout.js`, `test_ocr_routing.js`, `test_reading_order.js`）全件パス

