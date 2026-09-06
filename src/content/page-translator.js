// TransVault 整页双语翻译（content script）
// 职责：提取段落 → 批量请求 background → 双语渲染 → 还原
//       翻译状态下，用 MutationObserver 对动态加载的新内容做增量补翻（含 x.com 等站点适配器）
// 依赖：shared/config.js, shared/util.js, shared/storage.js, shared/dynamic-core.js,
//       content/site-adapters.js（已在 manifest 中先行加载）

(function () {
  const Cfg = globalThis.TransVaultConfig;
  const U = globalThis.TransVaultUtil;
  const Store = globalThis.TransVaultStorage;
  const Core = globalThis.TransVaultDynamicCore;
  const SiteAdapters = globalThis.TransVaultSiteAdapters;

  // 排除选择器（不翻译的区域）
  const EXCLUDE = (Cfg && Cfg.DEFAULTS.excludeSelectors) || [];

  // 块级元素白名单：只有这些标签才作为可翻译块收集（行内元素跟随父块一起翻译）
  const BLOCK_TAGS = new Set([
    "P", "H1", "H2", "H3", "H4", "H5", "H6",
    "LI", "DT", "DD", "TD", "TH", "CAPTION", "FIGCAPTION",
    "BLOCKQUOTE", "DIV", "SECTION", "ARTICLE", "ASIDE", "MAIN", "SUMMARY",
  ]);

  function isBlockTag(tag) {
    return BLOCK_TAGS.has(String(tag || "").toUpperCase());
  }

  // 当前站点适配器（命中 x.com/twitter 等返回规则对象，否则 null）
  const adapter = (SiteAdapters && SiteAdapters.getAdapter) ? SiteAdapters.getAdapter() : null;

  // 已翻译元素集合（用于还原）：存"根元素"
  const translatedRoots = new Set();
  // 译文节点集合（还原时 remove）
  const translatedEls = new Set();
  // 已翻译标记属性名
  const MARK_ATTR = "data-tv-translated";

  // 当前是否已翻译
  let isTranslated = false;
  let isTranslating = false;

  // 事件总线（供 ui.js 通信）
  const bus = U.makeBus();

  // 动态补翻：observer + 调度器
  let observer = null;
  let scheduler = null;

  // 注入全局样式
  function injectStyle() {
    if (document.getElementById("transvault-style")) return;
    const style = document.createElement("style");
    style.id = "transvault-style";
    style.textContent = `
      .transvault-trans[data-mode="bilingual"] {
        box-sizing: border-box;
        display: block;
        /* 强制译文占满整行、换到原文下方：
           父容器若是 flex/inline-flex，block span 仍会并排到右侧，故补 width/flex 兜底 */
        width: 100%;
        max-width: 100%;
        /* flex 默认不拉伸(Flex-grow:0)，由 renderOne 按宿主方向动态决定：
           row 方向→flex:0 0 100%+flex-wrap 独占一行；column方向→align-self:stretch
           自然落在原文下方；此处固定为 0 0 auto，避免在列方向被纵向拉伸填满列高。 */
        flex: 0 0 auto;
        /* 译文直接放在原文正下方，不加边框/底色/缩进，避免影响原文排版 */
        margin: 0.35em 0 0.85em;
        font-size: 1em;
        line-height: 1.7;
        font-weight: 400;
        text-align: start;
        word-break: break-word;
        overflow-wrap: anywhere;
        color: inherit;
      }
      .transvault-trans[data-mode="translation"] {
        display: none;
      }
      .transvault-trans[data-mode="original"] {
        display: none;
      }
    `;
    document.head.appendChild(style);
  }

  // 判断元素是否可翻译（排除脚本/样式/表单/已翻译等）
  function isTranslatableEl(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    if (el.closest(EXCLUDE.join(","))) return false;
    if (el.closest(".transvault-trans")) return false;
    if (el.closest(".transvault-ui")) return false;
    const text = el.textContent.trim();
    if (!text) return false;
    if (!/[a-zA-Z\u4e00-\u9fff]/.test(text)) return false;
    return true;
  }

  // 收集可翻译的块级叶子元素
  function collectBlocks() {
    const blocks = [];
    const seen = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      const el = walker.currentNode;
      if (!isTranslatableEl(el)) continue;
      if (!isBlockTag(el.tagName)) continue;
      const hasBlockChild = Array.from(el.children).some(
        (c) => isBlockTag(c.tagName) && isTranslatableEl(c)
      );
      if (hasBlockChild) continue;
      if (seen.has(el)) continue;
      seen.add(el);
      blocks.push(el);
    }
    return blocks;
  }

  // 收集翻译根：
  //  - 适配器模式（x.com）：每个容器（tweet）为一个根
  //  - 通用模式：块级叶子
  function collectRoots() {
    if (adapter && adapter.containerSelector) {
      const containers = Array.from(document.querySelectorAll(adapter.containerSelector));
      return containers.filter((c) => isTranslatableEl(c));
    }
    return collectBlocks();
  }

  // 取一个根的"待翻译文本"：
  //  - 适配器模式：用 extractText（只取正文，避开用户名/链接/时间）
  //  - 通用模式：textContent
  function getRootText(root) {
    if (adapter && SiteAdapters && SiteAdapters.extractText) {
      return SiteAdapters.extractText(root, adapter);
    }
    return (root.textContent || "").trim();
  }

  // 判断根是否应跳过（已翻译 / 目标语言）
  function isRootSkippable(root) {
    if (!root) return true;
    if (root.getAttribute && root.getAttribute(MARK_ATTR) !== null) return true;
    const text = getRootText(root);
    if (!text) return true;
    if (isTargetLang(text)) return true;
    return false;
  }

  // 是否已是目标语言（读取 settings.targetLang）
  let _targetLang = "zh-CN";
  function isTargetLang(text) {
    return U.isLikelyTargetLang(text, _targetLang);
  }

  // 通用模式的 observer 根解析：从新增节点向上找最近的块级叶子根
  function resolveGenericRoot(node) {
    let cur = node && node.nodeType === Node.ELEMENT_NODE ? node : (node && node.parentElement);
    while (cur && cur !== document.body) {
      if (isTranslatableEl(cur) && isBlockTag(cur.tagName)) {
        // 叶子块判定：直接子中无可翻译块级
        const hasBlockChild = Array.from(cur.children).some(
          (c) => isBlockTag(c.tagName) && isTranslatableEl(c)
        );
        if (!hasBlockChild) return cur;
      }
      cur = cur.parentElement;
    }
    return null;
  }

  // 从 observer 新增节点解析翻译根（适配器优先）
  function resolveObserverRoot(node) {
    if (adapter && adapter.containerSelector) {
      const el = node && node.nodeType === Node.ELEMENT_NODE ? node : (node && node.parentElement);
      if (!el) return null;
      return el.closest(adapter.containerSelector) || null;
    }
    return resolveGenericRoot(node);
  }

  // 把文本按字符数分批
  function batchTexts(texts, maxChars) {
    const batches = [];
    let cur = [];
    let curLen = 0;
    for (const t of texts) {
      if (curLen + t.length > maxChars && cur.length) {
        batches.push(cur);
        cur = [];
        curLen = 0;
      }
      cur.push(t);
      curLen += t.length;
    }
    if (cur.length) batches.push(cur);
    return batches;
  }

  // 翻译一批文本（并发发消息，每个批次独立 Promise）
  async function translateBatch(texts, settings) {
    settings = settings || (await Store.getSettings());
    const maxChars = (settings.batch && settings.batch.maxCharsPerBatch) || 1800;
    const batches = batchTexts(texts, maxChars);

    // 并发上限：同时最多 5 个 translate 消息
    const CONCURRENCY = 5;
    const results = new Array(batches.length);
    let nextIdx = 0;

    async function sendOne(batch, idx) {
      const resp = await chrome.runtime.sendMessage({
        type: "translate",
        req: {
          texts: batch,
          source: settings.sourceLang || "auto",
          target: settings.targetLang || "zh-CN",
          style: settings.baoyu && settings.baoyu.style,
          mode: settings.baoyu && settings.baoyu.mode,
        },
      });
      if (resp && resp.ok && resp.translations) {
        results[idx] = resp.translations;
      } else {
        // 失败：用原文占位
        results[idx] = batch.map(() => "");
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, batches.length) }, async () => {
        while (nextIdx < batches.length) {
          const i = nextIdx++;
          await sendOne(batches[i], i);
        }
      })
    );

    const all = [];
    for (const r of results) all.push(...r);
    return all;
  }

  // 查找 root 内部（按文档顺序）最后一个文本节点，作为译文插入锚点。
  // 译文插到它后面，从而保证：
  //  - 紧跟原文文字（"跟原文一起"）；
  //  - 当容器末尾是图片/视频时，译文会留在文字与媒体之间（即媒体上方），
  //    而不是像 appendChild 那样追加到整个容器末尾、掉到媒体下方。
  function getLastTextNode(root) {
    let last = null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) last = walker.currentNode;
    return last;
  }

  // 计算译文插入锚点与宿主容器：
  //  - 适配器模式（x.com 等）：锚点 = 正文(textSelector)元素本身，译文插到它之后
  //    → 译文紧跟原文正文，且位于图片/视频之上；
  //  - 通用模式：锚点 = 最后一个文本节点，译文插到它之后。
  // 返回 { host, anchorText, anchorEl }
  function resolveAnchor(root) {
    if (adapter && adapter.containerSelector && adapter.textSelector) {
      const node = root.querySelector(adapter.textSelector);
      if (node && node.parentNode) {
        return {
          host: node.parentNode,
          anchorText: null,
          anchorEl: node,
        };
      }
    }
    const anchorText = getLastTextNode(root);
    return {
      host: anchorText && anchorText.parentNode ? anchorText.parentNode : root,
      anchorText,
      anchorEl: null,
    };
  }

  // 渲染单个根：译文插到正文原文之后 + 打已翻译标记
  function renderOne(root, trans) {
    if (!root || !trans) return;

    const { host, anchorText, anchorEl } = resolveAnchor(root);

    // 译文 span 若是 host（flex/grid 容器）的子项会被并排到右侧。
    // 这里按布局方向决定如何让译文独占一行、落在原文下方：
    //  - flex-direction: row   → 译文 flex:0 0 100% 占满一行，并给宿主开 flex-wrap 让其换行
    //  - flex-direction: column→ 译文已是块级、自然落到原文下方，绝不 flex:1（会被纵向拉伸填满列高）
    //  - grid                  → 译文 grid-column: 1 / -1 占整行
    const disp = getComputedStyle(host).display || "";
    const flexDir = getComputedStyle(host).flexDirection || "";

    const span = document.createElement("span");
    span.className = "transvault-trans";
    span.dataset.mode = "bilingual";
    span.textContent = trans;

    if (disp && /grid/.test(disp)) {
      try {
        span.style.setProperty("grid-column", "1 / -1");
        span.style.setProperty("justify-self", "start");
      } catch (e) {}
    } else if (disp && /flex/.test(disp)) {
      // row 方向才需要强制占整行+换行；column 方向块级已自然换行，避免拉伸
      if (/row/.test(flexDir)) {
        try {
          host.style.setProperty("flex-wrap", "wrap");
          span.style.setProperty("flex", "0 0 100%");
        } catch (e) {}
      } else {
        try { span.style.setProperty("align-self", "stretch"); } catch (e) {}
      }
    }

    // 适配器：插到正文元素之后（紧跟原文、在图片/视频之前）
    if (anchorEl) {
      if (anchorEl.nextSibling) {
        anchorEl.parentNode.insertBefore(span, anchorEl.nextSibling);
      } else {
        anchorEl.parentNode.appendChild(span);
      }
    } else if (anchorText && anchorText.parentNode) {
      if (anchorText.nextSibling) {
        anchorText.parentNode.insertBefore(span, anchorText.nextSibling);
      } else {
        anchorText.parentNode.appendChild(span);
      }
    } else {
      root.appendChild(span);
    }

    translatedEls.add(span);
    root.setAttribute(MARK_ATTR, "1");
    translatedRoots.add(root);
  }

  // 渲染一批译文到 roots
  function renderTranslations(roots, translations) {
    roots.forEach((el, i) => {
      const trans = translations[i];
      if (!trans) return;
      renderOne(el, trans);
    });
  }

  // 切换显示模式
  function setDisplayMode(mode) {
    document.querySelectorAll(".transvault-trans").forEach((el) => {
      el.dataset.mode = mode;
    });
  }

  // ---------- 动态补翻（MutationObserver + 调度器） ----------

  // observer 回调：收集新增节点 → 解析根 → 去重 → 交调度器
  function handleMutations(mutations) {
    for (const mut of mutations) {
      if (!mut.addedNodes) continue;
      for (const node of mut.addedNodes) {
        try {
          const root = resolveObserverRoot(node);
          if (!root) continue;
          if (isRootSkippable(root)) continue;
          scheduler.touch(root);
        } catch (e) {
          // 节点可能已被页面框架移除，忽略
        }
      }
    }
  }

  // 建立并启用 observer（仅翻译状态下调用）
  function enableObserver(settings) {
    if (observer) return;
    const dyn = (settings && settings.dynamic) || {};
    if (dyn.enabled === false) return;
    if (!Core || !Core.DebouncedScheduler) return;

    const stableWindowMs = dyn.stableWindowMs || 400;
    const debounceMs = dyn.debounceMs || 300;

    scheduler = Core.DebouncedScheduler({
      stableWindowMs,
      debounceMs,
      onBatch: async (roots) => {
        if (!isTranslated || !document.body) return;
        const toTranslate = roots.filter((r) => !isRootSkippable(r));
        if (!toTranslate.length) return;
        const texts = toTranslate.map((r) => getRootText(r));
        let translations;
        try {
          translations = await translateBatch(texts, settings);
        } catch (e) {
          return;
        }
        renderTranslations(toTranslate, translations);
        bus.emit("translated-more", { count: toTranslate.length });
      },
    });

    observer = new MutationObserver(handleMutations);
    observer.observe(document.body, { subtree: true, childList: true });
  }

  // 停用 observer 并清空队列
  function disableObserver() {
    if (observer) { try { observer.disconnect(); } catch (e) {} observer = null; }
    if (scheduler) { try { scheduler.clear(); } catch (e) {} scheduler = null; }
  }

  // 批量翻译一组根并渲染（供整页 + 补翻复用）
  async function translateRoots(roots, settings) {
    if (!roots.length) return;
    const texts = roots.map((r) => getRootText(r));
    const translations = await translateBatch(texts, settings);
    renderTranslations(roots, translations);
  }

  // 还原（非破坏性：直接移除译文节点，不改动原文 DOM）
  function restore() {
    disableObserver();
    translatedEls.forEach((node) => {
      try {
        node.remove();
      } catch (e) {
        // 节点可能已被页面框架移除，忽略
      }
    });
    translatedEls.clear();
    translatedRoots.forEach((root) => {
      try { root.removeAttribute(MARK_ATTR); } catch (e) {}
    });
    translatedRoots.clear();
    isTranslated = false;
  }

  // 主翻译流程
  async function translatePage() {
    if (isTranslating) return;
    isTranslating = true;
    try {
      const settings = await Store.getSettings();
      _targetLang = settings.targetLang || "zh-CN";
      const roots = collectRoots().filter((r) => !isRootSkippable(r));
      if (!roots.length) return;
      await translateRoots(roots, settings);
      isTranslated = true;
      enableObserver(settings);
      bus.emit("translated", { count: roots.length });
    } finally {
      isTranslating = false;
    }
  }

  // 切换翻译状态
  async function toggle() {
    if (isTranslated) {
      restore();
      bus.emit("restored");
    } else {
      await translatePage();
    }
  }

  // 初始化
  function init() {
    injectStyle();
    // 监听来自 background 的消息（快捷键/右键菜单）
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.type === "toggle-page-translate") {
        toggle();
        sendResponse({ ok: true });
      } else if (msg && msg.type === "translate-selection") {
        // 划词翻译由 ui.js 处理，这里转发
        bus.emit("translate-selection", msg.text);
        sendResponse({ ok: true });
      } else if (msg && msg.type === "set-display-mode") {
        setDisplayMode(msg.mode || "bilingual");
        sendResponse({ ok: true });
      } else if (msg && msg.type === "restore-page") {
        restore();
        bus.emit("restored");
        sendResponse({ ok: true });
      }
    });
    // 暴露给 ui.js
    globalThis.TransVaultPageTranslator = {
      translatePage,
      restore,
      toggle,
      setDisplayMode,
      isTranslated: () => isTranslated,
      bus,
    };
  }

  // 等待 DOM 就绪
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();