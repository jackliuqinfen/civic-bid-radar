import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { inferNoticeBudget, inferNoticeFields, inferRegion, inferStage } from "./custom-source-evidence.mjs";
import { installYanchengPublicSources, runCustomSourceById } from "./custom-source-runner.mjs";

function workspace(t) {
  const dir = mkdtempSync(join(tmpdir(), "radar-source-test-"));
  const path = join(dir, "workspace.db");
  const db = new DatabaseSync(path);
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  db.exec(`
    CREATE TABLE notice(id TEXT PRIMARY KEY, title TEXT, owner TEXT, draft INTEGER, data TEXT);
    CREATE TABLE notice_meta(
      id TEXT PRIMARY KEY, title TEXT, source TEXT, source_key TEXT, tenderer TEXT, agency TEXT,
      region TEXT, trade_type TEXT, category TEXT, stage TEXT, stage_label TEXT, project_key TEXT,
      published_ns INTEGER, deadline_ns INTEGER, deadline_text TEXT, budget_yuan INTEGER, budget_text TEXT,
      qual_tags TEXT, eval_method TEXT, deposit_text TEXT, original_status TEXT, has_attachments INTEGER,
      source_updated_at TEXT, url TEXT
    );
    CREATE TABLE custom_source (
      id TEXT PRIMARY KEY, key TEXT UNIQUE, name TEXT, list_url TEXT, region TEXT, trade_type TEXT,
      link_selector TEXT DEFAULT '', keyword_filter TEXT DEFAULT '', enabled INTEGER DEFAULT 1,
      created_by TEXT, last_run_at TEXT DEFAULT '', last_count INTEGER DEFAULT 0,
      last_error TEXT DEFAULT '', updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE source_health(
      key TEXT PRIMARY KEY, name TEXT, enabled INTEGER, checked TEXT, last_ok TEXT,
      failures INTEGER, reason TEXT, last_error TEXT
    );
  `);
  return { db, path };
}

const exampleUrl = "https://example.org/";
const exampleKey = "usr_yc_tinghu";
const source = { id: "testsource", key: exampleKey, name: "隔离测试栏目", list_url: exampleUrl,
  region: "盐城市亭湖区", trade_type: "工程建设", enabled: 1 };
const addSource = (db) => db.prepare("INSERT INTO custom_source(id,key,name,list_url) VALUES(?,?,?,?)")
  .run(source.id, source.key, source.name, source.list_url);
const article = (suffix) => ({ title: "项目招标公告", url: exampleUrl + suffix, published: "2026-11-25" });
const listing = (items, nextUrl = "", terminal = false) => JSON.stringify({
  items, totalFound: items.length, oldestDate: items.at(-1)?.published, newestDate: items[0]?.published, nextUrl, terminal,
});
const detail = (body) => JSON.stringify({ body, bodyStatus: "captured", attachmentStatus: "linked",
  attachments: [{ name: "招标文件.pdf", url: exampleUrl + "file.pdf" }] });

