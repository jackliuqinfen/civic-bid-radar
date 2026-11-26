import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initStore, openStore } from "./store.mjs";
import { listen } from "./server.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const assetsDir = resolve(__dirname, "../frontend/dist-selfhost");

function extractCookie(setCookieHeaders) {
  return setCookieHeaders.map((c) => c.split(";")[0]).join("; ");
}

test("Civic Bid Radar backend integration suite", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "br-test-"), { mode: 0o700 });
  // Ensure directory mode 0700 even if umask differed
  const snapshot = {
    format: 1,
    source: "fictional-icp",
    accounts: [
      {
        id: "emp_admin_1",
        username: "testadmin",
        name: "测试管理员",
        role: "admin",
        approval: "approved",
        perspective: "lead",
        mustChange: false,
      },
      {
        id: "emp_view_1",
        username: "testviewer",
        name: "只读成员",
        role: "member",
        approval: "approved",
        perspective: "bidder",
        mustChange: false,
      },
    ],
    companies: [{ id: "comp_1", name: "测试建工有限公司" }],
    grants: [
      { account: "emp_admin_1", company: "comp_1", view: true, edit: true, verify: true, sensitiveDownload: true },
      { account: "emp_view_1", company: "comp_1", view: true, edit: false, verify: false, sensitiveDownload: false },
    ],
    notices: [
      {
        id: "10001",
        title: "测试市政道路工程招标公告",
        owner: null,
        draft: false,
        stage: "tender",
        stageLabel: "招标公告",
        source: "测试交易中心",
        sourceKey: "testsrc",
        projectKey: "PRJ-10001",
        region: "盐城市",
        tradeType: "市政工程",
        tenderer: "测试城投公司",
        agency: "测试代理公司",
        budgetYuan: 5000000,
        budgetText: "500万元",
        published: String(Date.now() * 1000000),
        deadline: String((Date.now() + 86400_000 * 5) * 1000000),
        deadlineText: "2026-12-01 09:30",
        openTimeText: "2026-12-01 09:30",
        qualTags: ["市政公用工程施工总承包二级"],
        qualifications: ["具备市政公用工程施工总承包二级及以上资质"],
        url: "https://example.invalid/10001",
        body: "测试正文内容",
        originalStatus: "captured",
      },
    ],
    scopes: [],
    attachments: [],
    history: [],
    finance: [],
  };

  // Save original COS env and clear for deterministic COS-unconfigured test
  const prevCosId = process.env.TOUBIAO_COS_SECRET_ID;
  const prevCosKey = process.env.TOUBIAO_COS_SECRET_KEY;
  delete process.env.TOUBIAO_COS_SECRET_ID;
  delete process.env.TOUBIAO_COS_SECRET_KEY;

  const issued = await initStore(join(dir, "data"), snapshot);
  const adminCreds = issued.find((x) => x.username === "testadmin");
  assert.ok(adminCreds?.password, "initStore should issue admin password");

  const tempPort = 39000 + Math.floor(Math.random() * 1000);
  const origin = `http://127.0.0.1:${tempPort}`;
  const store = openStore(join(dir, "data"), origin);
  const server = listen(store, { port: tempPort, host: "127.0.0.1", assets: assetsDir });
  await new Promise((r) => server.once("listening", r));
  // Seed notice_meta for opportunity endpoints (after listen/ensureAppTables)
  store.db.prepare(`
    INSERT INTO notice_meta(id, title, source, source_key, project_key, stage, stage_label, region, trade_type, tenderer, agency, budget_yuan, budget_text, published_ns, deadline_ns, deadline_text, qual_tags, original_status, has_attachments, url)
    VALUES ('10001', '测试市政道路工程招标公告', '测试交易中心', 'testsrc', 'PRJ-10001', 'tender', '招标公告', '盐城市', '市政工程', '测试城投公司', '测试代理公司', 5000000, '500万元', ?, ?, '2026-12-01 09:30', '["市政公用工程施工总承包二级"]', 'captured', 0, 'https://example.invalid/10001')
  `).run(Date.now() * 1e6, (Date.now() + 86400_000 * 5) * 1e6);

  t.after(async () => {
    if (prevCosId !== undefined) process.env.TOUBIAO_COS_SECRET_ID = prevCosId;
    if (prevCosKey !== undefined) process.env.TOUBIAO_COS_SECRET_KEY = prevCosKey;
    await new Promise((r) => server.close(r));
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const api = async (path, { method = "GET", body, cookie } = {}) => {
    const headers = { Origin: origin };
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    return fetch(`${origin}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  };

  await t.test("unauthenticated session returns 401 and security headers", async () => {
    const indexes = store.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='notice_meta'").all().map((r) => r.name);
    for (const idx of [
      "idx_notice_meta_stage_deadline",
      "idx_notice_meta_tenderer_stage_pub",
      "idx_notice_meta_project_key",
      "idx_notice_meta_source_status",
    ]) {
      assert.ok(indexes.includes(idx), `missing index ${idx}`);
    }
    const res = await api("/api/session");
    assert.equal(res.status, 401);
    const home = await api("/");
    assert.equal(home.status, 200);
    assert.equal(home.headers.get("x-frame-options"), "DENY");
    assert.match(home.headers.get("content-security-policy") || "", /frame-src 'self'/);
  });

  let cookie = "";
  await t.test("sign-in succeeds and mustChange is always false", async () => {
    const res = await api("/api/auth/sign-in/username", {
      method: "POST",
      body: { username: "testadmin", password: adminCreds.password },
    });
    assert.equal(res.status, 200);
    cookie = extractCookie(res.headers.getSetCookie());
    assert.ok(cookie.includes("better-auth.session_token"), "session cookie must be issued");

    const sess = await (await api("/api/session", { cookie })).json();
    assert.equal(sess.username, "testadmin");
    assert.equal(sess.mustChange, false);
  });

  await t.test("batch-follow reports both succeeded and failed (partial failure)", async () => {
    const res = await api("/api/opportunities/batch-follow", {
      method: "POST",
      cookie,
      body: { ids: ["10001", "999999"], decision: "watching", note: "测试批量" },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.succeeded, 1);
    assert.equal(data.failed.length, 1);
    assert.equal(data.failed[0].id, "999999");
  });

  let docId = "";
  let personId = "";
  await t.test("company 4-tab docs & person records save and mask sensitive fields", async () => {
    const d1 = await (await api("/api/companies/comp_1/docs", {
      method: "POST",
      cookie,
      body: { docGroup: "enterprise", category: "资质证书", name: "市政二级", docNo: "D232001", validUntil: "2028-01-01" },
    })).json();
    assert.equal(d1.ok, true);
    docId = d1.id;

    const d2 = await (await api("/api/companies/comp_1/docs", {
      method: "POST",
      cookie,
      body: { docGroup: "social_security", category: "社保权益单", name: "2026年11月社保权益单", periodMonth: "2026-11", remark: "在职38人" },
    })).json();
    assert.equal(d2.ok, true);

    const p1 = await (await api("/api/companies/comp_1/people", {
      method: "POST",
      cookie,
      body: { name: "张工", roleTitle: "项目经理", certLevel: "一级建造师(市政)", lockStatus: "available", socialStatus: "正常连续缴纳", socialUntil: "2026-11", idCard: "320902199001011234" },
    })).json();
    assert.equal(p1.ok, true);
    personId = p1.id;

    const detail = await (await api("/api/companies/comp_1", { cookie })).json();
    assert.equal(detail.docs.length, 2);
    assert.equal(detail.people.length, 1);
    assert.equal(detail.people[0].social_status, "正常连续缴纳");
    assert.equal(detail.people[0].id_card_secret, undefined, "sensitive fields must not leak in detail");

    // Sensitive reveal requires reason
    const badRev = await api(`/api/people/${personId}/reveal`, { method: "POST", cookie, body: { reason: "" } });
    assert.equal(badRev.status, 400);
    const okRev = await api(`/api/people/${personId}/reveal`, { method: "POST", cookie, body: { reason: "标书核对" } });
    assert.equal(okRev.status, 200);
    assert.equal((await okRev.json()).idCard, "320902199001011234");
  });

  await t.test("file upload accepts >64KB PDF payload (no 413), rejects non-PDF, fails closed without COS keys", async () => {
    // 1. Non-PDF magic bytes rejected with 400
    const badRes = await api("/api/companies/comp_1/files", {
      method: "POST",
      cookie,
      body: { ownerType: "doc", ownerId: docId, filename: "bad.pdf", dataBase64: Buffer.from("NOT_A_PDF").toString("base64") },
    });
    assert.equal(badRes.status, 400);

    // 2. Valid >64KB PDF passes maxBody (no 413) and hits COS unconfigured guard (503)
    const bigPdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(120 * 1024, 0x41)]);
    const bigRes = await api("/api/companies/comp_1/files", {
      method: "POST",
      cookie,
      body: { ownerType: "doc", ownerId: docId, filename: "cert.pdf", dataBase64: bigPdf.toString("base64") },
    });
    assert.equal(bigRes.status, 503);

    // 3. /api/files/* route sets SAMEORIGIN header
    const fileRes = await api("/api/files/fil_missing", { cookie });
    assert.equal(fileRes.status, 404);
    assert.equal(fileRes.headers.get("x-frame-options"), "SAMEORIGIN");
    assert.match(fileRes.headers.get("content-security-policy") || "", /frame-ancestors 'self'/);
  });

  await t.test("finance/schedule reject view-only member with 403 & alerts auto-link amendments", async () => {
    const viewerCreds = issued.find((x) => x.username === "testviewer");
    const vLogin = await api("/api/auth/sign-in/username", {
      method: "POST",
      body: { username: "testviewer", password: viewerCreds.password },
    });
    assert.equal(vLogin.status, 200);
    const vCookie = extractCookie(vLogin.headers.getSetCookie());

    // Admin creates a finance entry
    const finOk = await api("/api/finance", {
      method: "POST",
      cookie,
      body: { noticeId: "10001", companyId: "comp_1", category: "deposit", entryType: "paid", amountYuan: 50000 },
    });
    assert.equal(finOk.status, 200);
    const finId = (await finOk.json()).id;

    // View-only user cannot create finance, reverse finance, or create schedule
    assert.equal((await api("/api/finance", {
      method: "POST", cookie: vCookie,
      body: { noticeId: "10001", companyId: "comp_1", category: "deposit", entryType: "paid", amountYuan: 100 },
    })).status, 403);
    assert.equal((await api(`/api/finance/${finId}/reverse`, {
      method: "POST", cookie: vCookie, body: { reason: "越权冲销" },
    })).status, 403);
    assert.equal((await api("/api/schedules", {
      method: "POST", cookie: vCookie,
      body: { noticeId: "10001", companyId: "comp_1", openMode: "现场" },
    })).status, 403);

    // Seed amendment for followed project PRJ-10001 -> GET /api/alerts auto-generates amendment alert
    store.db.prepare(`INSERT INTO notice(id,title,owner,draft,data) VALUES ('10002','测试市政道路工程更正公告',NULL,0,'{}')`).run();
    store.db.prepare(`
      INSERT INTO notice_meta(id, title, source, source_key, project_key, stage, stage_label, region, trade_type, tenderer, agency, budget_yuan, budget_text, published_ns, deadline_ns, deadline_text, qual_tags, original_status, has_attachments, url)
      VALUES ('10002', '测试市政道路工程更正公告', '测试交易中心', 'testsrc', 'PRJ-10001', 'amendment', '更正公告', '盐城市', '市政工程', '测试城投公司', '测试代理公司', 5000000, '500万元', ?, ?, '2026-12-03 09:30', '[]', 'captured', 0, 'https://example.invalid/10002')
    `).run(Date.now() * 1e6, (Date.now() + 86400_000 * 7) * 1e6);

    const alertsRes = await (await api("/api/alerts?status=open&kind=amendment", { cookie })).json();
    assert.ok(alertsRes.items.some((a) => a.noticeId === "10002" && a.kind === "amendment"), "must auto-generate amendment alert");
  });

  await t.test("7-stage lot workflow progresses end-to-end from buying doc to deposit refund", async () => {
    // Stage 1: buy doc
    assert.equal((await api("/api/opportunities/10001/workflow", {
      method: "POST", cookie,
      body: { step: 1, nextStep: 2, companyId: "comp_1", docBuyStatus: "已付费购买标书", docBuyFeeYuan: 300, recordExpense: true },
    })).status, 200);
    // Stage 2: prep bid doc
    assert.equal((await api("/api/opportunities/10001/workflow", {
      method: "POST", cookie,
      body: { step: 2, nextStep: 3, companyId: "comp_1", prepStatus: "已加密上传/封装", prepOwnerId: "emp_admin_1" },
    })).status, 200);
    // Stage 3: pay deposit
    assert.equal((await api("/api/opportunities/10001/workflow", {
      method: "POST", cookie,
      body: { step: 3, nextStep: 4, companyId: "comp_1", category: "deposit", amountYuan: 100000, payStatus: "已汇出" },
    })).status, 200);
    // Stage 4: assign delegate
    assert.equal((await api("/api/opportunities/10001/workflow", {
      method: "POST", cookie,
      body: { step: 4, nextStep: 5, companyId: "comp_1", openMode: "现场", delegateId: "emp_admin_1", venue: "402开标室" },
    })).status, 200);
    // Stage 5: return opening record sheet
    assert.equal((await api("/api/opportunities/10001/workflow", {
      method: "POST", cookie,
      body: { step: 5, nextStep: 6, companyId: "comp_1", openMode: "现场", bids: [{ rank: 1, bidder: "测试建工有限公司", amountYuan: 4650000 }] },
    })).status, 200);
    // Stage 6: predict win
    assert.equal((await api("/api/opportunities/10001/workflow", {
      method: "POST", cookie,
      body: { step: 6, nextStep: 7, companyId: "comp_1", predictStatus: "进入前三候选范围", ourQuoteYuan: 4650000, benchmarkYuan: 4680000, floatRate: "下浮7.00%" },
    })).status, 200);
    // Stage 7: non-win + refund deposit recovery
    assert.equal((await api("/api/opportunities/10001/workflow", {
      method: "POST", cookie,
      body: { step: 7, nextStep: 7, companyId: "comp_1", finalResult: "未中标", candidateStatus: "第二候选人", refundTrackStatus: "保证金已全额退回", recordRefundType: "refund_received", refundAmountYuan: 150000 },
    })).status, 200);

    const detail = await (await api("/api/opportunities/10001", { cookie })).json();
    assert.equal(detail.lifecycle.computedStep, 7);
    assert.equal(detail.lifecycle.workflow.doc_buy_status, "已付费购买标书");
    assert.equal(detail.lifecycle.workflow.prep_status, "已加密上传/封装");
    assert.equal(detail.lifecycle.workflow.predict_status, "进入前三候选范围");
    assert.equal(detail.lifecycle.workflow.refund_track_status, "保证金已全额退回");
    assert.equal(detail.lifecycle.financeSummary.depositOutstandingFen, 0);
  });

  await t.test("review analytics computes paired historical float rate by county/district & company win/loss retrospective", async () => {
    // Seed a paired result notice for PRJ-10001 in 东台市 with control=5,000,000 and win=4,500,000 (10.00% float)
    store.db.prepare(`INSERT INTO notice(id,title,owner,draft,data) VALUES ('10003','东台市测试市政道路工程中标结果公告',NULL,0,?)`).run(
      JSON.stringify({ Content: "中标人：江苏测试市政建设有限公司，中标价450万元" })
    );
    store.db.prepare(`
      INSERT INTO notice_meta(id, title, source, source_key, project_key, stage, stage_label, region, trade_type, tenderer, agency, budget_yuan, budget_text, published_ns, deadline_ns, deadline_text, qual_tags, original_status, has_attachments, url)
      VALUES ('10003', '东台市测试市政道路工程中标结果公告', '测试交易中心', 'testsrc', 'PRJ-10001', 'result', '中标结果', '东台市', '市政工程', '测试城投公司', '测试代理公司', 4500000, '450万元', ?, 0, '', '[]', 'captured', 0, 'https://example.invalid/10003')
    `).run(Date.now() * 1e6);

    const revRes = await api("/api/analytics/review?period=3m&district=all&companyId=comp_1", { cookie });
    assert.equal(revRes.status, 200);
    const rev = await revRes.json();
    assert.equal(rev.marketFloatStats.totalSamples, 1);
    assert.equal(rev.marketFloatStats.avgFloatPct, 10);
    assert.equal(rev.marketFloatStats.p25FloatPct, 10);
    assert.equal(rev.marketFloatStats.p75FloatPct, 10);
    assert.equal(rev.marketFloatStats.byDistrict[0].district, "东台市");
    assert.equal(rev.marketFloatStats.byTenderer[0].unitName, "测试城投公司");
    assert.ok(Array.isArray(rev.marketFloatStats.byBudgetTier) && rev.marketFloatStats.byBudgetTier.length === 5);
    assert.ok(Array.isArray(rev.marketFloatStats.distribution) && rev.marketFloatStats.distribution.length === 6);
    assert.equal(rev.companyReview.totalBids, 1);
    assert.equal(rev.companyReview.lostCount, 1);
    assert.equal(rev.companyReview.lostAvgFloatPct, 7);

    // Loss reason tagging works
    const tagRes = await api("/api/analytics/review/tag", {
      method: "POST", cookie,
      body: { noticeId: "10001", lossReason: "报价偏高", reviewNote: "比中标价高3个点" },
    });
    assert.equal(tagRes.status, 200);

    // External URL import blocks private SSRF IP & accepts valid public URL with manual fallback
    const ssrfRes = await api("/api/projects/import-url", {
      method: "POST", cookie,
      body: { url: "http://127.0.0.1:8080/secret" },
    });
    assert.equal(ssrfRes.status, 400);

    const impRes = await api("/api/projects/import-url", {
      method: "POST", cookie,
      body: {
        url: "https://example.invalid/tender-ext-001",
        title: "外部链接测试市政工程",
        tenderer: "测试外部业主",
        budgetYuan: 3200000,
        bodyText: "招标人：测试外部业主\n最高投标限价：320万元\n开标时间：2026-12-20 09:30",
        decision: "bidding",
      },
    });
    assert.equal(impRes.status, 200);
    const imp = await impRes.json();
    assert.equal(imp.ok, true);
    assert.equal(imp.budgetYuan, 3200000);

    // AI recommended float rate works on the imported project
    const recRes = await api(`/api/projects/${imp.id}/ai-float-recommend`, {
      method: "POST", cookie, body: {},
    });
    assert.equal(recRes.status, 200);
    const rec = await recRes.json();
    assert.equal(rec.ok, true);
    assert.ok(rec.quantitative.recommendedPct > 0);
    assert.ok(rec.quantitative.recommendedQuoteYuan > 0 && rec.quantitative.recommendedQuoteYuan < 3200000);
    assert.ok(rec.aiAnalysis.length > 10);

    // Multi-site duplicate notice deduplication: seed a duplicate of 10001 from another website
    store.db.prepare(`INSERT INTO notice(id,title,owner,draft,data) VALUES ('10004','测试市政道路工程',NULL,0,'{}')`).run();
    store.db.prepare(`
      INSERT INTO notice_meta(id, title, source, source_key, project_key, stage, stage_label, region, trade_type, tenderer, agency, budget_yuan, budget_text, published_ns, deadline_ns, deadline_text, qual_tags, original_status, has_attachments, url)
      VALUES ('10004', '测试市政道路工程', '江苏省政府采购网', 'jszc', 'PRJ-10001-DUP', 'tender', '招标公告', '盐城市', '市政工程', '测试城投公司', '测试代理公司', 5000000, '500万元', ?, ?, '2026-12-03 09:30', '[]', 'captured', 0, 'https://example.invalid/10004')
    `).run(Date.now() * 1e6, (Date.now() + 86400_000 * 7) * 1e6);

    const oppRes = await (await api("/api/opportunities?tab=biddable&onlyOpen=0&q=%E6%B5%8B%E8%AF%95%E5%B8%82%E6%94%BF%E9%81%93%E8%B7%AF%E5%B7%A5%E7%A8%8B", { cookie })).json();
    assert.equal(oppRes.items.length, 2, "different project identifiers and deadlines must stay separate");
    store.db.exec("UPDATE notice_meta SET project_key='PRJ-10001',deadline_text='2026-12-01 09:30',published_ns=(SELECT published_ns FROM notice_meta WHERE id='10001') WHERE id='10004'");
    const grouped = await (await api('/api/opportunities?tab=biddable&onlyOpen=0&q=PRJ-10001', { cookie })).json();
    assert.equal(grouped.items[0].duplicateCount, 2);
    assert.ok(grouped.items[0].extraSources.some((s) => s.source === "江苏省政府采购网"));

    // Site-name-only title is rejected by import-url (never save site name as project name)
    const siteNameRes = await api("/api/projects/import-url", {
      method: "POST", cookie,
      body: { url: "https://example.invalid/spa-only", title: "盐城市公共资源交易平台", bodyText: "首页 网站首页" },
    });
    assert.equal(siteNameRes.status, 400);

    // A similar title alone must never change the existing project or lot
    const dupImpRes = await api("/api/projects/import-url", {
      method: "POST", cookie,
      body: { url: "https://example.invalid/another-site-same-project", title: "测试市政道路工程", decision: "bidding" },
    });
    assert.equal(dupImpRes.status, 200);
    const dupImp = await dupImpRes.json();
    assert.ok(!dupImp.existed);
    assert.ok(!["10001", "10004"].includes(dupImp.id));
  });

  await t.test("opportunity delete/restore undo, follow retract, and 64-bit nanosecond auto-company inference", async () => {
    store.db.prepare("INSERT INTO company_doc(id,company_id,category,name,doc_no,issuer,qual_items_json,valid_until,status,version,updated_by) VALUES ('doc_auto_1','comp_1','建筑业企业资质','市政资质','D2001','住建厅','[{\"name\":\"市政公用工程施工总承包二级\"}]','2028-12-31','verified',1,'emp_admin_1')").run();
    // Delete & restore undo
    const delRes = await api("/api/opportunities/delete", { method: "POST", cookie, body: { ids: ["10001"] } });
    assert.equal(delRes.status, 200);
    const resAfterDel = await (await api("/api/opportunities?tab=all&onlyOpen=0&q=PRJ-10001", { cookie })).json();
    assert.ok(!resAfterDel.items.some((x) => x.id === "10001"));
    const restRes = await api("/api/opportunities/restore", { method: "POST", cookie, body: { ids: ["10001"] } });
    assert.equal(restRes.status, 200);
    const resAfterRest = await (await api("/api/opportunities?tab=all&onlyOpen=0&q=PRJ-10001", { cookie })).json();
    assert.ok(resAfterRest.items.some((x) => x.id === "10001" || (x.allSources || []).some((s) => s.id === "10001")));

    store.db.prepare("INSERT INTO notice(id,title,owner,draft,data) VALUES ('10005','测试新建桥梁市政工程',NULL,0,'{}')").run();
    store.db.prepare("INSERT INTO notice_meta(id,title,source,source_key,project_key,stage,stage_label,region,trade_type,tenderer,agency,budget_yuan,budget_text,published_ns,deadline_ns,deadline_text,qual_tags,original_status,has_attachments,url) VALUES ('10005','测试新建桥梁市政工程','盐城交易中心','yc','PRJ-10005','tender','招标公告','盐城市','市政工程','市住建局','代理',6000000,'600万元',CAST(? AS INTEGER),CAST(? AS INTEGER),'2026-12-10 09:30','[\"市政公用工程施工总承包二级\"]','captured',0,'https://example.invalid/10005')").run(String(BigInt(Date.now()) * 1000000n), String(BigInt(Date.now() + 86400_000 * 2) * 1000000n));
    const folRes = await api("/api/opportunities/10005/follow", { method: "POST", cookie, body: { decision: "bidding", note: "测试参投" } });
    assert.equal(folRes.status, 200);
    const folBody = await folRes.json();
    assert.equal(folBody.inferredCompanyId, null, "tags without original text do not qualify a notice");
    const pending = await (await api("/api/matrix?noticeId=10005", { cookie })).json();
    assert.equal(pending.matrix["REQ_CORP_QUAL::comp_1"].status, "pending");
    assert.equal(pending.matrix["REQ_CORP_QUAL::comp_1"].basis, "原文或附件待取得");
    store.db.prepare("UPDATE notice SET data=? WHERE id='10005'").run(JSON.stringify({
      title: "测试新建桥梁市政工程",
      body: "资格要求：投标人须具备市政公用工程施工总承包二级。",
      originalStatus: "captured",
    }));
    const withBody = await api("/api/opportunities/10005/follow", { method: "POST", cookie, body: { decision: "bidding", note: "测试参投" } });
    assert.equal(withBody.status, 200);
    assert.equal((await withBody.json()).inferredCompanyId, "comp_1");
    const confirmed = await (await api("/api/matrix?noticeId=10005", { cookie })).json();
    assert.equal(confirmed.matrix["REQ_CORP_QUAL::comp_1"].status, "conform");
    assert.equal(confirmed.evidence.requirements[0].entries[0].paragraph, 1);
    const wfRow = store.db.prepare("SELECT company_id FROM lot_workflow WHERE notice_id='10005'").get();
    assert.equal(wfRow?.company_id, "comp_1");
    store.db.prepare("UPDATE lot_workflow SET company_id='' WHERE notice_id='10005'").run();
    const originalMatrix = await (await api("/api/matrix?noticeId=10005", { cookie })).json();
    const byCompany = "/api/opportunities?" + new URLSearchParams({ matchCompanyId: "comp_1", q: "测试新建桥梁市政工程" });
    assert.ok((await (await api(byCompany, { cookie })).json()).items.some(item => item.id === "10005"));
    const rejected = await api("/api/matrix/verify", { method: "POST", cookie, body: {
      noticeId: "10005", reqKey: "REQ_CORP_QUAL", companyId: "comp_1", status: "non_conform",
      basis: "招标人核验原件后确认投标证书不满足约定。", fingerprint: originalMatrix.fingerprints.comp_1,
    } });
    assert.equal(rejected.status, 200);
    const checked = await (await api("/api/matrix?noticeId=10005", { cookie })).json();
    assert.equal(checked.matrix["REQ_CORP_QUAL::comp_1"].status, "non_conform");
    assert.ok(!(await (await api(byCompany, { cookie })).json()).items.some(item => item.id === "10005"));
    const candidates = await (await api("/api/opportunities?tab=all&q=PRJ-10005", { cookie })).json();
    const rejectedCandidate = candidates.items.find(item => item.id === "10005");
    assert.ok(rejectedCandidate);
    assert.ok(!rejectedCandidate.eligibleCompanies.some(company => company.id === "comp_1"));
    const home = await (await api("/api/workbench/home", { cookie })).json();
    assert.ok(!home.matchedOpportunities.some(item => item.id === "10005"));
    const noAutoLink = await api("/api/opportunities/10005/follow", { method: "POST", cookie, body: { decision: "bidding", note: "手动跟进" } });
    assert.equal((await noAutoLink.json()).inferredCompanyId, null);
    const attachmentUrl = "https://example.invalid/10005/bid.docx";
    const oldHash = "a".repeat(64);
    store.db.prepare("UPDATE notice SET data=json_set(data,'$.attachments',json(?)) WHERE id='10005'")
      .run(JSON.stringify([{ name: "招标文件", url: attachmentUrl }]));
    store.db.prepare(`INSERT INTO notice_attachment_cache
      (id,notice_id,att_idx,filename,source_url,cos_key,mime_type,size_bytes,sha256,status,expires_at)
      VALUES ('attachment_fixture','10005',0,'bid.docx',?,'fixture','application/vnd.openxmlformats-officedocument.wordprocessingml.document',1024,?,'cached','2099-01-01')`)
      .run(attachmentUrl, oldHash);
    store.db.prepare(`INSERT INTO notice_attachment_document
      (notice_id,att_idx,sha256,filename,source_url,status,total_pages) VALUES ('10005',0,?,'bid.docx',?,'text',NULL)`)
      .run(oldHash, attachmentUrl);
    store.db.prepare(`INSERT INTO notice_attachment_page VALUES ('10005',0,?,0,'解密截止时间：2026年12月1日10时30分。','docx','text')`).run(oldHash);
    const withAttachment = await (await api("/api/opportunities/10005", { cookie })).json();
    assert.equal(withAttachment.evidence.attachments[0].readable, true);
    assert.equal(withAttachment.evidence.fields.decryptDeadline.entries[0].url, attachmentUrl);
    assert.equal(withAttachment.evidence.fields.decryptDeadline.entries[0].page, null);
    store.db.prepare("UPDATE notice_attachment_cache SET sha256=? WHERE id='attachment_fixture'").run("b".repeat(64));
    const afterReplacement = await (await api("/api/opportunities/10005", { cookie })).json();
    assert.equal(afterReplacement.evidence.attachments[0].readable, false, "old text is not reused after the cached bytes change");
    assert.equal(afterReplacement.evidence.fields.decryptDeadline.state, "not_stated");
    const unfolRes = await api("/api/opportunities/10005/follow", { method: "POST", cookie, body: { decision: "none" } });
    assert.equal(unfolRes.status, 200);
    const pfRow = store.db.prepare("SELECT 1 FROM project_follow WHERE notice_id='10005'").get();
    assert.equal(pfRow, undefined);
  });

  await t.test("public notice workspaces and lifecycle lists respect company and legacy ownership", async () => {
    const viewer = issued.find(account => account.username === "testviewer");
    const login = await api("/api/auth/sign-in/username", { method: "POST", body: { username: viewer.username, password: viewer.password } });
    assert.equal(login.status, 200);
    const viewerCookie = extractCookie(login.headers.getSetCookie());
    store.db.exec(`
      INSERT INTO company(id,name) VALUES ('comp_lifecycle_private','未授权参投公司');
      INSERT INTO grant_company(employee,company,view,edit,verify,sensitive_download) VALUES ('emp_admin_1','comp_lifecycle_private',1,1,1,1);
      INSERT INTO notice(id,title,owner,draft,data) VALUES
        ('10076','公开招标甲标段',NULL,0,'{"title":"公开招标甲标段"}'),
        ('10077','公开招标乙标段',NULL,0,'{"title":"公开招标乙标段"}');
      INSERT INTO notice_meta(id,title,stage,source,source_key) VALUES
        ('10076','公开招标甲标段','tender','测试公开来源','testsrc'),
        ('10077','公开招标乙标段','tender','测试公开来源','testsrc');
      INSERT INTO lot_workflow(notice_id,company_id,active_step,predict_note,updated_by) VALUES
        ('10076','comp_lifecycle_private',6,'私有报价方案','emp_admin_1');
      INSERT INTO project_follow(notice_id,decision,note,updated_by)
        VALUES ('10076','bidding','私有参投决策','emp_admin_1');
      INSERT INTO finance_entry(id,notice_id,company_id,category,entry_type,amount_fen,actor,actor_name) VALUES
        ('fin_private','10076','comp_lifecycle_private','deposit','paid',998877,'emp_admin_1','测试管理员'),
        ('fin_allowed','10076','comp_1','deposit','paid',12345,'emp_admin_1','测试管理员'),
        ('fin_legacy','10077','','deposit','paid',4321,'emp_view_1','只读成员');
      INSERT INTO bid_schedule(id,notice_id,company_id,venue,updated_by) VALUES
        ('schedule_private','10076','comp_lifecycle_private','私有集合点','emp_admin_1'),
        ('schedule_allowed','10076','comp_1','可查看集合点','emp_admin_1');
      INSERT INTO bid_outcome(id,notice_id,company_id,final_result,updated_by,updated_by_name)
        VALUES ('outcome_private','10076','comp_lifecycle_private','未中标','emp_admin_1','测试管理员');
      INSERT INTO opening_record(id,notice_id,version,note,actor,actor_name) VALUES
        ('opening_private','10076',1,'私有开标记录','emp_admin_1','测试管理员'),
        ('opening_own_unbound','10077',1,'本人旧记录','emp_view_1','只读成员'),
        ('opening_own_denied','10076',2,'本人记录但当前公司无权','emp_view_1','只读成员');
      INSERT INTO bid_estimate(id,notice_id,rule_name,params_json,snapshot_json,result_json,note,actor,actor_name)
        VALUES ('estimate_private','10076','评标测算','{}','[]','{}','私有测算','emp_admin_1','测试管理员');
      INSERT INTO deposit_pay_task(id,notice_id,company_id,requested_by,receipt_files_json,finance_entry_id,amount_fen,assignee_id) VALUES
        ('payment_private','10076','comp_lifecycle_private','emp_admin_1','[]','fin_private',12345,'emp_admin_1'),
        ('payment_allowed','10076','comp_1','emp_admin_1','[{"fileId":"receipt_private","filename":"私有回执"},{"fileId":"receipt_allowed","filename":"回执"}]','fin_private',12345,'emp_view_1');
      INSERT INTO company_file(id,company_id,owner_type,owner_id,filename,mime_type,size_bytes,sha256,bytes,uploaded_by)
        VALUES ('receipt_private','comp_lifecycle_private','doc','pay_receipt_payment_allowed','私有回执','application/pdf',0,'fixture',x'','emp_admin_1'),
          ('receipt_allowed','comp_1','doc','pay_receipt_payment_allowed','已授权回执','application/pdf',0,'fixture',x'','emp_admin_1');
      INSERT INTO alert_todo(id,notice_id,kind,title,detail,assignee,payment_task_id,finance_company_id) VALUES
        ('alert_payment_legacy','10076','todo','财务待打保证金(123.45元)：甲标段','账号：TEST-PRIVATE-ALERT','emp_view_1','',''),
        ('alert_payment_private','10076','todo','财务待打保证金(123.45元)：甲标段','关联其他公司付款','emp_view_1','payment_private','comp_1'),
        ('alert_payment_allowed','10076','todo','财务待打保证金(123.45元)：甲标段','已授权公司付款','emp_admin_1','payment_allowed',''),
        ('alert_preparation_legacy','10076','todo','待办保证金/保函：甲标段','准备付款','emp_admin_1','',''),
        ('alert_preparation_allowed','10076','todo','待办保证金/保函：甲标段','已授权公司准备付款','emp_admin_1','','comp_1'),
        ('alert_refund_legacy','10076','todo','未中标退保证金：甲标段','项目结果已定性为「未中标」，请跟进退回。','emp_view_1','',''),
        ('alert_refund_private','10076','todo','未中标退保证金：甲标段','其他公司跟进退款','emp_view_1','','comp_lifecycle_private'),
        ('alert_refund_allowed','10076','todo','未中标退保证金：甲标段','已授权公司跟进退款','emp_admin_1','','comp_1'),
        ('alert_public_amendment','10076','amendment','公开更正提醒','公开更正公告已入库','emp_view_1','','');
    `);
    const get = async (path, loginCookie = viewerCookie) => {
      const result = await api(path, { cookie: loginCookie });
      assert.equal(result.status, 200, path);
      return result.json();
    };
    const detail = await get("/api/opportunities/10076");
    assert.equal(detail.title, "公开招标甲标段");
    assert.equal(detail.follow, null);
    for (const key of ["workflow", "opening", "estimate", "outcome"]) assert.equal(detail.lifecycle[key], null, key);
    assert.equal(detail.lifecycle.schedule.id, "schedule_allowed");
    assert.equal(detail.lifecycle.financeSummary.depositPaidFen, 12345);
    assert.deepEqual(detail.lifecycle.financeSummary.entries.map(row => row.id), ["fin_allowed"]);
    assert.deepEqual(detail.lifecycle.payTasks.map(row => row.id), ["payment_allowed"]);
    assert.deepEqual(detail.lifecycle.payTasks[0].receiptFiles, [{ fileId: "receipt_allowed", filename: "已授权回执" }]);
    assert.deepEqual(JSON.parse(detail.lifecycle.payTasks[0].receipt_files_json), detail.lifecycle.payTasks[0].receiptFiles);
    assert.equal(detail.lifecycle.payTasks[0].finance_entry_id, "");
    const assertAlertScope = alerts => {
      for (const id of ["alert_payment_allowed", "alert_preparation_allowed", "alert_refund_allowed", "alert_public_amendment"]) {
        assert.ok(alerts.some(alert => alert.id === id), id);
      }
      for (const id of ["alert_payment_legacy", "alert_payment_private", "alert_preparation_legacy", "alert_refund_legacy", "alert_refund_private"]) {
        assert.ok(!alerts.some(alert => alert.id === id), id);
      }
      assert.ok(!JSON.stringify(alerts).includes("TEST-PRIVATE-ALERT"));
    };
    assertAlertScope(detail.alerts);

    const owner = await get("/api/opportunities/10076", cookie);
    assert.equal(owner.lifecycle.workflow.company_id, "comp_lifecycle_private");
    assert.equal(owner.lifecycle.opening.id, "opening_private");
    assert.equal(owner.lifecycle.estimate.id, "estimate_private");
    assert.ok(owner.alerts.some(alert => alert.id === "alert_payment_private"));
    assert.ok(owner.alerts.some(alert => alert.id === "alert_refund_private"));
    assert.ok(!owner.alerts.some(alert => ["alert_payment_legacy", "alert_preparation_legacy", "alert_refund_legacy"].includes(alert.id)));
    assertAlertScope((await get("/api/alerts?status=all")).items);
    assertAlertScope((await get("/api/workbench/home")).openAlerts);
    const finance = await get("/api/finance?noticeId=10076");
    assert.deepEqual(finance.entries.map(row => row.id), ["fin_allowed"]);
    assert.equal(finance.balances.paidFen, 12345);
    assert.ok(!finance.selectedProjects.some(row => row.id === "10076"));
    assert.ok(!(await get("/api/schedules")).items.some(row => row.id === "schedule_private"));
    assert.ok(!(await get("/api/outcomes")).items.some(row => row.id === "outcome_private"));
    assert.deepEqual((await get("/api/opening?noticeId=10076")).records, []);
    assert.deepEqual((await get("/api/estimates?noticeId=10076")).estimates, []);
    const legacy = await get("/api/opportunities/10077");
    assert.equal(legacy.lifecycle.opening.id, "opening_own_unbound");
    assert.equal(legacy.lifecycle.financeSummary.depositPaidFen, 4321);
  });
  await t.test("company discovery preserves scope, finds later rows and distinguishes unverified documents", async () => {
    const db = store.db;
    db.prepare("INSERT INTO company(id,name) VALUES('screening_co','隔离筛选公司')").run();
    db.prepare("INSERT INTO grant_company VALUES(?,?,?,?,?,?)").run("emp_admin_1", "screening_co", 1, 1, 1, 0);
    db.prepare(`INSERT INTO company_doc(id,company_id,category,name,valid_until,status,qual_items_json,updated_by)
      VALUES ('screening_doc','screening_co','企业资质','施工证','2099-01-01','pending',?,'emp_admin_1')`)
      .run(JSON.stringify([{ name: "市政公用工程施工总承包二级" }]));
    for (let i = 0; i < 33; i++) {
      const id = String(91000 + i);
      const title = "归类测试公告" + i;
      const body = i === 32 ? "投标人须具备市政公用工程<b>施工总承包</b>二级。项目负责人须具备注册建造师资格。"
        : "评分标准：具备市政公用工程施工总承包二级得2分。";
      db.prepare("INSERT INTO notice(id,title,draft,data) VALUES(?,?,0,?)").run(id,title,JSON.stringify({ title, body, attachments: [], originalStatus: "captured" }));
      db.prepare("INSERT INTO notice_meta(id,title,source,source_key,stage,published_ns,deadline_ns) VALUES(?,?,'测试来源','qa',?,?,0)").run(id,title,i === 32 ? "amendment" : "tender",33-i);
    }
    const list = async (matchStatus, tab = "all", onlyOpen = "0") => {
      const query = new URLSearchParams({ matchCompanyId:"screening_co", matchStatus, tab, onlyOpen, q:"归类测试公告", pageSize:"10" });
      const response = await api("/api/opportunities?" + query, { cookie });
      assert.equal(response.status, 200);
      return response.json();
    };
    const result = await list("hints");
    assert.deepEqual(result.items.map(item => item.id), ["91032"]);
    assert.equal(result.items[0].companyMatch.status,"archive_pending");
    assert.equal((await list("archive_pending", "amendments")).total, 1);
    assert.equal((await list("partial")).total, 0);
    assert.equal((await list("pending")).total, 32);
    assert.equal((await list("hints", "all", "1")).total, 0);
    db.prepare("UPDATE company_doc SET status='verified' WHERE id='screening_doc'").run();
    assert.equal((await list("partial")).items[0].companyMatch.status, "partial");
    assert.equal((await list("supported")).total, 0);
    const viewer = issued.find(account => account.username === "testviewer");
    const login = await api("/api/auth/sign-in/username", { method: "POST", body: { username: viewer.username, password: viewer.password } });
    assert.equal(login.status, 200);
    const denied = await api("/api/opportunities?matchCompanyId=screening_co", { cookie: extractCookie(login.headers.getSetCookie()) });
    assert.equal(denied.status, 403);
  });

  await t.test("abandoned lot reminders leave the inbox and nanosecond reminders remain actionable", async () => {
    const db = store.db;
    const deadline = "1796108400000000000";
    const records = [
      ["92001", "通知验收第1标段招标公告", "tender"],
      ["92002", "通知验收第1标段更正公告", "amendment"],
      ["92003", "通知验收第2标段招标公告", "tender"],
      ["92004", "通知验收第2标段更正公告", "amendment"],
      ["92005", "通知验收第1标段再更正公告", "amendment"],
    ];
    for (const [id, title, stage] of records) {
      db.prepare("INSERT INTO notice(id,title,draft,data) VALUES(?,?,0,?)")
        .run(id, title, JSON.stringify({ id, title, stage, body: "测试正文", projectKey: "qa-alert-scope", attachments: [] }));
      db.prepare("INSERT INTO notice_meta(id,title,source,source_key,project_key,stage,deadline_ns) VALUES(?,?,'隔离来源','qa','qa-alert-scope',?,CAST(? AS INTEGER))")
        .run(id, title, stage, deadline);
    }
    const follow = db.prepare("INSERT INTO project_follow(notice_id,project_key,decision,assignee,updated_by) VALUES(?,'qa-alert-scope',?,'emp_admin_1','emp_admin_1')");
    follow.run("92001", "declined");
    follow.run("92003", "bidding");
    const insert = db.prepare("INSERT INTO alert_todo(id,notice_id,kind,project_key,title,assignee,due_ns) VALUES(?,?,'amendment','qa-alert-scope',?,'emp_admin_1',CAST(? AS INTEGER))");
    insert.run("amend:92002", "92002", "旧版第1标段更正", deadline);
    insert.run("amend:92001:92005", "92005", "新版第1标段更正", deadline);
    insert.run("amend:92004", "92004", "仍跟进的第2标段", deadline);
    const get = async path => {
      const response = await api(path, { cookie });
      assert.equal(response.status, 200, path);
      return response.json();
    };
    const post = (path, body) => api(path, { method: "POST", body, cookie });
    const ids = items => items.filter(item => item.id.startsWith("amend:920")).map(item => item.id);
    assert.deepEqual(ids((await get("/api/alerts")).items), ["amend:92004"]);
    assert.deepEqual(ids((await get("/api/workbench/home")).openAlerts), ["amend:92004"]);
    assert.equal((await get("/api/projects?q=通知验收")).items.find(item => item.id === "92003").openAlertCount, 1);
    assert.equal((await get("/api/alerts?status=dismissed")).items.filter(item => item.id.startsWith("amend:920")).length, 2);
    const detail = await get("/api/opportunities/92001");
    assert.equal(detail.alerts.filter(item => item.id.startsWith("amend:920") && item.status === "dismissed").length, 2);
    assert.equal((await post("/api/opportunities/92003/follow", { decision: "none" })).status, 200);
    assert.deepEqual(ids((await get("/api/alerts")).items), []);
    assert.equal((await post("/api/opportunities/92003/follow", { decision: "watching", assigneeId: "emp_admin_1" })).status, 200);
    assert.deepEqual(ids((await get("/api/alerts")).items), ["amend:92004"]);
    const update = id => "/api/alerts/" + encodeURIComponent(id) + "/update";
    assert.equal((await post(update("amend:92004"), { status: "dismissed" })).status, 400);
    assert.equal((await post(update("amend:92004"), { status: "dismissed", reason: "隔离验收确认" })).status, 200);
    assert.deepEqual(ids((await get("/api/alerts")).items), [], "polling cannot recreate a dismissed legacy reminder");
    assert.equal(db.prepare("SELECT CAST(due_ns AS TEXT) AS due,status FROM alert_todo WHERE id='amend:92004'").get().due, deadline);
    assert.equal(db.prepare("SELECT status FROM alert_todo WHERE id='amend:92004'").get().status, "dismissed");
    assert.equal((await post("/api/opportunities/batch-follow", { ids: ["92003"], decision: "declined", note: "批量放弃测试" })).status, 200);
    assert.deepEqual(ids((await get("/api/alerts")).items), []);
    assert.equal((await post(update("amend:92002"), { status: "dismissed", reason: "补记历史处理" })).status, 200);
    db.prepare("UPDATE notice SET draft=1, owner='emp_admin_1' WHERE id='92001'").run();
    const viewer = issued.find(account => account.username === "testviewer");
    const login = await api("/api/auth/sign-in/username", { method: "POST", body: { username: viewer.username, password: viewer.password } });
    assert.equal(login.status, 200);
    const viewerCookie = extractCookie(login.headers.getSetCookie());
    const history = await (await api("/api/alerts?status=all", { cookie: viewerCookie })).json();
    assert.ok(!history.items.some(item => item.id === "amend:92001:92005"));
    assert.equal((await api(update("amend:92001:92005"), { method: "POST", cookie: viewerCookie, body: { status: "dismissed", reason: "无权修改" } })).status, 404);
  });

});
