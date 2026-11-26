import { extractNoticeEvidence, evaluateNoticeRequirements } from "./noticeEvidence.mjs";

const SPECIALTY_PATTERNS = [
  { key: "建筑工程", eng: true, re: /建筑工程|房屋建筑|房建|土建|厂房建设|教学楼|办公楼|宿舍楼|安置房|保障房|校舍|农房|零星维修|修缮工程/ },
  { key: "市政公用", eng: true, re: /市政公用|市政工程|市政道路|城市道路|道路改造|道路施工|道路路面|桥梁工程|管网|给排水|雨污分流|污水管|供水管|供热管|燃气管|人行道|公园广场/ },
  { key: "水利水电", eng: true, re: /水利水电|水利工程|河道|防洪|闸站|堤防|灌区|泵站|清淤|护坡|农田水利|高标准农田|水库|引水/ },
  { key: "公路交通", eng: true, re: /公路工程|交通工程|航道|港口|码头|路基|路面|交安|交通安全设施|农村公路|农路|国省道|高速公路/ },
  { key: "机电安装", eng: true, re: /机电工程|机电安装|建筑机电|电力工程|电力施工|输变电|变电站|配电|供电|承装修试|承装.*电力|强电|高压电|电缆敷设|暖通|空调安装|电梯安装|光伏|风电|充电桩/ },
  { key: "装饰装修", eng: true, re: /装修装饰|装饰装修|室内装修|装修改造|出新工程|外立面改造|幕墙|吊顶|门窗改造|室内装饰|病房改造|大堂.*改造/ },
  { key: "防水防腐保温", eng: true, re: /防水防腐保温|防水工程|屋面防水|外墙防水|渗水维修|补漏|防腐工程|保温工程|外墙保温/ },
  { key: "特种工程", eng: true, re: /特种工程|结构补强|建筑加固|结构加固|纠偏|平移|抗震加固|危房加固|桥梁加固/ },
  { key: "园林绿化", eng: true, re: /园林绿化|绿化工程|景观工程|苗木栽植|绿化养护|生态修复/ },
  { key: "钢结构", eng: true, re: /钢结构|网架工程|彩钢棚|钢构/ },
  { key: "消防设施", eng: true, re: /消防设施|消防工程|消防改造|消防维修|消防维保/ },
  { key: "环保工程", eng: true, re: /环保工程|环境工程|污水处理厂|废气治理|生态治理|土壤修复/ },
  { key: "地基基础", eng: true, re: /地基基础|桩基工程|基坑支护|土石方工程|边坡支护/ },
  { key: "照明工程", eng: true, re: /城市及道路照明|照明工程|亮化工程|路灯工程|路灯改造|路灯更换/ },
  { key: "电子智能化", eng: true, re: /电子与智能化|智能化工程|弱电工程|安防监控|智慧园区/ },
  { key: "古建筑", eng: true, re: /古建筑工程|古建修缮/ },
  { key: "勘察设计", eng: true, re: /工程设计|工程勘察|设计资质|勘察设计|施工图设计|初步设计/ },
  { key: "工程监理", eng: true, re: /工程监理|监理资质|施工监理|全过程监理/ },
  { key: "劳务分包", eng: true, re: /施工劳务|劳务分包/ },
];

const ENGINEERING_KEYS = new Set(SPECIALTY_PATTERNS.map((p) => p.key));
function parseGrade(text) {
  if (/特级/.test(text)) return { grade: 0, label: "特级" };
  if (/一级|壹级|甲级/.test(text)) return { grade: 1, label: "一级/甲级" };
  if (/二级|贰级|乙级/.test(text)) return { grade: 2, label: "二级/乙级" };
  if (/三级|叁级|丙级/.test(text)) return { grade: 3, label: "三级/丙级" };
  if (/不分等级/.test(text)) return { grade: 3, label: "不分等级" };
  return { grade: null, label: "" };
}

export function shortCompanyName(fullName) {
  let s = String(fullName || "").trim();
  s = s.replace(/^(江苏|盐城|盐城市|南京|苏州|中国)/, "");
  s = s.replace(/(建设工程|建筑工程|工程建设|项目管理|集团有限公司|有限公司|公司).*$/, "");
  s = s.trim();
  return s.length >= 2 ? s.slice(0, 4) : String(fullName || "").slice(0, 4);
}

export function extractCompanyCapabilities(docs, todayStr = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)) {
  const specs = [];
  let hasSafety = false;
  let safetyValid = false;

  const pushFromText = (rawText, docName, expired, verified) => {
    const text = String(rawText || "").trim();
    if (!text) return;
    if (/安全生产许可证/.test(text)) {
      hasSafety = true;
      if (!expired) safetyValid = true;
      return;
    }
    const { grade, label } = parseGrade(text);
    const matchedKeys = SPECIALTY_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.key);
    for (const key of matchedKeys) {
      specs.push({ key, grade, gradeLabel: label, docName: docName || text, expired, verified });
    }
  };

  for (const d of docs) {
    if (d.status === "void" || d.status === "missing") continue;
    const expired = Boolean(d.valid_until && d.valid_until < todayStr);
    const verified = d.status === "verified";
    const headText = `${d.category || ""} ${d.name || ""}`;
    if (/安全生产许可证/.test(headText)) {
      hasSafety = true;
      if (!expired) safetyValid = true;
      continue;
    }
    let parsedItems = [];
    try {
      const arr = JSON.parse(d.qual_items_json || "[]");
      if (Array.isArray(arr)) parsedItems = arr.map((x) => (typeof x === "string" ? x : x?.name)).filter(Boolean);
    } catch {}
    if (parsedItems.length) {
      for (const itemName of parsedItems) pushFromText(itemName, itemName, expired, verified);
    }
    pushFromText(headText, d.name, expired, verified);
  }

  const seen = new Set();
  const deduped = [];
  for (const s of specs) {
    const k = `${s.key}|${s.grade}|${s.expired}|${s.docName}`;
    if (!seen.has(k)) {
      seen.add(k);
      deduped.push(s);
    }
  }
  const hasEngineeringQual = deduped.some((s) => !s.expired && ENGINEERING_KEYS.has(s.key));
  return { specs: deduped, hasSafety, safetyValid, hasEngineeringQual, documents: docs, evaluatedOn: todayStr };
}

export function describeCapabilities(caps) {
  const labels = [];
  const seen = new Set();
  for (const s of caps.specs) {
    const tag = `${s.key}${s.gradeLabel ? "·" + s.gradeLabel : ""}${s.expired ? "(已过期)" : ""}`;
    if (!seen.has(tag)) {
      seen.add(tag);
      labels.push(tag);
    }
  }
  if (caps.hasSafety) labels.push(caps.safetyValid ? "安许证" : "安许证(已过期)");
  return labels;
}

export function matchNoticeToCapabilities(notice, caps) {
  const evidence = notice.evidence || extractNoticeEvidence(notice);
  const match = evaluateNoticeRequirements(evidence, caps?.documents || [], caps?.evaluatedOn, caps?.personnel || []);
  if (match.outcome !== "conform") return null;
  const warnings = match.requirements
    .filter((r) => r.status === "pending" && r.reason !== "公告未写明")
    .map((r) => r.reason)
    .slice(0, 2);
  return {
    matched: true,
    reasons: match.requirements.filter(requirement => requirement.status === "conform").map(requirement => requirement.reason),
    warnings,
  };
}
