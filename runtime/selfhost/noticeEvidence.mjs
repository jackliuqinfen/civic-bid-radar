const requirementDefinitions = [
  { key: "REQ_CORP_QUAL", title: "企业资质与等级", pattern: /施工总承包|专业承包|工程监理|工程设计|设计资质|勘察资质|施工劳务|承装[（(]?修、?试[）)]?/ },
  { key: "REQ_SAFETY_LIC", title: "安全生产许可证", pattern: /安全生产许可证|安许证/ },
  { key: "REQ_PM_CERT", title: "项目负责人及人员要求", pattern: /建造师|项目经理|项目负责人|注册[^，。；：、]{0,12}工程师|配备[^，。；：、]{0,12}人员/ },
  { key: "REQ_JOINT", title: "联合体限制", pattern: /联合体/ },
  { key: "REQ_SME", title: "中小企业专项政策", pattern: /专门面向.{0,12}中小企业|全部由中小企业|中小企业声明函/ },
  { key: "REQ_PERFORMANCE", title: "业绩门槛", pattern: /业绩/ },
  { key: "REQ_CREDIT", title: "信用及合规记录", pattern: /信用中国|信用记录|安全事故|违法记录|行政处罚|失信|行贿犯罪/ },
  { key: "REQ_BUSINESS", title: "登记及经营档案", pattern: /营业执照|独立承担民事责任|独立法人|财务状况|注册资本|纳税|从业年限/ },
  { key: "REQ_OTHER", title: "其他准入条件", pattern: /声明函|其他资格|特殊要求|备案|特定业绩/ },
];

