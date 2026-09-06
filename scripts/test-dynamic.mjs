// TransVault 动态补翻核心逻辑单测（Node 直接运行，零第三方依赖）
// 运行：node scripts/test-dynamic.mjs
// 作用：用 node:vm 加载经典脚本 dynamic-core.js，并用假 DOM 注入上下文，
//       验证 DebouncedScheduler / RootResolver / shouldTranslate / matchHost 等纯逻辑。

import vm from "node:vm";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const corePath = join(__dirname, "..", "src", "shared", "dynamic-core.js");
const coreSrc = readFileSync(corePath, "utf8");

// ---- 假 DOM：最小 element，支持 parentElement / closest / getAttribute / textContent ----
class FakeEl {
  constructor(tag, text) {
    this.tagName = (tag || "DIV").toUpperCase();
    this.nodeType = 1;
    this.children = [];
    this.parentElement = null;
    this._text = text || "";
    this.attrs = {};
  }
  set textContent(v) { this._text = String(v); }
  get textContent() { return this._text; }
  getAttribute(name) { return (name in this.attrs) ? this.attrs[name] : null; }
  setAttribute(name, val) { this.attrs[name] = String(val); }
  closest(sel) {
    if (sel === "[data-tv-root]") {
      let cur = this;
      while (cur) {
        if (cur.getAttribute("data-tv-root") !== null) return cur;
        cur = cur.parentElement;
      }
      return null;
    }
    if (sel === "article[data-testid='tweet']") {
      let cur = this;
      while (cur) {
        if (cur.tagName === "ARTICLE" && cur.getAttribute("data-testid") === "tweet") return cur;
        cur = cur.parentElement;
      }
      return null;
    }
    return null;
  }
}
function parentOf(n) { return n.parentElement || null; }
function isElement(n) { return n && n.nodeType === 1; }
const domHelpers = {
  parentElementOf: parentOf,
  closestOf: (n, s) => n.closest(s),
  isElement,
  getAttributeOf: (n, a) => n.getAttribute(a),
  tagNameOf: (n) => n.tagName,
};

// ---- 加载 core 到 sandbox ----
function loadCore() {
  const sandbox = { globalThis: {}, module: { exports: {} }, exports: {} };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(coreSrc, sandbox, { filename: "dynamic-core.js" });
  return sandbox.globalThis.TransVaultDynamicCore;
}

let passed = 0;
let failed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log("  ✓ " + name); })
    .catch((e) => { failed++; console.error("  ✗ " + name + "\n    " + e.message); });
}

const Core = loadCore();

