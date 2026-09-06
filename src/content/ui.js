// TransVault UI（content script）
// 职责：划词翻译浮层 + 页面浮动快捷按钮（翻译/还原/切换模式）
// 依赖：shared/config.js, shared/util.js, shared/storage.js, content/page-translator.js

(function () {
  const Cfg = globalThis.TransVaultConfig;
  const U = globalThis.TransVaultUtil;
  const Store = globalThis.TransVaultStorage;

  // 等待 page-translator 暴露的 API
  function getTranslator() {
    return globalThis.TransVaultPageTranslator;
  }

  // 注入 UI 样式
  function injectStyle() {
    if (document.getElementById("transvault-ui-style")) return;
    const style = document.createElement("style");
    style.id = "transvault-ui-style";
    style.textContent = `
      .transvault-ui {
        position: fixed;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        line-height: 1.5;
        color: #333;
        background: #fff;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        padding: 8px 10px;
        max-width: 360px;
      }
      .transvault-ui button {
        border: none;
        background: #4f46e5;
        color: #fff;
        border-radius: 6px;
        padding: 4px 10px;
        cursor: pointer;
        font-size: 12px;
        margin-right: 4px;
      }
      .transvault-ui button:hover { background: #4338ca; }
      .transvault-ui button.secondary {
        background: #f3f4f6;
        color: #333;
      }
      .transvault-ui button.secondary:hover { background: #e5e7eb; }
      .transvault-ui .tv-selection-result {
        margin-top: 6px;
        padding-top: 6px;
        border-top: 1px solid #e5e7eb;
        color: #4b5563;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .transvault-ui .tv-selection-loading {
        margin-top: 6px;
        color: #9ca3af;
        font-size: 12px;
      }
      /* 浮动按钮 */
      .transvault-fab {
        position: fixed;
        right: 20px;
        bottom: 20px;
        z-index: 2147483646;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        background: #4f46e5;
        color: #fff;
        border: none;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        cursor: pointer;
        font-size: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.2s;
      }
      .transvault-fab:hover { transform: scale(1.1); }
      .transvault-fab.active { background: #10b981; }
    `;
    document.head.appendChild(style);
  }

  // 划词翻译浮层
  function initSelection() {
    let popup = null;

    function removePopup() {
      if (popup) {
        popup.remove();
        popup = null;
      }
    }

    function showPopup(x, y, text) {
      removePopup();
      popup = document.createElement("div");
      popup.className = "transvault-ui";
      popup.style.left = Math.min(x, window.innerWidth - 380) + "px";
      popup.style.top = y + "px";

      const loading = document.createElement("div");
      loading.className = "tv-selection-loading";
      loading.textContent = "翻译中…";
      popup.appendChild(loading);

      document.body.appendChild(popup);

      // 请求翻译
      (async () => {
        const settings = await Store.getSettings();
        const resp = await chrome.runtime.sendMessage({
          type: "translate",
          req: {
            texts: [text],
            source: settings.sourceLang || "auto",
            target: settings.targetLang || "zh-CN",
          },
        });
        loading.remove();
        if (resp && resp.ok && resp.translations && resp.translations[0]) {
          const result = document.createElement("div");
          result.className = "tv-selection-result";
          result.textContent = resp.translations[0];
          popup.appendChild(result);
        } else {
          const err = document.createElement("div");
          err.className = "tv-selection-result";
          err.textContent = "翻译失败：" + ((resp && resp.error) || "未知错误");
          popup.appendChild(err);
        }
      })();
    }

    // 监听选中文本
    document.addEventListener("mouseup", (e) => {
      // 点击浮层内部不关闭
      if (popup && popup.contains(e.target)) return;
      const sel = window.getSelection();
      const text = sel ? sel.toString().trim() : "";
      if (text && text.length >= 2 && text.length <= 500) {
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        showPopup(rect.right + 8, rect.top);
      } else {
        removePopup();
      }
    });

    // 点击其他区域关闭
    document.addEventListener("mousedown", (e) => {
      if (popup && !popup.contains(e.target)) {
        removePopup();
      }
    });
  }

  // 浮动快捷按钮
  function initFab() {
    const fab = document.createElement("button");
    fab.className = "transvault-fab";
    fab.title = "翻译/还原当前页面 (Alt+A)";
    fab.textContent = "译";
    document.body.appendChild(fab);

    fab.addEventListener("click", async () => {
      const t = getTranslator();
      if (!t) return;
      await t.toggle();
      fab.classList.toggle("active", t.isTranslated());
    });

    // 监听翻译状态变化
    const t = getTranslator();
    if (t && t.bus) {
      t.bus.on("translated", () => fab.classList.add("active"));
      t.bus.on("restored", () => fab.classList.remove("active"));
    }
  }

  // 初始化
  function init() {
    injectStyle();
    initSelection();
    // 等 page-translator 就绪后再初始化 FAB
    const tryInitFab = () => {
      if (getTranslator()) {
        initFab();
      } else {
        setTimeout(tryInitFab, 200);
      }
    };
    tryInitFab();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();