import { createHash } from "node:crypto";

const stages = {
  terminated: "流标/终止公告",
  suspended: "暂停/中止公告",
  amendment: "更正/变更公告",
  contract: "合同/履约公告",
  intent: "采购意向/招标计划",
  result: "中标/结果公告",
  tender: "招标/采购公告",
  other: "其他公告",
};

export function availabilityAction(stage,title) {
  if (/终止|废标|流标/.test(title) || ["result","contract","terminated"].includes(stage)) return "closed";
  if (/暂不恢复|暂停|中止/.test(title) && !/(?:暂停|中止).{0,8}(?:后|现已)恢复/.test(title)) return "suspended";
  if (/恢复招标|恢复采购|重新启动/.test(title)) return "resumed";
  return stage==="suspended" ? "suspended" : "";
}

export function inferStage(title, defaultStage = "tender") {
  let stage = defaultStage in stages ? defaultStage : "tender";
  if (/废标|流标|终止|招标失败|采购失败/.test(title)) stage = "terminated";
  else if (availabilityAction("",title)==="suspended") stage = "suspended";
  else if (/恢复招标|恢复采购|重新启动|更正|澄清|补充公告|答疑|延期|变更/.test(title)) stage = "amendment";
  else if (/合同公告|合同公示|履约验收/.test(title)) stage = "contract";
  else if (/意向|招标计划|需求征求意见|市场调研|单一来源采购公示/.test(title)) stage = "intent";
  else if (/中标|成交|候选人|结果公示|结果公告|入围/.test(title)) stage = "result";
  const label = stage === "result" && /候选人/.test(title) ? "中标候选人公示" : stages[stage];
  return { stage, label };
}

const districts = /亭湖区|盐都区|大丰区|东台市|建湖县|射阳县|阜宁县|滨海县|响水县|盐城经济技术开发区|盐城经开区|盐南高新区|盐南高新技术产业开发区/g;
const outsideCity = /(?:上海|北京|天津|重庆)(?:市|[^\p{Script=Han}]|$)|(?:南京|苏州|无锡|常州|南通|徐州|淮安|宿迁|连云港|扬州|镇江|泰州|杭州|合肥|西安|成都|武汉|济南|广州|深圳|榆林|阜阳)市|(?:安徽|浙江|山东|福建|江西|广东|四川|湖南|湖北|河北|河南|贵州|云南|吉林|海南)省/u;
function distinctDistricts(value) {
  return [...new Set((String(value || "").match(districts) || []).map(
    (area) => area.replace("盐城经济技术开发区", "盐城经开区").replace("盐南高新技术产业开发区", "盐南高新区"),
  ))];
}

export function inferRegion(title, body, fallback) {
  const lines = String(body || "").normalize("NFKC").split("\n");
  for (const [index, line] of lines.entries()) {
    const field = line.match(/(?:^|[，,。；;])[\s(（一二三四五六七八九十\d.、)）]*(?:工程地点|项目(?:建设|实施)?地点|建设地点|施工地点|实施地点|服务地点|交货地点|交付地点|项目所在地)\s*(?:[:：]|位于|为)\s*([^。；;]{0,120})/);
    if (!field) continue;
    const place = field[1] || lines[index + 1]?.slice(0, 120) || "";
    const areas = distinctDistricts(place);
    const outside = outsideCity.test(place);
    if (outside && (areas.length || /盐城/.test(place))) return { region: "盐城市", regionBasis: "正文项目地点含盐城及外地" };
    if (areas.length === 1) return { region: `盐城市${areas[0]}`, regionBasis: "正文项目地点" };
    if (areas.length > 1) return { region: "盐城市", regionBasis: "正文涉及多个区县" };
    if (/盐城/.test(place)) return { region: "盐城市", regionBasis: "正文项目地点明确盐城" };
    if (outside) return { region: "外地", regionBasis: "正文项目地点明确外地" };
  }
  const areas = distinctDistricts(title);
  if (areas.length === 1) return { region: `盐城市${areas[0]}`, regionBasis: "标题区县" };
  if (areas.length > 1) return { region: "盐城市", regionBasis: "标题涉及多个区县" };
  return { region: fallback || "盐城市", regionBasis: "来源覆盖区域" };
}

