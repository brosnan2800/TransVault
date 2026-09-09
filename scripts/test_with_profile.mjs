// 用用户 profile 运行 detector 测试
// 每次启动前自动清理 Chrome 残留进程，确保 profile 可用

import { chromium } from "@playwright/test";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_DATA_DIR = "C:\\Users\\yanglei\\AppData\\Local\\Google\\Chrome\\User Data";
const TRANSVAULT_EXT = path.join(__dirname, "..", "src");
const DETECTOR_SRC = path.join(__dirname, "..", "src", "wall", "detector.js");

const WP_URL = "https://www.washingtonpost.com/style/2026/09/07/you-can-see-everything-elizabeth-holmes-documentary-premieres-telluride/";

async function main() {
  // 1. 清理 Chrome 残留
  console.log("[cleanup] 清理 Chrome 残留进程...");
  try {
    execSync('taskkill /F /IM chrome.exe 2>nul || echo "no chrome running"', { stdio: "ignore" });
    await new Promise((r) => setTimeout(r, 2000));
  } catch (e) { /* ignore */ }

  // 2. 启动带 profile 的浏览器
  console.log("[launch] 启动带用户 profile 的浏览器...");
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

  // 3. 打开目标页面
  console.log(`[nav] 打开 ${WP_URL}`);
  await page.goto(WP_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  // 4. 注入 detector
  await page.addScriptTag({ content: fs.readFileSync(DETECTOR_SRC, "utf-8") });

  // 5. 运行检测
  const report = await page.evaluate(() => {
    return window.__TV_WALL_DETECTOR__ ? window.__TV_WALL_DETECTOR__.detect() : { status: "no-detector" };
  });

  console.log("\n[report] Washington Post 墙检测:");
  console.log(JSON.stringify(report, null, 2));

  // 6. 页面信息
  const info = await page.evaluate(() => ({
    title: document.title,
    bodyLen: (document.body?.innerText || "").replace(/\s+/g, " ").trim().length,
    articleLen: (document.querySelector("article, [class*='article-body']")?.innerText || "").replace(/\s+/g, " ").trim().length,
  }));

  console.log("\n[info] 页面信息:");
  console.log(JSON.stringify(info, null, 2));

  await page.screenshot({ path: "test/screenshots/wp_user_profile.png", fullPage: false });
  console.log("\n[screenshot] 已保存到 test/screenshots/wp_user_profile.png");

  await context.close();
  console.log("[done] 完成");
}

main().catch((e) => {
  console.error("[fatal]", e.message);
  process.exit(1);
});