# NDLOCR-Lite V2.0 ONNX モデル量子化・最適化 知見まとめ

[English](NDLOCR_QUANTIZATION.en.md) | 日本語 · [← README に戻る](README.md)

> **執筆**: Antigravity (Google Deepmind) — 本プロジェクトにおける NDLOCR-Lite V2.0 のブラウザ移植・ONNX 量子化パイプライン構築・TableCenterNet 移植・WASM 実測検証を担当

`PlaMo_translate` に同梱している **NDLOCR-Lite V2.0（2026-11-24 公開）**（文字列・表検出 `DEIMv2` ＋ 文字列認識 `PARSeq` 2モデル ＋ 遅延ロード表構造推定 `TableCenterNet`）について、**V2.0 刷新の経緯**、**量子化・グラフ最適化パイプライン**、**実ブラウザ WASM (`ort.wasm.min.js` v1.31.1, シングルスレッド) での実測ベンチマーク**、および **さらなる高速化・精度向上の実装知見** をまとめたドキュメントです。

---

## 1. NDLOCR-Lite V2.0 への刷新とブラウザ内蔵の要件

2026年11月24日公開の **NDLOCR-Lite v2.0.0** では、手書き文字・英文認識性能の大幅強化に加え、**異体字包摂（旧字体→新字体変換）**・**縦中横**・**表構造認識（TableCenterNet）** が正式導入されました。しかし公式の未加工 FP32 ONNX モデル 4 点の合計は **143.31 MB**（コア 3 モデルだけで 114.83 MB）に達します。

`PlaMo_translate` では以下を目標に V2.0 全モデルの最適化とブラウザ側推論エンジンの高速化を実施しました：
1. **コア 3 モデル（DEIMv2 + PARSeq-256 + PARSeq-384）を合計 50 MB 未満（48.83 MB）に収めつつ FP32 比 99.83〜99.99% の認識一致率を維持**。
2. **表構造認識モデル（TableCenterNet, 28.48 MB → 14.39 MB FP16）を遅延ロード方式で同梱**し、表を含まない画像では起動・メモリ・推論コストを完全ゼロ化。
3. **42.6 MB の `PARSeq-768`（100 文字モデル）を同梱せず**、横長の長文行（`charCount === 1` またはアスペクト比 `>= 21`）を**中央空白谷（Whitespace Valley）で自動分割して `PARSeq-384` で 2 分割認識**することで、70〜100 文字超の英文・和文行も 100% 精度で認識。
4. **英文 1 パス高速処理**: V2.0 の英文認識精度を実測検証のうえ、`auto` モードで高信頼度（`>= 60`）の英文結果を得た場合は冗長な Tesseract 再実行を省略して即座に返却（約 1.5〜2.5 秒短縮）。

---

## 2. V2.0 結論サマリー（アイドル CPU / ORT Web WASM 実測ベンチマーク）

すべての計測は `PlaMo_translate/vendor/ort/ort.wasm.min.js`（v1.31.1, `numThreads: 1`, `proxy: false`）上で、CPU 競合のない単独実行により実測しました。精度は実画像 8 ドメイン（計 163 テキスト行：日本語 UI、国立国会図書館月報、手書き縦書き/横書き、英文長文/UI、日本語表組、縦書き旧字体＋縦中横）に対する FP32 ベースライン比です。

| モデル（`vendor/ndlocr/`） | 元サイズ (FP32) | 実装後サイズ | 削減率 | 採用した最適化方式 | WASM ロード | WASM 推論 (warm) | 精度評価（FP32 比） |
| :--- | :---: | :---: | :---: | :--- | :---: | :---: | :--- |
| **DEIMv2**<br>`deim-s-1024x1024-261124.int8.onnx` | 40.28 MB | **12.86 MB** | **-68.1%** | `MatMul`+`Gemm` `QUInt8` 動的量子化 ＋ **`Conv` FP16 格納** | 1,841ms → **1,006ms**<br>(**1.83 倍高速**) | 4,790ms → **4,082ms**<br>(初回 5,343 → 4,307ms) | 文書/手書き/英/表 110/111 行一致<br>Mean IoU **0.963〜0.984** |
| **PARSeq-256**<br>`parseq-ndl-24x256-30-tiny-499epoch-261124.int8.onnx` | 36.74 MB | **17.37 MB** | **-52.7%** | Hybrid（`/head` `MatMulInteger` QInt8 ＋ 行単位 Int8 `Gather` ＋ Encoder/Decoder FP16） | 1,394ms → **1,131ms** | 159ms → **144ms**<br>(**FP32 より高速**) | 159/163 行完全一致 (97.5%)<br>文字一致率 **99.83%** |
| **PARSeq-384**<br>`parseq-ndl-24x384-50-tiny-278epoch-261124.int8.onnx` | 37.81 MB | **18.60 MB** | **-50.8%** | Hybrid（`/head` `MatMulInteger` QInt8 ＋ 行単位 Int8 `Gather` ＋ Encoder/Decoder FP16） | 1,542ms → **1,700ms** | 193ms → **192ms** | 162/163 行完全一致 (99.4%)<br>文字一致率 **99.99%** |
| **コア 3 モデル小計** | **114.83 MB** | **48.83 MB** | **-57.5%** | — | — | — | **50 MB 未満を達成（v1.2 比 -1.0 MB）** |
| **TableCenterNet (遅延ロード)**<br>`tablecenternet_s_800_v3.fp16.onnx` | 28.48 MB | **14.39 MB** | **-49.5%** | `Conv` + `DeformConv` 全重み FP16 格納 (`Cast float16→float32`) | 51ms → **56ms** | 2,654ms → **2,637ms** | 中心ピーク **138/138 完全一致**<br>最大確率差 **0.0007**（実質無劣化） |
| **全 4 モデル合計** | **143.31 MB** | **63.22 MB** | **-55.9%** | — | — | — | **約 80.1 MB 削減** |

