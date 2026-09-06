// 阿里云机器翻译（AccessKey + Secret，RPC 签名）
// background (MV3 service worker, ES module)
// 提速：并发池替换串行循环（通用版无批量接口）。

import { Provider, retry, mapWithConcurrency } from "./provider.js";

// RPC 风格 percentEncode：保留 A-Z a-z 0-9 - _ . ~，其余 URL 编码（大写）
function percentEncode(str) {
  return encodeURIComponent(str)
    .replace(/\+/g, "%20")
    .replace(/%7E/g, "~")
    .replace(/%2F/g, "/")
    .replace(/%3A/g, ":")
    .replace(/%2C/g, ",")
    .replace(/%3B/g, ";")
    .replace(/%3D/g, "=")
    .replace(/%3F/g, "?")
    .replace(/%26/g, "&")
    .replace(/%25/g, "%");
}

function iso8601(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function uuid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function hmacSha1Base64(key, message) {
  const enc = new TextEncoder();
  const keyBuf = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", keyBuf, enc.encode(message));
  const bytes = new Uint8Array(sig);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export class AliyunProvider extends Provider {
  constructor() {
    super("aliyun", 1, "api-key", { batch: false, context: false });
  }

  async available() {
    const ak = this.config && this.config.accessKeyId;
    const sk = this.config && this.config.accessKeySecret;
    return !!(ak && sk);
  }

  async translate(req) {
    const texts = req.texts || [];
    if (!texts.length) return { translations: [], used: this.id, ok: true };

    const ak = this.config && this.config.accessKeyId;
    const sk = this.config && this.config.accessKeySecret;
    if (!ak || !sk) throw new Error("aliyun: accessKey not configured");

    const src = req.source && req.source !== "auto" ? req.source : "auto";
    const tgt = (req.target || "zh-CN").split("-")[0];
    const region = (this.config && this.config.region) || "cn-hangzhou";
    const host = `mt.${region}.aliyuncs.com`;

    // 并发池（每个请求独立 retry）
    const result = await mapWithConcurrency(texts, 4, async (text) => {
      return await retry(() => this._translateOne(text, src, tgt, ak, sk, region, host), 3, 1000);
    });

    return { translations: result, used: this.id, ok: true };
  }

  async _translateOne(text, src, tgt, ak, sk, region, host) {
    const params = {
      AccessKeyId: ak,
      Action: "TranslateGeneral",
      Format: "JSON",
      RegionId: region,
      SignatureMethod: "HMAC-SHA1",
      SignatureNonce: uuid(),
      SignatureVersion: "1.0",
      Timestamp: iso8601(new Date()),
      Version: "2018-10-12",
      SourceLanguage: src,
      TargetLanguage: tgt,
      SourceText: text,
      Scene: "general",
    };

    const sortedKeys = Object.keys(params).sort();
    const canonical = sortedKeys
      .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
      .join("&");

    const stringToSign = `GET&${percentEncode("/")}&${percentEncode(canonical)}`;
    const signature = await hmacSha1Base64(`${sk}&`, stringToSign);
    params.Signature = signature;

    const qs = Object.keys(params)
      .sort()
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
      .join("&");

    const res = await this._fetchWithTimeout(
      `https://${host}/?${qs}`,
      { method: "GET" },
      20000
    );
    if (!res.ok) throw new Error(`aliyun http ${res.status}`);
    const data = await res.json();
    if (!data || data.Code) {
      throw new Error(`aliyun error: ${(data && data.Message) || "unknown"}`);
    }
    const t = data.Data && data.Data.Translated;
    if (typeof t !== "string") throw new Error("aliyun bad response");
    return t;
  }
}