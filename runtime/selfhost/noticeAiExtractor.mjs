import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function ensureNoticeAiTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notice_ai_extract (
      notice_id TEXT PRIMARY KEY REFERENCES notice(id),
      content_hash TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      extracted_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

export function normalizeNoticeTextForRead(raw) {
  return String(raw || "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(?:p|div|li|tr|h[1-6])\s*>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/\r\n/g, "\n")
    .replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, "$1$2")
    .replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, "$1$2")
    .trim();
}

export function normDateStr(y, m, d) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function extractValidUntilFromText(txt) {
  const s = String(txt || "");
  if (/营业执照/.test(s) && /长期/.test(s) && !/20\d{2}[-./年]\d{1,2}[-./月]\d{1,2}\s*$/m.test(s)) {
    // Check explicit finite range end date first
    const finiteEnd = s.match(/20\d{2}[-./年]\d{1,2}[-./月]\d{1,2}日?\s*(?:至|到|~|—)\s*(20\d{2})[-./年](\d{1,2})[-./月](\d{1,2})/);
    if (finiteEnd) return normDateStr(finiteEnd[1], finiteEnd[2], finiteEnd[3]);
    return "长期";
  }
  const m1 = s.match(/(?:有效期至|有效期限|有效期|截至日期|有效日期)[^\d]{0,16}(?:20\d{2}[-./年]\d{1,2}[-./月]\d{1,2}日?\s*(?:至|到|-|~|—)\s*)?(20\d{2})[-./年](\d{1,2})[-./月](\d{1,2})/);
  if (m1) return normDateStr(m1[1], m1[2], m1[3]);
  const mRange = s.match(/20\d{2}[-./年]\d{1,2}[-./月]\d{1,2}日?\s*(?:至|到|~|—)\s*(20\d{2})[-./年](\d{1,2})[-./月](\d{1,2})/);
  if (mRange) return normDateStr(mRange[1], mRange[2], mRange[3]);
  return "";
}

/**
 * Unified high-precision document/image/PDF OCR + optional AI structured extraction.
 * Shared across /api/ocr/extract, ZIP batch import, and AI auto-verify.
 */