> [!NOTE]
> - 量子化は GPU 不要・CPU のみ（Python 3.13 + `onnx` + `onnxruntime` + `numpy`）で数分以内に完了します。
> - `TableCenterNet` は ONNX opset 19 の `DeformConv` 演算子を 16 個含みますが、同梱の `ort.wasm.min.js` v1.31.1 でネイティブ動作することを実測確認済みです。

---

## 3. V2.0 で新たに得られた量子化・高速化知見

### 知見 A: DEIMv2 への `Conv` FP16 格納併用（15.53 MB → 12.86 MB）
- v1.2 では `Conv` を FP32 のまま残していたため 15.52 MB でしたが、`Conv` 重み（5.40 MB）に **FP16 重み格納（`float16` initializer + `Cast(to=FLOAT)`）** を適用しつつ `MatMul`/`Gemm` を `QUInt8` 動的量子化することで、`ConvInteger` の WASM 遅延を回避したまま **12.86 MB（-68.1%）** へさらに軽量化し、ロード時間も **1,841ms → 1,006ms（約 1.83 倍高速化）** しました。
- なお、`per_channel=True`（`QInt8`）を DEIMv2 に適用すると decoder 内の 3D `MatMul` (`integral/Reshape_1`) で ORT の ShapeInferenceError が発生するため、`DEIMv2` は `QUInt8` per-tensor を採用しています。

### 知見 B: V2.0 `PARSeq-256`（499epoch）ではエンコーダ層の量子化感度が上昇
- v1.2（189epoch）では `PARSeq-256` の `/proj/` や `blocks.6..11/mlp/fc1` まで `MatMulInteger` 化しても 98.78% を維持できましたが、V2.0（499epoch・手書き/英文強化・デコーダ 41 ステップ展開）で同一レシピを適用すると **95.98%** まで低下しました（`/decoder/` 追加時は 95.24〜97.43%）。
- そのため V2.0 では `PARSeq-256`・`PARSeq-384` ともに **「`/head` のみ per-channel `QInt8` `MatMulInteger` ＋ 文字埋め込み `Gather` の行単位 Int8 オンデマンド復元 ＋ 残余エンコーダ/デコーダ FP16 格納」** に統一し、`PARSeq-256` で **99.83%（144ms・FP32 より高速）**、`PARSeq-384` で **99.99%（192ms）** のほぼ無劣化精度を達成しました。

### 知見 C: `TableCenterNet` は `Conv`+`DeformConv` 主体のため FP16 格納が最適解
- `tablecenternet_s_800_v3.onnx` は全重みの 99.8% が `Conv`（25.01 MB）および `DeformConv`（3.28 MB）で、`MatMul`/`Gemm` を一切含みません。
- 全 137 個の畳み込み重みを FP16 格納（`Cast(FLOAT)`）することで、**28.48 MB → 14.39 MB（-49.5%）** に半減しつつ、WASM ロード **56ms**・推論 **2,637ms**（FP32 の 2,654ms より高速）・ヒートマップピーク **138/138 完全一致** を実現しました。
- さらに JS デコーダ（[tablecenternet_engine.js](tablecenternet_engine.js)）では、`sigmoid` の単調性を利用してロジット空間で `val < logit(thresh)` の背景ピクセルを 3×3 NMS 前に 99.5% 以上スキップすることで、デコード時間を 1ms 未満へ短縮しています。

### 知見 D: JS 推論パイプライン側の追加高速化とアルゴリズム改良
1. **空白谷分割（`findVerticalSplitX`）による `PARSeq-768` レス長文認識**:
   - 横長行（`charCount === 1` / アスペクト比 `>= 21` / 45 文字超オーバーフロー）の中央 35〜65% 範囲から最もインク量の少ない空白列を O(W×H) (<0.1ms) で検出し、`PARSeq-384` で左右 2 分割認識・結合。42.6 MB の `PARSeq-768` なしで 75 文字級の英文・和文行も高精度に認識します。
2. **`decodeParseq` の Softmax 枝刈り**:
   - 各ステップで全 7,142 語彙に対して `Math.exp()` を計算していた処理に `diff > -20` の枝刈り（`exp(-20) < 2.1e-9`）を導入し、`Math.exp()` 呼び出しを約 99.8% 削減（精度差ゼロ）。
