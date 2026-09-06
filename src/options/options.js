// TransVault options 设置页逻辑
// 依赖：shared/config.js, shared/util.js, shared/storage.js（已在 options.html 中加载）

(function () {
  const Cfg = globalThis.TransVaultConfig;
  const Store = globalThis.TransVaultStorage;

  // 引擎目录（来自 config）
  const CATALOG = (Cfg && Cfg.ENGINE_CATALOG) || [];

  // DOM 引用
  const targetLang = document.getElementById("targetLang");
  const displayMode = document.getElementById("displayMode");
  const engineList = document.getElementById("engineList");
  const llmProviders = document.getElementById("llmProviders");
  const addLlmBtn = document.getElementById("addLlmBtn");
  const baoyuEnabled = document.getElementById("baoyuEnabled");
  const baoyuMode = document.getElementById("baoyuMode");
  const baoyuStyle = document.getElementById("baoyuStyle");
  const baoyuAudience = document.getElementById("baoyuAudience");
  const saveBtn = document.getElementById("saveBtn");
  const clearCacheBtn = document.getElementById("clearCacheBtn");
  const status = document.getElementById("status");

  // 当前设置（内存态）
  let settings = null;

  // HTML 转义（用于插入模板字符串）
  // 用字符码构造实体，避免被编辑器/格式化器二次转义
  const AMP = String.fromCharCode(38) + "amp;";
  const QUOT = String.fromCharCode(38) + "quot;";
  const LT = String.fromCharCode(38) + "lt;";
  const GT = String.fromCharCode(38) + "gt;";
  function esc(s) {
    return String(s || "")
      .replace(/&/g, AMP)
      .replace(/"/g, QUOT)
      .replace(/</g, LT)
      .replace(/>/g, GT);
  }

  // ---------- 渲染引擎列表 ----------
  function renderEngineList() {
    engineList.innerHTML = "";
    const order = settings.engineOrder && settings.engineOrder.length ? settings.engineOrder : ["google"];
    const enabled = order.filter((id) => CATALOG.some((e) => e.id === id));
    const disabled = CATALOG.filter((e) => !enabled.includes(e.id)).map((e) => e.id);
    const allIds = [...enabled, ...disabled];

    allIds.forEach((id) => {
      const meta = CATALOG.find((e) => e.id === id);
      if (!meta) return;
      const item = document.createElement("div");
      item.className = "engine-item";
      item.dataset.id = id;

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = enabled.includes(id);

      const name = document.createElement("span");
      name.className = "name";
      name.textContent = meta.name;

      const desc = document.createElement("span");
      desc.className = "desc";
      desc.textContent = meta.desc;

      const tier = document.createElement("span");
      tier.className = "tier";
      tier.textContent = "tier" + meta.tier;

      item.appendChild(cb);
      item.appendChild(name);
      item.appendChild(desc);
      item.appendChild(tier);
      engineList.appendChild(item);
    });
  }

  // ---------- LLM provider 渲染 ----------
  function renderLLMProviders() {
    llmProviders.innerHTML = "";
    const providers = (settings.llm && settings.llm.providers) || [];
    providers.forEach((p, idx) => {
      const div = document.createElement("div");
      div.className = "llm-provider";
      div.dataset.idx = idx;

      const row1 = document.createElement("div");
      row1.className = "row";
      row1.innerHTML =
        '<label>名称</label><input class="llm-name" value="' + esc(p.id || "") + '" placeholder="如 deepseek" />';

      const row2 = document.createElement("div");
      row2.className = "row";
      row2.innerHTML =
        '<label>BaseUrl</label><input class="llm-base" value="' + esc(p.baseUrl || "") + '" placeholder="https://api.deepseek.com" />';

      const row3 = document.createElement("div");
      row3.className = "row";
      row3.innerHTML =
        '<label>Key</label><input class="llm-key" type="password" value="' + esc(p.key || "") + '" placeholder="API Key" />';

      const row4 = document.createElement("div");
      row4.className = "row";
      row4.innerHTML =
        '<label>Model</label><input class="llm-model" value="' + esc(p.model || "") + '" placeholder="deepseek-chat" />';

      const activeRow = document.createElement("div");
      activeRow.className = "row";
      const activeCb = document.createElement("input");
      activeCb.type = "checkbox";
      activeCb.checked = settings.llm.activeProviderIndex === idx;
      activeCb.addEventListener("change", () => {
        if (activeCb.checked) settings.llm.activeProviderIndex = idx;
      });
      const activeLabel = document.createElement("label");
      activeLabel.textContent = "设为当前激活";
      activeRow.appendChild(activeCb);
      activeRow.appendChild(activeLabel);

      const delBtn = document.createElement("button");
      delBtn.className = "btn secondary";
      delBtn.textContent = "删除";
      delBtn.style.marginTop = "4px";
      delBtn.addEventListener("click", () => {
        settings.llm.providers.splice(idx, 1);
        if (settings.llm.activeProviderIndex === idx) settings.llm.activeProviderIndex = -1;
        renderLLMProviders();
      });

      div.appendChild(row1);
      div.appendChild(row2);
      div.appendChild(row3);
      div.appendChild(row4);
      div.appendChild(activeRow);
      div.appendChild(delBtn);
      llmProviders.appendChild(div);
    });
  }

  // ---------- 收集表单值 ----------
  function collect() {
    // 引擎顺序
    const enabledIds = [];
    engineList.querySelectorAll(".engine-item").forEach((item) => {
      const cb = item.querySelector("input[type=checkbox]");
      if (cb && cb.checked) enabledIds.push(item.dataset.id);
    });
    settings.engineOrder = enabledIds.length ? enabledIds : ["google"];

    // LLM providers
    const providers = [];
    llmProviders.querySelectorAll(".llm-provider").forEach((div) => {
      const name = div.querySelector(".llm-name").value.trim();
      const base = div.querySelector(".llm-base").value.trim();
      const key = div.querySelector(".llm-key").value.trim();
      const model = div.querySelector(".llm-model").value.trim();
      if (name && base && key && model) {
        providers.push({ id: name, baseUrl: base, key, model });
      }
    });
    settings.llm.providers = providers;
    if (settings.llm.activeProviderIndex >= providers.length) {
      settings.llm.activeProviderIndex = -1;
    }

    // 国内 key
    settings.azure.key1 = document.getElementById("azureKey").value.trim();
    settings.azureChina.key1 = document.getElementById("azureChinaKey").value.trim();
    settings.aliyun.accessKeyId = document.getElementById("aliyunAk").value.trim();
    settings.aliyun.accessKeySecret = document.getElementById("aliyunSk").value.trim();
    settings.baidu.appId = document.getElementById("baiduAppId").value.trim();
    settings.baidu.appSecret = document.getElementById("baiduSecret").value.trim();
    settings.tencent.secretId = document.getElementById("tencentId").value.trim();
    settings.tencent.secretKey = document.getElementById("tencentKey").value.trim();

    // baoyu
    settings.baoyu.enabled = baoyuEnabled.value === "true";
    settings.baoyu.mode = baoyuMode.value;
    settings.baoyu.style = baoyuStyle.value;
    settings.baoyu.audience = baoyuAudience.value.trim();

    // 通用
    settings.targetLang = targetLang.value;
    settings.displayMode = displayMode.value;
  }

  // ---------- 加载设置到表单 ----------
  function loadToForm() {
    targetLang.value = settings.targetLang || "zh-CN";
    displayMode.value = settings.displayMode || "bilingual";
    document.getElementById("azureKey").value = settings.azure.key1 || "";
    document.getElementById("azureChinaKey").value = settings.azureChina.key1 || "";
    document.getElementById("aliyunAk").value = settings.aliyun.accessKeyId || "";
    document.getElementById("aliyunSk").value = settings.aliyun.accessKeySecret || "";
    document.getElementById("baiduAppId").value = settings.baidu.appId || "";
    document.getElementById("baiduSecret").value = settings.baidu.appSecret || "";
    document.getElementById("tencentId").value = settings.tencent.secretId || "";
    document.getElementById("tencentKey").value = settings.tencent.secretKey || "";
    baoyuEnabled.value = String(settings.baoyu.enabled);
    baoyuMode.value = settings.baoyu.mode || "normal";
    baoyuStyle.value = settings.baoyu.style || "";
    baoyuAudience.value = settings.baoyu.audience || "";
    renderEngineList();
    renderLLMProviders();
  }

  // ---------- 初始化 ----------
  async function init() {
    settings = await Store.getSettings();
    loadToForm();

    saveBtn.addEventListener("click", async () => {
      collect();
      await Store.saveSettings(settings);
      status.textContent = "设置已保存 ✓";
      setTimeout(() => (status.textContent = ""), 2000);
    });

    clearCacheBtn.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: "clear-cache" });
      status.textContent = "翻译缓存已清空 ✓";
      setTimeout(() => (status.textContent = ""), 2000);
    });

    addLlmBtn.addEventListener("click", () => {
      if (!settings.llm) settings.llm = { providers: [], activeProviderIndex: -1 };
      settings.llm.providers.push({ id: "", baseUrl: "", key: "", model: "" });
      renderLLMProviders();
    });
  }

  function statusMsg(msg) {
    status.textContent = msg;
  }

  init();
})();