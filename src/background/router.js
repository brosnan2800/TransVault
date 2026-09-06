// Router：分层选择 + 回退 + 缓存 + 配额
// background (MV3 service worker, ES module)

import { GoogleProvider } from "./providers/google.js";
import { LingvaProvider } from "./providers/lingva.js";
import { LibreProvider } from "./providers/libre.js";
import { AzureProvider } from "./providers/azure.js";
import { AliyunProvider } from "./providers/aliyun.js";
import { BaiduProvider } from "./providers/baidu.js";
import { TencentProvider } from "./providers/tencent.js";
import { LLMProvider } from "./providers/llm.js";
import { BaoyuProvider } from "./providers/baoyu.js";

// 引入 shared（副作用挂载 globalThis）
import "../shared/config.js";
import "../shared/util.js";
import "../shared/storage.js";

const Cfg = globalThis.TransVaultConfig;
const U = globalThis.TransVaultUtil;
const Store = globalThis.TransVaultStorage;

export class Router {
  constructor() {
    this.providers = {};
    this._initProviders();
  }

  _initProviders() {
    const google = new GoogleProvider();
    const lingva = new LingvaProvider();
    const libre = new LibreProvider();
    const azure = new AzureProvider();
    const azureChina = new AzureProvider();
    azureChina.id = "azure-china";
    const aliyun = new AliyunProvider();
    const baidu = new BaiduProvider();
    const tencent = new TencentProvider();
    const llm = new LLMProvider();
    const baoyu = new BaoyuProvider();
    baoyu.setLLM(llm);

    this.providers = {
      google,
      lingva,
      libretranslate: libre,
      azure,
      "azure-china": azureChina,
      aliyun,
      baidu,
      tencent,
      llm,
      baoyu,
    };
  }

  /** 根据 settings 注入各 provider 的配置 */
  _applyConfig(settings) {
    const p = this.providers;
    p.libretranslate.config = { baseUrl: settings.libreTranslateUrl, apiKey: "" };
    p.azure.config = {
      apiKey: settings.azure.key1 || settings.azure.key2,
      region: settings.azure.region,
      endpoint: "https://api.cognitive.microsofttranslator.com",
    };
    p["azure-china"].config = {
      apiKey: settings.azureChina.key1 || settings.azureChina.key2,
      region: settings.azureChina.region,
      endpoint: "https://api.translator.azure.cn",
    };
    p.aliyun.config = {
      accessKeyId: settings.aliyun.accessKeyId,
      accessKeySecret: settings.aliyun.accessKeySecret,
      region: settings.aliyun.region || "cn-hangzhou",
    };
    p.baidu.config = {
      appid: settings.baidu.appId,
      key: settings.baidu.appSecret,
    };
    p.tencent.config = {
      secretId: settings.tencent.secretId,
      secretKey: settings.tencent.secretKey,
      region: settings.tencent.region || "ap-guangzhou",
    };

    // LLM：激活配置
    const llmCfg = settings.llm || {};
    const activeIdx = llmCfg.activeProviderIndex;
    const active = Array.isArray(llmCfg.providers) && activeIdx >= 0 ? llmCfg.providers[activeIdx] : null;
    p.llm.setActive(active);
  }

  /**
   * 翻译入口
   * @param {Object} req { texts, source, target, style, audience, mode }
   * @param {Object} settings
   * @returns {Promise<{translations:string[], used:string, ok:boolean, error?:string}>}
   */
  async translate(req, settings) {
    this._applyConfig(settings);

    const texts = (req.texts || []).filter((t) => t && t.trim());
    if (!texts.length) return { translations: [], used: "", ok: true };

    // 1. 先查缓存（整批命中才返回）
    const cacheKey = this.buildCacheKey(req, settings);
    const cached = await Store.cacheGet(cacheKey);
    if (cached) {
      return { translations: cached, used: "cache", ok: true };
    }

    // 2. 按 engineOrder 依次尝试
    const order = settings.engineOrder && settings.engineOrder.length ? settings.engineOrder : ["google"];
    let lastErr = null;

    for (const id of order) {
      const provider = this.providers[id];
      if (!provider) continue;

      // 配额检查
      const limit = FREE_LIMITS[id] || 0;
      const quota = await Store.quotaGet(id);
      if (limit > 0 && quota.used >= limit) {
        lastErr = new Error(`${id}: 本月免费额度已用完`);
        continue;
      }

      // 可用性检查
      let avail = true;
      try {
        avail = await provider.available();
      } catch {
        avail = false;
      }
      if (!avail) {
        lastErr = new Error(`${id}: 不可用`);
        continue;
      }

      try {
        const result = await provider.translate(req);
        if (result.ok && result.translations && result.translations.length === texts.length) {
          // 记配额
          const chars = texts.reduce((s, t) => s + t.length, 0);
          await Store.quotaAdd(id, chars, limit);
          // 写缓存
          await Store.cacheSet(cacheKey, result.translations);
          return { translations: result.translations, used: id, ok: true };
        }
        lastErr = new Error(`${id}: 返回数量不匹配`);
      } catch (e) {
        lastErr = e;
      }
    }

    return { translations: [], used: "", ok: false, error: lastErr ? lastErr.message : "所有引擎均失败" };
  }

  /** 构造缓存键（含 text+lang+engine+style+mode） */
  buildCacheKey(req, settings) {
    const parts = [
      req.texts.join("\u0001"),
      req.source || "auto",
      req.target || "zh-CN",
      (settings.engineOrder || []).join(","),
      req.style || "",
      req.mode || "",
    ];
    return U.hash(parts.join("|"));
  }
}

// 免费额度表（与上面 FREE_LIMITS 一致，供外部引用）
const FREE_LIMITS = {
  google: 0,
  lingva: 0,
  libretranslate: 0,
  azure: 2000000,
  "azure-china": 2000000,
  aliyun: 1000000,
  baidu: 0,
  tencent: 5000000,
  llm: 0,
  baoyu: 0,
};

export { FREE_LIMITS };