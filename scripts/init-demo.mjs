import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createApp } from "../runtime/selfhost/server.mjs";
import { initStore, openStore, transaction } from "../runtime/selfhost/store.mjs";

const args = process.argv.slice(2);
const empty = args.includes("--empty");
const paths = args.filter(value => value !== "--empty");
if (paths.length > 1 || paths.some(value => value.startsWith("-"))) throw new Error("Pass a data directory and optionally --empty.");
const dir = resolve(paths[0] || (empty ? "local-data" : "demo-data"));
const now = BigInt(Date.now()) * 1000000n;
const deadline = now + 48n * 3600n * 1000000000n;
const companies = empty ? [] : [
  { id: "demo-construction", name: "示例市政工程公司" },
  { id: "demo-services", name: "示例咨询服务公司" },
];
const notices = empty ? [] : [
  { id: "900001", title: "示例公园步道维修工程招标公告", projectKey: "DEMO-C-01", stage: "tender",
    body: "投标人须具备市政公用工程施工总承包二级。项目预算：人民币88万元。" },
  { id: "900002", title: "示例公园步道维修工程更正公告", projectKey: "DEMO-C-01", stage: "amendment",
    body: "更正事项：踏勘集合地点调整为示例北门。" },
  { id: "900003", title: "示例建筑能耗诊断服务采购意向", projectKey: "DEMO-S-01", stage: "intent",
    body: "拟采购能耗诊断服务。预计采购金额：人民币18万元。" },
].map(notice => ({
  ...notice, source: "虚构示例来源", sourceKey: "demo", region: "示例市",
  tenderer: "示例采购单位", tradeType: notice.projectKey.includes("-C-") ? "工程建设" : "服务",
  attachments: [], originalStatus: "captured", published: now.toString(),
  deadline: notice.stage === "tender" ? deadline.toString() : "0",
}));

const adminId = empty ? (process.env.CIVIC_RADAR_ADMIN_USERNAME || "workspace_admin") : "demo_admin";
if (!/^[a-z0-9][a-z0-9._]{2,29}$/.test(adminId)) throw new Error("Choose a lowercase administrator name of 3 to 30 letters, digits, dots or underscores.");
const issued = await initStore(dir, {
  format: 1, source: "fictional-icp", companies, notices,
  accounts: [{ id: adminId, username: adminId, name: empty ? "工作区管理员" : "演示管理员", role: "admin", approval: "approved", perspective: "lead" }],
  grants: companies.map(company => ({ account: adminId, company: company.id, view: true, edit: true, verify: true })),
  scopes: [], attachments: [], history: [], finance: [],
});
const store = openStore(dir, "http://localhost:4201");
try {
  createApp(store);
  transaction(store.db, () => {
    const insert = store.db.prepare(`INSERT INTO notice_meta
      (id,title,source,source_key,project_key,stage,stage_label,region,trade_type,tenderer,published_ns,deadline_ns,original_status)
      VALUES(?,?,?,?,?,?,?,?,?,?,CAST(? AS INTEGER),CAST(? AS INTEGER),'captured')`);
    for (const n of notices) {
      insert.run(n.id, n.title, n.source, n.sourceKey, n.projectKey, n.stage,
        { tender: "招标公告", amendment: "更正公告", intent: "采购意向" }[n.stage],
        n.region,n.tradeType,n.tenderer,n.published,n.deadline);
    }
    if (empty) return;
    const validUntil = new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10);
    store.db.prepare(`INSERT INTO company_doc
      (id,company_id,category,name,valid_until,status,qual_items_json,updated_by)
      VALUES('demo-company-license','demo-construction','企业资质','示例企业资质证书',?,'verified',?,'demo_admin')`)
      .run(validUntil, JSON.stringify([{ name: "市政公用工程施工总承包二级" }]));
  });
} finally {
  store.db.close();
}

writeFileSync(join(dir, "demo-login.json"), JSON.stringify(issued[0], null, 2), { mode: 0o600, flag: "wx" });
console.log("Workspace initialized. Read demo-login.json in the chosen data directory locally.");
