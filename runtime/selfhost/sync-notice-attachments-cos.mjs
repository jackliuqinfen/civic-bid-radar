import { fetchPublic } from "./public-http.mjs";
import { createHash } from "node:crypto";
import { ensureAttachmentEvidence, indexAttachment, readAttachmentBytes } from "./attachmentEvidence.mjs";
import { DatabaseSync } from "node:sqlite";
import { COS_SHARED_PREFIX, cosPutVerified, cosGetObject, getCosCredentials } from "./lib/cos.mjs";

const dbPath = process.env.BIDDING_RADAR_DB_PATH;
if (!dbPath) throw new Error("Set BIDDING_RADAR_DB_PATH to the target workspace.db.");
const maxBatch = Number(process.env.ATT_SYNC_BATCH || 12);

if (!getCosCredentials()) {
  console.error("Missing TOUBIAO_COS_SECRET_ID / TOUBIAO_COS_SECRET_KEY");
  process.exit(1);
}

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA busy_timeout=5000;");

// Ensure table exists
db.exec(`
  CREATE TABLE IF NOT EXISTS notice_attachment_cache (
    id TEXT PRIMARY KEY,
    notice_id TEXT NOT NULL REFERENCES notice(id),
    att_idx INTEGER NOT NULL,
    filename TEXT NOT NULL,
    source_url TEXT NOT NULL,
    cos_key TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'cached' CHECK(status IN ('cached','expired','failed')),
    downloaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL,
    UNIQUE(notice_id, att_idx)
  );
`);

ensureAttachmentEvidence(db);
db.exec(`CREATE TABLE IF NOT EXISTS notice_attachment_retry(
  notice_id TEXT NOT NULL, att_idx INTEGER NOT NULL, source_url TEXT NOT NULL,
  retry_at TEXT NOT NULL, last_error TEXT NOT NULL, PRIMARY KEY(notice_id,att_idx)
)`);
// Keep content-addressed versions. Expiry gates use of the cached download link.
const cleanedCount = db.prepare("UPDATE notice_attachment_cache SET status='expired' WHERE status='cached' AND expires_at <= CURRENT_TIMESTAMP").run().changes;
const candidates = db.prepare(`
  SELECT m.id, CAST(j.key AS INTEGER) AS idx, json_extract(j.value,'$.url') AS url,
    json_extract(j.value,'$.name') AS name, c.cos_key, c.mime_type, c.sha256, c.filename,
    c.status AS cache_status, c.source_url AS cached_url,
    CASE WHEN c.id IS NOT NULL AND (r.last_error IS NOT NULL OR julianday(m.source_updated_at)>julianday(c.downloaded_at) OR julianday(c.downloaded_at)<=julianday('now','-7 days'))
      THEN 1 ELSE 0 END AS revalidate
  FROM notice_meta m JOIN notice n ON n.id=m.id
  JOIN json_each(CASE WHEN json_valid(n.data) THEN n.data ELSE '{}' END,'$.attachments') j ON j.type='object'
  LEFT JOIN project_follow pf ON pf.notice_id=m.id
  LEFT JOIN notice_attachment_cache c ON c.notice_id=m.id AND c.att_idx=j.key
  LEFT JOIN notice_attachment_document d ON d.notice_id=m.id AND d.att_idx=j.key
  LEFT JOIN notice_attachment_retry r ON r.notice_id=m.id AND r.att_idx=j.key
  WHERE json_extract(j.value,'$.url') GLOB 'http*://*'
    AND (r.retry_at IS NULL OR r.retry_at <= CURRENT_TIMESTAMP OR r.source_url<>json_extract(j.value,'$.url'))
    AND (c.id IS NULL OR c.status<>'cached' OR c.source_url<>json_extract(j.value,'$.url')
         OR revalidate=1 OR d.sha256 IS NULL OR d.sha256<>c.sha256 OR d.status IN ('failed','partial','decode_failed'))
  ORDER BY revalidate, CASE WHEN pf.decision IN ('bidding','watching') THEN 0 WHEN m.stage='tender' THEN 1 ELSE 2 END,
    COALESCE(r.retry_at, ''), m.published_ns DESC, idx
  LIMIT ?
`).all(maxBatch);
const expiresAt = new Date(Date.now() + 30 * 86400 * 1000).toISOString().replace("T", " ").slice(0, 19);

const mimeMap = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".zip": "application/zip",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

let uploadedFiles = 0;
let uploadedBytes = 0;

