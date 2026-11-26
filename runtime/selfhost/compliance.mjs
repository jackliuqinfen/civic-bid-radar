/**
 * Deterministic 21-item bidding compliance & disqualification self-check engine
 * Adapted from BidMaster-Pro's 21 compliance dimensions (MIT License),
 * strictly enforcing zero-hallucination & human verification rules:
 * - Never auto-claims "满足/合格/通过"
 * - Unknown or unregistered items are explicitly marked "未标注" or "待补（未登记）"
 */

export const COMPLIANCE_RULES = [
  { code: "R01_QUAL_CORP", dim: "资格硬门槛", title: "企业主体资质等级与范围核对", severity: "hard" },
  { code: "R02_SAFETY_LIC", dim: "资格硬门槛", title: "安全生产许可证有效性核对", severity: "hard" },
  { code: "R03_PM_CERT", dim: "资格硬门槛", title: "项目经理/建造师等级与在建锁证核对", severity: "hard" },
  { code: "R04_JOINT_BID", dim: "资格硬门槛", title: "联合体投标限制与协议核对", severity: "hard" },
  { code: "R05_SME_POLICY", dim: "资格硬门槛", title: "专门面向中小企业声明函核对", severity: "hard" },
  { code: "R06_CREDIT_BAN", dim: "资格硬门槛", title: "信用中国/失信被执行人/重大税收违法核查", severity: "hard" },
  { code: "R07_DEPOSIT_AMT", dim: "资金与保证金", title: "投标保证金/保函金额、形式与账户核对", severity: "hard" },
  { code: "R08_DEPOSIT_DUE", dim: "资金与保证金", title: "保证金缴纳截止时间与基本户转出核对", severity: "hard" },
  { code: "R09_BUDGET_CAP", dim: "报价与商务", title: "最高投标限价/控制价红线校验（不得超限价）", severity: "hard" },
  { code: "R10_PRICE_LOGIC", dim: "报价与商务", title: "报价大小写、分项汇总与工程量清单一致性", severity: "hard" },
  { code: "R11_BID_VALIDITY", dim: "报价与商务", title: "投标有效期与工期/质保期实质性响应", severity: "hard" },
  { code: "R12_AMENDMENT", dim: "变更与时效", title: "最新更正/答疑/补遗公告条款核对", severity: "hard" },
  { code: "R13_DEADLINE", dim: "变更与时效", title: "递交截止、开标时间及开标方式核对", severity: "hard" },
  { code: "R14_DOC_EXPIRY", dim: "资料有效性", title: "营业执照/资质/人员证书有效期覆盖开标日", severity: "hard" },
  { code: "R15_PERFORMANCE", dim: "评审与竞争力", title: "类似项目业绩合同与竣工验收证明核对", severity: "score" },
  { code: "R16_TECH_SPEC", dim: "评审与竞争力", title: "技术参数/施工组织设计/偏离表逐项响应", severity: "score" },
  { code: "R17_EVAL_METHOD", dim: "评审与竞争力", title: "评标办法与评分细则对应材料核对", severity: "score" },
  { code: "R18_SIGN_SEAL", dim: "签章与格式", title: "法定代表人/授权委托书签字与电子公章核对", severity: "hard" },
  { code: "R19_CONSISTENCY", dim: "签章与格式", title: "项目名称、编号、标段号全文前后一致校验", severity: "hard" },
  { code: "R20_EBID_CA", dim: "递交与解密", title: "电子标书制作工具版本、CA 锁加密与回执测试", severity: "hard" },
  { code: "R21_CONFLICT_RISK", dim: "合规风控", title: "集团关联公司/联系人/硬件特征码串标风险排查", severity: "hard" },
];

