# NDLOCR-Lite ONNX モデル量子化・最適化 知見まとめ

[English](NDLOCR_QUANTIZATION.en.md) | 日本語 · [← README に戻る](README.md)

> **執筆**: Antigravity (Google Deepmind) — 本プロジェクトにおける NDLOCR-Lite のブラウザ移植・ONNX 量子化パイプライン構築・実測検証を担当

`PlaMo_translate` に同梱している **NDLOCR-Lite**（文字列検出 `DEIMv2` + 文字列認識 `PARSeq` 2モデル）について、**開発に至った経緯**、**制作プロセス（グラフ変換・量子化パイプラインの実装方法）**、およびブラウザ拡張機能の `onnxruntime-web`（WASM シングルスレッド環境）向け実測検証から得られた最適化知見をまとめたドキュメントです。

---

## 1. 作成に至った経緯

Chrome 拡張機能（Manifest V3）として外部クラウド API に一切依存せず完全ローカルで画像内テキスト・画面領域 OCR 翻訳を実現するにあたり、当初の課題と要件は次のとおりでした。

1. **日本語（特に縦書き・複雑レイアウト）の認識精度課題**:
   - 英語や欧文中心の軽量 OCR には `Tesseract.js` が有効でしたが、日本語の縦書き（新聞段組み・書籍・漫画等）や UI スクリーンショット内の混在文字列では行検出・読み順・認識精度に限界がありました。
2. **NDLOCR-Lite のブラウザ内実行という選択肢**:
   - 国立国会図書館が公開している **NDLOCR-Lite**（文字列検出 `DEIMv2` ＋ 文字列認識 `PARSeq` `24x256` / `24x384`）は日本語の縦書き・横書き双方で極めて高精度ですが、無加工の FP32 ONNX モデルは **3モデル合計 114.52 MB**（40.26 MB + 36.46 MB + 37.81 MB）に達します。
3. **ブラウザ拡張・シングルスレッド WASM 特有の制約**:
   - 拡張機能の Offscreen Document 内（`ort.wasm.min.js`, `numThreads: 1`, `proxy: false`）で読み込む際、**114.52 MB のままでは拡張機能配布パッケージの肥大化、初回モデルロード遅延、および推論時間（`DEIMv2` 単体で 7.5 秒超）が実用のボトルネック**となりました。
   - 一方で、標準的な `onnxruntime.quantization` の汎用コマンドをそのまま適用すると、モデル破損（認識率 0% 崩壊）や、むしろ FP32 より 1.4〜2.8 倍遅くなる WASM 特有の劣化が発生しました。

これらを解決し、**「認識精度を 98.8〜99.6% 水準に保ったまま、3 モデル合計を 50 MB 未満へ軽量化し、ブラウザ WASM 上の推論速度も高速化する」** ことを目標に、実ブラウザ環境での実測に基づき専用のグラフ変換・ハイブリッド量子化モデルを制作しました。

---

## 2. どのように制作したか（制作プロセス）

Python CPU の理論値に頼らず、**拡張機能と同等の実ブラウザ WASM 環境（`ort.wasm.min.js`, `numThreads: 1`）** で 1 変更ごとにロード時間・推論時間・実画像評価セット（新聞紙面＋UI スクリーンショット 計 78 行・検出 43 行）を計測しながら、段階的に制作しました。

### Step 1: 実 WASM 環境でのベースライン計測とボトルネック特定
- `DEIMv2`（FP32: 40.26 MB / ロード 1,546ms / 推論 7,529ms）、`PARSeq-256`（FP32: 36.46 MB / 推論 107ms）、`PARSeq-384`（FP32: 37.81 MB / 推論 235ms）を基準値として計測しました。
- あわせて各モデルの ONNX 計算グラフ構造を解析し、**共有 `Gemm` ノードの展開構造**・**大容量 `text_embed` (`Gather`)**・**出力ヘッド `/head` の重み比率**・**ViT エンコーダ各層の量子化感度**を洗い出しました。

### Step 2: 検出モデル（DEIMv2）の製作（`dynamic-det` 方式）
- 最初に `Conv + MatMul + Gemm` 全域を INT8 化したところ、サイズは 11.59 MB まで縮んだものの WASM 上で `ConvInteger` カーネルがボトルネックとなり **5,488ms（逆効果で 1.4 倍遅延）** になることが判明しました。
- そこで `Conv` を FP32 に残し、`quant_pre_process(..., skip_symbolic_shape=True)` のうえで **`MatMul` と `Gemm` のみを `QUInt8` 動的量子化（`MatMulConstBOnly: True`）** する方式を採用し、**15.52 MB（-61.5%）** かつ **約 2 倍高速化（3,744ms / Mean IoU 0.964）** を達成しました。

### Step 3: 認識モデル（PARSeq-256 / 384）向け専用グラフ変換パイプラインの開発
`PARSeq` はデコーダの自己回帰 32 ステップが展開された計算グラフであり、標準量子化ツールがそのまま使えなかったため、Python（`onnx` + `onnxruntime` + `numpy`）で **WASM 向けハイブリッド変換スクリプト** を自作し、以下の 5 段階パイプラインを通してモデルを制作しました：

