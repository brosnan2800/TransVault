// TransVault 订阅墙策略（content script）
// 职责：当 detector 判定 P 墙时，尝试 archive.is 快照拿全文；失败则降级提示
// 经典脚本，挂 globalThis.TransVaultPaywallStrategy

(function () {
  const ARCHIVE_BASE = "https://archive.ph/";

  /** 构造当前页的 archive.is 快照 URL */
  function snapshotUrl() {
    return ARCHIVE_BASE + encodeURIComponent(location.href);
  }

  /** 在 background 里 fetch 快照页并解析正文（content script 跨域受限） */
  async function fetchSnapshot() {
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      return await chrome.runtime.sendMessage({
        type: "TV_PAYWALL_SNAPSHOT",
        url: location.href,
      });
    }
    return { ok: false, error: "no-runtime" };
  }

  /** 主入口：尝试快照，返回 { ok, content?, error? } */
  async function tryBypass() {
    const res = await fetchSnapshot();
    if (res && res.ok && res.content && res.content.length > 200) {
      return { ok: true, content: res.content, source: res.source || "archive.is" };
    }
    return { ok: false, error: res && res.error ? res.error : "snapshot-unavailable" };
  }

  /** 给用户的降级提示信息 */
  function fallbackMessage(lang) {
    const url = snapshotUrl();
    if (lang && lang.startsWith("zh")) {
      return {
        title: "订阅墙：无法直接提取全文",
        body: "此页面疑似付费订阅墙。建议：",
        actions: [
          { label: "打开 archive.is 快照", url },
          { label: "复制全文到剪贴板（手动）", url: "copy" },
        ],
      };
    }
    return {
      title: "Paywall: full text unavailable",
      body: "This page appears to be behind a paywall. Suggestions:",
      actions: [
        { label: "Open archive.is snapshot", url },
        { label: "Copy full text manually", url: "copy" },
      ],
    };
  }

  const API = { tryBypass, fetchSnapshot, snapshotUrl, fallbackMessage };
  globalThis.TransVaultPaywallStrategy = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();