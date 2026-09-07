// TransVault Playwright 测试配置
// 默认有头模式 + 加载沉浸式翻译插件，便于人眼对比 + 控制台调试
// 运行：npx playwright test  或  npm run test:headed

const { defineConfig } = require("@playwright/test");

// 沉浸式翻译插件路径（本机已安装时填入；留空则不加载）
// Windows 示例：C:\\Users\\<you>\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Extensions\\<id>\\<version>
const IMMERSIVE_EXT_PATH = process.env.TV_IMMERSIVE_EXT || "";

// TransVault 扩展路径（本项目 src/）
const TRANSVAULT_EXT_PATH = __dirname + "/src";

module.exports = defineConfig({
  testDir: "./test/spec",
  timeout: 60000,
  retries: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    headless: false, // 必须加载插件 → 有头
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    launchOptions: {
      slowMo: process.env.TV_SLOWMO ? Number(process.env.TV_SLOWMO) : 0,
      args: [
        "--disable-extensions-except=" + [IMMERSIVE_EXT_PATH, TRANSVAULT_EXT_PATH].filter(Boolean).join(","),
        "--load-extension=" + [IMMERSIVE_EXT_PATH, TRANSVAULT_EXT_PATH].filter(Boolean).join(","),
        "--no-first-run",
        "--no-default-browser-check",
      ].filter((a) => !a.endsWith("=")), // 移除空路径参数
    },
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});