3. **1 パス英文 `auto` ルーティング**:
   - V2.0 の英文実測（UI 13/13 行 100%・長文英文 10/10 行高精度）に基づき、`auto` モードで NDLOCR-Lite V2.0 が高信頼度（`>= 60`）の英文を返した場合は Tesseract への二重実行を省略し、英文画像の OCR 時間を約 1.5〜2.5 秒短縮しました（空または低信頼度時は Tesseract へ安全フォールバック）。
4. **縦書き・横書き双方の単一行スニペット高速パス**:
   - 狭い単一行／単一列の範囲選択時は ~4 秒の DEIMv2 をスキップし PARSeq 直行（~150ms）とする高速パスを縦書き単一列へも拡張。
5. **単一 `ImageData` スナップショット共有と安全ガード付き縦中横（TCY）**:
   - `srcCanvas` からの `getImageData` 読み出しを 1 回に集約し、バレット検出・長文分割・縦中横解析で共有。
   - 縦中横処理は `fullResult.confidence >= 0.90` なら即スキップ（オーバーヘッド 0ms）し、低信頼度時のみ候補チャンクを無回転検証して正当な短英数字（`25`, `11` 等）のみ採用することで、手書き縦書きでの誤分割・ハルシネーションを完全防止しました。

---

## 4. 量子化パイプラインの既存知見（PARSeq 共有 `Gemm` バグ対策等）

PARSeq はデコーダの自己回帰ステップ（V2.0 `24x256` では 41 ステップ / `Gemm` 82 個、`24x384` では 52 ステップ / `Gemm` 104 個）をグラフ展開しているため、標準の `quantize_dynamic` をそのまま掛けると `Gemm(transB=1)` の共有重みがインプレースで偶数回転置され出力が崩壊します。本プロジェクトでは以下の 5 段階パイプラインで安全に変換しています：
1. `Gemm(transB=1)` を `<weight>__T` 別名 initializer として 1 度だけ生成し `MatMul + Add` へ非破壊展開。
2. 定数 initializer を隠蔽する冗長な `Identity` ノード（450 / 562 個）を短絡除去。
3. `model.text_embed.embedding.weight`（`[7144, 192]`, 5.49 MB）の `Gather` を `Gather(int8) → Cast(f32) → Mul(Gather(row_scale))` へ書き換え、参照行のみオンデマンド逆量子化。
4. `/head` 以外のエンコーダ・デコーダ・`Conv` 重みを `float16` initializer ＋ `Cast(to=FLOAT)` へ変換。
5. `/head` の `MatMul` ノードのみ `quantize_dynamic(..., weight_type=QuantType.QInt8, per_channel=True, extra_options={'MatMulConstBOnly': True})` を適用。

---

## 5. 拡張機能への組み込み・配布構成と検証記録

- **配置先**: `PlaMo_translate/vendor/ndlocr/`
  - `deim-s-1024x1024-261124.int8.onnx`（12,855,692 bytes / 約 12.86 MB）
  - `parseq-ndl-24x256-30-tiny-499epoch-261124.int8.onnx`（17,366,917 bytes / 約 17.37 MB）
  - `parseq-ndl-24x384-50-tiny-278epoch-261124.int8.onnx`（18,595,504 bytes / 約 18.60 MB）
  - `tablecenternet_s_800_v3.fp16.onnx`（14,392,963 bytes / 約 14.39 MB、遅延ロード）
  - `ndl_charlist.js`（7,141 文字、V2.0 `NDLmoji.yaml` と完全一致確認済み）
  - `ndl_character_inclusion.js`（4,905 件 / 58.4 KB、V2.0 異体字包摂辞書）
  - `LICENSE.md`（Meta DINOv3 License）
- **GitHub リポジトリでの扱い**: `.gitignore` にて `vendor/ndlocr/*.onnx` および `vendor/*.zip` は追跡対象外です。ローカル実行時は GitHub Releases の `ndlocr.zip` を展開して上記ファイルを `PlaMo_translate/vendor/ndlocr/` へ配置してください。
- **検証済み項目**:
  - `ort.wasm.min.js`（v1.31.1, `numThreads: 1`）上での全 4 モデル E2E 推論（異体字包摂 ON/OFF、5×4 表組 Markdown/HTML 変換、長文英文空白分割、英文 UI、手書き縦書き）
  - 全 10 JS ファイルの `node -c` 構文検証クリア
  - 全 13 ユニット＆契約テストスイート（`test/` 配下、既存 12 スイート＋新規 `test/test_ndlocr_v2_features.js`）全件パス
- **ライセンス・クレジット表記**:
  - 元モデル・辞書・前処理仕様: 国立国会図書館（NDL Lab）[ndl-lab/ndlocr-lite](https://github.com/ndl-lab/ndlocr-lite) v2.0.0（[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)）
  - レイアウト認識モデルのバックボーンには **DINOv3** 蒸留モデルが使われているため、CC BY 4.0 に加え Meta **DINOv3 ライセンス** 等が適用されます（詳細は [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照）。