const dateText = "(20\\d{2}[年./-]\\d{1,2}[月./-]\\d{1,2}日?(?:\\s*\\d{1,2}[：:]\\d{2}|\\s*\\d{1,2}时\\d{1,2}分)?)";
const before = "[：:\\s]*(?:为\\s*)?";
const timeField = (label, subject) => ({ label, pattern: new RegExp(subject + "(?:时间|日期)?" + before + dateText) });
const fields = {
  projectName: { label: "项目名称", pattern: /(?:采购项目名称|项目名称)[：:]\s*([^。；;]{2,110})/ },
  projectNumber: { label: "项目编号", pattern: /(?:项目编号|招标编号|采购编号)[：:]\s*([a-zA-Z0-9][A-Za-z0-9_/.-]{2,62})/ },
  lot: { label: "标段或采购包", pattern: /(?:标段名称|标包名称|采购包名称|标段编号)[：:]\s*([^。；;]{1,90})/ },
  buyer: { label: "采购或招标单位", pattern: /(?:采购人|招标人)(?:名称)?[：:]\s*([^。；;，,]{2,75})/ },
  place: { label: "实施地点", pattern: /(?:实施地点|项目地点|建设地点|交付地点)[：:]\s*([^。；;]{2,100})/ },
  category: { label: "采购类别", pattern: /(?:采购类型|采购类别|标的类别)[：:]\s*(施工|工程|服务|货物|设备|物资)/ },
  evaluation: { label: "评标或评审办法", pattern: /(?:评标办法|评标方法|评审办法|评审方法)[：:]\s*([^。；;]{2,100})/ },
  fileAcquisition: { label: "采购文件获取方式", pattern: /(?:获取采购文件方式|获取招标文件方式|文件获取方式)[：:]\s*([^。；;]{2,120})/ },
  fileFee: { label: "采购文件费用", pattern: /(?:标书费|文件售价|采购文件售价|招标文件售价|采购文件费)[：:]\s*((?:人民币)?[0-9.,]+\s*元(?:\s*[/／]\s*(?:份|套))?|免费)/ },
  procurementMethod: { label: "采购方式", pattern: /(?:采购方式[：:\s]*|采用|采购采用|招标方式[：:\s]*)(公开招标|邀请招标|竞争性磋商|竞争性谈判|询价|单一来源)/ },
  published: timeField("公告发布日期", "(?:公告日期|发布日期|发布时间)"),
  deadline: timeField("投标截止", "(?:(?:投标|响应)(?:文件)?(?:提交|递交|上传)?|(?:提交|递交)(?:投标|响应)文件)截止(?:时间(?:和|与|及)开标时间)?"),
  registrationDeadline: timeField("报名截止", "(?:报名|获取(?:招标|采购)文件)截止"),
  openTime: timeField("开标时间", "(?:开标|开启响应文件)"),
  decryptDeadline: timeField("解密截止", "(?:投标文件)?解密截止"),
  depositDeadline: timeField("保证金缴纳截止", "投标保证金(?:缴纳|到账|递交)?截止"),
  budget: { label: "最高限价", pattern: /(?:最高(?:投标)?限价|招标控制价)[：:\s]*(?:人民币)?\s*([\d,.，]+\s*(?:万|亿)?元(?:\s*(?:[/／]\s*(?:年|月|天|日|次|人|套|台|米|吨|项)|每(?:年|月|次)))?)/ },
  procurementBudget: { label: "采购预算", pattern: /(?:采购预算|项目预算|预算金额)[：:\s]*(?:人民币)?\s*([\d,.，]+\s*(?:万|亿)?元(?:\s*(?:[/／]\s*(?:年|月|天|日|次|人|套|台|米|吨|项)|每(?:年|月|次)))?)/ },
  deposit: { label: "投标保证金", pattern: /(?:投标|响应)保证金(?:金额)?[：:\s]*(?:人民币)?\s*([\d,.，]+\s*(?:万|亿)?元|免缴|无需缴纳|不收取)|(不收取(?:投标|响应)保证金|无需缴纳(?:投标|响应)保证金)/ },
  depositForm: { label: "投标保证金形式", pattern: /(?:投标|响应)?保证金(?:缴纳|提交|担保)?(?:方式|形式)[：:\s]*([^。；;]{2,120})/ },
  depositRefund: { label: "保证金退还条件", pattern: /(?:投标|响应)?保证金(?:的)?(?:退还|退回)(?:条件|方式|时间)?[：:\s]*([^。；;]{2,120})/ },
  siteRequirement: { label: "现场要求", pattern: /(?:现场(?:踏勘|签到|核验|递交)(?:要求)?|到场(?:要求|人员))[：:\s]*([^。；;]{2,120})|((?:不组织|统一组织|必须参加|自行安排)现场踏勘)/ },
  openPlace: { label: "开标地点", pattern: /(?:开标地点|开标地址|开启地点)[：:\s]*([^。；;]{2,120})/ },
};
const fieldMatchers = Object.entries(fields).map(([key, field]) => [key, new RegExp(field.pattern.source, "g")]);

