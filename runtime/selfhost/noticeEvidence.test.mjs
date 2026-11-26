import assert from "node:assert/strict";
import test from "node:test";
import { extractNoticeEvidence, evaluateNoticeRequirements, sameNoticeScope } from "./noticeEvidence.mjs";

const cert = (name, status = "verified") => ({ id: name, name, status, valid_until: "2027-12-31" });
const date = "2026-11-25";

test("keeps title hints and scoring terms outside mandatory matching", () => {
  const evidence = extractNoticeEvidence({ title: "建筑工程一级施工", body: "评分标准：具备建筑工程施工总承包一级的得2分。" });
  assert.equal(evidence.requirements[0].state, "not_stated");
  assert.equal(evidence.scoring.length, 1);
  assert.equal(evaluateNoticeRequirements(evidence, [cert("建筑工程施工总承包一级")], date).outcome, "pending");
});

test("checks simultaneous qualifications and does not invent a company qualification grade", () => {
  const evidence = extractNoticeEvidence({ body: "资格要求：具备建筑工程施工总承包二级及以上，同时具备市政公用工程施工总承包三级及以上。" });
  const building = cert("建筑工程施工总承包一级");
  const city = cert("市政公用工程施工总承包三级");
  assert.equal(evaluateNoticeRequirements(evidence, [building], date).requirements[0].reason, "档案缺失");
  assert.equal(evaluateNoticeRequirements(evidence, [building, cert("市政公用工程施工总承包")], date).outcome, "pending");
  assert.equal(evaluateNoticeRequirements(evidence, [building, city], date).requirements[0].status, "conform");
  const explicitBoth = extractNoticeEvidence({ body: "投标人须同时具备市政公用工程施工总承包二级和建筑工程施工总承包二级。" });
  assert.equal(evaluateNoticeRequirements(explicitBoth, [
    cert("建筑工程施工总承包二级"), cert("市政公用工程施工总承包二级"),
  ], date).requirements[0].status, "conform");
});

test("handles explicit alternatives, verified status and expiry", () => {
  const evidence = extractNoticeEvidence({ body: "资格条件：具备建筑工程施工总承包二级或市政公用工程施工总承包二级。" });
  assert.equal(evaluateNoticeRequirements(evidence, [cert("市政公用工程施工总承包二级")], date).requirements[0].status, "conform");
  assert.equal(evaluateNoticeRequirements(evidence, [cert("市政公用工程施工总承包一级")], date).outcome, "pending");
  assert.equal(evaluateNoticeRequirements(evidence, [cert("市政公用工程施工总承包一级", "pending")], date).outcome, "pending");
  assert.equal(evaluateNoticeRequirements(evidence, [{ ...cert("市政公用工程施工总承包一级"), valid_until: "2026-11-24" }], date).outcome, "pending");
});

test("preserves conflicting attachment and notice quotes, time and budget provenance", () => {
  const evidence = extractNoticeEvidence({
    body: "投标截止时间：2026年12月4日 09:00。最高限价：120万元。",
    documents: [{ label: "更正公告", kind: "amendment", body: "投标截止时间：2026年12月5日 09:00。最高限价：130万元。" }],
  });
  assert.equal(evidence.fields.deadline.state, "conflict");
  assert.equal(evidence.fields.budget.state, "conflict");
  assert.equal(evidence.fields.deadline.entries[1].source, "更正公告");
});

test("does not treat an unparsed requirement or unread attachment as satisfied", () => {
  const doc = cert("建筑工程施工总承包一级");
  for (const condition of ["并配备两名注册结构工程师", "供应商应为在本市登记", "近三年未发生重大安全事故", "还须提交技术服务方案"]) {
    const evidence = extractNoticeEvidence({
      body: `资格要求：投标人须具备建筑工程施工总承包二级及以上资质，${condition}。`,
    });
    assert.equal(evaluateNoticeRequirements(evidence, [doc], date).outcome, "pending", condition);
  }
  const evidence = extractNoticeEvidence({
    body: "资格要求：投标人须具备建筑工程施工总承包二级及以上资质。",
    attachments: [{ label: "扫描附件", readable: false }],
  });
  assert.equal(evaluateNoticeRequirements(evidence, [doc], date).outcome, "pending");
});

test("isolates lots and rounds and normalizes complete time strings", () => {
  assert.equal(sameNoticeScope({ title: "工程第一分包" }, { title: "工程第二分包公告" }), false);
  assert.equal(sameNoticeScope({ title: "工程", lotKey: "a" }, { title: "工程", lotKey: "b" }), false);
  assert.equal(sameNoticeScope({ title: "工程第2轮" }, { title: "工程第1轮更正" }), false);
  assert.equal(sameNoticeScope({ title: "工程第一分包" }, { title: "工程第1分包更正" }), true);
  const sameTime = extractNoticeEvidence({
    body: "投标截止时间：2026年12月4日9时00分。",
    documents: [{ label: "更正", kind: "amendment", body: "投标截止时间：2026-12-04 09:00。" }],
  });
  assert.equal(sameTime.fields.deadline.state, "stated");
  assert.equal(sameTime.fields.deadline.entries[0].value, "2026年12月4日9时00分");
});

