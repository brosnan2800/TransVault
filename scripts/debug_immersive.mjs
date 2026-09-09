// 诊断沉浸式翻译：检查扩展加载状态 + onboarding
import { chromium } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMMERSIVE_EXT = path.join(__dirname, "..", "test", "extensions", "immersive-translate");
const SHOT_DIR = path.join(__dirname, "..", "test", "screenshots", "compare");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const context = await chromium.launchPersistentContext(path.join(SHOT_DIR, "profile-immersive"), {
  headless: false,
  viewport: { width: 1440, height: 900 },
  proxy: { server: "http://127.0.0.1:7899" },
  args: [
    "--disable-extensions-except=" + IMMERSIVE_EXT,
    "--load-extension=" + IMMERSIVE_EXT,
    "--no-first-run",
    "--no-default-browser-check",
  ],
});

console.log("已打开页面:");
for (const p of context.pages()) {
  console.log("  -", p.url());
}
await sleep(3000);
console.log("\n等待 3s 后页面:");
for (const p of context.pages()) {
  console.log("  -", p.url());
}

// 打开 chrome://extensions 检查状态
const page = await context.newPage();
await page.goto("chrome://extensions");
await sleep(2000);
const extInfo = await page.evaluate(() => {
  const manager = document.querySelector("extensions-manager");
  const list = manager?.shadowRoot?.querySelector("extensions-item-list");
  const items = list?.shadowRoot?.querySelectorAll("extensions-item");
  const out = [];
  items?.forEach((item) => {
    out.push({
      id: item.id,
      name: item.shadowRoot?.querySelector("#name")?.textContent?.trim(),
    });
  });
  return out;
});
console.log("\n扩展列表:", JSON.stringify(extInfo, null, 2));

// 访问一个英文页面测试 Alt+A
await page.goto("https://en.wikipedia.org/wiki/Cat");
await sleep(3000);
await page.mouse.click(720, 400);
await page.keyboard.press("Alt+A");
await sleep(8000);
const inject = await page.evaluate(() => ({
  immersive: document.querySelectorAll("[class*='immersive-translate-target']").length,
  anyImmersiveEl: document.querySelectorAll("[class*='immersive']").length,
}));
console.log("\nWikipedia 测试 Alt+A:", JSON.stringify(inject));
await page.screenshot({ path: path.join(SHOT_DIR, "immersive_wikipedia.png") });

await context.close();