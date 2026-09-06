// TransVault 工具函数（经典脚本，无 import/export）
// 同时被 content script、background、popup/options 加载使用。

(function () {
  const U = {
    /** 是否运行在 service worker（无 window） */
    isBackground: typeof window === "undefined",

    /** 简单字符串 hash（FNV-1a 64bit → hex） */
    hash(text) {
      let h1 = 0x811c9dc5;
      let h2 = 0x01000193;
      const s = String(text);
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
        h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
      }
      // 拼出 16 位 hex
      return ("00000000" + h1.toString(16)).slice(-8) + ("00000000" + h2.toString(16)).slice(-8);
    },

    /** 对象深合并（defaults ← override） */
    deepMerge(base, override) {
      if (!override) return base;
      const out = Array.isArray(base) ? base.slice() : { ...base };
      for (const k of Object.keys(override)) {
        const v = override[k];
        if (
          v &&
          typeof v === "object" &&
          !Array.isArray(v) &&
          base &&
          typeof base === "object" &&
          base[k] &&
          typeof base[k] === "object" &&
          !Array.isArray(base[k])
        ) {
          out[k] = U.deepMerge(base[k], v);
        } else {
          out[k] = v;
        }
      }
      return out;
    },

    /** 当前页面的 host（如 www.example.com） */
    hostname(url) {
      try {
        return new URL(url || location.href).hostname;
      } catch {
        return "";
      }
    },

    /** 是否可翻译文本：至少 2 个非空白字符，且含字母 */
    isTranslatable(text) {
      if (!text || typeof text !== "string") return false;
      const t = text.trim();
      if (t.length < 2) return false;
      // 若与目标语言相同则跳过（简单判断：目标为中文时无 latin 字母的行）
      return true;
    },

    /** 主要中文（汉字为主，不含明显假名/韩文） */
    isMostlyChinese(text) {
      const t = text.trim();
      if (!t) return false;
      let han = 0, total = 0;
      for (const ch of t) {
        const code = ch.codePointAt(0);
        total++;
        if (
          (code >= 0x4e00 && code <= 0x9fff) ||
          (code >= 0x3400 && code <= 0x4dbf) ||
          (code >= 0xf900 && code <= 0xfaff)
        ) han++;
      }
      return total > 0 && han / total > 0.3;
    },

    /** 主要日文（假名占比较高） */
    isMostlyJapanese(text) {
      const t = text.trim();
      if (!t) return false;
      let kana = 0, total = 0;
      for (const ch of t) {
        const code = ch.codePointAt(0);
        total++;
        if (code >= 0x3040 && code <= 0x30ff) kana++;
      }
      return total > 0 && kana / total > 0.2;
    },

    /** 主要韩文 */
    isMostlyKorean(text) {
      const t = text.trim();
      if (!t) return false;
      let hangul = 0, total = 0;
      for (const ch of t) {
        const code = ch.codePointAt(0);
        total++;
        if (code >= 0xac00 && code <= 0xd7af) hangul++;
      }
      return total > 0 && hangul / total > 0.3;
    },

    /** 主要拉丁字母（欧洲语言） */
    isMostlyLatin(text) {
      const t = text.trim();
      if (!t) return false;
      let latin = 0, total = 0;
      for (const ch of t) {
        const code = ch.codePointAt(0);
        total++;
        if (
          (code >= 0x41 && code <= 0x5a) ||   // A-Z
          (code >= 0x61 && code <= 0x7a) ||   // a-z
          (code >= 0xc0 && code <= 0x17f) ||  // 拉丁扩展（é/ñ/ß 等）
          (code >= 0x0100 && code <= 0x017f)
        ) latin++;
      }
      return total > 0 && latin / total > 0.5;
    },

    /**
     * 判断文本是否「很可能已经是目标语言」，用于整页翻译时跳过已同语言内容。
     * 启发式按目标语言语系匹配脚本，不精确但实用。
     */
    isLikelyTargetLang(text, targetLang) {
      const tgt = (targetLang || "zh-CN").toLowerCase();
      if (tgt.startsWith("zh")) return this.isMostlyChinese(text);
      if (tgt.startsWith("ja")) return this.isMostlyJapanese(text);
      if (tgt.startsWith("ko")) return this.isMostlyKorean(text);
      // 拉丁语系目标（en/fr/de/es/it/pt 等）：跳过已是拉丁文本（防止「英→英」重复翻译）
      return this.isMostlyLatin(text);
    },

    /** 文本里是否主要是 CJK（中文/日文/韩文） */
    isMostlyCJK(text) {
      const t = text.trim();
      if (!t) return false;
      let cjk = 0;
      let total = 0;
      for (const ch of t) {
        const code = ch.codePointAt(0);
        total++;
        if (
          (code >= 0x4e00 && code <= 0x9fff) || // CJK 统一表意
          (code >= 0x3400 && code <= 0x4dbf) || // 扩展A
          (code >= 0xf900 && code <= 0xfaff) || // 兼容表意
          (code >= 0x3040 && code <= 0x30ff) || // 日文假名
          (code >= 0xac00 && code <= 0xd7af)    // 韩文音节
        ) {
          cjk++;
        }
      }
      return total > 0 && cjk / total > 0.3;
    },

    /** 规范化语言码：把 zh → zh-CN 等 */
    normalizeLang(lang) {
      if (!lang) return "zh-CN";
      const map = {
        zh: "zh-CN",
        "zh-cn": "zh-CN",
        "zh-tw": "zh-TW",
        en: "en",
        ja: "ja",
        ko: "ko",
        fr: "fr",
        de: "de",
        es: "es",
        ru: "ru",
        it: "it",
        pt: "pt",
      };
      if (map[String(lang).toLowerCase()]) return map[String(lang).toLowerCase()];
      return String(lang);
    },

    /** 睡眠 */
    sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    },

    /** 轻量事件总线（用于 content script 内部模块通信） */
    makeBus() {
      const handlers = {};
      return {
        on(event, fn) {
          (handlers[event] = handlers[event] || []).push(fn);
        },
        off(event, fn) {
          const arr = handlers[event];
          if (!arr) return;
          const i = arr.indexOf(fn);
          if (i >= 0) arr.splice(i, 1);
        },
        emit(event, payload) {
          (handlers[event] || []).forEach((fn) => {
            try {
              fn(payload);
            } catch (e) {
              console.warn("[TransVault] handler error", e);
            }
          });
        },
      };
    },

    /** 给 HTML 元素加唯一 id（用于 chained 元素） */
    uid(prefix) {
      return (prefix || "tv") + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
    },
  };

  globalThis.TransVaultUtil = U;
})();