const gradeToken = "(?:特级|[一二三壹贰叁]级|[甲乙丙]级|不分等级)";
const higherToken = "(?:（?\\s*(?:含\\s*\\)?\\s*以上|及以上|以上|及更高等级))";
const qualification = new RegExp(
  `(?:(${gradeToken})\\s*(${higherToken})?\\s*)?` +
  `([\\u4e00-\\u9fff（）()]{2,28}?(?:施工总承包|专业承包|工程监理|工程设计|工程勘察)|施工劳务)` +
  `(?:资质)?\\s*(${gradeToken})?\\s*(${higherToken})?`,
  "g"
);
const gradeRank = { 特级: 0, 一级: 1, 壹级: 1, 二级: 2, 贰级: 2, 三级: 3, 叁级: 3, 甲级: 1, 乙级: 2, 丙级: 3, 不分等级: 3 };
const scopeNumber = { 一: "1", 二: "2", 两: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9", 十: "10" };


export function sameNoticeScope(a, b) {
  const scope = notice => {
    const title = String(notice.title || "");
    const lotText = String(notice.lotKey || notice.lotId || "");
    const lot = title.match(/(?:第)?([\d一二两三四五六七八九十]+)(?:标段|分包|包件|标包|合同包)/)?.[1] ||
      title.match(/(?:标段|分包|包件|标包|合同包)[：:\s]*([\d一二两三四五六七八九十]+)/)?.[1];
    const round = title.match(/(?:第)?([\d一二两三四五六七八九十]+)(?:轮|次)/)?.[1] || (/重新招标|重新采购/.test(title) ? "重新" : "");
    return [scopeNumber[lot] || lot || "", scopeNumber[round] || round, lotText.trim(), notice.round || ""].join("|");
  };
  return (!a.tenderer || !b.tenderer || a.tenderer === b.tenderer) && scope(a) === scope(b);
}

function stripQualLead(raw) {
  return String(raw || "")
    .replace(/^.*(?:须具备|应具备|同时具备|具备|持有|取得|具有|要求|或者|或|核发的|核定的)/, "")
    .replace(/^.*?(?:及以上资质和|资质和|资质及|资质与)/, "")
    .replace(/^(?:以及|和|与|及|或者|或|并且|并|且|同时)+/, "")
    .trim();
}

function qualificationName(raw) {
  return stripQualLead(raw)
    .replace(/（/g, "(").replace(/）/g, ")")
    .replace(/^(?:建筑)?(?:装饰装修|装修装饰)(?:工程)?/, "建筑装修装饰");
}

function qualificationItems(text) {
  return Array.from(String(text || "").matchAll(qualification), match => {
    const preGrade = match[1] || "";
    const preHigher = match[2] || "";
    const rawCore = match[3] || "";
    const postGrade = match[4] || "";
    const postHigher = match[5] || "";
    const key = qualificationName(rawCore).replace(/^建筑装修装饰工程/, "建筑装修装饰");
    return {
      key,
      grade: postGrade || preGrade || "",
      higherAccepted: Boolean(postHigher || preHigher),
    };
  }).filter(x => x.key && x.key.length >= 4);
}

function qualificationClause(excerpt) {
  const required = qualificationItems(excerpt);
  if (!required.length) return null;
  const grammar = excerpt.replace(qualification, (_, _g1, _h1, raw) => {
    const core = stripQualLead(raw);
    return String(raw || "").slice(0, Math.max(0, String(raw || "").length - core.length)) + "□";
  })
    .replace(/^(?:[（(]?[一二三四五六七八九十\d]+[）).．、]\s*)?(?:投标人)?(?:资质|资格)(?:类别和等级|条件|要求|审查)?[：:\s]*/g, "")
    .replace(/投标人|供应商|申请人|响应人/g, "")
    .replace(/^(?:必须|应当|应|须)?\s*同时(?:具备|具有|持有|取得)/, "")
    .replace(/(?:必须|应当|应|须)?(?:具备|具有|持有|取得)|(?:建设行政主管部门核发的)|(?:以下)?(?:资质证书|有效资质|资质等级|相应资质|资质)|满足(?:下列|其一)/g, "")
    .replace(/[\s。：:（()）【】]/g, "");
  const optional = /或/.test(grammar);
  if ((optional && (/和|与|及|并|且|同时/.test(grammar) || /□[，,、；;]+□/.test(grammar))) ||
      !/^□(?:(?:[，,、；;]*(?:或者|或|以及|及|和|与|并且|并|且|同时)?[，,、；;]*)□)*[，,、；;]*$/.test(grammar)) return null;
  if (optional && required.length < 2) return null;
  return { required, optional };
}

export function normalizeQualificationSearchText(text) {
  return String(text || "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(?:p|div|li|tr|h[1-6])\s*>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&#160;/gi, " ");
}

/**
 * Reflow Hanweb / Epoint DOM-node newlines ("建筑工程施工总承包\n叁\n级及以上", "不\n接受\n联合体\n投\n标")
 * back into continuous sentences while keeping section headings & bullet points separated.
 */
function reflowHtmlLines(raw) {
  const normalized = normalizeQualificationSearchText(raw).replace(/\r\n/g, "\n");
  const rawLines = normalized.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim());
  const isHeadingOrBullet = (l) =>
    /^(?:[一二三四五六七八九十]+[、.．]|[（(][一二三四五六七八九十\d]+[）)]|\d+(?:\.\d+)*[、.．\s]|[①②③④⑤⑥⑦⑧]|注[：:])/.test(l);
  const endsSentence = (l) => /[。；;！!？?]$/.test(l) || (l.length >= 22 && /[：:]$/.test(l));

  const merged = [];
  for (const line of rawLines) {
    if (!line) continue;
    if (!merged.length) {
      merged.push(line);
      continue;
    }
    const prev = merged[merged.length - 1];
    // Rejoin fragmented tokens (numbers, parenthetical notes, single words, mid-sentence spans)
    const prevIsHeadingOnly = /^[\d.、一二三四五六七八九十（）()]+$/.test(prev);
    const curStartsPunct = /^[，,。；;：:、）)\]]/.test(line);
    const prevEndsJoinable = !endsSentence(prev) && (!isHeadingOrBullet(line) || prevIsHeadingOnly);
    const midWordBreak =
      (/[\u4e00-\u9fa5A-Za-z0-9（(]$/.test(prev) && /^[壹贰叁一二三特甲乙丙级上以类年个月日元万亿，,。；;、）)]/.test(line)) ||
      (/\d$/.test(prev) && /^\d/.test(line));

    if (prevIsHeadingOnly || curStartsPunct || midWordBreak || (prevEndsJoinable && line.length <= 48 && prev.length <= 180)) {
      const needSpace = /[A-Za-z0-9.]$/.test(prev) && /^[A-Za-z0-9]/.test(line) && !prevIsHeadingOnly && !(/\d$/.test(prev) && /^\d/.test(line));
      merged[merged.length - 1] = prev + (needSpace ? " " : "") + line;
    } else {
      merged.push(line);
    }
  }
  return merged.join("\n");
}

