import { createHash, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evidenceSchema, inferNoticeFields, inferRegion, inferStage, saveCoverage, saveObservation } from "./custom-source-evidence.mjs";

const DB_PATH = process.env.BIDDING_DB_PATH;
const catalog = JSON.parse(readFileSync(new URL("./yancheng-public-sources.json", import.meta.url), "utf8"));
const configuredProfiles = new Map([
  ...Object.entries(catalog.profiles),
  ...catalog.sources.map((source) => [source.key, source]),
]);

function isPrivateOrForbiddenHost(hostname) {
  const h = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!h || h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (/^127\.|^10\.|^0\.|^169\.254\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return true;
  return false;
}

export function validateSourceUrl(rawUrl) {
  let u;
  try {
    u = new URL(String(rawUrl || "").trim());
  } catch {
    throw new Error("请输入有效的 http:// 或 https:// 网址。");
  }
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("仅支持 http:// 或 https:// 协议的公开网址。");
  if (isPrivateOrForbiddenHost(u.hostname)) throw new Error("安全拦截：禁止采集内网或本机地址。");
  return u.href;
}

function sha12(s) {
  return createHash("sha256").update(String(s || "")).digest("hex").slice(0, 12);
}

function customNoticeId(s) {
  const hex = createHash("sha256").update(String(s || "")).digest("hex").slice(0, 8);
  return String(8000000000 + (parseInt(hex, 16) % 999999999));
}

function allocateNoticeId(db, sourceKey, url) {
  const present = db.prepare("SELECT id FROM notice_meta WHERE source_key=? AND url=? ORDER BY id LIMIT 1").get(sourceKey, url);
  if (present) return present.id;
  const occupied = db.prepare("SELECT 1 FROM notice WHERE id=? UNION ALL SELECT 1 FROM notice_meta WHERE id=? LIMIT 1");
  const seed = `${sourceKey}|${url}`;
  for (let attempt = 0; attempt < 128; attempt++) {
    const candidate = customNoticeId(attempt ? `${seed}|${attempt}` : seed);
    if (!occupied.get(candidate, candidate)) return candidate;
  }
  throw new Error("公告编号分配失败");
}

function parseDateNs(dateStr) {
  const m = String(dateStr || "").match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (!m) return 0n;
  const date = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  const day = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== date) return 0n;
  return BigInt(Date.parse(`${date}T00:00:00+08:00`)) * 1_000_000n;
}

/**
 * Fetches & extracts tender links from an arbitrary public tender listing URL
 * using Python requests + BeautifulSoup
 * for robust GBK/UTF-8 detection, legacy SSL handling, and clean DOM parsing.
 */
const runFile = promisify(execFile);
const parser = fileURLToPath(new URL("./public-source.py", import.meta.url));
const python = process.env.BIDDING_SOURCE_PYTHON || "python3";

export function collectorFailure(raw, reason = "") {
  const detail = String(raw || "");
  const cases = [
    ["restricted", /403|401|429|访问受限|验证页面|限流|restricted|captcha/i, "来源网站限制自动访问"],
    ["timeout", /timed?\s*out|ETIMEDOUT|timeout|响应超时/i, "来源网站响应超时"],
    ["dns", /NameResolution|resolve|name resolution|域名解析|^dns$/i, "暂时无法解析来源域名"],
    ["tls", /SSL|certificate|安全连接/i, "无法验证来源网站的安全连接"],
    ["network", /ConnectionError|Connection refused|无法连接/i, "暂时无法连接来源网站"],
    ["parser", /SelectorSyntaxError|暂时无法识别公告列表|解析规则|JSONDecodeError/i, "暂时无法识别公告格式"],
    ["address", /目标地址非公开网络|安全拦截/i, "仅支持公开网站"],
  ];
  for (const [code, pattern, message] of cases) {
    if (detail === message || reason === code || pattern.test(detail) || pattern.test(reason)) return { code, message };
  }
  return { code: "other", message: "本轮采集未完成" };
}

