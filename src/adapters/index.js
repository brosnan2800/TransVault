// TransVault 站点适配器仓库（content script）
// 职责：为订阅墙 / 结构墙站点提供专属提取规则，使 page-translator 能拿到干净正文
// 每个 host 一组规则：containerSelector / textSelector / excludeSelectors / mergeTextSelectors
// 依赖：shared/dynamic-core.js 的 resolveAdapter / matchHost
// 经典脚本，挂 globalThis.TransVaultAdapters

(function () {
  const Core = globalThis.TransVaultDynamicCore;

  const ADAPTERS = {
    // ---- Substack ----
    "substack.com": {
      containerSelector: "article, .post, main, [class*='post-content'], [class*='body']",
      textSelector: "p, h1, h2, h3, h4, li, blockquote",
      nameSelector: "[class*='author'], [class*='byline'], [data-testid='author']",
      excludeSelectors: [
        "script, style, nav, footer, header",
        "[class*='subscribe'], [class*='paywall'], [class*='membership']",
        "[class*='share'], [class*='comment'], [class*='meta']",
        "[role='dialog'], [class*='overlay']",
      ],
      mergeTextSelectors: ["p, h1, h2, h3, h4, li"],
    },

    // ---- Medium ----
    "*.medium.com": {
      containerSelector: "article, main, [class*='postArticle'], section",
      textSelector: "p, h1, h2, h3, h4, li, blockquote, figcaption",
      nameSelector: "[class*='ds-link'], [data-testid='authorName'], a[rel='author']",
      excludeSelectors: [
        "script, style, nav, footer, header, aside",
        "[class*='metabar'], [class*='postActions']",
        "[class*='responses'], [class*='comments']",
        "[class*='paywall'], [class*='member'], [class*='upsell']",
        "[role='dialog'], [class*='overlay'], [class*='branch']",
      ],
      mergeTextSelectors: ["p, h1, h2, h3, h4, figcaption"],
    },
    "medium.com": {
      containerSelector: "article, main",
      textSelector: "p, h1, h2, h3, h4",
      excludeSelectors: [
        "script, style, nav, footer",
        "[class*='metabar'], [class*='postActions']",
      ],
      mergeTextSelectors: ["p"],
    },

    // ---- The Economist ----
    "economist.com": {
      containerSelector: "article, main, [class*='layout-article'], [class*='ds-layout']",
      textSelector: "p, h1, h2, h3, h4, li",
      nameSelector: "[class*='author'], [class*='byline'], [data-testid='author']",
      excludeSelectors: [
        "script, style, nav, footer, header, aside",
        "[class*='newsletter'], [class*='subscribe']",
        "[class*='paywall'], [class*='metered'], [class*='ds-mega-banner']",
        "[class*='comments'], [class*='related'], [class*='teaser']",
        "[role='dialog'], [class*='overlay']",
      ],
      mergeTextSelectors: ["p, h1, h2, h3, h4"],
    },

    // ---- Bloomberg ----
    "bloomberg.com": {
      containerSelector: "article, main, [class*='story-body'], [class*='content-body']",
      textSelector: "p, h1, h2, h3, h4",
      nameSelector: "[class*='author'], [class*='byline']",
      excludeSelectors: [
        "script, style, nav, footer, header, aside",
        "[class*='paywall'], [class*='metered']",
        "[class*='newsletter'], [class*='related']",
        "[class*='ad'], [class*='footer']",
      ],
      mergeTextSelectors: ["p"],
    },

    // ---- Financial Times ----
    "ft.com": {
      containerSelector: "article, main, [class*='article__body'], [data-trackable='article-body']",
      textSelector: "p, h1, h2, h3, h4, li",
      nameSelector: "[class*='article__author'], [data-trackable='byline']",
      excludeSelectors: [
        "script, style, nav, footer, header, aside",
        "[class*='paywall'], [class*='metered']",
        "[class*='o-footer'], [class*='o-header']",
      ],
      mergeTextSelectors: ["p"],
    },
  };

  function getAdapter(host) {
    const h = host || (location && location.hostname) || "";
    if (!Core) return null;
    const ad = Core.resolveAdapter(h, ADAPTERS);
    if (ad) ad.isSiteAdapter = true;
    return ad;
  }

  function extractText(container, adapter) {
    if (!container || !adapter) return "";
    if (adapter.textSelector) {
      const out = [];
      container.querySelectorAll(adapter.textSelector).forEach((n) => {
        const t = (n.textContent || "").trim();
        if (t) out.push(t);
      });
      if (out.length) return out.join("\n\n");
    }
    return (container.textContent || "").trim();
  }

  const API = { ADAPTERS, getAdapter, extractText };
  globalThis.TransVaultAdapters = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();