function getLines(text) {
  return reflowHtmlLines(text)
    .replace(/[；;]\s*(?=评分标准|评分办法|加分项|资格要求|资格条件)/g, "\n")
    .split(/[。\n]+/)
    .map((line) => line.trim().replace(/[ \t]+/g, " "))
    .filter(Boolean);
}

function normalizeValue(value) {
  const money = value.match(/^([\d,.，]+)\s*(亿|万)?元(?:\s*[/／]\s*(年|月|天|次|人|台|套|吨|米|项))?$/);
  if (money) return String(Number(money[1].replace(/[,，]/g, "")) * (money[2] === "亿" ? 1e8 : money[2] === "万" ? 1e4 : 1)) + (money[3] ? "/" + money[3] : "");
  const date = value.match(/^(20\d{2})[年./-](\d{1,2})[月./-](\d{1,2})日?(?:\s*(\d{1,2})[：:时](\d{1,2})分?)?$/);
  if (date) return date.slice(1).map((part, index) => index ? part?.padStart(2, "0") || "" : part).join("-");
  return value;
}

function clauseStance(key, text) {
  if (/(?:除.{2,28}外|但.{2,45}(?:可|免|不受|除外)|例外|在.{2,25}条件下(?:可|允许))/.test(text)) return "exception";
  if (key === "REQ_JOINT") {
    if (/(?:不接受|不得采用|禁止|不允许).{0,8}联合体/.test(text)) return "prohibited";
    if (/(?:接受|允许|可以采用).{0,8}联合体/.test(text)) return "allowed";
  }
  if (key === "REQ_PERFORMANCE" && /不要求(?:类似)?业绩|无(?:类似)?业绩要求|不设(?:类似)?业绩|业绩不作为资格条件/.test(text)) return "exempt";
  if (/不得|禁止|拒绝|不接受/.test(text)) return "prohibited";
  return "mandatory";
}

