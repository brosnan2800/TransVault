// TransVault 站点适配器（content script）
// 职责：按域名返回站点专属翻译规则（容器/正文/排除选择器），使动态、结构特殊的站点
//       （如 x.com）能被精确翻译，而不是用通用块级逻辑硬套。
// 依赖：shared/dynamic-core.js（已先行加载）的 resolveAdapter / matchHost

(function () {
  const Core = globalThis.TransVaultDynamicCore;
  const U = globalThis.TransVaultUtil;

  // 适配器登记表：key 为域名匹配模式（支持 * 通配），value 为规则对象。
  // 规则字段：
  //   containerSelector  翻译根容器（observer 把变更聚合到这个容器，作为整体翻译）
  //   textSelector       容器内的正文选择器（用于提取要翻译的文本）
  //   nameSelector       用户名/账号（不翻译，仅用于定位）
  //   excludeSelectors   容器内不翻译的子选择器
  const ADAPTERS = {
    "x.com": {
      containerSelector: "article[data-testid='tweet']",
      textSelector: "[data-testid='tweetText']",
      nameSelector: "[data-testid='User-Name']",
      excludeSelectors: [
        "[role='link']",
        "[data-testid='User-Name']",
        "time",
        "[data-testid='SocialContext']",
        "[aria-label]",
        "[data-testid='like']",
        "[data-testid='retweet']",
        "[data-testid='reply']",
        "[data-testid='bookmark']",
        "[data-testid='share']",
        "[data-testid='verified']",
        "[data-testid='action-bar']",
      ],
      // 容器内需要合并为同一根翻译的正文范围（x 的 tweetText 可能拆成多个 span）
      mergeTextSelectors: ["[data-testid='tweetText']"],
    },
    "twitter.com": {
      containerSelector: "article[data-testid='tweet']",
      textSelector: "[data-testid='tweetText']",
      nameSelector: "[data-testid='User-Name']",
      excludeSelectors: [
        "[role='link']",
        "[data-testid='User-Name']",
        "time",
        "[data-testid='SocialContext']",
        "[aria-label]",
        "[data-testid='like']",
        "[data-testid='retweet']",
        "[data-testid='reply']",
        "[data-testid='bookmark']",
        "[data-testid='share']",
        "[data-testid='verified']",
      ],
      mergeTextSelectors: ["[data-testid='tweetText']"],
    },
  };

  /**
   * 按当前 host 解析适配器。
   * @returns {object|null}
   */
  function getAdapter(host) {
    const h = host || (location && location.hostname) || "";
    const adapter = Core ? Core.resolveAdapter(h, ADAPTERS) : null;
    if (adapter) adapter.isSiteAdapter = true;
    return adapter;
  }

  /**
   * 从适配器容器提取正文（多个 textSelector 合并）。
   * @param {Element} container
   * @param {object} adapter
   * @returns {string}
   */
  function extractText(container, adapter) {
    if (!container || !adapter) return "";
    if (adapter.textSelector) {
      const node = container.querySelector(adapter.textSelector);
      if (node && node.textContent) return node.textContent.trim();
    }
    if (adapter.mergeTextSelectors) {
      let out = "";
      for (const sel of adapter.mergeTextSelectors) {
        container.querySelectorAll(sel).forEach((n) => {
          if (n.textContent) out += n.textContent + "\n";
        });
      }
      return out.trim();
    }
    return (container.textContent || "").trim();
  }

  const API = { ADAPTERS, getAdapter, extractText };
  globalThis.TransVaultSiteAdapters = API;
  // 同时暴露到 core，便于 background/popup 按需读取
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