export async function extractOcrAndFieldsFromBuffer({ buf, filename = "upload.pdf", mode = "doc", aiConfig = null }) {
  const ext = (filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || "").trim();
  const isPdf = buf.slice(0, 5).toString("latin1") === "%PDF-";
  const isPng = buf.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const isJpg = buf.slice(0, 2).equals(Buffer.from([0xff, 0xd8]));
  const isWebp = buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP";
  const isBmp = buf.slice(0, 2).toString("ascii") === "BM";
  const isGif = buf.slice(0, 3).toString("ascii") === "GIF";
  const isTiff = buf.slice(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) || buf.slice(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]));
  const isZip = buf.slice(0, 2).toString("ascii") === "PK";
  const isDocx = isZip && ext === "docx";
  const isXlsx = isZip && ext === "xlsx";
  const isText = ["txt", "csv", "md", "json"].includes(ext);
  const isImage = isPng || isJpg || isWebp || isBmp || isGif || isTiff;

  if (!isPdf && !isImage && !isDocx && !isXlsx && !isText) {
    throw new Error("支持 PDF、各类图片（PNG/JPG/WEBP/BMP/TIFF/GIF）及常用文档（DOCX/XLSX/TXT/CSV）。");
  }

  const workDir = await mkdtemp(join(tmpdir(), "br-ocr-"));
  let rawText = "";
  let engine = "";
  let pagesProcessed = 1;

  const runBestImageOcr = async (imgPath) => {
    const pyRapid = `import sys
from rapidocr_onnxruntime import RapidOCR
ocr = RapidOCR()
result, _ = ocr(sys.argv[1])
if result:
  items = sorted(result, key=lambda x: (round(x[0][0][1] / 18), x[0][0][0]))
  print("\\n".join(str(x[1]).strip() for x in items if len(x) >= 2 and str(x[1]).strip()))`;
    try {
      const { stdout } = await execFileAsync("python3", ["-c", pyRapid, imgPath], { timeout: 45000, maxBuffer: 6 * 1024 * 1024 });
      const txt = String(stdout || "").trim();
      if (txt) return { text: txt, engineTag: "RapidOCR-PPOCRv4(高清中文引擎)" };
    } catch {}
    const r1 = await execFileAsync("tesseract", [imgPath, "stdout", "-l", "chi_sim+eng", "--oem", "1", "--psm", "6"], { timeout: 30000, maxBuffer: 6 * 1024 * 1024 }).catch(() => ({ stdout: "" }));
    return { text: String(r1.stdout || "").trim(), engineTag: "tesseract-lstm(备用引擎)" };
  };

  try {
    if (isText) {
      rawText = buf.toString("utf8").trim();
      engine = `text-direct(${ext.toUpperCase()}文本提取)`;
    } else if (isDocx || isXlsx) {
      const docPath = join(workDir, `input.${ext}`);
      await writeFile(docPath, buf);
      const pyCode = isDocx
        ? `import sys, zipfile, xml.etree.ElementTree as ET
with zipfile.ZipFile(sys.argv[1]) as z:
  xml_data = z.read("word/document.xml")
root = ET.fromstring(xml_data)
lines = []
for p in root.iter():
  if p.tag.endswith("}p") or p.tag.endswith("}tr"):
    t = "".join(x.text for x in p.iter() if x.tag.endswith("}t") and x.text)
    if t.strip(): lines.append(t.strip())
print("\\n".join(lines))`
        : `import sys, zipfile, xml.etree.ElementTree as ET
with zipfile.ZipFile(sys.argv[1]) as z:
  ss = []
  if "xl/sharedStrings.xml" in z.namelist():
    r = ET.fromstring(z.read("xl/sharedStrings.xml"))
    for si in r.iter():
      if si.tag.endswith("}si"):
        ss.append("".join(t.text for t in si.iter() if t.tag.endswith("}t") and t.text))
  lines = []
  for name in sorted(z.namelist()):
    if name.startswith("xl/worksheets/sheet") and name.endswith(".xml"):
      r = ET.fromstring(z.read(name))
      for row in r.iter():
        if row.tag.endswith("}row"):
          vals = []
          for c in row:
            t_attr = c.attrib.get("t", "")
            v = next((x.text for x in c.iter() if x.tag.endswith("}v") and x.text), "")
            if t_attr == "s" and v.isdigit() and int(v) < len(ss): vals.append(ss[int(v)])
            elif v: vals.append(v)
          if vals: lines.append(" | ".join(vals))
print("\\n".join(lines))`;
      const { stdout } = await execFileAsync("python3", ["-c", pyCode, docPath], { timeout: 20000, maxBuffer: 6 * 1024 * 1024 });
      rawText = String(stdout || "").trim();
      engine = `office-xml(${ext.toUpperCase()}文档提取)`;
    } else if (isPdf) {
      const pdfPath = join(workDir, "input.pdf");
      await writeFile(pdfPath, buf);
      try {
        const { stdout } = await execFileAsync("pdftotext", ["-layout", "-f", "1", "-l", "8", pdfPath, "-"], { timeout: 15000, maxBuffer: 6 * 1024 * 1024 });
        rawText = String(stdout || "").trim();
        engine = "pdftotext(电子原生文字)";
      } catch {}
      const meaningfulLen = rawText.replace(/[\s\r\n\f\u0000-\u0020]/g, "").length;
      if (meaningfulLen < 30) {
        const prefix = join(workDir, "page");
        await execFileAsync("pdftoppm", ["-png", "-r", "240", "-f", "1", "-l", "6", pdfPath, prefix], { timeout: 40000 });
        const files = (await readdir(workDir)).filter((f) => f.startsWith("page-") && f.endsWith(".png")).sort();
        pagesProcessed = files.length;
        const pageTexts = [];
        let usedTag = "RapidOCR-PPOCRv4";
        for (const f of files) {
          const { text, engineTag } = await runBestImageOcr(join(workDir, f));
          if (engineTag) usedTag = engineTag;
          if (text) pageTexts.push(text);
        }
        rawText = pageTexts.join("\n\n--- 分页 ---\n\n");
        engine = `${usedTag} · ${files.length}页`;
      }
    } else {
      const imgExt = isPng ? "png" : isJpg ? "jpg" : isWebp ? "webp" : isBmp ? "bmp" : isGif ? "gif" : "tiff";
      const imgPath = join(workDir, `input.${imgExt}`);
      await writeFile(imgPath, buf);
      const { text, engineTag } = await runBestImageOcr(imgPath);
      rawText = text;
      engine = `${engineTag} (${imgExt.toUpperCase()})`;
    }
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }

  const cleaned = rawText
    .replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, "$1$2")
    .replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, "$1$2")
    .replace(/\r\n/g, "\n")
    .trim();

  const fields = {};
  if (mode === "person") {
    const nameM = cleaned.match(/(?:姓\s*名|持证人)[：:\s\n]{0,6}([\u4e00-\u9fa5]{2,4})(?=\s|$|性|民|出|身|证|注|单)/);
    const idM = cleaned.match(/(?:身份证号?|证件号码)[：:\s\n]{0,8}([1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx])/)
      || cleaned.match(/\b([1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx])\b/);
    const certNoM = cleaned.match(/(?:注册编号|证书编号|执业印章号|证号)[：:\s\n]{0,8}([A-Za-z0-9苏建安\(\)（）\[\]\-]{6,32})/);
    const majorM = cleaned.match(/(?:注册专业|专业类别|专业)[：:\s\n]{0,6}([\u4e00-\u9fa5A-Za-z、，,（）()]{2,20})/);
    let certLevel = "";
    if (/一级(?:注册)?建造师/.test(cleaned)) certLevel = "一级建造师";
    else if (/二级(?:注册)?建造师/.test(cleaned)) certLevel = "二级建造师";
    else if (/安全生产考核合格证书.*B|建安B|B类/.test(cleaned)) certLevel = "安全B证";
    else if (/安全生产考核合格证书.*C|建安C|C类/.test(cleaned)) certLevel = "专职安全员(C证)";
    else if (/造价工程师/.test(cleaned)) certLevel = "注册造价工程师";
    else if (/高级工程师/.test(cleaned)) certLevel = "高级工程师";
    else if (/中级工程师|工程师/.test(cleaned)) certLevel = "工程师";
    if (certLevel && majorM) {
      const mj = majorM[1].replace(/[；;。\s\n].*$/, "").replace(/(?:证书|注册|有效).*$/, "");
      if (mj.length >= 2) certLevel += `(${mj})`;
    }
    fields.name = nameM ? nameM[1].trim() : "";
    fields.roleTitle = /建造师/.test(certLevel) ? "项目经理" : /安全/.test(certLevel) ? "专职安全员" : /造价/.test(certLevel) ? "造价师" : "专职人员";
    fields.certLevel = certLevel;
    fields.certValidUntil = extractValidUntilFromText(cleaned);
    fields.idCard = idM ? idM[1].toUpperCase() : "";
    fields.certNo = certNoM ? certNoM[1].trim() : "";

    if (aiConfig?.apiKey && cleaned.length >= 15) {
      try {
        const aiRes = await fetch(`${aiConfig.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${aiConfig.apiKey}` },
          body: JSON.stringify({
            model: aiConfig.defaultModel,
            temperature: 0.1,
            messages: [
              { role: "system", content: "你是中国建筑业人员证书OCR结构化提取专家。请严格从给定OCR文本提取JSON，仅返回纯JSON对象不要markdown代码块，字段：{\"name\":\"姓名\",\"roleTitle\":\"项目经理|专职安全员|造价师|专职人员\",\"certLevel\":\"如一级建造师(市政公用工程)或安全B证\",\"certValidUntil\":\"YYYY-MM-DD或空\",\"idCard\":\"18位身份证号或空\",\"certNo\":\"注册编号或证书编号\"}" },
              { role: "user", content: cleaned.slice(0, 2200) },
            ],
          }),
          signal: AbortSignal.timeout(16000),
        });
        if (aiRes.ok) {
          const j = await aiRes.json();
          const content = (j?.choices?.[0]?.message?.content || "").replace(/^```json\s*|\s*```$/g, "").trim();
          const parsedAi = JSON.parse(content);
          if (parsedAi && typeof parsedAi === "object") {
            if (parsedAi.name) fields.name = String(parsedAi.name).trim();
            if (parsedAi.roleTitle) fields.roleTitle = String(parsedAi.roleTitle).trim();
            if (parsedAi.certLevel) fields.certLevel = String(parsedAi.certLevel).trim();
            if (parsedAi.certValidUntil && /^\d{4}-\d{2}-\d{2}$/.test(parsedAi.certValidUntil)) fields.certValidUntil = parsedAi.certValidUntil;
            if (parsedAi.idCard) fields.idCard = String(parsedAi.idCard).trim().toUpperCase();
            if (parsedAi.certNo) fields.certNo = String(parsedAi.certNo).trim();
            engine += " + AI结构化精修";
          }
        }
      } catch {}
    }
  } else {
    let category = "建筑业企业资质";
    let docGroup = "enterprise";
    if (/社会保险|社保权益单|参保证明|养老保险|缴费证明/.test(cleaned)) {
      category = "社保权益单";
      docGroup = "social_security";
    } else if (/安全生产许可证/.test(cleaned)) {
      category = "安全生产许可证";
    } else if (/营业执照|统一社会信用代码/.test(cleaned)) {
      category = "营业执照";
    } else if (/财务审计|审计报告|资产负债表/.test(cleaned)) {
      category = "财务审计";
      docGroup = "other";
    } else if (/施工合同|中标通知书|竣工验收/.test(cleaned)) {
      category = "业绩合同";
      docGroup = "other";
    } else if (/信用|AAA|资信/.test(cleaned)) {
      category = "信用证明";
    }

    const issuerM = cleaned.match(/(?:发证机关|颁发机关|审批机关)[：:\s]*([\u4e00-\u9fa5]{4,30}(?:厅|局|委员会|办公室|人民政府))/)
      || cleaned.match(/([\u4e00-\u9fa5]{2,16}(?:住房和城乡建设厅|住房和城乡建设局|政务服务管理办公室|行政审批局|市场监督管理局|交通运输厅|水利厅))/);
    const issuer = issuerM ? issuerM[1].trim() : "";

    let docNo = "";
    const qualNoM = cleaned.match(/\b([DA][A-Z0-9]{7,13})\b/);
    const safetyNoM = cleaned.match(/[（(]?[\u4e00-\u9fa5][）)]?JZ安许证字[\[\【〔]?\d{4}[\]\】〕]?\d{4,8}/);
    const usccM = cleaned.match(/\b(9[123]\d{6}[0-9A-Z]{10})\b/);
    const genNoM = cleaned.match(/(?:证书编号|编号|证号|核验码)[：:\s]*([A-Za-z0-9\-_（）()\[\]]{5,32})/);
    if (category === "安全生产许可证" && safetyNoM) docNo = safetyNoM[0];
    else if (category === "营业执照" && usccM) docNo = usccM[1];
    else if (qualNoM) docNo = qualNoM[1];
    else if (genNoM) docNo = genNoM[1];

    const qualRe = /([\u4e00-\u9fa5（）()]{0,20}(?:施工总承包|专业承包|施工劳务|工程设计|工程监理|工程造价|特种工程(?:[（(][\u4e00-\u9fa5]{2,10}[）)])?(?:专业承包)?)(?:[壹贰叁一二三特甲乙丙]级|不分等级))/g;
    const qualSpecs = [...new Set([...cleaned.matchAll(qualRe)].map((m) => m[1].replace(/^.*?[：:、，,\s\n]/, "").trim()).filter((s) => s.length >= 6 && s.length <= 42))];

    let docName = filename.replace(/\.[^.]+$/, "");
    if (category === "安全生产许可证") docName = "安全生产许可证";
    else if (category === "营业执照") docName = "企业法人营业执照";
    else if (category === "社保权益单") {
      const ymM = cleaned.match(/(20\d{2})[-./年](0?[1-9]|1[0-2])(?:月)?/);
      if (ymM) {
        fields.periodMonth = `${ymM[1]}-${String(ymM[2]).padStart(2, "0")}`;
        docName = `${ymM[1]}年${ymM[2]}月企业社保权益单`;
      }
    } else if (qualSpecs.length) {
      docName = qualSpecs.slice(0, 3).join(" / ");
    }

    const cntM = cleaned.match(/(?:参保人数|缴费人数|共计|合计)[：:\s]*(\d{1,5})\s*人/);
    fields.docGroup = docGroup;
    fields.category = category;
    fields.issuer = issuer;
    fields.name = docName.slice(0, 140);
    fields.docNo = docNo;
    fields.validUntil = extractValidUntilFromText(cleaned);
    fields.qualItemsText = qualSpecs.join("\n");
    fields.remark = cntM ? `OCR识别参保人数：${cntM[1]}人` : "";

    if (aiConfig?.apiKey && cleaned.length >= 20) {
      try {
        const aiRes = await fetch(`${aiConfig.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${aiConfig.apiKey}` },
          body: JSON.stringify({
            model: aiConfig.defaultModel,
            temperature: 0.1,
            messages: [
              { role: "system", content: "你是中国建筑业企业证件OCR结构化提取专家。请严格从给定OCR文本提取JSON，仅返回纯JSON对象不要markdown代码块，字段：{\"category\":\"建筑业企业资质|安全生产许可证|营业执照|社保权益单|财务审计|业绩合同|信用证明\",\"issuer\":\"发证机关\",\"docNo\":\"证书编号或统一社会信用代码\",\"validUntil\":\"YYYY-MM-DD或长期或空\",\"name\":\"证书简称(如营业执照填企业名称或企业法人营业执照)\",\"qualItems\":[\"逐条完整资质名称与等级\"]}" },
              { role: "user", content: cleaned.slice(0, 2600) },
            ],
          }),
          signal: AbortSignal.timeout(16000),
        });
        if (aiRes.ok) {
          const j = await aiRes.json();
          const content = (j?.choices?.[0]?.message?.content || "").replace(/^```json\s*|\s*```$/g, "").trim();
          const parsedAi = JSON.parse(content);
          if (parsedAi && typeof parsedAi === "object") {
            if (parsedAi.category) fields.category = String(parsedAi.category).trim();
            if (parsedAi.issuer) fields.issuer = String(parsedAi.issuer).trim();
            if (parsedAi.docNo) fields.docNo = String(parsedAi.docNo).trim();
            if (parsedAi.validUntil === "长期") fields.validUntil = "长期";
            else if (parsedAi.validUntil && /^\d{4}-\d{1,2}-\d{1,2}$/.test(parsedAi.validUntil)) {
              const [yy, mm, dd] = parsedAi.validUntil.split("-");
              fields.validUntil = normDateStr(yy, mm, dd);
            }
            if (Array.isArray(parsedAi.qualItems) && parsedAi.qualItems.length) {
              fields.qualItemsText = parsedAi.qualItems.map((x) => String(x).trim()).filter(Boolean).join("\n");
              fields.name = parsedAi.qualItems.slice(0, 3).join(" / ").slice(0, 140);
            } else if (parsedAi.name && fields.category !== "营业执照") {
              fields.name = String(parsedAi.name).trim().slice(0, 140);
            }
            if (fields.category === "营业执照") {
              fields.docGroup = "enterprise";
              if (!fields.validUntil) fields.validUntil = "长期";
            } else if (fields.category === "安全生产许可证") {
              fields.docGroup = "enterprise";
            } else if (fields.category === "社保权益单") {
              fields.docGroup = "social_security";
            } else if (fields.category === "财务审计" || fields.category === "业绩合同") {
              fields.docGroup = "other";
            }
            engine += " + AI结构化纠偏";
          }
        }
      } catch {}
    }
  }

  return { rawText: cleaned, charCount: cleaned.length, pagesProcessed, engine, fields };
}

