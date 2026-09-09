// 用 Playwright launchPersistentContext 启动带用户 profile 的浏览器
// 保留登录态 + 加载 TransVault 扩展

import { chromium } from "@playwright/test";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_DATA_DIR = "C:\\Users\\yanglei\\AppData\\Local\\Google\\Chrome\\User Data";
const TRANSVAULT_EXT = path.join(__dirname, "..", "src");

const WP_URL = "https://www.washingtonpost.com/style/2026/09/07/you-can-see-everything-elizabeth-holmes-documentary-premieres-telluride/";

async function main() {
  console.log("[launch] 启动带 profile 的浏览器...");
  console.log("[launch] profile:", USER_DATA_DIR);

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
    args: [
      "--disable-extensions-except=" + TRANSVAULT_EXT,
      "--load-extension=" + TRANSVAULT_EXT,
      "--no-first-run",
      "--no-default-browser-check",
      "--profile-directory=Default",
    ],
  });

  console.log("[launch] 浏览器已启动");

  const page = context.pages()[0] || await context.newPage();

  console.log(`[nav] 打开 ${WP_URL}`);
  await page.goto(WP_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  // 注入 detector
  const detectorSrc = fs.readFileSync(path.join(__dirname, "..", "src", "wall", "detector.js"), "utf-8");
  await page.addScriptTag({ content: detectorSrc });

  const report = await page.evaluate(() => {
    return window.__TV_WALL_DETECTOR__ ? window.__TV_WALL_DETECTOR__.detect() : { status: "no-detector" };
  });

  console.log("\n[report] Washington Post 墙检测:");
  console.log(JSON.stringify(report, null, 2));

  const info = await page.evaluate(() => ({
    title: document.title,
    bodyLen: (document.body?.innerText || "").replace(/\s+/g, " ").trim().length,
    articleLen: (document.querySelector("article, [class*='article-body']")?.innerText || "").replace(/\s+/g, " ").trim().length,
  }));

  console.log("\n[info] 页面信息:");
  console.log(JSON.stringify(info, null, 2));

  await page.screenshot({ path: "test/screenshots/wp_persistent.png", fullPage: false });
  console.log("\n[screenshot] 已保存到 test/screenshots/wp_persistent.png");

  await context.close();
}

main().catch((e) => {
  console.error("[fatal]", e.message);
  process.exit(1);
});