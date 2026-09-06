// TransVault popup 控制面板逻辑
// 依赖：shared/config.js, shared/util.js, shared/storage.js（已在 popup.html 中加载）

(function () {
  const Store = globalThis.TransVaultStorage;
  const U = globalThis.TransVaultUtil;

  const targetLang = document.getElementById("targetLang");
  const displayMode = document.getElementById("displayMode");
  const toggleBtn = document.getElementById("toggleBtn");
  const restoreBtn = document.getElementById("restoreBtn");
  const status = document.getElementById("status");
  const openOptions = document.getElementById("openOptions");

  // 当前活动标签页
  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  // 向当前页 content script 发消息
  async function sendToTab(tab, msg) {
    if (!tab || !tab.id) return null;
    try {
      return await chrome.tabs.sendMessage(tab.id, msg);
    } catch {
      return null;
    }
  }

  // 加载设置到控件
  async function loadSettings() {
    const settings = await Store.getSettings();
    targetLang.value = settings.targetLang || "zh-CN";
    displayMode.value = settings.displayMode || "bilingual";
  }

  // 保存设置
  async function saveSettings(patch) {
    await chrome.runtime.sendMessage({ type: "save-settings", patch });
  }

  // 初始化
  async function init() {
    await loadSettings();

    // 目标语言变更
    targetLang.addEventListener("change", async () => {
      await saveSettings({ targetLang: targetLang.value });
      status.textContent = "目标语言已更新";
    });

    // 显示模式变更
    displayMode.addEventListener("change", async () => {
      await saveSettings({ displayMode: displayMode.value });
      const tab = await getActiveTab();
      await sendToTab(tab, { type: "set-display-mode", mode: displayMode.value });
      status.textContent = "显示模式已更新";
    });

    // 翻译当前页
    toggleBtn.addEventListener("click", async () => {
      const tab = await getActiveTab();
      const resp = await sendToTab(tab, { type: "toggle-page-translate" });
      if (resp && resp.ok) {
        status.textContent = "已切换翻译状态";
      } else {
        status.textContent = "无法操作此页面（可能是不支持的页面）";
      }
    });

    // 还原原文
    restoreBtn.addEventListener("click", async () => {
      const tab = await getActiveTab();
      const resp = await sendToTab(tab, { type: "restore-page" });
      if (resp && resp.ok) {
        status.textContent = "已还原原文";
      } else {
        status.textContent = "无法操作此页面";
      }
    });

    // 打开 options
    openOptions.addEventListener("click", (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }

  init();
})();