# TransVault 测试规范（重要约定）

> 本文件定义测试的触发规则与协作边界。**每次会话开始前先读本文件。**

---

## 1. 测试触发规则（最高优先级）

| 类型 | 何时跑 | 需要用户参与 |
|---|---|---|
| **日常测试**（默认） | 每次改代码后自行运行 | ❌ 全自动 |
| **三类对比测试**（样式 / 速度 / 翻译墙） | **仅当用户明确指明时** | ✅ 用户登录/配合 |

**用户原话（2026-09-09 确定）**：一般情况下不做对比测试，因为这需要人工登录，很麻烦；频繁开关浏览器也很麻烦。

---

## 2. Chrome profile 红线（教训）

- ❌ **永不**直接指向用户的 Chrome profile（`C:\Users\<user>\AppData\Local\Google\Chrome\User Data`）
- ❌ **永不** `taskkill /F /IM chrome.exe` 清理用户正在使用的 Chrome（会丢扩展/登录态，已发生过一次事故）
- ✅ 需要登录态时：独立 profile + 用户手工登录
- ✅ 需要清理时：只清理带 `--load-extension` 标记的 Playwright 实例进程

---

## 3. 测试类型清单

### 3.1 零人工测试（默认可自行运行）

```powershell
node scripts/test-dynamic.mjs          # 动态补翻纯逻辑单测
node -c src/**/*.js                    # 语法检查
npm run test                           # Playwright 测试（无登录态）
node scripts/compare_translate.mjs     # 扩展对比（独立 profile，无登录态）
```

- 本地 fixture 墙检测：`test/fixtures/paywall-sample.html`
- 真实站点未登录态 detector（网络不通自动 skip）

### 3.2 需要用户配合的测试（仅当用户指明）

三类场景（用户 2026-09-09 定义）：

| 场景 | 目的 | 用户参与点 |
|---|---|---|
| **样式对比** | 对比沉浸式翻译的译文排版（DOM + computed style） | 无（可全自动），但仅指明时跑 |
| **速度对比** | 排查为什么 TransVault 翻译慢 | 无 |
| **翻译墙验证** | 登录态下验证付费墙是否穿透 | **需要用户手工登录** |

---

## 4. 会话保持协议（需要用户登录时的标准流程）

1. Agent 运行 `node scripts/open_session.mjs <url>` → 启动独立浏览器（CDP 端口 9223）+ 保持运行
2. **用户在浏览器里手工登录**
3. 用户回复"登录好了"
4. Agent 运行 `node scripts/resume_session.mjs` → CDP 连上同一实例继续测试
5. 结束后 Agent 关闭会话

**约束**：一个会话内做完所有该测的项目，绝不反复开关浏览器。

---

## 5. 沉浸式翻译对比环境

- 扩展文件：`test/extensions/immersive-translate/`（v1.33.1，从 GitHub releases 下载，已 gitignore）
- 触发方式：页面加载后等待 ≥8s 初始化 → 点击页面中央获得焦点 → `Alt+A`
- 译文元素检测：`[class*='immersive-translate-target']`
- TransVault 译文元素：`.transvault-trans`；触发：点击 `button.transvault-fab`

---

## 6. 已知环境事实

- 用户系统代理：`127.0.0.1:7899`（Playwright 实例需显式传 `proxy` 才能访问 Google 翻译引擎）
- Chrome 的 `--remote-debugging-port` 在用户 profile 上会静默绑定失败 → 用 Playwright `launchPersistentContext` + 自己传端口才可靠
- MV3 content script 与页面 isolated world 隔离 → 检测器需暴露 `window.__TV_WALL_DETECTOR__` 供测试读取
- 测试实例无登录态时，WP 等站点 P 墙 confidence ≈ 0.45（metered paywall）