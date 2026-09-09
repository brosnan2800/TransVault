// 测试：华盛顿邮报具体文章页的墙检测
const { test, expect } = require("@playwright/test");
const path = require("path");
const fs = require("fs");

const DETECTOR_SRC = path.join(__dirname, "..", "..", "src", "wall", "detector.js");

const WP_URL = "https://www.washingtonpost.com/style/2026/09/07/you-can-see-everything-elizabeth-holmes-documentary-premieres-telluride/";

async function ensureDetector(page) {
  const hasDetector = await page.evaluate(() => {
    return !!(window.__TV_WALL_DETECTOR__ || globalThis.TransVaultWallDetector);
  });
  if (!hasDetector) {
    const src = fs.readFileSync(DETECTOR_SRC, "utf-8");
    await page.addScriptTag({ content: src });
  }
}

test("华盛顿邮报文章页墙检测", async ({ page }) => {
  try {
    await page.goto(WP_URL, { waitUntil: "domcontentloaded", timeout: 20000 });
  } catch (e) {
    console.log(`\n[WP] SKIP: ${e.message.split("\n")[0]}`);
    test.skip();
    return;
  }
  await page.waitForTimeout(3000);
  await ensureDetector(page);

  const report = await page.evaluate(() => {
    const det = window.__TV_WALL_DETECTOR__ || globalThis.TransVaultWallDetector;
    return det ? det.detect() : { status: "no-detector" };
  });

  console.log("\n[Washington Post] wall report:", JSON.stringify(report, null, 2));

  // 额外：打印页面标题和可见文本长度，辅助判断
  const pageInfo = await page.evaluate(() => {
    const title = document.title;
    const bodyText = (document.body && document.body.innerText ? document.body.innerText : "").replace(/\s+/g, " ").trim();
    const metaDescription = (document.querySelector("meta[name='description']") || {}).content || "";
    const articleBody = document.querySelector("article, [class*='article-body'], [class*='story-body']");
    const articleText = articleBody ? (articleBody.innerText || "").replace(/\s+/g, " ").trim().length : 0;
    return { title, bodyLen: bodyText.length, articleLen: articleText, metaDescription: metaDescription.slice(0, 200) };
  });

  console.log("\n[Washington Post] page info:", JSON.stringify(pageInfo, null, 2));

  await page.screenshot({ path: "test/screenshots/wp_article.png", fullPage: false });

  expect(report).toBeTruthy();
});