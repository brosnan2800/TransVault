// TransVault 默认配置
// 注意：此文件由 content script 与 background 共同加载，
// 只能使用 ES Module 之外的经典脚本语法（无 import/export）。

(function () {
  const DEFAULTS = {
    // 通用
    enabled: true,
    sourceLang: "auto",
    targetLang: "zh-CN",

    // 渲染模式：bilingual（原文+译文）| translation（仅译文）| original（仅原文）
    displayMode: "bilingual",

    // 引擎链分层（数组由低到高优先级；router 依次尝试，失败回退下一项）
    // 可用 id 见 ENGINE_CATALOG
    engineOrder: ["google"],

    // 各引擎专用配置（options 页填写）
    libreTranslateUrl: "http://127.0.0.1:5000",
    azure: {
      region: "eastasia",
      // 必应翻译（Azure Translator）在线申请：
      // https://portal.azure.com/#create/Microsoft.CognitiveServicesTextTranslation
      key1: "",
      key2: "",
    },
    azureChina: {
      // 中国区端点，需在 Azure 中国版（https://portal.azure.cn）申请
      region: "chinanorth",
      key1: "",
      key2: "",
    },
    aliyun: {
      accessKeyId: "",
      accessKeySecret: "",
      // https://help.aliyun.com/document_detail/126854.html 免费额度 100 万字符/月
    },
    baidu: {
      appId: "",
      appSecret: "",
      // https://fanyi-api.baidu.com/doc/21 标准版免费（QPS=1）
    },
    tencent: {
      secretId: "",
      secretKey: "",
      // https://cloud.tencent.com/document/product/551 免费额度 500 万字符/月
    },
    // LLM（DeepSeek / Gemini / OpenAI 兼容）
    llm: {
      providers: [
        // { id: "deepseek", key: "", baseUrl: "https://api.deepseek.com", model: "deepseek-chat" },
        // { id: "gemini", key: "", baseUrl: "https://generativelanguage.googleapis.com", model: "gemini-1.5-flash" },
        // { id: "openai-compat", key: "", baseUrl: "", model: "" },
      ],
      activeProviderIndex: -1, // -1 = 未启用
    },
    // baoyu path1（嵌入式思考模板，跑在 tier3 LLM 之上）
    baoyu: {
      enabled: false,
      mode: "normal", // quick | normal | refined
      style: "", // storytelling | formal | technical | ...
      audience: "",
    },

    // 整页翻译分段参数
    batch: {
      // 单次请求最大字符数（Google 端点安全上限约 2000）
      maxCharsPerBatch: 1800,
      // 段落内容小于该字符数视为短文本
      shortTextMin: 30,
    },

    // 动态补翻（MutationObserver 增量补翻）
    dynamic: {
      // 是否启用动态补翻（翻译状态下滚动/异步加载的新内容自动补翻）
      enabled: true,
      // 每个翻译根"观望"稳定时长（ms）：内容持续变化则等稳定后再翻
      stableWindowMs: 400,
      // 稳定后再等一个节流窗口（ms），进一步合并连发的变更
      debounceMs: 300,
      // 单根最大重复翻译次数（防循环；0=不限制）
      repeatTranslateMax: 2,
    },

    // 缓存
    cacheTTLMs: 7 * 24 * 3600 * 1000, // 7 天
    cacheMaxEntries: 50000,

    // 每站点记忆
    perSite: {}, // { host: { enabled: bool } }

    // 划词翻译
    selection: {
      enabled: true,
    },

    // UI
    excludeSelectors: [
      "script",
      "style",
      "noscript",
      "iframe",
      "svg",
      "canvas",
      "video",
      "audio",
      "code",
      "pre",
      "kbd",
      "textarea",
      "input",
      `[contenteditable="true"]`,
      ".transvault-trans",
      ".transvault-ui",
    ],
    // 滑块动画时长的全局样式
    cssInjectedSelector: "#transvault-style",
  };

  // 引擎目录（含展示名、tier、host 权限用途）
  const ENGINE_CATALOG = [
    {
      id: "google",
      name: "Google 网页翻译",
      tier: 1,
      cost: "free-keyless",
      needKey: false,
      desc: "免 Key、默认引擎；需翻墙访问。",
    },
    {
      id: "azure",
      name: "必应（Azure 国际区）",
      tier: 2,
      cost: "free-metered",
      needKey: true,
      desc: "微软翻译，200万字符/月免费，超额只报错不扣费。",
    },
    {
      id: "azure-china",
      name: "必应（Azure 中国区）",
      tier: 2,
      cost: "free-metered",
      needKey: true,
      desc: "中国区端点，国内直连无需翻墙。",
    },
    {
      id: "aliyun",
      name: "阿里云机器翻译",
      tier: 2,
      cost: "free-metered",
      needKey: true,
      desc: "100万字符/月免费（需实名）。",
    },
    {
      id: "baidu",
      name: "百度翻译开放平台",
      tier: 2,
      cost: "free-metered",
      needKey: true,
      desc: "标准版免费（QPS=1，个人够用）。",
    },
    {
      id: "tencent",
      name: "腾讯云机器翻译",
      tier: 2,
      cost: "free-metered",
      needKey: true,
      desc: "500万字符/月免费。",
    },
    {
      id: "lingva",
      name: "Lingva（公共实例）",
      tier: 1,
      cost: "free-keyless",
      needKey: false,
      desc: "免 Key、隐私优先；实例不稳定。",
    },
    {
      id: "libretranslate",
      name: "LibreTranslate（自托管）",
      tier: 0,
      cost: "free-local",
      needKey: false,
      desc: "本地部署、免费无限量。",
    },
    {
      id: "llm",
      name: "LLM（DeepSeek/Gemini/OpenAI）",
      tier: 3,
      cost: "paid",
      needKey: true,
      desc: "质量最高，支持多 provider 切换。",
    },
    {
      id: "baoyu",
      name: "baoyu 风格（跑在 LLM 上）",
      tier: 4,
      cost: "paid",
      needKey: true,
      desc: "借用 baoyu-translate 提示词方法论（需先配置 LLM）。",
    },
  ];

  // 全局挂载，避免 content script 各自重复定义
  if (!globalThis.TransVaultConfig) {
    globalThis.TransVaultConfig = { DEFAULTS, ENGINE_CATALOG };
  }
})();