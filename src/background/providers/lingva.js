// Lingva 公共实例（免 Key、隐私优先；实例不稳定，多实例轮询）
// background (MV3 service worker, ES module)

import { Provider, retry, mapWithConcurrency } from "./provider.js";

const INSTANCES = [
  "https://lingva.ml",
  "https://lingva.lunar.icu",
  "https://translate.plausibility.cloud",
];

export class LingvaProvider extends Provider {
  constructor() {
    super("lingva", 1, "free-keyless", { batch: false, context: false });
    this._healthy = null; // 负缓存：最近一次可用实例
    this._lastCheck = 0;
    this.CONCURRENCY = 4;
  }

  async available() {
    // 负缓存 10 分钟
    if (this._healthy && Date.now() - this._lastCheck < 10 * 60 * 1000) {
      return true;
    }
    for (const inst of INSTANCES) {
      try {
        const res = await this._fetchWithTimeout(
          `${inst}/api/v1/languages`,
          { method: "GET" },
          5000
        );
        if (res.ok) {
          this._healthy = inst;
          this._lastCheck = Date.now();
          return true;
        }
      } catch {
        // 继续尝试下一个实例
      }
    }
    this._healthy = null;
    this._lastCheck = Date.now();
    return false;
  }

  async translate(req) {
    const texts = req.texts || [];
    if (!texts.length) return { translations: [], used: this.id, ok: true };

    const src = req.source && req.source !== "auto" ? req.source : "auto";
    const tgt = (req.target || "zh-CN").split("-")[0];

    // 先确保有可用实例
    if (!this._healthy) {
      const ok = await this.available();
      if (!ok) throw new Error("lingva: no available instance");
    }

    // 并发队列（每个请求独立 retry）
    const result = await mapWithConcurrency(texts, this.CONCURRENCY, async (text) => {
      return await retry(() => this._translateOne(text, src, tgt), 3, 1000);
    });

    return { translations: result, used: this.id, ok: true };
  }

  async _translateOne(text, src, tgt) {
    const inst = this._healthy;
    const url = `${inst}/api/v1/${encodeURIComponent(src)}/${encodeURIComponent(tgt)}/${encodeURIComponent(text)}`;
    const res = await this._fetchWithTimeout(url, { method: "GET" }, 15000);
    if (!res.ok) throw new Error(`lingva http ${res.status}`);
    const data = await res.json();
    if (!data || typeof data.translation !== "string") throw new Error("lingva bad response");
    return data.translation;
  }
}