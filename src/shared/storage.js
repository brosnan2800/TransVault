// TransVault 存储层：settings / cache / quota / perSite 持久化
// 经典脚本（无 import/export），content、background、popup、options 通用。
// 全部走 chrome.storage.local —— MV3 SW 被杀也不丢状态。

(function () {
  const Cfg = globalThis.TransVaultConfig;
  const U = globalThis.TransVaultUtil;

  const KEYS = {
    settings: "tv_settings",
    cache: "tv_cache",
    quotas: "tv_quotas",
  };

  const S = {
    KEYS,

    /** 归一化缓存对象结构 */
    _normCache(raw) {
      return raw && typeof raw === "object" ? raw : {};
    },

    /** 归一化额度对象结构 */
    _normQuotas(raw) {
      return raw && typeof raw === "object" ? raw : {};
    },

    /* ---------- settings ---------- */

    /** 读取设置（与默认值深合并） */
    async getSettings() {
      if (Cfg && U) {
        const r = await chrome.storage.local.get(KEYS.settings);
        const saved = r[KEYS.settings] || {};
        return U.deepMerge(U.deepMerge({}, Cfg.DEFAULTS), saved);
      }
      const r = await chrome.storage.local.get(KEYS.settings);
      return r[KEYS.settings] || {};
    },

    /** 保存设置（整份覆盖，注意先 get 后改） */
    async saveSettings(settings) {
      await chrome.storage.local.set({ [KEYS.settings]: settings });
      return settings;
    },

    /* ---------- 翻译缓存 ---------- */

    /**
     * 取缓存
     * @param {string} key 由 router 构造（含 text+lang+engine+style 的 hash）
     * @returns {Promise<string|null>} 命中返回译文，未命中/过期返回 null
     */
    async cacheGet(key) {
      const r = await chrome.storage.local.get(KEYS.cache);
      const cache = S._normCache(r[KEYS.cache]);
      const entry = cache[key];
      if (!entry) return null;
      if (Date.now() > entry.exp) {
        // 惰性删除
        delete cache[key];
        await chrome.storage.local.set({ [KEYS.cache]: cache });
        return null;
      }
      return entry.value;
    },

    /** 写缓存 */
    async cacheSet(key, value, ttlMs) {
      const ttl = ttlMs || (Cfg && Cfg.DEFAULTS.cacheTTLMs) || 7 * 24 * 3600 * 1000;
      const r = await chrome.storage.local.get(KEYS.cache);
      const cache = S._normCache(r[KEYS.cache]);

      // 超上限时清理过期项；仍超则删最旧 1/3
      let keys = Object.keys(cache);
      const max = (Cfg && Cfg.DEFAULTS.cacheMaxEntries) || 50000;
      if (keys.length >= max) {
        const now = Date.now();
        for (const k of keys) {
          if (cache[k] && cache[k].exp < now) delete cache[k];
        }
        keys = Object.keys(cache);
        if (keys.length >= max) {
          const sorted = keys
            .map((k) => ({ k, exp: cache[k] ? cache[k].exp : 0 }))
            .sort((a, b) => a.exp - b.exp)
            .slice(0, Math.floor(max / 3));
          for (const item of sorted) delete cache[item.k];
        }
      }

      cache[key] = { value, exp: Date.now() + ttl };
      await chrome.storage.local.set({ [KEYS.cache]: cache });
    },

    /** 清空缓存 */
    async cacheClear() {
      await chrome.storage.local.set({ [KEYS.cache]: {} });
    },

    /* ---------- 配额 ---------- */

    /**
     * 记一笔用量并返回是否超限
     * @param {string} providerId
     * @param {number} chars 本次消耗字符数
     * @param {number} limit 月度上限（0=不限）
     * @returns {{ok:boolean, used:number, limit:number}}
     */
    async quotaAdd(providerId, chars, limit) {
      const r = await chrome.storage.local.get(KEYS.quotas);
      const quotas = S._normQuotas(r[KEYS.quotas]);
      const now = Date.now();
      const cur = quotas[providerId] || {};
      // 月周期重置
      const month = new Date(now);
      const monthKey = `${month.getFullYear()}-${month.getMonth() + 1}`;
      if (cur.month !== monthKey) {
        cur.month = monthKey;
        cur.used = 0;
      }
      cur.used = (cur.used || 0) + chars;
      quotas[providerId] = cur;
      await chrome.storage.local.set({ [KEYS.quotas]: quotas });
      const used = cur.used;
      const lmt = limit || 0;
      return { ok: lmt === 0 || used <= lmt, used, limit: lmt };
    },

    /** 读取某 provider 用量（不写） */
    async quotaGet(providerId) {
      const r = await chrome.storage.local.get(KEYS.quotas);
      const quotas = S._normQuotas(r[KEYS.quotas]);
      const cur = quotas[providerId] || {};
      return { used: cur.used || 0, limit: 0, month: cur.month || "" };
    },

    /* ---------- perSite 记忆 ---------- */

    /** 读取某站点记忆 */
    async siteGet(host) {
      const s = await S.getSettings();
      return (s.perSite && s.perSite[host]) || { enabled: true };
    },

    /** 写入某站点记忆 */
    async siteSet(host, patch) {
      const s = await S.getSettings();
      if (!s.perSite) s.perSite = {};
      s.perSite[host] = { ...(s.perSite[host] || {}), ...patch };
      await S.saveSettings(s);
      return s.perSite[host];
    },
  };

  globalThis.TransVaultStorage = S;
})();