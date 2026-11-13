# Third-Party Software & Model Notices

This extension (`PlaMo_translate`) bundles or builds upon the following third-party open-source software and open models. Notice texts and attributions are provided below.

---

## 1. NDLOCR-Lite (National Diet Library, Japan / 国立国会図書館)

- **Source Repository**: https://github.com/ndl-lab/ndlocr-lite
- **Author / Rights Holder**: National Diet Library, Japan (国立国会図書館 / NDL Lab)
- **License**: **Creative Commons Attribution 4.0 International (CC BY 4.0)**  
  https://creativecommons.org/licenses/by/4.0/
- **Summary of Modifications Made in This Project**:
  - Ported layout detection (`deim.py`) and text recognition (`parseq.py`, `ocr.py`) pre/post-processing pipelines to browser JavaScript in `ndlocr_engine.js`, with crop-margin, reading-order, and UI-text layout post-processing enhancements.
  - Extracted the character vocabulary from `NDLmoji.yaml` into `vendor/ndlocr/ndl_charlist.js`.
  - Applied INT8 / FP16 hybrid quantization and ONNX graph optimizations to the `DEIMv2` and `PARSeq` models (`vendor/ndlocr/*.int8.onnx`) for single-threaded `onnxruntime-web` WASM execution (documented in `NDLOCR_QUANTIZATION.md` / `NDLOCR_QUANTIZATION.en.md`).
- **Additional Model / Dependency Terms (`Built with DINOv3`)**:
  - The layout detection model (`DEIMv2`) uses weights derived from a distilled **DINOv3** backbone (`Built with DINOv3`); usage and any redistribution of the pretrained or quantized NDLOCR-Lite models are additionally subject to the Meta **DINOv3 License** (https://github.com/facebookresearch/dinov3/blob/main/LICENSE.md) and dependency terms listed in `ndl-lab/ndlocr-lite`'s `LICENCE_DEPENDENCIES` (https://github.com/ndl-lab/ndlocr-lite).
  - Note: `.onnx` model binaries are excluded from Git repository tracking via `.gitignore`. If you package and redistribute the `.int8.onnx` binaries in a GitHub Release archive, include a copy of the DINOv3 License alongside the release assets.
- **Boundary with Repository MIT License**:
  - Original extension code authored for this repository is licensed under the MIT License ([LICENSE](LICENSE)), whereas `ndlocr_engine.js`, `vendor/ndlocr/ndl_charlist.js`, and NDLOCR-Lite model derivatives remain governed by **CC BY 4.0** (and DINOv3 License terms for model weights).

---

## 2. Tesseract.js (`v5.1.1`) & `tesseract.js-core` (`vendor/tesseract/`)

- **Source Repository**: https://github.com/naptha/tesseract.js  
  Core Engine: https://github.com/naptha/tesseract.js-core (WebAssembly port of Google / HP Tesseract OCR)
- **License**: **Apache License, Version 2.0**

```text
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the copyright notice in Section 4(c).

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate acts) or agreed
      to in writing, shall any Contributor be liable to You for damages,
      including any direct, indirect, special, incidental, or consequential
      damages of any character arising as a result of this License or out of
      the use or inability to use the Work (including but not limited to
      damages for loss of goodwill, work stoppage, computer failure or
      malfunction, or any and all other commercial damages or losses), even
      if such Contributor has been advised of the possibility of such
      damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.
```

---

## 3. ONNX Runtime Web (`v1.31.1`, `vendor/ort/`)

- **Source Repository**: https://github.com/microsoft/onnxruntime
- **License**: **MIT License**

```text
Copyright (c) Microsoft Corporation. All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 4. `@wllama/wllama` (`v3.8.1`, `vendor/wllama/`) & `llama.cpp`

- **Source Repository**: https://github.com/ngxson/wllama (see also `vendor/wllama/LICENCE`)
- **License**: **MIT License** (`llama.cpp` by The ggml authors is also licensed under the **MIT License**)

```text
MIT License

Copyright (c) 2024 Xuan Son NGUYEN

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 5. PLaMo 3 Translate Models

- **Models**: `pfnet/plamo-3-translate-0.8b-GGUF`, `pfnet/plamo-3-translate-2b` (and PLaMo 3 Translate 8B / 31B)
- **Provider**: Preferred Networks, Inc. (PFN)
- **License**: **PLaMo Community License** — https://plamo.preferredai.jp/info/plamo-community-license-ja
  - Downloaded on demand by the user from Hugging Face or served via user-managed LM Studio; model weights are not redistributed inside this repository.

