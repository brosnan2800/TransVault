# TransVault 开发规范

> 本文件定义代码风格、提交规范、分支策略与自测清单。**每次改代码前必读。**

---

## 1. 代码风格

### 1.1 模块系统

| 位置 | 模块系统 | 规范 |
|---|---|---|
| `background/` | ES Module | 使用 `import/export`，`service-worker.js` 为入口 |
| `content/` / `shared/` / `wall/` / `adapters/` | 经典脚本 | IIFE + `globalThis.TransVaultXxx` 挂载，无 `import/export` |
| `options/` / `popup/` | 经典脚本 | 同上 |

**原因**：content script 与 background 共享工具函数（config/util/storage），经典脚本可被两者直接 `<script>` 加载，无需构建。

### 1.2 命名规范

| 类型 | 规范 | 示例 |
|---|---|---|
| 文件 | kebab-case | `page-translator.js`、`dynamic-core.js` |
| 函数 | camelCase | `translateBatch()`、`collectRoots()` |
| 常量 | UPPER_SNAKE | `BLOCK_TAGS`、`CONCURRENCY` |
| 全局挂载 | `TransVault` 前缀 | `TransVaultConfig`、`TransVaultWallDetector` |
| CSS 类 | `transvault-` 前缀 | `.transvault-trans`、`.transvault-fab` |
| DOM 属性 | `data-tv-` 前缀 | `data-tv-translated`、`data-tv-dynamic` |

### 1.3 注释规范

- 公共函数：JSDoc 注释（`@param` / `@returns`）
- 复杂逻辑：行内注释说明 **为什么**（不是做什么）
- 修改记录：不保留修改历史注释（git 负责）

### 1.4 禁止事项

- ❌ 禁止引入第三方库（纯 stdlib：`fetch`、`AbortController`、`crypto`）
- ❌ 禁止 content script 直连外网（全部走 background `chrome.runtime.sendMessage`）
- ❌ 禁止硬编码密钥（密钥只存 `chrome.storage.local`）
- ❌ 禁止 `console.log` 输出敏感信息（可保留 `console.warn/error` 用于调试）

---

## 2. 提交规范

### 2.1 格式

```
type: 中文描述（动词开头）
```

### 2.2 类型说明

| 类型 | 用途 | 示例 |
|---|---|---|
| `feat` | 新功能 | `feat: 翻译墙检测器（P/A/D/E/S 五类）` |
| `fix` | 修复 bug | `fix: SPA 重渲染清空译文的竞态` |
| `perf` | 性能优化 | `perf: 流式渲染 + 视口优先排序` |
| `docs` | 文档变更 | `docs: 新增 CONTRIBUTING.md 开发规范` |
| `test` | 测试相关 | `test: 新增双扩展对比脚本` |
| `refactor` | 重构（无功能变化） | `refactor: batchTexts 返回起始索引` |
| `chore` | 构建/工具 | `chore: .gitignore 补充 test/extensions/` |

### 2.3 描述原则

- 动词开头：`新增`、`修复`、`优化`、`重构`
- 一句话说清做了什么
- 必要时括号补充模块/上下文

### 2.4 GitHub 推送认证（本机配置）

| 项 | 值 | 说明 |
|---|---|---|
| 远端 | `https://github.com/brosnan2800/TransVault.git`（HTTPS） | push/pull 走 HTTPS |
| 凭据助手 | 系统级 `git config`：`credential.helper=manager` | **GCM**（Git Credential Manager） |
| 凭据存储 | Windows 凭据管理器：`target=git:https://github.com`，用户名 `brosnan2800` | 令牌由 GCM 自动读写 |
| 推送命令 | `git push origin master` | 无交互，自动取用令牌 |

**规则**：

- ✅ 令牌只存 Windows 凭据管理器，**严禁**写入 `.git/config`、`~/.git-credentials` 或任何仓库文件。
- ✅ `gh` CLI 当前未登录；若需走 GitHub API（例如改仓库 About/description），用下述 `git credential fill` 方式取 GCM 令牌，**不要**另生成令牌散落各处。
- ⚠️ **编码红线**：任何经 API / CLI 写入 GitHub 的中文（description、release 等）必须以 **UTF-8** 提交。Windows 终端默认可能为 GBK，未经 `chcp 65001`（或按 UTF-8 编码）直接发出去，中文会被 GitHub 替换成 `?` 永久存坏（曾导致 About 乱码 `???`，需 API PATCH 重写才修复）。
- 📌 取 GCM 令牌（一次性、避免回显到历史/日志）：

  ```powershell
  # 交互式获取，打印 username/password，用完立即清屏不回显进文件
  git credential fill
  # 输入:
  #   protocol=https
  #   host=github.com
  #   <空行>
  ```

**排查备忘**（下次再遇认证/乱码问题）：
1. `git config --show-origin --list` → 确认 `credential.helper=manager`。
2. `cmdkey /list` → 找 `LegacyGeneric:target=git:https://github.com`。
3. `gh auth status` → 确认 gh 是否登录（本机当前未登录）。

---

## 3. 分支策略

- **主干**：`master`，直接推送
- **大功能**：可选开 `feat/xxx` 分支，合并后删除
- **禁止**：无（单人项目，灵活处理）

---

## 4. 自测清单（改代码后必跑）

### 4.1 必跑（每次）

```powershell
node -c src/content/*.js src/background/*.js src/shared/*.js src/wall/*.js src/adapters/*.js
node scripts/test-dynamic.mjs
```

### 4.2 按需

| 改动 | 跑什么 |
|---|---|
| 翻译核心 | `node scripts/compare_translate.mjs` |
| 墙检测器 | `node scripts/measure_speed.mjs` + 真实站点 |
| 扩展清单 | 手动加载 `src/` → 测试各引擎 |

### 4.3 检查项

- [ ] 语法无误（`node -c` 全过）
- [ ] 单测全过（`test-dynamic.mjs` 0 失败）
- [ ] 无残留调试日志（搜索 `console.log`）
- [ ] 文档已同步（见 §5）

---

## 5. 文档同步

| 改动 | 同步到 |
|---|---|
| 架构/接口/数据流 | `DESIGN.md` |
| 测试流程/工具 | `TESTING.md` |
| 代码风格/提交规范 | `CONTRIBUTING.md` |
| 功能变化 | `CHANGELOG.md` |
| 新增 provider | `config.js` ENGINE_CATALOG + `README.md` 引擎表 |
| 新增墙策略 | `DESIGN.md` §2 墙分类表 |
| 重大决策 | `docs/adr/xxx.md` |

---

## 6. 扩展清单

### 6.1 新增翻译引擎

1. `background/providers/xxx.js` 实现 Provider
2. `config.js` 的 `ENGINE_CATALOG` 和 `DEFAULTS` 注册
3. `router.js` 的 `_initProviders()` 实例化
4. `README.md` 引擎表补充
5. `DESIGN.md` §6.1 分层链补充

### 6.2 新增墙策略

1. `wall/strategies/xxx.js` 实现策略
2. `wall/detector.js` 加检测信号
3. `wall/wall-router.js` 编排
4. `DESIGN.md` §2 + §5.4 同步

### 6.3 新增站点适配器

1. `adapters/index.js` 加 host 规则
2. `DESIGN.md` §5.5 种子清单补充
3. 手动验证翻译结果