export function inferNoticeFields(title, body, stage) {
  const normalized = String(body || "").normalize("NFKC");
  const fields = {};
  const buyer = normalized.match(/(?:^|\n)(?:[一二三四五六七八九十\d]+[、.．]\s*)?(?:招标人|采购人|项目业主|建设单位|采购单位)(?:信息)?\s*[:：]\s*(?:名称\s*[:：]\s*)?([^\n；;]{2,100})/);
  fields.tenderer = buyer?.[1]?.split(/\s*(?:地\s*址|联系人|联系方式)\s*[:：]/)[0].trim() || "";
  const agency = normalized.match(/(?:^|\n)(?:[一二三四五六七八九十\d]+[、.．]\s*)?(?:招标代理机构|采购代理机构)(?:信息)?\s*[:：]\s*(?:名称\s*[:：]\s*)?([^\n；;]{2,100})/);
  fields.agency = agency?.[1]?.split(/\s*(?:地\s*址|联系人|联系方式)\s*[:：]/)[0].trim() || "";
  fields.projectCode = (normalized.match(/(?:项目编号|采购编号|采购项目编号|招标编号|招标项目编号)\s*[:：]\s*([A-Z0-9][A-Z0-9_-]{5,63})/i)?.[1]
    || title.normalize("NFKC").match(/^(?:项目编号\s*[:：]\s*)?([A-Z]{1,12}\d{4}[-_][A-Z0-9_-]{2,50})/i)?.[1] || "").toUpperCase();
  fields.deadline = "0";
  fields.deadlineText = "";
  if (stage !== "tender" && stage !== "amendment") return fields;
  const deadlineMatches = normalized.matchAll(/(?:投标截止时间(?:和开标时间|与开标时间|及开标时间)?|响应截止时间|(?:投标|响应)文件(?:递交|提交)(?:的)?截止时间|(?:提交|递交)(?:投标|响应)文件(?:的)?截止时间|(?:投标|响应|竞价)文件接收截止时间)\s*(?:\(北京时间\))?\s*[:：为]?\s*(20\d{2})[-/.年]\s*(\d{1,2})[-/.月]\s*(\d{1,2})日?\s*(上午|下午)?\s*(\d{1,2})\s*[:：时点]\s*(\d{1,2})(?:分)?/g);
  const deadlineSentence = normalized.matchAll(/(?:须于|应于|并于|请于|应在|须在)\s*(?:北京时间)?\s*(20\d{2})[-/.年]\s*(\d{1,2})[-/.月]\s*(\d{1,2})日?\s*(上午|下午)?\s*(\d{1,2})\s*[:：时点]\s*(\d{1,2})(?:分)?\s*(?:\(北京时间\))?\s*(?:之前|前)\s*(?:递交|提交|上传)\s*(?:电子)?(?:投标|响应)文件/g);
  const times = new Map();
  for (const deadline of [...deadlineMatches, ...deadlineSentence]) {
    const parsed = deadlineTime(deadline);
    if (parsed) times.set(parsed.deadline, parsed);
  }
  if (times.size === 1) Object.assign(fields, times.values().next().value);
  fields.deadlineStatus = times.size > 1 ? "conflict" : times.size ? "confirmed" : "unconfirmed";
  return fields;
}

