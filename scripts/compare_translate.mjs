// TransVault vs 沉浸式翻译 并排对比测试 v3
// 修复：走系统代理（Google 引擎需翻墙）+ 修正按钮选择器(.transvault-fab)

import { chromium } from "@playwright/test";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRANSVAULT_EXT = path.join(__dirname, "..", "src");
const IMMERSIVE_EXT = path.join(__dirname, "..", "test", "extensions", "immersive-translate");
const SHOT_DIR = path.join(__dirname, "..", "test", "screenshots", "compare");

const TEST_URL = process.env.TV_COMPARE_URL ||
  "https://en.wikipedia.org/wiki/Cat";
const WAIT_MS = Number(process.env.TV_WAIT_MS || 15000);
// 系统代理（Clash 等）；可用 TV_PROXY 覆盖，设 TV_PROXY=off 可禁用
const PROXY = process.env.TV_PROXY === "off" ? undefined :
  (process.env.TV_PROXY || "http://127.0.0.1:7899");

fs.mkdirSync(SHOT_DIR, { recursive: true });

async function runExtension(name, extPath, url, shotFile) {
  console.log(`\n[${name}] 启动浏览器（代理: ${PROXY || "无"}），加载扩展: ${extPath}`);
  const context = await chromium.launchPersistentContext(path.join(SHOT_DIR, "profile-" + name), {
    headless: false,
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
    ...(PROXY ? { proxy: { server: PROXY } } : {}),
    args: [
      "--disable-extensions-except=" + extPath,
      "--load-extension=" + extPath,
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });
  const page = context.pages()[0] || (await context.newPage());

  const logs = [];
  page.on("console", (msg) => {
    const t = msg.type();
    if (t === "error" || msg.text().includes("TransVault") || msg.text().includes("immersive")) {
      logs.push(`[${t}] ${msg.text().slice(0, 200)}`);
    }
  });

  console.log(`[${name}] 打开 ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  if (name === "transvault") {
    // 注入 DOM 观察器：记录每个 .transvault-trans 的插入时刻（测翻译节奏）
    await page.evaluate(() => {
      window.__tvT0 = performance.now();
      window.__tvEvents = [];
      window.__tvObs = new MutationObserver((muts) => {
        for (const m of muts) {
          for (const n of m.addedNodes) {
            if (n.nodeType === 1 && n.classList && n.classList.contains("transvault-trans")) {
              window.__tvEvents.push(Math.round(performance.now() - window.__tvT0));
            }
          }
        }
      });
      window.__tvObs.observe(document.body || document.documentElement, { subtree: true, childList: true });
    });

    // 点击右下角浮动球（button.transvault-fab）
    const fab = page.locator("button.transvault-fab");
    if (await fab.count()) {
      console.log(`[${name}] 点击浮动球...`);
      await fab.click({ timeout: 3000 });
    } else {
      console.log(`[${name}] 浮动球未找到，回退 Alt+A`);
      await page.mouse.click(720, 400);
      await page.keyboard.press("Alt+A");
    }

    // 等翻译稳定（数量 4 秒不变或超时 45s）
    const t0 = Date.now();
    let prev = -1, prevAt = Date.now();
    while (Date.now() - t0 < 45000) {
      await page.waitForTimeout(500);
      let c = 0;
      try { c = await page.evaluate(() => document.querySelectorAll(".transvault-trans").length); } catch (e) { continue; }
      if (c === prev && c > 0 && Date.now() - prevAt > 4000) break;
      if (c !== prev) { prev = c; prevAt = Date.now(); }
    }
  } else {
    // 沉浸式翻译：等扩展完全初始化（8s）再触发
    console.log(`[${name}] 等待扩展初始化...`);
    await page.waitForTimeout(8000);
    await page.mouse.click(720, 400);
    await page.keyboard.press("Alt+A");
    await page.waitForTimeout(5000);
    const imCount = await page.evaluate(() => document.querySelectorAll("[class*='immersive-translate-target']").length);
    if (imCount === 0) {
      console.log(`[${name}] Alt+A 无效，再试点击悬浮球/开关...`);
      const ball = page.locator("[class*='immersive-translate'] [class*='ball']").first();
      if (await ball.count()) {
        try { await ball.click({ timeout: 3000 }); } catch (e) { /* ignore */ }
      }
    }
  }

  await page.waitForTimeout(WAIT_MS);

  const inject = await page.evaluate(() => {
    const tv = document.querySelectorAll(".transvault-trans").length;
    const immersive = document.querySelectorAll(
      ".immersive-translate-target-wrapper, [class*='immersive-translate-target']"
    ).length;
    // 抽样译文文本，验证翻译真的发生了
    const tvSample = (document.querySelector(".transvault-trans")?.textContent || "").slice(0, 50);
    const imSample = (document.querySelector(".immersive-translate-target-wrapper, [class*='immersive-translate-target']")?.textContent || "").slice(0, 50);
    const events = window.__tvEvents || null;
    return { transvault: tv, immersive, tvSample, imSample, events, bodyLen: (document.body?.innerText || "").length };
  });
  console.log(`[${name}] 译文注入: ${JSON.stringify({ ...inject, events: inject.events ? `${inject.events.length} 个` : null })}`);

  // TransVault 速度分析
  if (inject.events && inject.events.length) {
    const ev = inject.events;
    let acc = 0;
    let t10 = null;
    for (const t of ev) { acc++; if (acc >= 10 && t10 === null) t10 = t; }
    const spread = ev[ev.length - 1] - ev[0];
    console.log(`[${name}] ⏱ 速度: 首个译文 ${ev[0]}ms | 累计10段 ${t10}ms | 最后插入 ${ev[ev.length-1]}ms | 插入跨度 ${spread}ms`);
    console.log(`[${name}] ⏱ 判定: ${spread < 1500 ? "⚠️ 集中瞬间插入（流式未生效）" : "✓ 渐进流式插入"}`);
  }

  if (logs.length) {
    console.log(`[${name}] console 摘要（前 8 条）:`);
    logs.slice(0, 8).forEach((l) => console.log("  " + l));
  }

  await page.screenshot({ path: shotFile, fullPage: false });
  console.log(`[${name}] 截图: ${shotFile}`);

  await context.close();
  return inject;
}

async function main() {
  console.log("=== TransVault vs 沉浸式翻译 对比测试 v3 ===");
  console.log("URL:", TEST_URL);

  const tv = await runExtension("transvault", TRANSVAULT_EXT, TEST_URL, path.join(SHOT_DIR, "transvault.png"));
  const im = await runExtension("immersive", IMMERSIVE_EXT, TEST_URL, path.join(SHOT_DIR, "immersive.png"));

  console.log("\n=== 对比结果 ===");
  console.log("TransVault  译文元素数:", tv.transvault, tv.tvSample ? `| 示例: ${tv.tvSample}` : "");
  console.log("沉浸式翻译   译文元素数:", im.immersive, im.imSample ? `| 示例: ${im.imSample}` : "");
  console.log("\n截图目录:", SHOT_DIR);
}

main().catch((e) => {
  console.error("[fatal]", e);
  process.exit(1);
});