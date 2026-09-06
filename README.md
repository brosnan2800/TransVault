# TransVault · 双语翻译扩展

沉浸式双语网页翻译 Chrome/Edge (MV3) 扩展。整页双语对照、划词翻译、多引擎分层回退。

> 这是 TransVault 三大块中的**第一块：页面翻译插件**。剪藏 / Obsidian 导入 / 发稿为后续块。

## 功能

- **整页双语翻译**：译文插在原文下方（沉浸式同款样式），支持双语 / 仅译文 / 仅原文三态切换，一键还原。
- **划词翻译**：选中文本即弹出译文浮层。
- **多引擎分层回退**：默认 Google 免 Key；可配置必应(Azure) / 阿里云 / 百度 / 腾讯云 / LibreTranslate / LLM(DeepSeek·Gemini·OpenAI兼容) / baoyu 风格。
- **翻译缓存**：7 天 TTL，切语言/引擎不脏读；页面翻过的段落剪藏时直接复用。
- **配额保护**：免费 Key 引擎月度用量计数，超额自动降级，不自动扣费。
- **快捷键**：`Alt+A` 切换当前页翻译。

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
  content/             整页翻译 + 划词 UI
  shared/              config / util / storage
  options/             引擎配置页
  popup/               快捷控制面板
  icons/               图标
scripts/make_icons.py  图标生成脚本
```

## 说明

- 纯 JS + ES Modules，免构建，直接加载 `src/` 即可。
- 所有跨域翻译请求走 background，content 不直连外网。
- 状态/缓存/配额全部落 `chrome.storage.local`，MV3 SW 被杀不丢。
- 密钥仅存本地 storage，仅在 background 读取。