export function extractNoticeEvidence({ body, bodyComplete, url, attachments = [], attachmentsKnown = true, documents = [], aiExtract = null } = {}) {
  const sources = [{ label: "公告正文", kind: "notice", url, body }, ...documents];
  const completeness = {
    body: Boolean(String(body || "").trim()) && bodyComplete !== false,
    amendments: documents.filter(document => document.kind === "amendment").every(document => document.complete !== false && Boolean(String(document.body || "").trim())),
    attachments: attachmentsKnown && attachments.every(item => item.readable),
  };
  const requirements = requirementDefinitions.map(definition => ({ key: definition.key, title: definition.title, state: "not_stated", entries: [] }));
  const extractedFields = Object.fromEntries(Object.entries(fields).map(([key, item]) => [key, { label: item.label, state: "not_stated", entries: [] }]));
  const scoring = [];

  for (const source of sources) {
    let section = "";
    for (const [index, line] of getLines(source.body).entries()) {
      const excerpt = line.slice(0, 350);
      const cite = { source: source.label, kind: source.kind, version: source.version || "", url: source.url || "", page: source.page || null, paragraph: index + 1, excerpt };
      const score = /(?:得|加|扣)\s*\d+(?:\.\d+)?\s*分|不得分|评分标准|评标基准价/.test(line);
      if (/评分(?:标准|办法)|评分项|加分项|商务评分|技术评分|五、投标保证金|八、招标公告发布/.test(line)) section = "scoring";
      else if (/资格(?:审查|条件|要求|类别和等级)|申请人(?:的)?资格|投标人资格/.test(line) ||
          (!score && /^(?:投标人|供应商|申请人|响应人)(?:必须|须|应当|应具有|应具备)/.test(line))) section = "eligibility";
      else if (/^(?:[一二三四五六七八九十\d]+[、.．]\s*)?(?:采购需求|项目概况|招标范围|获取(?:采购|招标)文件|递交(?:响应|投标)文件|开标时间|联系方式|评标办法|投标保证金|合同条款)/.test(line) && /[：:]|^[一二三四五六七八九十\d]+[、.．]/.test(line)) section = "";

      const isScoring = section === "scoring" || score;
      if (isScoring) {
        scoring.push(cite);
      } else {
        const explicit = section === "eligibility" || /必须|不得|无(?:类似)?业绩要求|不要求|应当|应为|应具备|须|具备|具有|提供|禁止|不接受|接受联合体|允许联合体|专门面向|最低要求/.test(line);
        let recognized = false;
        for (const [ruleIndex, rule] of requirementDefinitions.entries()) {
          if (rule.key === "REQ_OTHER") continue;
          if (!rule.pattern.test(line)) continue;
          if (!explicit) continue;
          requirements[ruleIndex].entries.push({ ...cite, stance: clauseStance(rule.key, line) });
          recognized = true;
        }
        const containsCondition = /(?:投标人|供应商|申请人|响应人).{0,14}(?:应|须|限于|不得)|并(?:且|须|应|具备|具有|配备|满足|提交|提供)|(?:近|过去)[一二三四五12345]年|不得|仅限/.test(line);
        const unrecognizedAdditional = line.split(/[，,；;]/).some(part => /(?:并|还|同时)?(?:需|须|应|不得|近[一二三四五12345]年|配备|限制)/.test(part) &&
          !requirementDefinitions.some(definition => definition.pattern.test(part)) && !/^(?:投标人|供应商|申请人)?[须应]?满足以下(?:条款|条件)[：:]?$/.test(part.trim()));
        if ((!recognized && (containsCondition || (section === "eligibility" && line.length >= 12 && !Object.values(fields).some(field => field.pattern.test(line))))) ||
            (recognized && unrecognizedAdditional)) {
          const other = requirements.at(-1).entries;
          if (other.at(-1)?.excerpt !== excerpt) other.push({ ...cite, stance: clauseStance("REQ_OTHER", line) });
        }
      }
      for (const [key, matcher] of fieldMatchers) {
        for (const match of line.matchAll(matcher)) {
          const value = match.slice(1).find(Boolean);
          if (value) extractedFields[key].entries.push({ ...cite, value: value.trim() });
        }
      }
    }
  }

  for (const field of Object.values(extractedFields)) {
    if (field.entries.length) field.state = new Set(field.entries.map(item => normalizeValue(item.value))).size > 1 ? "conflict" : "stated";
  }
  for (const req of requirements) {
    if (!req.entries.length) {
      if (!Object.values(completeness).every(Boolean)) req.state = "unavailable";
      continue;
    }
    const versions = new Map();
    for (const row of req.entries) {
      const id = row.version || row.kind + "|" + row.source + "|" + row.url;
      if (!versions.has(id)) versions.set(id, []);
      versions.get(id).push(row.excerpt.replace(/[\s，。；：]/g, ""));
    }
    const stances = new Set(req.entries.map(row => row.stance));
    const disagree = (versions.size > 1 && new Set([...versions.values()].map(lines => [...new Set(lines)].sort().join("|"))).size > 1) ||
      (stances.has("allowed") && stances.has("prohibited")) || (stances.has("exempt") && stances.has("mandatory"));
    req.state = disagree ? "conflict" : "stated";
    req.stance = stances.size === 1 ? req.entries[0].stance : "mixed";
  }

  return { requirements, fields: extractedFields, scoring, attachments, completeness, aiExtract: aiExtract || null };
}