1. **共有 `Gemm(transB=1)` の非破壊展開**: 同一重みを 32 回共有する `Gemm` に対し、元配列のインプレース転置バグを避けるため `<weight>__T` を 1 回だけ生成して `MatMul + Add` へ安全置換。
2. **冗長な定数 `Identity` チェーンの短絡除去**: 出力ヘッド等の共有定数重みを隠していた 342 個の `Identity` ノードを除去し、量子化フィルタから参照可能に整理。
3. **文字埋め込み表 `Gather` のオンデマンド行単位 Int8 化**: `[7144, 192]`（5.49 MB）の文字埋め込み表を行ごとの最大絶対値対称量子化で `int8` ＋ `row_scale` に変換し、`Gather(int8) → Cast(float32) → Mul(Gather(row_scale))` へグラフ書き換え。推論時に参照した 1 行（192 要素）だけを復元する構造により、サイズを約 1/4 に抑えつつ速度遅延をゼロ化。
4. **敏感な ViT エンコーダ／Conv 層の FP16 重み格納**: `DynamicQuantizeLinear` による精度劣化を避けるため、残りの大容量 FP32 重みを `float16` initializer ＋ グラフ冒頭 `Cast(to=FLOAT)` へ変換し、ロード時最適化で FP32 同等の推論速度と約半分のロード時間を両立。
5. **モデル長（`24x256` vs `24x384`）に応じた選択的 `MatMulInteger` (`QInt8`, per-channel) 適用**: レイヤー別アブレーション計測の結果、短文向け `24x256` は `/head`＋`/proj/`＋後半 `blocks.6..11/mlp/fc1` まで量子化し、長文向け `24x384` は系列長による誤差蓄積を防ぐため `/head` のみに限定して精度 **99.57%** を確保しました。

### Step 4: ブラウザ拡張への統合とテスト検証
- 生成した 3 つの `.int8.onnx` を `PlaMo_translate/vendor/ndlocr/` に配置し、[ndlocr_engine.js](ndlocr_engine.js) から `ort.wasm.min.js` で読み込み、縦書き段組み・箇条書き結合・UI アイコン除去・読み順ソートおよび自動テストによる E2E 検証を実施しました。

---

## 3. 結論サマリー（ベンチマーク比較）

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

## 4. 得られた主要知見（落とし穴と解決策）

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

## 5. 採用した量子化レシピ（再現手順の要点）

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

## 6. 拡張機能への組み込み・GitHub 配布構成と検証記録

- **モデル配置先**: `PlaMo_translate/vendor/ndlocr/`
  - `deim-s-1024x1024.int8.onnx`（15,517,172 bytes / 約 15.52 MB）
  - `parseq-ndl-24x256-30-tiny-189epoch-tegaki3-r8data-202604.int8.onnx`（15,690,595 bytes / 約 15.69 MB）
  - `parseq-ndl-24x384-50-tiny-300epoch-tegaki3-r8data-202604.int8.onnx`（18,595,504 bytes / 約 18.60 MB）
- **GitHub リポジトリでの扱い**: `.gitignore` にて `vendor/ndlocr/*.onnx` および `vendor/ort/*.jsep.*` は Git の追跡対象から除外しています。GitHub からソースをクローンしてローカル動作させる場合は、GitHub Releases の配布パッケージから取得した上記 `.int8.onnx` を `PlaMo_translate/vendor/ndlocr/` に配置してください（未配置または読込失敗時は日本語も `Tesseract.js` へフォールバックします）。
- **エンジン設定**: [ndlocr_engine.js](ndlocr_engine.js) の `DET_MODEL_FILE`・`REC_SHORT.file`・`REC_MEDIUM.file` にて上記 `.int8.onnx` ファイルを読み込み、縦書き段組み・箇条書き結合・UI アイコン除去・読み順ソートを組み合わせて実行します。
- **検証済み項目**:
  - `ort.wasm.min.js`（`numThreads: 1`）上での実画像 E2E 推論＆`NDL_CHARLIST` デコード正常動作
  - `node -c ndlocr_engine.js` / `node -c content.js` 構文エラーなし
  - 全 12 ユニット＆契約テストスイート（`test_area_marquee_selection.js`, `test_block_delete_and_add_region.js`, `test_block_merging.js`, `test_bullet_splitting.js`, `test_cursor_svg.js`, `test_icon_filter.js`, `test_leading_icon_strip.js`, `test_newspaper_layout.js`, `test_ocr_routing.js`, `test_peek_hover.js`, `test_reading_order.js`, `test_toolbar_drag_and_clamp.js`）全件パス
- **ライセンス・クレジット表記**:
  - 元モデル・前処理仕様: 国立国会図書館（NDL Lab）[ndl-lab/ndlocr-lite](https://github.com/ndl-lab/ndlocr-lite)（[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)）
  - **改変事項**: 単一スレッド WASM（`onnxruntime-web` v1.31.1, MIT License）向けに `DEIMv2` / `PARSeq` モデルへ INT8/FP16 量子化・グラフ書き換えを実施し、前後処理を [ndlocr_engine.js](ndlocr_engine.js) へ移植しています。
  - レイアウト認識モデルのバックボーンには **DINOv3** 蒸留モデルが使われているため、モデル利用時は CC BY 4.0 に加え Meta **DINOv3 ライセンス** 等も適用されます（詳細は [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照）。

