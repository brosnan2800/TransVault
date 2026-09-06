// 百度翻译开放平台（appid + key，标准版/高级版）
// background (MV3 service worker, ES module)

import { Provider, retry, mapWithConcurrency, chunkByChar, splitChunk } from "./provider.js";

function md5(str) {
  // 使用 Web Crypto 计算 MD5（MV3 service worker 可用）
  // 注意：crypto.subtle 不支持 MD5，这里用纯 JS 实现
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  function rotl(x, n) {
    return ((x << n) | (x >>> (32 - n))) >>> 0;
  }

  function toHex(bytes) {
    let s = "";
    for (const b of bytes) s += b.toString(16).padStart(2, "0");
    return s;
  }

  // 将字符串按 UTF-8 编码为字节数组
  const enc = new TextEncoder();
  const bytes = enc.encode(str);

  // 填充：先补 0x80，再补 0 直到 length ≡ 56 (mod 64)，最后 8 字节为原始长度（bit）
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 8) >> 6 << 6) + 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000), false);
  dv.setUint32(padded.length - 4, bitLen >>> 0, false);

  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476;

  for (let i = 0; i < padded.length; i += 64) {
    const w = new Array(80);
    for (let j = 0; j < 16; j++) {
      w[j] = dv.getUint32(i + j * 4, false);
    }
    for (let j = 16; j < 80; j++) {
      const a = w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16];
      w[j] = rotl(a, 1);
    }

    let a = h0, b = h1, c = h2, d = h3;
    for (let j = 0; j < 80; j++) {
      let f, k;
      if (j < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (j < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (j < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const temp = (rotl(a, 5) + f + k + w[j] + K[j]) >>> 0;
      d = c; c = b; b = a; a = temp;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
  }

  const out = new Uint8Array(16);
  const outDv = new DataView(out.buffer);
  outDv.setUint32(0, h0, false);
  outDv.setUint32(4, h1, false);
  outDv.setUint32(8, h2, false);
  outDv.setUint32(12, h3, false);
  return toHex(out);
}

export class BaiduProvider extends Provider {
  constructor() {
    super("baidu", 1, "api-key", { batch: true, context: false });
    this.CONCURRENCY = 4;
    this.BATCH_MAX = 1800; // 百度单请求 q 上限约 2000 字符
  }

  async available() {
    const appid = this.config && this.config.appid;
    const key = this.config && this.config.key;
    return !!(appid && key);
  }

  async translate(req) {
    const texts = req.texts || [];
    if (!texts.length) return { translations: [], used: this.id, ok: true };

    const appid = this.config && this.config.appid;
    const key = this.config && this.config.key;
    if (!appid || !key) throw new Error("baidu: appid/key not configured");

    const src = req.source && req.source !== "auto" ? req.source : "auto";
    const tgt = (req.target || "zh-CN").split("-")[0];

    const out = new Array(texts.length).fill("");

    // ---- 1. 真批量：q 用 \n 合并（trans_result 数组一一对应）----
    const { chunks, counts } = chunkByChar(texts, this.BATCH_MAX, "\n");
    let batchFailed = false;
    let offset = 0;
    for (let c = 0; c < chunks.length && !batchFailed; c++) {
      const chunk = chunks[c];
      const n = counts[c];
      try {
        const translated = await retry(() => this._translateBatch(chunk, src, tgt, appid, key), 3, 1000);
        const lines = splitChunk(translated.join("\n"), n, "\n");
        if (lines) {
          for (let k = 0; k < n; k++) out[offset + k] = lines[k];
        } else {
          batchFailed = true;
        }
      } catch {
        batchFailed = true;
      }
      offset += n;
    }

    // ---- 2. 未命中批量的段，逐段并发 ----
    const parallelIdx = [];
    const parallelTexts = [];
    for (let i = 0; i < texts.length; i++) {
      if (!out[i]) {
        parallelIdx.push(i);
        parallelTexts.push(texts[i]);
      }
    }
    if (parallelTexts.length) {
      const results = await mapWithConcurrency(parallelTexts, this.CONCURRENCY, async (text) => {
        return await retry(() => this._translateOne(text, src, tgt, appid, key), 3, 1000);
      });
      for (let i = 0; i < results.length; i++) out[parallelIdx[i]] = results[i];
    }

    return { translations: out, used: this.id, ok: true };
  }

  _sign(appid, q, salt, key) {
    return md5(`${appid}${q}${salt}${key}`);
  }

  async _post(q, from, to, appid, key) {
    const salt = Date.now() + Math.floor(Math.random() * 100).toString();
    const sign = this._sign(appid, q, salt, key);
    const body = new URLSearchParams({ q, from, to, appid, salt, sign });
    const res = await this._fetchWithTimeout(
      "https://fanyi-api.baidu.com/api/trans/vip/translate",
      { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() },
      20000
    );
    if (!res.ok) throw new Error(`baidu http ${res.status}`);
    const data = await res.json();
    if (data.error_code) throw new Error(`baidu error ${data.error_code}: ${data.error_msg || ""}`);
    return data;
  }

  async _translateBatch(q, from, to, appid, key) {
    const data = await this._post(q, from, to, appid, key);
    if (!Array.isArray(data.trans_result)) throw new Error("baidu bad batch response");
    // trans_result 每项 { src, dst }
    return data.trans_result.map((r) => r.dst);
  }

  async _translateOne(text, from, to, appid, key) {
    const data = await this._post(text, from, to, appid, key);
    if (!Array.isArray(data.trans_result) || !data.trans_result[0]) throw new Error("baidu bad response");
    return data.trans_result[0].dst;
  }
}