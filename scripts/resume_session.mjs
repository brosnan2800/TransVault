// 会话保持脚本（第二步）：通过 CDP 连上 open_session.mjs 启动的浏览器继续操作
// 用法：node scripts/resume_session.mjs
// Agent 在这里注入检测器 / 运行 detector / 截图 / 对比，结果输出到 stdout

import { chromium } from "@playwright/test";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DETECTOR_SRC = path.join(__dirname, "..", "src", "wall", "detector.js");
const CDP_PORT = process.env.TV_CDP_PORT || 9223;

async function main() {
  console.log("[resume] 连接 CDP http://127.0.0.1:" + CDP_PORT + " ...");
  let browser;
  try {
    browser = await chromium.connectOverCDP("http://127.0.0.1:" + CDP_PORT);
  } catch (e) {
    console.error("[resume] 连接失败:", e.message);
    console.error("请确认 open_session.mjs 还在运行（浏览器未关闭）。");
    process.exit(1);
  }
  console.log("[resume] 连接成功");

  const contexts = browser.contexts();
  const context = contexts[0];
  const pages = context.pages();
  console.log("[resume] 当前标签页:");
  pages.forEach((p, i) => console.log("  [" + i + "]", p.url()));

  // 取最后一个非 about:blank 的页面作为工作页
  let page = [...pages].reverse().find((p) => !p.url().startsWith("about:"));
  if (!page) page = pages[0];
  console.log("[resume] 工作页:", page.url());
  await page.bringToFront();

  // 注入 detector 并运行
  await page.addScriptTag({ content: fs.readFileSync(DETECTOR_SRC, "utf-8") });
  const report = await page.evaluate(() => {
    const det = window.__TV_WALL_DETECTOR__;
    return det ? det.detect() : { status: "no-detector" };
  });
  console.log("\n[resume] 墙检测报告:");
  console.log(JSON.stringify(report, null, 2));

  // 页面信息
  const info = await page.evaluate(() => ({
    title: document.title,
    bodyLen: (document.body?.innerText || "").replace(/\s+/g, " ").trim().length,
    articleLen: (document.querySelector("article, [class*='article-body'], [class*='story-body']")?.innerText || "").replace(/\s+/g, " ").trim().length,
  }));
  console.log("\n[resume] 页面信息:", JSON.stringify(info, null, 2));

  // 截图
  const shotDir = path.join(__dirname, "..", "test", "screenshots", "session");
  fs.mkdirSync(shotDir, { recursive: true });
  const shot = path.join(shotDir, "session-" + Date.now() + ".png");
  await page.screenshot({ path: shot, fullPage: false });
  console.log("\n[resume] 截图:", shot);

  // 断开 CDP（不关闭浏览器，保持会话）
  browser.close();
  console.log("\n[resume] 完成（浏览器保持运行）。");
}

main().catch((e) => {
  console.error("[fatal]", e);
  process.exit(1);
});