// TransVault 翻译速度时间线测量
// 点击浮动球后每 500ms 轮询译文元素数量，输出"什么时候出现第一批、什么时候全部完成"
// 用途：验证"全部翻完才渲染"假设 —— 若时间线呈"长时间 0 → 突然全量"，则假设成立

import { chromium } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRANSVAULT_EXT = path.join(__dirname, "..", "src");
const SHOT_DIR = path.join(__dirname, "..", "test", "screenshots", "speed");
const PROXY = process.env.TV_PROXY === "off" ? undefined :
  (process.env.TV_PROXY || "http://127.0.0.1:7899");

const TEST_URL = process.env.TV_COMPARE_URL ||
  "https://www.washingtonpost.com/style/2026/09/07/you-can-see-everything-elizabeth-holmes-documentary-premieres-telluride/";

const context = await chromium.launchPersistentContext(path.join(SHOT_DIR, "..", "compare", "profile-transvault"), {
  headless: false,
  viewport: { width: 1440, height: 900 },
  locale: "zh-CN",
  ...(PROXY ? { proxy: { server: PROXY } } : {}),
  args: [
    "--disable-extensions-except=" + TRANSVAULT_EXT,
    "--load-extension=" + TRANSVAULT_EXT,
    "--no-first-run",
    "--no-default-browser-check",
  ],
});

const page = context.pages()[0] || (await context.newPage());
console.log("[speed] 打开:", TEST_URL);
// 注意：不做 networkidle 长等——WP 会在等待期间切到 consent 遮罩版本导致正文消失
// 用 compare 脚本已验证的短等待流程（domcontentloaded + 3s）
await page.goto(TEST_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(3000);

// 点击浮动球，开始计时
// 时间线记录用页面内 MutationObserver（DOM 共享，主世界可观察 content script 的插入）
// 即使 WP 框架删除译文节点，插入事件也被记录 → 还原翻译真实节奏
console.log("[speed] 注入 DOM 观察器...");
await page.evaluate(() => {
  window.__tvT0 = performance.now();
  window.__tvEvents = [];
  const target = document.body || document.documentElement;
  window.__tvObs = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType === 1) {
          const isTv = n.classList && n.classList.contains("transvault-trans");
          const tvInside = n.querySelector ? n.querySelectorAll(".transvault-trans").length : 0;
          if (isTv || tvInside) {
            window.__tvEvents.push({ t: Math.round(performance.now() - window.__tvT0), add: isTv ? 1 : tvInside });
          }
        }
      }
    }
  });
  window.__tvObs.observe(target, { subtree: true, childList: true });
});

console.log("[speed] 点击浮动球，开始计时...");
const t0 = Date.now();
let finalCount = 0;
let prevCount = -1;
let prevAt = Date.now();

while (Date.now() - t0 < 45000) {
  await page.waitForTimeout(500);
  let c = 0;
  try {
    c = await page.evaluate(() => document.querySelectorAll(".transvault-trans").length);
  } catch (e) { continue; }
  finalCount = c;
  if (c === prevCount && c > 0 && Date.now() - prevAt > 4000) break;
  if (c !== prevCount) { prevCount = c; prevAt = Date.now(); }
}

const events = await page.evaluate(() => {
  window.__tvObs.disconnect();
  return window.__tvEvents;
});
const curCount = await page.evaluate(() => document.querySelectorAll(".transvault-trans").length);

console.log("\n[speed] 插入事件时间线（t=点击后ms, add=该事件注入的译文数）:");
events.slice(0, 30).forEach((p) => console.log(`  t=${String(p.t).padStart(6)}ms  +${p.add}`));
if (events.length > 30) console.log(`  ... 共 ${events.length} 个插入事件`);

// 分析
console.log("\n[speed] 分析:");
console.log("  插入事件总数:", events.length);
console.log("  当前存活译文数:", curCount, "（若远小于插入总数 → 页面框架在删除译文节点）");
console.log("  稳定后译文数（轮询）:", finalCount);
if (events.length) {
  const first = events[0];
  const last = events[events.length - 1];
  // 累计插入数曲线
  let acc = 0;
  const curve = [];
  for (const e of events) { acc += e.add; curve.push({ t: e.t, acc }); }
  const firstBatch = curve.find((c) => c.acc >= 10);
  console.log("  首个插入事件:", `${first.t}ms`);
  console.log("  累计达 10 段:", firstBatch ? `${firstBatch.t}ms` : "未达");
  console.log("  最后插入事件:", `${last.t}ms`);
  console.log("  插入节奏:", last.t - first.t < 1500
    ? "⚠️ 全部插入集中在瞬间 → 流式渲染未生效"
    : "✓ 渐进插入 → 流式渲染生效");
  if (curCount < acc * 0.5) {
    console.log("  ⚠️ 警告：译文节点被页面框架大量删除（WP Next.js 重渲染），需要防护");
  }
}

await page.screenshot({ path: path.join(SHOT_DIR, "speed-timeline.png") });
await context.close();