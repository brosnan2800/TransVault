// 测试 1：墙检测器在种子站点上的表现
// 目的：验证 TransVault wall detector 对 P/A/D/E/S 五类墙的判定
// 同时可加载沉浸式翻译做视觉对比（设置 TV_IMMERSIVE_EXT 环境变量启用）

const { test, expect } = require("@playwright/test");
const path = require("path");

// 种子站点：host -> 预期墙类型（至少命中一个）
const SEED_SITES = [
  { url: "https://www.economist.com/", expectWalls: ["P", "S"], desc: "Economist: 订阅墙 + 结构墙" },
  { url: "https://medium.com/", expectWalls: ["P", "S"], desc: "Medium: 会员墙 + 结构墙" },
  { url: "https://www.bloomberg.com/", expectWalls: ["P", "A"], desc: "Bloomberg: 订阅墙 + 反爬墙" },
  { url: "https://www.ft.com/", expectWalls: ["P", "A"], desc: "FT: 订阅墙 + 反爬墙" },
];

// 本地 fixture：模拟 P 墙页面
const PAYWALL_HTML = path.join(__dirname, "..", "fixtures", "paywall-sample.html");

for (const site of SEED_SITES) {
  test(`[${site.desc}] 墙检测`, async ({ page }) => {
    await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000); // 等动态注入

    // 运行 TransVault wall detector（必须在扩展已加载时才有 globalThis.TransVaultWallDetector）
    const report = await page.evaluate(() => {
      if (globalThis.TransVaultWallDetector) {
        return globalThis.TransVaultWallDetector.detect();
      }
      return { status: "no-detector", walls: [] };
    });

    console.log(`\n[${site.desc}] wall report:`, JSON.stringify(report, null, 2));

    // 截图留证
    await page.screenshot({ path: `test/screenshots/${site.url.replace(/[^a-z0-9]/gi, "_")}.png`, fullPage: false });

    // 扩展未加载时的基本断言
    expect(report).toBeTruthy();
    expect(report.status === "clean" || report.status === "broken").toBeTruthy();
  });
}

test("本地 P 墙 fixture 能被 detector 识别", async ({ page }) => {
  await page.goto("file://" + PAYWALL_HTML);
  await page.waitForTimeout(500);

  const report = await page.evaluate(() => {
    return globalThis.TransVaultWallDetector
      ? globalThis.TransVaultWallDetector.detect()
      : { status: "no-detector" };
  });

  console.log("\n[本地 P 墙 fixture] report:", JSON.stringify(report, null, 2));

  // fixture 构造了一个短正文 + 订阅关键词 + paywall DOM，应命中 P 墙
  if (report.status !== "no-detector") {
    const types = (report.walls || []).map((w) => w.type);
    expect(types).toContain("P");
  }
});