export function evaluateCompliance({ notice, timeline = [], companyDocs = [], companyPeople = [], savedChecks = [] }) {
  const body = String(notice.body || "");
  const qualTags = Array.isArray(notice.qualTags) ? notice.qualTags : [];
  const quals = Array.isArray(notice.qualifications) ? notice.qualifications : [];
  const savedMap = new Map(savedChecks.map((c) => [c.rule_code, c]));
  const today = new Date().toISOString().slice(0, 10);
  const amendCount = timeline.filter((t) => t.isAmendment).length;

  const activeDocs = companyDocs.filter((d) => d.status !== "void");
  const expiredDocs = activeDocs.filter((d) => d.valid_until && d.valid_until < today);
  const lockedPeople = companyPeople.filter((p) => p.status === "active" && p.lock_status === "locked");
  const availPMs = companyPeople.filter((p) => p.status === "active" && p.lock_status === "available" && /建造师|项目经理/.test((p.role_title || "") + (p.cert_level || "")));

  return COMPLIANCE_RULES.map((rule) => {
    const saved = savedMap.get(rule.code);
    let autoExcerpt = "";
    let autoFlag = "pending"; // pending | warn | missing

    switch (rule.code) {
      case "R01_QUAL_CORP":
        if (qualTags.length || quals.length) {
          autoExcerpt = `公告提取标签：${qualTags.join("、") || "见原文"}。${quals[0] ? "原文摘录：" + quals[0].slice(0, 110) : ""}`;
          if (activeDocs.length === 0) { autoFlag = "missing"; autoExcerpt += "（所选公司尚未登记资质资料，待补）"; }
        } else {
          autoExcerpt = "原文未提取到明确资质条款，请人工核对招标文件。";
        }
        break;
      case "R02_SAFETY_LIC": {
        const mentionsSafety = qualTags.includes("安许证") || /安全生产许可证/.test(body);
        const safetyDoc = activeDocs.find((d) => d.category === "安全生产许可证" || /安全生产/.test(d.name));
        if (mentionsSafety) {
          autoExcerpt = safetyDoc
            ? `公告提及安全生产许可证；已登记「${safetyDoc.name}」（有效期至 ${safetyDoc.valid_until || "未标注"}）。`
            : "公告提及安全生产许可证；当前公司资料库未登记（待补）。";
          if (!safetyDoc || (safetyDoc.valid_until && safetyDoc.valid_until < today)) autoFlag = "warn";
        } else {
          autoExcerpt = "公告正文未检出「安全生产许可证」字样，请核实是否属于不适用（须附依据）。";
        }
        break;
      }
      case "R03_PM_CERT": {
        const mentionsPM = qualTags.includes("建造师") || /项目经理|项目负责人|注册建造师/.test(body);
        if (mentionsPM) {
          autoExcerpt = `公告提及项目经理/建造师要求。当前可用建造师 ${availPMs.length} 人，在建锁定 ${lockedPeople.length} 人。`;
          if (availPMs.length === 0) autoFlag = "warn";
        } else {
          autoExcerpt = "公告正文未检出明确建造师条款，请核查招标文件。";
        }
        break;
      }
      case "R04_JOINT_BID":
        if (/不接受联合体/.test(body)) { autoExcerpt = "原文检出「不接受联合体投标」，须独立主体参投。"; autoFlag = "warn"; }
        else if (/接受联合体/.test(body)) { autoExcerpt = "原文检出「接受联合体投标」，需核对联合体协议及牵头人要求。"; }
        else { autoExcerpt = "原文未明确是否接受联合体，未标注。"; }
        break;
      case "R05_SME_POLICY":
        if (/专门面向中小企业|全部由中小企业/.test(body)) {
          autoExcerpt = "原文检出「专门面向中小企业采购」，须核对企业划型及《中小企业声明函》（缺漏将直接废标）。";
          autoFlag = "warn";
        } else {
          autoExcerpt = "原文未检出专门面向中小企业限制，未标注。";
        }
        break;
      case "R07_DEPOSIT_AMT":
      case "R08_DEPOSIT_DUE":
        autoExcerpt = notice.depositText
          ? `自动提取条款：${notice.depositText}`
          : "原文未提取到保证金金额或免缴条款，按招标文件约定。";
        break;
      case "R09_BUDGET_CAP":
        autoExcerpt = notice.budgetYuan
          ? `自动提取控制价/预算：${Number(notice.budgetYuan).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 元（投标报价不得高于最高限价）。`
          : "原文未载预算或最高限价，未标注。";
        break;
      case "R12_AMENDMENT":
        autoExcerpt = amendCount > 0
          ? `检测到同项目存在 ${amendCount} 条更正/答疑公告，请逐条核对时间、预算与清单变动。`
          : "当前未检索到更正/答疑公告，递交前仍需复核原站。";
        if (amendCount > 0) autoFlag = "warn";
        break;
      case "R13_DEADLINE":
        autoExcerpt = notice.deadlineText
          ? `自动提取截止：${notice.deadlineText} 北京时间${notice.openTimeText ? `；开标：${notice.openTimeText} 北京时间` : ""}。`
          : "原文未提取到明确截止时间，未标注。";
        break;
      case "R14_DOC_EXPIRY":
        if (expiredDocs.length > 0) {
          autoExcerpt = `警告：所选公司存在 ${expiredDocs.length} 份已过期资料（${expiredDocs.slice(0, 3).map((d) => d.name).join("、")}），须立即核查！`;
          autoFlag = "warn";
        } else if (activeDocs.length > 0) {
          autoExcerpt = `已核查 ${activeDocs.length} 份已登记资料，未检出早于今日（${today}）的过期项；仍需核对是否覆盖预计开标日。`;
        } else {
          autoExcerpt = "尚未关联公司或未登记资料有效期（待补）。";
          autoFlag = "missing";
        }
        break;
      case "R17_EVAL_METHOD":
        autoExcerpt = notice.evalMethod
          ? `自动提取评标办法：${notice.evalMethod}。请对照评分细则核对响应材料。`
          : "原文未提取到明确评标办法，未标注。";
        break;
      default:
        autoExcerpt = "待人工对照招标文件原文逐项核实。";
        break;
    }

    return {
      code: rule.code,
      dim: rule.dim,
      title: rule.title,
      severity: rule.severity,
      autoExcerpt,
      autoFlag,
      status: saved?.status || "pending", // pending | conform | non_conform | na
      basis: saved?.basis || "",
      updatedBy: saved?.updated_by_name || "",
      updatedAt: saved?.updated_at || "",
    };
  });
}
