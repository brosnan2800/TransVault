// 直连本机 Chrome CDP，运行 detector 检测华盛顿邮报
// 需要 Chrome 已带 --remote-debugging-port=9222 启动

import { chromium } from "@playwright/test";

const WP_URL = "https://www.washingtonpost.com/style/2026/09/07/you-can-see-everything-elizabeth-holmes-documentary-premieres-telluride/";

async function main() {
  console.log("[connect] 尝试连接 CDP :9222 ...");
  let browser;
  try {
    browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  } catch (e) {
    console.error("[connect] 连接失败:", e.message);
    console.log("\n请确认 Chrome 已用以下命令启动：");
    console.log('  chrome.exe --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1');
    process.exit(1);
  }

  console.log("[connect] 连接成功");

  const contexts = browser.contexts();
  if (!contexts.length) {
    console.error("[connect] 没有可用的 browser context");
    process.exit(1);
  }

  const context = contexts[0];
  const page = await context.newPage();

  console.log(`[nav] 打开 ${WP_URL}`);
  await page.goto(WP_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  // 注入 detector
  const fs = await import("fs");
  const detectorSrc = fs.readFileSync(new URL("../src/wall/detector.js", import.meta.url), "utf-8");
  await page.addScriptTag({ content: detectorSrc });

  // 运行检测
  const report = await page.evaluate(() => {
    return window.__TV_WALL_DETECTOR__ ? window.__TV_WALL_DETECTOR__.detect() : { status: "no-detector" };
  });

  console.log("\n[report] Washington Post 墙检测:");
  console.log(JSON.stringify(report, null, 2));

  // 页面信息
  const info = await page.evaluate(() => ({
    title: document.title,
    bodyLen: (document.body?.innerText || "").replace(/\s+/g, " ").trim().length,
    articleLen: (document.querySelector("article, [class*='article-body']")?.innerText || "").replace(/\s+/g, " ").trim().length,
  }));

  console.log("\n[info] 页面信息:");
  console.log(JSON.stringify(info, null, 2));

  await page.screenshot({ path: "test/screenshots/wp_user_browser.png", fullPage: false });
  console.log("\n[screenshot] 已保存到 test/screenshots/wp_user_browser.png");

  await browser.close();
}

main().catch((e) => {
  console.error("[fatal]", e);
  process.exit(1);
});