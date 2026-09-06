// Azure Translator（自定义 endpoint + key + region）
// background (MV3 service worker, ES module)

import { Provider, retry } from "./provider.js";

export class AzureProvider extends Provider {
  constructor() {
    super("azure", 1, "api-key", { batch: true, context: false });
  }

  async available() {
    const key = this.config && this.config.apiKey;
    return !!key;
  }

  _endpoint() {
    const ep = (this.config && this.config.endpoint) || "https://api.cognitive.microsofttranslator.com";
    return ep.replace(/\/+$/, "");
  }

  async translate(req) {
    const texts = req.texts || [];
    if (!texts.length) return { translations: [], used: this.id, ok: true };

    const key = this.config && this.config.apiKey;
    if (!key) throw new Error("azure: apiKey not configured");

    const region = (this.config && this.config.region) || "";
    const src = req.source && req.source !== "auto" ? req.source : "auto";
    const tgt = (req.target || "zh-CN").split("-")[0];

    const result = await retry(async () => {
      const headers = {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/json",
      };
      if (region) headers["Ocp-Apim-Subscription-Region"] = region;

      const url = `${this._endpoint()}/translate?api-version=3.0&from=${encodeURIComponent(src)}&to=${encodeURIComponent(tgt)}`;
      const body = texts.map((t) => ({ text: t }));

      const res = await this._fetchWithTimeout(
        url,
        { method: "POST", headers, body: JSON.stringify(body) },
        20000
      );
      if (!res.ok) throw new Error(`azure http ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error("azure bad response");

      const translations = data.map((item) => {
        if (item && Array.isArray(item.translations) && item.translations[0]) {
          return item.translations[0].text;
        }
        return "";
      });
      return translations;
    }, 3, 1000);

    return { translations: result, used: this.id, ok: true };
  }
}