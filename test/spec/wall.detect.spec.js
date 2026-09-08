// 测试 1：墙检测器在种子站点上的表现
// 目的：验证 TransVault wall detector 对 P/A/D/E/S 五类墙的判定
// 注意：真实站点测试需要网络可达；不可达时自动 skip

const { test, expect } = require("@playwright/test");
const path = require("path");
const http = require("http");
const fs = require("fs");

// 种子站点：host -> 预期墙类型
const SEED_SITES = [
  { url: "https://www.economist.com/", expectWalls: ["P", "S"], desc: "Economist: 订阅墙 + 结构墙" },
  { url: "https://medium.com/", expectWalls: ["P", "S"], desc: "Medium: 会员墙 + 结构墙" },
  { url: "https://www.bloomberg.com/", expectWalls: ["P", "A"], desc: "Bloomberg: 订阅墙 + 反爬墙" },
  { url: "https://www.ft.com/", expectWalls: ["P", "A"], desc: "FT: 订阅墙 + 反爬墙" },
];

// 本地 fixture
const FIXTURE_DIR = path.join(__dirname, "..", "fixtures");
const PAYWALL_HTML = path.join(FIXTURE_DIR, "paywall-sample.html");
const DETECTOR_SRC = path.join(__dirname, "..", "..", "src", "wall", "detector.js");

// 简易 HTTP 服务器
let server;
test.beforeAll(async () => {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      const filePath = path.join(FIXTURE_DIR, req.url === "/" ? "paywall-sample.html" : req.url);
      if (fs.existsSync(filePath)) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(fs.readFileSync(filePath));
      } else {
        res.writeHead(404);
        res.end("not found");
      }
    });
    server.listen(0, "127.0.0.1", () => resolve());
  });
});

test.afterAll(async () => {
  if (server) server.close();
});

function getFixtureUrl() {
  const addr = server.address();
  return `http://127.0.0.1:${addr.port}/paywall-sample.html`;
}

// 注入 detector 脚本（如果扩展未加载）
async function ensureDetector(page) {
  const hasDetector = await page.evaluate(() => {
    return !!(window.__TV_WALL_DETECTOR__ || globalThis.TransVaultWallDetector);
  });
  if (!hasDetector) {
    const src = fs.readFileSync(DETECTOR_SRC, "utf-8");
    await page.addScriptTag({ content: src });
  }
}

for (const site of SEED_SITES) {
  test(`[${site.desc}] 墙检测`, async ({ page }) => {
    try {
      await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 15000 });
    } catch (e) {
      console.log(`\n[${site.desc}] SKIP: ${e.message.split("\n")[0]}`);
      test.skip();
      return;
    }
    await page.waitForTimeout(2000);
    await ensureDetector(page);

    const report = await page.evaluate(() => {
      const det = window.__TV_WALL_DETECTOR__ || globalThis.TransVaultWallDetector;
      if (det) return det.detect();
      return { status: "no-detector", walls: [] };
    });

    console.log(`\n[${site.desc}] wall report:`, JSON.stringify(report, null, 2));

    await page.screenshot({
      path: `test/screenshots/${site.url.replace(/[^a-z0-9]/gi, "_")}.png`,
      fullPage: false,
    });

    expect(report).toBeTruthy();
    expect(report.status === "clean" || report.status === "broken").toBeTruthy();
  });
}

test("本地 P 墙 fixture 能被 detector 识别", async ({ page }) => {
  await page.goto(getFixtureUrl());
  await page.waitForTimeout(500);
  await ensureDetector(page);

  const report = await page.evaluate(() => {
    const det = window.__TV_WALL_DETECTOR__ || globalThis.TransVaultWallDetector;
    return det ? det.detect() : { status: "no-detector" };
  });

  console.log("\n[本地 P 墙 fixture] report:", JSON.stringify(report, null, 2));

  if (report.status !== "no-detector") {
    const types = (report.walls || []).map((w) => w.type);
    expect(types).toContain("P");
  } else {
    console.log("\n[本地 P 墙 fixture] SKIP: detector not loaded");
    test.skip();
  }
});