function qualificationMatches(required, holding) {
  if (!required?.key || !holding?.key) return false;
  if (required.key !== holding.key) return false;
  if (!required.grade) return Boolean(holding.grade);
  if (required.grade === holding.grade) return true;
  if (required.grade === "不分等级" || holding.grade === "不分等级") return required.grade === holding.grade;
  const rank = gradeRank[required.grade];
  const holdingRank = gradeRank[holding.grade];
  const letterGrade = /[甲乙丙]/.test(required.grade);
  if (rank === undefined || holdingRank === undefined || letterGrade !== /[甲乙丙]/.test(holding.grade)) return false;
  return rank === holdingRank || (required.higherAccepted && holdingRank < rank);
}

function companyEvidence(docs, date) {
  return docs.filter(doc => !["void", "missing"].includes(doc.status)).map(doc => {
    let items = [];
    try {
      const parsed = JSON.parse(doc.qual_items_json || "[]");
      if (Array.isArray(parsed)) items = parsed.map(item => typeof item === "string" ? item : item?.name).filter(Boolean);
    } catch {}
    const isLongTerm = doc.valid_until === "长期" || (/营业执照/.test(`${doc.category || ""} ${doc.name || ""}`) && !doc.valid_until);
    const validDateOk = isLongTerm || (/^\d{4}-\d{2}-\d{2}$/.test(doc.valid_until || "") && doc.valid_until >= date);
    return {
      id: doc.id || "",
      category: doc.category || "",
      label: doc.name || "",
      docNo: doc.doc_no || "",
      validity: isLongTerm ? "长期" : (doc.valid_until || ""),
      usable: doc.status === "verified" && validDateOk,
      dateValid: validDateOk,
      verified: doc.status === "verified",
      qualifications: (items.length ? items : [doc.name || ""]).flatMap(qualificationItems),
    };
  });
}

export function qualificationSearchTerms(docs = []) {
  const holdings = companyEvidence(docs, "");
  const terms = new Set();
  for (const doc of holdings) {
    if (/安全生产许可证|安许证/.test(`${doc.category} ${doc.label}`)) {
      terms.add("安全生产许可证");
      terms.add("安许证");
    }
    for (const spec of doc.qualifications) {
      const label = spec.key === "建筑装修装饰专业承包"
        ? ["建筑装修装饰专业承包", "建筑装修装饰工程专业承包", "装饰装修工程专业承包", "建筑装饰装修工程专业承包"]
        : spec.key.startsWith("特种工程")
          ? [spec.key, "特种工程"]
          : [spec.key];
      for (const value of label) terms.add(value);
    }
  }
  return [...terms];
}