export function hashNoticeContent({ title = "", body = "", attachmentTexts = "" }) {
  return createHash("sha256").update(`${title}\n---\n${body}\n---\n${attachmentTexts}`).digest("hex").slice(0, 32);
}

/**
 * Retrieve cached AI extraction if content hash still matches.
 */
export function getCachedNoticeAiExtract(db, noticeId, expectedHash = "") {
  try {
    const row = db.prepare("SELECT content_hash, model, extracted_json, updated_at FROM notice_ai_extract WHERE notice_id=?").get(noticeId);
    if (!row) return null;
    if (expectedHash && row.content_hash !== expectedHash) return null;
    const data = JSON.parse(row.extracted_json);
    if (!data || typeof data !== "object") return null;
    return { ...data, _model: row.model, _updatedAt: row.updated_at, _hash: row.content_hash };
  } catch {
    return null;
  }
}

/**
 * Structured zero-hallucination tender notice extraction via TokenHub AI.
 * Strictly anchors every clause with exact rawQuote from notice text.
 */
export async function extractNoticeWithAi(db, { noticeId, title, body, attachmentTexts = "", aiConfig, force = false }) {
  ensureNoticeAiTables(db);
  const cleanBody = normalizeNoticeTextForRead(body);
  const cleanAtt = normalizeNoticeTextForRead(attachmentTexts);
  const combinedText = [cleanBody, cleanAtt ? `\n【关联附件与补遗内容】\n${cleanAtt}` : ""].filter(Boolean).join("\n");
  if (combinedText.replace(/\s+/g, "").length < 30) {
    return { ok: false, reason: "正文过短，暂无足够原文可供 AI 提炼。" };
  }
  const contentHash = hashNoticeContent({ title, body: cleanBody, attachmentTexts: cleanAtt });
  if (!force) {
    const cached = getCachedNoticeAiExtract(db, noticeId, contentHash);
    if (cached) return { ok: true, cached: true, extract: cached };
  }
  if (!aiConfig?.apiKey) {
    return { ok: false, reason: "未配置 TokenHub API Key" };
  }

  const systemPrompt = [
    "你是中国工程建设与政府采购招标公告结构化解析专家。仅基于提供的公告标题和正文提取信息，严禁编造任何原文不存在的数据。",
    "仅输出合法纯 JSON 对象，不要包含 markdown ```json 代码块，字段严格如下：",
    "{",
    '  "budgetText": "最高限价/控制价/预算原文表述，无则空字符串",',
    '  "budgetYuan": 数字或null(例如420万元填4200000),',
    '  "deadlineText": "投标/响应截止时间(YYYY-MM-DD HH:MM)，无则空字符串",',
    '  "depositText": "投标保证金金额或免缴说明，无则空字符串",',
    '  "evalMethod": "评标办法名称(如综合评估法/合理低价法)，无则空字符串",',
    '  "requiresSafetyLicense": true或false(原文是否明确要求安全生产许可证),',
    '  "consortiumPolicy": "not_allowed(不接受联合体)|allowed(接受联合体)|required(要求联合体)|not_stated",',
    '  "smeOnly": true或false(是否专门面向中小企业采购),',
    '  "qualGroups": [',
    '    {"logic":"OR"或"AND","specs":[{"name":"完整标准资质名称如建筑装修装饰工程专业承包二级或建筑工程施工总承包三级","higherAccepted":true或false}],"rawQuote":"原文对应句子(不超过100字)"}',
    "  ],",
    '  "pmRequirement": {"required":true或false,"specialties":["市政公用工程或建筑工程等"],"minGrade":"一级或二级或空","safetyB":true或false,"rawQuote":"原文对应句子"},',
    '  "performanceReq": {"required":true或false,"summary":"仅当作为实质性资格门槛(否决项)时填写要求，评分加分项或不要求均填false","rawQuote":""},',
    '  "specialRestrictions": ["仅列出特殊排他限制如仅限某地注册、必须具备某特定系统专利等；常规的信用中国无失信、独立法人营业执照、无挂靠转包、社保承诺等不要列入！"],',
    '  "summary": "用1句大白话(不超过45字)总结投标硬门槛"',
    "}",
  ].join("\n");

  const promptBody = `公告标题：${title}\n\n公告正文：\n${combinedText.slice(0, 7500)}`;

  const res = await fetch(`${aiConfig.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${aiConfig.apiKey}` },
    body: JSON.stringify({
      model: aiConfig.defaultModel || "deepseek-v4.1-flash",
      temperature: 0.05,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: promptBody },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    throw new Error(`TokenHub HTTP ${res.status}`);
  }
  const payload = await res.json();
  const rawContent = String(payload?.choices?.[0]?.message?.content || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const jsonStart = rawContent.indexOf("{");
  const jsonEnd = rawContent.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd <= jsonStart) {
    throw new Error("AI 返回非 JSON 结构");
  }
  const parsed = JSON.parse(rawContent.slice(jsonStart, jsonEnd + 1));
  const modelName = payload?.model || aiConfig.defaultModel || "deepseek-v4.1-flash";

  const sanitized = {
    budgetText: String(parsed.budgetText || "").slice(0, 80),
    budgetYuan: Number(parsed.budgetYuan) > 0 ? Math.round(Number(parsed.budgetYuan)) : null,
    deadlineText: String(parsed.deadlineText || "").slice(0, 40),
    depositText: String(parsed.depositText || "").slice(0, 80),
    evalMethod: String(parsed.evalMethod || "").slice(0, 60),
    requiresSafetyLicense: Boolean(parsed.requiresSafetyLicense),
    consortiumPolicy: ["not_allowed", "allowed", "required", "not_stated"].includes(parsed.consortiumPolicy) ? parsed.consortiumPolicy : "not_stated",
    smeOnly: Boolean(parsed.smeOnly),
    qualGroups: Array.isArray(parsed.qualGroups) ? parsed.qualGroups.slice(0, 6).map((g) => ({
      logic: g?.logic === "AND" ? "AND" : "OR",
      specs: Array.isArray(g?.specs) ? g.specs.slice(0, 8).map((sp) => ({
        name: String(sp?.name || sp || "").trim().slice(0, 80),
        higherAccepted: sp?.higherAccepted !== false,
      })).filter((sp) => sp.name) : [],
      rawQuote: String(g?.rawQuote || "").trim().slice(0, 160),
    })).filter((g) => g.specs.length) : [],
    pmRequirement: {
      required: Boolean(parsed.pmRequirement?.required),
      specialties: Array.isArray(parsed.pmRequirement?.specialties) ? parsed.pmRequirement.specialties.map((s) => String(s).trim()).filter(Boolean).slice(0, 6) : [],
      minGrade: String(parsed.pmRequirement?.minGrade || "").trim().slice(0, 20),
      safetyB: Boolean(parsed.pmRequirement?.safetyB),
      rawQuote: String(parsed.pmRequirement?.rawQuote || "").trim().slice(0, 140),
    },
    performanceReq: {
      required: Boolean(parsed.performanceReq?.required),
      summary: String(parsed.performanceReq?.summary || "").trim().slice(0, 120),
      rawQuote: String(parsed.performanceReq?.rawQuote || "").trim().slice(0, 140),
    },
    specialRestrictions: Array.isArray(parsed.specialRestrictions) ? parsed.specialRestrictions.map((s) => String(s).trim()).filter(Boolean).slice(0, 6) : [],
    summary: String(parsed.summary || "").trim().slice(0, 120),
  };

  db.prepare(`
    INSERT INTO notice_ai_extract(notice_id, content_hash, model, extracted_json, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(notice_id) DO UPDATE SET
      content_hash=excluded.content_hash,
      model=excluded.model,
      extracted_json=excluded.extracted_json,
      updated_at=CURRENT_TIMESTAMP
  `).run(noticeId, contentHash, modelName, JSON.stringify(sanitized));

  // Backfill notice_meta empty fields deterministically from AI extract if currently missing
  try {
    const meta = db.prepare("SELECT budget_yuan, deposit_text, eval_method, qual_tags FROM notice_meta WHERE id=?").get(noticeId);
    if (meta) {
      const qualTagNames = [...new Set(sanitized.qualGroups.flatMap((g) => g.specs.map((s) => s.name)))].filter(Boolean);
      const nextQual = (!meta.qual_tags || meta.qual_tags === "[]") && qualTagNames.length ? qualTagNames.join(",") : meta.qual_tags;
      const nextBudget = (!meta.budget_yuan || Number(meta.budget_yuan) === 0) && sanitized.budgetYuan ? sanitized.budgetYuan : meta.budget_yuan;
      const nextBudgetText = (!meta.budget_yuan || Number(meta.budget_yuan) === 0) && sanitized.budgetText ? sanitized.budgetText : null;
      const nextDep = !meta.deposit_text && sanitized.depositText ? sanitized.depositText : meta.deposit_text;
      const nextEval = !meta.eval_method && sanitized.evalMethod ? sanitized.evalMethod : meta.eval_method;
      db.prepare(`
        UPDATE notice_meta SET
          qual_tags=?, budget_yuan=?, budget_text=COALESCE(?, budget_text),
          deposit_text=?, eval_method=?
        WHERE id=?
      `).run(nextQual, nextBudget, nextBudgetText, nextDep, nextEval, noticeId);
    }
  } catch {}

  return { ok: true, cached: false, extract: { ...sanitized, _model: modelName, _hash: contentHash } };
}
