// Google 免费网页翻译端点（免 Key，沉浸式翻译同款）
// background (MV3 service worker, ES module)

import { Provider, retry, mapWithConcurrency, chunkByChar, splitChunk } from "./provider.js";

/**
 * Google translate_a/single 端点。
 * 注意：非官方 API，无稳定额度承诺；个人日常使用基本够用；需翻墙。
 *
 * 提速策略：
 *  - 短段用换行聚合（≤1800 字符/请求），一次请求翻多段，再按行拆回（行数不匹配则回退逐段）
 *  - 其余段落走并发池（并发 5）
 *  - retry 下沉到单请求
 */
export class GoogleProvider extends Provider {
  constructor() {
    super("google", 1, "free-keyless", { batch: true, context: false });
    this.CONCURRENCY = 5;
  }

  async available() {
    return true;
  }

  async translate(req) {
    const texts = req.texts || [];
    if (!texts.length) return { translations: [], used: this.id, ok: true };

    const src = req.source && req.source !== "auto" ? req.source : "auto";
    const tgt = (req.target || "zh-CN").split("-")[0]; // google 只用语言根
    const maxChars = 1800;

    const out = new Array(texts.length).fill("");

    // ---- 1. 短段聚合：段短且聚合后 ≤maxChars 才命中预聚合 ----
    const aggIndex = []; // texts 中参与聚合的原始下标
    const aggTexts = []; // 对应原始文本
    for (let i = 0; i < texts.length; i++) {
      if (texts[i].length < 300) {
        aggIndex.push(i);
        aggTexts.push(texts[i]);
      }
    }

    if (aggTexts.length) {
      const { chunks, counts } = chunkByChar(aggTexts, maxChars, "\n");
      const chunkResults = await mapWithConcurrency(chunks, this.CONCURRENCY, async (chunk) => {
        return await retry(() => this._translateOne(chunk, src, tgt), 3, 1000);
      });

      let offset = 0;
      for (let c = 0; c < chunks.length; c++) {
        const n = counts[c];
        const lines = splitChunk(chunkResults[c], n, "\n");
        if (lines) {
          for (let k = 0; k < n; k++) out[aggIndex[offset + k]] = lines[k];
        }
        offset += n;
      }
    }

    // ---- 2. 未命中聚合并行的段，并发翻译 ----
    const parallelIdx = [];
    const parallelTexts = [];
    for (let i = 0; i < texts.length; i++) {
      if (!out[i]) {
        parallelIdx.push(i);
        parallelTexts.push(texts[i]);
      }
    }

    if (parallelTexts.length) {
      const parallelResults = await mapWithConcurrency(parallelTexts, this.CONCURRENCY, async (t) => {
        return await retry(() => this._translateOne(t, src, tgt), 3, 1000);
      });
      for (let i = 0; i < parallelResults.length; i++) out[parallelIdx[i]] = parallelResults[i];
    }

    return { translations: out, used: this.id, ok: true };
  }

  async _translateOne(text, src, tgt) {
    const url =
      "https://translate.googleapis.com/translate_a/single?client=gtx&dt=t" +
      `&sl=${encodeURIComponent(src)}&tl=${encodeURIComponent(tgt)}` +
      `&q=${encodeURIComponent(text)}`;

    const res = await this._fetchWithTimeout(url, { method: "GET" }, 20000);
    if (!res.ok) throw new Error(`google http ${res.status}`);

    const data = await res.json();
    if (!Array.isArray(data) || !data[0]) throw new Error("google bad response");

    // 拼接所有 segment 译文
    let out = "";
    for (const seg of data[0]) {
      if (seg && seg[0]) out += seg[0];
    }
    if (!out) throw new Error("google empty translation");
    return out;
  }
}