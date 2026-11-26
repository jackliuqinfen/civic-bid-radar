import { DatabaseSync } from "node:sqlite";
import { inferNoticeBudget, inferNoticeFields } from "./custom-source-evidence.mjs";

const DB_PATH = process.env.BIDDING_DB_PATH;
if (!DB_PATH) throw new Error("Set BIDDING_DB_PATH to the target workspace.db.");
const db = new DatabaseSync(DB_PATH);

function normalizeNumSpaces(text) {
  return String(text || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/(\d)\s*\.\s*(\d)/g, "$1.$2")
    .replace(/(\d)\s*,\s*(\d)/g, "$1,$2");
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ");
}

const QUAL_EXTRACT_RULES = [
  { label: "建筑工程施工总承包", re: /(?:建筑工程|房屋建筑工程?)施工总承包(?:企业)?(?:资质)?\s*([特一二三壹贰叁]级(?:及以上|以上)?)/g },
  { label: "市政公用工程施工总承包", re: /市政公用工程施工总承包(?:企业)?(?:资质)?\s*([特一二三壹贰叁]级(?:及以上|以上)?)/g },
  { label: "建筑装修装饰工程专业承包", re: /(?:建筑)?(?:装修装饰|装饰装修)工程专业承包(?:企业)?(?:资质)?\s*([一二三壹贰叁]级(?:及以上|以上)?)/g },
  { label: "防水防腐保温工程专业承包", re: /防水防腐保温工程专业承包(?:企业)?(?:资质)?\s*([一二三壹贰叁]级(?:及以上|以上)?)/g },
  { label: "特种工程专业承包", re: /特种工程(?:[（(][^）)]{1,12}[）)])?专业承包(?:资质)?\s*(不分等级|[一二三壹贰叁]级)?/g },
  { label: "施工劳务", re: /施工劳务(?:企业)?(?:资质)?\s*(不分等级)?/g },
  { label: "电力工程施工总承包", re: /电力工程施工总承包(?:企业)?(?:资质)?\s*([特一二三壹贰叁]级(?:及以上|以上)?)/g },
  { label: "机电工程施工总承包", re: /机电工程施工总承包(?:企业)?(?:资质)?\s*([特一二三壹贰叁]级(?:及以上|以上)?)/g },
  { label: "建筑机电安装工程专业承包", re: /(?:建筑)?机电(?:设备)?安装工程专业承包(?:企业)?(?:资质)?\s*([一二三壹贰叁]级(?:及以上|以上)?)/g },
  { label: "承装修试电力设施许可", re: /承装[（(]修[、,]?试[）)]电力设施许可证\s*([一二三四五]级(?:及以上|以上)?)?/g },
  { label: "水利水电工程施工总承包", re: /水利水电工程施工总承包(?:企业)?(?:资质)?\s*([特一二三壹贰叁]级(?:及以上|以上)?)/g },
  { label: "公路工程施工总承包", re: /公路工程施工总承包(?:企业)?(?:资质)?\s*([特一二三壹贰叁]级(?:及以上|以上)?)/g },
  { label: "钢结构工程专业承包", re: /钢结构工程专业承包(?:企业)?(?:资质)?\s*([一二三壹贰叁]级(?:及以上|以上)?)/g },
  { label: "消防设施工程专业承包", re: /消防设施工程专业承包(?:企业)?(?:资质)?\s*([一二三壹贰叁]级(?:及以上|以上)?)/g },
  { label: "环保工程专业承包", re: /环保工程专业承包(?:企业)?(?:资质)?\s*([一二三壹贰叁]级(?:及以上|以上)?)/g },
  { label: "地基基础工程专业承包", re: /地基基础工程专业承包(?:企业)?(?:资质)?\s*([一二三壹贰叁]级(?:及以上|以上)?)/g },
  { label: "城市及道路照明工程专业承包", re: /城市及道路照明工程专业承包(?:企业)?(?:资质)?\s*([一二三壹贰叁]级(?:及以上|以上)?)/g },
  { label: "电子与智能化工程专业承包", re: /电子与智能化工程专业承包(?:企业)?(?:资质)?\s*([一二三壹贰叁]级(?:及以上|以上)?)/g },
  { label: "建筑幕墙工程专业承包", re: /(?:建筑)?幕墙工程专业承包(?:企业)?(?:资质)?\s*([一二三壹贰叁]级(?:及以上|以上)?)/g },
  { label: "古建筑工程专业承包", re: /古建筑工程专业承包(?:企业)?(?:资质)?\s*([一二三壹贰叁]级(?:及以上|以上)?)/g },
  { label: "工程监理", re: /(?:房屋建筑|市政公用|水利水电|公路|电力|综合)工程监理(?:资质)?\s*([甲乙丙]级(?:及以上|以上)?|综合资质)/g },
  { label: "工程设计", re: /(?:建筑行业|市政行业|水利行业|公路行业|电力行业|工程设计)[^。；，,]{0,14}([甲乙丙]级(?:及以上|以上)?|综合资质)/g },
];