export function inferNoticeBudget(body) {
  const text = String(body || "").normalize("NFKC");
  const totalBudget = "项目总预算|预算总金额|采购预算|预算金额|项目预算|预算总价|总采购金额";
  const totalLimit = "最高投标限价|最高限价|招标控制价|工程合同估算价|合同估算价|发包价";
  const unit = "亿元|万元|元";
  const part = /单价|每年|每期|每批|每月|每人|每套|每台|每件|每次|年度|首年|分期|第[一二三四五六七八九十\d]+期|第[一二三四五六七八九十\d]+年|采购包\s*\d|标段\s*\d/;
  for (const labels of [totalBudget, totalLimit]) {
    const mentions = new RegExp(`(${labels})\\s*(?:\\((${unit}|含税|不含税)\\))?\\s*(?:[:：]|为)\\s*(?:人民币|¥)?\\s*([\\d,]+(?:\\.\\d+)?)\\s*(${unit})?`, "g");
    const amounts = new Map();
    for (const m of text.matchAll(mentions)) {
      const head = text.slice(Math.max(0, m.index - 16), m.index).split(/[。；;\n，,]/).at(-1);
      const tail = text.slice(m.index + m[0].length, m.index + m[0].length + 48).split(/[。；;\n，,]/)[0];
      const declaredUnit = m[4] || m[2];
      if (!/^(?:亿元|万元|元)$/.test(declaredUnit || "") || (m[2]?.endsWith("元") && m[4] && m[2] !== m[4]) ||
          part.test(head) || part.test(tail) ||
          /^\s*(?:\/|~|～|至|到|–|—|-\s*\d|[%％]|(?:\([^)]{0,12})?(?:每[年月日人套台米次批件]|\/))/.test(tail) ||
          /不含后续/.test(tail)) continue;
      const num = Number(m[3].replaceAll(",", ""));
      const multiplier = declaredUnit === "亿元" ? 100_000_000 : declaredUnit === "万元" ? 10_000 : 1;
      const yuan = Math.round(num * multiplier);
      if (Number.isSafeInteger(yuan) && yuan > 0) amounts.set(yuan, { yuan, text: `${num}${declaredUnit}` });
    }
    if (amounts.size > 1) return null;
    if (amounts.size === 1) return amounts.values().next().value;
  }
  return null;
}

function deadlineTime(deadline) {
  const [, year, month, date, meridiem, hourStr, minute] = deadline;
  let hour = Number(hourStr);
  if (meridiem === "下午" && hour < 12) hour += 12;
  if (meridiem === "上午" && hour === 12) hour = 0;
  const day = `${year}-${month.padStart(2, "0")}-${date.padStart(2, "0")}`;
  const time = `${String(hour).padStart(2, "0")}:${minute.padStart(2, "0")}`;
  const dateOnly = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(dateOnly.getTime()) || dateOnly.toISOString().slice(0, 10) !== day || hour > 23 || Number(minute) > 59) return null;
  return {
    deadline: (BigInt(Date.parse(`${day}T${time}:00+08:00`)) * 1_000_000n).toString(),
    deadlineText: `${day} ${time}`,
  };
}