test("reads five explicit procurement methods across construction, goods and services", () => {
  const samples = [
    ["施工", "公开招标"],
    ["施工", "竞争性谈判"],
    ["货物", "询价"],
    ["服务", "竞争性磋商"],
    ["货物", "单一来源"],
  ];
  for (const [scope, method] of samples) {
    const evidence = extractNoticeEvidence({ body: `采购内容：${scope}。采购方式：${method}。` });
    assert.equal(evidence.fields.procurementMethod.entries[0].value, method);
    assert.equal(evaluateNoticeRequirements(evidence, [], date).outcome, "pending");
  }
});

test("keeps joint-bid permission, prohibition, exception and silence distinct", () => {
  const cases = [
    ["本项目接受联合体投标。", "allowed"],
    ["本项目不接受联合体投标。", "prohibited"],
    ["本项目不接受联合体投标，但涉及跨区域专营业务的除外。", "exception"],
    ["采购预算：100万元。", undefined],
  ];
  for (const [body, stance] of cases) {
    const evidence = extractNoticeEvidence({ body });
    const joint = evidence.requirements.find(req => req.key === "REQ_JOINT");
    assert.equal(joint.stance, stance);
    assert.equal(evaluateNoticeRequirements(evidence, [], date).outcome, "pending");
  }
});

test("keeps amounts, deadlines, forms and on-site instructions independent", () => {
  const evidence = extractNoticeEvidence({ body: [
    "采购预算：130万元。最高投标限价：120万元。投标保证金金额：2万元。",
    "投标保证金缴纳截止时间：2026年12月1日09:00。解密截止时间：2026年12月1日10时30分。",
    "投标保证金形式：银行保函或转账。投标保证金退还条件：签订合同后原路退回。",
    "开标地点：市公共资源交易中心。现场签到要求：代表携带身份证原件。",
  ].join("\n") });
  for (const [key, value] of Object.entries({
    procurementBudget: "130万元", budget: "120万元", deposit: "2万元", depositDeadline: "2026年12月1日09:00",
    decryptDeadline: "2026年12月1日10时30分", depositForm: "银行保函或转账",
    depositRefund: "签订合同后原路退回", openPlace: "市公共资源交易中心", siteRequirement: "代表携带身份证原件",
  })) assert.equal(evidence.fields[key].entries[0].value, value, key);
});

test("requires a supported qualification grammar and valid archives on the bid date", () => {
  const building = cert("建筑工程施工总承包一级");
  const beforeDeadline = { ...building, valid_until: "2026-11-26" };
  const evidence = extractNoticeEvidence({ body: "资格要求：具备建筑工程施工总承包二级及以上资质。投标截止时间：2026年12月1日09:00。" });
  assert.equal(evaluateNoticeRequirements(evidence, [beforeDeadline], date).outcome, "pending");
  assert.equal(evaluateNoticeRequirements(evidence, [building], date).outcome, "conform");
  for (const text of [
    "具备建筑工程施工总承包二级及以上或市政公用工程施工总承包二级和钢结构工程专业承包二级",
    "具备建筑工程施工总承包二级及以上资质并经主管部门备案",
  ]) {
    const condition = extractNoticeEvidence({ body: `资格条件：${text}。` });
    assert.equal(evaluateNoticeRequirements(condition, [building], date).outcome, "pending", text);
  }
  const afterScore = extractNoticeEvidence({ body: "评分标准：有业绩得2分。投标人须具有安全生产许可证。" });
  const safety = afterScore.requirements.find(req => req.key === "REQ_SAFETY_LIC");
  assert.equal(safety.state, "stated");
  assert.equal(afterScore.scoring.length, 1);
  assert.equal(evaluateNoticeRequirements(afterScore, [cert("安全生产许可证")], date).outcome, "conform");
});

test("checks an evidenced item while keeping the overall outcome pending when source text is incomplete", () => {
  const clause = "资格要求：具备建筑工程施工总承包二级及以上资质。";
  const doc = cert("建筑工程施工总承包一级");
  const scenarios = [
    { documents: [{ kind: "attachment", label: "附件", body: clause }] },
    { body: clause, documents: [{ kind: "amendment", label: "更正公告", body: "" }] },
    { body: clause, bodyComplete: false },
  ];
  for (const sources of scenarios) {
    const evaluation = evaluateNoticeRequirements(extractNoticeEvidence(sources), [doc], date);
    assert.equal(evaluation.requirements[0].status, "conform");
    assert.equal(evaluation.outcome, "pending");
  }
});