test("公开栏目目录可幂等安装", (t) => {
  const {db, path} = workspace(t);
  const first = installYanchengPublicSources(path);
  assert.equal(first.installed, first.total);
  assert.equal(installYanchengPublicSources(path).installed, 0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM custom_source").get().n, first.total);
});

test("公告ID碰撞保留既有来源，重试在同一公告上追加正文版本", async (t) => {
  const {db, path} = workspace(t);
  addSource(db);
  const item = article("a");
  const hex = createHash("sha256").update(`${source.key}|${item.url}`).digest("hex").slice(0, 8);
  const occupied = String(8_000_000_000 + parseInt(hex, 16) % 999_999_999);
  db.prepare("INSERT INTO notice VALUES(?,'既有公告',NULL,0,'{}')").run(occupied);
  db.prepare("INSERT INTO notice_meta(id,source_key,url) VALUES(?,'legacy','https://example.org/existing')").run(occupied);
  let attempts = 0;
  const readPage = async (_, _selector, _keywords, mode) => mode === "list" ? listing([item])
    : detail(`项目地点：盐城市盐都区\n采购人：盐城测试单位\n项目编号：JSZC-2026-CS-0031\n投标截止时间：2026年12月3日下午2时30分\n正文第 ${++attempts} 版`);
  assert.equal((await runCustomSourceById(path, source, {readPage})).inserted, 1);
  assert.equal((await runCustomSourceById(path, source, {readPage})).updated, 1);
  const current = db.prepare(`SELECT id,region,stage,project_key,tenderer,CAST(deadline_ns AS TEXT) AS deadline
    FROM notice_meta WHERE url=?`).get(item.url);
  assert.notEqual(current.id, occupied);
  assert.equal(current.region, "盐城市盐都区");
  assert.equal(db.prepare("SELECT title FROM notice WHERE id=?").get(occupied).title, "既有公告");
  assert.equal(db.prepare("SELECT count(*) AS n FROM custom_source_version WHERE url=?").get(item.url).n, 2);
  const data = JSON.parse(db.prepare("SELECT data FROM notice WHERE id=?").get(current.id).data);
  const { evidence } = data;
  assert.equal(data.stage, current.stage);
  assert.equal(data.projectKey, current.project_key);
  assert.equal(data.tenderer, current.tenderer);
  assert.equal(data.deadline, current.deadline);
  assert.equal(data.deadlineText, "2026-12-03 14:30");
  assert.equal(evidence.attachmentStatus, "linked");
  assert.equal(evidence.attachments.length, 1);
  assert.equal(db.prepare("SELECT status FROM custom_source_coverage WHERE source_key=?").get(source.key).status, "surface_only");
});

test("分页错误保留入池记录，恢复重扫前两页并检查跨轮锚点", async (t) => {
  const {db, path} = workspace(t);
  addSource(db);
  let phase = 1;
  const visited = [];
  const pageUrls = [exampleUrl, ...[2, 3, 4, 5].map((i) => exampleUrl + "list" + i)];
  const readPage = async (url, _selector, _keywords, mode) => {
    if (mode === "detail-json") return detail("公告正文");
    const index = pageUrls.indexOf(url);
    visited.push(index + 1);
    if (phase === 1 && index === 4) throw new Error("响应超时");
    if (phase === 3 && index === 3) return listing([article("replacement")], pageUrls[4]);
    const entries = [article(String(index))];
    if (phase >= 2 && index === 1) entries.unshift(article("new-on-page-2"));
    return listing(entries, pageUrls[index + 1], index === 4);
  };
  const first = await runCustomSourceById(path, source, {readPage});
  assert.equal(first.coverage.status, "window_pending");
  assert.equal(first.coverage.next, pageUrls[4]);
  phase = 3;
  visited.length = 0;
  const moved = await runCustomSourceById(path, source, {readPage});
  assert.deepEqual(visited, [1, 2, 4, 3]);
  assert.equal(moved.coverage.status, "window_pending");
  phase = 2;
  visited.length = 0;
  await runCustomSourceById(path, source, {readPage});
  assert.deepEqual(visited, [1, 2, 3, 4]);
  visited.length = 0;
  assert.equal((await runCustomSourceById(path, source, {readPage})).coverage.status, "complete");
  assert.deepEqual(visited, [1, 2, 4, 5]);
  assert.equal(db.prepare("SELECT count(*) AS n FROM notice_meta WHERE url=?").get(exampleUrl + "new-on-page-2").n, 1);
});

test("交易阶段优先识别变更与终止，区县只使用项目地点或标题特征", () => {
  assert.equal(inferStage("办公楼工程中标结果更正公告").stage, "amendment");
  assert.equal(inferStage("办公楼改造采购项目中标结果终止公告").stage, "terminated");
  assert.equal(inferStage("办公楼改造项目中标候选人公示").label, "中标候选人公示");
  assert.equal(inferStage("政府采购意向公告").stage, "intent");
  assert.equal(inferRegion("检修项目采购", "中标供应商地址：建湖县", "盐城市亭湖区").region, "盐城市亭湖区");
  assert.equal(inferRegion("盐城市某单位施工采购", "2.1项目建设地点：江苏省南京市\n招标人：盐城某单位", "盐城市").region, "外地");
  assert.equal(inferRegion("某省级单位施工采购", "2.1项目建设地点：盐城市滨海县\n招标人：外地单位", "盐城市").region, "盐城市滨海县");
  assert.equal(inferRegion("跨市项目施工采购", "2.1项目建设地点：淮安市、盐城市。", "盐城市").regionBasis, "正文项目地点含盐城及外地");
  assert.equal(inferNoticeFields("维修工程", "报名截止时间：2026年11月30日 10:00", "tender").deadline, "0");
  assert.equal(inferNoticeFields("维修工程", "投标截止时间：2026年11月30日", "tender").deadline, "0");
  assert.equal(inferNoticeFields("维修工程", "投标截止时间：2026年11月31日 10:00", "tender").deadline, "0");
  assert.equal(inferNoticeFields("维修工程", "并于2026-12-03 14:30（北京时间）前递交投标文件。", "tender").deadlineText, "2026-12-03 14:30");
  const conflict = inferNoticeFields("维修工程", "投标截止时间：2026-11-28 10:00\n响应截止时间：2026-11-29 15:00", "tender");
  assert.equal(conflict.deadline, "0");
  assert.equal(conflict.deadlineStatus, "conflict");
});

test("同名公告独立成项，曾经采全的公告遇到正文截断也标为不完整", async (t) => {
  const {db, path} = workspace(t);
  addSource(db);
  const a = article("a"), b = article("b");
  let truncated = false;
  const readPage = async (url, _selector, _keywords, mode) => {
    if (mode === "list") return listing([a, b]);
    if (!truncated || url === b.url) return detail("原文");
    return JSON.stringify({ body: "部分", bodyStatus: "truncated", attachmentStatus: "not_checked", attachments: [] });
  };
  await runCustomSourceById(path, source, {readPage});
  truncated = true;
  await runCustomSourceById(path, source, {readPage});
  const first = db.prepare("SELECT project_key,original_status FROM notice_meta WHERE url=?").get(a.url);
  const second = db.prepare("SELECT project_key,original_status FROM notice_meta WHERE url=?").get(b.url);
  assert.notEqual(first.project_key, second.project_key);
  assert.equal(first.original_status, "uncached");
  assert.equal(second.original_status, "captured");
  const versions = db.prepare("SELECT body_status FROM custom_source_version WHERE url=? ORDER BY body_status").all(a.url);
  assert.deepEqual(versions.map(({body_status}) => body_status), ["captured", "truncated"]);
});

test("公开公告总额排除年度限价、单价、分期和无单位金额", () => {
  const sample = "https://sbc.yctu.edu.cn/2026/1103/c872a157169/page.htm";
  assert.deepEqual(inferNoticeBudget("最高限价：30万元/年。预算金额：60万元（服务期2年）。"),
    { yuan: 600000, text: "60万元" }, sample);
  for (const text of [
    "最高限价：30万元/年。",
    "采购预算：30。",
    "采购预算：30万。",
    "采购预算：30万元（第一年）。",
    "第一期预算金额：30万元。",
    "采购预算：30万元至50万元。",
    "预算金额：30万元。预算金额：50万元。",
    "预算金额：5万元/套。",
  ]) assert.equal(inferNoticeBudget(text), null, text);
  assert.deepEqual(inferNoticeBudget("预算金额（万元）：60。"), { yuan: 600000, text: "60万元" });
  assert.deepEqual(inferNoticeBudget("最高限价：21.25989万元。"), { yuan: 212599, text: "21.25989万元" });
});

test("后台补齐用总预算和明确递交截止，不用报名或开标推算", (t) => {
  const { db, path } = workspace(t);
  db.exec("CREATE TABLE notice_html_cache(notice_id TEXT, html TEXT)");
  const add = db.prepare("INSERT INTO notice VALUES(?,'样本',NULL,0,?)");
  const addMeta = db.prepare("INSERT INTO notice_meta(id,stage,budget_yuan,deadline_ns) VALUES (?,'tender',NULL,0)");
  add.run("school", JSON.stringify({ body: "最高限价：30万元/年。预算金额：60万元（服务期2年）。报名截止时间：2026-12-02 09:00。" }));
  add.run("dongtai", JSON.stringify({ body: "最高限价：21.25989万元。投标截止时间和开标时间为2026年12月8日9时00分。" }));
  addMeta.run("school");
  addMeta.run("dongtai");
  execFileSync(process.execPath, [fileURLToPath(new URL("./enrich-notice-meta.mjs", import.meta.url))], {
    env: { ...process.env, BIDDING_DB_PATH: path },
  });
  const select = db.prepare("SELECT budget_yuan,deadline_text,CAST(deadline_ns AS TEXT) AS deadline FROM notice_meta WHERE id=?");
  assert.equal(select.get("school").budget_yuan, 600000);
  assert.equal(select.get("school").deadline, "0");
  assert.equal(select.get("dongtai").budget_yuan, 212599);
  assert.equal(select.get("dongtai").deadline_text, "2026-12-08 09:00");
});