export function evidenceSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_source_observation (
      source_key TEXT NOT NULL, url TEXT NOT NULL, notice_id TEXT NOT NULL,
      list_url TEXT NOT NULL, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
      detail_checked_at TEXT NOT NULL, detail_error TEXT NOT NULL,
      version_sha TEXT NOT NULL, body_status TEXT NOT NULL,
      attachment_status TEXT NOT NULL, attachments_json TEXT NOT NULL,
      PRIMARY KEY (source_key, url)
    );
    CREATE INDEX IF NOT EXISTS idx_custom_source_observation_notice ON custom_source_observation(notice_id);
    CREATE INDEX IF NOT EXISTS idx_custom_source_notice_identity ON notice_meta(source_key, url);
    CREATE TABLE IF NOT EXISTS custom_source_version (
      source_key TEXT NOT NULL, url TEXT NOT NULL, version_sha TEXT NOT NULL,
      observed_at TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, attachments_json TEXT NOT NULL,
      body_status TEXT NOT NULL DEFAULT 'unknown', attachment_status TEXT NOT NULL DEFAULT 'unknown',
      PRIMARY KEY (source_key, url, version_sha)
    );
    CREATE TABLE IF NOT EXISTS custom_source_coverage (
      source_key TEXT PRIMARY KEY, checked_at TEXT NOT NULL, pages_read INTEGER NOT NULL,
      records_found INTEGER NOT NULL, oldest_date TEXT NOT NULL, newest_date TEXT NOT NULL,
      watermark_date TEXT NOT NULL, next_url TEXT NOT NULL, cutoff_date TEXT NOT NULL,
      anchor_url TEXT NOT NULL, anchor_urls_json TEXT NOT NULL,
      status TEXT NOT NULL, error TEXT NOT NULL
    );
  `);
  const versionColumns = new Set(db.prepare("PRAGMA table_info(custom_source_version)").all().map(({name}) => name));
  if (!versionColumns.has("body_status")) db.exec("ALTER TABLE custom_source_version ADD COLUMN body_status TEXT NOT NULL DEFAULT 'unknown'");
  if (!versionColumns.has("attachment_status")) db.exec("ALTER TABLE custom_source_version ADD COLUMN attachment_status TEXT NOT NULL DEFAULT 'unknown'");
}

export function saveCoverage(db, key, now, run) {
  db.prepare(`
    INSERT INTO custom_source_coverage VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(source_key) DO UPDATE SET checked_at=excluded.checked_at,
      pages_read=excluded.pages_read, records_found=excluded.records_found,
      oldest_date=excluded.oldest_date, newest_date=excluded.newest_date,
      watermark_date=max(watermark_date, excluded.watermark_date),
      next_url=excluded.next_url, cutoff_date=excluded.cutoff_date,
      anchor_url=excluded.anchor_url, anchor_urls_json=excluded.anchor_urls_json,
      status=excluded.status, error=excluded.error
  `).run(key, now, run.pages || 0, run.items?.length || 0, run.oldest || "", run.newest || "",
    run.complete ? run.newest || "" : "", run.next || "", run.cutoff || "",
    run.anchorUrl || "", JSON.stringify(run.anchorUrls || []), run.status, run.error || "");
}

export function saveObservation(db, source, item, noticeId, previousBody, now, regionBasis, body) {
  const previous = db.prepare("SELECT * FROM custom_source_observation WHERE source_key=? AND url=?")
    .get(source.key, item.url);
  const hasAttachmentObservation = item.attachmentStatus && item.attachmentStatus !== "not_checked";
  const attachmentStatus = hasAttachmentObservation ? item.attachmentStatus
    : item.detailChecked ? "not_checked" : previous?.attachment_status || "not_checked";
  const attachments = hasAttachmentObservation ? item.attachments
    : item.detailChecked ? [] : JSON.parse(previous?.attachments_json || "[]");
  const attachmentsJson = JSON.stringify(attachments);
  const bodyStatus = item.bodyStatus || previous?.body_status || (previousBody ? "captured" : "pending");
  const listUrl = item.listUrl || previous?.list_url || source.list_url;
  const versionSha = createHash("sha256").update(JSON.stringify([item.title, body, bodyStatus, attachmentStatus, attachments])).digest("hex");
  const checked = item.detailChecked ? now : previous?.detail_checked_at || "";
  const error = item.detailChecked ? item.detailError || "" : previous?.detail_error || "";
  db.prepare(`
    INSERT INTO custom_source_observation VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(source_key,url) DO UPDATE SET notice_id=excluded.notice_id, list_url=excluded.list_url,
      last_seen_at=excluded.last_seen_at, detail_checked_at=excluded.detail_checked_at, detail_error=excluded.detail_error,
      version_sha=excluded.version_sha, body_status=excluded.body_status,
      attachment_status=excluded.attachment_status, attachments_json=excluded.attachments_json
  `).run(source.key, item.url, noticeId, listUrl, now, item.fromBacklog ? previous?.last_seen_at || now : now,
    checked, error, versionSha, bodyStatus, attachmentStatus, attachmentsJson);
  db.prepare(`INSERT OR IGNORE INTO custom_source_version
    (source_key,url,version_sha,observed_at,title,body,attachments_json,body_status,attachment_status) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(source.key, item.url, versionSha, now, item.title, body, attachmentsJson, bodyStatus, attachmentStatus);
  return { sourceKey: source.key, sourceName: source.name, listUrl, url: item.url, versionSha,
    bodyStatus, attachmentStatus, attachments, observedAt: now, detailCheckedAt: checked,
    detailStatus: item.detailChecked ? item.bodyStatus : bodyStatus, detailError: error, regionBasis };
}
