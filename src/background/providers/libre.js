// LibreTranslate 自托管（可自定义实例地址 + API Key）
// background (MV3 service worker, ES module)
// 提速：q 支持数组（一次 POST 翻多段）；批量失败/超时回退逐段并发。

import { Provider, retry, mapWithConcurrency, chunkByChar } from "./provider.js";

export class LibreProvider extends Provider {
  constructor() {
    super("libre", 1, "api-key", { batch: true, context: false });
    this.CONCURRENCY = 4;
    this.BATCH_MAX = 1800; // 单请求字符上限
  }

  async available() {
    const base = this._baseUrl();
    if (!base) return false;
    try {
      const res = await this._fetchWithTimeout(
        `${base}/languages`,
        { method: "GET" },
        5000
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  _baseUrl() {
    const url = (this.config && this.config.baseUrl) || "";
    return url.replace(/\/+$/, "");
  }

  async translate(req) {
    const texts = req.texts || [];
    if (!texts.length) return { translations: [], used: this.id, ok: true };

    const base = this._baseUrl();
    if (!base) throw new Error("libre: baseUrl not configured");

    const src = req.source && req.source !== "auto" ? req.source : "auto";
    const tgt = (req.target || "zh-CN").split("-")[0];
    const apiKey = (this.config && this.config.apiKey) || "";

    const out = new Array(texts.length).fill("");

    // ---- 1. 尝试真批量（q 为数组）----
    const { chunks, counts } = chunkByChar(texts, this.BATCH_MAX, "\n");
    let batchFailed = false;

    let offset = 0;
    for (let c = 0; c < chunks.length && !batchFailed; c++) {
      const chunk = chunks[c];
      const n = counts[c];
      try {
        const translated = await retry(() => this._translateBatch(chunk, src, tgt, base, apiKey), 3, 1000);
        if (Array.isArray(translated) && translated.length === n) {
          for (let k = 0; k < n; k++) out[offset + k] = translated[k];
        } else {
          batchFailed = true;
        }
      } catch {
        batchFailed = true;
      }
      offset += n;
    }

    // ---- 2. 未命中批量的段，逐段并发 ----
    const parallelIdx = [];
    const parallelTexts = [];
    for (let i = 0; i < texts.length; i++) {
      if (!out[i]) {
        parallelIdx.push(i);
        parallelTexts.push(texts[i]);
      }
    }

    if (parallelTexts.length) {
      const results = await mapWithConcurrency(parallelTexts, this.CONCURRENCY, async (text) => {
        return await retry(() => this._translateOne(text, src, tgt, base, apiKey), 3, 1000);
      });
      for (let i = 0; i < results.length; i++) out[parallelIdx[i]] = results[i];
    }

    return { translations: out, used: this.id, ok: true };
  }

  async _translateBatch(chunkText, src, tgt, base, apiKey) {
    const body = {
      q: chunkText.split("\n"),
      source: src,
      target: tgt,
      format: "text",
    };
    if (apiKey) body.api_key = apiKey;

    const res = await this._fetchWithTimeout(
      `${base}/translate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      20000
    );
    if (!res.ok) throw new Error(`libre http ${res.status}`);
    const data = await res.json();
    if (!data || !Array.isArray(data.translatedText)) throw new Error("libre bad batch response");
    return data.translatedText;
  }

  async _translateOne(text, src, tgt, base, apiKey) {
    const body = {
      q: text,
      source: src,
      target: tgt,
      format: "text",
    };
    if (apiKey) body.api_key = apiKey;

    const res = await this._fetchWithTimeout(
      `${base}/translate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      20000
    );
    if (!res.ok) throw new Error(`libre http ${res.status}`);
    const data = await res.json();
    if (!data || typeof data.translatedText !== "string") {
      throw new Error("libre bad response");
    }
    return data.translatedText;
  }
}