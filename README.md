# TransVault · 双语翻译扩展

沉浸式双语网页翻译 Chrome/Edge (MV3) 扩展。整页双语对照、划词翻译、多引擎分层回退。

> **定位**：浏览器端只做两件事——**实时页面翻译**（已完成）与**特定网站翻译墙突破**（进行中）。
> 剪藏 / AI 加工 / 插图 / 发稿交由 Obsidian 生态（Web Clipper / 翻译插件 / Agent 插件 / 发布工具）组合完成；
> 扩展保留 Obsidian 轻量桥接与翻译缓存导出作为可选项。

## 功能

- **整页双语翻译**：译文插在原文下方（沉浸式同款样式），支持双语 / 仅译文 / 仅原文三态切换，一键还原。
- **划词翻译**：选中文本即弹出译文浮层。
- **多引擎分层回退**：默认 Google 免 Key；可配置必应(Azure) / 阿里云 / 百度 / 腾讯云 / LibreTranslate / LLM(DeepSeek·Gemini·OpenAI兼容) / baoyu 风格。
- **翻译缓存**：7 天 TTL，切语言/引擎不脏读。
- **动态补翻**：滚动 / 异步加载的新内容自动补翻（MutationObserver 增量）。
- **站点适配**：特殊 DOM 站点（如 x.com）按规则精确翻译。
- **配额保护**：免费 Key 引擎月度用量计数，超额自动降级，不自动扣费。
- **快捷键**：`Alt+A` 切换当前页翻译。

## 翻译墙处理（进行中）

「翻译墙」= 阻碍拿到可翻译原文的障碍。分五类，检测后走对应策略（详见 `DESIGN.md` §5）：

| 墙 | 示例 | 策略 |
|---|---|---|
| 付费墙 P | Substack / 名刊付费文 | archive.is 快照 → 降级提示 |
| 反爬墙 A | Cloudflare 挑战 / 403 | 清 Cookie → 等待挑战 → 引导互补扩展 |
| 动态墙 D | 无限滚动 / SPA | 动态补翻（已有） |
| 嵌入墙 E | iframe / 字幕 | same-origin 注入 / 提示打开源地址 |
| 结构墙 S | x.com / 社交 / 多列 | 站点适配器规则（已有 + 扩充） |

## 安装（开发模式）

1. 打开 Chrome/Edge，进入 `chrome://extensions`（Edge 为 `edge://extensions`）。
2. 右上角开启「开发者模式」。
3. 点「加载已解压的扩展程序」，选择本项目的 `src/` 目录。
4. 打开任意英文网页，点右下角「译」按钮或按 `Alt+A` 即可翻译。

## 默认引擎说明

- **默认 Google 免费网页端点**：免 Key、质量尚可，但**需翻墙**。
- **国内不翻墙**：在「扩展设置 → 国内免费 Key 引擎」填一个免费 Key（推荐必应 Azure 中国区，国内直连、超额不扣费），并在「翻译引擎」里把它勾选启用、拖到最上。

## 各引擎免费额度速查

| 引擎 | 免费额度 | 超额行为 | 国内直连 |
|---|---|---|---|
| Google 网页端点 | 无官方承诺（个人够用） | 可能被限流 | 需翻墙 |
| 必应 Azure | 200万字符/月 | 只报错不扣费 | 中国区端点可直连 |
| 阿里云 | 100万字符/月 | 需主动开通才扣 | ✅ |
| 百度 | 标准版免费(QPS=1) | 需主动开通才扣 | ✅ |
| 腾讯云 | 500万字符/月 | 需主动开通才扣 | ✅ |
| LibreTranslate | 自托管无限 | — | 本地 |

## 目录结构

```
src/
  manifest.json
  background/          service worker（消息中枢 + router + providers）
  content/             整页翻译 + 站点适配 + 划词 UI
  wall/                （规划）翻译墙检测 / P·A 墙策略
  shared/              config / util / storage / dynamic-core
  options/             引擎配置页
  popup/               快捷控制面板
  icons/               图标
scripts/               make_icons.py（图标）+ 动态补翻单测
```

## 说明

- 纯 JS + ES Modules，免构建，直接加载 `src/` 即可。
- 所有跨域翻译请求走 background，content 不直连外网。
- 状态/缓存/配额全部落 `chrome.storage.local`，MV3 SW 被杀不丢。
- 密钥仅存本地 storage，仅在 background 读取。