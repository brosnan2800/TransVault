// 腾讯云机器翻译（TC3-HMAC-SHA256 签名）
// background (MV3 service worker, ES module)
// 提速：批量接口 TextTranslateBatch（≤25 条/次），超量并发分块。

import { Provider, retry, mapWithConcurrency } from "./provider.js";

function sha256Hex(str) {
  const enc = new TextEncoder();
  return crypto.subtle.digest("SHA-256", enc.encode(str)).then((buf) => {
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  });
}

async function hmacSha256(key, message) {
  const enc = new TextEncoder();
  const keyBuf = await crypto.subtle.importKey(
    "raw",
    typeof key === "string" ? enc.encode(key) : key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", keyBuf, enc.encode(message));
  return new Uint8Array(sig);
}

function bufToHex(buf) {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export class TencentProvider extends Provider {
  constructor() {
    super("tencent", 1, "api-key", { batch: false, context: false });
  }

  async available() {
    const sid = this.config && this.config.secretId;
    const sk = this.config && this.config.secretKey;
    return !!(sid && sk);
  }

  async translate(req) {
    const texts = req.texts || [];
    if (!texts.length) return { translations: [], used: this.id, ok: true };

    const sid = this.config && this.config.secretId;
    const sk = this.config && this.config.secretKey;
    if (!sid || !sk) throw new Error("tencent: secretId/secretKey not configured");

    const region = (this.config && this.config.region) || "ap-guangzhou";
    const src = req.source && req.source !== "auto" ? req.source : "auto";
    const tgt = (req.target || "zh-CN").split("-")[0];

    // 批量接口 SourceTextList ≤25 条/次
    const BATCH_SIZE = 25;
    const out = new Array(texts.length).fill("");

    // 分块：每块 ≤25 段
    const batches = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      batches.push(i);
    }

    // 每块一次 TextTranslateBatch
    const batchResults = await mapWithConcurrency(batches, 3, async (start) => {
      const slice = texts.slice(start, start + BATCH_SIZE);
      return await retry(() => this._translateBatch(slice, src, tgt, sid, sk, region), 3, 1000);
    });

    for (let b = 0; b < batches.length; b++) {
      const start = batches[b];
      const results = batchResults[b];
      if (Array.isArray(results)) {
        for (let k = 0; k < results.length; k++) out[start + k] = results[k];
      }
    }

    // 回退：批量失败的段，逐段并发
    const parallelIdx = [];
    const parallelTexts = [];
    for (let i = 0; i < texts.length; i++) {
      if (!out[i]) {
        parallelIdx.push(i);
        parallelTexts.push(texts[i]);
      }
    }
    if (parallelTexts.length) {
      const results = await mapWithConcurrency(parallelTexts, 4, async (text) => {
        return await retry(() => this._translateOne(text, src, tgt, sid, sk, region), 3, 1000);
      });
      for (let i = 0; i < results.length; i++) out[parallelIdx[i]] = results[i];
    }

    return { translations: out, used: this.id, ok: true };
  }

  /** 通用签名请求 */
  async _request(secretId, secretKey, region, action, payloadObj) {
    const service = "tmt";
    const host = "tmt.tencentcloudapi.com";
    const version = "2018-03-21";
    const algorithm = "TC3-HMAC-SHA256";

    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const timestamp = Math.floor(now.getTime() / 1000);

    const payload = JSON.stringify(payloadObj);

    const hashedPayload = await sha256Hex(payload);
    const canonicalRequest = [
      "POST",
      "/",
      "",
      `content-type:application/json; charset=utf-8\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`,
      "content-type;host;x-tc-action",
      hashedPayload,
    ].join("\n");

    const credentialScope = `${date}/${service}/tc3_request`;
    const hashedCanonicalRequest = await sha256Hex(canonicalRequest);
    const stringToSign = `${algorithm}\n${timestamp}\n${credentialScope}\n${hashedCanonicalRequest}`;

    const secretDate = await hmacSha256(`TC3${secretKey}`, date);
    const secretService = await hmacSha256(secretDate, service);
    const secretSigning = await hmacSha256(secretService, "tc3_request");
    const signature = bufToHex(await hmacSha256(secretSigning, stringToSign));

    const authorization = [
      `${algorithm} Credential=${secretId}/${credentialScope}`,
      `SignedHeaders=content-type;host;x-tc-action`,
      `Signature=${signature}`,
    ].join(", ");

    const res = await this._fetchWithTimeout(
      `https://${host}/`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Host: host,
          "X-TC-Action": action,
          "X-TC-Version": version,
          "X-TC-Timestamp": String(timestamp),
          "X-TC-Region": region,
          Authorization: authorization,
        },
        body: payload,
      },
      20000
    );
    if (!res.ok) throw new Error(`tencent http ${res.status}`);
    const data = await res.json();
    const resp = data.Response || {};
    if (resp.Error) throw new Error(`tencent error: ${resp.Error.Message || ""}`);
    return resp;
  }

  async _translateBatch(texts, src, tgt, secretId, secretKey, region) {
    const resp = await this._request(secretId, secretKey, region, "TextTranslateBatch", {
      SourceTextList: texts,
      Source: src,
      Target: tgt,
      ProjectId: 0,
    });
    const list = resp.TargetTextList || resp.TargetText || [];
    if (typeof list === "string") return [list];
    if (!Array.isArray(list) || list.length < texts.length) throw new Error("tencent bad batch response");
    return list;
  }

  async _translateOne(text, src, tgt, secretId, secretKey, region) {
    const resp = await this._request(secretId, secretKey, region, "TextTranslate", {
      SourceText: text,
      Source: src,
      Target: tgt,
      ProjectId: 0,
    });
    const translated = resp.TargetText;
    if (typeof translated !== "string") throw new Error("tencent bad response");
    return translated;
  }
}