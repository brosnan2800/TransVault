// TransVault 后台服务（MV3 service worker, ES module）
// 职责：消息中枢（content ↔ router）、快捷键、右键菜单、设置读写

import { Router, FREE_LIMITS } from "./router.js";

// 引入 shared（副作用挂载 globalThis）
import "../shared/config.js";
import "../shared/util.js";
import "../shared/storage.js";

const Store = globalThis.TransVaultStorage;
const U = globalThis.TransVaultUtil;

const router = new Router();

// ---------- 消息处理 ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 异步处理，返回 true 保持通道
  (async () => {
    try {
      switch (msg && msg.type) {
        case "translate": {
          const settings = await Store.getSettings();
          const result = await router.translate(msg.req || {}, settings);
          sendResponse(result);
          break;
        }
        case "get-settings": {
          const settings = await Store.getSettings();
          sendResponse({ ok: true, settings });
          break;
        }
        case "save-settings": {
          const settings = await Store.getSettings();
          const merged = U.deepMerge(settings, msg.patch || {});
          await Store.saveSettings(merged);
          sendResponse({ ok: true, settings: merged });
          break;
        }
        case "get-quota": {
          const id = msg.providerId;
          const q = await Store.quotaGet(id);
          sendResponse({ ok: true, quota: { ...q, limit: FREE_LIMITS[id] || 0 } });
          break;
        }
        case "clear-cache": {
          await Store.cacheClear();
          sendResponse({ ok: true });
          break;
        }
        default:
          sendResponse({ ok: false, error: "unknown message type" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message || String(e) });
    }
  })();
  return true; // 保持通道打开
});

// ---------- 快捷键：切换当前页翻译 ----------
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-page-translate") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "toggle-page-translate" });
  } catch {
    // 页面未注入 content script（如 chrome:// 页），忽略
  }
});

// ---------- 右键菜单：划词翻译 ----------
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "transvault-selection",
    title: "翻译选中文本",
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "transvault-selection" || !tab || !tab.id) return;
  const text = (info.selectionText || "").trim();
  if (!text) return;
  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: "translate-selection",
      text,
    });
  } catch {
    // 忽略
  }
});

// ---------- 安装时初始化默认设置 ----------
chrome.runtime.onInstalled.addListener(async () => {
  const settings = await Store.getSettings();
  // 若从未保存过，写入默认值
  const existing = await chrome.storage.local.get(Store.KEYS.settings);
  if (!existing[Store.KEYS.settings]) {
    await Store.saveSettings(settings);
  }
});

console.log("[TransVault] service worker ready");