export function evaluateNoticeRequirements(evidence, docs = [], date = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)) {
  const bidDate = evidence.fields.deadline.state === "stated" && normalizeValue(evidence.fields.deadline.entries[0].value).slice(0, 10);
  const operationalDay = evidence.operationalDeadline && evidence.operationalDeadline !== "0" ? new Date(Number(BigInt(evidence.operationalDeadline)/1000000n)+8*3600000).toISOString().slice(0,10) : "";
  const requiredThrough = operationalDay || bidDate;
  const holdings = companyEvidence(docs, requiredThrough > date ? requiredThrough : date);
  const requirements = evidence.requirements.map(requirement => {
    const pending = (reason, documents = []) => ({ key: requirement.key, status: "pending", reason, documents });
    if (requirement.state === "not_stated") return pending("公告未写明");
    if (requirement.state === "unavailable") return pending("原文或附件待取得");
    if (requirement.state === "conflict") return pending("版本条款冲突");
    if (requirement.stance === "exempt") return { key: requirement.key, status: "na", reason: "原文明示不设该门槛", documents: [] };
    if (requirement.stance === "exception" || requirement.stance === "mixed" || requirement.stance === "prohibited") return pending("限制或例外条件须人工核实");
    if (requirement.key === "REQ_JOINT" && requirement.stance === "allowed") return pending("公告允许联合体，须核对实际参投主体及约定");
    const excerpts = [...new Set(requirement.entries.map(entry => entry.excerpt))];
    if (requirement.key === "REQ_CORP_QUAL") {
      const candidates = [];
      const relatedDocuments = new Set();
      let unresolved = null;
      for (const excerpt of excerpts) {
        const clause = qualificationClause(excerpt);
        if (!clause) {
          for (const holding of holdings) {
            if (holding.qualifications.some(spec => spec.key && excerpt.includes(spec.key))) relatedDocuments.add(holding);
          }
          unresolved ||= pending("复合资格关系或附加限制须人工核实");
          continue;
        }
        const { required, optional } = clause;
        const matches = required.map(item => holdings.filter(doc => doc.usable && doc.qualifications.some(spec => qualificationMatches(item, spec))));
        candidates.push(...matches.flat());
        if (optional ? matches.every(group => !group.length) : matches.some(group => !group.length)) {
          const unchecked = required.filter((item, index) => !matches[index].length);
          const related = holdings.filter(doc => doc.qualifications.some(spec => unchecked.some(item => item.key === spec.key)));
          unresolved ||= related.length ? pending("等级、有效期或核验状态待核", related)
            : { key: requirement.key, status: "missing", reason: "档案缺失", documents: [] };
        }
      }
      if (unresolved) {
        // Search hints do not change persistent matrix judgments or their fingerprints.
        Object.defineProperties(unresolved, {
          matchedDocuments: { value: [...new Set(candidates)] },
          relatedDocuments: { value: [...relatedDocuments] },
        });
        return unresolved;
      }
      return { key: requirement.key, status: "conform", reason: "已核验档案满足可解析的企业资质条款", documents: [...new Set(candidates)] };
    }
    if (requirement.key === "REQ_SAFETY_LIC" && excerpts.every(text =>
      /^(?:(?:资格要求|资格条件|安全生产许可)[：:]\s*)?(?:投标人|供应商|申请人|响应人)?(?:应当|必须|应|须)?(?:具备|具有|提供|持有|取得)?\s*(?:合法有效的|有效的?|在有效期内的)?(?:安全生产许可证|安许证)(?:在有效期内)?[。\s]*$/.test(text) &&
      /有效|具备|具有|提供|须|持有/.test(text))) {
      const candidates = holdings.filter(doc => /安全生产许可证|安许证/.test(`${doc.category} ${doc.label}`));
      if (candidates.some(doc => doc.usable)) return { key: requirement.key, status: "conform", reason: "已核验有效安全生产许可证", documents: candidates.filter(doc => doc.usable) };
      return candidates.length ? pending("有效期或核验状态待核", candidates)
        : { key: requirement.key, status: "missing", reason: "档案缺失", documents: [] };
    }
    return pending("条款须人工核实");
  });
  const stated = requirements.filter(item => item.reason !== "公告未写明");
  const outcome = stated.some(item => item.status === "conform") && stated.every(item => ["conform", "na"].includes(item.status)) &&
    Object.values(evidence.completeness).every(Boolean) &&
    !["deadline", "registrationDeadline", "openTime"].some(key => evidence.fields[key].state === "conflict")
    ? "conform" : "pending";
  return { outcome, requirements };
}
