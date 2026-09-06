// TransVault 动态补翻核心纯逻辑（经典脚本，无 import/export，同时被 content script 与 Node 单测加载）
// 职责：
//   1. DebouncedScheduler —— 把高频 DOM 变更合并成低频批量任务（stable-window + debounce）
//   2. RootResolver —— 从变更节点向上聚合到"翻译根"（纯函数，接收支持 parentElement 的 node 引用）
//   3. 过滤判定 —— 是否可翻译、是否目标语言、是否已翻译
//   4. 站点适配器解析工具
//
// 设计原则：本文件所有函数不直接触碰 DOM API（除了通过注入的 helpers 读取 parentElement /
// closest / textContent / getAttribute），以便在 Node `vm` 里用假 DOM 单测。

(function () {
  const U = (typeof globalThis !== "undefined" && globalThis.TransVaultUtil) || null;

  const C = {
    /** 每个根稳定前的观望时长，结束则合并成一次批量翻译 */
    stableWindowMs: 400,
    /** 稳定期结束后再等一个节流窗口，进一步合并连发 */
    debounceMs: 300,
    /** 单次批量处理的最大根数 */
    batchMaxRoots: 40,
    /** 单个根允许重复翻译的最大次数（防御循环；0=不限制） */
    repeatTranslateMax: 2,
    /** 稳定期内根内容仍变化时刷新该根进入观望的最多次数 */
    maxStableRefreshes: 20,
  };

  /* ---------------- 工具 ---------------- */

  function defaultBatchId() {
    return (U && U.uid ? U.uid("tv") : "" ) || "tv_" + Date.now().toString(36);
  }

  // 从节点沿 parentNode 向上找最近满足 predicate 的元素（含自身）；找不到返回 null
  function climb(node, predicate, maxDepth) {
    let cur = node;
    let depth = 0;
    const limit = (typeof maxDepth === "number" && maxDepth > 0) ? maxDepth : 200;
    while (cur) {
      if (predicate(cur)) return cur;
      cur = cur.parentElement;
      if (++depth > limit) break;
    }
    return null;
  }

  /* ---------------- DebouncedScheduler ---------------- */

  /**
   * 多根去重 + stable-window 防抖调度器。
   * 职责：上游把"变脏的根"丢进来，这里负责合并、等稳定、节流后回调一次批量处理。
   * @param {object} opts
   *  - now(): number                                 时间源（便于测试注入）
   *  - setTimeoutFn / clearTimeoutFn                  定时器（便于测试注入）
   *  - onBatch(roots: Array): void|Promise            稳定并节流后回调
   *  - isStable(root): boolean                       root 是否已稳定（内容不再变）
   *  - onStableRefresh(root): void                   root 内容变化时刷新其内部稳定标记
   *  - computeStateKey(root): string                 root 的内容指纹（用于判断是否重复变更）
   */
  function DebouncedScheduler(opts) {
    opts = opts || {};
    const now = opts.now || (() => Date.now());
    const setTimeoutFn = opts.setTimeoutFn || ((fn, ms) => setTimeout(fn, ms));
    const clearTimeoutFn = opts.clearTimeoutFn || ((id) => clearTimeout(id));

    // 内部状态
    const pending = new Map(); // root -> { firstSeen, stableAt, lastTouch, lastKey }
    let batchTimer = null;
    let running = false;
    let queuedRun = false;
    let idleWaiters = [];

    function _isEmpty() { return pending.size === 0; }

    function stableWindowMs() {
      return (opts.stableWindowMs != null ? opts.stableWindowMs : C.stableWindowMs);
    }
    function debounceMs() {
      return (opts.debounceMs != null ? opts.debounceMs : C.debounceMs);
    }

    function _scheduleBatch() {
      if (batchTimer) clearTimeoutFn(batchTimer);
      batchTimer = setTimeoutFn(() => {
        batchTimer = null;
        _run();
      }, stableWindowMs());
    }

    function _settleDue() {
      const due = [];
      const t = now();
      for (const [root, meta] of pending) {
        const stable = !opts.isStable || opts.isStable(root);
        if (stable && t - meta.lastTouch >= debounceMs()) due.push(root);
      }
      return due;
    }

    async function _run() {
      if (running) { queuedRun = true; return; }
      running = true;
      const due = _settleDue();
      for (const root of due) pending.delete(root);
      try {
        if (due.length && opts.onBatch) await Promise.resolve(opts.onBatch(due));
      } finally {
        running = false;
        if (queuedRun) {
          queuedRun = false;
          batchTimer = setTimeoutFn(() => { batchTimer = null; _run(); }, 1);
        } else if (!_isEmpty()) {
          _scheduleBatch();
        } else if (idleWaiters.length) {
          const ws = idleWaiters.splice(0, idleWaiters.length);
          ws.forEach((r) => r());
        }
      }
    }

    return {
      isEmpty: _isEmpty,
      get size() { return pending.size; },

      /** 把一个变脏的根加入调度。返回 true 表示首次进入（尚在观望），false 表示重复刷新 */
      touch(root) {
        const t = now();
        const key = opts.computeStateKey ? opts.computeStateKey(root) : "";
        const meta = pending.get(root);
        if (meta) {
          meta.lastTouch = t;
          if (key && key !== meta.lastKey) {
            meta.lastKey = key;
            if (opts.onStableRefresh) opts.onStableRefresh(root);
          }
          _scheduleBatch();
          return false;
        }
        pending.set(root, { firstSeen: t, lastTouch: t, lastKey: key });
        _scheduleBatch();
        return true;
      },

      /** 移除一个根（还原/节点销毁时调用） */
      cancel(root) { pending.delete(root); },

      /** 清空所有待处理根并取消定时器 */
      clear() {
        pending.clear();
        if (batchTimer) { clearTimeoutFn(batchTimer); batchTimer = null; }
        const ws = idleWaiters.splice(0, idleWaiters.length);
        ws.forEach((r) => r());
      },

      /** 等待当前批次处理完成（用于测试 / 还原前收尾） */
      async waitIdle() {
        if (_isEmpty() && !running) return;
        return new Promise((resolve) => {
          idleWaiters.push(resolve);
        });
      },
    };
  }

  /* ---------------- RootResolver ---------------- */

  /**
   * 从"变更起点"解析出翻译根。
   * @param {object} helpers 注入的 DOM 读取器（便于测试）
   *  - parentElementOf(node): node|null
   *  - closestOf(node, selector): node|null
   *  - isElement(node): boolean
   *  - getAttributeOf(node, name): string|null
   * @param {object} rule 适配器规则：{ containerSelector, textSelector, excludeSelectors }
   * @returns {node|null} 解析出的翻译根；null 表示应忽略
   */
  function makeRootResolver(helpers) {
    const H = helpers || {};
    const parentOf = H.parentElementOf || ((n) => n && n.parentElement);
    const closestOf = H.closestOf || ((n, s) => n && n.closest ? n.closest(s) : null);
    const isElement = H.isElement || ((n) => n && n.nodeType === 1);
    const getAttr = H.getAttributeOf || ((n, a) => (n && n.getAttribute ? n.getAttribute(a) : null));

    function resolveFromAddedNode(addedNode, rule) {
      if (!addedNode) return null;
      // 1. 文本节点 → 取父元素
      const el = isElement(addedNode) ? addedNode : parentOf(addedNode);
      if (!el) return null;
      if (rule && rule.containerSelector) {
        const container = closestOf(el, rule.containerSelector);
        if (container) return container;
      }
      const root = climb(el, (n) => isElement(n) && !!getAttr(n, "data-tv-root"), 60);
      return root;
    }

    return { resolveFromAddedNode };
  }

  /* ---------------- 过滤判定（纯函数） ---------------- */

  /** 判断一个候选根是否应该被翻译。 */
  function shouldTranslate(root, ctx) {
    if (!root) return false;
    if (ctx.isExcluded && ctx.isExcluded(root)) return false;
    if (ctx.isTranslated && ctx.isTranslated(root)) return false;
    const text = ctx.textOf ? ctx.textOf(root) : (root.textContent || "").trim();
    if (!text) return false;
    const minLen = ctx.minTextLen != null ? ctx.minTextLen : 2;
    if (text.length < minLen) return false;
    if (!/[a-zA-Z\u4e00-\u9fff]/.test(text)) return false;
    if (ctx.isTargetLang && ctx.isTargetLang(text)) return false;
    return true;
  }

  /* ---------------- 适配器解析 ---------------- */

  /** 简单的域名通配匹配（* 支持前/后置，自动忽略 www.） */
  function matchHost(host, pattern) {
    host = String(host || "").toLowerCase().replace(/^www\./, "");
    pattern = String(pattern || "").toLowerCase().replace(/^www\./, "");
    if (pattern === host) return true;
    if (pattern.indexOf("*") >= 0) {
      const re = new RegExp("^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
      return re.test(host);
    }
    return false;
  }

  /** 从登记表里按 host 找适配器；返回 null 表示无适配器（走通用逻辑） */
  function resolveAdapter(host, adapterMap) {
    if (!adapterMap || typeof adapterMap !== "object") return null;
    for (const pattern of Object.keys(adapterMap)) {
      if (matchHost(host, pattern)) {
        const ad = adapterMap[pattern];
        return Object.assign({}, ad, { pattern });
      }
    }
    return null;
  }

  /* ---------------- 导出 ---------------- */

  const API = {
    C,
    DebouncedScheduler,
    makeRootResolver,
    shouldTranslate,
    matchHost,
    resolveAdapter,
    climb,
  };

  globalThis.TransVaultDynamicCore = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