function normGradeToken(g) {
  if (!g) return "";
  return g.replace(/壹/g, "一").replace(/贰/g, "二").replace(/叁/g, "三").replace(/及以上|以上/g, "");
}

function extractQualificationsFromText(raw) {
  const text = normalizeNumSpaces(raw)
    .replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, "$1$2")
    .replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, "$1$2");
  const found = [];
  const seen = new Set();
  for (const rule of QUAL_EXTRACT_RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(text))) {
      const g = normGradeToken(m[1] || "");
      const tag = g ? `${rule.label}${g}` : rule.label;
      if (!seen.has(tag)) {
        seen.add(tag);
        found.push(tag);
      }
    }
  }
  if (/安全生产许可证/.test(text) && !seen.has("安全生产许可证")) {
    found.push("安全生产许可证");
  }
  return found;
}

const rows = db.prepare(`
  SELECT m.id, m.stage, m.budget_yuan, m.budget_text, CAST(m.deadline_ns AS TEXT) AS deadline_ns, m.deadline_text, m.qual_tags, n.data,
         c.html AS cached_html
  FROM notice_meta m
  JOIN notice n ON n.id = m.id
  LEFT JOIN notice_html_cache c ON c.notice_id = m.id
  WHERE m.stage = 'tender' OR m.budget_yuan IS NULL OR m.budget_yuan = 0 OR m.deadline_ns = 0
`).all();

let fixedBudget = 0;
let fixedDl = 0;
let fixedQual = 0;
const updB = db.prepare("UPDATE notice_meta SET budget_yuan=?, budget_text=? WHERE id=?");
const updD = db.prepare("UPDATE notice_meta SET deadline_ns=CAST(? AS INTEGER), deadline_text=? WHERE id=?");
const updQ = db.prepare("UPDATE notice_meta SET qual_tags=? WHERE id=?");

db.exec("BEGIN");
try {
  for (const r of rows) {
    let body = "";
    let description = "";
    let canReadCache = true;
    try {
      const j = JSON.parse(r.data);
      canReadCache = !j.evidence;
      if (canReadCache || j.evidence.bodyStatus === "captured") {
        body = j.body || j.content || "";
      }
      description = j.title || "";
    } catch {
      body = "";
    }
    if (canReadCache && r.cached_html) body += "\n" + stripHtml(r.cached_html);

    if (!r.budget_yuan || Number(r.budget_yuan) === 0) {
      const b = inferNoticeBudget(body);
      if (b) {
        updB.run(b.yuan, b.text, r.id);
        fixedBudget++;
      }
    }
    if (!r.deadline_ns || r.deadline_ns === "0") {
      const dl = inferNoticeFields(description, body, r.stage);
      if (dl.deadline !== "0") {
        updD.run(dl.deadline, dl.deadlineText, r.id);
        fixedDl++;
      }
    }
    if (r.stage === "tender") {
      const extracted = extractQualificationsFromText(description + " " + body);
      if (extracted.length) {
        const prev = String(r.qual_tags || "").split(/[,，]/).map((x) => x.trim()).filter(Boolean);
        const merged = [...new Set([...extracted, ...prev])].join(",");
        if (merged !== (r.qual_tags || "")) {
          updQ.run(merged, r.id);
          fixedQual++;
        }
      }
    }
  }
  db.exec("COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  throw e;
}

const after = db.prepare("SELECT count(*) total, sum(CASE WHEN qual_tags LIKE '%承包%' OR qual_tags LIKE '%总承包%' OR qual_tags LIKE '%专业承包%' OR qual_tags LIKE '%监理%' OR qual_tags LIKE '%设计%' THEN 1 ELSE 0 END) has_explicit_qual FROM notice_meta WHERE stage='tender'").get();
console.log("ENRICH_DONE:", { scanned: rows.length, fixedBudget, fixedDl, fixedQual, afterTender: after });
