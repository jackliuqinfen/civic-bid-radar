import { createHash, createHmac } from "node:crypto";

export const COS_BUCKET = process.env.CIVIC_RADAR_COS_BUCKET || "";
export const COS_REGION = process.env.CIVIC_RADAR_COS_REGION || "";
export const COS_HOST = `${COS_BUCKET}.cos.${COS_REGION}.myqcloud.com`;
export const COS_SHARED_PREFIX = process.env.CIVIC_RADAR_COS_PREFIX || "civic-bid-radar";

export function getCosCredentials() {
  const id = (process.env.TOUBIAO_COS_SECRET_ID || "").trim();
  const key = (process.env.TOUBIAO_COS_SECRET_KEY || "").trim();
  const hasTarget = /^[a-z0-9-]+-[0-9]+$/.test(COS_BUCKET) && /^[a-z0-9-]+$/.test(COS_REGION);
  return hasTarget && id && key ? { id, key } : null;
}

function cosEncodeUriComponent(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16));
}

export function cosSign(method, keyPath, extraHeaders, creds) {
  const now = Math.floor(Date.now() / 1000);
  const keyTime = `${now - 60};${now + 600}`;
  const hmac = (k, d) => createHmac("sha1", k).update(d).digest("hex");
  const sha1 = (d) => createHash("sha1").update(d).digest("hex");
  const signKey = hmac(creds.key, keyTime);

  const hdrs = { host: COS_HOST };
  for (const [k, v] of Object.entries(extraHeaders || {})) {
    hdrs[k.toLowerCase()] = String(v);
  }
  const sortedKeys = Object.keys(hdrs).sort();
  const headerList = sortedKeys.join(";");
  const canonicalHeaders = sortedKeys.map((k) => `${cosEncodeUriComponent(k)}=${cosEncodeUriComponent(hdrs[k])}`).join("&");
  const pathname = keyPath.startsWith("/") ? keyPath : `/${keyPath}`;
  const httpString = `${method.toLowerCase()}\n${pathname}\n\n${canonicalHeaders}\n`;
  const stringToSign = `sha1\n${keyTime}\n${sha1(httpString)}\n`;
  const signature = hmac(signKey, stringToSign);
  return `q-sign-algorithm=sha1&q-ak=${creds.id}&q-sign-time=${keyTime}&q-key-time=${keyTime}&q-header-list=${headerList}&q-url-param-list=&q-signature=${signature}`;
}

export async function cosPutVerified(cosKey, buf, contentType, sha256Hex) {
  const creds = getCosCredentials();
  if (!creds) throw new Error("COS_UNCONFIGURED");
  if (!cosKey.startsWith(`${COS_SHARED_PREFIX}/`) || cosKey.includes("..")) {
    throw new Error("非法 COS 对象路径");
  }
  const md5Base64 = createHash("md5").update(buf).digest("base64");
  const signHeaders = {
    "content-md5": md5Base64,
    "x-cos-meta-sha256": sha256Hex,
    "x-cos-server-side-encryption": "AES256",
  };
  const putAuth = cosSign("PUT", cosKey, signHeaders, creds);
  const url = `https://${COS_HOST}/${cosKey}`;
  const putRes = await fetch(url, {
    method: "PUT",
    signal: AbortSignal.timeout(20000),
    headers: {
      Host: COS_HOST,
      Authorization: putAuth,
      "Content-Type": contentType,
      "Content-Length": String(buf.length),
      "Content-MD5": md5Base64,
      "x-cos-server-side-encryption": "AES256",
      "x-cos-meta-sha256": sha256Hex,
    },
    body: buf,
  });
  if (!putRes.ok) {
    throw new Error(`COS 上传失败（HTTP ${putRes.status}）`);
  }
  const putEtag = (putRes.headers.get("etag") || "").trim();

  const headAuth = cosSign("HEAD", cosKey, {}, creds);
  const headRes = await fetch(url, {
    method: "HEAD",
    signal: AbortSignal.timeout(10000),
    headers: { Host: COS_HOST, Authorization: headAuth },
  });
  if (!headRes.ok) {
    throw new Error(`COS HeadObject 校验失败（HTTP ${headRes.status}）`);
  }
  const actualLen = Number(headRes.headers.get("content-length") || "-1");
  const actualSha = (headRes.headers.get("x-cos-meta-sha256") || "").trim();
  const actualEtag = (headRes.headers.get("etag") || "").trim();
  if (actualLen !== buf.length || actualSha !== sha256Hex || (putEtag && actualEtag !== putEtag)) {
    throw new Error("COS HeadObject 元数据一致性校验失败");
  }
  return { cosKey, etag: actualEtag, bytes: buf.length, sha256: sha256Hex };
}

export async function cosGetObject(cosKey, expectedSha256) {
  const creds = getCosCredentials();
  if (!creds) throw new Error("COS_UNCONFIGURED");
  if (!cosKey.startsWith(`${COS_SHARED_PREFIX}/`) || cosKey.includes("..")) {
    throw new Error("非法 COS 对象路径");
  }
  const auth = cosSign("GET", cosKey, {}, creds);
  const res = await fetch(`https://${COS_HOST}/${cosKey}`, {
    method: "GET",
    signal: AbortSignal.timeout(20000),
    headers: { Host: COS_HOST, Authorization: auth },
  });
  if (!res.ok) {
    throw new Error(`COS 读取失败（HTTP ${res.status}）`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (expectedSha256) {
    const actual = createHash("sha256").update(buf).digest("hex");
    if (actual !== expectedSha256) throw new Error("COS 下载文件 SHA-256 校验不一致");
  }
  return buf;
}
