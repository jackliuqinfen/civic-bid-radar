import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const pageLimit = 24;
const textLimit = 100000;

export async function readAttachmentBytes(response) {
  const limit = 25 * 1024 * 1024;
  if (!response.ok || Number(response.headers.get("content-length") || 0) > limit) {
    await response.body?.cancel();
    throw new Error("附件下载失败或超出大小限制");
  }
  let size=0;
  const chunks=[];
  for await (const chunk of response.body) {
    size+=chunk.length;
    if (size>limit) throw new Error("附件超出大小限制");
    chunks.push(chunk);
  }
  if (!size) throw new Error("附件为空");
  return Buffer.concat(chunks,size);
}

export function ensureAttachmentEvidence(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notice_attachment_retry(
      notice_id TEXT NOT NULL, att_idx INTEGER NOT NULL, source_url TEXT NOT NULL,
      retry_at TEXT NOT NULL,last_error TEXT NOT NULL, PRIMARY KEY(notice_id,att_idx)
    );
    CREATE TABLE IF NOT EXISTS notice_attachment_document (
      notice_id TEXT NOT NULL, att_idx INTEGER NOT NULL, sha256 TEXT NOT NULL,
      filename TEXT NOT NULL, source_url TEXT NOT NULL, status TEXT NOT NULL,
      total_pages INTEGER, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(notice_id, att_idx)
    );
    CREATE TABLE IF NOT EXISTS notice_attachment_version (
      notice_id TEXT NOT NULL, att_idx INTEGER NOT NULL, sha256 TEXT NOT NULL,
      filename TEXT NOT NULL, source_url TEXT NOT NULL, status TEXT NOT NULL,
      total_pages INTEGER, captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(notice_id, att_idx, sha256)
    );
    CREATE TABLE IF NOT EXISTS notice_attachment_event (
      seq INTEGER PRIMARY KEY,notice_id TEXT NOT NULL,att_idx INTEGER NOT NULL,sha256 TEXT NOT NULL,
      filename TEXT NOT NULL,source_url TEXT NOT NULL,status TEXT NOT NULL,total_pages INTEGER,
      cos_key TEXT NOT NULL,captured_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%d %H:%M:%f','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_attachment_event ON notice_attachment_event(notice_id,att_idx,seq);
    CREATE TABLE IF NOT EXISTS notice_attachment_page (
      notice_id TEXT NOT NULL, att_idx INTEGER NOT NULL, sha256 TEXT NOT NULL,
      page_no INTEGER NOT NULL, body TEXT NOT NULL, method TEXT NOT NULL, status TEXT NOT NULL,
      PRIMARY KEY(notice_id, att_idx, sha256, page_no)
    );
  `);
}

async function output(command, args, timeout) {
  const { stdout } = await exec(command, args, { timeout, maxBuffer: 2 * 1024 * 1024, encoding: "utf8", env: { ...process.env, LC_ALL: "C", OMP_THREAD_LIMIT: "1" } });
  return stdout.trim();
}

async function readPages(bytes, mime) {
  const pdf = bytes.subarray(0, 5).equals(Buffer.from("%PDF-"));
  const image = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || bytes.subarray(0,3).equals(Buffer.from([255,216,255]));
  const docx = /wordprocessingml\.document/i.test(mime) && bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50;
  if (!pdf && !image && !docx) {
    if (/^text\/plain\b/i.test(mime)) {
      try {
        const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
        if (body && !body.includes("\u0000")) return { status: body.length > textLimit ? "partial" : "text", total: 1, pages: [{ number: 0, method: "plain", status: "text", body: body.slice(0,textLimit) }] };
      } catch {}
      return { status: "decode_failed", pages: [], total: null };
    }
    return { status: "unsupported", pages: [], total: null };
  }
  const dir = await mkdtemp(join(tmpdir(), "radar-att-"));
  const input = join(dir, pdf ? "document.pdf" : "scan");
  const pages = [];
  try {
    await writeFile(input, bytes, { mode: 0o600 });
    if (docx) {
      const script = fileURLToPath(new URL("./attachment-docx.py",import.meta.url));
      const { body, complex } = JSON.parse(await output("python3",[script,input],5000));
      return { total:null, status:complex || body.length > textLimit ? "partial" : body ? "text" : "unreadable",
        pages:body ? [{ number:0, body:body.slice(0,textLimit), method:"docx", status:body.length > textLimit ? "partial":"text" }] : [] };
    }
    const total = pdf ? Number((await output("pdfinfo", [input], 5000)).match(/^Pages:\s+(\d+)/m)?.[1]) : 1;
    if (!Number.isSafeInteger(total) || total < 1) throw new Error("page count");
    const rasterPages = new Set();
    let imagesKnown = true;
    if (pdf) {
      try {
        const info = await output("pdfimages",["-f","1","-l",String(pageLimit),"-list",input],5000);
        for (const line of info.split("\n")) {
          const match=line.match(/^\s*(\d+)\s+\d+\s+image\s+(\d+)\s+(\d+)/);
          if (match && Number(match[2])*Number(match[3])>=160000) rasterPages.add(Number(match[1]));
        }
      } catch { imagesKnown=false; }
    }
    const until = Date.now() + 30000;
    for (let number = 1; number <= Math.min(total,pageLimit) && Date.now() < until; number++) {
      let body = "";
      let method = pdf ? "pdftotext" : "ocr";
      let status = "failed";
      try {
        if (pdf) body = await output("pdftotext", ["-f", String(number), "-l", String(number), "-layout", input, "-"], 4000);
        if (body && !body.includes("\uFFFD")) status = (!imagesKnown || rasterPages.has(number)) ? "partial" : "text";
        else {
          method = "ocr";
          let scan = input;
          if (pdf) {
            const prefix = join(dir,"raster");
            await output("pdftoppm",["-f",String(number),"-l",String(number),"-scale-to","1600","-singlefile","-png",input,prefix],5000);
            scan = prefix + ".png";
          }
          body = await output("tesseract",[scan,"stdout","-l","chi_sim+eng","--psm","6"],8000);
          status = body ? "ocr_review" : "unreadable";
        }
      } catch { status = "failed"; }
      if (body.length > textLimit) status = "partial";
      pages.push({ number, body: body.slice(0,textLimit), method, status });
    }
    const status = pages.length === total && pages.every(p=>p.status === "text") ? "text"
      : pages.length === total && pages.every(p=>p.status === "text" || p.status === "ocr_review") ? "ocr_review" : "partial";
    return { status, total, pages };
  } catch { return { status: "failed", total: null, pages }; }
  finally { await rm(dir, { recursive: true, force: true }); }
}

export async function indexAttachment(db, { noticeId, index, filename, url, bytes, mime }) {
  const sha = createHash("sha256").update(bytes).digest("hex");
  const previous = db.prepare("SELECT * FROM notice_attachment_document WHERE notice_id=? AND att_idx=?").get(noticeId,index);
  if (previous?.sha256 === sha && previous.source_url === url && ["text","ocr_review","unsupported"].includes(previous.status)) return previous.status;
  const { status, total, pages } = await readPages(bytes,mime);
  db.exec("SAVEPOINT attachment_evidence");
  try {
    const key = [noticeId,index,sha];
    db.prepare("DELETE FROM notice_attachment_page WHERE notice_id=? AND att_idx=? AND sha256=?").run(...key);
    const page = db.prepare("INSERT INTO notice_attachment_page VALUES(?,?,?,?,?,?,?)");
    for (const p of pages) page.run(...key,p.number,p.body,p.method,p.status);
    const args = [...key,filename,url,status,total];
    db.prepare("INSERT OR IGNORE INTO notice_attachment_version(notice_id,att_idx,sha256,filename,source_url,status,total_pages) VALUES(?,?,?,?,?,?,?)").run(...args);
    const cache = db.prepare("SELECT sha256, source_url, cos_key FROM notice_attachment_cache WHERE notice_id=? AND att_idx=?").get(noticeId,index);
    if (!cache || (cache.sha256 === sha && cache.source_url === url)) {
      if (!previous || previous.sha256 !== sha || previous.source_url !== url || previous.status !== status)
        db.prepare("INSERT INTO notice_attachment_event(notice_id,att_idx,sha256,filename,source_url,status,total_pages,cos_key) VALUES(?,?,?,?,?,?,?,?)").run(...args,cache?.cos_key || "");
      db.prepare("INSERT OR REPLACE INTO notice_attachment_document(notice_id,att_idx,sha256,filename,source_url,status,total_pages) VALUES(?,?,?,?,?,?,?)").run(...args);
    }
    db.exec("RELEASE attachment_evidence");
    return status;
  } catch (e) { db.exec("ROLLBACK TO attachment_evidence; RELEASE attachment_evidence"); throw e; }
}