export function effectiveSourceUrl(row) {
  if (row.key === "usr_yc_binhai" && row.list_url === "https://www.binhai.gov.cn/col/col11038/index.html") {
    return "https://www.binhai.gov.cn/col/col45524/index.html";
  }
  return row.list_url;
}

async function readPublicPage(url, selector, keywords, mode, profile = {}) {
  const safeUrl = validateSourceUrl(url);
  try {
    const { stdout } = await runFile(python, [parser, safeUrl, selector, keywords, mode, JSON.stringify(profile)], {
      timeout: 24000, maxBuffer: 8 * 1024 * 1024, encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    return stdout;
  } catch (err) {
    const failure = collectorFailure(err.killed ? "timeout" : err.stderr || err.code);
    throw Object.assign(new Error(failure.message), { reason: failure.code });
  }
}

export async function probeAndExtractUrl(url, {linkSelector = "", keywordFilter = "", profile = {}} = {}) {
  return JSON.parse(await readPublicPage(url, linkSelector, keywordFilter, "list", profile));
}

function dateBefore(date, days) {
  const clock = new Date(`${date}T00:00:00Z`);
  clock.setUTCDate(clock.getUTCDate() - days);
  return clock.toISOString().slice(0, 10);
}

async function readListing(source, profile, previous, backfillDays, readPage) {
  const head = effectiveSourceUrl(source);
  const selector = source.link_selector || "";
  const keywords = source.keyword_filter || "";
  const visited = new Set();
  const pagesRead = new Set();
  const discovered = new Set();
  const items = new Map();
  let url = head;
  let next = "";
  let complete = false;
  let error;
  let reason;
  const configured = configuredProfiles.has(source.key);
  const maxPages = configured ? 4 : 1;
  const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const resume = previous?.next_url || "";
  const cutoff = backfillDays ? dateBefore(today, backfillDays)
    : resume ? previous.cutoff_date || dateBefore(today, 60)
    : previous?.watermark_date ? dateBefore(previous.watermark_date, 7) : dateBefore(today, 60);
  let oldest;
  let newest;
  let anchorUrl = "";
  let anchorUrls = [];
  let bridgeFallback = "";
  for (let index = 0; index < maxPages; index++) {
    if (!url || visited.has(url)) break;
    visited.add(url);
    let page;
    try {
      page = JSON.parse(await readPage(url, selector, keywords, "list", { ...profile, collectorRun: configured }));
    } catch (err) {
      if (!pagesRead.size) throw err;
      if (bridgeFallback) {
        url = bridgeFallback;
        bridgeFallback = "";
        continue;
      }
      error = err.message;
      reason = err.reason;
      next = url;
      break;
    }
    pagesRead.add(url);
    const unvisited = page.items.filter((item) => !discovered.has(item.url));
    if (bridgeFallback) {
      const expected = new Set(JSON.parse(previous.anchor_urls_json || "[]"));
      if (!page.items.some((item) => expected.has(item.url))) {
        url = bridgeFallback;
        bridgeFallback = "";
        continue;
      }
      bridgeFallback = "";
    } else if (!unvisited.length && page.items.length && pagesRead.size > 1 && !page.terminal) {
      reason = "pagination";
      error = "翻页重复，后续公告未确认";
      next = url;
      break;
    }
    for (const item of unvisited) {
      discovered.add(item.url);
      if (index === 0 || !item.published || item.published >= cutoff) {
        items.set(item.url, { ...item, listUrl: page.effectiveUrl || url });
      }
    }
    if (page.oldestDate && (!oldest || page.oldestDate < oldest)) oldest = page.oldestDate;
    if (page.newestDate && (!newest || page.newestDate > newest)) newest = page.newestDate;
    next = page.nextUrl || "";
    if (page.items.length) {
      anchorUrl = url;
      // Sample both ends to tolerate notices shifting within a page.
      anchorUrls = [...new Set([...page.items.slice(0, 5), ...page.items.slice(-5)].map((item) => item.url))];
    }
    const notTruncated = page.totalFound === page.items.length;
    if (configured && !profile.summaryOnly && notTruncated && page.newestDate && page.newestDate < cutoff && page.items.every((item) => item.published)) {
      complete = true;
      next = "";
      break;
    }
    if (!next) {
      complete = !profile.summaryOnly && page.terminal && notTruncated;
      break;
    }
    // Recheck the first two pages, then resume the oldest outstanding page.
    url = next;
    if (index === 1 && resume && previous.anchor_url && previous.anchor_url !== next && !visited.has(previous.anchor_url)) {
      bridgeFallback = next;
      url = previous.anchor_url;
    }
  }
  const scanned = [...items.values()];
  return { items: scanned, pages: pagesRead.size, oldest, newest, next, cutoff, anchorUrl, anchorUrls,
    complete, error, reason, status: error ? "partial_error" : profile.summaryOnly ? "summary_only"
      : complete ? "complete" : next ? "window_pending" : "surface_only" };
}

async function readDetails(db, source, profile, items, readPage) {
  const pending = db.prepare(`
    SELECT m.url, o.list_url, m.title
    FROM notice_meta m LEFT JOIN custom_source_observation o ON o.source_key=m.source_key AND o.url=m.url
    WHERE m.source_key=? AND m.url<>'' AND m.original_status<>'captured'
    ORDER BY coalesce(o.detail_checked_at,''), m.published_ns DESC, m.url LIMIT 12
  `).all(source.key);
  const head = new Map(items.map((item) => [item.url, item]));
  const revisit = db.prepare(`
    SELECT url FROM custom_source_observation
    WHERE source_key=? AND body_status='captured' ORDER BY detail_checked_at, url LIMIT 5
  `).all(source.key);
  const fromBacklog = pending.filter(({url}) => !head.has(url)).map((item) => ({
    url: item.url, listUrl: item.list_url, title: item.title, published: "", fromBacklog: true,
  }));
  const checkTime = db.prepare("SELECT detail_checked_at FROM custom_source_observation WHERE source_key=? AND url=?");
  const active = items.filter((item) => !item.body).map((item) => ({
    item, lastChecked: checkTime.get(source.key, item.url)?.detail_checked_at || "",
  })).sort((left, right) => left.lastChecked.localeCompare(right.lastChecked)).map(({item}) => item);
  const recheck = revisit.map(({url}) => head.get(url)).filter(Boolean);
  const pendingActive = pending.map(({url}) => head.get(url)).filter(Boolean);
  const selected = [...new Set([...active.slice(0, 2), ...recheck.slice(0, 1), ...fromBacklog, ...pendingActive, ...active])];
  const deadline = Date.now() + 54_000;
  let checked = 0;
  let consecutiveFailures = 0;
  for (const item of selected) {
    if (checked >= 12 || Date.now() >= deadline || consecutiveFailures >= 3) break;
    if (item.body) continue;
    item.detailChecked = true;
    checked++;
    try {
      Object.assign(item, JSON.parse(await readPage(item.url, "", "", "detail-json", profile)));
      consecutiveFailures = 0;
    } catch (err) {
      item.bodyStatus = err.reason === "restricted" ? "restricted" : "error";
      item.detailError = err.message;
      consecutiveFailures++;
    }
    if (item.fromBacklog) items.push(item);
  }
}

export async function runCustomSourceById(dbPath, sourceRow, { backfillDays = 0, readPage = readPublicPage } = {}) {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout=5000;");
  let locked = false;
  const token = randomUUID();
  const nowIso = new Date().toISOString().slice(0, 19).replace("T", " ");
  const nowNs = String(BigInt(Date.now()) * 1_000_000n);
  try {
    db.exec("CREATE TABLE IF NOT EXISTS custom_source_run_lock (id TEXT PRIMARY KEY, expires INTEGER NOT NULL, token TEXT NOT NULL)");
    const acquired = db.prepare("INSERT INTO custom_source_run_lock VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET expires=excluded.expires, token=excluded.token WHERE expires < ?")
      .run(sourceRow.id, Date.now() + 10 * 60_000, token, Date.now());
    if (!acquired.changes) return { ok: false, busy: true, error: "该来源正在采集" };
    locked = true;
    evidenceSchema(db);
    const profile = configuredProfiles.get(sourceRow.key) || {};
    const previous = db.prepare("SELECT * FROM custom_source_coverage WHERE source_key=?").get(sourceRow.key);
    const res = await readListing(sourceRow, profile, previous, backfillDays, readPage);
    const items = [...res.items];
    let inserted = 0;
    let updated = 0;
    await readDetails(db, sourceRow, profile, items, readPage);
    db.exec("BEGIN IMMEDIATE");
    try {
      if (!db.prepare("SELECT 1 FROM custom_source WHERE id=? AND enabled=1").get(sourceRow.id)) {
        db.exec("ROLLBACK");
        return { ok: false, error: "来源已暂停或移除" };
      }
      const insNotice = db.prepare("INSERT OR IGNORE INTO notice(id, title, owner, draft, data) VALUES (?, ?, NULL, 0, ?)");
      const existsMeta = db.prepare(`SELECT m.title, m.original_status, m.has_attachments, json_extract(n.data,'$.body') AS body, json_extract(n.data,'$.evidence.originUrl') AS origin_url,
          json_extract(n.data,'$.evidence.bodyStatus') AS body_status,
          CASE WHEN json_type(n.data,'$.attachments')='array' THEN json_extract(n.data,'$.attachments') END AS attachments,
          m.source_updated_at, m.project_key, CAST(m.published_ns AS TEXT) AS published
        FROM notice_meta m JOIN notice n ON n.id=m.id WHERE m.id=?`);
      const hasObservation = db.prepare("SELECT 1 FROM custom_source_observation WHERE source_key=? AND url=?");
      const updateNotice = db.prepare(`UPDATE notice SET data=json_patch(data, ?), title=? WHERE id=?`);
      const insMeta = db.prepare(`
        INSERT INTO notice_meta(
          id, title, source, source_key, tenderer, agency, region, trade_type, category,
          stage, stage_label, project_key, published_ns, deadline_ns, deadline_text,
          budget_yuan, budget_text, qual_tags, eval_method, deposit_text,
          original_status, has_attachments, source_updated_at, url
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          title=excluded.title, stage=excluded.stage, stage_label=excluded.stage_label, region=excluded.region,
          tenderer=excluded.tenderer, agency=excluded.agency, project_key=excluded.project_key,
          deadline_ns=excluded.deadline_ns, deadline_text=excluded.deadline_text,
          has_attachments=excluded.has_attachments,
          url=excluded.url, source_updated_at=excluded.source_updated_at,
          published_ns=CASE WHEN excluded.published_ns>0 THEN excluded.published_ns ELSE notice_meta.published_ns END,
          original_status=excluded.original_status
      `);
      for (const it of items) {
        const nid = allocateNoticeId(db, sourceRow.key, it.url);
        const existing = existsMeta.get(nid);
        const { stage, label } = inferStage(it.title, profile.defaultStage);
        const pubNs = parseDateNs(it.published);
        const previousBody = existing?.original_status === "captured" ? existing.body : "";
        if (previousBody && !hasObservation.get(sourceRow.key, it.url)) {
          const attachments = existing.attachments ? JSON.parse(existing.attachments) : [];
          const oldItem = { url: it.url, title: existing.title, bodyStatus: "captured",
            attachments, attachmentStatus: Array.isArray(attachments) && attachments.length > 0 ? "linked" : "not_checked" };
          saveObservation(db, sourceRow, oldItem, nid, previousBody, existing.source_updated_at || nowIso, "历史采集", previousBody);
        }
        const bodyText = it.body || previousBody ||
          (["truncated", "summary_only", "error", "restricted", "unrecognized"].includes(existing?.body_status) ? existing.body : "");
        const { region, regionBasis } = inferRegion(it.title, bodyText, profile.region || sourceRow.region);
        const evidence = saveObservation(db, sourceRow, it, nid, previousBody, nowIso, regionBasis, bodyText);
        const fields = inferNoticeFields(it.title, evidence.bodyStatus === "captured" ? bodyText : "", stage);
        evidence.originUrl = it.originUrl || existing?.origin_url || "";
        evidence.deadlineStatus = fields.deadlineStatus || "unconfirmed";
        const legacyTitleKey = existing && existing.project_key === sha12(existing.title || it.title);
        const codeScope = /^JSZC-/.test(fields.projectCode) ? "JSZC" : new URL(it.url).hostname;
        const projectKey = fields.projectCode ? sha12(`编号|${codeScope}|${fields.projectCode}`)
          : (!legacyTitleKey && existing?.project_key) || sha12(`公告|${sourceRow.key}|${it.url}`);
        const data = {
          id: nid,
          title: it.title,
          source: sourceRow.name,
          sourceKey: sourceRow.key,
          url: it.url,
          publishedAt: it.published,
          published: pubNs > 0n ? String(pubNs) : existing?.published || "0",
          stage,
          stageLabel: label,
          projectKey,
          tenderer: fields.tenderer,
          agency: fields.agency,
          deadline: fields.deadline,
          deadlineText: fields.deadlineText,
          region,
          tradeType: sourceRow.trade_type || "工程建设",
          category: sourceRow.trade_type || "工程建设",
          body: bodyText || `${it.title}\n来源：${sourceRow.name}（用户自定义来源）\n原文链接：${it.url}`,
          originalStatus: evidence.bodyStatus === "captured" ? "captured" : "uncached",
          sourceUpdatedAt: nowIso,
          evidence,
        };
        if (it.detailChecked || evidence.attachmentStatus !== "not_checked") data.attachments = evidence.attachments;
        insNotice.run(nid, it.title, JSON.stringify(data));
        if (existing) {
          if (!it.published) delete data.publishedAt;
          updateNotice.run(JSON.stringify(data), it.title, nid);
        }
        insMeta.run(
          nid, it.title, sourceRow.name, sourceRow.key, fields.tenderer, fields.agency, region,
          sourceRow.trade_type || "工程建设", sourceRow.trade_type || "工程建设",
          stage, label, projectKey, pubNs, BigInt(fields.deadline), fields.deadlineText,
          null, "", "", "", "",
          data.originalStatus,
          !it.detailChecked && evidence.attachmentStatus === "not_checked"
            ? existing?.has_attachments || 0 : Number(evidence.attachments.length > 0),
          nowIso, it.url,
        );
        if (!existing) inserted += 1;
        else updated += 1;
      }
      saveCoverage(db, sourceRow.key, nowIso, res);
      db.prepare("UPDATE custom_source SET last_run_at=?, last_count=?, last_error=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(nowIso, res.items.length, res.error || "", sourceRow.id);
      db.prepare(`
        INSERT INTO source_health(key, name, enabled, checked, last_ok, failures, reason, last_error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          name=excluded.name, enabled=excluded.enabled, checked=excluded.checked,
          last_ok=CASE WHEN excluded.failures=0 THEN excluded.last_ok ELSE source_health.last_ok END,
          failures=CASE WHEN excluded.failures=0 THEN 0 ELSE source_health.failures+1 END,
          reason=excluded.reason, last_error=excluded.last_error
      `).run(sourceRow.key, sourceRow.name, sourceRow.enabled ? 1 : 0, nowNs, res.error ? "0" : nowNs,
        res.error ? 1 : 0, res.reason || "", res.error || "");
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return { ok: !res.error, error: res.error, totalFound: res.items.length, inserted, updated,
      coverage: { status: res.status, pages: res.pages, oldest: res.oldest, newest: res.newest, next: res.next, cutoff: res.cutoff } };
  } catch (err) {
    const { code, message: msg } = collectorFailure(err.message, err.reason);
    try {
      db.exec("BEGIN IMMEDIATE");
      if (!db.prepare("SELECT 1 FROM custom_source WHERE id=? AND enabled=1").get(sourceRow.id)) { db.exec("ROLLBACK"); return {ok:false,error:"来源已暂停或移除"}; }
      const coverage = db.prepare("SELECT * FROM custom_source_coverage WHERE source_key=?").get(sourceRow.key);
      saveCoverage(db, sourceRow.key, nowIso, { status: code, error: msg, next: coverage?.next_url,
        cutoff: coverage?.cutoff_date, anchorUrl: coverage?.anchor_url, anchorUrls: JSON.parse(coverage?.anchor_urls_json || "[]") });
      db.prepare("UPDATE custom_source SET last_run_at=?, last_error=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(nowIso, msg, sourceRow.id);
      db.prepare(`
        INSERT INTO source_health(key, name, enabled, checked, last_ok, failures, reason, last_error)
        VALUES (?, ?, ?, ?, '0', 1, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          checked=excluded.checked, failures=source_health.failures+1, reason=excluded.reason, last_error=excluded.last_error
      `).run(sourceRow.key, sourceRow.name, sourceRow.enabled ? 1 : 0, nowNs, code, msg);
      db.exec("COMMIT");
    } catch (writeError) { if (db.isTransaction) db.exec("ROLLBACK"); throw writeError; }
    return { ok: false, error: msg, totalFound: 0, inserted: 0, updated: 0 };
  } finally {
    if (locked) db.prepare("DELETE FROM custom_source_run_lock WHERE id=? AND token=?").run(sourceRow.id, token);
    db.close();
  }
}

export async function runAllCustomSources(dbPath = DB_PATH, { backfillDays = 0, sourceKey = "" } = {}) {
  const db = new DatabaseSync(dbPath, {readOnly: true});
  let rows = [];
  try {
    rows = db.prepare("SELECT * FROM custom_source WHERE enabled=1 AND (?='' OR key=?) ORDER BY last_run_at, id").all(sourceKey, sourceKey);
  } finally {
    db.close();
  }
  let totalInserted = 0;
  const results = [];
  const deadline = Date.now() + 25 * 60_000;
  for (const r of rows) {
    if (Date.now() > deadline) {
      results.push({ id: r.id, key: r.key, name: r.name, ok: false, deferred: true, error: "本轮时限已到，等待下一轮" });
      continue;
    }
    let res;
    try { res = await runCustomSourceById(dbPath, r, { backfillDays }); }
    catch { res = {ok:false, error:"采集结果未能保存"}; }
    totalInserted += res.inserted || 0;
    results.push({ id: r.id, key: r.key, name: r.name, ...res });
  }
  return { ok: results.every(r => r.ok || r.busy), sources: rows.length, inserted: totalInserted, results };
}

export function installYanchengPublicSources(dbPath = DB_PATH) {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA busy_timeout=5000; BEGIN IMMEDIATE");
    const insert = db.prepare(`
      INSERT INTO custom_source(id,key,name,list_url,region,trade_type,created_by)
      SELECT ?,?,?,?,?,?,'yancheng-public-catalog'
      WHERE NOT EXISTS (SELECT 1 FROM custom_source WHERE key=? OR list_url=?)
    `);
    let installed = 0;
    for (const {key, name, url, tradeType} of catalog.sources) {
      installed += insert.run(key, key, name, url, "盐城市", tradeType, key, url).changes;
    }
    db.exec("COMMIT");
    return { installed, total: catalog.sources.length };
  } finally {
    if (db.isTransaction) db.exec("ROLLBACK");
    db.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (!DB_PATH) throw new Error("Set BIDDING_DB_PATH to the target workspace.db.");
  const backfillDays = Number(process.argv.find((arg) => arg.startsWith("--backfill-days="))?.split("=")[1] || 0);
  if (!Number.isInteger(backfillDays) || backfillDays < 0 || backfillDays > 3650) throw new Error("回看天数应为 0 至 3650 的整数");
  const sourceKey = process.argv.find((arg) => arg.startsWith("--source="))?.split("=")[1] || "";
  console.log(JSON.stringify(process.argv.includes("--install-yancheng")
    ? installYanchengPublicSources()
    : await runAllCustomSources(DB_PATH, { backfillDays, sourceKey })));
}