let failures = 0;
let awaitingReview = 0;
let read = 0;
const retry = db.prepare("INSERT OR REPLACE INTO notice_attachment_retry VALUES(?,?,?,datetime('now','+6 hours'),?)");
for (const row of candidates) {
    const a = row;
    const i = row.idx;
    const attId = `natt_${row.id}_${i}`;
    try {
      if (row.cache_status === "cached" && row.cached_url === row.url && !row.revalidate) {
        const bytes = await cosGetObject(row.cos_key,row.sha256);
        const state = await indexAttachment(db,{ noticeId:row.id,index:i,filename:row.filename,url:row.url,bytes,mime:row.mime_type });
        if (["partial","failed","decode_failed"].includes(state)) retry.run(row.id,i,row.url,state);
        else db.prepare("DELETE FROM notice_attachment_retry WHERE notice_id=? AND att_idx=?").run(row.id,i);
        if (state === "text") read++; else awaitingReview++;
        continue;
      }
      const res = await fetchPublic(a.url, { signal: AbortSignal.timeout(15000), maxBytes: 25 * 1024 * 1024 });
      if (!res.ok) throw new Error("fetch_failed");
      const buf = await readAttachmentBytes(res);
      if (!buf.length || buf.length > 25 * 1024 * 1024) throw new Error("size_limit");
      const sha = createHash("sha256").update(buf).digest("hex");
      const fname = (a.name || `attachment_${i + 1}`).replace(/[^\w.\-\u4e00-\u9fa5（）()《》]/g, "_").slice(0, 100);
      const extMatch = fname.match(/\.(pdf|docx?|xlsx?|zip|rar|png|jpe?g)$/i);
      const ext = extMatch ? extMatch[0].toLowerCase() : ".bin";
      const mimeType = mimeMap[ext] || res.headers.get("content-type") || "application/octet-stream";
      const cosKey = `${COS_SHARED_PREFIX}/notice-attachments/versions/${attId}/${sha}${ext}`;

      if (row.sha256 !== sha || row.cos_key !== cosKey || row.cache_status !== "cached") {
        await cosPutVerified(cosKey, buf, mimeType, sha);
      }
      db.prepare(`
        INSERT INTO notice_attachment_cache(id,notice_id,att_idx,filename,source_url,cos_key,mime_type,size_bytes,sha256,status,downloaded_at,expires_at)
        VALUES (?,?,?,?,?,?,?,?,?,'cached',CURRENT_TIMESTAMP,?)
        ON CONFLICT(notice_id,att_idx) DO UPDATE SET
          filename=excluded.filename, source_url=excluded.source_url, cos_key=excluded.cos_key,
          mime_type=excluded.mime_type, size_bytes=excluded.size_bytes, sha256=excluded.sha256,
          status='cached', downloaded_at=CURRENT_TIMESTAMP, expires_at=excluded.expires_at
      `).run(attId, row.id, i, a.name || fname, a.url, cosKey, mimeType, buf.length, sha, expiresAt);
      const state = await indexAttachment(db,{ noticeId:row.id,index:i,filename:a.name || fname,url:a.url,bytes:buf,mime:mimeType });
      if (["partial","failed","decode_failed"].includes(state)) retry.run(row.id,i,row.url,state);
      else db.prepare("DELETE FROM notice_attachment_retry WHERE notice_id=? AND att_idx=?").run(row.id,i);
      if (state === "text") read++; else awaitingReview++;
      uploadedFiles++;
      uploadedBytes += buf.length;
    } catch {
      retry.run(row.id,i,row.url,"fetch_or_archive_failed");
      failures++;
    }
}

const activeSummary = db.prepare(`
  SELECT count(*) AS totalCached, coalesce(sum(size_bytes),0) AS totalBytes
  FROM notice_attachment_cache WHERE status='cached' AND expires_at > CURRENT_TIMESTAMP
`).get();

const backlog=db.prepare(`SELECT count(*) AS pending FROM notice_attachment_retry r JOIN notice n ON n.id=r.notice_id
 JOIN json_each(n.data,'$.attachments') j ON j.key=r.att_idx AND json_extract(j.value,'$.url')=r.source_url`).get().pending;
const unreviewed=db.prepare("SELECT count(*) AS n FROM notice_attachment_document WHERE status<>'text'").get().n;
db.close();
console.log(JSON.stringify({
  ok: failures === 0 && awaitingReview === 0 && backlog === 0,
  retryPending:backlog,
  documentsAwaitingReview:unreviewed,
  awaitingReview,
  failures,
  nativeTextRead: read,
  cleanedExpired30d: cleanedCount,
  uploadedFiles,
  uploadedBytes,
  activeCachedTotal: activeSummary.totalCached,
  activeCachedBytes: activeSummary.totalBytes,
}));
