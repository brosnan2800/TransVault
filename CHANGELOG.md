# TransVault 变更记录

> 按版本记录的变更历史。新条目加在最上方。

---

## [Unreleased] - 2026-09-09

### Added
- 翻译墙检测器（P/A/D/E/S 五类），产出 `WallReport`（证据 + 置信度）
- 站点适配器仓库 `adapters/index.js`（Substack / Medium / Economist / Bloomberg / FT）
- 订阅墙策略 `wall/strategies/paywall.js`（archive.is 快照 + 降级提示）
- 双扩展对比测试环境（TransVault vs 沉浸式翻译，独立 profile）
- 会话保持脚本 `open_session.mjs` / `resume_session.mjs`（用户登录后继续测试）
- 测试规范 `TESTING.md`（三类对比测试仅用户指明时运行）
- 开发规范 `CONTRIBUTING.md`、变更记录 `CHANGELOG.md`

### Fixed
- SPA 重渲染清空译文的竞态（observer 提前到翻译开始前启用）
- Google 接口 429 时自动降级 Lingva 兜底（默认引擎链 `["google", "lingva"]`）
- 翻译失败静默吞错：批次失败打出引擎原因 + error 字段

### Performance
- 流式渲染：每批翻译完成立即渲染，不再等全部翻完（基线：WP 首字延迟 20.8s 集中显示）
- 视口优先排序：屏幕内段落最先翻译，用户先看到正在看的区域

---

## [v0.1.0] - 2026-09（初始提交 bc0cc0d）

### Added
- 整页双语翻译：译文插在原文下方，双语/仅译文/仅原文三态，一键还原
- 划词翻译：选中文本弹出译文浮层
- 多引擎分层回退：Google（免 Key）→ 必应 Azure / 阿里云 / 百度 / 腾讯云 / LibreTranslate / Lingva / LLM（DeepSeek·Gemini·OpenAI 兼容）/ baoyu 风格
- 翻译缓存：7 天 TTL，键含 text+lang+provider+style+mode，防脏读
- 动态补翻：`dynamic-core.js`（DebouncedScheduler + MutationObserver）滚动/异步加载自动补翻
- 站点适配：`site-adapters.js`（x.com / twitter.com）
- 配额保护：免费 Key 引擎月度用量计数，超额自动降级不扣费
- 快捷键 `Alt+A` 切换当前页翻译
- 架构文档 `DESIGN.md` v3.0（定位收窄：只做翻译 + 翻译墙）