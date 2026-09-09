// Playwright 配置：使用用户本机 Chrome profile（保留登录态）
// 运行：npx playwright test --config=playwright.userprofile.config.js

const { defineConfig } = require("@playwright/test");

const USER_DATA_DIR = "C:\\Users\\yanglei\\AppData\\Local\\Google\\Chrome\\User Data";
const TRANSVAULT_EXT_PATH = __dirname + "\\src";

module.exports = defineConfig({
  testDir: "./test/spec",
  timeout: 60000,
  retries: 1,
  reporter: [["list"]],
  use: {
    headless: false,
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
    launchOptions: {
      slowMo: 100,
      args: [
        "--user-data-dir=" + USER_DATA_DIR,
        "--disable-extensions-except=" + TRANSVAULT_EXT_PATH,
        "--load-extension=" + TRANSVAULT_EXT_PATH,
        "--no-first-run",
        "--no-default-browser-check",
        "--profile-directory=Default",
      ],
    },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});