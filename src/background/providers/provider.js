// Provider 基类与工具
// background (MV3 service worker, ES module)

/**
 * 统一翻译请求
 * @typedef {Object} TranslateRequest
 * @property {string[]} texts       待翻译文本数组
 * @property {string} source        源语言（'auto' 允许）
 * @property {string} target        目标语言（如 'zh-CN'）
 * @property {Object} [glossary]    术语表 {原文: 译文}
 * @property {string} [style]       风格（LLM 使用）
 * @property {string} [audience]    受众（LLM 使用）
 * @property {string} [mode]        baoyu 三档 quick|normal|refined
 */

/**
 * 统一翻译结果
 * @typedef {Object} TranslateResult
 * @property {string[]} translations
 * @property {string} used           实际使用的 provider id
 * @property {boolean} ok
 * @property {string} [error]
 * @property {string} [srcLang]      检测到的源语言（可选）
 */

export class Provider {
  constructor(id, tier, cost, capabilities = {}) {
    this.id = id;
    this.tier = tier;
    this.cost = cost;
    this.capabilities = Object.assign(
      { batch: false, glossary: false, context: false, stream: false },
      capabilities
    );
  }

  /** 默认可用性检查：由子类覆盖 */
  async available() {
    return true;
  }

  /** 翻译入口：由子类实现 */
  async translate(req) {
    throw new Error(`translate() not implemented in ${this.id}`);
  }

  /** 供 fetch 封装的超时工具 */
  async _fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: ctrl.signal });
      return res;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** 简易线性退避 */
export async function retry(fn, attempts = 3, baseDelayMs = 1000) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i === attempts - 1) break;
      await sleep(baseDelayMs * Math.pow(2, i));
    }
  }
  throw lastErr;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 并发执行：同时最多 limit 个任务，结果按 items 顺序返回。
 * @param {any[]} items
 * @param {number} limit 并发上限
 * @param {(item:any, index:number)=>Promise<any>} worker
 * @returns {Promise<any[]>}
 */
export async function mapWithConcurrency(items, limit, worker) {
  const n = Math.max(1, Math.min(limit || 4, items.length));
  const results = new Array(items.length);
  let nextIdx = 0;

  async function runWorker(idx) {
    results[idx] = await worker(items[idx], idx);
  }

  await Promise.all(
    Array.from({ length: n }, async () => {
      while (nextIdx < items.length) {
        const i = nextIdx++;
        await runWorker(i);
      }
    })
  );
  return results;
}

/**
 * 把短文本聚合成 ≤maxChars 的块（用 sep 连接），保持原顺序。
 * 返回：{ chunks: string[], counts: number[] }
 *   chunks  — 聚合后的文本块（每块含 sep 拼接的若干段）
 *   counts  — 每块包含的原始段数
 * 每块保证：聚合后总长 ≤ maxChars（单段超长则单独成块）。
 */
export function chunkByChar(texts, maxChars, sep = "\n") {
  const chunks = [];
  const counts = [];
  let cur = [];
  let curLen = 0;
  const sepLen = sep.length;

  for (const t of texts) {
    if (t.length >= maxChars) {
      // 超长单段：先结算当前块，再独立成块
      if (cur.length) {
        chunks.push(cur.join(sep));
        counts.push(cur.length);
        cur = [];
        curLen = 0;
      }
      chunks.push(t);
      counts.push(1);
      continue;
    }
    const need = cur.length ? sepLen + t.length : t.length;
    if (curLen + need > maxChars && cur.length) {
      chunks.push(cur.join(sep));
      counts.push(cur.length);
      cur = [];
      curLen = 0;
    }
    cur.push(t);
    curLen += need;
  }
  if (cur.length) {
    chunks.push(cur.join(sep));
    counts.push(cur.length);
  }
  return { chunks, counts };
}

/**
 * 把聚合块按分隔符拆回 n 段；拆分行数不匹配返回 null。
 * @param {string} text 聚合后的文本
 * @param {number} n 期望段数
 * @param {string} sep
 * @returns {string[]|null}
 */
export function splitChunk(text, n, sep = "\n") {
  if (typeof text !== "string") return null;
  const parts = text.split(sep);
  if (parts.length !== n) return null;
  return parts;
}