// 会话保持脚本（第一步）：启动独立浏览器并保持运行，等待用户手工登录
// 用法：node scripts/open_session.mjs <url>
// 之后用户在该浏览器中登录，Agent 用 resume_session.mjs 通过 CDP 9223 继续操作
// 注意：使用独立 profile（不碰用户 Chrome），登录态会持久保存供下次复用

import { chromium } from "@playwright/test";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRANSVAULT_EXT = path.join(__dirname, "..", "src");
const SESSION_PROFILE = path.join(__dirname, "..", "test", "screenshots", "session-profile");
const CDP_PORT = process.env.TV_CDP_PORT || 9223;
const PROXY = process.env.TV_PROXY === "off" ? undefined :
  (process.env.TV_PROXY || "http://127.0.0.1:7899");

const url = process.argv[2] || "https://www.washingtonpost.com/";

fs.mkdirSync(SESSION_PROFILE, { recursive: true });

console.log("[session] 启动浏览器（CDP 端口 " + CDP_PORT + "，代理: " + (PROXY || "无") + "）");
console.log("[session] profile:", SESSION_PROFILE);

const context = await chromium.launchPersistentContext(SESSION_PROFILE, {
  headless: false,
  viewport: { width: 1440, height: 900 },
  locale: "zh-CN",
  ...(PROXY ? { proxy: { server: PROXY } } : {}),
  args: [
    "--disable-extensions-except=" + TRANSVAULT_EXT,
    "--load-extension=" + TRANSVAULT_EXT,
    "--remote-debugging-port=" + CDP_PORT,
    "--remote-debugging-address=127.0.0.1",
    "--no-first-run",
    "--no-default-browser-check",
  ],
});

const page = context.pages()[0] || (await context.newPage());
console.log("[session] 打开:", url);
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

console.log("\n========================================");
console.log("会话已启动并保持运行。");
console.log("请在浏览器窗口中完成登录，然后告诉 Agent：登录好了");
console.log("Agent 将通过 http://127.0.0.1:" + CDP_PORT + " 继续操作。");
console.log("本进程保持运行，不要关闭这个终端。");
console.log("========================================\n");

// 保持进程运行
await new Promise(() => {});