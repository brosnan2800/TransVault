// TransVault 翻译墙检测器（content script）
// 职责：检测当前页面属于哪种翻译墙（P/A/D/E/S），产出 WallReport
// 设计：纯判定逻辑 + 证据收集；策略由 wall-router 在 background 调度
// 经典脚本，挂 globalThis.TransVaultWallDetector

(function () {
  const PAYWALL_TEXT_MIN = 200;
  const PAYWALL_KEYWORDS = [
    "subscribe", "subscription", "paywall", "member", "premium",
    "订阅", "付费", "会员",
    "sign in to read", "continue reading", "read the full story",
    "already a subscriber", "create an account"
  ];

  function extractVisibleText() {
    try {
      const clone = document.body.cloneNode(true);
      clone.querySelectorAll("script, style, noscript, nav, footer, header, aside").forEach((n) => n.remove());
      return (clone.textContent || "").replace(/\s+/g, " ").trim().length;
    } catch (e) {
      return (document.body && document.body.textContent ? document.body.textContent.length : 0);
    }
  }

  function totalDomText() {
    return (document.body && document.body.textContent ? document.body.textContent.replace(/\s+/g, " ").trim().length : 0);
  }

  function textCoverage() {
    const total = totalDomText();
    if (!total) return 1;
    return extractVisibleText() / total;
  }

  function detectPaywall() {
    const evidence = [];
    let confidence = 0;
    const visibleLen = extractVisibleText();
    if (visibleLen < PAYWALL_TEXT_MIN) {
      evidence.push("visibleText=" + visibleLen + " < " + PAYWALL_TEXT_MIN);
      confidence += 0.4;
    }
    const bodyText = (document.body && document.body.innerText ? document.body.innerText.toLowerCase() : "");
    for (const kw of PAYWALL_KEYWORDS) {
      if (bodyText.includes(kw.toLowerCase())) {
        evidence.push("keyword=" + kw);
        confidence += 0.15;
        break;
      }
    }
    const paywallDom = document.querySelector(
      "[class*='paywall'], [class*='subscription'], [class*='metered'], [data-testid*='paywall'], [id*='paywall']"
    );
    if (paywallDom) {
      evidence.push("paywallDom=" + (paywallDom.className || paywallDom.id));
      confidence += 0.3;
    }
    const articleMeta = document.querySelector("meta[property*='article'], meta[name*='article']");
    if (articleMeta && visibleLen < 500) {
      evidence.push("articleMeta present but short text");
      confidence += 0.2;
    }
    return { hit: confidence >= 0.4, confidence: Math.min(confidence, 1), evidence };
  }

  function detectAntibot() {
    const evidence = [];
    let confidence = 0;
    const title = (document.title || "").toLowerCase();
    if (title.includes("just a moment") || title.includes("attention required") || title.includes("verify")) {
      evidence.push("title=" + document.title);
      confidence += 0.5;
    }
    if (document.querySelector("#challenge-form, #cf-challenge, [class*='cf-turnstile'], [id*='captcha']")) {
      evidence.push("challenge-form/captcha detected");
      confidence += 0.5;
    }
    const bodyText = (document.body && document.body.innerText ? document.body.innerText : "");
    if (bodyText.length < 100 && document.querySelector("script[src*='challenges'], script[src*='cf-']")) {
      evidence.push("short body + cf challenge script");
      confidence += 0.4;
    }
    return { hit: confidence >= 0.4, confidence: Math.min(confidence, 1), evidence };
  }

  function detectDynamic() {
    const evidence = [];
    let confidence = 0;
    if (document.body && document.body.dataset.tvDynamic === "1") {
      evidence.push("tv-dynamic flag already set");
      confidence += 0.5;
    }
    if (document.querySelector("#app, #root, [data-reactroot], [data-v-app], [ng-version]")) {
      evidence.push("SPA root detected");
      confidence += 0.2;
    }
    return { hit: confidence >= 0.5, confidence: Math.min(confidence, 1), evidence };
  }

  function detectEmbed() {
    const evidence = [];
    let confidence = 0;
    const iframes = document.querySelectorAll("iframe");
    if (iframes.length > 0) {
      evidence.push("iframe count=" + iframes.length);
      confidence += 0.3;
    }
    const mainIframe = document.querySelector("main iframe, article iframe, [class*='content'] iframe");
    if (mainIframe) {
      evidence.push("main content in iframe");
      confidence += 0.4;
    }
    return { hit: confidence >= 0.4, confidence: Math.min(confidence, 1), evidence };
  }

  function detectStructure() {
    const evidence = [];
    let confidence = 0;
    if (globalThis.TransVaultSiteAdapters && globalThis.TransVaultSiteAdapters.getAdapter) {
      const ad = globalThis.TransVaultSiteAdapters.getAdapter();
      if (ad) {
        const keys = Object.keys(globalThis.TransVaultSiteAdapters.ADAPTERS || {});
        const matched = keys.find((k) => globalThis.TransVaultSiteAdapters.ADAPTERS[k] === ad);
        evidence.push("adapter=" + (matched || "unknown"));
        confidence += 0.3;
      }
    }
    const blocks = document.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, blockquote, article p");
    const emptyBlocks = Array.from(blocks).filter((b) => !(b.textContent || "").trim());
    if (blocks.length > 5 && emptyBlocks.length / blocks.length > 0.5) {
      evidence.push("emptyBlocks=" + emptyBlocks.length + "/" + blocks.length);
      confidence += 0.4;
    }
    return { hit: confidence >= 0.4, confidence: Math.min(confidence, 1), evidence };
  }

  function detect() {
    const report = {
      status: "clean",
      coverage: textCoverage(),
      walls: [],
      ts: Date.now(),
      url: location.href,
      host: location.hostname,
    };
    const detectors = [
      { type: "P", fn: detectPaywall },
      { type: "A", fn: detectAntibot },
      { type: "D", fn: detectDynamic },
      { type: "E", fn: detectEmbed },
      { type: "S", fn: detectStructure },
    ];
    for (const d of detectors) {
      try {
        const r = d.fn();
        if (r.hit) report.walls.push({ type: d.type, confidence: r.confidence, evidence: r.evidence });
      } catch (e) { /* 单个检测失败不影响其它 */ }
    }
    if (report.walls.length > 0) report.status = "broken";
    return report;
  }

  const API = {
    detect, textCoverage,
    detectPaywall, detectAntibot, detectDynamic, detectEmbed, detectStructure,
  };
  globalThis.TransVaultWallDetector = API;
  // 同时暴露到 window，方便测试（MV3 content script 与页面共享 DOM/window）
  try { window.__TV_WALL_DETECTOR__ = API; } catch (e) {}
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();