// 手动定时器（测试 scheduler 用）
function makeFakeTimer() {
  let t = 0;
  const timers = new Map();
  let nextId = 1;
  return {
    now: () => t,
    advance(ms) { t += ms; },
    setTimeoutFn(fn, ms) { const id = nextId++; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimeoutFn(id) { timers.delete(id); },
    flush() {
      const due = [];
      for (const [id, tm] of timers) if (tm.at <= t) due.push({ id, tm });
      due.sort((a, b) => a.tm.at - b.tm.at);
      for (const { id, tm } of due) { timers.delete(id); tm.fn(); }
      return due.length > 0;
    },
  };
}

async function main() {
  console.log("TransVault dynamic-core 单测\n");

  await test("resolveAdapter: x.com / twitter.com 命中，非命中返回 null", () => {
    const map = {
      "x.com": { containerSelector: "article" },
      "twitter.com": { containerSelector: "article" },
      "*.medium.com": { a: 1 },
    };
    assert.strictEqual(Core.resolveAdapter("x.com", map).pattern, "x.com");
    assert.strictEqual(Core.resolveAdapter("www.x.com", map).pattern, "x.com");
    assert.strictEqual(Core.resolveAdapter("twitter.com", map).pattern, "twitter.com");
    // medium.com 不命中 *.medium.com（需前缀+点），返回 null
    assert.strictEqual(Core.resolveAdapter("medium.com", map), null);
    assert.strictEqual(Core.resolveAdapter("foo.medium.com", map).a, 1);
    assert.strictEqual(Core.resolveAdapter("bbc.com", map), null);
  });

  await test("matchHost 基础与通配", () => {
    assert.strictEqual(Core.matchHost("x.com", "x.com"), true);
    assert.strictEqual(Core.matchHost("www.x.com", "x.com"), true);
    assert.strictEqual(Core.matchHost("x.com", "*.x.com"), false);
    assert.strictEqual(Core.matchHost("foo.medium.com", "*.medium.com"), true);
    assert.strictEqual(Core.matchHost("medium.com", "*.medium.com"), false);
  });

  await test("makeRootResolver: 文本节点向上聚合到 tweet 容器", () => {
    const tweet = new FakeEl("ARTICLE");
    tweet.setAttribute("data-testid", "tweet");
    tweet.setAttribute("data-tv-root", "1");
    const span = new FakeEl("SPAN", "Hello world");
    span.parentElement = tweet;
    tweet.children.push(span);
    const resolver = Core.makeRootResolver(domHelpers);
    const rule = { containerSelector: "article[data-testid='tweet']" };
    assert.strictEqual(resolver.resolveFromAddedNode(span, rule), tweet);
    assert.strictEqual(resolver.resolveFromAddedNode(null, rule), null);
  });

  await test("makeRootResolver: 无适配器时回到 data-tv-root 标记根", () => {
    const root = new FakeEl("DIV");
    root.setAttribute("data-tv-root", "1");
    const p = new FakeEl("P", "Some text");
    p.parentElement = root;
    const resolver = Core.makeRootResolver(domHelpers);
    assert.strictEqual(resolver.resolveFromAddedNode(p, null), root);
  });

  await test("shouldTranslate: 过滤排除/已翻译/空/纯数字/目标语言", () => {
    const ctx = {
      isExcluded: (el) => el.getAttribute("data-ex") !== null,
      isTranslated: (el) => el.getAttribute("data-tv-translated") !== null,
      isTargetLang: (t) => /[\u4e00-\u9fff]/.test(t) && !/[a-z]/i.test(t),
      textOf: (el) => el.textContent.trim(),
      minTextLen: 2,
    };
    const ok = new FakeEl("P", "Hello everyone");
    assert.strictEqual(Core.shouldTranslate(ok, ctx), true);

    const ex = new FakeEl("P", "Hello"); ex.setAttribute("data-ex", "1");
    assert.strictEqual(Core.shouldTranslate(ex, ctx), false);

    const trans = new FakeEl("P", "Hello"); trans.setAttribute("data-tv-translated", "1");
    assert.strictEqual(Core.shouldTranslate(trans, ctx), false);

    const empty = new FakeEl("P", "  ");
    assert.strictEqual(Core.shouldTranslate(empty, ctx), false);

    const num = new FakeEl("P", "12345 6789");
    assert.strictEqual(Core.shouldTranslate(num, ctx), false);

    const zh = new FakeEl("P", "你好世界");
    assert.strictEqual(Core.shouldTranslate(zh, ctx), false);

    const short = new FakeEl("P", "A");
    assert.strictEqual(Core.shouldTranslate(short, ctx), false);
  });

  await test("DebouncedScheduler: 合并多次 touch，稳定+节流后只回调一次", async () => {
    const timer = makeFakeTimer();
    const roots = [];
    const scheduler = Core.DebouncedScheduler({
      now: timer.now,
      setTimeoutFn: timer.setTimeoutFn,
      clearTimeoutFn: timer.clearTimeoutFn,
      stableWindowMs: 400,
      debounceMs: 300,
      onBatch: (batch) => { roots.push(...batch); },
    });
    const r1 = new FakeEl("P", "alpha");
    const r2 = new FakeEl("P", "beta");
    scheduler.touch(r1);
    timer.advance(100);
    scheduler.touch(r2);
    scheduler.touch(r1);
    timer.advance(400 + 300);
    timer.flush();
    assert.strictEqual(roots.length, 2);
    assert.ok(roots.includes(r1));
    assert.ok(roots.includes(r2));
    assert.strictEqual(scheduler.isEmpty(), true);
  });

  await test("DebouncedScheduler: touch 持续变化则延长观望，直到停止才回调", async () => {
    const timer = makeFakeTimer();
    const roots = [];
    const scheduler = Core.DebouncedScheduler({
      now: timer.now,
      setTimeoutFn: timer.setTimeoutFn,
      clearTimeoutFn: timer.clearTimeoutFn,
      stableWindowMs: 400,
      debounceMs: 300,
      onBatch: (b) => roots.push(...b),
    });
    const r1 = new FakeEl("P", "x");
    scheduler.touch(r1);
    for (let i = 0; i < 5; i++) {
      timer.advance(300);
      scheduler.touch(r1);
      timer.flush();
    }
    timer.advance(400 + 300);
    timer.flush();
    assert.strictEqual(roots.length, 1);
  });

  await test("DebouncedScheduler: clear 清空待处理队列", async () => {
    const timer = makeFakeTimer();
    const roots = [];
    const scheduler = Core.DebouncedScheduler({
      now: timer.now,
      setTimeoutFn: timer.setTimeoutFn,
      clearTimeoutFn: timer.clearTimeoutFn,
      onBatch: (b) => roots.push(...b),
    });
    scheduler.touch(new FakeEl("P", "a"));
    scheduler.clear();
    timer.advance(2000);
    timer.flush();
    assert.strictEqual(roots.length, 0);
    assert.strictEqual(scheduler.isEmpty(), true);
  });

  console.log("\n结果：" + passed + " 通过, " + failed + " 失败");
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

