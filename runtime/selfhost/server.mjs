import { createServer } from "node:http";
import { createServer as createSecureServer } from "node:https";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { brotliCompressSync, gzipSync } from "node:zlib";

const execFileAsync = promisify(execFile);
import { maxPasswordLength, minPasswordLength } from "./password-policy.mjs";
import { digest, openStore, temporaryPassword, transaction } from "./store.mjs";
import { evaluateCompliance } from "./compliance.mjs";
import { describeCapabilities, extractCompanyCapabilities, matchNoticeToCapabilities, shortCompanyName } from "./qualMatcher.mjs";
import { extractNoticeEvidence, evaluateNoticeRequirements, normalizeQualificationSearchText, qualificationSearchTerms, sameNoticeScope } from "./noticeEvidence.mjs";
import { fetchPublic } from "./public-http.mjs";
import { COS_SHARED_PREFIX, cosGetObject, cosPutVerified, getCosCredentials } from "./lib/cos.mjs";
import { effectiveSourceUrl, collectorFailure, probeAndExtractUrl, runCustomSourceById, validateSourceUrl } from "./custom-source-runner.mjs";

const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const forbidden = () => json({ message: "当前账号无此权限。可联系管理员核对审批和公司授权。" }, 403);
const invalid = (msg = "请检查请求内容。") => json({ message: msg }, 400);
const missing = () => json({ message: "找不到该记录。" }, 404);
const unsigned = () => json({ message: "会话已结束，请重新登录。" }, 401);
const notReady = () => json({ message: "该接口暂未开放。" }, 409);
const authPaths = new Set(["/api/auth/sign-in/username", "/api/auth/sign-out"]);
const perspectivePaths = new Set(["lead", "bidder", "delegate", "finance"]);

const rateBuckets = new Map();
function allowRate(bucketKey, maxHits, windowMs) {
  const now = Date.now();
  if (rateBuckets.size > 500) {
    for (const [k, v] of rateBuckets) {
      if (now >= v.resetAt) rateBuckets.delete(k);
    }
  }
  const prev = rateBuckets.get(bucketKey);
  if (!prev || now >= prev.resetAt) {
    rateBuckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (prev.count >= maxHits) return false;
  prev.count += 1;
  return true;
}

import { availabilityAction } from "./custom-source-evidence.mjs";
import { currentDeadline } from "./noticeDeadline.mjs";
import { ensureMatchHistory, companyInputs, matchFingerprint, captureMatch } from "./matchHistory.mjs";
import { ensureAttachmentEvidence, indexAttachment, readAttachmentBytes } from "./attachmentEvidence.mjs";
import { ensureNoticeAiTables, extractNoticeWithAi, extractOcrAndFieldsFromBuffer, getCachedNoticeAiExtract } from "./noticeAiExtractor.mjs";

function ensureAppTables(db) {
  ensureAttachmentEvidence(db);
  ensureMatchHistory(db);
  ensureNoticeAiTables(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS notice_meta (
      id TEXT PRIMARY KEY REFERENCES notice(id),
      title TEXT NOT NULL, source TEXT NOT NULL, source_key TEXT NOT NULL,
      tenderer TEXT NOT NULL DEFAULT '', agency TEXT NOT NULL DEFAULT '',
      region TEXT NOT NULL DEFAULT '', trade_type TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '', stage TEXT NOT NULL DEFAULT 'other',
      stage_label TEXT NOT NULL DEFAULT '', project_key TEXT NOT NULL DEFAULT '',
      published_ns INTEGER NOT NULL DEFAULT 0, deadline_ns INTEGER NOT NULL DEFAULT 0,
      deadline_text TEXT NOT NULL DEFAULT '', budget_yuan INTEGER,
      budget_text TEXT NOT NULL DEFAULT '', qual_tags TEXT NOT NULL DEFAULT '',
      eval_method TEXT NOT NULL DEFAULT '', deposit_text TEXT NOT NULL DEFAULT '',
      original_status TEXT NOT NULL DEFAULT 'uncached', has_attachments INTEGER NOT NULL DEFAULT 0,
      source_updated_at TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS paused_source_import (key TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS source_health (
      key TEXT PRIMARY KEY, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
      checked TEXT NOT NULL DEFAULT '0', last_ok TEXT NOT NULL DEFAULT '0',
      failures INTEGER NOT NULL DEFAULT 0, reason TEXT NOT NULL DEFAULT '',
      last_error TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS saved_filter (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES employee(id),
      name TEXT NOT NULL, filters_json TEXT NOT NULL,
      subscribed INTEGER NOT NULL DEFAULT 0, shared INTEGER NOT NULL DEFAULT 1,
      assignee TEXT REFERENCES employee(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS project_follow (
      notice_id TEXT PRIMARY KEY REFERENCES notice(id),
      project_key TEXT NOT NULL DEFAULT '',
      decision TEXT NOT NULL DEFAULT 'watching' CHECK(decision IN ('watching','bidding','declined')),
      assignee TEXT REFERENCES employee(id),
      note TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL REFERENCES employee(id),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS alert_todo (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK(kind IN ('amendment','deadline','subscription','todo')),
      notice_id TEXT NOT NULL REFERENCES notice(id),
      project_key TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      assignee TEXT REFERENCES employee(id),
      source_filter_id TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','done','dismissed')),
      due_ns INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS company_doc (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES company(id),
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      doc_no TEXT NOT NULL DEFAULT '',
      valid_until TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','missing','void')),
      provenance TEXT NOT NULL DEFAULT 'manual' CHECK(provenance IN ('original','manual')),
      verified_by TEXT,
      verified_at TEXT NOT NULL DEFAULT '',
      verify_basis TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      updated_by TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS company_doc_history (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id TEXT NOT NULL REFERENCES company_doc(id),
      version INTEGER NOT NULL,
      action TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      snapshot_json TEXT NOT NULL,
      actor TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS company_person (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES company(id),
      name TEXT NOT NULL,
      role_title TEXT NOT NULL DEFAULT '',
      cert_level TEXT NOT NULL DEFAULT '',
      cert_valid_until TEXT NOT NULL DEFAULT '',
      lock_status TEXT NOT NULL DEFAULT 'available' CHECK(lock_status IN ('available','locked','pending')),
      id_card_secret TEXT NOT NULL DEFAULT '',
      phone_secret TEXT NOT NULL DEFAULT '',
      cert_no_secret TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','void')),
      updated_by TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS lot_check_item (
      notice_id TEXT NOT NULL REFERENCES notice(id),
      company_id TEXT NOT NULL DEFAULT '',
      rule_code TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','conform','non_conform','na')),
      basis TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL,
      updated_by_name TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(notice_id, company_id, rule_code)
    );
    CREATE TABLE IF NOT EXISTS lot_matrix_cell (
      notice_id TEXT NOT NULL REFERENCES notice(id),
      req_key TEXT NOT NULL,
      company_id TEXT NOT NULL REFERENCES company(id),
      status TEXT NOT NULL CHECK(status IN ('conform','non_conform','na','pending','missing')),
      basis TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL,
      updated_by_name TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(notice_id, req_key, company_id)
    );
    CREATE TABLE IF NOT EXISTS app_setting (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_by TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS finance_entry (
      id TEXT PRIMARY KEY,
      notice_id TEXT NOT NULL REFERENCES notice(id),
      company_id TEXT NOT NULL DEFAULT '',
      lot_round TEXT NOT NULL DEFAULT '默认标段 · 第1轮',
      category TEXT NOT NULL CHECK(category IN ('deposit','guarantee','expense','performance_cash','performance_guarantee')),
      entry_type TEXT NOT NULL CHECK(entry_type IN ('paid','refund_received','non_refund_deduct','in_transit','transfer_in','transfer_out','guarantee_face','urge')),
      amount_fen INTEGER NOT NULL DEFAULT 0,
      pay_status TEXT NOT NULL DEFAULT '已扣款',
      receive_status TEXT NOT NULL DEFAULT '未标注',
      refund_cond TEXT NOT NULL DEFAULT '未核实',
      refund_status TEXT NOT NULL DEFAULT '未申请',
      dispute_status TEXT NOT NULL DEFAULT '无争议',
      due_date TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      reversed INTEGER NOT NULL DEFAULT 0,
      reverse_reason TEXT NOT NULL DEFAULT '',
      actor TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS company_profile (
      company_id TEXT PRIMARY KEY,
      credit_code TEXT NOT NULL DEFAULT '',
      legal_rep TEXT NOT NULL DEFAULT '',
      reg_capital TEXT NOT NULL DEFAULT '',
      bank_name TEXT NOT NULL DEFAULT '',
      bank_account TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      contact_name TEXT NOT NULL DEFAULT '',
      contact_phone TEXT NOT NULL DEFAULT '',
      ca_expiry TEXT NOT NULL DEFAULT '',
      remark TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS notice_hidden (
      notice_id TEXT PRIMARY KEY,
      deleted_by TEXT NOT NULL DEFAULT '',
      deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS notice_html_cache (
      notice_id TEXT PRIMARY KEY,
      source_url TEXT NOT NULL DEFAULT '',
      html TEXT NOT NULL DEFAULT '',
      fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS opening_record (
      id TEXT PRIMARY KEY,
      notice_id TEXT NOT NULL REFERENCES notice(id),
      version INTEGER NOT NULL DEFAULT 1,
      open_mode TEXT NOT NULL DEFAULT '未标注' CHECK(open_mode IN ('现场','远程','混合','未标注','未标注')),
      venue TEXT NOT NULL DEFAULT '',
      arrive_time TEXT NOT NULL DEFAULT '',
      contact TEXT NOT NULL DEFAULT '',
      materials_ver TEXT NOT NULL DEFAULT '',
      bids_json TEXT NOT NULL DEFAULT '[]',
      photo_data TEXT NOT NULL DEFAULT '',
      quality_flags TEXT NOT NULL DEFAULT '[]',
      verified INTEGER NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      actor TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS bid_estimate (
      id TEXT PRIMARY KEY,
      notice_id TEXT NOT NULL REFERENCES notice(id),
      version INTEGER NOT NULL DEFAULT 1,
      rule_name TEXT NOT NULL,
      params_json TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      actor TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS bid_schedule (
      id TEXT PRIMARY KEY,
      notice_id TEXT NOT NULL REFERENCES notice(id),
      company_id TEXT NOT NULL DEFAULT '',
      open_mode TEXT NOT NULL DEFAULT '未标注' CHECK(open_mode IN ('现场','远程','混合','未标注','未标注')),
      submit_time TEXT NOT NULL DEFAULT '',
      decrypt_window TEXT NOT NULL DEFAULT '',
      open_time TEXT NOT NULL DEFAULT '',
      venue TEXT NOT NULL DEFAULT '',
      delegate_id TEXT,
      depart_at TEXT NOT NULL DEFAULT '',
      until_at TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      updated_by TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS bid_outcome (
      id TEXT PRIMARY KEY,
      notice_id TEXT NOT NULL REFERENCES notice(id),
      company_id TEXT NOT NULL DEFAULT '',
      candidate_status TEXT NOT NULL DEFAULT '未标注' CHECK(candidate_status IN ('未公示','未标注','未标注','第一候选人','第二候选人','第三候选人','未入围','公示异议中')),
      final_result TEXT NOT NULL DEFAULT '未标注' CHECK(final_result IN ('评审中','未标注','未标注','中标','未中标','流标或终止')),
      award_amount_fen INTEGER,
      notice_letter_status TEXT NOT NULL DEFAULT '未下达' CHECK(notice_letter_status IN ('未下达','已下达待签收','已签收')),
      notice_letter_date TEXT NOT NULL DEFAULT '',
      guarantee_status TEXT NOT NULL DEFAULT '未标注' CHECK(guarantee_status IN ('未办理','未标注','未标注','免缴(附依据)','履约保函已办','履约现金已缴')),
      contract_status TEXT NOT NULL DEFAULT '未签署' CHECK(contract_status IN ('未签署','审核中','已签署','已移交启动')),
      handover_to TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL,
      updated_by_name TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(notice_id, company_id)
    );
  `);
  const ensureCol = (table, col, def) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  };
  ensureCol("company_doc", "doc_group", "TEXT NOT NULL DEFAULT 'enterprise'");
  ensureCol("company_doc", "period_month", "TEXT NOT NULL DEFAULT ''");
  ensureCol("company_doc", "remark", "TEXT NOT NULL DEFAULT ''");
  ensureCol("company_doc", "file_id", "TEXT NOT NULL DEFAULT ''");
  ensureCol("company_doc", "file_name", "TEXT NOT NULL DEFAULT ''");
  ensureCol("company_doc", "issuer", "TEXT NOT NULL DEFAULT ''");
  ensureCol("company_doc", "qual_items_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureCol("company_person", "social_status", "TEXT NOT NULL DEFAULT ''");
  ensureCol("company_person", "social_until", "TEXT NOT NULL DEFAULT ''");
  ensureCol("company_person", "file_id", "TEXT NOT NULL DEFAULT ''");
  ensureCol("company_person", "file_name", "TEXT NOT NULL DEFAULT ''");
  db.exec(`
    CREATE TABLE IF NOT EXISTS company_file (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES company(id),
      owner_type TEXT NOT NULL CHECK(owner_type IN ('doc','person')),
      owner_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      bytes BLOB NOT NULL,
      uploaded_by TEXT NOT NULL,
      uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  ensureCol("company_file", "storage_backend", "TEXT NOT NULL DEFAULT 'sqlite'");
  ensureCol("company_file", "cos_key", "TEXT NOT NULL DEFAULT ''");
  db.exec(`
    CREATE TABLE IF NOT EXISTS lot_workflow (
      notice_id TEXT PRIMARY KEY REFERENCES notice(id),
      company_id TEXT NOT NULL DEFAULT '',
      active_step INTEGER NOT NULL DEFAULT 1,
      doc_buy_status TEXT NOT NULL DEFAULT '未获取',
      doc_buy_fee_fen INTEGER NOT NULL DEFAULT 0,
      doc_buy_at TEXT NOT NULL DEFAULT '',
      doc_buy_file_id TEXT NOT NULL DEFAULT '',
      doc_buy_file_name TEXT NOT NULL DEFAULT '',
      doc_buy_note TEXT NOT NULL DEFAULT '',
      prep_status TEXT NOT NULL DEFAULT '未开始',
      prep_owner_id TEXT NOT NULL DEFAULT '',
      prep_deadline TEXT NOT NULL DEFAULT '',
      prep_file_id TEXT NOT NULL DEFAULT '',
      prep_file_name TEXT NOT NULL DEFAULT '',
      prep_note TEXT NOT NULL DEFAULT '',
      opening_sheet_file_id TEXT NOT NULL DEFAULT '',
      opening_sheet_file_name TEXT NOT NULL DEFAULT '',
      predict_status TEXT NOT NULL DEFAULT '待分析',
      predict_our_quote_fen INTEGER NOT NULL DEFAULT 0,
      predict_benchmark_fen INTEGER NOT NULL DEFAULT 0,
      predict_float_rate TEXT NOT NULL DEFAULT '',
      predict_rank TEXT NOT NULL DEFAULT '',
      predict_note TEXT NOT NULL DEFAULT '',
      refund_track_status TEXT NOT NULL DEFAULT '未进入退保',
      refund_expected_date TEXT NOT NULL DEFAULT '',
      refund_received_date TEXT NOT NULL DEFAULT '',
      refund_note TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL DEFAULT '',
      updated_by_name TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS notice_attachment_cache (
      id TEXT PRIMARY KEY,
      notice_id TEXT NOT NULL REFERENCES notice(id),
      att_idx INTEGER NOT NULL,
      filename TEXT NOT NULL,
      source_url TEXT NOT NULL,
      cos_key TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'cached' CHECK(status IN ('cached','expired','failed')),
      downloaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      UNIQUE(notice_id, att_idx)
    );
    CREATE TABLE IF NOT EXISTS deposit_pay_task (
      id TEXT PRIMARY KEY,
      notice_id TEXT NOT NULL REFERENCES notice(id),
      company_id TEXT NOT NULL DEFAULT '',
      deposit_method TEXT NOT NULL DEFAULT '基本户网银转账（现金保证金）',
      amount_fen INTEGER NOT NULL DEFAULT 0,
      payee_name TEXT NOT NULL DEFAULT '',
      payee_account TEXT NOT NULL DEFAULT '',
      payee_bank TEXT NOT NULL DEFAULT '',
      due_time TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','cancelled')),
      assignee_id TEXT NOT NULL DEFAULT '',
      assignee_name TEXT NOT NULL DEFAULT '',
      requested_by TEXT NOT NULL DEFAULT '',
      requested_by_name TEXT NOT NULL DEFAULT '',
      paid_by TEXT NOT NULL DEFAULT '',
      paid_by_name TEXT NOT NULL DEFAULT '',
      paid_at TEXT NOT NULL DEFAULT '',
      receipt_files_json TEXT NOT NULL DEFAULT '[]',
      finance_entry_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_notice_meta_stage_deadline ON notice_meta(stage, deadline_ns, published_ns DESC);
    CREATE INDEX IF NOT EXISTS idx_notice_meta_tenderer_stage_pub ON notice_meta(tenderer, stage, published_ns DESC);
    CREATE INDEX IF NOT EXISTS idx_notice_meta_project_key ON notice_meta(project_key, published_ns ASC);
    CREATE INDEX IF NOT EXISTS idx_notice_meta_source_status ON notice_meta(source_key, original_status);
    CREATE TABLE IF NOT EXISTS company_expiry_todo (
      id TEXT PRIMARY KEY,
      dedupe_key TEXT NOT NULL UNIQUE,
      company_id TEXT NOT NULL REFERENCES company(id),
      target_type TEXT NOT NULL CHECK(target_type IN ('doc','ca','person')),
      target_id TEXT NOT NULL,
      target_name TEXT NOT NULL,
      tier TEXT NOT NULL CHECK(tier IN ('expired','7d','30d')),
      valid_until TEXT NOT NULL,
      days_left INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','done','dismissed')),
      assignee TEXT REFERENCES employee(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_alert_status_assignee ON alert_todo(status, assignee, due_ns);
    CREATE INDEX IF NOT EXISTS idx_alert_notice_status ON alert_todo(notice_id, status);
    CREATE INDEX IF NOT EXISTS idx_doc_company_status ON company_doc(company_id, status, valid_until);
    CREATE INDEX IF NOT EXISTS idx_person_company_status ON company_person(company_id, status);
    CREATE INDEX IF NOT EXISTS idx_expiry_status_days ON company_expiry_todo(status, days_left ASC);
    CREATE INDEX IF NOT EXISTS idx_notice_hidden_nid ON notice_hidden(notice_id);
    CREATE TABLE IF NOT EXISTS custom_source (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      list_url TEXT NOT NULL,
      region TEXT NOT NULL DEFAULT '盐城市',
      trade_type TEXT NOT NULL DEFAULT '工程建设',
      link_selector TEXT NOT NULL DEFAULT '',
      keyword_filter TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at TEXT NOT NULL DEFAULT '',
      last_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  try {
    db.exec("PRAGMA cache_size=-32000; PRAGMA temp_store=MEMORY; PRAGMA mmap_size=134217728;");
  } catch {}
  ensureCol("lot_workflow", "prep_pm_person_id", "TEXT NOT NULL DEFAULT ''");
  ensureCol("lot_workflow", "prep_pm_name", "TEXT NOT NULL DEFAULT ''");
  ensureCol("lot_workflow", "loss_reason", "TEXT NOT NULL DEFAULT ''");
  ensureCol("lot_workflow", "review_note", "TEXT NOT NULL DEFAULT ''");
  ensureCol("alert_todo", "payment_task_id", "TEXT NOT NULL DEFAULT ''");
  ensureCol("alert_todo", "finance_company_id", "TEXT NOT NULL DEFAULT ''");
  db.exec(`UPDATE notice_attachment_cache SET status='expired' WHERE status='cached' AND expires_at <= CURRENT_TIMESTAMP;`);
}

function scanExpiryReminders(db) {
  const todayMs = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime();
  const calcDays = (dateStr) => {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
    return Math.ceil((new Date(dateStr + "T00:00:00Z").getTime() - todayMs) / 86400000);
  };
  const tierFor = (days) => (days < 0 ? "expired" : days <= 7 ? "7d" : days <= 30 ? "30d" : null);
  const defaultAssignee = db.prepare("SELECT id FROM employee WHERE role='admin' AND approval='approved' ORDER BY id LIMIT 1").get()?.id
    || db.prepare("SELECT id FROM employee WHERE role='admin' AND approval='approved' LIMIT 1").get()?.id
    || null;

  const activeKeys = new Set();
  const candidates = [];

  const docs = db.prepare(`
    SELECT d.id, d.company_id, c.name AS company_name, d.category, d.name, d.valid_until
    FROM company_doc d JOIN company c ON c.id = d.company_id
    WHERE d.status <> 'void' AND d.valid_until <> ''
  `).all();
  for (const d of docs) {
    const days = calcDays(d.valid_until);
    if (days === null) continue;
    const tier = tierFor(days);
    if (tier) {
      candidates.push({
        dedupeKey: `exp:doc:${d.id}:${tier}`,
        companyId: d.company_id,
        targetType: "doc",
        targetId: d.id,
        targetName: `${d.company_name} · ${d.name}（${d.category}）`,
        tier,
        validUntil: d.valid_until,
        daysLeft: days,
      });
    }
  }

  const profiles = db.prepare(`
    SELECT p.company_id, c.name AS company_name, p.ca_expiry
    FROM company_profile p JOIN company c ON c.id = p.company_id
    WHERE p.ca_expiry <> ''
  `).all();
  for (const p of profiles) {
    const days = calcDays(p.ca_expiry);
    if (days === null) continue;
    const tier = tierFor(days);
    if (tier) {
      candidates.push({
        dedupeKey: `exp:ca:${p.company_id}:${tier}`,
        companyId: p.company_id,
        targetType: "ca",
        targetId: p.company_id,
        targetName: `${p.company_name} · CA 数字证书锁`,
        tier,
        validUntil: p.ca_expiry,
        daysLeft: days,
      });
    }
  }

  const people = db.prepare(`
    SELECT p.id, p.company_id, c.name AS company_name, p.name, p.role_title, p.cert_valid_until
    FROM company_person p JOIN company c ON c.id = p.company_id
    WHERE p.status <> 'void' AND p.cert_valid_until <> ''
  `).all();
  for (const p of people) {
    const days = calcDays(p.cert_valid_until);
    if (days === null) continue;
    const tier = tierFor(days);
    if (tier) {
      candidates.push({
        dedupeKey: `exp:person:${p.id}:${tier}`,
        companyId: p.company_id,
        targetType: "person",
        targetId: p.id,
        targetName: `${p.company_name} · ${p.name}（${p.role_title || "关键人员"}证书）`,
        tier,
        validUntil: p.cert_valid_until,
        daysLeft: days,
      });
    }
  }

  let created = 0;
  let resolved = 0;
  transaction(db, () => {
    for (const c of candidates) {
      activeKeys.add(c.dedupeKey);
      const ex = db.prepare("SELECT id, status FROM company_expiry_todo WHERE dedupe_key=?").get(c.dedupeKey);
      if (!ex) {
        db.prepare(`INSERT INTO company_expiry_todo(id,dedupe_key,company_id,target_type,target_id,target_name,tier,valid_until,days_left,status,assignee)
          VALUES (?,?,?,?,?,?,?,?,?,'open',?)`)
          .run(`exp_${randomUUID().slice(0, 12)}`, c.dedupeKey, c.companyId, c.targetType, c.targetId, c.targetName, c.tier, c.validUntil, c.daysLeft, defaultAssignee);
        created += 1;
      } else if (ex.status === "open") {
        db.prepare("UPDATE company_expiry_todo SET target_name=?, valid_until=?, days_left=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .run(c.targetName, c.validUntil, c.daysLeft, ex.id);
      }
    }
    const openRows = db.prepare("SELECT id, dedupe_key FROM company_expiry_todo WHERE status='open'").all();
    for (const r of openRows) {
      if (!activeKeys.has(r.dedupe_key)) {
        db.prepare("UPDATE company_expiry_todo SET status='done', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(r.id);
        resolved += 1;
      }
    }
  });
  const openTotal = db.prepare("SELECT count(*) AS c FROM company_expiry_todo WHERE status='open'").get().c;
  return { scanned: docs.length + profiles.length + people.length, created, resolved, openTotal };
}

const YANCHENG_DISTRICTS = [
  { key: "盐城市亭湖区", kw: ["亭湖", "南洋镇", "黄尖镇", "新兴镇", "便仓镇", "盐东镇"] },
  { key: "盐城市盐都区", kw: ["盐都", "盐龙", "潘黄", "大冈镇", "龙冈镇", "郭猛镇", "尚庄镇", "学富镇", "秦南镇"] },
  { key: "盐城市大丰区", kw: ["大丰", "大中街道", "丰华", "西团镇", "草堰镇", "白驹镇", "刘庄镇", "三龙镇"] },
  { key: "盐城市东台市", kw: ["东台", "弶港", "安丰镇", "富安镇", "梁垛镇", "时堰镇", "五烈镇"] },
  { key: "盐城市建湖县", kw: ["建湖", "近湖", "上冈镇", "九龙口", "颜单镇", "芦沟镇", "庆丰镇"] },
  { key: "盐城市射阳县", kw: ["射阳", "合德镇", "黄沙港", "临海镇", "千秋镇", "四明镇", "海河镇", "海通镇"] },
  { key: "盐城市阜宁县", kw: ["阜宁", "阜城", "沟墩镇", "陈良镇", "三灶镇", "郭墅镇", "益林镇"] },
  { key: "盐城市滨海县", kw: ["滨海", "东坎", "滨海港", "八滩镇", "五汛镇", "蔡桥镇", "正红镇", "陈涛镇"] },
  { key: "盐城市响水县", kw: ["响水", "陈家港", "小尖镇", "黄圩镇", "大有镇", "运河镇"] },
  { key: "盐城市盐南高新区", kw: ["盐南", "城南新区", "新都街道", "黄海街道", "伍佑", "新河街道"] },
  { key: "盐城市经济技术开发区", kw: ["经济技术开发区", "经开区", "盐城开发区", "步凤镇", "新城街道"] },
];

function normalizeTitleForDedup(title) {
  return String(title || "")
    .replace(/[\s\u3000·•\-_—–：:，,。.;；、'"“”‘’【】\[\]（）()《》<>]/g, "")
    .replace(/(招标公告|采购公告|竞争性磋商公告|竞争性谈判公告|询价公告|单一来源采购公示|更正公告|澄清公告|中标结果公告|中标公示|成交公告|结果公告|合同公告|项目)$/g, "")
    .toLowerCase();
}

function deduplicateNoticeRows(rows) {
  const groups = new Map();
  const order = [];
  const originSet = new Set(rows.map(row=>row.originUrl).filter(Boolean));
  const scoreRow = (r) => {
    let s = originSet.has(r.url) ? 110 : 0;
    if (r.decision === "bidding") s += 1000;
    else if (r.decision === "watching") s += 500;
    if (Number(r.budgetYuan || 0) > 0) s += 80;
    if (r.hasAttachments) s += 40;
    if (r.tenderer) s += 20;
    if (r.deadline && r.deadline !== "0") s += 15;
    if (r.qualTags && r.qualTags.length) s += 10;
    return s;
  };
  for (const r of rows) {
    const normTitle = normalizeTitleForDedup(r.title);
    // Treat a title as a search clue. Cross-site grouping also needs an issuer,
    // an official identifier and matching lot, round and publication details.
    const confirmed = r.projectKey && !/^(?:EXT-|usr_)/i.test(r.projectKey) && r.tenderer && r.published && normTitle.length >= 4;
    const origin = r.originUrl || (originSet.has(r.url) ? r.url : "");
    const key = JSON.stringify(origin ? [r.stage,origin,normTitle,r.lot || "",r.round || ""] : confirmed
      ? [r.stage,r.projectKey,r.tenderer,normTitle,r.lot || "",r.round || "",Math.floor((Number(r.published)/1e9+28800)/86400),r.deadlineText || "",r.budgetYuan || ""]
      : [r.stage,r.id]);
    if (!groups.has(key)) {
      groups.set(key, { primary: r, primaryScore: scoreRow(r), sources: new Map([[r.id, { id: r.id, source: r.source, url: r.url }]]), count: 1 });
      order.push(key);
    } else {
      const g = groups.get(key);
      g.count += 1;
      if (!g.sources.has(r.id)) {
        g.sources.set(r.id, { id: r.id, source: r.source, url: r.url });
      }
      const sc = scoreRow(r);
      if (sc > g.primaryScore) {
        g.primary = r;
        g.primaryScore = sc;
      }
    }
  }
  return order.map((k) => {
    const g = groups.get(k);
    const p = g.primary;
    const allSources = [...g.sources.values()];
    const extraSources = allSources.filter((x) => x.id !== p.id);
    return {
      ...p,
      allSources,
      extraSources,
      duplicateCount: g.count,
    };
  });
}

function isLikelySiteNameTitle(t) {
  const s = String(t || "").trim();
  if (!s || s.length < 6) return true;
  if (/^(首页|网站首页|公告详情|信息公开|详情页|招标公告|采购公告|未命名)$/.test(s)) return true;
  if (s.length <= 24 && /(公共资源交易|政府采购网|交易中心|交易平台|交易服务系统|招标投标网|采招网|电子交易|政务服务网|人民政府|财政局)$/.test(s) && !/(项目|工程|采购|服务|施工|设备|改造|修缮|绿化|道路|维保)/.test(s)) {
    return true;
  }
  return false;
}

function extractSmartNoticeFromHtml(html, rawUrl, manualBody = "") {
  const decodeEntities = (s) => String(s || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, " ")
    .trim();

  const stripHtmlText = (raw) => decodeEntities(
    String(raw || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<(br|\/p|\/div|\/tr|\/li|\/h[1-6])[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  ).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  const cleanTitle = (s) => decodeEntities(String(s || "").replace(/<[^>]+>/g, ""))
    .replace(/[-_|—–]\s*(盐城市?公共资源交易.*|江苏省?政府采购.*|中国政府采购.*|公共资源交易.*|政务服务网.*)$/i, "")
    .replace(/^【[^】]{1,12}】/, "")
    .trim();

  const bodyText = manualBody || stripHtmlText(html).slice(0, 24000);

  // Candidate title extraction priority:
  // 1) Explicit "项目名称：..." in body
  // 2) og:title / meta title (if not site name)
  // 3) h1 / h2 / h3 or elements with class/id containing title/biaoti/article-title
  // 4) <title> tag (if not site name)
  // 5) First body line containing 项目/工程/采购/招标/磋商/施工
  const candidates = [];
  const pmMatch = bodyText.match(/(?:项目名称|标段名称|工程名称|采购项目名称)[：:\s]+([^\n；;。]{6,120})/);
  if (pmMatch) candidates.push(cleanTitle(pmMatch[1]));

  const metaOg = html.match(/<meta[^>]+(?:property|name)=["'](?:og:title|ArticleTitle|title)["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:title|ArticleTitle|title)["']/i);
  if (metaOg) candidates.push(cleanTitle(metaOg[1]));

  const clsTitleRe = /<(?:h1|h2|h3|div|p|span)[^>]*(?:class|id)=["'][^"']*(?:article[-_]?title|news[-_]?title|detail[-_]?title|content[-_]?title|biaoti|ewb-article-tt|title)[^"']*["'][^>]*>([\s\S]*?)<\/(?:h1|h2|h3|div|p|span)>/gi;
  let cm;
  while ((cm = clsTitleRe.exec(html)) !== null && candidates.length < 12) {
    const t = cleanTitle(cm[1]);
    if (t.length >= 8 && t.length <= 140) candidates.push(t);
  }

  for (const tag of ["h1", "h2"]) {
    const m = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
    if (m) candidates.push(cleanTitle(m[1]));
  }

  const titleTagMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleTagMatch) candidates.push(cleanTitle(titleTagMatch[1]));

  const bodyLines = bodyText.split("\n").map((l) => l.trim()).filter((l) => l.length >= 8 && l.length <= 120);
  const projectLine = bodyLines.find((l) => /(招标公告|采购公告|竞争性磋商|工程|采购项目|施工项目)/.test(l) && !isLikelySiteNameTitle(l));
  if (projectLine) candidates.push(projectLine);

  const extractedTitle = candidates.find((c) => !isLikelySiteNameTitle(c)) || "";
  const titleLooksLikeSite = !extractedTitle;

  // Attachments
  const attachments = [];
  if (html) {
    const seenHref = new Set();
    const linkRe = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let lm;
    while ((lm = linkRe.exec(html)) !== null && attachments.length < 15) {
      const href = lm[1].trim();
      const label = decodeEntities(lm[2].replace(/<[^>]+>/g, ""));
      if (!href || href.startsWith("#") || href.startsWith("javascript:")) continue;
      if (!/\.(pdf|docx?|xlsx?|zip|rar)(\?|$)/i.test(href) && !/附件|招标文件|采购文件|清单|图纸/.test(label)) continue;
      try {
        const abs = new URL(href, rawUrl).href;
        if (seenHref.has(abs)) continue;
        seenHref.add(abs);
        attachments.push({ name: label || abs.split("/").pop() || "公告附件", url: abs });
      } catch {}
    }
  }

  const extractField = (re) => {
    const m = bodyText.match(re);
    return m ? m[1].replace(/[；;。\r\n]+$/, "").trim().slice(0, 100) : "";
  };
  const tenderer = extractField(/(?:招标人|采购人|发包人|建设单位)(?:名称)?[：:\s]+([^\n，,；;。]{2,60})/);
  const agency = extractField(/(?:代理机构|招标代理)(?:名称)?[：:\s]+([^\n，,；;。]{2,60})/);
  const projectKey = extractField(/(?:项目编号|标段编号|招标编号|采购编号)[：:\s]+([A-Za-z0-9\-_\/]{4,50})/);

  let budgetYuan = 0;
  let budgetText = "";
  const wanM = bodyText.match(/(?:最高投标限价|招标控制价|预算金额|最高限价|控制价|项目预算|估算价)[：:\s人民币约￥]*([0-9,]+(?:\.[0-9]+)?)\s*万(?:元)?/);
  const yuanM = bodyText.match(/(?:最高投标限价|招标控制价|预算金额|最高限价|控制价|项目预算)[：:\s人民币约￥]*([0-9,]+(?:\.[0-9]+)?)\s*元/);
  if (wanM) {
    budgetYuan = Math.round(Number(wanM[1].replace(/,/g, "")) * 10000);
    budgetText = `${wanM[1]}万元`;
  } else if (yuanM) {
    const val = Number(yuanM[1].replace(/,/g, ""));
    if (val >= 1000) {
      budgetYuan = Math.round(val);
      budgetText = val >= 10000 ? `${(val / 10000).toFixed(2)}万元` : `${val}元`;
    }
  }

  const deadlineMatch = bodyText.match(/(?:投标文件递交截止时间|开标时间|递交截止时间|提交响应文件截止时间|截止时间)[：:\s]*(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?\s*\d{1,2}[:：时]\d{1,2})/);
  const deadlineText = deadlineMatch ? deadlineMatch[1].replace(/[年月]/g, "-").replace(/日/g, "").replace(/[：时]/g, ":").replace(/\s+/g, " ").trim() : "";

  const tradeType = /政府采购|竞争性磋商|竞争性谈判|询价|单一来源|采购公告/.test(extractedTitle + bodyText.slice(0, 600)) ? "政府采购"
    : /水利|河道|堤防|泵站/.test(extractedTitle) ? "水利工程"
      : /交通|公路|桥梁|航道/.test(extractedTitle) ? "交通工程"
        : "工程建设";
  const region = refineDistrict("", extractedTitle, tenderer);

  return {
    title: extractedTitle,
    titleLooksLikeSite,
    tenderer,
    agency,
    projectKey,
    budgetYuan,
    budgetText,
    deadlineText,
    tradeType,
    region,
    attachments,
    bodyText,
  };
}

function findMatchingOpportunities(db, actor, { url, projectKey, title }) {
  const hits = new Map();
  const addHit = (row, reason) => {
    if (!row || hits.has(row.id)) return;
    hits.set(row.id, {
      id: row.id,
      title: row.title,
      source: row.source,
      region: row.region,
      tradeType: row.trade_type,
      tenderer: row.tenderer,
      budgetYuan: row.budget_yuan,
      budgetText: row.budget_text,
      deadlineText: row.deadline_text,
      stageLabel: row.stage_label,
      decision: row.decision || null,
      matchReason: reason,
    });
  };
  const baseSel = `SELECT m.id, m.title, m.source, m.region, m.trade_type, m.tenderer, m.budget_yuan, m.budget_text, m.deadline_text, m.stage_label, pf.decision
    FROM notice_meta m JOIN notice n ON n.id=m.id AND (n.draft=0 OR n.owner=?) LEFT JOIN project_follow pf ON pf.notice_id = m.id`;

  if (url) {
    const byUrl = db.prepare(`${baseSel} WHERE m.url = ? LIMIT 3`).all(actor,url);
    byUrl.forEach((r) => addHit(r, "官方链接完全一致"));
  }
  if (projectKey && projectKey.length >= 5 && !projectKey.startsWith("EXT-")) {
    const byPk = db.prepare(`${baseSel} WHERE m.project_key = ? ORDER BY m.published_ns DESC LIMIT 3`).all(actor,projectKey);
    byPk.forEach((r) => addHit(r, `项目编号一致 (${projectKey})`));
  }
  const norm = normalizeTitleForDedup(title);
  if (norm.length >= 6) {
    // Broad SQL LIKE on core substring, then verify normalized match
    const core = title.replace(/^(关于|盐城市|建湖县|射阳县|阜宁县|滨海县|响水县|东台市|大丰区|盐都区|亭湖区)/, "").slice(0, 14).trim();
    if (core.length >= 4) {
      const cands = db.prepare(`${baseSel} WHERE m.title LIKE ? ORDER BY m.published_ns DESC LIMIT 15`).all(actor,`%${core}%`);
      for (const c of cands) {
        const cn = normalizeTitleForDedup(c.title);
        if (cn === norm || (cn.length >= 8 && (cn.includes(norm) || norm.includes(cn)))) {
          addHit(c, "项目名称在机会池中已收录");
        }
      }
    }
  }
  return [...hits.values()].slice(0, 5);
}

function refineDistrict(region, title, tenderer) {
  const reg = (region || "").trim();
  if (reg && reg !== "盐城市") return reg;
  const text = `${reg} ${title || ""} ${tenderer || ""}`;
  for (const d of YANCHENG_DISTRICTS) {
    if (d.kw.some((k) => text.includes(k))) return d.key;
  }
  return reg || "盐城市（市本级/未分区）";
}

function extractWinnerFromBody(body, fallback) {
  if (fallback && fallback.trim() && fallback.trim() !== "未标注") return fallback.trim();
  if (!body) return "未标注";
  const m1 = body.match(/(?:中标(?:人|单位|供应商|候选人第一名)|成交(?:人|单位|供应商)|供应商名称|乙方)[：:\s\n]+([^\n\r，,。；;（(]{4,36}(?:公司|院|局|中心|所|厂|部|集团|企业))/);
  if (m1) return m1[1].trim();
  const m2 = body.match(/\n1\s*\n([^\n\r]{4,36}(?:有限公司|股份有限公司|集团|设计院|研究院))/);
  if (m2) return m2[1].trim();
  return "未标注";
}

function inferDocGroup(category, explicitGroup) {
  if (explicitGroup === "enterprise" || explicitGroup === "social_security" || explicitGroup === "other") return explicitGroup;
  if (category === "社保权益单" || category === "人员社保清册") return "social_security";
  if (["财务审计", "业绩合同", "开户许可与资信", "法人授权模板", "其他材料", "其他"].includes(category)) return "other";
  return "enterprise";
}

// An official later event may close a lot while the original deadline is still in the future.
const latestAvailability = `SELECT CASE WHEN count(distinct action)>1 THEN 'pending' ELSE min(action) END AS action,
 CASE WHEN count(distinct action)>1 THEN '同一发布时间的状态公告冲突，待核' ELSE min(title) END AS title,min(url) AS url FROM (
   SELECT c.title,c.url,c.published_ns,radar_availability(c.stage,c.title) AS action
   FROM notice_meta c JOIN notice cn ON cn.id=c.id
   WHERE m.project_key<>'' AND c.project_key=m.project_key AND c.id<>m.id AND cn.draft=0
     AND c.published_ns>=m.published_ns AND radar_same_scope(n.data,cn.data) AND radar_availability(c.stage,c.title)<>'')
 GROUP BY published_ns ORDER BY published_ns DESC LIMIT 1`;
const stillAvailable = `NOT EXISTS(SELECT 1 FROM (${latestAvailability}) change WHERE change.action<>'resumed')`;

const operationalDeadline = `radar_deadline(CAST(m.deadline_ns AS TEXT),
  (SELECT json_group_array(json_object('body',body,'state',original,'at',at_time)) FROM (
    SELECT json_extract(cn.data,'$.body') AS body,c.original_status AS original,CAST(c.published_ns AS TEXT) AS at_time
    FROM notice_meta c JOIN notice cn ON cn.id=c.id
    WHERE m.stage='tender' AND m.project_key<>'' AND c.project_key=m.project_key AND c.id<>m.id
      AND c.stage='amendment' AND cn.draft=0 AND c.published_ns>=m.published_ns AND radar_same_scope(n.data,cn.data)
    ORDER BY c.published_ns,c.id)))`;

function buildFilterWhere(params, nowMs) {
  const nowNs = BigInt(nowMs) * 1000000n;
  const clauses = ["(n.draft = 0 OR n.owner = ?)", "NOT EXISTS (SELECT 1 FROM notice_hidden nh WHERE nh.notice_id = m.id)"];
  const args = [params.userId];

  const tab = params.tab || "biddable";
  if (tab === "biddable") {
    clauses.push("m.stage = 'tender'");
  } else if (tab === "amendments") {
    clauses.push("m.stage IN ('amendment','suspended')");
  } else if (tab === "intent") {
    clauses.push("m.stage = 'intent'");
  } else if (tab === "results") {
    clauses.push("m.stage IN ('result','terminated','contract')");
  } else if (tab === "followed") {
    clauses.push("pf.decision IN ('watching','bidding')");
  }

  if (params.onlyOpen === "1" || params.onlyOpen === true) {
    clauses.push(`${operationalDeadline} > ? AND ${stillAvailable}`);
    args.push(Number(nowNs));
  }
  if (params.region) {
    clauses.push("m.region LIKE ?");
    args.push(`%${params.region}%`);
  }
  if (params.tradeType) {
    clauses.push("m.trade_type = ?");
    args.push(params.tradeType);
  }
  if (params.source) {
    clauses.push("m.source = ?");
    args.push(params.source);
  }
  if (params.qual) {
    clauses.push("(m.qual_tags LIKE ? OR m.title LIKE ?)");
    args.push(`%${params.qual}%`, `%${params.qual}%`);
  }
  if (params.q) {
    const like = `%${params.q}%`;
    clauses.push("(m.title LIKE ? OR m.tenderer LIKE ? OR m.agency LIKE ? OR m.source LIKE ? OR m.project_key LIKE ? OR m.qual_tags LIKE ?)");
    args.push(like, like, like, like, like, like);
  }
  if (params.minBudget !== undefined && params.minBudget !== "" && !Number.isNaN(Number(params.minBudget))) {
    clauses.push("m.budget_yuan >= ?");
    args.push(Math.round(Number(params.minBudget) * 10000));
  }
  if (params.maxBudget !== undefined && params.maxBudget !== "" && !Number.isNaN(Number(params.maxBudget))) {
    clauses.push("m.budget_yuan <= ?");
    args.push(Math.round(Number(params.maxBudget) * 10000));
  }
  return { where: clauses.join(" AND "), args };
}

export function createApp({ db, auth, origin }) {
  ensureAppTables(db);
  db.function("radar_qualification_text", { deterministic: true }, normalizeQualificationSearchText);
  db.function("radar_availability",{deterministic:true},availabilityAction);
  db.function("radar_deadline",{deterministic:true},(original,changes)=>BigInt(currentDeadline(original,JSON.parse(changes || "[]"))));
  db.function("radar_same_scope",{deterministic:true},(a,b)=>{
    try { return sameNoticeScope(JSON.parse(a),JSON.parse(b)) ? 1 : 0; } catch { return 0; }
  });
  try { scanExpiryReminders(db); } catch {}
  const expTimer = setInterval(() => {
    try { scanExpiryReminders(db); } catch {}
  }, 6 * 3600 * 1000);
  if (typeof expTimer.unref === "function") expTimer.unref();

  function audit(actor, action, target, outcome) {
    db.prepare("INSERT INTO audit(actor,action,target,outcome) VALUES (?,?,?,?)").run(actor, action, target, outcome);
  }
  function employee(id) {
    return db.prepare("SELECT id, username, name, role, approval, perspective, must_change FROM employee WHERE id=?").get(id);
  }
  function grant(id, company) {
    return db.prepare("SELECT view, edit, verify, sensitive_download FROM grant_company WHERE employee=? AND company=?").get(id, company);
  }
  const actorBinding = id => ({ $lifecycleActor: id });
  function expiryReadScope(alias) {
    return `EXISTS (SELECT 1 FROM grant_company g WHERE g.employee=$lifecycleActor AND g.company=${alias}.company_id AND g.view=1)`;
  }
  function lotWriteAllowed(user, noticeId, chosenCompany = "") {
    const bound = db.prepare("SELECT company_id FROM lot_workflow WHERE notice_id=?").get(noticeId)?.company_id || "";
    return (!bound || Boolean(grant(user.id, bound)?.edit)) && (!chosenCompany || Boolean(grant(user.id, chosenCompany)?.edit)) &&
      (user.role === "admin" || Boolean(db.prepare("SELECT 1 FROM grant_company WHERE employee=? AND edit=1 LIMIT 1").get(user.id)));
  }
  function visible(id, notice) {
    return db.prepare("SELECT data FROM notice WHERE id=? AND (draft=0 OR owner=?)").get(notice, id);
  }
  function lifecycleReadScope(alias, company, author) {
    const companyView = value => `EXISTS (SELECT 1 FROM grant_company g
      WHERE g.employee=$lifecycleActor AND g.company=${value} AND g.view=1)`;
    return `EXISTS (SELECT 1 FROM notice n WHERE n.id=${alias}.notice_id AND (n.draft=0 OR n.owner=$lifecycleActor))
      AND ((coalesce(${company},'')<>'' AND ${companyView(company)})
        OR (coalesce(${company},'')='' AND ${author}=$lifecycleActor
          AND NOT EXISTS (SELECT 1 FROM lot_workflow bound_workflow WHERE bound_workflow.notice_id=${alias}.notice_id
            AND bound_workflow.company_id<>'' AND NOT ${companyView("bound_workflow.company_id")})))`;
  }
  function followedLifecycleReadScope() {
    return lifecycleReadScope("pf", "coalesce((SELECT w.company_id FROM lot_workflow w WHERE w.notice_id=pf.notice_id),'')", "pf.updated_by");
  }
  function paymentAlertReadScope(alias) {
    const payment = `${alias}.title LIKE '财务待打保证金(%'`;
    const preparation = `${alias}.title LIKE '待办保证金/保函：%'`;
    const refund = `${alias}.title LIKE '未中标退保证金：%'`;
    return `(${alias}.kind<>'todo' OR NOT (${payment} OR ${preparation} OR ${refund})
      OR ((${payment}) AND ${alias}.payment_task_id<>'' AND EXISTS (SELECT 1 FROM deposit_pay_task t
        WHERE t.id=${alias}.payment_task_id AND t.notice_id=${alias}.notice_id
          AND ${lifecycleReadScope("t", "t.company_id", "t.requested_by")}))
      OR ((${preparation} OR ${refund}) AND ${alias}.finance_company_id<>'' AND EXISTS (SELECT 1 FROM grant_company g
        WHERE g.employee=$lifecycleActor AND g.company=${alias}.finance_company_id AND g.view=1)))`;
  }
  function activeFollowForAlert(alias) {
    return `EXISTS (
      SELECT 1 FROM project_follow f
      JOIN notice base ON base.id=f.notice_id
      JOIN notice linked ON linked.id=${alias}.notice_id
      WHERE f.decision IN ('watching','bidding')
        AND (base.draft=0 OR (linked.draft=1 AND linked.owner=base.owner))
        AND NOT EXISTS (SELECT 1 FROM notice_hidden hidden WHERE hidden.notice_id=base.id)
        AND ((${alias}.kind='deadline' AND f.notice_id=${alias}.notice_id)
          OR (${alias}.kind='amendment' AND (
            ${alias}.id='amend:' || f.notice_id || ':' || ${alias}.notice_id
            OR (${alias}.id='amend:' || ${alias}.notice_id AND ${alias}.project_key<>''
              AND f.project_key=${alias}.project_key AND radar_same_scope(base.data,linked.data))
          )))
    )`;
  }
  function isFollowReminder(alias) {
    return `((${alias}.kind='amendment' AND ${alias}.id LIKE 'amend:%')
      OR (${alias}.kind='deadline' AND ${alias}.id='due:' || ${alias}.notice_id))`;
  }
  function projectAlertReadScope(alias) {
    const scopedAmendment = `(${alias}.kind='amendment' AND ${alias}.id LIKE 'amend:%:%')`;
    return `(${alias}.notice_id IS NULL OR EXISTS (
      SELECT 1 FROM notice linked WHERE linked.id=${alias}.notice_id AND (linked.draft=0 OR linked.owner=$lifecycleActor)
    )) AND (NOT ${scopedAmendment} OR EXISTS (
      SELECT 1 FROM notice base
      WHERE base.id=substr(${alias}.id,7,length(${alias}.id)-length(${alias}.notice_id)-7)
        AND (base.draft=0 OR base.owner=$lifecycleActor)
    )) AND ${paymentAlertReadScope(alias)}`;
  }
  function alertStatus(alias) {
    return `CASE WHEN ${alias}.status='open' AND ${isFollowReminder(alias)} AND NOT ${activeFollowForAlert(alias)}
      THEN 'dismissed' ELSE ${alias}.status END`;
  }
  function lifecycleWorkflowFiles(workflow, actor) {
    if (!workflow) return null;
    const file = db.prepare(`SELECT f.filename FROM company_file f JOIN grant_company g ON g.company=f.company_id
      WHERE f.id=? AND f.owner_type='doc' AND f.owner_id=? AND g.employee=? AND g.view=1`);
    for (const slot of ["doc_buy", "prep", "opening_sheet"]) {
      const id = workflow[`${slot}_file_id`];
      const allowed = id && file.get(id, `lot_${workflow.notice_id}_${slot}`, actor);
      workflow[`${slot}_file_id`] = allowed ? id : "";
      workflow[`${slot}_file_name`] = allowed?.filename || "";
    }
    if (workflow.prep_pm_person_id && !db.prepare(`SELECT 1 FROM company_person p
      JOIN grant_company g ON g.company=p.company_id AND g.employee=? AND g.view=1 WHERE p.id=?`)
      .get(actor, workflow.prep_pm_person_id)) {
      workflow.prep_pm_person_id = "";
      workflow.prep_pm_name = "";
    }
    return workflow;
  }
  function lifecyclePayment(task, actor) {
    const file = db.prepare(`SELECT f.filename FROM company_file f JOIN grant_company g ON g.company=f.company_id
      WHERE f.id=? AND f.owner_type='doc' AND f.owner_id=? AND g.employee=? AND g.view=1`);
    let receipts = [];
    try {
      const items = JSON.parse(task.receipt_files_json || "[]");
      if (Array.isArray(items)) receipts = items.flatMap(item => {
        const match = typeof item?.fileId === "string" && file.get(item.fileId, `pay_receipt_${task.id}`, actor);
        return match ? [{ fileId: item.fileId, filename: match.filename }] : [];
      });
    } catch {}
    const linked = task.finance_entry_id && db.prepare(`SELECT 1 FROM finance_entry f WHERE f.id=? AND f.notice_id=?
      AND ${lifecycleReadScope("f", "f.company_id", "f.actor")}`)
      .get({ $lifecycleActor: actor }, task.finance_entry_id, task.notice_id);
    return { ...task, receipt_files_json: JSON.stringify(receipts), finance_entry_id: linked ? task.finance_entry_id : "", receiptFiles: receipts };
  }
  function scopeTimeline(id, projectKey, actor) {
    if (!projectKey) return [];
    return db.prepare(`SELECT m.id,m.title,m.stage,m.stage_label AS stageLabel,m.category,m.source,m.url,
      CAST(m.published_ns AS TEXT) AS published,CAST(m.deadline_ns AS TEXT) AS deadline,
      m.deadline_text AS deadlineText,m.budget_text AS budgetText,m.original_status AS originalStatus
      FROM notice_meta m JOIN notice n ON n.id=m.id JOIN notice base ON base.id=?
      WHERE m.project_key=? AND (n.draft=0 OR n.owner=?) AND radar_same_scope(base.data,n.data)
      ORDER BY m.published_ns,m.id`).all(id,projectKey,actor).map(row=>({...row,isCurrent:row.id===id,isAmendment:row.stage==="amendment"}));
  }

  function companyMatch(id, companyId, evidence, docs = companyInputs(db, companyId), personnel) {
    personnel ??= db.prepare("SELECT id,name,role_title,cert_level,cert_valid_until,lock_status,status FROM company_person WHERE company_id=? ORDER BY id").all(companyId);
    const assigned = db.prepare("SELECT prep_pm_person_id,prep_pm_name FROM lot_workflow WHERE notice_id=? AND company_id=?").get(id, companyId) || {};
    const results = evaluateNoticeRequirements(evidence, docs, undefined, personnel);
    return { results, fingerprint: matchFingerprint(evidence, docs, results, [personnel, assigned]) };
  }
  function companyScreeningCandidates(docs, actor) {
    const terms = qualificationSearchTerms(docs);
    if (!terms.length) return { notices: new Set(), amendments: new Set() };
    const candidates = db.prepare(`WITH terms AS (SELECT value FROM json_each(?)),
      notice_text AS MATERIALIZED (
        SELECT n.id,radar_qualification_text(json_extract(n.data,'$.body')) AS text
        FROM notice n WHERE (n.draft=0 OR n.owner=?)
      ), attachment_text AS MATERIALIZED (
        SELECT p.notice_id,radar_qualification_text(p.body) AS text
        FROM notice_attachment_page p
        JOIN notice_attachment_document ad ON ad.notice_id=p.notice_id AND ad.att_idx=p.att_idx AND ad.sha256=p.sha256
        JOIN notice_attachment_cache ac ON ac.notice_id=p.notice_id AND ac.att_idx=p.att_idx AND ac.sha256=p.sha256
        JOIN notice n ON n.id=p.notice_id AND (n.draft=0 OR n.owner=?)
        WHERE p.status='text' AND ac.status='cached'
      ),
      hits(id) AS (
        SELECT source.id FROM notice_text source WHERE EXISTS (SELECT 1 FROM terms WHERE instr(source.text,terms.value)>0)
        UNION
        SELECT source.notice_id FROM attachment_text source WHERE EXISTS (SELECT 1 FROM terms WHERE instr(source.text,terms.value)>0)
      ) SELECT m.id,m.project_key,m.stage FROM hits JOIN notice_meta m ON m.id=hits.id`).all(JSON.stringify(terms), actor, actor);
    return {
      notices: new Set(candidates.map(row => row.id)),
      amendments: new Set(candidates.filter(row => row.stage === "amendment" && row.project_key).map(row => row.project_key)),
    };
  }
  function recommendedCompany(noticeId, companyId, evidence, caps) {
    const candidate = matchNoticeToCapabilities({ evidence }, caps);
    if (!candidate) return null;
    const { results, fingerprint } = companyMatch(noticeId, companyId, evidence);
    if (results.outcome !== "conform") return null;
    const blocked = db.prepare(`SELECT 1 FROM lot_matrix_cell c
      JOIN qualification_review_basis b ON b.notice_id=c.notice_id AND b.company_id=c.company_id AND b.req_key=c.req_key
      WHERE c.notice_id=? AND c.company_id=? AND b.fingerprint=? AND c.status IN ('non_conform','pending','missing') LIMIT 1`)
      .get(noticeId, companyId, fingerprint);
    return blocked ? null : candidate;
  }

  function getNoticeEvidence(id, parsed, actor, observedAt = "") {
    const linkedAttachments = Array.isArray(parsed.attachments) ? parsed.attachments : [];
    let pages = [];
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='notice_attachment_page'").get()) {
      const documentRows = observedAt
        ? `(SELECT *, ROW_NUMBER() OVER (PARTITION BY att_idx ORDER BY captured_at DESC, seq DESC) AS row_rank
            FROM notice_attachment_event WHERE notice_id=? AND julianday(captured_at)<=julianday(?))`
        : "notice_attachment_document";
      pages = db.prepare(`SELECT p.att_idx,p.page_no,p.body,p.status,d.source_url,d.sha256,d.total_pages,d.status AS doc_status
        FROM notice_attachment_page p JOIN ${documentRows} d
        ON d.notice_id=p.notice_id AND d.att_idx=p.att_idx AND d.sha256=p.sha256
        ${observedAt ? "" : `JOIN notice_attachment_cache c ON c.notice_id=d.notice_id AND c.att_idx=d.att_idx
          AND c.source_url=d.source_url AND c.sha256=d.sha256 AND c.status='cached' AND NOT EXISTS(SELECT 1 FROM notice_attachment_retry r WHERE r.notice_id=d.notice_id AND r.att_idx=d.att_idx AND r.source_url=d.source_url AND r.last_error='fetch_or_archive_failed')`}
        WHERE p.notice_id=? ${observedAt ? "AND d.row_rank=1" : ""} ORDER BY p.att_idx,p.page_no`)
        .all(...(observedAt ? [id, observedAt, id] : [id]));
    }
    const attachments = linkedAttachments.map((attachment, index) => {
      const rows = pages.filter(page => page.att_idx === index && page.source_url === attachment?.url);
      const head = rows[0];
      return {
        index,
        label: attachment?.name || attachment?.title || attachment?.filename || `附件 ${index + 1}`,
        url: attachment?.url || "",
        sha256: head?.sha256 || "",
        readable: head?.doc_status === "text" && (
          (head.page_no === 0 && rows.length === 1 && (head.total_pages === 1 || head.total_pages === null)) ||
          (head.page_no === 1 && head.total_pages > 0 && rows.length === head.total_pages)
        ) && rows.every((page, offset) => page.status === "text" && page.body.trim() && page.page_no === offset + head.page_no),
        pages: rows.map(page => ({ number: page.page_no, status: page.status, excerpt: page.status === "ocr_review" ? page.body.slice(0, 180) : "" })),
      };
    });
    const documents = pages.filter(page => page.status === "text" && page.body.trim() && attachments[page.att_idx]?.url === page.source_url).map(page => ({
      label: attachments[page.att_idx].label,
      version: `attachment:${page.att_idx}:${page.sha256}`,
      kind: "attachment",
      url: page.source_url,
      page: page.page_no,
      body: page.body,
    }));
    if (!observedAt && parsed.projectKey) {
      const amendments = db.prepare(`SELECT m.id, m.title, m.url, n.data FROM notice_meta m JOIN notice n ON n.id=m.id
        WHERE m.project_key=? AND m.stage='amendment' AND m.id<>? AND n.draft=0
        ORDER BY m.published_ns DESC LIMIT 10`).all(parsed.projectKey, id);
      for (const row of amendments) {
        const amendment = JSON.parse(row.data);
        if (!sameNoticeScope(parsed, amendment)) continue;
        const captured = noticeBodyAvailable(amendment);
        documents.push({ label: row.title, kind: "amendment", url: row.url, body: captured ? amendment.body : "", complete: noticeBodyComplete(amendment) });
      }
    }
    const aiExtract = !observedAt ? getCachedNoticeAiExtract(db, id) : null;
    const evidence = extractNoticeEvidence({
      body: noticeBodyAvailable(parsed) ? parsed.body : "",
      bodyComplete: noticeBodyComplete(parsed),
      url: parsed.url,
      documents,
      attachments,
      attachmentsKnown: !["not_checked", "unknown"].includes(parsed.evidence?.attachmentStatus),
      aiExtract,
    });
    if (!observedAt && parsed.stage==="tender" && parsed.projectKey) {
      const change=db.prepare(`SELECT (SELECT json_object('action',x.action,'title',x.title,'url',x.url) FROM (${latestAvailability}) x) AS latest
        FROM notice_meta m JOIN notice n ON n.id=m.id WHERE m.id=?`).get(id);
      const clock = db.prepare(`SELECT CAST(${operationalDeadline} AS TEXT) AS current,CAST(m.deadline_ns AS TEXT) AS original FROM notice_meta m JOIN notice n ON n.id=m.id WHERE m.id=?`).get(id);
      if (clock && clock.current !== clock.original) {
        evidence.operationalDeadline=clock.current;
        if (clock.current==="0") evidence.completeness.deadline=false;
      }
      const current=change?.latest ? JSON.parse(change.latest) : null;
      if (current && current.action!=="resumed") {
        evidence.completeness.open=false;
        evidence.availabilityChange=current;
      }
    }
    return evidence;
  }
  function noticeBodyAvailable(notice) {
    return notice.originalStatus !== "uncached" && (!notice.evidence?.bodyStatus || notice.evidence.bodyStatus === "captured");
  }
  function noticeBodyComplete(notice) {
    return noticeBodyAvailable(notice) && notice.originalStatus !== "incomplete";
  }
  function denied(actor, action, target) {
    audit(actor, action, target, "已拦截");
    return forbidden();
  }
  function getAiConfig() {
    const rows = db.prepare("SELECT key, value FROM app_setting WHERE key IN ('tokenhub_base_url','tokenhub_api_key','tokenhub_default_model')").all();
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const dbKey = (map.tokenhub_api_key || "").trim();
    const envKey = (process.env.TOKENHUB_API_KEY || "").trim();
    const apiKey = process.env.CIVIC_RADAR_ENABLE_AI === "1" ? dbKey || envKey : "";
    const baseUrl = ((map.tokenhub_base_url || "").trim() || process.env.TOKENHUB_BASE_URL || "https://api.example.invalid/v1").replace(/\/+$/, "");
    const defaultModel = ((map.tokenhub_default_model || "").trim() || process.env.TOKENHUB_DEFAULT_MODEL || "deepseek-v4.1-flash").trim();
    return {
      baseUrl,
      apiKey,
      defaultModel,
      hasApiKey: !!apiKey,
      keySource: !apiKey ? "none" : dbKey ? "settings" : "env",
    };
  }

  function getSyncMeta() {
    try {
      const sync = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='legacy_public_sync'").get() && db.prepare("SELECT observed_at, source_round, imported, rejected FROM legacy_public_sync WHERE singleton=1").get();
      const unhealthy = db.prepare("SELECT count(*) AS cnt FROM source_health WHERE enabled=1 AND (failures > 0 OR reason <> '')").get();
      const totalSrc = db.prepare("SELECT count(*) AS cnt FROM source_health WHERE enabled=1").get();
      return {
        observedAt: sync?.observed_at ?? "0",
        sourceRound: sync?.source_round ?? "0",
        imported: sync?.imported ?? 0,
        rejected: sync?.rejected ?? 0,
        enabledSources: totalSrc?.cnt ?? 0,
        unhealthySources: unhealthy?.cnt ?? 0,
      };
    } catch {
      return { observedAt: "0", sourceRound: "0", imported: 0, rejected: 0, enabledSources: 0, unhealthySources: 0 };
    }
  }

  let credentialTail = Promise.resolve();
  function credentials(work) {
    const next = credentialTail.then(work);
    credentialTail = next.catch(() => {});
    return next;
  }

  async function current(request) {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) return null;
    if (!db.prepare("SELECT 1 FROM session WHERE id=? AND userId=?").get(session.session.id, session.user.id)) return null;
    return employee(session.user.id);
  }

  return async function handle(request) {
    const { pathname, searchParams } = new URL(request.url);
    if (request.method === "POST" && request.headers.get("origin") !== origin) return forbidden();
    if (authPaths.has(pathname) && request.method === "POST") {
      return credentials(async () => {
        const result = await auth.handler(request);
        if (!result.ok) return json({ message: result.status === 429 ? "尝试次数过多，请稍后重试。" : "账号或密码有误。" }, result.status);
        const headers = new Headers({ "Cache-Control": "no-store" });
        for (const cookie of result.headers.getSetCookie()) headers.append("Set-Cookie", cookie);
        return new Response(null, { status: 200, headers });
      });
    }

    if (request.method !== "GET" && request.method !== "POST") return missing();
    let body;
    if (request.method === "POST") {
      try { body = await request.json(); } catch { return invalid(); }
      if (body === null || typeof body !== "object" || Array.isArray(body)) return invalid();
    }

    const getDefaultFinanceEmployee = () => {
      const savedId = db.prepare("SELECT value FROM app_setting WHERE key='default_finance_user_id'").get()?.value || "";
      if (savedId) {
        const hit = db.prepare("SELECT id, username, name FROM employee WHERE id=? AND approval='approved'").get(savedId);
        if (hit) return hit;
      }
      return db.prepare("SELECT id, username, name FROM employee WHERE approval='approved' AND perspective='finance' ORDER BY id LIMIT 1").get() || null;
    };

    async function changePassword() {
      const user = await current(request);
      if (!user) return unsigned();
      if (user.approval !== "approved") return forbidden();
      const { currentPassword, newPassword } = body;
      if (typeof currentPassword !== "string" || currentPassword.length > maxPasswordLength ||
          typeof newPassword !== "string" || newPassword.length < minPasswordLength || newPassword.length > maxPasswordLength ||
          !newPassword.trim() || newPassword === currentPassword) {
        return json({ message: `新密码须为 ${minPasswordLength}–${maxPasswordLength} 个字符，并与当前密码不同。` }, 400);
      }
      const result = await auth.api.changePassword({
        headers: request.headers, body: { currentPassword, newPassword, revokeOtherSessions: true },
        asResponse: true,
      });
      if (!result.ok) return json({ message: "当前密码有误或会话已结束，请重试。" }, result.status);
      transaction(db, () => {
        db.prepare("UPDATE employee SET must_change=0 WHERE id=?").run(user.id);
        db.prepare("DELETE FROM session WHERE userId=?").run(user.id);
        audit(user.id, "改密", user.id, "已记录");
      });
      const signOutRes = await auth.api.signOut({ headers: request.headers, asResponse: true }).catch(() => null);
      const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" });
      if (signOutRes) {
        for (const cookie of signOutRes.headers.getSetCookie()) headers.append("Set-Cookie", cookie);
      }
      return new Response(JSON.stringify({ reauthenticate: true }), { status: 200, headers });
    }

    async function administer() {
      const user = await current(request);
      if (!user) return unsigned();
      if (user.approval !== "approved" || user.role !== "admin") return denied(user.id, "账号管理", "账号与授权");

      // Create new enterprise member (Better Auth user + credential account + employee + optional grant preset)
      if (pathname === "/api/admin/members") {
        const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
        const name = typeof body.name === "string" ? body.name.trim().slice(0, 40) : "";
        const role = body.role === "admin" ? "admin" : "member";
        const perspective = perspectivePaths.has(body.perspective) ? body.perspective : "bidder";
        const preset = ["all_view", "all_work", "all_full", "none"].includes(body.grantPreset) ? body.grantPreset : "all_view";
        if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(username)) {
          return invalid("登录账号须为 3–30 位小写字母、数字、点、下划线或连字符，且以字母或数字开头。");
        }
        if (!name) return invalid("请填写成员姓名。");
        if (db.prepare("SELECT 1 FROM employee WHERE username=?").get(username)) {
          return invalid("该登录账号已存在，请更换账号名。");
        }
        const id = randomUUID();
        const password = temporaryPassword();
        const ctx = await auth.$context;
        const hash = await ctx.password.hash(password);
        await ctx.internalAdapter.createUser({
          id, name, email: `${username}@accounts.example.invalid`,
          emailVerified: false, username, displayUsername: username,
        });
        await ctx.internalAdapter.linkAccount({
          userId: id, accountId: id, providerId: "credential", password: hash,
        });
        transaction(db, () => {
          db.prepare("INSERT INTO employee(id,username,name,source_account,role,approval,perspective,must_change) VALUES (?,?,?,?,?,'approved',?,0)")
            .run(id, username, name, "{}", role, perspective);
          if (preset !== "none") {
            const comps = db.prepare("SELECT id FROM company").all();
            const v = 1, e = preset === "all_work" || preset === "all_full" ? 1 : 0, vf = preset === "all_full" ? 1 : 0, sd = preset === "all_full" ? 1 : 0;
            for (const c of comps) {
              db.prepare("INSERT OR REPLACE INTO grant_company VALUES (?,?,?,?,?,?)").run(id, c.id, v, e, vf, sd);
            }
          }
          audit(user.id, "新建企业成员", `${username}(${name})/${perspective}/${preset}`, "已记录");
        });
        return json({ id, username, name, password });
      }

      // Update member profile, role, perspective, or approval (enable/disable)
      const memberUpdate = pathname.match(/^\/api\/admin\/members\/([^/]+)\/update$/);
      if (memberUpdate) {
        const target = employee(decodeURIComponent(memberUpdate[1]));
        if (!target) return missing();
        const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 40) : target.name;
        const role = body.role === "admin" || body.role === "member" ? body.role : target.role;
        const perspective = perspectivePaths.has(body.perspective) ? body.perspective : target.perspective;
        const approval = ["approved", "pending", "rejected"].includes(body.approval) ? body.approval : target.approval;
        if (target.id === user.id && (approval !== "approved" || role !== "admin")) {
          return invalid("为防止系统锁死，不可停用或降级当前正在操作的管理员自身账号。");
        }
        transaction(db, () => {
          db.prepare("UPDATE employee SET name=?, role=?, perspective=?, approval=? WHERE id=?")
            .run(name, role, perspective, approval, target.id);
          if (approval !== "approved") {
            db.prepare("DELETE FROM session WHERE userId=?").run(target.id);
          }
          audit(user.id, "更新成员属性", `${target.username}/${role}/${perspective}/${approval}`, "已记录");
        });
        return json({ ok: true });
      }

      // One-click batch company grants preset
      if (pathname === "/api/admin/grants/batch") {
        const target = typeof body.account === "string" && employee(body.account);
        if (!target) return missing();
        const preset = body.preset;
        if (!["all_view", "all_work", "all_full", "clear"].includes(preset)) return invalid("无效的批量授权模板。");
        transaction(db, () => {
          if (preset === "clear") {
            db.prepare("DELETE FROM grant_company WHERE employee=?").run(target.id);
          } else {
            const comps = db.prepare("SELECT id FROM company").all();
            const v = 1, e = preset === "all_work" || preset === "all_full" ? 1 : 0, vf = preset === "all_full" ? 1 : 0, sd = preset === "all_full" ? 1 : 0;
            for (const c of comps) {
              db.prepare("INSERT OR REPLACE INTO grant_company VALUES (?,?,?,?,?,?)").run(target.id, c.id, v, e, vf, sd);
            }
          }
          audit(user.id, "批量公司授权", `${target.username}/${preset}`, "已记录");
        });
        return json({ ok: true });
      }

      const target = typeof body.account === "string" && employee(body.account);
      if (!target) return missing();
      if (pathname === "/api/admin/grants") {
        if (typeof body.company !== "string" || !db.prepare("SELECT 1 FROM company WHERE id=?").get(body.company) ||
          !["view","edit","verify","sensitiveDownload"].every((key) => typeof body[key] === "boolean")) return invalid();
        transaction(db, () => {
          db.prepare("INSERT OR REPLACE INTO grant_company VALUES (?,?,?,?,?,?)")
            .run(target.id, body.company, +body.view, +body.edit, +body.verify, +body.sensitiveDownload);
          audit(user.id, "公司授权变更", `${target.id}/${body.company}`, "已记录");
        });
        return json({ recorded: true });
      }
      const reset = pathname === "/api/admin/reset";
      const password = reset ? temporaryPassword() : null;
      const hash = password ? await (await auth.$context).password.hash(password) : null;
      transaction(db, () => {
        if (reset) {
          const updated = db.prepare("UPDATE account SET password=?, updatedAt=CURRENT_TIMESTAMP WHERE userId=? AND providerId='credential'").run(hash, target.id);
          if (updated.changes !== 1) throw new Error("Missing credential account.");
          db.prepare("UPDATE employee SET must_change=0 WHERE id=?").run(target.id);
        }
        db.prepare("DELETE FROM session WHERE userId=?").run(target.id);
        audit(user.id, reset ? "重置密码" : "撤销会话", target.id, "已记录");
      });
      return json(reset ? { username: target.username, password } : { revoked: true });
    }

    if (request.method === "POST" && pathname === "/api/password") return credentials(changePassword);
    if (request.method === "POST" && (
      ["/api/admin/reset", "/api/admin/revoke", "/api/admin/grants", "/api/admin/members", "/api/admin/grants/batch"].includes(pathname) ||
      /^\/api\/admin\/members\/[^/]+\/update$/.test(pathname)
    )) return credentials(administer);

    const user = await current(request);
    if (!user) return unsigned();
    if (request.method === "GET" && pathname === "/api/session") {
      return json({
        id: user.id, username: user.username, name: user.name, role: user.role, approval: user.approval,
        perspective: perspectivePaths.has(user.perspective) ? user.perspective : "lead", mustChange: false,
      });
    }
    if (user.approval !== "approved") return denied(user.id, "业务访问", "工作台");

    // --- POST business endpoints ---
    if (request.method === "POST") {
      // 1. Follow / assign owner / create todo / retract ("none") on a notice
      const followMatch = pathname.match(/^\/api\/opportunities\/(\d+)\/follow$/);
      if (followMatch) {
        const noticeId = followMatch[1];
        const meta = db.prepare("SELECT id, title, project_key, CAST(deadline_ns AS TEXT) AS dl_ns, deadline_text, stage, qual_tags, trade_type FROM notice_meta WHERE id=?").get(noticeId);
        const notice = visible(user.id, noticeId);
        if (!meta || !notice) return missing();
        const chosenCompany = typeof body.companyId === "string" ? body.companyId.trim() : "";
        if (!lotWriteAllowed(user, noticeId, chosenCompany)) return denied(user.id, "修改参投跟进", noticeId);
        const decision = ["watching", "bidding", "declined", "none"].includes(body.decision) ? body.decision : "watching";
        const assigneeId = typeof body.assigneeId === "string" && body.assigneeId.trim() ? body.assigneeId.trim() : null;
        if (assigneeId && !employee(assigneeId)) return invalid("所选负责人不存在，请刷新后重选。");
        const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
        if (decision === "declined" && !note) {
          return invalid("标记为「不参与」属于高风险排除操作，必须填写原因（操作将记入审计日志）。");
        }
        if (decision === "none") {
          transaction(db, () => {
            db.prepare("DELETE FROM project_follow WHERE notice_id=?").run(noticeId);
            db.prepare("UPDATE deposit_pay_task SET status='cancelled' WHERE notice_id=? AND status='pending'").run(noticeId);
            audit(user.id, "撤回选定状态", `${noticeId}/恢复未选定`, "已撤回");
          });
          return json({ ok: true, decision: null });
        }

        // Auto-infer matching company when decision === 'bidding' and no company_id bound yet
        let inferredCompanyId = decision === "bidding" ? chosenCompany : "";
        let inferredCompanyName = "";
        const existingWf = db.prepare("SELECT company_id FROM lot_workflow WHERE notice_id=?").get(noticeId);
        if (decision === "bidding" && (!existingWf || !existingWf.company_id)) {
          if (inferredCompanyId && grant(user.id, inferredCompanyId)?.edit) {
            inferredCompanyName = db.prepare("SELECT name FROM company WHERE id=?").get(inferredCompanyId)?.name || "";
          } else {
            inferredCompanyId = "";
            const candCos = db.prepare("SELECT c.id, c.name FROM company c JOIN grant_company g ON g.company=c.id WHERE g.employee=? AND g.edit=1").all(user.id);
            const matchedCos = [];
            const evidence = getNoticeEvidence(noticeId, JSON.parse(notice.data), user.id);
            for (const co of candCos) {
              const docs = db.prepare("SELECT id, category, name, doc_no, issuer, qual_items_json, valid_until, status, file_id FROM company_doc WHERE company_id=? AND status<>'void'").all(co.id);
              const personnel = db.prepare("SELECT id, name, role_title, cert_level, cert_valid_until, lock_status, status FROM company_person WHERE company_id=?").all(co.id);
              const caps = { ...extractCompanyCapabilities(docs), personnel };
              if (!caps.specs?.length && !caps.hasSafety) continue;
              if (recommendedCompany(noticeId, co.id, evidence, caps)) matchedCos.push(co);
            }
            if (matchedCos.length === 1) {
              inferredCompanyId = matchedCos[0].id;
              inferredCompanyName = matchedCos[0].name;
            }
          }
        }

        const todoTitle = typeof body.todoTitle === "string" ? body.todoTitle.trim().slice(0, 140) : "";
        const nowNsBig = BigInt(Date.now()) * 1000000n;
        const soonNsBig = nowNsBig + 72n * 3600n * 1000000000n;
        const metaDlBig = BigInt(meta.dl_ns || "0");
        transaction(db, () => {
          db.prepare(`INSERT INTO project_follow(notice_id,project_key,decision,assignee,note,updated_by,updated_at)
            VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)
            ON CONFLICT(notice_id) DO UPDATE SET
              decision=excluded.decision, assignee=excluded.assignee, note=excluded.note,
              updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP`)
            .run(noticeId, meta.project_key, decision, assigneeId, note, user.id);

          if (inferredCompanyId) {
            db.prepare(`INSERT INTO lot_workflow(notice_id,company_id,active_step,updated_by,updated_by_name,updated_at)
              VALUES (?,?,1,?,?,CURRENT_TIMESTAMP)
              ON CONFLICT(notice_id) DO UPDATE SET
                company_id=CASE WHEN lot_workflow.company_id='' OR lot_workflow.company_id IS NULL THEN excluded.company_id ELSE lot_workflow.company_id END`)
              .run(noticeId, inferredCompanyId, user.id, user.name);
          }

          if (decision === "declined") {
            db.prepare(`UPDATE alert_todo AS a SET status='dismissed', updated_at=CURRENT_TIMESTAMP
              WHERE a.status='open' AND a.notice_id=? AND NOT ${isFollowReminder("a")}`).run(noticeId);
            db.prepare(`UPDATE deposit_pay_task SET status='cancelled' WHERE notice_id=? AND status='pending'`).run(noticeId);
            db.prepare(`DELETE FROM bid_schedule WHERE notice_id=?`).run(noticeId);
          } else {
            // Selected project: generate alerts ONLY for this selected project if amendments exist or deadline <= 72h
            if (meta.project_key) {
              const amends = scopeTimeline(noticeId,meta.project_key,user.id)
                .filter(a => a.isAmendment && !a.isCurrent).slice(-5);
              const hasLegacy = db.prepare("SELECT 1 FROM alert_todo WHERE id=? AND kind='amendment'");
              const canNotify = db.prepare(`SELECT 1 FROM notice linked JOIN notice base ON base.id=?
                WHERE linked.id=? AND (base.draft=0 OR (linked.draft=1 AND linked.owner=base.owner))
                  AND NOT EXISTS (SELECT 1 FROM notice_hidden h WHERE h.notice_id IN (base.id,linked.id))`);
              for (const a of amends) {
                if (!canNotify.get(noticeId, a.id) || hasLegacy.get(`amend:${a.id}`)) continue;
                db.prepare(`INSERT OR IGNORE INTO alert_todo(id,kind,notice_id,project_key,title,detail,assignee,due_ns)
                  VALUES (?,?,?,?,?,?,?,CAST(? AS INTEGER))`)
                  .run(`amend:${meta.id}:${a.id}`, "amendment", a.id, meta.project_key, `更正变更：${a.title}`,
                    `已选项目「${meta.project_key}」存在更正/答疑公告，请核对变更内容`, assigneeId || user.id, a.deadline || "0");
              }
            }
            if (meta.stage === "tender" && metaDlBig > nowNsBig && metaDlBig <= soonNsBig) {
              db.prepare(`INSERT OR IGNORE INTO alert_todo(id,kind,notice_id,project_key,title,detail,assignee,due_ns)
                VALUES (?,?,?,?,?,?,?,CAST(? AS INTEGER))`)
                .run(`due:${meta.id}`, "deadline", meta.id, meta.project_key, `临近截止：${meta.title}`,
                  `报名/递交截止：${meta.deadline_text || "未标注"} 北京时间（72 小时内截止）`, assigneeId || user.id, meta.dl_ns || "0");
            }
          }

          if (todoTitle && decision !== "declined") {
            const tid = `todo:${randomUUID().slice(0, 12)}`;
            db.prepare(`INSERT INTO alert_todo(id,kind,notice_id,project_key,title,detail,assignee,status,due_ns)
              VALUES (?,'todo',?,?,?,?,?,'open',CAST(? AS INTEGER))`)
              .run(tid, noticeId, meta.project_key, todoTitle, note || `关联公告：${meta.title}`, assigneeId || user.id, meta.dl_ns || "0");
          }
          audit(user.id, decision === "declined" ? "排除不参与" : "更新参投跟进", `${noticeId}/${decision}${inferredCompanyName ? `(${inferredCompanyName})` : ""}${note ? "：" + note.slice(0, 60) : ""}`, "已记录");
        });
        return json({ ok: true, decision, inferredCompanyId: inferredCompanyId || null, inferredCompanyName: inferredCompanyName || null });
      }

      // 1B. Batch Follow / Decline / Retract (for Opportunities Pool bulk bar, supports partial failure)
      if (pathname === "/api/opportunities/batch-follow") {
        const ids = Array.isArray(body.ids) ? body.ids.map((x) => String(x).trim()).filter(Boolean).slice(0, 100) : [];
        const decision = ["watching", "bidding", "declined", "none"].includes(body.decision) ? body.decision : "";
        const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
        if (!ids.length || !decision) return invalid("请选择至少一条公告及有效的批量操作类型。");
        if (decision === "declined" && !note) return invalid("批量标记为「不参与」必须填写统一排除原因（操作将记入审计日志）。");
        let succeeded = 0;
        const failed = [];
        transaction(db, () => {
          for (const nid of ids) {
            const meta = db.prepare("SELECT id, project_key FROM notice_meta WHERE id=?").get(nid);
            if (!meta || !visible(user.id,nid)) { failed.push({ id: nid, reason: "记录不存在" }); continue; }
            if (!lotWriteAllowed(user, nid)) { failed.push({ id: nid, reason: "没有标段编辑权限" }); continue; }
            if (decision === "none") {
              db.prepare("DELETE FROM project_follow WHERE notice_id=?").run(nid);
            } else {
              db.prepare(`INSERT INTO project_follow(notice_id,project_key,decision,assignee,note,updated_by,updated_at)
                VALUES (?,?,?,NULL,?,?,CURRENT_TIMESTAMP)
                ON CONFLICT(notice_id) DO UPDATE SET
                  decision=excluded.decision, note=CASE WHEN excluded.note<>'' THEN excluded.note ELSE project_follow.note END,
                  updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP`)
                .run(nid, meta.project_key, decision, note, user.id);
            }
            if (decision === "declined" || decision === "none") {
              db.prepare(`UPDATE alert_todo AS a SET status='dismissed', updated_at=CURRENT_TIMESTAMP
                WHERE a.status='open' AND a.notice_id=? AND NOT ${isFollowReminder("a")}`).run(nid);
              db.prepare(`UPDATE deposit_pay_task SET status='cancelled' WHERE notice_id=? AND status='pending'`).run(nid);
            }
            succeeded++;
          }
          audit(user.id, decision === "none" ? "批量撤回选定" : `批量${decision === "declined" ? "排除不参与" : "选定项目"}`, `${succeeded}条成功/${failed.length}条失败`, "已记录");
        });
        return json({ ok: true, succeeded, failed });
      }

      // 2. Save filter / subscription
      if (pathname === "/api/saved-filters") {
        const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
        if (!name) return invalid("请填写筛选方案名称。");
        const filters = body.filters && typeof body.filters === "object" ? body.filters : {};
        const subscribed = body.subscribed ? 1 : 0;
        const shared = body.shared === false ? 0 : 1;
        const assigneeId = typeof body.assigneeId === "string" && body.assigneeId.trim() ? body.assigneeId.trim() : user.id;
        if (!employee(assigneeId)) return invalid("负责人不存在。");
        const id = `flt_${randomUUID().slice(0, 10)}`;
        transaction(db, () => {
          db.prepare(`INSERT INTO saved_filter(id,owner,name,filters_json,subscribed,shared,assignee)
            VALUES (?,?,?,?,?,?,?)`)
            .run(id, user.id, name, JSON.stringify(filters), subscribed, shared, assigneeId);
          audit(user.id, subscribed ? "保存并订阅筛选" : "保存筛选", name, "已记录");
        });
        return json({ id, ok: true });
      }

      const fltUpdate = pathname.match(/^\/api\/saved-filters\/([a-zA-Z0-9_-]+)\/update$/);
      if (fltUpdate) {
        const row = db.prepare("SELECT * FROM saved_filter WHERE id=?").get(fltUpdate[1]);
        if (!row) return missing();
        if (row.owner !== user.id && user.role !== "admin") return forbidden();
        const subscribed = body.subscribed !== undefined ? (body.subscribed ? 1 : 0) : row.subscribed;
        const shared = body.shared !== undefined ? (body.shared ? 1 : 0) : row.shared;
        const assignee = typeof body.assigneeId === "string" && body.assigneeId.trim() ? body.assigneeId.trim() : row.assignee;
        if (assignee && !employee(assignee)) return invalid("负责人不存在。");
        db.prepare("UPDATE saved_filter SET subscribed=?, shared=?, assignee=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .run(subscribed, shared, assignee, row.id);
        return json({ ok: true });
      }

      const fltDelete = pathname.match(/^\/api\/saved-filters\/([a-zA-Z0-9_-]+)\/delete$/);
      if (fltDelete) {
        const row = db.prepare("SELECT * FROM saved_filter WHERE id=?").get(fltDelete[1]);
        if (!row) return missing();
        if (row.owner !== user.id && user.role !== "admin") return forbidden();
        db.prepare("DELETE FROM saved_filter WHERE id=?").run(row.id);
        audit(user.id, "删除筛选", row.name, "已记录");
        return json({ ok: true });
      }

      // 3. Update alert / todo status or assignee (with self-confirm & reason checks)
      const alertUpdate = pathname.match(/^\/api\/alerts\/([^/]+)\/update$/);
      if (alertUpdate) {
        const alertId = decodeURIComponent(alertUpdate[1]);
        const expRow = db.prepare("SELECT * FROM company_expiry_todo WHERE id=?").get(alertId);
        if (expRow) {
          const permission = grant(user.id, expRow.company_id);
          if (!permission?.view) return missing();
          if (!permission.edit && (body.status !== "done" || !expRow.assignee || expRow.assignee !== user.id || body.assigneeId !== undefined)) return forbidden();
          const status = ["open", "done", "dismissed"].includes(body.status) ? body.status : expRow.status;
          const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 200) : "";
          if (status === "dismissed" && !reason) return invalid("忽略到期提醒必须填写原因。");
          const assignee = body.assigneeId === null ? null : (typeof body.assigneeId === "string" && body.assigneeId.trim() ? body.assigneeId.trim() : expRow.assignee);
          if (assignee && assignee !== expRow.assignee && (!employee(assignee) || !grant(assignee, expRow.company_id)?.view)) {
            return invalid("负责人须拥有该公司的查看权限。");
          }
          transaction(db, () => {
            db.prepare("UPDATE company_expiry_todo SET status=?, assignee=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
              .run(status, assignee, alertId);
            audit(user.id, status === "done" ? "确认处理到期提醒" : status === "dismissed" ? "忽略到期提醒" : "转派到期提醒", `${expRow.target_name}${reason ? "：" + reason : ""}`, "已记录");
          });
          return json({ ok: true });
        }
        const row = db.prepare(`SELECT a.status, a.assignee, a.detail FROM alert_todo a WHERE a.id=?
          AND ${projectAlertReadScope("a")}`).get({ $lifecycleActor: user.id }, alertId);
        if (!row) return missing();
        const status = ["open", "done", "dismissed"].includes(body.status) ? body.status : row.status;
        if (status === "done" && row.assignee && row.assignee !== user.id) {
          return denied(user.id, "代确认责任项", alertId);
        }
        const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 200) : "";
        if (status === "dismissed" && !reason) {
          return invalid("作废或忽略提醒必须填写原因，历史记录将保留不删除。");
        }
        const assignee = body.assigneeId === null ? null : (typeof body.assigneeId === "string" && body.assigneeId.trim() ? body.assigneeId.trim() : row.assignee);
        if (assignee && !employee(assignee)) return invalid("所选负责人不存在。");
        const detail = reason ? `${row.detail}（处置原因：${reason}）` : (typeof body.detail === "string" ? body.detail.trim().slice(0, 400) : row.detail);
        transaction(db, () => {
          db.prepare("UPDATE alert_todo SET status=?, assignee=?, detail=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
            .run(status, assignee, detail, alertId);
          audit(user.id, status === "done" ? "本人确认核实" : status === "dismissed" ? "作废提醒" : "转派提醒", `${alertId}${reason ? "：" + reason : ""}`, "已记录");
        });
        return json({ ok: true });
      }

      // AI + Regex structured extraction of deposit account/amount/bank/deadline for Stage 3 one-click autofill
      const extDepMatch = pathname.match(/^\/api\/opportunities\/(\d+)\/extract-deposit$/);
      if (extDepMatch) {
        const nid = extDepMatch[1];
        const notice = visible(user.id, nid);
        if (!notice) return missing();
        const parsed = JSON.parse(notice.data);
        const rawText = `${parsed.title || ""}\n${parsed.depositText || ""}\n${parsed.deadlineText || ""}\n${parsed.body || ""}`;
        const flat = rawText.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").replace(/(\d)\s*\.\s*(\d)/g, "$1.$2");
        const compact = flat.replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, "$1$2");

        const result = {
          amountYuan: "",
          payeeName: "",
          payeeAccount: "",
          payeeBank: "",
          dueTime: parsed.deadlineText || "",
          depositMethod: "",
          note: "",
          source: "regex",
        };
        const amtM = compact.match(/(?:投标保证金(?:金额)?|保证金(?:金额|数额)?)(?:为|人民币|：|:|\s){0,8}(?:人民币)?([\d,]+(?:\.\d+)?)\s*(万元|万|元)/);
        if (amtM) {
          const v = Number(amtM[1].replace(/,/g, ""));
          if (Number.isFinite(v) && v > 0) result.amountYuan = String(amtM[2].startsWith("万") ? Math.round(v * 10000) : Math.round(v));
        }
        const payeeM = compact.match(/(?:收款(?:人|单位|账户)?(?:名称)?|户\s*名|账户名称)[：:\s]*([\u4e00-\u9fa5（）()]{4,36})/);
        if (payeeM) result.payeeName = payeeM[1].replace(/[，,。；;].*$/, "").trim();
        const accM = compact.match(/(?:账\s*号|银行账号|虚拟子账号|保证金账号)[：:\s]*([0-9\- ]{10,32})/);
        if (accM) result.payeeAccount = accM[1].replace(/\s+/g, "").trim();
        const bankM = compact.match(/(?:开户(?:银)?行|收款银行)[：:\s]*([\u4e00-\u9fa5（）()]{4,36}(?:银行|支行|营业部|分理处))/);
        if (bankM) result.payeeBank = bankM[1].replace(/[，,。；;].*$/, "").trim();
        if (/免收|免缴|不收取.*保证金|无需缴纳.*保证金/.test(compact)) {
          result.depositMethod = "免缴（信用承诺书 / 政采或小微免缴）";
          result.amountYuan = "0";
        } else if (/现金.*信封|现场递交.*现金/.test(compact)) {
          result.depositMethod = "现金（信封密封现场递交）";
        } else if (/电子保函/.test(compact) && !result.payeeAccount) {
          result.depositMethod = "电子保函（交易平台线上出函）";
        }

        const aiCfg = getAiConfig();
        if (aiCfg.apiKey && compact.length > 40) {
          try {
            const depIdx = compact.search(/保证金/);
            const snippet = depIdx >= 0 ? compact.slice(Math.max(0, depIdx - 120), depIdx + 1600) : compact.slice(0, 1800);
            const ctl = new AbortController();
            const tmr = setTimeout(() => ctl.abort(), 14000);
            const aiRes = await fetch(`${aiCfg.baseUrl}/chat/completions`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${aiCfg.apiKey}` },
              body: JSON.stringify({
                model: aiCfg.defaultModel,
                temperature: 0.1,
                messages: [
                  { role: "system", content: "你是招投标保证金条款结构化提取专家。请严格从给定公告片段提取投标保证金打款信息，仅返回纯JSON不要markdown代码块：{\"amountYuan\":\"纯数字元如50000，免缴填0，未标注留空\",\"payeeName\":\"收款户名或空\",\"payeeAccount\":\"收款账号或空\",\"payeeBank\":\"开户银行或空\",\"dueTime\":\"YYYY-MM-DD HH:mm或空\",\"note\":\"简短附言或缴交要求，如子账号需系统获取\"}" },
                  { role: "user", content: snippet },
                ],
              }),
              signal: ctl.signal,
            });
            clearTimeout(tmr);
            if (aiRes.ok) {
              const j = await aiRes.json();
              const content = (j?.choices?.[0]?.message?.content || "").replace(/^```json\s*|\s*```$/g, "").trim();
              const parsedAi = JSON.parse(content);
              if (parsedAi && typeof parsedAi === "object") {
                if (parsedAi.amountYuan !== undefined && String(parsedAi.amountYuan).trim() !== "") result.amountYuan = String(parsedAi.amountYuan).replace(/[^\d.]/g, "");
                if (parsedAi.payeeName) result.payeeName = String(parsedAi.payeeName).trim();
                if (parsedAi.payeeAccount) result.payeeAccount = String(parsedAi.payeeAccount).trim();
                if (parsedAi.payeeBank) result.payeeBank = String(parsedAi.payeeBank).trim();
                if (parsedAi.dueTime) result.dueTime = String(parsedAi.dueTime).trim();
                if (parsedAi.note) result.note = String(parsedAi.note).trim();
                result.source = "ai";
              }
            }
          } catch {}
        }
        return json({ ok: true, ...result });
      }

      // 4B. Update company common bidding/banking/legal profile
      const coProfMatch = pathname.match(/^\/api\/companies\/([^/]+)\/profile$/);
      if (coProfMatch) {
        const cid = coProfMatch[1];
        if (!grant(user.id, cid)?.edit) return denied(user.id, "编辑公司基础档案", cid);
        const s = (k, max = 120) => (typeof body[k] === "string" ? body[k].trim().slice(0, max) : "");
        transaction(db, () => {
          db.prepare(`INSERT INTO company_profile(company_id,credit_code,legal_rep,reg_capital,bank_name,bank_account,address,contact_name,contact_phone,ca_expiry,remark,updated_by,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
            ON CONFLICT(company_id) DO UPDATE SET
              credit_code=excluded.credit_code, legal_rep=excluded.legal_rep, reg_capital=excluded.reg_capital,
              bank_name=excluded.bank_name, bank_account=excluded.bank_account, address=excluded.address,
              contact_name=excluded.contact_name, contact_phone=excluded.contact_phone, ca_expiry=excluded.ca_expiry,
              remark=excluded.remark, updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP`)
            .run(cid, s("creditCode", 40), s("legalRep", 40), s("regCapital", 40), s("bankName", 100), s("bankAccount", 60), s("address", 180), s("contactName", 40), s("contactPhone", 40), s("caExpiry", 20), s("remark", 300), user.id);
          audit(user.id, "更新公司基础档案", cid, "已记录");
        });
        try { scanExpiryReminders(db); } catch {}
        return json({ ok: true });
      }

      // 4C. Edit existing company doc metadata (bumps version & writes history)
      const docEditMatch = pathname.match(/^\/api\/docs\/([^/]+)\/edit$/);
      if (docEditMatch) {
        const docId = docEditMatch[1];
        const cur = db.prepare("SELECT * FROM company_doc WHERE id=?").get(docId);
        if (!cur) return missing();
        if (!grant(user.id, cur.company_id)?.edit) return denied(user.id, "编辑公司资料", docId);
        const category = typeof body.category === "string" && body.category.trim() ? body.category.trim().slice(0, 60) : cur.category;
        const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 140) : cur.name;
        const issuer = typeof body.issuer === "string" ? body.issuer.trim().slice(0, 120) : (cur.issuer || "");
        const docNo = typeof body.docNo === "string" ? body.docNo.trim().slice(0, 80) : (cur.doc_no || "");
        const validUntil = typeof body.validUntil === "string" ? body.validUntil.trim().slice(0, 20) : (cur.valid_until || "");
        const periodMonth = typeof body.periodMonth === "string" ? body.periodMonth.trim().slice(0, 12) : (cur.period_month || "");
        const remark = typeof body.remark === "string" ? body.remark.trim().slice(0, 300) : (cur.remark || "");
        let qualItemsJson = cur.qual_items_json || "[]";
        if (typeof body.qualItemsText === "string") {
          const items = body.qualItemsText.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).map((n) => ({ name: n, passLabel: cur.status === "verified" ? "合格" : "" }));
          qualItemsJson = JSON.stringify(items);
        }
        const nextVer = Number(cur.version || 1) + 1;
        transaction(db, () => {
          db.prepare(`UPDATE company_doc SET category=?, name=?, issuer=?, doc_no=?, qual_items_json=?, valid_until=?, period_month=?, remark=?, version=?, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
            .run(category, name, issuer, docNo, qualItemsJson, validUntil, periodMonth, remark, nextVer, user.id, docId);
          db.prepare(`INSERT INTO company_doc_history(doc_id, version, action, reason, snapshot_json, actor, actor_name) VALUES (?, ?, '编辑更新', ?, ?, ?, ?)`)
            .run(docId, nextVer, `更新档案信息（${name}）`, JSON.stringify({ category, name, issuer, docNo, validUntil, periodMonth, remark }), user.id, user.name);
          audit(user.id, "编辑公司资料", `${docId}/v${nextVer}/${name}`, "已记录");
        });
        try { scanExpiryReminders(db); } catch {}
        return json({ ok: true, version: nextVer });
      }

      // 4D. Batch import / update company qualification files via ZIP archive
      const coImportZip = pathname.match(/^\/api\/companies\/([^/]+)\/import-zip$/);
      if (coImportZip) {
        const cid = coImportZip[1];
        if (!grant(user.id, cid)?.edit) return denied(user.id, "批量导入资质压缩包", cid);
        if (!getCosCredentials()) {
          return json({ message: "尚未配置腾讯云 COS 密钥，无法归档原件，请联系管理员。" }, 503);
        }
        const rawB64 = String(body.dataBase64 || "").replace(/^data:[^;]+;base64,/, "");
        if (!rawB64) return invalid("请上传有效的 ZIP 压缩包文件。");
        const zipBuf = Buffer.from(rawB64, "base64");
        if (zipBuf.length < 22 || zipBuf.length > 60 * 1024 * 1024) {
          return invalid("ZIP 文件大小需在 22B 至 60MB 之间。");
        }
        const workDir = await mkdtemp(join(tmpdir(), "br-zip-imp-"));
        try {
          const zipPath = join(workDir, "upload.zip");
          const outDir = join(workDir, "out");
          await writeFile(zipPath, zipBuf);
          const pyScript = `
import os, sys, json, zipfile
zp, out_dir = sys.argv[1], sys.argv[2]
os.makedirs(out_dir, exist_ok=True)
ALLOWED = {'.pdf','.png','.jpg','.jpeg','.webp','.bmp','.tif','.tiff','.docx','.xlsx'}
items = []
skipped = []
with zipfile.ZipFile(zp, 'r') as zf:
  for info in zf.infolist():
    if info.is_dir(): continue
    raw_name = info.filename
    try:
      if not (info.flag_bits & 0x800):
        raw_name = raw_name.encode('cp437').decode('gbk')
    except Exception:
      pass
    norm = raw_name.replace('\\\\', '/').lstrip('/')
    parts = [p for p in norm.split('/') if p and p != '.']
    if not parts or any(p == '..' for p in parts) or '__MACOSX' in parts or parts[-1].startswith('.'):
      continue
    ext = os.path.splitext(parts[-1])[1].lower()
    if ext not in ALLOWED:
      skipped.append({'file': parts[-1], 'reason': '不支持的文件格式'})
      continue
    if info.file_size > 20 * 1024 * 1024:
      skipped.append({'file': parts[-1], 'reason': '单文件超过 20MB'})
      continue
    if len(items) >= 80:
      skipped.append({'file': parts[-1], 'reason': '超过单次 80 份上限'})
      continue
    dest = os.path.join(out_dir, f'f_{len(items)}{ext}')
    with zf.open(info, 'r') as src, open(dest, 'wb') as dst:
      dst.write(src.read())
    items.append({'path': dest, 'rel': '/'.join(parts), 'name': parts[-1], 'folder': parts[0] if len(parts) > 1 else '', 'ext': ext})
print(json.dumps({'items': items, 'skipped': skipped}, ensure_ascii=False))
`;
          const { stdout } = await execFileAsync("/usr/bin/python3", ["-c", pyScript, zipPath, outDir], { maxBuffer: 8 * 1024 * 1024, timeout: 45000 });
          const parsed = JSON.parse(stdout || '{"items":[],"skipped":[]}');
          const mimeMap = {
            ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".webp": "image/webp", ".bmp": "image/bmp", ".tif": "image/tiff", ".tiff": "image/tiff",
            ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          };
          const existingDocs = db.prepare("SELECT * FROM company_doc WHERE company_id=? AND status<>'void'").all(cid);
          const normStr = (x) => String(x || "").toLowerCase().replace(/[\s\-_·（）()【】\[\].]/g, "");
          const inferGroupFromPath = (rel) => {
            if (/信用|安许|安全|纳税|审计|财务|体系|ISO/i.test(rel)) return { grp: "credit_safety", cat: "安全与信用" };
            if (/社保|参保|养老|权益单/i.test(rel)) return { grp: "social_security", cat: "社保证明" };
            if (/业绩|合同|中标|竣工|验收/i.test(rel)) return { grp: "performance", cat: "工程业绩" };
            return { grp: "enterprise", cat: "企业资质" };
          };
          let updated = 0;
          let created = 0;
          const details = [];
          for (const it of parsed.items || []) {
            const bytes = await readFile(it.path);
            const sha = digest(bytes);
            const mimeType = mimeMap[it.ext] || "application/octet-stream";
            const stem = it.name.replace(/\.[^.]+$/, "");
            const normStem = normStr(stem);
            let matched = existingDocs.find((d) =>
              (d.file_name && d.file_name.toLowerCase() === it.name.toLowerCase())
              || (d.doc_no && d.doc_no.length >= 5 && stem.includes(d.doc_no))
              || (normStem.length >= 2 && (normStr(d.name).includes(normStem) || normStem.includes(normStr(d.name))))
            );
            const fileId = `fil_${randomUUID().slice(0, 12)}`;
            const cosKey = `${COS_SHARED_PREFIX}/company-files/${cid}/${fileId}${it.ext}`;
            await cosPutVerified(cosKey, bytes, mimeType, sha);
            let ocrFields = {};
            let ocrOk = false;
            try {
              const ocrRes = await extractOcrAndFieldsFromBuffer({ buf: bytes, filename: it.name, mode: "doc", aiConfig: process.env.CIVIC_RADAR_ENABLE_DOCUMENT_AI === "1" ? getAiConfig() : null });
              ocrFields = ocrRes.fields || {};
              ocrOk = (ocrRes.charCount || 0) >= 15;
            } catch {}
            const todayIso = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
            const effValid = ocrFields.validUntil || "";
            const dateNotExpired = !effValid || effValid === "长期" || (/^\d{4}-\d{2}-\d{2}$/.test(effValid) && effValid >= todayIso);
            const hasCertProof = Boolean(ocrOk && dateNotExpired && (ocrFields.docNo || ocrFields.periodMonth || ocrFields.validUntil || ocrFields.qualItemsText));

            if (matched) {
              const nextVer = Number(matched.version || 1) + 1;
              const nextQuals = ocrFields.qualItemsText
                ? JSON.stringify(ocrFields.qualItemsText.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(s => ({ name: s, passLabel: hasCertProof ? "合格" : "" })))
                : matched.qual_items_json;
              const nextStatus = hasCertProof ? "verified" : matched.status;
              const nextBasis = hasCertProof ? "ZIP原件 + OCR/AI自动核验" : matched.verify_basis;
              transaction(db, () => {
                db.prepare(`INSERT INTO company_file(id,company_id,owner_type,owner_id,filename,mime_type,size_bytes,sha256,bytes,storage_backend,cos_key,uploaded_by)
                  VALUES (?,?,'doc',?,?,?,?,?,?,'cos',?,?)`).run(fileId, cid, matched.id, it.name, mimeType, bytes.length, sha, Buffer.alloc(0), cosKey, user.id);
                db.prepare(`UPDATE company_doc SET file_id=?, file_name=?, doc_no=COALESCE(NULLIF(?,''), doc_no),
                  issuer=COALESCE(NULLIF(?,''), issuer), valid_until=COALESCE(NULLIF(?,''), valid_until),
                  qual_items_json=?, status=?, verified_by=CASE WHEN ?='verified' THEN 'AI自动核验' ELSE verified_by END,
                  verified_at=CASE WHEN ?='verified' THEN CURRENT_TIMESTAMP ELSE verified_at END, verify_basis=?,
                  version=?, provenance='original', updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
                  .run(fileId, it.name, ocrFields.docNo || "", ocrFields.issuer || "", effValid, nextQuals || "[]", nextStatus, nextStatus, nextStatus, nextBasis || "", nextVer, user.id, matched.id);
                db.prepare(`INSERT INTO company_doc_history(doc_id,version,action,reason,snapshot_json,actor,actor_name)
                  VALUES (?,?,'ZIP批量更新',?,?,?,?)`).run(matched.id, nextVer, `ZIP 更新原件${hasCertProof ? "并AI自动核验" : ""}：${it.rel}`, JSON.stringify({ fileId, filename: it.name, size: bytes.length, status: nextStatus }), user.id, user.name);
              });
              matched.version = nextVer;
              matched.file_id = fileId;
              matched.file_name = it.name;
              updated += 1;
              details.push({ file: it.name, action: "updated", docName: matched.name, version: nextVer, verified: nextStatus === "verified" });
            } else {
              const { grp: pathGrp, cat: pathCat } = inferGroupFromPath(it.rel);
              const grp = ocrFields.docGroup || pathGrp;
              const cat = ocrFields.category || pathCat;
              const docId = `doc_${randomUUID().slice(0, 12)}`;
              const docName = (ocrFields.name || stem).slice(0, 120) || it.name;
              const nextStatus = hasCertProof ? "verified" : "pending";
              const qualsJson = ocrFields.qualItemsText
                ? JSON.stringify(ocrFields.qualItemsText.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(s => ({ name: s, passLabel: hasCertProof ? "合格" : "" })))
                : "[]";
              transaction(db, () => {
                db.prepare(`INSERT INTO company_doc(id,company_id,category,name,doc_no,issuer,qual_items_json,valid_until,period_month,remark,doc_group,status,provenance,verified_by,verified_at,verify_basis,file_id,file_name,version,updated_by)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,CASE WHEN ?='verified' THEN CURRENT_TIMESTAMP ELSE '' END,?,?,?,?,?)`)
                  .run(docId, cid, cat, docName, ocrFields.docNo || "", ocrFields.issuer || "", qualsJson, effValid, ocrFields.periodMonth || "", ocrFields.remark || "", grp, nextStatus, "original", nextStatus === "verified" ? "AI自动核验" : null, nextStatus, hasCertProof ? "ZIP原件 + OCR/AI自动建档核验" : "", fileId, it.name, 1, user.id);
                db.prepare(`INSERT INTO company_file(id,company_id,owner_type,owner_id,filename,mime_type,size_bytes,sha256,bytes,storage_backend,cos_key,uploaded_by)
                  VALUES (?,?,'doc',?,?,?,?,?,?,'cos',?,?)`).run(fileId, cid, docId, it.name, mimeType, bytes.length, sha, Buffer.alloc(0), cosKey, user.id);
                db.prepare(`INSERT INTO company_doc_history(doc_id,version,action,reason,snapshot_json,actor,actor_name)
                  VALUES (?,1,'ZIP批量新建',?,?,?,?)`).run(docId, `ZIP 批量建档并归档原件${hasCertProof ? "（AI自动核验通过）" : ""}：${it.rel}`, JSON.stringify({ fileId, filename: it.name, docGroup: grp, size: bytes.length, status: nextStatus }), user.id, user.name);
              });
              existingDocs.push({ id: docId, name: docName, doc_no: ocrFields.docNo || "", file_id: fileId, file_name: it.name, version: 1 });
              created += 1;
              details.push({ file: it.name, action: "created", docName, version: 1, verified: nextStatus === "verified" });
            }
          }
          audit(user.id, "ZIP批量更新公司资质", `${cid} 更新${updated}份/新建${created}份`, "已记录");
          return json({ ok: true, updated, created, skipped: (parsed.skipped || []).length, skippedItems: parsed.skipped || [], details });
        } catch (err) {
          return json({ message: `ZIP 解析或导入失败：${err.message || "请确认上传的是标准 ZIP 压缩包"}` }, 400);
        } finally {
          await rm(workDir, { recursive: true, force: true }).catch(() => {});
        }
      }

      // 4E. Manual trigger for 30/7-day expiry reminders scan
      if (pathname === "/api/system/scan-expiry") {
        const res = scanExpiryReminders(db);
        audit(user.id, "扫描资料到期提醒", `新增${res.created}条/完结${res.resolved}条`, "已记录");
        return json({ ok: true, ...res });
      }

      // 4F. One-click AI + OCR auto-verify all pending company documents using stored original files
      const coAiVerifyMatch = pathname.match(/^\/api\/companies\/([^/]+)\/ai-verify-all$/);
      if (coAiVerifyMatch) {
        const cid = decodeURIComponent(coAiVerifyMatch[1]);
        const perm = grant(user.id, cid);
        if (!perm?.edit || !perm?.verify) return denied(user.id, "AI一键核验公司档案", cid);
        const pendingDocs = db.prepare("SELECT * FROM company_doc WHERE company_id=? AND status='pending'").all(cid);
        const targetId = typeof body.docId === "string" ? body.docId.trim() : "";
        const list = targetId ? pendingDocs.filter(d => d.id === targetId) : pendingDocs;
        if (!list.length) return json({ ok: true, verifiedCount: 0, expiredCount: 0, skippedCount: 0, results: [], message: "当前没有待核实的档案。" });

        const todayIso = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
        const aiCfg = getAiConfig();
        let verifiedCount = 0;
        let expiredCount = 0;
        let skippedCount = 0;
        const results = [];

        for (const doc of list) {
          let fields = {};
          let charCount = 0;
          let engine = "";
          if (doc.file_id) {
            const fRow = db.prepare("SELECT id, filename, cos_key, storage_backend, bytes FROM company_file WHERE id=?").get(doc.file_id);
            if (fRow) {
              let buf = null;
              if (fRow.storage_backend === "cos" && fRow.cos_key && getCosCredentials()) {
                try { buf = await cosGetObject(fRow.cos_key); } catch {}
              } else if (fRow.bytes?.length) {
                buf = Buffer.from(fRow.bytes);
              }
              if (buf?.length) {
                try {
                  const ocrRes = await extractOcrAndFieldsFromBuffer({ buf, filename: fRow.filename || doc.file_name || "doc.jpg", mode: "doc", aiConfig: aiCfg });
                  fields = ocrRes.fields || {};
                  charCount = ocrRes.charCount || 0;
                  engine = ocrRes.engine || "OCR";
                } catch {}
              }
            }
          }

          const nextDocNo = (doc.doc_no || fields.docNo || "").trim();
          let nextValid = (doc.valid_until || fields.validUntil || "").trim();
          const nextIssuer = (doc.issuer || fields.issuer || "").trim();
          const nextCat = (doc.category || fields.category || "").trim();
          if (/营业执照/.test(nextCat + " " + doc.name) && !nextValid) nextValid = "长期";

          let nextQualsJson = doc.qual_items_json || "[]";
          try {
            const curArr = JSON.parse(nextQualsJson);
            if ((!Array.isArray(curArr) || !curArr.length) && fields.qualItemsText) {
              nextQualsJson = JSON.stringify(fields.qualItemsText.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(n => ({ name: n, passLabel: "合格" })));
            }
          } catch {}

          const isExpired = nextValid && nextValid !== "长期" && /^\d{4}-\d{2}-\d{2}$/.test(nextValid) && nextValid < todayIso;
          if (isExpired) {
            expiredCount++;
            results.push({ id: doc.id, name: doc.name, status: "expired", reason: `有效期（${nextValid}）已早于今日，需更新新证后再核` });
            continue;
          }

          const hasEnoughInfo = Boolean(nextDocNo || doc.period_month || nextValid || (nextQualsJson && nextQualsJson !== "[]"));
          if (!hasEnoughInfo) {
            skippedCount++;
            results.push({ id: doc.id, name: doc.name, status: "skipped", reason: "缺少原件与证书编号，请补传扫描件后重试" });
            continue;
          }

          const nextVer = Number(doc.version || 1) + 1;
          const basis = charCount >= 12
            ? `原件(${engine}) + AI结构化复核通过${nextDocNo ? `（证号：${nextDocNo}）` : ""}`
            : `系统档案完整性校验通过${nextDocNo ? `（证号：${nextDocNo}）` : ""}`;
          let markedQualsJson = nextQualsJson;
          try {
            const qArr = JSON.parse(nextQualsJson);
            if (Array.isArray(qArr) && qArr.length) {
              markedQualsJson = JSON.stringify(qArr.map(x => typeof x === "string" ? { name: x, passLabel: "合格" } : { ...x, passLabel: x.passLabel || "合格" }));
            }
          } catch {}

          transaction(db, () => {
            db.prepare(`UPDATE company_doc SET doc_no=?, issuer=?, valid_until=?, qual_items_json=?, status='verified',
              verified_by=?, verified_at=CURRENT_TIMESTAMP, verify_basis=?, version=?, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
              .run(nextDocNo, nextIssuer, nextValid, markedQualsJson, `AI核验(${user.name})`, basis, nextVer, user.id, doc.id);
            db.prepare(`INSERT INTO company_doc_history(doc_id,version,action,reason,snapshot_json,actor,actor_name)
              VALUES (?,?,'AI自动核验',?,?,?,?)`)
              .run(doc.id, nextVer, basis, JSON.stringify({ status: "verified", doc_no: nextDocNo, valid_until: nextValid }), user.id, user.name);
            audit(user.id, "AI一键核验公司档案", `${cid}/${doc.name}`, "已核实");
          });
          verifiedCount++;
          results.push({ id: doc.id, name: doc.name, status: "verified", docNo: nextDocNo, validUntil: nextValid, basis });
        }
        try { scanExpiryReminders(db); } catch {}
        return json({ ok: true, verifiedCount, expiredCount, skippedCount, results });
      }

      // 4G. Delete an unused / mistakenly created company (FK-safe cascade + mandatory reason + audit)
      const coDelMatch = pathname.match(/^\/api\/companies\/([^/]+)\/delete$/);
      if (coDelMatch) {
        const cid = decodeURIComponent(coDelMatch[1]);
        const canDel = user.role === "admin" || grant(user.id, cid)?.edit;
        if (!canDel) return denied(user.id, "删除参投公司", cid);
        const comp = db.prepare("SELECT id, name FROM company WHERE id=?").get(cid);
        if (!comp) return missing();
        const totalCos = db.prepare("SELECT count(*) AS c FROM company").get().c;
        if (totalCos <= 1) return invalid("系统至少需保留 1 家参投公司，无法删除最后一家公司。");
        const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 200) : "";
        if (!reason) return invalid("删除公司必须填写原因（将记入不可篡改审计日志）。");
        const activeFin = db.prepare("SELECT count(*) AS c FROM finance_entry WHERE company_id=?").get(cid).c
          + db.prepare("SELECT count(*) AS c FROM deposit_pay_task WHERE company_id=?").get(cid).c
          + db.prepare("SELECT count(*) AS c FROM scope WHERE company=?").get(cid).c;
        if (activeFin > 0) {
          return json({ message: `该公司已关联 ${activeFin} 条历史资金/保证金或标段台账，为保障财务追溯完整性禁止直接删除。` }, 409);
        }
        transaction(db, () => {
          db.prepare("DELETE FROM company_expiry_todo WHERE company_id=?").run(cid);
          db.prepare("DELETE FROM company_doc_history WHERE doc_id IN (SELECT id FROM company_doc WHERE company_id=?)").run(cid);
          db.prepare("DELETE FROM company_file WHERE company_id=?").run(cid);
          db.prepare("DELETE FROM company_doc WHERE company_id=?").run(cid);
          db.prepare("DELETE FROM company_person WHERE company_id=?").run(cid);
          db.prepare("DELETE FROM company_profile WHERE company_id=?").run(cid);
          db.prepare("DELETE FROM lot_matrix_cell WHERE company_id=?").run(cid);
          db.prepare("DELETE FROM lot_check_item WHERE company_id=?").run(cid);
          db.prepare("DELETE FROM attachment_version WHERE attachment IN (SELECT id FROM attachment WHERE company=?)").run(cid);
          db.prepare("DELETE FROM attachment WHERE company=?").run(cid);
          db.prepare("DELETE FROM grant_company WHERE company=?").run(cid);
          db.prepare("DELETE FROM company WHERE id=?").run(cid);
          audit(user.id, "删除参投公司", `${comp.name}(${cid})：${reason}`, "已记录");
        });
        return json({ ok: true, id: cid, name: comp.name });
      }

      // 4H. Unified source toggle (enable/disable any native or extended source)
      if (pathname === "/api/sources/toggle") {
        if (user.role !== "admin") return forbidden();
        const key = String(body.key || "").trim();
        const enabled = body.enabled ? 1 : 0;
        if (!key) return invalid("缺少来源标识。");
        const row = db.prepare("SELECT key, name FROM source_health WHERE key=?").get(key);
        if (!row) return missing();
        transaction(db, () => {
          db.prepare("UPDATE source_health SET enabled=? WHERE key=?").run(enabled, key);
          const custom = db.prepare("UPDATE custom_source SET enabled=?, updated_at=CURRENT_TIMESTAMP WHERE key=?").run(enabled, key);
          if (!custom.changes) {
            if (enabled) db.prepare("DELETE FROM paused_source_import WHERE key=?").run(key);
            else db.prepare("INSERT OR IGNORE INTO paused_source_import VALUES (?)").run(key);
          }
          audit(user.id, enabled ? "启用采集来源" : "停用采集来源", `${row.name}(${key})`, "已记录");
        });
        return json({ ok: true, key, enabled: !!enabled });
      }

      // 4J. User custom source: probe URL & preview auto-matching against company capabilities
      if (pathname === "/api/custom-sources/probe") {
        if (user.role !== "admin") return forbidden();
        if (process.env.CIVIC_RADAR_ENABLE_COLLECTION !== "1") return invalid("自动采集尚未启用，请联系管理员。");
        const rawUrl = String(body.url || body.listUrl || "").trim();
        const linkSelector = String(body.linkSelector || "").trim().slice(0, 120);
        const keywordFilter = String(body.keywordFilter || "").trim().slice(0, 120);
        try {
          const probe = await probeAndExtractUrl(rawUrl, { linkSelector, keywordFilter });
          const companies = db.prepare(`SELECT c.id, c.name FROM company c JOIN grant_company g ON g.company=c.id WHERE g.employee=? AND g.view=1`).all(user.id);
          const companyMatches = [];
          for (const co of companies) {
            const docs = db.prepare("SELECT category, name, qual_items_json, valid_until, status FROM company_doc WHERE company_id=? AND status<>'void'").all(co.id);
            const caps = extractCompanyCapabilities(docs);
            if (!caps.specs?.length && !caps.hasSafety) continue;
            const hits = [];
            for (const it of (probe.items || []).slice(0, 30)) {
              const m = matchNoticeToCapabilities(it, caps);
              if (m?.matched) hits.push(it.title);
            }
            if (hits.length) {
              companyMatches.push({ companyId: co.id, companyName: co.name, matchedCount: hits.length, sampleTitles: hits.slice(0, 3) });
            }
          }
          return json({
            ok: true,
            pageTitle: probe.pageTitle || "",
            host: probe.host || "",
            totalFound: probe.totalFound || 0,
            samples: (probe.items || []).slice(0, 10),
            companyMatches,
          });
        } catch (err) {
          return json({ message: `自动探测失败：${err.message || "无法访问该网址"}` }, 400);
        }
      }

      // 4K. User custom source: create & immediately crawl into Opportunity Pool
      if (pathname === "/api/custom-sources") {
        if (user.role !== "admin") return forbidden();
        if (process.env.CIVIC_RADAR_ENABLE_COLLECTION !== "1") return invalid("自动采集尚未启用，请联系管理员。");
        let listUrl;
        try {
          listUrl = validateSourceUrl(body.listUrl || body.url);
        } catch (err) {
          return invalid(err.message);
        }
        const name = String(body.name || "").trim().slice(0, 60);
        if (!name) return invalid("请填写来源名称（如：盐城某集团招标网）。");
        const region = String(body.region || "盐城市").trim().slice(0, 40) || "盐城市";
        const tradeType = String(body.tradeType || "工程建设").trim().slice(0, 40) || "工程建设";
        const linkSelector = String(body.linkSelector || "").trim().slice(0, 120);
        const keywordFilter = String(body.keywordFilter || "").trim().slice(0, 120);
        const id = `csrc_${randomUUID().slice(0, 10)}`;
        const key = `usr_${randomUUID().slice(0, 8)}`;
        const nowNs = String(Date.now() * 1_000_000);
        transaction(db, () => {
          db.prepare(`INSERT INTO custom_source(id,key,name,list_url,region,trade_type,link_selector,keyword_filter,enabled,created_by)
            VALUES (?,?,?,?,?,?,?,?,1,?)`).run(id, key, name, listUrl, region, tradeType, linkSelector, keywordFilter, user.id);
          db.prepare(`INSERT OR REPLACE INTO source_health(key,name,enabled,checked,last_ok,failures,reason,last_error)
            VALUES (?,?,1,?, '0', 0, '', '')`).run(key, name, nowNs);
          audit(user.id, "新增自定义采集来源", `${name}(${listUrl})`, "已记录");
        });
        const row = db.prepare("SELECT * FROM custom_source WHERE id=?").get(id);
        let crawlRes = { ok: true, totalFound: 0, inserted: 0, updated: 0 };
        if (db.location?.()) {
          crawlRes = await runCustomSourceById(db.location(), row);
        }
        return json({ ok: true, id, key, name, ...crawlRes });
      }

      // 4L. User custom source: run immediately
      const runCustomMatch = pathname.match(/^\/api\/custom-sources\/([^/]+)\/run$/);
      if (runCustomMatch) {
        if (user.role !== "admin") return forbidden();
        if (process.env.CIVIC_RADAR_ENABLE_COLLECTION !== "1") return invalid("自动采集尚未启用，请联系管理员。");
        const cid = decodeURIComponent(runCustomMatch[1]);
        const row = db.prepare("SELECT * FROM custom_source WHERE id=?").get(cid);
        if (!row) return missing();
        if (!row.enabled) return invalid("请先恢复该来源的采集。");
        const res = db.location?.() ? await runCustomSourceById(db.location(), row) : { ok: true, totalFound: 0, inserted: 0, updated: 0 };
        audit(user.id, "手动采集自定义来源", `${row.name}（入池${res.inserted || 0}条）`, res.ok ? "已记录" : "失败");
        return json(res);
      }

      // 4M. User custom source: delete
      const delCustomMatch = pathname.match(/^\/api\/custom-sources\/([^/]+)\/delete$/);
      if (delCustomMatch) {
        if (user.role !== "admin") return forbidden();
        const cid = decodeURIComponent(delCustomMatch[1]);
        const row = db.prepare("SELECT * FROM custom_source WHERE id=?").get(cid);
        if (!row) return missing();
        transaction(db, () => {
          db.prepare("DELETE FROM custom_source WHERE id=?").run(cid);
          db.prepare("DELETE FROM source_health WHERE key=?").run(row.key);
          audit(user.id, "删除自定义采集来源", `${row.name}(${row.key})`, "已记录");
        });
        return json({ ok: true });
      }

      // Delete / hide opportunities from opportunity pool (single or batch)
      if (pathname === "/api/opportunities/delete") {
        const ids = Array.isArray(body.ids)
          ? body.ids.map((x) => String(x || "").trim()).filter(Boolean)
          : (body.id ? [String(body.id).trim()] : []);
        if (!ids.length) return invalid("请选择要删除的机会。");
        transaction(db, () => {
          for (const nid of ids.slice(0, 100)) {
            if (!visible(user.id,nid)) continue;
            db.prepare("INSERT OR REPLACE INTO notice_hidden(notice_id, deleted_by, deleted_at) VALUES (?,?,CURRENT_TIMESTAMP)").run(nid, user.id);
            const meta = db.prepare("SELECT project_key FROM notice_meta WHERE id=?").get(nid);
            db.prepare("UPDATE alert_todo SET status='dismissed', updated_at=CURRENT_TIMESTAMP WHERE status='open' AND (notice_id=? OR id LIKE ?)").run(nid,`amend:${nid}:%`);
            db.prepare("UPDATE deposit_pay_task SET status='cancelled' WHERE notice_id=? AND status='pending'").run(nid);
            db.prepare("DELETE FROM bid_schedule WHERE notice_id=?").run(nid);
            db.prepare("DELETE FROM project_follow WHERE notice_id=?").run(nid);
          }
          audit(user.id, "删除机会池项目", `共 ${ids.length} 条（${ids.slice(0, 5).join(",")}）`, "已删除");
        });
        return json({ ok: true, deleted: ids.length });
      }

      // Restore / undo deleted opportunities from opportunity pool
      if (pathname === "/api/opportunities/restore") {
        const ids = Array.isArray(body.ids)
          ? body.ids.map((x) => String(x || "").trim()).filter(Boolean)
          : (body.id ? [String(body.id).trim()] : []);
        if (!ids.length) return invalid("缺少需恢复的机会标识。");
        transaction(db, () => {
          for (const nid of ids.slice(0, 100)) {
            db.prepare("DELETE FROM notice_hidden WHERE notice_id=?").run(nid);
          }
          audit(user.id, "撤回删除机会", `恢复 ${ids.length} 条（${ids.slice(0, 5).join(",")}）`, "已恢复");
        });
        return json({ ok: true, restored: ids.length });
      }

      // 4. Create company (all approved employees have lead-level operational permissions)
      if (pathname === "/api/companies") {
        const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
        if (!name) return invalid("请填写公司名称。");
        const id = String(Date.now());
        transaction(db, () => {
          db.prepare("INSERT INTO company(id, name) VALUES (?,?)").run(id, name);
          const allEmps = db.prepare("SELECT id FROM employee WHERE approval='approved'").all();
          for (const e of allEmps) {
            db.prepare("INSERT OR REPLACE INTO grant_company(employee,company,view,edit,verify,sensitive_download) VALUES (?,?,1,1,1,1)").run(e.id, id);
          }
          audit(user.id, "新建参投公司", `${id}/${name}`, "已记录");
        });
        return json({ id, name, ok: true });
      }

      // 5. Add company document
      const addDocMatch = pathname.match(/^\/api\/companies\/([^/]+)\/docs$/);
      if (addDocMatch) {
        const companyId = addDocMatch[1];
        const perm = grant(user.id, companyId);
        if (!perm?.edit) return denied(user.id, "登记公司资料", companyId);
        const category = typeof body.category === "string" ? body.category.trim().slice(0, 40) : "建筑业企业资质";
        const docGroup = inferDocGroup(category, body.docGroup);
        const name = typeof body.name === "string" ? body.name.trim().slice(0, 160) : "";
        if (!name) return invalid("请填写资料名称。");
        const docNo = typeof body.docNo === "string" ? body.docNo.trim().slice(0, 80) : "";
        const issuer = typeof body.issuer === "string" ? body.issuer.trim().slice(0, 100) : "";
        let qualItems = [];
        if (Array.isArray(body.qualItems)) {
          qualItems = body.qualItems.map((x) => ({
            name: String(x?.name || x || "").trim().slice(0, 120),
            passLabel: String(x?.passLabel || "合格").trim().slice(0, 20),
            validUntil: String(x?.validUntil || "").trim().slice(0, 20),
          })).filter((x) => x.name);
        } else if (typeof body.qualItemsText === "string" && body.qualItemsText.trim()) {
          qualItems = body.qualItemsText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => ({
            name: l.slice(0, 120),
            passLabel: "合格",
            validUntil: "",
          }));
        }
        const validUntil = typeof body.validUntil === "string" ? body.validUntil.trim().slice(0, 20) : "";
        const periodMonth = typeof body.periodMonth === "string" ? body.periodMonth.trim().slice(0, 20) : "";
        const remark = typeof body.remark === "string" ? body.remark.trim().slice(0, 300) : "";
        const provenance = (body.provenance === "original" || body.provenance === "ocr_ai") ? "original" : "manual";
        const autoVerified = body.status === "verified" && (provenance === "original" || body.ocrEngine) && perm?.verify;
        const status = autoVerified ? "verified" : (body.status === "missing" ? "missing" : "pending");
        const verifyBasis = autoVerified ? String(body.verifyBasis || "原件上传与OCR/AI识别自动核验").slice(0, 200) : "";
        const docId = `doc_${randomUUID().slice(0, 10)}`;
        transaction(db, () => {
          db.prepare(`INSERT INTO company_doc(id,company_id,doc_group,category,name,doc_no,issuer,qual_items_json,valid_until,period_month,remark,status,provenance,verified_by,verified_at,verify_basis,version,updated_by)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,CASE WHEN ?='verified' THEN CURRENT_TIMESTAMP ELSE '' END,?,1,?)`)
            .run(docId, companyId, docGroup, category, name, docNo, issuer, JSON.stringify(qualItems), validUntil, periodMonth, remark, status, provenance, autoVerified ? user.name : null, status, verifyBasis, user.id);
          db.prepare(`INSERT INTO company_doc_history(doc_id,version,action,reason,snapshot_json,actor,actor_name)
            VALUES (?,1,?,?,?,?,?)`).run(docId, autoVerified ? "AI识别建档核验" : "创建", autoVerified ? verifyBasis : "首次登记", JSON.stringify({ docGroup, category, name, docNo, issuer, qualItems, validUntil, periodMonth, remark, status }), user.id, user.name);
          audit(user.id, autoVerified ? "自动核验并建档公司资料" : "登记公司资料", `${companyId}/${docGroup}/${name}`, "已记录");
        });
        return json({ id: docId, ok: true, status });
      }

      // 6. Edit / Verify / Void company document (version conflict & mandatory reason)
      const docActionMatch = pathname.match(/^\/api\/docs\/([a-zA-Z0-9_-]+)\/action$/);
      if (docActionMatch) {
        const docId = docActionMatch[1];
        const doc = db.prepare("SELECT * FROM company_doc WHERE id=?").get(docId);
        if (!doc) return missing();
        const perm = grant(user.id, doc.company_id);
        const action = body.action;
        if (body.version !== undefined && Number(body.version) !== doc.version) {
          return json({ message: "该资料已被他人更新，请刷新后重试。" }, 409);
        }
        const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";
        if (action === "verify") {
          if (!perm?.verify) return denied(user.id, "核实资料", docId);
          if (!reason) return invalid("核实资料属于高风险操作，必须填写核实依据。");
          const nextVer = doc.version + 1;
          transaction(db, () => {
            db.prepare(`UPDATE company_doc SET status='verified', verified_by=?, verified_at=CURRENT_TIMESTAMP, verify_basis=?, version=?, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
              .run(user.name, reason, nextVer, user.id, docId);
            db.prepare(`INSERT INTO company_doc_history(doc_id,version,action,reason,snapshot_json,actor,actor_name)
              VALUES (?,?,'核实',?,?,?,?)`).run(docId, nextVer, reason, JSON.stringify({ status: "verified", valid_until: doc.valid_until, doc_no: doc.doc_no }), user.id, user.name);
            audit(user.id, "核实公司资料", `${docId}：${reason.slice(0, 60)}`, "已记录");
          });
          return json({ ok: true, version: nextVer });
        }
        if (action === "void") {
          if (!perm?.edit) return denied(user.id, "作废资料", docId);
          if (!reason) return invalid("作废资料必须填写原因，历史记录将保留，不会删除。");
          const nextVer = doc.version + 1;
          transaction(db, () => {
            db.prepare(`UPDATE company_doc SET status='void', version=?, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(nextVer, user.id, docId);
            db.prepare(`INSERT INTO company_doc_history(doc_id,version,action,reason,snapshot_json,actor,actor_name)
              VALUES (?,?,'作废',?,?,?,?)`).run(docId, nextVer, reason, JSON.stringify({ status: "void" }), user.id, user.name);
            audit(user.id, "作废公司资料", `${docId}：${reason.slice(0, 60)}`, "已记录");
          });
          return json({ ok: true, version: nextVer });
        }
        if (action === "edit") {
          if (!perm?.edit) return denied(user.id, "修改资料", docId);
          const category = typeof body.category === "string" && body.category.trim() ? body.category.trim().slice(0, 40) : doc.category;
          const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 160) : doc.name;
          const docNo = typeof body.docNo === "string" ? body.docNo.trim().slice(0, 80) : doc.doc_no;
          const issuer = typeof body.issuer === "string" ? body.issuer.trim().slice(0, 100) : (doc.issuer || "");
          let qualItemsJson = doc.qual_items_json || "[]";
          if (typeof body.qualItemsText === "string") {
            const arr = body.qualItemsText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => ({ name: l.slice(0, 120), passLabel: "合格", validUntil: "" }));
            qualItemsJson = JSON.stringify(arr);
          }
          const validUntil = typeof body.validUntil === "string" ? body.validUntil.trim().slice(0, 20) : doc.valid_until;
          const nextVer = doc.version + 1;
          transaction(db, () => {
            db.prepare(`UPDATE company_doc SET category=?, name=?, doc_no=?, issuer=?, qual_items_json=?, valid_until=?, status='pending', version=?, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
              .run(category, name, docNo, issuer, qualItemsJson, validUntil, nextVer, user.id, docId);
            db.prepare(`INSERT INTO company_doc_history(doc_id,version,action,reason,snapshot_json,actor,actor_name)
              VALUES (?,?,'修改',?,?,?,?)`).run(docId, nextVer, reason || "字段更新", JSON.stringify({ category, name, docNo, issuer, validUntil, status: "pending" }), user.id, user.name);
            audit(user.id, "修改公司资料", `${docId}/v${nextVer}`, "已记录");
          });
          return json({ ok: true, version: nextVer });
        }
        return invalid("不支持的资料操作类型。");
      }

      // 7. Add company person
      const addPersonMatch = pathname.match(/^\/api\/companies\/([^/]+)\/people$/);
      if (addPersonMatch) {
        const companyId = addPersonMatch[1];
        const perm = grant(user.id, companyId);
        if (!perm?.edit) return denied(user.id, "登记人员档案", companyId);
        const name = typeof body.name === "string" ? body.name.trim().slice(0, 40) : "";
        if (!name) return invalid("请填写人员姓名。");
        const roleTitle = typeof body.roleTitle === "string" ? body.roleTitle.trim().slice(0, 40) : "";
        const certLevel = typeof body.certLevel === "string" ? body.certLevel.trim().slice(0, 60) : "";
        const certValidUntil = typeof body.certValidUntil === "string" ? body.certValidUntil.trim().slice(0, 20) : "";
        const lockStatus = ["available", "locked", "pending"].includes(body.lockStatus) ? body.lockStatus : "available";
        const socialStatus = ["正常连续缴纳", "待补缴", "未标注"].includes(body.socialStatus) ? body.socialStatus : "未标注";
        const socialUntil = typeof body.socialUntil === "string" ? body.socialUntil.trim().slice(0, 20) : "";
        const idCard = typeof body.idCard === "string" ? body.idCard.trim().slice(0, 40) : "";
        const phone = typeof body.phone === "string" ? body.phone.trim().slice(0, 30) : "";
        const certNo = typeof body.certNo === "string" ? body.certNo.trim().slice(0, 60) : "";
        const pid = `per_${randomUUID().slice(0, 10)}`;
        transaction(db, () => {
          db.prepare(`INSERT INTO company_person(id,company_id,name,role_title,cert_level,cert_valid_until,lock_status,social_status,social_until,id_card_secret,phone_secret,cert_no_secret,updated_by)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
            .run(pid, companyId, name, roleTitle, certLevel, certValidUntil, lockStatus, socialStatus, socialUntil, idCard, phone, certNo, user.id);
          audit(user.id, "登记人员档案", `${companyId}/${name}`, "已记录");
        });
        return json({ id: pid, ok: true });
      }

      // 7b. Update company person lock/social/cert status
      const updatePersonMatch = pathname.match(/^\/api\/people\/([a-zA-Z0-9_-]+)\/update$/);
      if (updatePersonMatch) {
        const pid = updatePersonMatch[1];
        const p = db.prepare("SELECT * FROM company_person WHERE id=?").get(pid);
        if (!p) return missing();
        const perm = grant(user.id, p.company_id);
        if (!perm?.edit) return denied(user.id, "更新人员档案", pid);
        const lockStatus = ["available", "locked", "pending"].includes(body.lockStatus) ? body.lockStatus : p.lock_status;
        const socialStatus = ["正常连续缴纳", "待补缴", "未标注"].includes(body.socialStatus) ? body.socialStatus : (p.social_status || "未标注");
        const socialUntil = typeof body.socialUntil === "string" ? body.socialUntil.trim().slice(0, 20) : (p.social_until || "");
        const certValidUntil = typeof body.certValidUntil === "string" ? body.certValidUntil.trim().slice(0, 20) : p.cert_valid_until;
        const certLevel = typeof body.certLevel === "string" ? body.certLevel.trim().slice(0, 60) : p.cert_level;
        const roleTitle = typeof body.roleTitle === "string" ? body.roleTitle.trim().slice(0, 40) : p.role_title;
        transaction(db, () => {
          db.prepare(`UPDATE company_person SET lock_status=?, social_status=?, social_until=?, cert_valid_until=?, cert_level=?, role_title=?, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
            .run(lockStatus, socialStatus, socialUntil, certValidUntil, certLevel, roleTitle, user.id, pid);
          audit(user.id, "更新人员档案", `${p.company_id}/${p.name}(${lockStatus}/${socialStatus})`, "已记录");
        });
        return json({ ok: true });
      }

      // 7c. Upload PDF/image attachment for company_doc or company_person
      const uploadFileMatch = pathname.match(/^\/api\/companies\/([^/]+)\/files$/);
      if (uploadFileMatch) {
        if (!allowRate(`upload:${user.id}`, 30, 60_000)) {
          return json({ message: "上传过于频繁，请稍后重试。" }, 429);
        }
        const companyId = uploadFileMatch[1];
        const perm = grant(user.id, companyId);
        if (!perm?.edit) return denied(user.id, "上传公司资料附件", companyId);
        const ownerType = body.ownerType === "person" ? "person" : "doc";
        const ownerId = typeof body.ownerId === "string" ? body.ownerId.trim() : "";
        const filename = typeof body.filename === "string" ? body.filename.trim().slice(0, 120) : "document.pdf";
        const rawB64 = typeof body.dataBase64 === "string" ? body.dataBase64.replace(/^data:[^;]+;base64,/, "") : "";
        if (!ownerId || !rawB64) return invalid("请提供关联条目与有效文件内容。");
        const buf = Buffer.from(rawB64, "base64");
        if (!buf.length || buf.length > 10 * 1024 * 1024) return invalid("附件大小须在 1B–10MB 之间。");

        let mimeType = "";
        if (buf.subarray(0, 5).toString("ascii") === "%PDF-") mimeType = "application/pdf";
        else if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) mimeType = "image/png";
        else if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) mimeType = "image/jpeg";
        else return invalid("仅支持 PDF、PNG 或 JPG 原件/扫描件。");

        if (ownerType === "doc") {
          const doc = db.prepare("SELECT id, version FROM company_doc WHERE id=? AND company_id=?").get(ownerId, companyId);
          if (!doc) return missing();
        } else {
          const per = db.prepare("SELECT id FROM company_person WHERE id=? AND company_id=?").get(ownerId, companyId);
          if (!per) return missing();
        }

        if (!getCosCredentials()) {
          return json({ message: "尚未配置腾讯云 COS 密钥（TOUBIAO_COS_SECRET_ID / TOUBIAO_COS_SECRET_KEY），请管理员在 服务环境变量中配置后重启。" }, 503);
        }

        const fileId = `fil_${randomUUID().slice(0, 12)}`;
        const sha = digest(buf);
        const ext = mimeType === "application/pdf" ? ".pdf" : mimeType === "image/png" ? ".png" : ".jpg";
        const cosKey = `${COS_SHARED_PREFIX}/company-files/${companyId}/${fileId}${ext}`;
        await cosPutVerified(cosKey, buf, mimeType, sha);

        transaction(db, () => {
          db.prepare(`INSERT INTO company_file(id,company_id,owner_type,owner_id,filename,mime_type,size_bytes,sha256,bytes,storage_backend,cos_key,uploaded_by)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(fileId, companyId, ownerType, ownerId, filename, mimeType, buf.length, sha, Buffer.alloc(0), "cos", cosKey, user.id);
          if (ownerType === "doc") {
            db.prepare("UPDATE company_doc SET file_id=?, file_name=?, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(fileId, filename, user.id, ownerId);
            const doc = db.prepare("SELECT version FROM company_doc WHERE id=?").get(ownerId);
            db.prepare(`INSERT INTO company_doc_history(doc_id,version,action,reason,snapshot_json,actor,actor_name)
              VALUES (?,?,'上传附件',?,?,?,?)`).run(ownerId, doc?.version || 1, `上传原件（COS）：${filename}`, JSON.stringify({ fileId, filename, mimeType, size: buf.length, storage: "cos" }), user.id, user.name);
          } else {
            db.prepare("UPDATE company_person SET file_id=?, file_name=?, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(fileId, filename, user.id, ownerId);
          }
          audit(user.id, "上传资料原件", `${companyId}/${ownerType}/${filename}(COS)`, "已记录");
        });
        return json({ ok: true, fileId, filename, mimeType, sizeBytes: buf.length, storage: "cos" });
      }

      // 8. High-risk sensitive info reveal (mandatory reason + immutable audit)
      const revealMatch = pathname.match(/^\/api\/people\/([a-zA-Z0-9_-]+)\/reveal$/);
      if (revealMatch) {
        if (!allowRate(`reveal:${user.id}`, 20, 60_000)) {
          return json({ message: "敏感信息查看频次过高，请稍后重试。" }, 429);
        }
        const pid = revealMatch[1];
        const p = db.prepare("SELECT * FROM company_person WHERE id=?").get(pid);
        if (!p) return missing();
        const perm = grant(user.id, p.company_id);
        if (!perm?.view) return denied(user.id, "查看敏感信息", pid);
        const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 200) : "";
        if (!reason) return invalid("查看人员敏感信息必须填写事由，本次查看将留痕记录。");
        audit(user.id, "查看人员敏感信息", `${p.company_id}/${p.name}：${reason}`, "已记录");
        return json({
          name: p.name,
          idCard: p.id_card_secret || "未登记",
          phone: p.phone_secret || "未登记",
          certNo: p.cert_no_secret || "未登记",
          loggedAt: new Date().toISOString(),
        });
      }

      // 9. Save BidMaster-Pro 21-item compliance verification on a lot
      const checkPostMatch = pathname.match(/^\/api\/opportunities\/(\d+)\/checks$/);
      if (checkPostMatch) {
        const noticeId = checkPostMatch[1];
        if (!visible(user.id, noticeId)) return missing();
        const ruleCode = typeof body.ruleCode === "string" ? body.ruleCode.trim() : "";
        const companyId = typeof body.companyId === "string" ? body.companyId.trim() : "";
        if (companyId && !grant(user.id, companyId)?.edit) return denied(user.id, "标段合规核查", companyId);
        const status = ["pending", "conform", "non_conform", "na"].includes(body.status) ? body.status : "pending";
        const basis = typeof body.basis === "string" ? body.basis.trim().slice(0, 300) : "";
        if (!ruleCode) return invalid("缺少核对项编码。");
        if ((status === "na" || status === "non_conform") && !basis) {
          return invalid("标记为「不满足」或「不适用」必须填写核实依据。");
        }
        transaction(db, () => {
          db.prepare(`INSERT INTO lot_check_item(notice_id,company_id,rule_code,status,basis,updated_by,updated_by_name,updated_at)
            VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
            ON CONFLICT(notice_id,company_id,rule_code) DO UPDATE SET
              status=excluded.status, basis=excluded.basis, updated_by=excluded.updated_by,
              updated_by_name=excluded.updated_by_name, updated_at=CURRENT_TIMESTAMP`)
            .run(noticeId, companyId, ruleCode, status, basis, user.id, user.name);
          audit(user.id, "标段合规核对", `${noticeId}/${ruleCode}/${status}`, "已记录");
        });
        return json({ ok: true });
      }

      // 10. System Settings (project select toggle + custom field dictionaries + admin-only TokenHub config)
      const DEFAULT_FIELD_DICTS = {
        depositMethods: [
          "基本户网银转账（现金保证金）",
          "现金（信封密封现场递交）",
          "银行支票 / 汇票 / 本票",
          "电子保函（交易平台线上出函）",
          "银行纸质保函",
          "投标保证保险（电子保单）",
          "免缴（信用承诺书 / 政采或小微免缴）",
        ],
        depositStatuses: [
          "已汇出待核验",
          "已到账确认（子账号已匹配）",
          "现金信封已封装待带往现场",
          "已出保函 / 保单生效",
          "免缴（已附信用承诺书）",
          "财务审批 / 待打款中",
        ],
        docBuyStatuses: ["未获取", "已下载免费标书", "已付费购买标书", "需CA锁平台下载", "已放弃获取"],
        prepStatuses: ["未开始", "编制中", "商务标已完成", "技术标已完成", "内审与21项自检完成", "已定稿待签章", "已加密上传/封装"],
        refundStatuses: ["未进入退保", "待申请退回", "已申请催退中", "保证金已全额退回", "电子保函已释放", "现金信封现场已退回", "免缴无需退保"],
        enterpriseCategories: ["建筑业企业资质", "安全生产许可证", "营业执照", "信用证明", "质量/环境/安全管理体系"],
      };
      const getFieldDicts = () => {
        const raw = db.prepare("SELECT value FROM app_setting WHERE key='field_dicts_json'").get()?.value;
        let saved = {};
        try { if (raw) saved = JSON.parse(raw); } catch {}
        const merged = {};
        for (const [k, defArr] of Object.entries(DEFAULT_FIELD_DICTS)) {
          merged[k] = Array.isArray(saved[k]) && saved[k].length ? saved[k].map((s) => String(s).trim()).filter(Boolean) : defArr;
        }
        return merged;
      };

      if (pathname === "/api/settings") {
        if (body.requireAssigneeOnSelect !== undefined) {
          const requireAssignee = body.requireAssigneeOnSelect ? "1" : "0";
          transaction(db, () => {
            db.prepare(`INSERT INTO app_setting(key,value,updated_by,updated_at) VALUES ('requireAssigneeOnSelect',?,?,CURRENT_TIMESTAMP)
              ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP`)
              .run(requireAssignee, user.id);
            audit(user.id, "更新系统设置", `requireAssigneeOnSelect=${requireAssignee}`, "已记录");
          });
        }
        if (body.showWatchKeywords !== undefined) {
          const val = body.showWatchKeywords ? "1" : "0";
          transaction(db, () => {
            db.prepare(`INSERT INTO app_setting(key,value,updated_by,updated_at) VALUES ('showWatchKeywords',?,?,CURRENT_TIMESTAMP)
              ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP`)
              .run(val, user.id);
            audit(user.id, "更新系统设置", `showWatchKeywords=${val}`, "已记录");
          });
        }
        if (body.showOppTags !== undefined) {
          const val = body.showOppTags ? "1" : "0";
          transaction(db, () => {
            db.prepare(`INSERT INTO app_setting(key,value,updated_by,updated_at) VALUES ('showOppTags',?,?,CURRENT_TIMESTAMP)
              ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP`)
              .run(val, user.id);
            audit(user.id, "更新系统设置", `showOppTags=${val}`, "已记录");
          });
        }
        if (typeof body.defaultFinanceUserId === "string") {
          if (user.role !== "admin") return denied(user.id, "设置默认财务人员", "系统设置");
          const fid = body.defaultFinanceUserId.trim();
          transaction(db, () => {
            db.prepare(`INSERT INTO app_setting(key,value,updated_by,updated_at) VALUES ('default_finance_user_id',?,?,CURRENT_TIMESTAMP)
              ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP`)
              .run(fid, user.id);
            audit(user.id, "设置默认财务人员", fid || "清空", "已记录");
          });
        }
        if (body.userPerspective && typeof body.userPerspective === "object") {
          if (user.role !== "admin") return denied(user.id, "调整成员岗位首页角色", "系统设置");
          const targetId = String(body.userPerspective.employeeId || "").trim();
          const nextPersp = String(body.userPerspective.perspective || "").trim();
          if (!targetId || !perspectivePaths.has(nextPersp)) return invalid("请选择有效的成员与岗位首页角色。");
          const targetEmp = employee(targetId);
          if (!targetEmp) return missing();
          transaction(db, () => {
            db.prepare("UPDATE employee SET perspective=? WHERE id=?").run(nextPersp, targetId);
            audit(user.id, "调整成员岗位首页视角", `${targetEmp.username}(${targetEmp.name}) -> ${nextPersp}`, "已记录");
          });
        }
        if (body.fieldDicts && typeof body.fieldDicts === "object") {
          const nextDicts = getFieldDicts();
          for (const k of Object.keys(DEFAULT_FIELD_DICTS)) {
            if (Array.isArray(body.fieldDicts[k])) {
              const cleaned = [...new Set(body.fieldDicts[k].map((s) => String(s || "").trim().slice(0, 60)).filter(Boolean))];
              if (cleaned.length) nextDicts[k] = cleaned;
            }
          }
          transaction(db, () => {
            db.prepare(`INSERT INTO app_setting(key,value,updated_by,updated_at) VALUES ('field_dicts_json',?,?,CURRENT_TIMESTAMP)
              ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP`)
              .run(JSON.stringify(nextDicts), user.id);
            audit(user.id, "更新业务字段选项", Object.keys(body.fieldDicts).join(","), "已记录");
          });
        }
        return json({
          ok: true,
          requireAssigneeOnSelect: db.prepare("SELECT value FROM app_setting WHERE key='requireAssigneeOnSelect'").get()?.value === "1",
          fieldDicts: getFieldDicts(),
        });
      }

      if (pathname === "/api/settings/ai") {
        if (user.role !== "admin") return denied(user.id, "修改AI接口配置", "TokenHub设置");
        const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim().replace(/\/+$/, "") : "";
        const defaultModel = typeof body.defaultModel === "string" ? body.defaultModel.trim().slice(0, 100) : "";
        const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
        const clearKey = body.clearKey === true;
        if (baseUrl && !/^https?:\/\/[^/\s]+/i.test(baseUrl)) {
          return invalid("Base URL 格式不正确，请以 https:// 开头。");
        }
        transaction(db, () => {
          const upsert = db.prepare(`INSERT INTO app_setting(key,value,updated_by,updated_at) VALUES (?,?,?,CURRENT_TIMESTAMP)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP`);
          if (baseUrl) upsert.run("tokenhub_base_url", baseUrl, user.id);
          if (defaultModel) upsert.run("tokenhub_default_model", defaultModel, user.id);
          if (clearKey) {
            db.prepare("DELETE FROM app_setting WHERE key='tokenhub_api_key'").run();
          } else if (apiKey) {
            upsert.run("tokenhub_api_key", apiKey, user.id);
          }
          audit(user.id, "更新TokenHub配置", `${baseUrl || "(保持原地址)"} / ${defaultModel || "(保持原模型)"}${apiKey ? " / 已更新密钥" : clearKey ? " / 已清除密钥" : ""}`, "已记录");
        });
        const cfg = getAiConfig();
        return json({ ok: true, baseUrl: cfg.baseUrl, defaultModel: cfg.defaultModel, hasApiKey: cfg.hasApiKey, keySource: cfg.keySource });
      }

      if (pathname === "/api/settings/ai/test") {
        if (user.role !== "admin") return denied(user.id, "测试AI接口连通性", "TokenHub设置");
        const cfg = getAiConfig();
        if (!cfg.apiKey) return json({ ok: false, message: "尚未配置 TokenHub API Key，请先填写并保存。" }, 400);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
          const res = await fetch(`${cfg.baseUrl}/models`, {
            headers: { "Authorization": `Bearer ${cfg.apiKey}` },
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (!res.ok) {
            return json({ ok: false, message: `TokenHub 返回 HTTP ${res.status}，请核对 API Key 或接口地址。` }, 502);
          }
          const data = await res.json();
          const ids = Array.isArray(data?.data) ? data.data.map((m) => m?.id).filter(Boolean) : [];
          const deepseekModels = ids.filter((id) => /deepseek|flash|v4/i.test(id));
          return json({
            ok: true,
            modelCount: ids.length,
            models: ids.slice(0, 60),
            deepseekModels,
            defaultModel: cfg.defaultModel,
            message: `连通正常，共获取到 ${ids.length} 个可用模型。`,
          });
        } catch (err) {
          clearTimeout(timer);
          return json({ ok: false, message: err?.name === "AbortError" ? "连接 TokenHub 超时（15 秒）。" : "无法连接 TokenHub 接口，请检查网络或地址。" }, 504);
        }
      }

      // 11. Finance Ledger entry & urge record
      const wfMatch = pathname.match(/^\/api\/opportunities\/(\d+)\/workflow$/);
      if (wfMatch) {
        const noticeId = wfMatch[1];
        if (!visible(user.id, noticeId)) return missing();
        const companyId = typeof body.companyId === "string" ? body.companyId.trim() : "";
        if (!lotWriteAllowed(user, noticeId, companyId)) {
          return denied(user.id, "更新标段全流程跟进", companyId || noticeId);
        }
        const step = Number(body.step || 1);
        const cur = db.prepare("SELECT * FROM lot_workflow WHERE notice_id=?").get(noticeId) || {
          notice_id: noticeId,
          company_id: companyId,
          active_step: 1,
          doc_buy_status: "未获取",
          doc_buy_fee_fen: 0,
          doc_buy_at: "",
          doc_buy_file_id: "",
          doc_buy_file_name: "",
          doc_buy_note: "",
          prep_status: "未开始",
          prep_owner_id: "",
          prep_pm_person_id: "",
          prep_pm_name: "",
          prep_deadline: "",
          prep_file_id: "",
          prep_file_name: "",
          prep_note: "",
          opening_sheet_file_id: "",
          opening_sheet_file_name: "",
          predict_status: "待分析",
          predict_our_quote_fen: 0,
          predict_benchmark_fen: 0,
          predict_float_rate: "",
          predict_rank: "",
          predict_note: "",
          refund_track_status: "未进入退保",
          refund_expected_date: "",
          refund_received_date: "",
          refund_note: "",
        };

        const effCompanyId = companyId || cur.company_id || (db.prepare("SELECT company FROM grant_company WHERE employee=? AND edit=1 LIMIT 1").get(user.id)?.company || "");
        const allowRollback = body.allowRollback === true || body.allowRollback === "1";
        const requestedStep = Math.min(7, Math.max(1, Number(body.nextStep || step)));
        const nextStep = allowRollback ? requestedStep : Math.max(Number(cur.active_step || 1), requestedStep);

        transaction(db, () => {
          // Ensure project is followed as 'bidding' if not yet followed
          const pf = db.prepare("SELECT decision FROM project_follow WHERE notice_id=?").get(noticeId);
          if (!pf) {
            db.prepare("INSERT INTO project_follow(notice_id,decision,assignee,note,updated_by) VALUES (?,'bidding',?,?,?)")
              .run(noticeId, user.id, "全流程跟进自动归入参投", user.id);
          }

          if (allowRollback && body.rollbackOnly) {
            audit(user.id, "流程进度撤回/回退", `${noticeId}/阶段${cur.active_step}->阶段${nextStep}`, "已回退");
          } else if (step === 1) {
            const docBuyStatus = typeof body.docBuyStatus === "string" && body.docBuyStatus.trim() ? body.docBuyStatus.trim().slice(0, 40) : cur.doc_buy_status;
            const feeYuan = Number(body.docBuyFeeYuan ?? 0);
            const feeFen = !Number.isNaN(feeYuan) && feeYuan >= 0 ? Math.round(feeYuan * 100) : cur.doc_buy_fee_fen;
            const docBuyAt = typeof body.docBuyAt === "string" ? body.docBuyAt.trim().replace("T", " ").slice(0, 30) : cur.doc_buy_at;
            const docBuyNote = typeof body.docBuyNote === "string" ? body.docBuyNote.trim().slice(0, 300) : cur.doc_buy_note;
            cur.doc_buy_status = docBuyStatus;
            cur.doc_buy_fee_fen = feeFen;
            cur.doc_buy_at = docBuyAt;
            cur.doc_buy_note = docBuyNote;
            // Rule: whenever doc purchase fee > 0, automatically record into finance ledger (deduplicated)
            if (feeFen > 0) {
              const exExp = db.prepare("SELECT id, amount_fen FROM finance_entry WHERE notice_id=? AND category='expense' AND reversed=0 AND note LIKE '购买标书费用%' ORDER BY created_at DESC LIMIT 1").get(noticeId);
              if (!exExp) {
                const fid = `fin_${randomUUID().slice(0, 10)}`;
                db.prepare(`INSERT INTO finance_entry(id,notice_id,company_id,lot_round,category,entry_type,amount_fen,pay_status,receive_status,refund_cond,refund_status,dispute_status,due_date,note,actor,actor_name)
                  VALUES (?,?,?,'默认标段 · 第1轮','expense','paid',?,'已扣款','已确认','不退','不适用','无争议',?,?,?,?)`)
                  .run(fid, noticeId, effCompanyId, feeFen, docBuyAt.slice(0, 10), `购买标书费用：${docBuyNote || "标书费"}`, user.id, user.name);
              } else if (Number(exExp.amount_fen) !== feeFen) {
                db.prepare("UPDATE finance_entry SET amount_fen=?, company_id=?, note=? WHERE id=?")
                  .run(feeFen, effCompanyId, `购买标书费用：${docBuyNote || "标书费"}`, exExp.id);
              }
            }
            audit(user.id, "流程1-购买标书", `${noticeId}/${docBuyStatus}`, "已记录");
          } else if (step === 2) {
            const prepStatus = typeof body.prepStatus === "string" && body.prepStatus.trim() ? body.prepStatus.trim().slice(0, 40) : cur.prep_status;
            const prepOwnerId = typeof body.prepOwnerId === "string" ? body.prepOwnerId.trim() : cur.prep_owner_id;
            const prepPmPersonId = typeof body.prepPmPersonId === "string" ? body.prepPmPersonId.trim() : (cur.prep_pm_person_id || "");
            let prepPmName = cur.prep_pm_name || "";
            if (prepPmPersonId) {
              const pRow = db.prepare("SELECT name, cert_level FROM company_person WHERE id=?").get(prepPmPersonId);
              if (pRow) prepPmName = `${pRow.name}${pRow.cert_level ? ` (${pRow.cert_level})` : ""}`;
            } else if (body.prepPmPersonId === "") {
              prepPmName = "";
            }
            const prepDeadline = typeof body.prepDeadline === "string" ? body.prepDeadline.trim().replace("T", " ").slice(0, 30) : cur.prep_deadline;
            const prepNote = typeof body.prepNote === "string" ? body.prepNote.trim().slice(0, 300) : cur.prep_note;
            cur.prep_status = prepStatus;
            cur.prep_owner_id = prepOwnerId;
            cur.prep_pm_person_id = prepPmPersonId;
            cur.prep_pm_name = prepPmName;
            cur.prep_deadline = prepDeadline;
            cur.prep_note = prepNote;
            if (nextStep >= 3) {
              const exAlt = db.prepare("SELECT 1 FROM alert_todo WHERE notice_id=? AND title LIKE '待办保证金%' AND status='open'").get(noticeId);
              if (!exAlt) {
                const nm = db.prepare("SELECT title, project_key, CAST(deadline_ns AS TEXT) AS dl FROM notice_meta WHERE id=?").get(noticeId);
                const defFin = getDefaultFinanceEmployee();
                db.prepare(`INSERT INTO alert_todo(id,notice_id,project_key,kind,title,detail,assignee,status,due_ns,finance_company_id)
                  VALUES (?,?,?,'todo',?,?,?,'open',CAST(? AS INTEGER),?)`)
                  .run(`alt_${randomUUID().slice(0, 10)}`, noticeId, nm?.project_key || "", `待办保证金/保函：${(nm?.title || "").slice(0, 40)}`, "标书编制已推进至阶段 3，请在项目详情推送完整打款账户/金额给财务执行打款。", defFin?.id || null, nm?.dl || "0", companyId);
              }
            }
            audit(user.id, "流程2-制作投标文件", `${noticeId}/${prepStatus}${prepPmName ? "/" + prepPmName : ""}`, "已记录");
          } else if (step === 3) {
            const rawMethod = typeof body.depositMethod === "string" ? body.depositMethod.trim() : "";
            const category = (body.category === "guarantee" || /保函|保险/.test(rawMethod)) ? "guarantee" : "deposit";
            const entryType = category === "guarantee" ? "guarantee_face" : "paid";
            const amountYuan = Number(body.amountYuan ?? 0);
            const isExempt = /免缴|信用承诺/.test(rawMethod) || body.payStatus === "免缴（已附承诺书）";
            if (isExempt || (!Number.isNaN(amountYuan) && amountYuan > 0)) {
              const amountFen = isExempt ? 0 : Math.round(amountYuan * 100);
              const payStatus = typeof body.payStatus === "string" && body.payStatus.trim() ? body.payStatus.trim().slice(0, 30) : (isExempt ? "免缴（已附承诺书）" : category === "guarantee" ? "已出函" : "已汇出");
              const dueDate = typeof body.dueDate === "string" ? body.dueDate.trim().slice(0, 20) : "";
              const methodPrefix = rawMethod ? `【${rawMethod}】` : "";
              const note = (methodPrefix + (typeof body.note === "string" ? body.note.trim() : "")).slice(0, 300);
              const fid = `fin_${randomUUID().slice(0, 10)}`;
              db.prepare(`INSERT INTO finance_entry(id,notice_id,company_id,lot_round,category,entry_type,amount_fen,pay_status,receive_status,refund_cond,refund_status,dispute_status,due_date,note,actor,actor_name)
                VALUES (?,?,?,'默认标段 · 第1轮',?,?,?,?,?,?,?,?,?,?,?,?)`)
                .run(fid, noticeId, effCompanyId, category, entryType, amountFen, payStatus, isExempt ? "免缴生效" : "已到账/已生效", isExempt ? "不适用" : "未核实", isExempt ? "不适用" : "未申请", "无争议", dueDate, note, user.id, user.name);
              audit(user.id, "流程3-投标保证金付款", `${noticeId}/${rawMethod || category}/${amountYuan}元`, "已记录");
            }
          } else if (step === 4) {
            const openMode = ["现场", "远程", "混合", "未标注"].includes(body.openMode) ? body.openMode : "现场";
            const submitTime = typeof body.submitTime === "string" ? body.submitTime.trim().replace("T", " ").slice(0, 30) : "";
            const decryptWindow = typeof body.decryptWindow === "string" ? body.decryptWindow.trim().slice(0, 60) : "";
            const openTime = typeof body.openTime === "string" ? body.openTime.trim().replace("T", " ").slice(0, 30) : "";
            const venue = typeof body.venue === "string" ? body.venue.trim().slice(0, 200) : "";
            const delegateId = typeof body.delegateId === "string" && body.delegateId.trim() ? body.delegateId.trim() : null;
            const departAt = typeof body.departAt === "string" ? body.departAt.trim().replace("T", " ").slice(0, 30) : "";
            const untilAt = typeof body.untilAt === "string" ? body.untilAt.trim().replace("T", " ").slice(0, 30) : "";
            const note = typeof body.note === "string" ? body.note.trim().slice(0, 300) : "";
            const exSch = db.prepare("SELECT id FROM bid_schedule WHERE notice_id=? ORDER BY updated_at DESC LIMIT 1").get(noticeId);
            if (exSch) {
              db.prepare(`UPDATE bid_schedule SET company_id=?,open_mode=?,submit_time=?,decrypt_window=?,open_time=?,venue=?,delegate_id=?,depart_at=?,until_at=?,note=?,version=version+1,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
                .run(effCompanyId, openMode, submitTime, decryptWindow, openTime, venue, delegateId, departAt, untilAt, note, user.id, exSch.id);
            } else {
              const sid = `sch_${randomUUID().slice(0, 10)}`;
              db.prepare(`INSERT INTO bid_schedule(id,notice_id,company_id,open_mode,submit_time,decrypt_window,open_time,venue,delegate_id,depart_at,until_at,note,version,updated_by)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?)`)
                .run(sid, noticeId, effCompanyId, openMode, submitTime, decryptWindow, openTime, venue, delegateId, departAt, untilAt, note, user.id);
            }
            if (delegateId) {
              const exAlt = db.prepare("SELECT 1 FROM alert_todo WHERE notice_id=? AND assignee=? AND title LIKE '开标参会指派%' AND status='open'").get(noticeId, delegateId);
              if (!exAlt) {
                const nm = db.prepare("SELECT title, project_key, CAST(deadline_ns AS TEXT) AS dl FROM notice_meta WHERE id=?").get(noticeId);
                db.prepare(`INSERT INTO alert_todo(id,notice_id,project_key,kind,title,detail,assignee,status,due_ns)
                  VALUES (?,?,?,'todo',?,?,?,'open',CAST(? AS INTEGER))`)
                  .run(`alt_${randomUUID().slice(0, 10)}`, noticeId, nm?.project_key || "", `开标参会指派：${(nm?.title || "").slice(0, 40)}`, `您已被指派参加该项目开标（${openMode} · ${openTime || "详见日程"} · ${venue || "详见公告"}），开标后请回传开标记录表。`, delegateId, nm?.dl || "0");
              }
            }
            audit(user.id, "流程4-指派参加开标", `${noticeId}/${openMode}`, "已记录");
          } else if (step === 5) {
            const openMode = ["现场", "远程", "混合", "未标注"].includes(body.openMode) ? body.openMode : "现场";
            const venue = typeof body.venue === "string" ? body.venue.trim().slice(0, 120) : "";
            const arriveTime = typeof body.arriveTime === "string" ? body.arriveTime.trim().slice(0, 40) : "";
            const contact = typeof body.contact === "string" ? body.contact.trim().slice(0, 80) : "";
            const materialsVer = typeof body.materialsVer === "string" ? body.materialsVer.trim().slice(0, 120) : "";
            const note = typeof body.note === "string" ? body.note.trim().slice(0, 400) : "";
            const rawBids = Array.isArray(body.bids) ? body.bids : [];
            const bids = rawBids
              .filter((b) => b && typeof b.bidder === "string" && b.bidder.trim())
              .slice(0, 60)
              .map((b, idx) => ({
                rank: Number(b.rank) || idx + 1,
                bidder: b.bidder.trim().slice(0, 100),
                amountYuan: Number(b.amountYuan) || 0,
                valid: b.valid !== false,
                remark: typeof b.remark === "string" ? b.remark.trim().slice(0, 100) : "",
              }));
            const lastVer = db.prepare("SELECT coalesce(max(version),0) AS v FROM opening_record WHERE notice_id=?").get(noticeId).v;
            const oid = `opn_${randomUUID().slice(0, 10)}`;
            db.prepare(`INSERT INTO opening_record(id,notice_id,version,open_mode,venue,arrive_time,contact,materials_ver,bids_json,photo_data,quality_flags,verified,note,actor,actor_name)
              VALUES (?,?,?,?,?,?,?,?,?,'','[]',1,?,?,?)`)
              .run(oid, noticeId, lastVer + 1, openMode, venue, arriveTime, contact, materialsVer, JSON.stringify(bids), note, user.id, user.name);
            audit(user.id, "流程5-开标记录表回传", `${noticeId}/${bids.length}家唱标`, "已记录");
          } else if (step === 6) {
            const predictStatus = ["待分析", "高概率第一候选人", "进入前三候选范围", "报价偏离较大/待综合评分", "预计未入围"].includes(body.predictStatus) ? body.predictStatus : cur.predict_status;
            const ourQuoteYuan = Number(body.ourQuoteYuan ?? 0);
            const benchYuan = Number(body.benchmarkYuan ?? 0);
            const ourFen = !Number.isNaN(ourQuoteYuan) && ourQuoteYuan >= 0 ? Math.round(ourQuoteYuan * 100) : cur.predict_our_quote_fen;
            const benchFen = !Number.isNaN(benchYuan) && benchYuan >= 0 ? Math.round(benchYuan * 100) : cur.predict_benchmark_fen;
            const floatRate = typeof body.floatRate === "string" ? body.floatRate.trim().slice(0, 30) : cur.predict_float_rate;
            const predictRank = typeof body.predictRank === "string" ? body.predictRank.trim().slice(0, 30) : cur.predict_rank;
            const predictNote = typeof body.predictNote === "string" ? body.predictNote.trim().slice(0, 400) : cur.predict_note;
            cur.predict_status = predictStatus;
            cur.predict_our_quote_fen = ourFen;
            cur.predict_benchmark_fen = benchFen;
            cur.predict_float_rate = floatRate;
            cur.predict_rank = predictRank;
            cur.predict_note = predictNote;
            const lastVer = db.prepare("SELECT coalesce(max(version),0) AS v FROM bid_estimate WHERE notice_id=?").get(noticeId).v;
            const eid = `est_${randomUUID().slice(0, 10)}`;
            db.prepare(`INSERT INTO bid_estimate(id,notice_id,version,rule_name,params_json,snapshot_json,result_json,note,actor,actor_name)
              VALUES (?,?,?,'开标记录表分析预测',?,?,?,?,?,?)`)
              .run(
                eid,
                noticeId,
                lastVer + 1,
                JSON.stringify({ ourQuoteYuan, benchmarkYuan: benchYuan, floatRate }),
                JSON.stringify({ predictRank }),
                JSON.stringify({ predictStatus, ourQuoteYuan, benchmarkYuan: benchYuan, floatRate, predictRank }),
                predictNote,
                user.id,
                user.name,
              );
            audit(user.id, "流程6-中标预测分析", `${noticeId}/${predictStatus}`, "已记录");
          } else if (step === 7) {
            const finalResult = ["未标注", "中标", "未中标", "流标或终止"].includes(body.finalResult) ? body.finalResult : "未标注";
            const candidateStatus = ["未标注", "第一候选人", "第二候选人", "第三候选人", "未入围", "公示异议中"].includes(body.candidateStatus) ? body.candidateStatus : "未标注";
            const awardYuan = body.awardAmountYuan !== "" && body.awardAmountYuan !== null && body.awardAmountYuan !== undefined ? Number(body.awardAmountYuan) : null;
            const awardFen = awardYuan !== null && !Number.isNaN(awardYuan) && awardYuan >= 0 ? Math.round(awardYuan * 100) : null;
            const noticeLetterStatus = ["未下达", "已下达待签收", "已签收"].includes(body.noticeLetterStatus) ? body.noticeLetterStatus : "未下达";
            const noticeLetterDate = typeof body.noticeLetterDate === "string" ? body.noticeLetterDate.trim().slice(0, 20) : "";
            const guaranteeStatus = ["未标注", "免缴(附依据)", "履约保函已办", "履约现金已缴"].includes(body.guaranteeStatus) ? body.guaranteeStatus : "未标注";
            const contractStatus = ["未签署", "审核中", "已签署", "已移交启动"].includes(body.contractStatus) ? body.contractStatus : "未签署";
            const handoverTo = typeof body.handoverTo === "string" ? body.handoverTo.trim().slice(0, 80) : "";
            const note = typeof body.note === "string" ? body.note.trim().slice(0, 300) : "";

            const oid = `out_${randomUUID().slice(0, 10)}`;
            db.prepare(`INSERT INTO bid_outcome(id,notice_id,company_id,candidate_status,final_result,award_amount_fen,notice_letter_status,notice_letter_date,guarantee_status,contract_status,handover_to,note,updated_by,updated_by_name,updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
              ON CONFLICT(notice_id,company_id) DO UPDATE SET
                candidate_status=excluded.candidate_status, final_result=excluded.final_result,
                award_amount_fen=excluded.award_amount_fen, notice_letter_status=excluded.notice_letter_status,
                notice_letter_date=excluded.notice_letter_date, guarantee_status=excluded.guarantee_status,
                contract_status=excluded.contract_status, handover_to=excluded.handover_to,
                note=excluded.note, updated_by=excluded.updated_by, updated_by_name=excluded.updated_by_name,
                updated_at=CURRENT_TIMESTAMP`)
              .run(oid, noticeId, effCompanyId, candidateStatus, finalResult, awardFen, noticeLetterStatus, noticeLetterDate, guaranteeStatus, contractStatus, handoverTo, note, user.id, user.name);

            // Refund tracking for non-winning or post-contract deposit recovery
            const refundTrackStatus = ["未进入退保", "待申请退回", "已申请催退中", "保证金已全额退回", "电子保函已释放"].includes(body.refundTrackStatus) ? body.refundTrackStatus : cur.refund_track_status;
            const refundExpectedDate = typeof body.refundExpectedDate === "string" ? body.refundExpectedDate.trim().slice(0, 20) : cur.refund_expected_date;
            const refundReceivedDate = typeof body.refundReceivedDate === "string" ? body.refundReceivedDate.trim().slice(0, 20) : cur.refund_received_date;
            const refundNote = typeof body.refundNote === "string" ? body.refundNote.trim().slice(0, 300) : cur.refund_note;
            cur.refund_track_status = refundTrackStatus;
            cur.refund_expected_date = refundExpectedDate;
            cur.refund_received_date = refundReceivedDate;
            cur.refund_note = refundNote;

            const refundYuan = Number(body.refundAmountYuan ?? 0);
            if (!Number.isNaN(refundYuan) && refundYuan > 0 && (body.recordRefundType === "refund_received" || body.recordRefundType === "urge")) {
              const fid = `fin_${randomUUID().slice(0, 10)}`;
              const rType = body.recordRefundType;
              db.prepare(`INSERT INTO finance_entry(id,notice_id,company_id,lot_round,category,entry_type,amount_fen,pay_status,receive_status,refund_cond,refund_status,dispute_status,due_date,note,actor,actor_name)
                VALUES (?,?,?,'默认标段 · 第1轮','deposit',?,?,?,?,'已满足',?,'无争议',?,?,?,?)`)
                .run(
                  fid,
                  noticeId,
                  effCompanyId,
                  rType,
                  Math.round(refundYuan * 100),
                  rType === "refund_received" ? "已退回" : "催退中",
                  rType === "refund_received" ? "已到账" : "待到账",
                  rType === "refund_received" ? "已到账" : "催退中",
                  refundReceivedDate || refundExpectedDate,
                  refundNote || (rType === "refund_received" ? "投标保证金退回基本户" : "未中标保证金催退"),
                  user.id,
                  user.name,
                );
            }
            if ((finalResult === "未中标" || finalResult === "流标或终止") && refundTrackStatus !== "保证金已全额退回" && refundTrackStatus !== "电子保函已释放") {
              const exAlt = db.prepare("SELECT 1 FROM alert_todo WHERE notice_id=? AND title LIKE '未中标退保证金%' AND status='open'").get(noticeId);
              if (!exAlt) {
                const nm = db.prepare("SELECT title, project_key FROM notice_meta WHERE id=?").get(noticeId);
                db.prepare(`INSERT INTO alert_todo(id,notice_id,project_key,kind,title,detail,assignee,status,due_ns,finance_company_id)
                  VALUES (?,?,?,'todo',?,?,NULL,'open',0,?)`)
                  .run(`alt_${randomUUID().slice(0, 10)}`, noticeId, nm?.project_key || "", `未中标退保证金：${(nm?.title || "").slice(0, 40)}`, `项目结果已定性为「${finalResult}」，请财务与投标专员跟进投标保证金原路退回基本户。`, companyId);
              }
            }
            audit(user.id, "流程7-结果与退保证金", `${noticeId}/${finalResult}/${refundTrackStatus}`, "已记录");
          }

          db.prepare(`INSERT INTO lot_workflow(
            notice_id,company_id,active_step,
            doc_buy_status,doc_buy_fee_fen,doc_buy_at,doc_buy_file_id,doc_buy_file_name,doc_buy_note,
            prep_status,prep_owner_id,prep_pm_person_id,prep_pm_name,prep_deadline,prep_file_id,prep_file_name,prep_note,
            opening_sheet_file_id,opening_sheet_file_name,
            predict_status,predict_our_quote_fen,predict_benchmark_fen,predict_float_rate,predict_rank,predict_note,
            refund_track_status,refund_expected_date,refund_received_date,refund_note,
            updated_by,updated_by_name,updated_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
          ON CONFLICT(notice_id) DO UPDATE SET
            company_id=excluded.company_id, active_step=excluded.active_step,
            doc_buy_status=excluded.doc_buy_status, doc_buy_fee_fen=excluded.doc_buy_fee_fen, doc_buy_at=excluded.doc_buy_at,
            doc_buy_file_id=excluded.doc_buy_file_id, doc_buy_file_name=excluded.doc_buy_file_name, doc_buy_note=excluded.doc_buy_note,
            prep_status=excluded.prep_status, prep_owner_id=excluded.prep_owner_id,
            prep_pm_person_id=excluded.prep_pm_person_id, prep_pm_name=excluded.prep_pm_name,
            prep_deadline=excluded.prep_deadline,
            prep_file_id=excluded.prep_file_id, prep_file_name=excluded.prep_file_name, prep_note=excluded.prep_note,
            opening_sheet_file_id=excluded.opening_sheet_file_id, opening_sheet_file_name=excluded.opening_sheet_file_name,
            predict_status=excluded.predict_status, predict_our_quote_fen=excluded.predict_our_quote_fen,
            predict_benchmark_fen=excluded.predict_benchmark_fen, predict_float_rate=excluded.predict_float_rate,
            predict_rank=excluded.predict_rank, predict_note=excluded.predict_note,
            refund_track_status=excluded.refund_track_status, refund_expected_date=excluded.refund_expected_date,
            refund_received_date=excluded.refund_received_date, refund_note=excluded.refund_note,
            updated_by=excluded.updated_by, updated_by_name=excluded.updated_by_name, updated_at=CURRENT_TIMESTAMP`)
            .run(
              noticeId, effCompanyId, nextStep,
              cur.doc_buy_status, cur.doc_buy_fee_fen, cur.doc_buy_at, cur.doc_buy_file_id, cur.doc_buy_file_name, cur.doc_buy_note,
              cur.prep_status, cur.prep_owner_id, cur.prep_pm_person_id || "", cur.prep_pm_name || "", cur.prep_deadline, cur.prep_file_id, cur.prep_file_name, cur.prep_note,
              cur.opening_sheet_file_id, cur.opening_sheet_file_name,
              cur.predict_status, cur.predict_our_quote_fen, cur.predict_benchmark_fen, cur.predict_float_rate, cur.predict_rank, cur.predict_note,
              cur.refund_track_status, cur.refund_expected_date, cur.refund_received_date, cur.refund_note,
              user.id, user.name,
            );
        });
        return json({ ok: true, activeStep: nextStep });
      }

      // Auto-download notice's built-in attachments to COS bucket with 30-day rolling expiration
      const cacheAttMatch = pathname.match(/^\/api\/opportunities\/(\d+)\/cache-attachments$/);
      if (cacheAttMatch) {
        if (!allowRate(`upload:${user.id}`, 30, 60_000)) {
          return json({ message: "操作过于频繁，请稍后重试。" }, 429);
        }
        const noticeId = cacheAttMatch[1];
        const row = visible(user.id, noticeId);
        if (!row) return missing();
        if (!getCosCredentials()) {
          return json({ message: "尚未配置腾讯云 COS 密钥。" }, 503);
        }
        const parsed = JSON.parse(row.data);
        const atts = Array.isArray(parsed.attachments) ? parsed.attachments : [];
        if (!atts.length) return json({ ok: true, cached: 0, message: "该公告无公开直链附件。" });

        const bjNow = new Date(Date.now() + 8 * 3600 * 1000);
        const daySlot = bjNow.toISOString().slice(8, 10); // 01..31 monthly rolling slot
        const expiresAt = new Date(Date.now() + 30 * 86400 * 1000).toISOString().replace("T", " ").slice(0, 19);
        const results = [];

        for (let i = 0; i < Math.min(atts.length, 8); i++) {
          const a = atts[i];
          if (!a?.url || !/^https?:\/\//i.test(a.url)) continue;
          const existing = db.prepare("SELECT * FROM notice_attachment_cache WHERE notice_id=? AND att_idx=? AND status='cached' AND expires_at > CURRENT_TIMESTAMP").get(noticeId, i);
          const freshness = existing && db.prepare(`SELECT 1 AS fresh FROM notice_meta m WHERE m.id=?
            AND julianday(?)>julianday('now','-7 days') AND coalesce(julianday(m.source_updated_at),0)<=julianday(?)
            AND NOT EXISTS(SELECT 1 FROM notice_attachment_retry WHERE notice_id=m.id AND att_idx=?)`).get(noticeId,existing.downloaded_at,existing.downloaded_at,i);
          if (existing && existing.source_url === a.url && freshness) {
            let readStatus = db.prepare("SELECT status FROM notice_attachment_document WHERE notice_id=? AND att_idx=? AND sha256=?").get(noticeId,i,existing.sha256)?.status;
            if (!readStatus || ["partial","failed","decode_failed"].includes(readStatus)) {
              try {
                const bytes = await cosGetObject(existing.cos_key,existing.sha256);
                readStatus = await indexAttachment(db,{ noticeId,index:i,filename:existing.filename,url:a.url,bytes,mime:existing.mime_type });
              } catch { readStatus = "failed"; }
            }
            results.push({ readStatus, id: existing.id, attIdx: i, filename: existing.filename, sizeBytes: existing.size_bytes, expiresAt: existing.expires_at, cached: true });
            continue;
          }
          try {
            const upstream = await fetchPublic(a.url, { signal: AbortSignal.timeout(15000), maxBytes: 25 * 1024 * 1024 });
            const buf = await readAttachmentBytes(upstream);
            if (!buf.length || buf.length > 25 * 1024 * 1024) continue;
            const sha = digest(buf);
            const fname = (a.name || `attachment_${i + 1}`).replace(/[^\w.\-\u4e00-\u9fa5（）()《》]/g, "_").slice(0, 100);
            const extMatch = fname.match(/\.(pdf|docx?|xlsx?|zip|rar|png|jpe?g)$/i);
            const ext = extMatch ? extMatch[0].toLowerCase() : ".bin";
            const mimeMap = {
              ".pdf": "application/pdf",
              ".doc": "application/msword",
              ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              ".xls": "application/vnd.ms-excel",
              ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              ".zip": "application/zip",
              ".png": "image/png",
              ".jpg": "image/jpeg",
              ".jpeg": "image/jpeg",
            };
            const mimeType = mimeMap[ext] || upstream.headers.get("content-type") || "application/octet-stream";
            const attId = `natt_${noticeId}_${i}`;
            // Monthly rolling day slot: overwrites after 30 days automatically
            const cosKey = `${COS_SHARED_PREFIX}/notice-attachments/versions/${attId}/${sha}${ext}`;
            await cosPutVerified(cosKey, buf, mimeType, sha);
            db.prepare(`INSERT INTO notice_attachment_cache(id,notice_id,att_idx,filename,source_url,cos_key,mime_type,size_bytes,sha256,status,downloaded_at,expires_at)
              VALUES (?,?,?,?,?,?,?,?,?,'cached',CURRENT_TIMESTAMP,?)
              ON CONFLICT(notice_id,att_idx) DO UPDATE SET
                filename=excluded.filename, source_url=excluded.source_url, cos_key=excluded.cos_key,
                mime_type=excluded.mime_type, size_bytes=excluded.size_bytes, sha256=excluded.sha256,
                status='cached', downloaded_at=CURRENT_TIMESTAMP, expires_at=excluded.expires_at`)
              .run(attId, noticeId, i, a.name || fname, a.url, cosKey, mimeType, buf.length, sha, expiresAt);
            const readStatus = await indexAttachment(db,{ noticeId,index:i,filename:a.name || fname,url:a.url,bytes:buf,mime:mimeType });
            db.prepare("DELETE FROM notice_attachment_retry WHERE notice_id=? AND att_idx=?").run(noticeId,i);
            results.push({ readStatus, id: attId, attIdx: i, filename: a.name || fname, sizeBytes: buf.length, expiresAt, cached: true });
          } catch {
            db.prepare("INSERT OR REPLACE INTO notice_attachment_retry VALUES(?,?,?,datetime('now','+6 hours'),'fetch_or_archive_failed')").run(noticeId,i,a.url);
          }
        }
        audit(user.id, "公告附件入桶(30天周期)", `${noticeId}/${results.length}个附件`, "已记录");
        const complete = results.length === atts.length && results.every(item=>item.readStatus === "text");
        return json({ ok: complete, status: complete ? "complete" : "partial", cachedCount: results.length, total: atts.length, items: results });
      }

      const lotFileMatch = pathname.match(/^\/api\/opportunities\/(\d+)\/files$/);
      if (lotFileMatch) {
        if (!allowRate(`upload:${user.id}`, 30, 60_000)) {
          return json({ message: "上传过于频繁，请稍后重试。" }, 429);
        }
        const noticeId = lotFileMatch[1];
        if (!visible(user.id, noticeId)) return missing();
        const slotKey = ["doc_buy", "prep", "opening_sheet"].includes(body.slot) ? body.slot : "opening_sheet";
        const filename = typeof body.filename === "string" ? body.filename.trim().slice(0, 120) : "record.pdf";
        const rawB64 = typeof body.dataBase64 === "string" ? body.dataBase64.replace(/^data:[^;]+;base64,/, "") : "";
        if (!rawB64) return invalid("请提供有效文件内容。");
        const buf = Buffer.from(rawB64, "base64");
        if (!buf.length || buf.length > 10 * 1024 * 1024) return invalid("附件大小须在 1B–10MB 之间。");

        let mimeType = "";
        if (buf.subarray(0, 5).toString("ascii") === "%PDF-") mimeType = "application/pdf";
        else if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) mimeType = "image/png";
        else if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) mimeType = "image/jpeg";
        else return invalid("仅支持 PDF、PNG 或 JPG 格式。");

        const reqCo = typeof body.companyId === "string" ? body.companyId.trim() : "";
        const fallbackCo = db.prepare("SELECT company FROM grant_company WHERE employee=? AND edit=1 LIMIT 1").get(user.id)?.company || db.prepare("SELECT id FROM company LIMIT 1").get()?.id || "";
        const companyId = reqCo || fallbackCo;
        if (!companyId || !grant(user.id, companyId)?.edit) {
          return denied(user.id, "上传标段流程附件", companyId || noticeId);
        }
        if (!getCosCredentials()) {
          return json({ message: "尚未配置腾讯云 COS 密钥（TOUBIAO_COS_SECRET_ID / TOUBIAO_COS_SECRET_KEY）。" }, 503);
        }
        const fileId = `fil_${randomUUID().slice(0, 12)}`;
        const sha = digest(buf);
        const ext = mimeType === "application/pdf" ? ".pdf" : mimeType === "image/png" ? ".png" : ".jpg";
        const cosKey = `${COS_SHARED_PREFIX}/company-files/${companyId}/${fileId}${ext}`;
        await cosPutVerified(cosKey, buf, mimeType, sha);

        transaction(db, () => {
          db.prepare(`INSERT INTO company_file(id,company_id,owner_type,owner_id,filename,mime_type,size_bytes,sha256,bytes,storage_backend,cos_key,uploaded_by)
            VALUES (?,?,'doc',?,?,?,?,?,?, 'cos', ?, ?)`).run(fileId, companyId, `lot_${noticeId}_${slotKey}`, filename, mimeType, buf.length, sha, Buffer.alloc(0), cosKey, user.id);
          const ex = db.prepare("SELECT notice_id FROM lot_workflow WHERE notice_id=?").get(noticeId);
          if (!ex) {
            db.prepare("INSERT INTO lot_workflow(notice_id,company_id,active_step,updated_by,updated_by_name) VALUES (?,?,1,?,?)")
              .run(noticeId, companyId, user.id, user.name);
          }
          if (slotKey === "doc_buy") {
            db.prepare("UPDATE lot_workflow SET doc_buy_file_id=?, doc_buy_file_name=?, updated_by=?, updated_by_name=?, updated_at=CURRENT_TIMESTAMP WHERE notice_id=?")
              .run(fileId, filename, user.id, user.name, noticeId);
          } else if (slotKey === "prep") {
            db.prepare("UPDATE lot_workflow SET prep_file_id=?, prep_file_name=?, updated_by=?, updated_by_name=?, updated_at=CURRENT_TIMESTAMP WHERE notice_id=?")
              .run(fileId, filename, user.id, user.name, noticeId);
          } else {
            db.prepare("UPDATE lot_workflow SET opening_sheet_file_id=?, opening_sheet_file_name=?, updated_by=?, updated_by_name=?, updated_at=CURRENT_TIMESTAMP WHERE notice_id=?")
              .run(fileId, filename, user.id, user.name, noticeId);
          }
          audit(user.id, "上传标段流程原件", `${noticeId}/${slotKey}/${filename}(COS)`, "已记录");
        });
        return json({ ok: true, fileId, filename, slot: slotKey });
      }

      if (pathname === "/api/finance") {
        const noticeId = typeof body.noticeId === "string" ? body.noticeId.trim() : "";
        if (!noticeId || !visible(user.id, noticeId)) return invalid("请选择有效的已选定标段。");
        const companyId = typeof body.companyId === "string" ? body.companyId.trim() : "";
        if (!lotWriteAllowed(user, noticeId, companyId)) return denied(user.id, "登记资金流水", companyId || noticeId);
        const category = ["deposit", "guarantee", "expense", "performance_cash", "performance_guarantee"].includes(body.category) ? body.category : "deposit";
        const entryType = ["paid", "refund_received", "non_refund_deduct", "in_transit", "transfer_in", "transfer_out", "guarantee_face", "urge"].includes(body.entryType) ? body.entryType : "paid";
        const amountYuan = Number(body.amountYuan ?? 0);
        if (Number.isNaN(amountYuan) || amountYuan < 0 || amountYuan > 1e11) return invalid("金额格式有误，请输入非负元数值。");
        const amountFen = Math.round(amountYuan * 100);
        const note = typeof body.note === "string" ? body.note.trim().slice(0, 300) : "";
        if (entryType === "non_refund_deduct" && !note) return invalid("登记「非退款核减」属于高风险操作，必须填写原因并留痕。");
        const lotRound = typeof body.lotRound === "string" && body.lotRound.trim() ? body.lotRound.trim().slice(0, 60) : "默认标段 · 第1轮";
        const payStatus = typeof body.payStatus === "string" ? body.payStatus.trim().slice(0, 30) : "已扣款";
        const receiveStatus = typeof body.receiveStatus === "string" ? body.receiveStatus.trim().slice(0, 30) : "未标注";
        const refundCond = typeof body.refundCond === "string" ? body.refundCond.trim().slice(0, 30) : "未核实";
        const refundStatus = typeof body.refundStatus === "string" ? body.refundStatus.trim().slice(0, 30) : "未申请";
        const disputeStatus = typeof body.disputeStatus === "string" ? body.disputeStatus.trim().slice(0, 30) : "无争议";
        const dueDate = typeof body.dueDate === "string" ? body.dueDate.trim().slice(0, 20) : "";
        const fid = `fin_${randomUUID().slice(0, 10)}`;
        const saved = transaction(db, () => {
          if (body.quickBalance) {
            const groups = db.prepare(`SELECT category, lot_round,
                sum(CASE WHEN entry_type='paid' THEN amount_fen WHEN entry_type IN ('refund_received','non_refund_deduct') THEN -amount_fen ELSE 0 END) AS balance
              FROM finance_entry WHERE notice_id=? AND company_id=? AND category IN ('deposit','performance_cash') AND reversed=0
              GROUP BY category,lot_round`).all(noticeId, companyId);
            if (groups.length !== 1 || groups[0].category !== category || groups[0].lot_round !== lotRound ||
                groups[0].balance !== amountFen || amountFen <= 0) return false;
          }
          db.prepare(`INSERT INTO finance_entry(id,notice_id,company_id,lot_round,category,entry_type,amount_fen,pay_status,receive_status,refund_cond,refund_status,dispute_status,due_date,note,actor,actor_name)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
            .run(fid, noticeId, companyId, lotRound, category, entryType, amountFen, payStatus, receiveStatus, refundCond, refundStatus, disputeStatus, dueDate, note, user.id, user.name);
          audit(user.id, entryType === "urge" ? "登记催退记录" : entryType === "non_refund_deduct" ? "非退款核减" : "登记资金流水", `${noticeId}/${entryType}/${(amountFen / 100).toFixed(2)}元`, "已记录");
          return true;
        });
        if (!saved) return json({ message: "资金余额或归属已变化，请刷新后核对分笔流水。" }, 409);
        return json({ id: fid, ok: true });
      }

      const finRevMatch = pathname.match(/^\/api\/finance\/([a-zA-Z0-9_-]+)\/reverse$/);
      if (finRevMatch) {
        const fid = finRevMatch[1];
        const row = db.prepare("SELECT * FROM finance_entry WHERE id=?").get(fid);
        if (!row || !visible(user.id, row.notice_id)) return missing();
        const canReverse = row.company_id
          ? (grant(user.id, row.company_id)?.verify || grant(user.id, row.company_id)?.edit)
          : row.actor === user.id && lotWriteAllowed(user, row.notice_id);
        if (!canReverse) return denied(user.id, "冲销资金流水", row.company_id || fid);
        const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 200) : "";
        if (!reason) return invalid("冲销流水属于高风险操作，必须填写原因，历史记录将保留不删除。");
        transaction(db, () => {
          db.prepare("UPDATE finance_entry SET reversed=1, reverse_reason=? WHERE id=?").run(reason, fid);
          audit(user.id, "冲销资金流水", `${fid}：${reason}`, "已记录");
        });
        return json({ ok: true });
      }

      // 12. Opening Return (开标回传)
      if (pathname === "/api/opening") {
        const noticeId = typeof body.noticeId === "string" ? body.noticeId.trim() : "";
        if (!noticeId || !visible(user.id, noticeId)) return invalid("请选择有效的已选定标段。");
        if (!lotWriteAllowed(user, noticeId)) return denied(user.id, "记录开标回传", noticeId);
        const openMode = ["现场", "远程", "混合", "未标注"].includes(body.openMode) ? body.openMode : "未标注";
        const venue = typeof body.venue === "string" ? body.venue.trim().slice(0, 200) : "";
        const arriveTime = typeof body.arriveTime === "string" ? body.arriveTime.trim().slice(0, 40) : "";
        const contact = typeof body.contact === "string" ? body.contact.trim().slice(0, 80) : "";
        const materialsVer = typeof body.materialsVer === "string" ? body.materialsVer.trim().slice(0, 80) : "";
        const note = typeof body.note === "string" ? body.note.trim().slice(0, 400) : "";
        const photoData = typeof body.photoData === "string" && body.photoData.startsWith("data:image/") ? body.photoData.slice(0, 4_500_000) : "";
        const bids = Array.isArray(body.bids) ? body.bids.slice(0, 60).map((b) => ({
          bidder: String(b.bidder || "").trim().slice(0, 100),
          amountYuan: b.amountYuan === "" || b.amountYuan === null || b.amountYuan === undefined ? null : Number(b.amountYuan),
          isOurs: !!b.isOurs,
          remark: String(b.remark || "").trim().slice(0, 120),
        })).filter((b) => b.bidder) : [];
        const flags = Array.isArray(body.qualityFlags) ? body.qualityFlags.map((x) => String(x).slice(0, 40)).slice(0, 10) : [];

        // Auto-detect unit mismatch (e.g., 万元 vs 元) against notice budget if available
        const meta = db.prepare("SELECT budget_yuan FROM notice_meta WHERE id=?").get(noticeId);
        if (meta?.budget_yuan && meta.budget_yuan > 0) {
          for (const b of bids) {
            if (b.amountYuan !== null && b.amountYuan > 0) {
              const ratio = b.amountYuan / meta.budget_yuan;
              if (ratio < 0.01 || ratio > 100) {
                if (!flags.includes("单位疑似错位")) flags.push("单位疑似错位");
              }
            }
          }
        }
        const prev = db.prepare("SELECT max(version) AS v FROM opening_record WHERE notice_id=?").get(noticeId);
        const version = (prev?.v || 0) + 1;
        const oid = `opn_${randomUUID().slice(0, 10)}`;
        transaction(db, () => {
          db.prepare(`INSERT INTO opening_record(id,notice_id,version,open_mode,venue,arrive_time,contact,materials_ver,bids_json,photo_data,quality_flags,verified,note,actor,actor_name)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
            .run(oid, noticeId, version, openMode, venue, arriveTime, contact, materialsVer, JSON.stringify(bids), photoData, JSON.stringify(flags), body.verified ? 1 : 0, note, user.id, user.name);
          audit(user.id, "登记开标回传", `${noticeId}/v${version}/${openMode}`, "已记录");
        });
        return json({ id: oid, version, flags, ok: true });
      }

      // 13. Bid Estimation / Result Forecast (评标测算 / 结果预估)
      if (pathname === "/api/estimates") {
        const noticeId = typeof body.noticeId === "string" ? body.noticeId.trim() : "";
        if (!noticeId || !visible(user.id, noticeId)) return invalid("请选择有效的标段。");
        if (!lotWriteAllowed(user, noticeId)) return denied(user.id, "登记评标测算", noticeId);
        const ruleName = typeof body.ruleName === "string" && body.ruleName.trim() ? body.ruleName.trim().slice(0, 60) : "合成基准价法";
        const params = body.params && typeof body.params === "object" ? body.params : {};
        const snapshot = Array.isArray(body.snapshot) ? body.snapshot.slice(0, 60) : [];
        const result = body.result && typeof body.result === "object" ? body.result : {};
        const note = typeof body.note === "string" ? body.note.trim().slice(0, 300) : "";
        const prev = db.prepare("SELECT max(version) AS v FROM bid_estimate WHERE notice_id=?").get(noticeId);
        const version = (prev?.v || 0) + 1;
        const eid = `est_${randomUUID().slice(0, 10)}`;
        transaction(db, () => {
          db.prepare(`INSERT INTO bid_estimate(id,notice_id,version,rule_name,params_json,snapshot_json,result_json,note,actor,actor_name)
            VALUES (?,?,?,?,?,?,?,?,?,?)`)
            .run(eid, noticeId, version, ruleName, JSON.stringify(params), JSON.stringify(snapshot), JSON.stringify(result), note, user.id, user.name);
          audit(user.id, "保存评标测算版本", `${noticeId}/v${version}/${ruleName}`, "已记录");
        });
        return json({ id: eid, version, ok: true });
      }

      // 15. Schedule & Delegate Trip Conflict Management (/api/schedules)
      if (pathname === "/api/schedules") {
        const noticeId = typeof body.noticeId === "string" ? body.noticeId.trim() : "";
        if (!noticeId || !visible(user.id, noticeId)) return invalid("请选择有效的已选定标段。");
        const companyId = typeof body.companyId === "string" ? body.companyId.trim() : "";
        if (!lotWriteAllowed(user, noticeId, companyId)) return denied(user.id, "登记开标日程", companyId || noticeId);
        const openMode = ["现场", "远程", "混合", "未标注"].includes(body.openMode) ? body.openMode : "未标注";
        const submitTime = typeof body.submitTime === "string" ? body.submitTime.trim().slice(0, 30) : "";
        const decryptWindow = typeof body.decryptWindow === "string" ? body.decryptWindow.trim().slice(0, 60) : "";
        const openTime = typeof body.openTime === "string" ? body.openTime.trim().slice(0, 30) : "";
        const venue = typeof body.venue === "string" ? body.venue.trim().slice(0, 200) : "";
        const delegateId = typeof body.delegateId === "string" && body.delegateId.trim() ? body.delegateId.trim() : null;
        if (delegateId && !employee(delegateId)) return invalid("所选委托人不存在。");
        const departAt = typeof body.departAt === "string" ? body.departAt.trim().slice(0, 30) : "";
        const untilAt = typeof body.untilAt === "string" ? body.untilAt.trim().slice(0, 30) : "";
        if (departAt && untilAt && departAt > untilAt) return invalid("行程出发时间不能晚于结束时间。");
        const note = typeof body.note === "string" ? body.note.trim().slice(0, 300) : "";
        const sid = typeof body.id === "string" && body.id.trim() ? body.id.trim() : `sch_${randomUUID().slice(0, 10)}`;
        const existing = db.prepare("SELECT notice_id, company_id, updated_by FROM bid_schedule WHERE id=?").get(sid);
        if (existing && (existing.notice_id !== noticeId || !lotWriteAllowed(user, noticeId, existing.company_id) ||
            (!existing.company_id && existing.updated_by !== user.id && user.role !== "admin"))) return forbidden();
        transaction(db, () => {
          if (existing) {
            db.prepare(`UPDATE bid_schedule SET notice_id=?,company_id=?,open_mode=?,submit_time=?,decrypt_window=?,open_time=?,venue=?,delegate_id=?,depart_at=?,until_at=?,note=?,version=version+1,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
              .run(noticeId, companyId, openMode, submitTime, decryptWindow, openTime, venue, delegateId, departAt, untilAt, note, user.id, sid);
          } else {
            db.prepare(`INSERT INTO bid_schedule(id,notice_id,company_id,open_mode,submit_time,decrypt_window,open_time,venue,delegate_id,depart_at,until_at,note,version,updated_by)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?)`)
              .run(sid, noticeId, companyId, openMode, submitTime, decryptWindow, openTime, venue, delegateId, departAt, untilAt, note, user.id);
          }
          audit(user.id, "登记开标日程与行程", `${noticeId}/${openMode}`, "已记录");
        });
        return json({ id: sid, ok: true });
      }

      // 16. Results, Notice Letter, Contract & Handover (/api/outcomes)
      if (pathname === "/api/outcomes") {
        const noticeId = typeof body.noticeId === "string" ? body.noticeId.trim() : "";
        if (!noticeId || !visible(user.id, noticeId)) return invalid("请选择有效的已选定标段。");
        const companyId = typeof body.companyId === "string" ? body.companyId.trim() : "";
        if (!lotWriteAllowed(user, noticeId, companyId)) return denied(user.id, "更新结果与移交", companyId || noticeId);
        const candidateStatus = ["未标注", "第一候选人", "第二候选人", "第三候选人", "未入围", "公示异议中"].includes(body.candidateStatus) ? body.candidateStatus : "未标注";
        const finalResult = ["未标注", "中标", "未中标", "流标或终止"].includes(body.finalResult) ? body.finalResult : "未标注";
        const awardYuan = body.awardAmountYuan !== "" && body.awardAmountYuan !== null && body.awardAmountYuan !== undefined ? Number(body.awardAmountYuan) : null;
        const awardFen = awardYuan !== null && !Number.isNaN(awardYuan) && awardYuan >= 0 ? Math.round(awardYuan * 100) : null;
        const noticeLetterStatus = ["未下达", "已下达待签收", "已签收"].includes(body.noticeLetterStatus) ? body.noticeLetterStatus : "未下达";
        const noticeLetterDate = typeof body.noticeLetterDate === "string" ? body.noticeLetterDate.trim().slice(0, 20) : "";
        const guaranteeStatus = ["未标注", "免缴(附依据)", "履约保函已办", "履约现金已缴"].includes(body.guaranteeStatus) ? body.guaranteeStatus : "未标注";
        const contractStatus = ["未签署", "审核中", "已签署", "已移交启动"].includes(body.contractStatus) ? body.contractStatus : "未签署";
        const handoverTo = typeof body.handoverTo === "string" ? body.handoverTo.trim().slice(0, 80) : "";
        const note = typeof body.note === "string" ? body.note.trim().slice(0, 300) : "";
        const oid = `out_${randomUUID().slice(0, 10)}`;
        transaction(db, () => {
          db.prepare(`INSERT INTO bid_outcome(id,notice_id,company_id,candidate_status,final_result,award_amount_fen,notice_letter_status,notice_letter_date,guarantee_status,contract_status,handover_to,note,updated_by,updated_by_name,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
            ON CONFLICT(notice_id,company_id) DO UPDATE SET
              candidate_status=excluded.candidate_status, final_result=excluded.final_result,
              award_amount_fen=excluded.award_amount_fen, notice_letter_status=excluded.notice_letter_status,
              notice_letter_date=excluded.notice_letter_date, guarantee_status=excluded.guarantee_status,
              contract_status=excluded.contract_status, handover_to=excluded.handover_to,
              note=excluded.note, updated_by=excluded.updated_by, updated_by_name=excluded.updated_by_name,
              updated_at=CURRENT_TIMESTAMP`)
            .run(oid, noticeId, companyId, candidateStatus, finalResult, awardFen, noticeLetterStatus, noticeLetterDate, guaranteeStatus, contractStatus, handoverTo, note, user.id, user.name);
          audit(user.id, "更新结果与合同移交", `${noticeId}/${finalResult}/${contractStatus}`, "已记录");
        });
        return json({ ok: true });
      }

      // 14. TokenHub AI Chat Proxy (/api/ai/chat) — key stays strictly server-side
      if (pathname === "/api/ai/chat") {
        if (!allowRate(`ai:${user.id}`, 30, 60_000)) {
          return json({ message: "AI 请求过于频繁，请稍后重试。" }, 429);
        }
        const { baseUrl, apiKey, defaultModel } = getAiConfig();
        if (!apiKey) {
          return json({ message: "服务端尚未配置江苏 TokenHub 密钥。请管理员前往「系统设置」填写 API Key 后即可使用。" }, 503);
        }
        const rawMsgs = Array.isArray(body.messages) ? body.messages : [];
        const userMsgs = rawMsgs
          .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
          .slice(-12)
          .map((m) => ({ role: m.role, content: m.content.trim().slice(0, 4000) }));
        if (!userMsgs.length) return invalid("请输入需要 AI 协助的问题或指令。");

        const model = typeof body.model === "string" && body.model.trim() ? body.model.trim().slice(0, 80) : defaultModel;
        const noticeId = typeof body.noticeId === "string" ? body.noticeId.trim() : "";

        let systemPrompt = [
          "你是投标雷达内置的招投标 AI 辅助助手。",
          "严格遵守以下底线：",
          "1. 仅基于用户提供的内容或下附官方公告原文进行分析与起草，严禁猜测或编造原文未载的金额、日期、资质等级、保证金或评标细则；",
          "2. 原文未提及或信息不足的项目，必须明确标注「详见原文条款」；",
          "3. 不使用「合格」「完整」「通过」等跨维度总结论，改用「满足」「不满足」「未标注」「待补」；",
          "4. 所有日期时间标注北京时间，金额标注元并保留两位小数；",
          "5. 你的输出属于「AI 辅助草稿 · 待人工核实」，不得替代人工审核与正式决策。",
        ].join("\n");

        if (noticeId) {
          const nRow = visible(user.id, noticeId);
          if (nRow) {
            const nd = JSON.parse(nRow.data);
            const snippet = String(nd.body || "").slice(0, 10000);
            systemPrompt += `\n\n【当前关联官方公告参考（原文值）】\n标题：${nd.title || ""}\n来源：${nd.source || ""}\n地区：${nd.region || "未标注"} | 行业：${nd.tradeType || "未标注"} | 阶段：${nd.stageLabel || "未标注"}\n招标人：${nd.tenderer || "未标注"} | 代理：${nd.agency || "未标注"}\n预算：${nd.budgetText || "原文未载"} | 截止：${nd.deadlineText || "原文未载"}\n保证金：${nd.depositText || "原文未载"} | 评标办法：${nd.evalMethod || "原文未载"}\n正文节选：\n${snippet || "（正文未完整缓存，请提醒用户核查官方原文）"}`;
          }
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 55000);
        try {
          const upstream = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model,
              messages: [{ role: "system", content: systemPrompt }, ...userMsgs],
              temperature: 0.2,
              stream: false,
            }),
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (!upstream.ok) {
            const errTxt = (await upstream.text().catch(() => "")).slice(0, 200);
            audit(user.id, "AI辅助调用", `${model}${noticeId ? "/" + noticeId : ""}`, `上游异常(${upstream.status})`);
            return json({ message: `TokenHub 接口返回异常（HTTP ${upstream.status}）：${errTxt || "请检查模型名称或配额"}` }, 502);
          }
          const data = await upstream.json();
          const content = data?.choices?.[0]?.message?.content ?? "";
          audit(user.id, "AI辅助调用", `${model}${noticeId ? "/" + noticeId : ""}`, "已记录");
          return json({
            ok: true,
            model: data?.model || model,
            content,
            usage: data?.usage || null,
            noticeId: noticeId || null,
          });
        } catch (err) {
          clearTimeout(timer);
          const isAbort = err?.name === "AbortError";
          audit(user.id, "AI辅助调用", `${model}${noticeId ? "/" + noticeId : ""}`, isAbort ? "请求超时" : "网络异常");
          return json({ message: isAbort ? "TokenHub 接口响应超时（55 秒），请稍后重试或缩短输入。" : "无法连接 TokenHub 服务，请检查网络或配置。" }, 504);
        }
      }

      // 17. Matrix cell human verification (Requirements x Companies)
      if (pathname === "/api/matrix/verify") {
        const noticeId = typeof body.noticeId === "string" ? body.noticeId.trim() : "";
        const reqKey = typeof body.reqKey === "string" ? body.reqKey.trim().slice(0, 40) : "";
        const companyId = typeof body.companyId === "string" ? body.companyId.trim() : "";
        if (companyId && !grant(user.id, companyId)?.edit) return denied(user.id, "核实资格矩阵", companyId);
        const status = ["conform", "non_conform", "na", "pending", "missing"].includes(body.status) ? body.status : "pending";
        const basis = typeof body.basis === "string" ? body.basis.trim().slice(0, 300) : "";
        if (!noticeId || !reqKey || !companyId || !visible(user.id, noticeId)) return invalid("请提供有效的标段、要求项与公司。");
        if (!grant(user.id, companyId)?.verify) return denied(user.id, "核实资格匹配项", `${noticeId}/${companyId}`);
        if (["conform","non_conform","na"].includes(status) && !basis) {
          return invalid("请填写支持这项结论的公告条款或档案依据。");
        }
        const evidence = getNoticeEvidence(noticeId,JSON.parse(visible(user.id,noticeId).data),user.id);
        const inputs = companyMatch(noticeId,companyId,evidence);
        if (!inputs.results.requirements.some(r=>r.key===reqKey)) return invalid("公告要求项已变化，请重新打开比对。");
        if (body.fingerprint !== inputs.fingerprint) return json({ message:"公告或公司资料已变化，请刷新后核实。" },409);
        transaction(db, () => {
          db.prepare(`INSERT INTO lot_matrix_cell(notice_id,req_key,company_id,status,basis,updated_by,updated_by_name,updated_at)
            VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
            ON CONFLICT(notice_id,req_key,company_id) DO UPDATE SET
              status=excluded.status, basis=excluded.basis, updated_by=excluded.updated_by,
              updated_by_name=excluded.updated_by_name, updated_at=CURRENT_TIMESTAMP`)
            .run(noticeId, reqKey, companyId, status, basis, user.id, user.name);
          db.prepare("INSERT OR REPLACE INTO qualification_review_basis VALUES(?,?,?,?)").run(noticeId,companyId,reqKey,inputs.fingerprint);
          audit(user.id, "核实资格矩阵", `${noticeId}/${companyId}/${reqKey}/${status}`, "已记录");
        });
        return json({ ok: true });
      }

      // 18. Save loss reason & retrospective review note on a bid project
      if (pathname === "/api/analytics/review/tag") {
        const noticeId = typeof body.noticeId === "string" ? body.noticeId.trim() : "";
        const lossReason = typeof body.lossReason === "string" ? body.lossReason.trim().slice(0, 60) : "";
        const reviewNote = typeof body.reviewNote === "string" ? body.reviewNote.trim().slice(0, 400) : "";
        if (!noticeId || !visible(user.id, noticeId)) return invalid("请提供有效的项目标段。");
        transaction(db, () => {
          db.prepare(`INSERT INTO lot_workflow(notice_id, loss_reason, review_note, updated_by, updated_by_name, updated_at)
            VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)
            ON CONFLICT(notice_id) DO UPDATE SET
              loss_reason=excluded.loss_reason, review_note=excluded.review_note,
              updated_by=excluded.updated_by, updated_by_name=excluded.updated_by_name, updated_at=CURRENT_TIMESTAMP`)
            .run(noticeId, lossReason, reviewNote, user.id, user.name);
          audit(user.id, "更新投标复盘归因", `${noticeId}/${lossReason || "备注"}`, "已记录");
        });
        return json({ ok: true });
      }

      // 19A. Preview/Parse external URL & check duplicates in Opportunity Pool before creating
      if (pathname === "/api/projects/parse-url") {
        const rawUrl = typeof body.url === "string" ? body.url.trim() : "";
        let parsedUrl;
        try {
          parsedUrl = new URL(rawUrl);
        } catch {
          return invalid("请粘贴有效的 http:// 或 https:// 招标公告网页链接。");
        }
        if (!["http:", "https:"].includes(parsedUrl.protocol)) {
          return invalid("仅支持 http 或 https 协议的网页链接。");
        }
        const hostLower = parsedUrl.hostname.toLowerCase();
        if (
          hostLower === "localhost" || hostLower.endsWith(".local") || hostLower.endsWith(".internal") ||
          /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.|::1|fc|fd|fe80)/.test(hostLower)
        ) {
          return invalid("安全拦截：不允许抓取内网或本机地址，请粘贴公网招标交易平台链接。");
        }

        const manualBody = typeof body.bodyText === "string" ? body.bodyText.trim().slice(0, 30000) : "";
        let html = "";
        let fetchWarning = "";
        if (!manualBody) {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 14000);
          try {
            const resp = await fetchPublic(rawUrl, {
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "zh-CN,zh;q=0.9",
              },
              signal: controller.signal,
            });
            clearTimeout(timer);
            if (!resp.ok) {
              fetchWarning = `目标站点返回 HTTP ${resp.status}`;
            } else {
              const buf = Buffer.from(await resp.arrayBuffer());
              const ct = (resp.headers.get("content-type") || "").toLowerCase();
              const isGbk = ct.includes("gbk") || ct.includes("gb2312") || /charset=["']?gb(k|2312|18030)/i.test(buf.slice(0, 2048).toString("latin1"));
              html = isGbk ? new TextDecoder("gb18030", { fatal: false }).decode(buf) : buf.toString("utf8");
            }
          } catch (err) {
            fetchWarning = err?.name === "AbortError" ? "目标网页抓取超时（14秒）" : `网页抓取受限（${err?.message || "网络异常"}）`;
          } finally {
            clearTimeout(timer);
          }
        }

        const ext = extractSmartNoticeFromHtml(html, rawUrl, manualBody);
        if (ext.titleLooksLikeSite && !fetchWarning) {
          fetchWarning = "该网页为前端动态渲染或标题仅为网站名称，未能自动提取到真实项目名称，请手动粘贴项目名称或公告正文。";
        }
        const matchedOpportunities = findMatchingOpportunities(db, user.id, {
          url: rawUrl,
          projectKey: ext.projectKey,
          title: ext.title || (typeof body.title === "string" ? body.title.trim() : ""),
        });

        return json({
          ok: true,
          parsed: {
            url: rawUrl,
            title: ext.title,
            titleLooksLikeSite: ext.titleLooksLikeSite,
            tenderer: ext.tenderer,
            agency: ext.agency,
            projectKey: ext.projectKey,
            budgetYuan: ext.budgetYuan,
            budgetText: ext.budgetText,
            deadlineText: ext.deadlineText,
            tradeType: ext.tradeType,
            region: ext.region,
            attachmentCount: ext.attachments.length,
            bodyPreview: ext.bodyText.slice(0, 800),
          },
          matchedOpportunities,
          fetchWarning,
        });
      }

      // 19B. Import external tender notice by pasting web URL into Project Library (with dedup link-to-existing)
      if (pathname === "/api/projects/import-url") {
        const decision = body.decision === "watching" ? "watching" : "bidding";
        const companyId = typeof body.companyId === "string" ? body.companyId.trim() : "";
        const note = typeof body.note === "string" ? body.note.trim().slice(0, 300) : "通过网页链接粘贴录入";
        const existingNoticeId = typeof body.existingNoticeId === "string" ? body.existingNoticeId.trim() : "";

        // If user chose to link an existing opportunity already in the pool, just follow it!
        if (existingNoticeId) {
          const ex = db.prepare("SELECT id, title, project_key FROM notice_meta WHERE id=?").get(existingNoticeId);
          if (!ex || !visible(user.id, existingNoticeId)) return missing();
          if (!lotWriteAllowed(user, existingNoticeId, companyId)) return denied(user.id, "关联项目入库", existingNoticeId);
          transaction(db, () => {
            db.prepare(`INSERT INTO project_follow(notice_id,project_key,decision,assignee,note,updated_by,updated_at)
              VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)
              ON CONFLICT(notice_id) DO UPDATE SET decision=excluded.decision, note=excluded.note, updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP`)
              .run(ex.id, ex.project_key, decision, user.id, note, user.id);
            if (companyId) {
              db.prepare(`INSERT INTO lot_workflow(notice_id,company_id,active_step,updated_by,updated_by_name,updated_at)
                VALUES (?,?,1,?,?,CURRENT_TIMESTAMP)
                ON CONFLICT(notice_id) DO UPDATE SET company_id=excluded.company_id`)
                .run(ex.id, companyId, user.id, user.name);
            }
            audit(user.id, "关联机会池已有项目入库", `${ex.id}/${decision}`, "已去重关联");
          });
          return json({ ok: true, id: ex.id, title: ex.title, existed: true, message: "已直接将机会池中的原标段转入项目库，未产生重复记录。" });
        }

        if (!lotWriteAllowed(user, "", companyId)) return denied(user.id, "录入项目", companyId);
        const rawUrl = typeof body.url === "string" ? body.url.trim() : "";
        let parsedUrl;
        try {
          parsedUrl = new URL(rawUrl);
        } catch {
          return invalid("请粘贴有效的 http:// 或 https:// 招标公告网页链接。");
        }
        if (!["http:", "https:"].includes(parsedUrl.protocol)) {
          return invalid("仅支持 http 或 https 协议的网页链接。");
        }
        const hostLower = parsedUrl.hostname.toLowerCase();
        if (
          hostLower === "localhost" || hostLower.endsWith(".local") || hostLower.endsWith(".internal") ||
          /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.|::1|fc|fd|fe80)/.test(hostLower)
        ) {
          return invalid("安全拦截：不允许抓取内网或本机地址，请粘贴公网招标交易平台链接。");
        }

        const manualTitle = typeof body.title === "string" ? body.title.trim().slice(0, 180) : "";
        const manualTenderer = typeof body.tenderer === "string" ? body.tenderer.trim().slice(0, 120) : "";
        const manualBudgetYuan = Number(body.budgetYuan || 0) || 0;
        const manualDeadline = typeof body.deadlineText === "string" ? body.deadlineText.trim().slice(0, 40) : "";
        const manualTradeType = typeof body.tradeType === "string" ? body.tradeType.trim().slice(0, 40) : "";
        const manualRegion = typeof body.region === "string" ? body.region.trim().slice(0, 40) : "";
        const manualBody = typeof body.bodyText === "string" ? body.bodyText.trim().slice(0, 30000) : "";
        const forceCreate = body.forceCreate === true || body.forceCreate === "1";

        let html = "";
        let fetchWarning = "";
        if (!manualBody && !manualTitle) {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 14000);
          try {
            const resp = await fetchPublic(rawUrl, {
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "zh-CN,zh;q=0.9",
              },
              signal: controller.signal,
            });
            clearTimeout(timer);
            if (!resp.ok) fetchWarning = `目标站点返回 HTTP ${resp.status}`;
            else {
              const buf = Buffer.from(await resp.arrayBuffer());
              const ct = (resp.headers.get("content-type") || "").toLowerCase();
              const isGbk = ct.includes("gbk") || ct.includes("gb2312") || /charset=["']?gb(k|2312|18030)/i.test(buf.slice(0, 2048).toString("latin1"));
              html = isGbk ? new TextDecoder("gb18030", { fatal: false }).decode(buf) : buf.toString("utf8");
            }
          } catch (err) {
            fetchWarning = err?.name === "AbortError" ? "目标网页抓取超时（14秒）" : `网页抓取受限（${err?.message || "网络异常"}）`;
          } finally {
            clearTimeout(timer);
          }
        }

        const ext = extractSmartNoticeFromHtml(html, rawUrl, manualBody);
        const finalTitle = manualTitle || ext.title;
        if (!finalTitle || isLikelySiteNameTitle(finalTitle)) {
          return invalid("未能从该动态网页自动提取到真实项目名称（避免误存为网站名），请在「项目名称」栏填写该项目名称后再提交。");
        }

        const tenderer = manualTenderer || ext.tenderer;
        const agency = ext.agency;
        const projectKey = ext.projectKey || `EXT-${Date.now()}`;

        // Automatic dedup check against opportunity pool (URL / projectKey / normalized title)
        if (!forceCreate) {
          const matched = findMatchingOpportunities(db, user.id, { url: rawUrl, projectKey: ext.projectKey, title: finalTitle });
          const exact = matched.filter(item => item.matchReason === "官方链接完全一致");
          if (exact.length === 1) {
            const top = exact[0];
            transaction(db, () => {
              db.prepare(`INSERT INTO project_follow(notice_id,decision,assignee,note,updated_by,updated_at)
                VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)
                ON CONFLICT(notice_id) DO UPDATE SET decision=excluded.decision, note=excluded.note, updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP`)
                .run(top.id, decision, user.id, note, user.id);
              if (companyId) {
                db.prepare(`INSERT INTO lot_workflow(notice_id,company_id,active_step,updated_by,updated_by_name,updated_at)
                  VALUES (?,?,1,?,?,CURRENT_TIMESTAMP)
                  ON CONFLICT(notice_id) DO UPDATE SET company_id=excluded.company_id`)
                  .run(top.id, companyId, user.id, user.name);
              }
              audit(user.id, "粘贴链接自动匹配机会池已有项目", `${top.id}/${top.matchReason}`, "已去重转入项目库");
            });
            return json({
              ok: true,
              id: top.id,
              title: top.title,
              existed: true,
              matchReason: top.matchReason,
              message: `检测到机会池已收录该项目（${top.matchReason}），已直接将原标段转入项目库！`,
            });
          }
        }

        const budgetYuan = manualBudgetYuan || ext.budgetYuan;
        const budgetText = budgetYuan > 0 ? `${(budgetYuan / 10000).toFixed(2)}万元` : ext.budgetText;
        const deadlineText = manualDeadline || ext.deadlineText;
        let deadlineNs = 0;
        if (deadlineText) {
          const dt = Date.parse(deadlineText.replace(/-/g, "/") + " GMT+0800");
          if (Number.isFinite(dt) && dt > 0) deadlineNs = dt * 1_000_000;
        }
        const tradeType = manualTradeType || ext.tradeType;
        const region = manualRegion || ext.region;
        const nowNs = Date.now() * 1_000_000;
        const newId = String(Date.now());
        const sourceName = `外部链接录入(${parsedUrl.hostname})`;

        const noticeObj = {
          id: newId,
          title: finalTitle,
          source: sourceName,
          sourceKey: "manual_url",
          projectKey,
          stage: "tender",
          stageLabel: "招标公告",
          region,
          tradeType,
          category: tradeType,
          tenderer,
          agency,
          budgetYuan: budgetYuan || null,
          budgetText,
          published: String(nowNs),
          deadline: String(deadlineNs),
          deadlineText,
          url: rawUrl,
          body: ext.bodyText || `外部链接已收录：${rawUrl}${fetchWarning ? `\n（自动抓取提示：${fetchWarning}，请点击原站链接查看完整正文或手动补充）` : ""}`,
          attachments: ext.attachments,
          qualifications: [],
          qualTags: [],
          originalStatus: fetchWarning ? "manual_partial" : "captured",
          sourceUpdatedAt: new Date(Date.now() + 8 * 3600_000).toISOString().replace("T", " ").slice(0, 19),
        };

        transaction(db, () => {
          db.prepare("INSERT INTO notice(id,title,owner,draft,data) VALUES (?,?,NULL,0,?)")
            .run(newId, finalTitle, JSON.stringify(noticeObj));
          db.prepare(`
            INSERT INTO notice_meta(id,title,source,source_key,tenderer,agency,region,trade_type,category,stage,stage_label,project_key,published_ns,deadline_ns,deadline_text,budget_yuan,budget_text,qual_tags,eval_method,deposit_text,original_status,has_attachments,source_updated_at,url)
            VALUES (?,?,?,?,?,?,?,?,?,'tender','招标公告',?,?,?,?,?,?,'','','',?,?,?,?)
          `).run(
            newId, finalTitle, sourceName, "manual_url", tenderer, agency, region, tradeType, tradeType,
            projectKey, nowNs, deadlineNs, deadlineText, budgetYuan || null, budgetText,
            fetchWarning ? "manual_partial" : "captured", ext.attachments.length > 0 ? 1 : 0, noticeObj.sourceUpdatedAt, rawUrl,
          );
          db.prepare(`INSERT INTO project_follow(notice_id,decision,assignee,note,updated_by,updated_at)
            VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)`)
            .run(newId, decision, user.id, note, user.id);
          if (companyId) {
            db.prepare(`INSERT INTO lot_workflow(notice_id,company_id,active_step,updated_by,updated_by_name,updated_at)
              VALUES (?,?,1,?,?,CURRENT_TIMESTAMP)
              ON CONFLICT(notice_id) DO UPDATE SET company_id=excluded.company_id`)
              .run(newId, companyId, user.id, user.name);
          }
          audit(user.id, "粘贴链接录入项目库", `${newId}/${parsedUrl.hostname}`, fetchWarning ? `已收录(${fetchWarning})` : "自动提取成功");
        });

        return json({
          ok: true,
          id: newId,
          title: finalTitle,
          tenderer,
          region,
          tradeType,
          budgetYuan,
          budgetText,
          deadlineText,
          attachmentCount: ext.attachments.length,
          fetchWarning,
        });
      }

      // 20. AI Recommended Float Rate for a Project Library item
      const aiFloatMatch = pathname.match(/^\/api\/projects\/(\d+)\/ai-float-recommend$/);
      if (aiFloatMatch) {
        const noticeId = aiFloatMatch[1];
        const noticeRow = visible(user.id, noticeId);
        if (!noticeRow) return missing();
        const parsed = JSON.parse(noticeRow.data);
        const ctrlYuan = Number(parsed.budgetYuan || 0);
        const refinedDist = refineDistrict(parsed.region, parsed.title, parsed.tenderer);
        const tradeType = parsed.tradeType || "工程建设";

        // Gather real historical paired samples from workspace.db for this district / trade / tenderer / tier
        const rawPairs = db.prepare(`
          SELECT t.project_key AS projectKey, r.title, t.tenderer, r.region, r.trade_type AS tradeType,
                 t.budget_yuan AS ctrlYuan, r.budget_yuan AS winYuan
          FROM notice_meta t
          JOIN notice_meta r ON r.project_key = t.project_key AND t.project_key <> ''
          WHERE t.stage = 'tender' AND r.stage IN ('result', 'contract')
            AND t.budget_yuan > 0 AND r.budget_yuan > 0 AND t.budget_yuan > r.budget_yuan
            AND (t.budget_yuan - r.budget_yuan) * 1.0 / t.budget_yuan <= 0.65
          ORDER BY r.published_ns DESC
          LIMIT 800
        `).all();

        const seenPk = new Set();
        const allF = [], distF = [], tradeF = [], unitF = [], tierF = [];
        const sameTier = (y) => {
          if (!ctrlYuan) return false;
          if (ctrlYuan < 500_000) return y < 500_000;
          if (ctrlYuan < 2_000_000) return y >= 500_000 && y < 2_000_000;
          if (ctrlYuan < 5_000_000) return y >= 2_000_000 && y < 5_000_000;
          if (ctrlYuan < 20_000_000) return y >= 5_000_000 && y < 20_000_000;
          return y >= 20_000_000;
        };
        for (const p of rawPairs) {
          if (seenPk.has(p.projectKey)) continue;
          seenPk.add(p.projectKey);
          const fl = Number((((p.ctrlYuan - p.winYuan) / p.ctrlYuan) * 100).toFixed(2));
          if (fl <= 0.05 || fl > 65) continue;
          allF.push(fl);
          if (refineDistrict(p.region, p.title, p.tenderer) === refinedDist) distF.push(fl);
          if (p.tradeType === tradeType) tradeF.push(fl);
          if (parsed.tenderer && p.tenderer === parsed.tenderer) unitF.push(fl);
          if (sameTier(p.ctrlYuan)) tierF.push(fl);
        }
        const statOf = (arr) => {
          if (!arr.length) return null;
          const s = [...arr].sort((a, b) => a - b);
          const avg = Number((s.reduce((a, b) => a + b, 0) / s.length).toFixed(2));
          const p25 = s[Math.floor((s.length - 1) * 0.25)];
          const med = s[Math.floor((s.length - 1) * 0.5)];
          const p75 = s[Math.floor((s.length - 1) * 0.75)];
          return { count: s.length, avg, p25, med, p75 };
        };

        const stDist = statOf(distF);
        const stTrade = statOf(tradeF);
        const stUnit = statOf(unitF);
        const stTier = statOf(tierF);
        const stAll = statOf(allF) || { count: 0, avg: 10.5, p25: 7.5, med: 10.2, p75: 14.0 };

        // Weighted quantitative baseline (prefers unit > district > tier > trade > overall)
        const parts = [];
        if (stUnit && stUnit.count >= 2) parts.push({ w: 0.35, s: stUnit });
        if (stDist && stDist.count >= 3) parts.push({ w: 0.30, s: stDist });
        if (stTier && stTier.count >= 3) parts.push({ w: 0.20, s: stTier });
        if (stTrade && stTrade.count >= 3) parts.push({ w: 0.15, s: stTrade });
        if (!parts.length) parts.push({ w: 1, s: stAll });
        const totalW = parts.reduce((acc, x) => acc + x.w, 0);
        const recMed = Number((parts.reduce((acc, x) => acc + x.s.med * x.w, 0) / totalW).toFixed(2));
        const recP25 = Number((parts.reduce((acc, x) => acc + x.s.p25 * x.w, 0) / totalW).toFixed(2));
        const recP75 = Number((parts.reduce((acc, x) => acc + x.s.p75 * x.w, 0) / totalW).toFixed(2));

        const quantitative = {
          district: refinedDist,
          tradeType,
          ctrlYuan,
          conservativePct: recP25,
          recommendedPct: recMed,
          aggressivePct: recP75,
          conservativeQuoteYuan: ctrlYuan > 0 ? Math.round(ctrlYuan * (1 - recP25 / 100)) : 0,
          recommendedQuoteYuan: ctrlYuan > 0 ? Math.round(ctrlYuan * (1 - recMed / 100)) : 0,
          aggressiveQuoteYuan: ctrlYuan > 0 ? Math.round(ctrlYuan * (1 - recP75 / 100)) : 0,
          evidence: {
            unit: stUnit,
            district: stDist,
            tier: stTier,
            trade: stTrade,
            overall: stAll,
          },
        };

        // Call AI LLM (TokenHub) for qualitative pricing strategy synthesis if configured
        let aiAnalysis = "";
        let aiModel = "";
        const { baseUrl, apiKey, defaultModel } = getAiConfig();
        if (apiKey) {
          const prompt = [
            `请作为拥有15年盐城地区招投标与造价实战经验的总造价师，为以下拟参投项目给出「推荐下浮率与报价策略建议」。`,
            `【项目基本信息】`,
            `- 项目名称：${parsed.title}`,
            `- 细化县/区：${refinedDist} | 公告类型：${tradeType}`,
            `- 招标人：${parsed.tenderer || "未标注"}`,
            `- 控制价/预算：${ctrlYuan > 0 ? `${(ctrlYuan / 10000).toFixed(2)}万元` : (parsed.budgetText || "未标注")}`,
            `- 评标办法线索：${parsed.evalMethod || "详见正文"}`,
            `【系统历史配对大数据锚点】`,
            `- 同县/区(${refinedDist})：${stDist ? `${stDist.count}标，均值${stDist.avg}%，P25~P75为${stDist.p25}%~${stDist.p75}%` : "样本较少"}`,
            `- 同招标人：${stUnit ? `${stUnit.count}标，均值${stUnit.avg}%，中位${stUnit.med}%` : "暂无配对样本"}`,
            `- 同体量档位：${stTier ? `${stTier.count}标，均值${stTier.avg}%，P25~P75为${stTier.p25}%~${stTier.p75}%` : "样本较少"}`,
            `- 加权测算建议下浮区间：稳健 ${recP25}% / 推荐中枢 ${recMed}% / 激进 ${recP75}%`,
            `【公告正文节选】`,
            `${String(parsed.body || "").slice(0, 1200)}`,
            `请用简洁、可直接给老板拍板的格式输出（250字以内）：1）最终推荐下浮率区间及理由；2）竞争格局与评标基准价风险提示；3）成本底线提醒。`,
          ].join("\n");

          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 28000);
          try {
            const resp = await fetch(`${baseUrl}/chat/completions`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
              body: JSON.stringify({
                model: defaultModel,
                temperature: 0.25,
                messages: [
                  { role: "system", content: "你是资深中国招投标造价总监，严禁编造数据，严格依据提供的历史配对样本与公告条款给出实战报价下浮建议。" },
                  { role: "user", content: prompt },
                ],
              }),
              signal: controller.signal,
            });
            clearTimeout(timer);
            if (resp.ok) {
              const d = await resp.json();
              aiAnalysis = d?.choices?.[0]?.message?.content?.trim() || "";
              aiModel = defaultModel;
            }
          } catch {
            clearTimeout(timer);
          }
        }

        if (!aiAnalysis) {
          aiAnalysis = `【量化模型推荐结论】综合 ${refinedDist}（${stDist?.count || 0} 标）、同体量档位（${stTier?.count || 0} 标）与同公告类型（${stTrade?.count || 0} 标）历史真实配对中标数据，建议本标段核心报价下浮区间控制在 **${recP25}% ~ ${recP75}%**，重点锚定中枢 **${recMed}%**${ctrlYuan > 0 ? `（对应报价约 ${((ctrlYuan * (1 - recMed / 100)) / 10000).toFixed(2)} 万元）` : ""}。若本项目采用合成基准价（去最高最低均价），建议向中枢 ${recMed}% 贴近以防偏离扣分；若为经评审最低价法，则在核清成本底线后可向 ${recP75}% 靠拢。`;
        }

        audit(user.id, "生成AI推荐下浮率", `${noticeId}/${recMed}%`, aiModel ? `AI(${aiModel})+量化` : "量化引擎");
        return json({
          ok: true,
          quantitative,
          aiAnalysis,
          aiModel: aiModel || "历史配对量化引擎",
        });
      }

      // 21. PDF / Image OCR extraction & structured bidding certificate field parser
      if (pathname === "/api/ocr/extract") {
        const mode = body.mode === "person" ? "person" : "doc";
        const filename = typeof body.filename === "string" ? body.filename.trim().slice(0, 160) : "upload.pdf";
        const rawB64 = typeof body.dataBase64 === "string" ? body.dataBase64.replace(/^data:[^;]+;base64,/, "").trim() : "";
        if (!rawB64) return invalid("请先选择要识别的 PDF 或图片文件。");
        let buf;
        try {
          buf = Buffer.from(rawB64, "base64");
        } catch {
          return invalid("文件编码无效，请重新选择文件。");
        }
        if (!buf.length || buf.length > 15 * 1024 * 1024) {
          return invalid("文件大小须在 1 字节至 15MB 之间。");
        }
        try {
          const ocrRes = await extractOcrAndFieldsFromBuffer({ buf, filename, mode, aiConfig: process.env.CIVIC_RADAR_ENABLE_DOCUMENT_AI === "1" ? getAiConfig() : null });
          audit(user.id, "PDF/图片OCR识别", `${mode}/${filename}`, `${ocrRes.engine} (${ocrRes.charCount}字)`);
          return json({
            ok: true,
            engine: ocrRes.engine,
            pagesProcessed: ocrRes.pagesProcessed,
            charCount: ocrRes.charCount,
            rawText: ocrRes.rawText.slice(0, 6000),
            fields: ocrRes.fields,
          });
        } catch (err) {
          return json({ message: err?.message || "OCR/文档识别引擎执行异常，请检查文件是否损坏" }, err?.message?.startsWith("支持 PDF") ? 400 : 500);
        }
      }

      // 21B. Single & Batch AI Notice Distillation (extracts structured qual boolean logic, PM, deposit, budget -> caches in SQLite)
      const aiExtMatch = pathname.match(/^\/api\/opportunities\/(\d+)\/ai-extract$/);
      if (aiExtMatch) {
        const nid = aiExtMatch[1];
        const row = visible(user.id, nid);
        if (!row) return missing();
        const aiCfg = getAiConfig();
        if (!aiCfg.apiKey) return json({ message: "未配置 TokenHub API Key，请管理员在系统管理中配置。" }, 503);
        const parsed = JSON.parse(row.data);
        const attRows = db.prepare(`SELECT p.body FROM notice_attachment_page p JOIN notice_attachment_document d ON d.notice_id=p.notice_id AND d.att_idx=p.att_idx AND d.sha256=p.sha256 WHERE p.notice_id=? AND p.status='text' ORDER BY p.att_idx, p.page_no LIMIT 12`).all(nid);
        const attText = attRows.map(r => r.body).join("\n").slice(0, 2500);
        try {
          const res = await extractNoticeWithAi(db, { noticeId: nid, title: parsed.title || row.title, body: parsed.body || parsed.content || "", attachmentTexts: attText, aiConfig: aiCfg, force: Boolean(body.force) });
          audit(user.id, "AI智能提炼公告", `${nid}${res.cached ? "(命中缓存)" : "(新提炼)"}`, res.ok ? "成功" : "跳过");
          return json(res);
        } catch (err) {
          return json({ message: `AI 提炼失败：${err?.message || "上游异常"}` }, 502);
        }
      }

      if (pathname === "/api/opportunities/ai-batch-extract") {
        const ids = Array.isArray(body.ids) ? body.ids.map(x => String(x || "").trim()).filter(Boolean).slice(0, 16) : [];
        if (!ids.length) return invalid("请选择至少一条公告进行 AI 智能提炼。");
        const aiCfg = getAiConfig();
        if (!aiCfg.apiKey) return json({ message: "未配置 TokenHub API Key。" }, 503);
        let extracted = 0;
        let cached = 0;
        const results = [];
        let idx = 0;
        const worker = async () => {
          while (idx < ids.length) {
            const nid = ids[idx++];
            const row = visible(user.id, nid);
            if (!row) continue;
            const parsed = JSON.parse(row.data);
            const attRows = db.prepare(`SELECT p.body FROM notice_attachment_page p JOIN notice_attachment_document d ON d.notice_id=p.notice_id AND d.att_idx=p.att_idx AND d.sha256=p.sha256 WHERE p.notice_id=? AND p.status='text' ORDER BY p.att_idx, p.page_no LIMIT 8`).all(nid);
            const attText = attRows.map(r => r.body).join("\n").slice(0, 2000);
            try {
              const r = await extractNoticeWithAi(db, { noticeId: nid, title: parsed.title || row.title, body: parsed.body || parsed.content || "", attachmentTexts: attText, aiConfig: aiCfg, force: Boolean(body.force) });
              if (r.ok) {
                if (r.cached) cached++; else extracted++;
                results.push({ id: nid, ok: true, summary: r.extract?.summary || "" });
              }
            } catch (err) {
              results.push({ id: nid, ok: false, error: err?.message || "提取异常" });
            }
          }
        };
        await Promise.all([worker(), worker(), worker(), worker()]);
        audit(user.id, "AI批量提炼公告", `共${ids.length}条：新提炼${extracted}/缓存${cached}`, "已完成");
        return json({ ok: true, extracted, cached, results });
      }

      // 22. Deposit Payment Tasks (Push from Lot Stage 3 -> Default Finance -> Pay + Upload Receipt)
      if (pathname === "/api/finance/pay-tasks") {
        const noticeId = typeof body.noticeId === "string" ? body.noticeId.trim() : "";
        if (!noticeId || !visible(user.id, noticeId)) return invalid("请选择有效的项目标段。");
        const boundCompany = db.prepare("SELECT company_id FROM lot_workflow WHERE notice_id=?").get(noticeId)?.company_id || "";
        const companyId = (typeof body.companyId === "string" && body.companyId.trim()) || boundCompany;
        if (!companyId) return invalid("请选择参投公司后发起打款任务。");
        if (!lotWriteAllowed(user, noticeId, companyId)) return denied(user.id, "发起打款任务", companyId);
        if (boundCompany && boundCompany !== companyId) return invalid("打款任务的公司须与该标段已绑定公司一致。");
        const depositMethod = typeof body.depositMethod === "string" && body.depositMethod.trim() ? body.depositMethod.trim().slice(0, 60) : "基本户网银转账（现金保证金）";
        const amountYuan = Number(body.amountYuan ?? 0);
        if (!Number.isFinite(amountYuan) || amountYuan <= 0 || !Number.isSafeInteger(Math.round(amountYuan * 100))) return invalid("请填写正确的保证金金额。");
        const amountFen = Math.round(amountYuan * 100);
        const payeeName = typeof body.payeeName === "string" ? body.payeeName.trim().slice(0, 120) : "";
        const payeeAccount = typeof body.payeeAccount === "string" ? body.payeeAccount.trim().slice(0, 80) : "";
        const payeeBank = typeof body.payeeBank === "string" ? body.payeeBank.trim().slice(0, 120) : "";
        const dueTime = typeof body.dueTime === "string" ? body.dueTime.trim().replace("T", " ").slice(0, 30) : "";
        const note = typeof body.note === "string" ? body.note.trim().slice(0, 300) : "";

        // Resolve default finance user
        const defFinSaved = db.prepare("SELECT value FROM app_setting WHERE key='default_finance_user_id'").get()?.value || "";
        const requestedAssignee = typeof body.assigneeId === "string" ? body.assigneeId.trim() : "";
        const eligibleAssignee = id => {
          const target = id && employee(id);
          return target?.approval === "approved" && grant(id, companyId)?.view ? target : null;
        };
        const explicitAssignee = eligibleAssignee(requestedAssignee);
        if (requestedAssignee && !explicitAssignee) return invalid("财务负责人须有参投公司的查看权限。");
        const finEmp = explicitAssignee || eligibleAssignee(defFinSaved) || db.prepare(`SELECT e.id,e.name FROM employee e
          JOIN grant_company g ON g.employee=e.id AND g.company=? AND g.view=1
          WHERE e.approval='approved' AND e.perspective='finance' ORDER BY e.id LIMIT 1`).get(companyId);
        if (!finEmp) return invalid("请指定拥有该公司查看权限的财务负责人。");

        const nm = db.prepare("SELECT title, project_key, CAST(deadline_ns AS TEXT) AS dl FROM notice_meta WHERE id=?").get(noticeId);
        const coName = companyId ? (db.prepare("SELECT name FROM company WHERE id=?").get(companyId)?.name || "") : "";
        const tid = `ptk_${randomUUID().slice(0, 10)}`;

        transaction(db, () => {
          db.prepare(`INSERT INTO deposit_pay_task(
            id, notice_id, company_id, deposit_method, amount_fen, payee_name, payee_account, payee_bank, due_time, note,
            status, assignee_id, assignee_name, requested_by, requested_by_name, created_at, updated_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,'pending',?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
            .run(tid, noticeId, companyId, depositMethod, amountFen, payeeName, payeeAccount, payeeBank, dueTime, note, finEmp.id, finEmp.name, user.id, user.name);

          // Push detailed alert_todo directly assigned to Finance
          const detailParts = [
            `参投公司：${coName || "待核对"}`,
            `方式：${depositMethod}`,
            `金额：${amountYuan.toFixed(2)}元`,
            payeeName ? `收款户名：${payeeName}` : "",
            payeeAccount ? `账号：${payeeAccount}` : "",
            payeeBank ? `开户行：${payeeBank}` : "",
            dueTime ? `打款截止：${dueTime}` : "",
            note ? `备注：${note}` : "",
          ].filter(Boolean).join(" | ");
          db.prepare(`INSERT INTO alert_todo(id,notice_id,project_key,kind,title,detail,assignee,status,due_ns,payment_task_id)
            VALUES (?,?,?,'todo',?,?,?,'open',CAST(? AS INTEGER),?)`)
            .run(`alt_${randomUUID().slice(0, 10)}`, noticeId, nm?.project_key || "", `财务待打保证金(${amountYuan.toFixed(2)}元)：${(nm?.title || "").slice(0, 36)}`, detailParts, finEmp.id, nm?.dl || "0", tid);

          audit(user.id, "推送财务保证金打款任务", `${tid}/${finEmp.name}/${amountYuan}元`, "已指派");
        });
        return json({ ok: true, id: tid, assigneeName: finEmp.name });
      }

      const payConfirmMatch = pathname.match(/^\/api\/finance\/pay-tasks\/([a-zA-Z0-9_-]+)\/confirm$/);
      if (payConfirmMatch) {
        const tid = payConfirmMatch[1];
        const task = db.prepare("SELECT * FROM deposit_pay_task WHERE id=?").get(tid);
        if (!task || !visible(user.id, task.notice_id) || !task.company_id || !grant(user.id, task.company_id)?.view) return missing();
        if (task.assignee_id !== user.id) return forbidden();
        if (task.status !== "pending") return json({ message: "该打款任务已经处理。" }, 409);
        const payNote = typeof body.payNote === "string" ? body.payNote.trim().slice(0, 300) : "";
        const paidAt = typeof body.paidAt === "string" && body.paidAt.trim()
          ? body.paidAt.trim().replace("T", " ").slice(0, 30)
          : new Date(Date.now() + 8 * 3600_000).toISOString().replace("T", " ").slice(0, 19);

        // Support uploading 1 or multiple receipt files (images/PDF) directly into COS
        const rawFiles = Array.isArray(body.files) ? body.files : [];
        const uploadedReceipts = [];
        const receiptRows = [];
        const effCoId = task.company_id;
        for (const rf of rawFiles.slice(0, 10)) {
          const b64 = typeof rf?.dataBase64 === "string" ? rf.dataBase64.replace(/^data:[^;]+;base64,/, "").trim() : "";
          if (!b64) continue;
          const buf = Buffer.from(b64, "base64");
          if (!buf.length || buf.length > 10 * 1024 * 1024) continue;
          const isPdf = buf.slice(0, 5).toString("latin1") === "%PDF-";
          const isPng = buf.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
          const isJpg = buf.slice(0, 2).equals(Buffer.from([0xff, 0xd8]));
          if (!isPdf && !isPng && !isJpg) continue;
          const mimeType = isPdf ? "application/pdf" : isPng ? "image/png" : "image/jpeg";
          const ext = isPdf ? ".pdf" : isPng ? ".png" : ".jpg";
          const fname = String(rf.filename || `打款回执${uploadedReceipts.length + 1}${ext}`).slice(0, 120);
          const fileId = `fil_${randomUUID().slice(0, 10)}`;
          const sha = digest(buf);
          let storageBackend = "sqlite";
          let cosKey = "";
          let storeBytes = buf;
          if (getCosCredentials()) {
            cosKey = `${COS_SHARED_PREFIX}/company-files/${effCoId || "finance"}/${fileId}${ext}`;
            await cosPutVerified(cosKey, buf, mimeType, sha);
            storageBackend = "cos";
            storeBytes = Buffer.alloc(0);
          }
          receiptRows.push([fileId, effCoId, `pay_receipt_${tid}`, fname, mimeType, buf.length, sha, storeBytes, storageBackend, cosKey, user.id]);
          uploadedReceipts.push({ fileId, filename: fname });
        }

        let prevReceipts = [];
        try { prevReceipts = JSON.parse(task.receipt_files_json || "[]"); } catch {}
        const allReceipts = [...prevReceipts, ...uploadedReceipts];
        const category = /保函|保险/.test(task.deposit_method) ? "guarantee" : "deposit";
        const entryType = category === "guarantee" ? "guarantee_face" : "paid";
        const fid = `fin_${randomUUID().slice(0, 10)}`;
        const fullNote = [`【${task.deposit_method}】`, task.payee_name ? `收款方:${task.payee_name}` : "", task.payee_account ? `账号:${task.payee_account}` : "", payNote || task.note, allReceipts.length ? `含${allReceipts.length}份回执` : ""].filter(Boolean).join(" · ").slice(0, 300);

        const committed = transaction(db, () => {
          if (!db.prepare("SELECT 1 FROM deposit_pay_task WHERE id=? AND status='pending' AND assignee_id=?").get(tid,user.id)) return false;
          const saveReceipt = db.prepare(`INSERT INTO company_file(id,company_id,owner_type,owner_id,filename,mime_type,size_bytes,sha256,bytes,storage_backend,cos_key,uploaded_by)
            VALUES (?,?,'doc',?,?,?,?,?,?,?,?,?)`);
          for (const row of receiptRows) saveReceipt.run(...row);
          db.prepare(`INSERT INTO finance_entry(id,notice_id,company_id,lot_round,category,entry_type,amount_fen,pay_status,receive_status,refund_cond,refund_status,dispute_status,due_date,note,actor,actor_name)
            VALUES (?,?,?,'默认标段 · 第1轮',?,?,?,'已打款','已核实到账','未核实','未申请','无争议',?,?,?,?)`)
            .run(fid, task.notice_id, effCoId, category, entryType, task.amount_fen, task.due_time.slice(0, 10), fullNote, user.id, user.name);

          db.prepare(`UPDATE deposit_pay_task SET status='paid', paid_by=?, paid_by_name=?, paid_at=?, receipt_files_json=?, finance_entry_id=?, note=CASE WHEN ?<>'' THEN ? ELSE note END, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
            .run(user.id, user.name, paidAt, JSON.stringify(allReceipts), fid, payNote, payNote, tid);

          // Mark related finance alert_todo as done & advance lot_workflow to step 4
          db.prepare("UPDATE alert_todo SET status='done', updated_at=CURRENT_TIMESTAMP WHERE payment_task_id=? AND status='open'").run(tid);
          db.prepare(`INSERT INTO lot_workflow(notice_id,company_id,active_step,updated_by,updated_by_name,updated_at)
            VALUES (?,?,4,?,?,CURRENT_TIMESTAMP)
            ON CONFLICT(notice_id) DO UPDATE SET active_step=MAX(active_step, 4), updated_by=excluded.updated_by, updated_by_name=excluded.updated_by_name, updated_at=CURRENT_TIMESTAMP`)
            .run(task.notice_id, effCoId, user.id, user.name);

          audit(user.id, "财务确认打款并传回执", `${tid}/${(task.amount_fen / 100).toFixed(2)}元/回执${allReceipts.length}份`, "已打款");
          return true;
        });
        if (!committed) return json({ message: "该打款任务已被处理，未重复记账。" }, 409);
        return json({ ok: true, financeEntryId: fid, receipts: allReceipts });
      }

      return pathname.startsWith("/api/") ? notReady() : missing();
    }

    // --- GET endpoints ---
    if (pathname === "/api/ai/models") {
      const { baseUrl, apiKey, defaultModel } = getAiConfig();
      if (!apiKey) {
        return json({ configured: false, defaultModel, models: [], message: "尚未配置 TokenHub 密钥，请管理员在「系统设置」中填写。" });
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      try {
        const res = await fetch(`${baseUrl}/models`, {
          headers: { "Authorization": `Bearer ${apiKey}` },
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!res.ok) {
          return json({ configured: true, defaultModel, models: [defaultModel], message: `模型列表读取受限（HTTP ${res.status}），已回退默认模型` });
        }
        const data = await res.json();
        const ids = Array.isArray(data?.data) ? data.data.map((m) => m?.id).filter(Boolean) : [];
        if (defaultModel && !ids.includes(defaultModel)) ids.unshift(defaultModel);
        return json({ configured: true, defaultModel, models: ids });
      } catch {
        clearTimeout(timer);
        return json({ configured: true, defaultModel, models: [defaultModel], message: "模型列表拉取超时，已回退默认模型" });
      }
    }

    if (pathname === "/api/settings") {
      const row = db.prepare("SELECT value FROM app_setting WHERE key='requireAssigneeOnSelect'").get();
      const dictRow = db.prepare("SELECT value FROM app_setting WHERE key='field_dicts_json'").get();
      const DEFAULT_FIELD_DICTS_GET = {
        depositMethods: [
          "基本户网银转账（现金保证金）",
          "现金（信封密封现场递交）",
          "银行支票 / 汇票 / 本票",
          "电子保函（交易平台线上出函）",
          "银行纸质保函",
          "投标保证保险（电子保单）",
          "免缴（信用承诺书 / 政采或小微免缴）",
        ],
        depositStatuses: [
          "已汇出待核验",
          "已到账确认（子账号已匹配）",
          "现金信封已封装待带往现场",
          "已出保函 / 保单生效",
          "免缴（已附信用承诺书）",
          "财务审批 / 待打款中",
        ],
        docBuyStatuses: ["未获取", "已下载免费标书", "已付费购买标书", "需CA锁平台下载", "已放弃获取"],
        prepStatuses: ["未开始", "编制中", "商务标已完成", "技术标已完成", "内审与21项自检完成", "已定稿待签章", "已加密上传/封装"],
        refundStatuses: ["未进入退保", "待申请退回", "已申请催退中", "保证金已全额退回", "电子保函已释放", "现金信封现场已退回", "免缴无需退保"],
        enterpriseCategories: ["建筑业企业资质", "安全生产许可证", "营业执照", "信用证明", "质量/环境/安全管理体系"],
      };
      let savedDicts = {};
      try { if (dictRow?.value) savedDicts = JSON.parse(dictRow.value); } catch {}
      const fieldDicts = {};
      for (const [k, defArr] of Object.entries(DEFAULT_FIELD_DICTS_GET)) {
        fieldDicts[k] = Array.isArray(savedDicts[k]) && savedDicts[k].length ? savedDicts[k] : defArr;
      }
      const ai = getAiConfig();
      const defFinSaved = db.prepare("SELECT value FROM app_setting WHERE key='default_finance_user_id'").get()?.value || "";
      const defFinEmp = (defFinSaved && employee(defFinSaved))
        || db.prepare("SELECT id, username, name FROM employee WHERE approval='approved' AND perspective='finance' ORDER BY id LIMIT 1").get()
        || null;
      const employees = db.prepare("SELECT id, username, name, role, perspective, approval FROM employee ORDER BY role ASC, username ASC").all();
      const wkRow = db.prepare("SELECT value FROM app_setting WHERE key='showWatchKeywords'").get();
      const tagRow = db.prepare("SELECT value FROM app_setting WHERE key='showOppTags'").get();
      return json({
        requireAssigneeOnSelect: row?.value === "1",
        showWatchKeywords: wkRow?.value !== "0",
        showOppTags: tagRow?.value !== "0",
        defaultFinanceUserId: defFinEmp?.id || "",
        defaultFinanceUserName: defFinEmp?.name || "未指定财务",
        employees,
        fieldDicts,
        ai: {
          baseUrl: ai.baseUrl,
          defaultModel: ai.defaultModel,
          hasApiKey: ai.hasApiKey,
          keySource: ai.keySource,
        },
      });
    }

    if (pathname === "/api/projects") {
      const dec = searchParams.get("decision") || "all";
      const companyId = (searchParams.get("companyId") || "").trim();
      const stepFilter = Number(searchParams.get("step") || 0) || 0;
      const q = (searchParams.get("q") || "").trim();
      const nowNs = Number(BigInt(Date.now()) * 1000000n);
      const projectScope = followedLifecycleReadScope();
      const financeScope = lifecycleReadScope("fe", "fe.company_id", "fe.actor");
      const active = `pf.decision IN ('watching','bidding') AND ${projectScope}`;
      const actor = actorBinding(user.id);
      const clauses = [active];
      const args = [];
      if (dec === "bidding" || dec === "watching") {
        clauses.push("pf.decision = ?");
        args.push(dec);
      } else if (dec === "pending_refund") {
        clauses.push(`(SELECT coalesce(sum(CASE WHEN fe.entry_type='paid' THEN fe.amount_fen WHEN fe.entry_type='refund_received' THEN -fe.amount_fen ELSE 0 END),0) FROM finance_entry fe WHERE fe.notice_id=m.id AND fe.category='deposit' AND fe.reversed=0 AND ${financeScope}) > 0`);
      }
      if (companyId === "__none__") {
        clauses.push("(lw.company_id IS NULL OR lw.company_id = '')");
      } else if (companyId) {
        clauses.push("lw.company_id = ?");
        args.push(companyId);
      }
      if (stepFilter >= 1 && stepFilter <= 7) {
        clauses.push("coalesce(lw.active_step, 1) = ?");
        args.push(stepFilter);
      }
      if (q) {
        const like = `%${q}%`;
        clauses.push("(m.title LIKE ? OR m.tenderer LIKE ? OR m.region LIKE ? OR m.project_key LIKE ? OR comp.name LIKE ?)");
        args.push(like, like, like, like, like);
      }
      const items = db.prepare(`
        SELECT m.id, m.title, m.source, m.tenderer, m.agency, m.region, m.trade_type AS tradeType,
               m.stage, m.stage_label AS stageLabel, m.project_key AS projectKey,
               CAST(m.published_ns AS TEXT) AS published, CAST(m.deadline_ns AS TEXT) AS deadline,
               m.deadline_text AS deadlineText,
               CASE WHEN m.budget_yuan IS NOT NULL THEN CAST(m.budget_yuan AS TEXT) ELSE NULL END AS budgetYuan,
               m.budget_text AS budgetText, m.eval_method AS evalMethod, m.deposit_text AS depositText,
               pf.decision, pf.assignee AS assigneeId, emp.name AS assigneeName, pf.note, pf.updated_at AS selectedAt,
               coalesce(lw.company_id, '') AS companyId,
               coalesce(comp.name, '') AS companyName,
               (SELECT count(*) FROM notice_meta a JOIN notice rel ON rel.id=a.id JOIN notice base ON base.id=m.id WHERE a.project_key<>'' AND a.project_key=m.project_key AND a.stage='amendment' AND a.id<>m.id AND (rel.draft=0 OR (base.draft=1 AND rel.owner=base.owner)) AND radar_same_scope(base.data,rel.data)) AS amendmentCount,
               (SELECT count(*) FROM notice_meta t JOIN notice rel ON rel.id=t.id JOIN notice base ON base.id=m.id WHERE t.project_key<>'' AND t.project_key=m.project_key AND (rel.draft=0 OR (base.draft=1 AND rel.owner=base.owner)) AND radar_same_scope(base.data,rel.data)) AS timelineCount,
               coalesce(lw.active_step, 1) AS workflowStep,
               coalesce(lw.doc_buy_status, '未获取') AS docBuyStatus,
               coalesce(lw.prep_status, '未开始') AS prepStatus,
               coalesce(lw.prep_pm_name, '') AS prepPmName,
               coalesce(lw.predict_status, '待分析') AS predictStatus,
               coalesce(lw.refund_track_status, '未进入退保') AS refundTrackStatus,
               coalesce((SELECT sum(CASE WHEN fe.entry_type='paid' THEN fe.amount_fen WHEN fe.entry_type='refund_received' THEN -fe.amount_fen ELSE 0 END) FROM finance_entry fe WHERE fe.notice_id=m.id AND fe.category='deposit' AND fe.reversed=0 AND ${financeScope}), 0) AS depositOutstandingFen,
               (SELECT count(*) FROM alert_todo al JOIN notice linked ON linked.id=al.notice_id
                JOIN notice base ON base.id=m.id
                WHERE al.status='open' AND (${alertStatus("al")})='open' AND ${projectAlertReadScope("al")}
                  AND (al.notice_id=m.id OR (al.kind='amendment' AND (
                    al.id='amend:' || m.id || ':' || al.notice_id
                    OR (al.id='amend:' || al.notice_id AND al.project_key<>'' AND al.project_key=m.project_key
                      AND radar_same_scope(base.data,linked.data))
                  )))) AS openAlertCount
        FROM project_follow pf
        JOIN notice_meta m ON m.id = pf.notice_id
        LEFT JOIN employee emp ON emp.id = pf.assignee
        LEFT JOIN lot_workflow lw ON lw.notice_id = m.id
        LEFT JOIN company comp ON comp.id = lw.company_id
        WHERE ${clauses.join(" AND ")}
        ORDER BY CASE WHEN m.deadline_ns > ? THEN 0 ELSE 1 END, CASE WHEN m.deadline_ns > 0 THEN m.deadline_ns ELSE 999999999999999999 END ASC, pf.updated_at DESC
      `).all(actor, ...args, nowNs);
      const companyCounts = db.prepare(`
        SELECT coalesce(lw.company_id, '') AS companyId, coalesce(c.name, '未指定参投公司') AS companyName, count(*) AS cnt
        FROM project_follow pf
        LEFT JOIN lot_workflow lw ON lw.notice_id = pf.notice_id
        LEFT JOIN company c ON c.id = lw.company_id
        WHERE ${active}
        GROUP BY coalesce(lw.company_id, '')
        ORDER BY cnt DESC
      `).all(actor);
      const pendingRefundRows = db.prepare(`
        SELECT coalesce(sum(CASE WHEN fe.entry_type='paid' THEN fe.amount_fen WHEN fe.entry_type='refund_received' THEN -fe.amount_fen ELSE 0 END),0) AS outFen
        FROM project_follow pf
        JOIN finance_entry fe ON fe.notice_id = pf.notice_id AND fe.category='deposit' AND fe.reversed=0
        WHERE ${active} AND ${financeScope}
        GROUP BY pf.notice_id
        HAVING outFen > 0
      `).all(actor);
      const totals = db.prepare(`SELECT count(*) AS allCount,
        count(CASE WHEN pf.decision='bidding' THEN 1 END) AS bidding,
        count(CASE WHEN pf.decision='watching' THEN 1 END) AS watching
        FROM project_follow pf WHERE ${active}`).get(actor);
      const counts = {
        all: totals.allCount, bidding: totals.bidding, watching: totals.watching,
        pendingRefund: pendingRefundRows.length,
        totalOutstandingDepositFen: pendingRefundRows.reduce((s, r) => s + Number(r.outFen || 0), 0),
        pendingRefundTotalFen: pendingRefundRows.reduce((s, r) => s + Number(r.outFen || 0), 0),
      };
      const stepRows = db.prepare(`
        SELECT coalesce(lw.active_step, 1) AS step, count(*) AS cnt
        FROM project_follow pf
        LEFT JOIN lot_workflow lw ON lw.notice_id = pf.notice_id
        WHERE ${active}
        GROUP BY coalesce(lw.active_step, 1)
      `).all(actor);
      const stepCounts = {};
      for (const r of stepRows) stepCounts[String(r.step)] = r.cnt;
      return json({ items, counts, companyCounts, stepCounts });
    }

    if (pathname === "/api/analytics/review") {
      const period = searchParams.get("period") || "all"; // 1m | 3m | 6m | 1y | all
      const reviewPeriod = searchParams.get("reviewPeriod") || period;
      const rawDistrict = (searchParams.get("district") || "").trim();
      const district = rawDistrict === "all" ? "" : rawDistrict;
      const rawTradeType = (searchParams.get("tradeType") || "").trim();
      const tradeType = rawTradeType === "all" ? "" : rawTradeType;
      const rawBudgetTier = (searchParams.get("budgetTier") || "").trim();
      const budgetTier = rawBudgetTier === "all" ? "" : rawBudgetTier;
      const unitQuery = (searchParams.get("unitQuery") || "").trim();
      const rawCompanyId = (searchParams.get("companyId") || "").trim();
      const companyId = rawCompanyId === "all" ? "" : rawCompanyId;

      const nowMs = Date.now();
      const periodDaysMap = { "1m": 30, "3m": 90, "6m": 180, "1y": 365 };
      const minNs = periodDaysMap[period]
        ? BigInt(nowMs - periodDaysMap[period] * 86400_000) * 1000000n
        : 0n;

      const BUDGET_TIERS = [
        { key: "t1", label: "50万以下", min: 0, max: 500_000 },
        { key: "t2", label: "50万~200万", min: 500_000, max: 2_000_000 },
        { key: "t3", label: "200万~500万", min: 2_000_000, max: 5_000_000 },
        { key: "t4", label: "500万~2000万", min: 5_000_000, max: 20_000_000 },
        { key: "t5", label: "2000万以上", min: 20_000_000, max: Infinity },
      ];
      const getBudgetTier = (yuan) => BUDGET_TIERS.find((t) => yuan >= t.min && yuan < t.max) || BUDGET_TIERS[0];

      // 1. Historical Winning Float-Rate Analytics from paired tender -> result/contract notices
      const rawPairs = db.prepare(`
        SELECT t.project_key AS projectKey, t.id AS tenderId, r.id AS resultId,
               r.title, t.tenderer, t.agency, r.region, r.trade_type AS tradeType,
               t.budget_yuan AS ctrlYuan, r.budget_yuan AS winYuan,
               CAST(r.published_ns AS TEXT) AS publishedNs, n.data AS resultData
        FROM notice_meta t
        JOIN notice_meta r ON r.project_key = t.project_key AND t.project_key <> ''
        JOIN notice n ON n.id = r.id
        WHERE t.stage = 'tender'
          AND r.stage IN ('result', 'contract')
          AND t.budget_yuan > 0 AND r.budget_yuan > 0
          AND t.budget_yuan > r.budget_yuan
          AND (t.budget_yuan - r.budget_yuan) * 1.0 / t.budget_yuan <= 0.65
        ORDER BY r.published_ns DESC
      `).all();

      const seenPk = new Set();
      const allRecords = [];
      const districtSet = new Set();
      const tradeSet = new Set();

      for (const row of rawPairs) {
        if (seenPk.has(row.projectKey)) continue;
        seenPk.add(row.projectKey);
        const pubNs = BigInt(row.publishedNs || "0");
        if (minNs > 0n && pubNs > 0n && pubNs < minNs) continue;

        let parsed = {};
        try { parsed = JSON.parse(row.resultData); } catch {}
        const winner = extractWinnerFromBody(parsed.body, parsed.winner);
        const refinedDist = refineDistrict(row.region, row.title, row.tenderer);
        const floatPct = Number((((row.ctrlYuan - row.winYuan) / row.ctrlYuan) * 100).toFixed(2));
        if (floatPct <= 0.05 || floatPct > 65) continue;

        districtSet.add(refinedDist);
        if (row.tradeType) tradeSet.add(row.tradeType);
        const tier = getBudgetTier(row.ctrlYuan);
        const pubMs = pubNs > 0n ? Number(pubNs / 1000000n) : 0;
        const pubMonth = pubMs > 0 ? new Date(pubMs + 8 * 3600_000).toISOString().slice(0, 7) : "";

        allRecords.push({
          projectKey: row.projectKey,
          tenderId: row.tenderId,
          resultId: row.resultId,
          title: row.title,
          district: refinedDist,
          tradeType: row.tradeType || "其他",
          budgetTierKey: tier.key,
          budgetTierLabel: tier.label,
          tenderer: row.tenderer || "未标注",
          agency: row.agency || "未标注",
          winner,
          ctrlYuan: row.ctrlYuan,
          winYuan: row.winYuan,
          floatPct,
          published: row.publishedNs,
          pubMonth,
        });
      }

      const filtered = allRecords.filter((r) => {
        if (district && r.district !== district) return false;
        if (tradeType && r.tradeType !== tradeType) return false;
        if (budgetTier && r.budgetTierKey !== budgetTier) return false;
        if (unitQuery) {
          const hay = `${r.tenderer} ${r.winner} ${r.agency} ${r.title}`.toLowerCase();
          if (!hay.includes(unitQuery.toLowerCase())) return false;
        }
        return true;
      });

      const pctAt = (sorted, p) => {
        if (!sorted.length) return null;
        const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
        return Number(sorted[idx].toFixed(2));
      };

      const calcStats = (arr) => {
        if (!arr.length) return { count: 0, sampleCount: 0, avgFloatPct: null, p25FloatPct: null, medianFloatPct: null, p75FloatPct: null, minFloatPct: null, maxFloatPct: null };
        const sorted = [...arr].map((x) => x.floatPct).sort((a, b) => a - b);
        const sum = sorted.reduce((s, v) => s + v, 0);
        return {
          count: sorted.length,
          sampleCount: sorted.length,
          avgFloatPct: Number((sum / sorted.length).toFixed(2)),
          p25FloatPct: pctAt(sorted, 0.25),
          medianFloatPct: pctAt(sorted, 0.5),
          p75FloatPct: pctAt(sorted, 0.75),
          minFloatPct: sorted[0],
          maxFloatPct: sorted[sorted.length - 1],
        };
      };

      // Distribution histogram buckets
      const histDefs = [
        { key: "0-5", label: "0~5%", min: 0, max: 5 },
        { key: "5-10", label: "5~10%", min: 5, max: 10 },
        { key: "10-15", label: "10~15%", min: 10, max: 15 },
        { key: "15-20", label: "15~20%", min: 15, max: 20 },
        { key: "20-30", label: "20~30%", min: 20, max: 30 },
        { key: "30+", label: "30%以上", min: 30, max: 100 },
      ];
      const distribution = histDefs.map((b) => {
        const cnt = filtered.filter((r) => r.floatPct >= b.min && r.floatPct < b.max).length;
        return {
          ...b,
          count: cnt,
          ratioPct: filtered.length ? Number(((cnt / filtered.length) * 100).toFixed(1)) : 0,
        };
      });

      const byDistrictMap = new Map();
      const byTradeMap = new Map();
      const byTierMap = new Map(BUDGET_TIERS.map((t) => [t.key, []]));
      const byMonthMap = new Map();
      const byUnitMap = new Map();
      const byWinnerMap = new Map();
      for (const r of filtered) {
        if (!byDistrictMap.has(r.district)) byDistrictMap.set(r.district, []);
        byDistrictMap.get(r.district).push(r);
        if (!byTradeMap.has(r.tradeType)) byTradeMap.set(r.tradeType, []);
        byTradeMap.get(r.tradeType).push(r);
        byTierMap.get(r.budgetTierKey)?.push(r);
        if (r.pubMonth) {
          if (!byMonthMap.has(r.pubMonth)) byMonthMap.set(r.pubMonth, []);
          byMonthMap.get(r.pubMonth).push(r);
        }
        const uKey = r.tenderer && r.tenderer !== "未标注" ? r.tenderer : "";
        if (uKey) {
          if (!byUnitMap.has(uKey)) byUnitMap.set(uKey, []);
          byUnitMap.get(uKey).push(r);
        }
        const wKey = r.winner && r.winner !== "详见结果原文" && r.winner !== "未标注" ? r.winner : "";
        if (wKey) {
          if (!byWinnerMap.has(wKey)) byWinnerMap.set(wKey, []);
          byWinnerMap.get(wKey).push(r);
        }
      }

      const byDistrict = [...byDistrictMap.entries()].map(([name, list]) => ({
        district: name,
        ...calcStats(list),
      })).sort((a, b) => b.count - a.count);

      const byTradeType = [...byTradeMap.entries()].map(([name, list]) => ({
        tradeType: name,
        ...calcStats(list),
      })).sort((a, b) => b.count - a.count);

      const byBudgetTier = BUDGET_TIERS.map((t) => ({
        tierKey: t.key,
        tierLabel: t.label,
        ...calcStats(byTierMap.get(t.key) || []),
      }));

      const monthlyTrend = [...byMonthMap.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .slice(-12)
        .map(([month, list]) => ({
          month,
          ...calcStats(list),
        }));

      const byUnit = [...byUnitMap.entries()].map(([name, list]) => ({
        unitName: name,
        ...calcStats(list),
      })).sort((a, b) => b.count - a.count).slice(0, 40);

      const byWinner = [...byWinnerMap.entries()].map(([name, list]) => {
        const distCount = new Map();
        for (const it of list) distCount.set(it.district, (distCount.get(it.district) || 0) + 1);
        const topDist = [...distCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
        return {
          unitName: name,
          topDistrict: topDist,
          ...calcStats(list),
        };
      }).sort((a, b) => b.count - a.count).slice(0, 25);

      // 2. Company Bidding Retrospective (本公司投标复盘：投了多少个、中了多少、没中多少、中标平均下浮率、未中平均下浮率、报价偏差诊断、ROI)
      const userCompanies = db.prepare(`SELECT c.id, c.name FROM company c JOIN grant_company g ON c.id=g.company WHERE g.employee=? AND g.view=1 ORDER BY c.name`).all(user.id);
      const followRows = db.prepare(`
        SELECT pf.notice_id AS noticeId, pf.decision, pf.updated_at AS followedAt,
               m.title, m.region, m.trade_type AS tradeType, m.tenderer, m.budget_yuan AS ctrlYuan,
               lw.company_id AS wfCompanyId, lw.active_step AS activeStep,
               lw.predict_our_quote_fen AS ourQuoteFen, lw.predict_benchmark_fen AS benchFen, lw.predict_float_rate AS predictFloatRate,
               lw.refund_track_status AS refundTrackStatus, lw.loss_reason AS lossReason, lw.review_note AS reviewNote,
               bo.final_result AS finalResult, bo.candidate_status AS candidateStatus,
               bo.award_amount_fen AS awardAmountFen, bo.contract_status AS contractStatus,
               c.id AS resolvedCompanyId, c.name AS companyName
        FROM project_follow pf
        JOIN notice_meta m ON m.id = pf.notice_id
        LEFT JOIN lot_workflow lw ON lw.notice_id = pf.notice_id
        LEFT JOIN bid_outcome bo ON bo.notice_id = pf.notice_id
        LEFT JOIN company c ON c.id = coalesce(nullif(lw.company_id,''), nullif(bo.company_id,''))
        WHERE (pf.decision = 'bidding' OR lw.notice_id IS NOT NULL OR bo.notice_id IS NOT NULL)
        ORDER BY pf.updated_at DESC
      `).all();

      const cutoffIso = periodDaysMap[reviewPeriod]
        ? new Date(nowMs - periodDaysMap[reviewPeriod] * 86400_000).toISOString().replace("T", " ").slice(0, 19)
        : "";

      // Finance ROI aggregation for bidding expenses
      const expenseMap = new Map();
      const expRows = db.prepare(`
        SELECT notice_id, sum(amount_fen) AS expFen
        FROM finance_entry
        WHERE reversed = 0 AND category = 'expense' AND entry_type = 'paid'
        GROUP BY notice_id
      `).all();
      for (const er of expRows) expenseMap.set(er.notice_id, Number(er.expFen || 0));

      const retroProjects = [];
      const wonFloats = [];
      const lostOurFloats = [];
      const byCompanyMap = new Map();
      const lossReasonMap = new Map();
      let totalExpenseFen = 0;
      let totalWonContractFen = 0;

      for (const fr of followRows) {
        const effCoId = fr.resolvedCompanyId || fr.wfCompanyId || userCompanies[0]?.id || "default";
        const effCoName = fr.companyName || userCompanies.find((c) => c.id === effCoId)?.name || "默认参投主体";
        if (companyId && effCoId !== companyId) continue;
        if (cutoffIso && fr.followedAt && fr.followedAt < cutoffIso) continue;

        let ourFloatNum = null;
        if (fr.predictFloatRate) {
          const m = fr.predictFloatRate.match(/([0-9]+(?:\.[0-9]+)?)/);
          if (m) ourFloatNum = Number(m[1]);
        }
        const quoteFen = fr.ourQuoteFen || fr.awardAmountFen || 0;
        if (ourFloatNum === null && fr.ctrlYuan > 0 && quoteFen > 0) {
          const qYuan = quoteFen / 100;
          if (fr.ctrlYuan > qYuan) {
            ourFloatNum = Number((((fr.ctrlYuan - qYuan) / fr.ctrlYuan) * 100).toFixed(2));
          }
        }
        if (ourFloatNum === null && fr.ctrlYuan > 0) {
          const opn = db.prepare("SELECT bids_json FROM opening_record WHERE notice_id=? ORDER BY version DESC LIMIT 1").get(fr.noticeId);
          if (opn) {
            try {
              const bids = JSON.parse(opn.bids_json || "[]");
              const myBid = bids[0];
              if (myBid && Number(myBid.amountYuan) > 0 && fr.ctrlYuan > Number(myBid.amountYuan)) {
                ourFloatNum = Number((((fr.ctrlYuan - Number(myBid.amountYuan)) / fr.ctrlYuan) * 100).toFixed(2));
              }
            } catch {}
          }
        }

        // Calculate benchmark/win reference float & deviation (报高/报低)
        let refFloatPct = null;
        const refYuan = fr.awardAmountFen > 0 ? fr.awardAmountFen / 100 : (fr.benchFen > 0 ? fr.benchFen / 100 : 0);
        if (fr.ctrlYuan > 0 && refYuan > 0 && fr.ctrlYuan > refYuan) {
          refFloatPct = Number((((fr.ctrlYuan - refYuan) / fr.ctrlYuan) * 100).toFixed(2));
        }
        // Deviation: positive means we floated LESS than benchmark (quoted higher), negative means we floated MORE (quoted lower)
        const deviationPct = (ourFloatNum !== null && refFloatPct !== null)
          ? Number((refFloatPct - ourFloatNum).toFixed(2))
          : null;

        const resStatus = fr.finalResult || "待定标/进行中";
        const bucket = resStatus === "中标" ? "won" : resStatus === "未中标" ? "lost" : "pending";
        if (bucket === "won" && ourFloatNum !== null) wonFloats.push(ourFloatNum);
        if (bucket === "lost" && ourFloatNum !== null) lostOurFloats.push(ourFloatNum);
        if (bucket === "won") {
          totalWonContractFen += Number(fr.awardAmountFen || fr.ourQuoteFen || 0);
        }
        const expFen = expenseMap.get(fr.noticeId) || 0;
        totalExpenseFen += expFen;

        const lr = (fr.lossReason || "").trim();
        if (bucket === "lost") {
          const lrKey = lr || "待归因";
          lossReasonMap.set(lrKey, (lossReasonMap.get(lrKey) || 0) + 1);
        }

        if (!byCompanyMap.has(effCoId)) {
          byCompanyMap.set(effCoId, {
            companyId: effCoId,
            companyName: effCoName,
            totalBids: 0,
            wonCount: 0,
            lostCount: 0,
            pendingCount: 0,
            wonFloats: [],
            lostFloats: [],
          });
        }
        const coStat = byCompanyMap.get(effCoId);
        coStat.totalBids += 1;
        if (bucket === "won") {
          coStat.wonCount += 1;
          if (ourFloatNum !== null) coStat.wonFloats.push(ourFloatNum);
        } else if (bucket === "lost") {
          coStat.lostCount += 1;
          if (ourFloatNum !== null) coStat.lostFloats.push(ourFloatNum);
        } else {
          coStat.pendingCount += 1;
        }

        retroProjects.push({
          noticeId: fr.noticeId,
          title: fr.title,
          companyId: effCoId,
          companyName: effCoName,
          district: refineDistrict(fr.region, fr.title, fr.tenderer),
          tradeType: fr.tradeType || "其他",
          tenderer: fr.tenderer || "未标注",
          ctrlYuan: fr.ctrlYuan || 0,
          ourQuoteYuan: quoteFen ? Number((quoteFen / 100).toFixed(2)) : 0,
          benchmarkYuan: fr.benchFen ? Number((fr.benchFen / 100).toFixed(2)) : 0,
          winAmountYuan: fr.awardAmountFen ? Number((fr.awardAmountFen / 100).toFixed(2)) : 0,
          awardAmountYuan: fr.awardAmountFen ? Number((fr.awardAmountFen / 100).toFixed(2)) : 0,
          floatPct: ourFloatNum,
          ourFloatPct: ourFloatNum,
          refFloatPct,
          deviationPct,
          lossReason: lr,
          reviewNote: fr.reviewNote || "",
          expenseFen: expFen,
          bucket,
          outcomeStatus: resStatus,
          finalResult: resStatus,
          candidateStatus: fr.candidateStatus || "未标注",
          contractStatus: fr.contractStatus || "未签署",
          refundTrackStatus: fr.refundTrackStatus || "未进入退保",
          activeStep: fr.activeStep || 1,
          followedAt: fr.followedAt,
        });
      }

      const wonCount = retroProjects.filter((p) => p.bucket === "won").length;
      const lostCount = retroProjects.filter((p) => p.bucket === "lost").length;
      const abortedCount = retroProjects.filter((p) => p.finalResult === "流标或终止").length;
      const pendingCount = retroProjects.length - wonCount - lostCount - abortedCount;
      const avgOf = (arr) => arr.length ? Number((arr.reduce((s, x) => s + x, 0) / arr.length).toFixed(2)) : null;

      const byCompany = [...byCompanyMap.values()].map((c) => ({
        companyId: c.companyId,
        companyName: c.companyName,
        totalBids: c.totalBids,
        wonCount: c.wonCount,
        lostCount: c.lostCount,
        pendingCount: c.pendingCount,
        winRatePct: (c.wonCount + c.lostCount) > 0 ? Number(((c.wonCount / (c.wonCount + c.lostCount)) * 100).toFixed(1)) : null,
        wonAvgFloatPct: avgOf(c.wonFloats),
        lostAvgFloatPct: avgOf(c.lostFloats),
      }));

      const lossReasons = [...lossReasonMap.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count);

      const overallStats = calcStats(filtered);
      const samplesFormatted = filtered.slice(0, 60).map((s) => ({
        ...s,
        controlYuan: s.ctrlYuan,
        winnerUnit: s.winner,
      }));

      const activeCosAtts = db.prepare("SELECT count(*) AS c FROM notice_attachment_cache WHERE status='cached' AND expires_at > CURRENT_TIMESTAMP").get()?.c ?? 0;
      const cleanedCosAtts = db.prepare("SELECT count(*) AS c FROM notice_attachment_cache WHERE status='expired'").get()?.c ?? 0;

      return json({
        filters: {
          districts: [...districtSet].sort(),
          tradeTypes: [...tradeSet].sort(),
          budgetTiers: BUDGET_TIERS.map((t) => ({ key: t.key, label: t.label })),
        },
        marketFloat: {
          overall: overallStats,
          byDistrict,
          byTradeType,
          byBudgetTier,
          distribution,
          monthlyTrend,
          byUnit,
          samples: samplesFormatted,
        },
        marketFloatStats: {
          totalSamples: overallStats.sampleCount,
          avgFloatPct: overallStats.avgFloatPct,
          p25FloatPct: overallStats.p25FloatPct,
          medianFloatPct: overallStats.medianFloatPct,
          p75FloatPct: overallStats.p75FloatPct,
          minFloatPct: overallStats.minFloatPct,
          maxFloatPct: overallStats.maxFloatPct,
          availableDistricts: [...districtSet].sort(),
          availableTrades: [...tradeSet].sort(),
          budgetTiers: BUDGET_TIERS.map((t) => ({ key: t.key, label: t.label })),
          byDistrict,
          byTrade: byTradeType,
          byBudgetTier,
          distribution,
          monthlyTrend,
          byTenderer: byUnit,
          byWinner,
          samples: samplesFormatted,
        },
        companyReview: {
          companies: userCompanies,
          totalBids: retroProjects.length,
          wonCount,
          lostCount,
          abortedCount,
          pendingCount,
          winRatePct: (wonCount + lostCount) > 0 ? Number(((wonCount / (wonCount + lostCount)) * 100).toFixed(1)) : null,
          wonAvgFloatPct: avgOf(wonFloats),
          lostAvgFloatPct: avgOf(lostOurFloats),
          lostOurAvgFloatPct: avgOf(lostOurFloats),
          totalExpenseFen,
          totalWonContractFen,
          roiMultiple: totalExpenseFen > 0 ? Number((totalWonContractFen / totalExpenseFen).toFixed(1)) : null,
          lossReasons,
          byCompany,
          items: retroProjects,
          projects: retroProjects,
        },
        noticeAttachmentBucket: {
          activeCount: activeCosAtts,
          expiredCleanedCount: cleanedCosAtts,
          retentionDays: 30,
        },
      });
    }

    if (pathname === "/api/finance") {
      const actor = { $lifecycleActor: user.id };
      const noticeId = (searchParams.get("noticeId") || "").trim();
      const companyId = (searchParams.get("companyId") || "").trim();
      const clauses = ["NOT EXISTS (SELECT 1 FROM notice_hidden h WHERE h.notice_id = f.notice_id)", lifecycleReadScope("f", "f.company_id", "f.actor")];
      const args = [];
      if (noticeId) { clauses.push("f.notice_id=?"); args.push(noticeId); }
      if (companyId) { clauses.push("f.company_id=?"); args.push(companyId); }
      const where = "WHERE " + clauses.join(" AND ");
      const rows = db.prepare(`
        SELECT f.*, m.title AS noticeTitle, c.name AS companyName
        FROM finance_entry f
        LEFT JOIN notice_meta m ON m.id = f.notice_id
        LEFT JOIN company c ON c.id = f.company_id
        ${where}
        ORDER BY f.created_at DESC
        LIMIT 200
      `).all(actor, ...args);
      const balances = {
        paidFen: 0, refundReceivedFen: 0, nonRefundDeductFen: 0,
        pendingRefundFen: 0, inTransitFen: 0, transferInFen: 0, transferOutFen: 0, guaranteeFaceFen: 0,
      };
      for (const r of rows) {
        if (r.reversed) continue;
        if (r.entry_type === "paid") balances.paidFen += r.amount_fen;
        else if (r.entry_type === "refund_received") balances.refundReceivedFen += r.amount_fen;
        else if (r.entry_type === "non_refund_deduct") balances.nonRefundDeductFen += r.amount_fen;
        else if (r.entry_type === "in_transit") balances.inTransitFen += r.amount_fen;
        else if (r.entry_type === "transfer_in") balances.transferInFen += r.amount_fen;
        else if (r.entry_type === "transfer_out") balances.transferOutFen += r.amount_fen;
        else if (r.entry_type === "guarantee_face") balances.guaranteeFaceFen += r.amount_fen;
      }
      balances.pendingRefundFen = Math.max(0, balances.paidFen - balances.refundReceivedFen - balances.nonRefundDeductFen);
      const selectedProjects = db.prepare(`
        SELECT m.id, m.title FROM project_follow pf JOIN notice_meta m ON m.id=pf.notice_id
        WHERE pf.decision IN ('watching','bidding') AND ${followedLifecycleReadScope()}
          AND NOT EXISTS (SELECT 1 FROM notice_hidden h WHERE h.notice_id = m.id)
        ORDER BY pf.updated_at DESC
      `).all(actor);
      const payTasks = db.prepare(`
        SELECT t.*, m.title AS noticeTitle, c.name AS companyName
        FROM deposit_pay_task t
        LEFT JOIN notice_meta m ON m.id = t.notice_id
        LEFT JOIN company c ON c.id = t.company_id
        WHERE t.status <> 'cancelled'
          AND ${lifecycleReadScope("t", "t.company_id", "t.requested_by")}
          AND NOT EXISTS (SELECT 1 FROM notice_hidden h WHERE h.notice_id = t.notice_id)
          AND NOT EXISTS (SELECT 1 FROM project_follow pf WHERE pf.notice_id = t.notice_id AND pf.decision = 'declined')
        ORDER BY CASE t.status WHEN 'pending' THEN 0 ELSE 1 END, t.created_at DESC
        LIMIT 80
      `).all(actor).map(task => lifecyclePayment(task, user.id));
      return json({ balances, entries: rows, selectedProjects, payTasks });
    }

    if (pathname === "/api/opening") {
      const actor = { $lifecycleActor: user.id };
      const noticeId = (searchParams.get("noticeId") || "").trim();
      const oClauses = ["NOT EXISTS (SELECT 1 FROM notice_hidden h WHERE h.notice_id = o.notice_id)", lifecycleReadScope("o", "''", "o.actor")];
      const args = [];
      if (noticeId) { oClauses.push("o.notice_id=?"); args.push(noticeId); }
      const where = "WHERE " + oClauses.join(" AND ");
      const records = db.prepare(`
        SELECT o.id, o.notice_id AS noticeId, o.version, o.open_mode AS openMode, o.venue, o.arrive_time AS arriveTime,
               o.contact, o.materials_ver AS materialsVer, o.bids_json AS bidsJson, (o.photo_data <> '') AS hasPhoto,
               o.photo_data AS photoData, o.quality_flags AS qualityFlagsJson, o.verified, o.note,
               o.actor_name AS actorName, o.created_at AS createdAt,
               m.title AS noticeTitle, m.budget_yuan AS budgetYuan, m.deadline_text AS deadlineText
        FROM opening_record o
        LEFT JOIN notice_meta m ON m.id = o.notice_id
        ${where}
        ORDER BY o.created_at DESC, o.version DESC
        LIMIT 50
      `).all(actor, ...args).map((r) => ({
        ...r,
        hasPhoto: !!r.hasPhoto,
        verified: !!r.verified,
        bids: (() => { try { return JSON.parse(r.bidsJson); } catch { return []; } })(),
        qualityFlags: (() => { try { return JSON.parse(r.qualityFlagsJson); } catch { return []; } })(),
      }));
      const selectedProjects = db.prepare(`
        SELECT m.id, m.title, m.budget_yuan AS budgetYuan, m.deadline_text AS deadlineText
        FROM project_follow pf JOIN notice_meta m ON m.id=pf.notice_id
        WHERE pf.decision IN ('watching','bidding') AND ${followedLifecycleReadScope()}
          AND NOT EXISTS (SELECT 1 FROM notice_hidden h WHERE h.notice_id = m.id)
        ORDER BY pf.updated_at DESC
      `).all(actor);
      return json({ records, selectedProjects });
    }

    if (pathname === "/api/estimates") {
      const actor = { $lifecycleActor: user.id };
      const noticeId = (searchParams.get("noticeId") || "").trim();
      const where = `WHERE ${lifecycleReadScope("e", "''", "e.actor")}
        AND NOT EXISTS (SELECT 1 FROM notice_hidden h WHERE h.notice_id=e.notice_id)
        ${noticeId ? "AND e.notice_id=?" : ""}`;
      const args = noticeId ? [noticeId] : [];
      const estimates = db.prepare(`
        SELECT e.id, e.notice_id AS noticeId, e.version, e.rule_name AS ruleName,
               e.params_json AS paramsJson, e.snapshot_json AS snapshotJson, e.result_json AS resultJson,
               e.note, e.actor_name AS actorName, e.created_at AS createdAt,
               m.title AS noticeTitle, m.budget_yuan AS budgetYuan
        FROM bid_estimate e
        LEFT JOIN notice_meta m ON m.id = e.notice_id
        ${where}
        ORDER BY e.created_at DESC, e.version DESC
        LIMIT 50
      `).all(actor, ...args).map((r) => ({
        ...r,
        params: (() => { try { return JSON.parse(r.paramsJson); } catch { return {}; } })(),
        snapshot: (() => { try { return JSON.parse(r.snapshotJson); } catch { return []; } })(),
        result: (() => { try { return JSON.parse(r.resultJson); } catch { return {}; } })(),
      }));
      const selectedProjects = db.prepare(`
        SELECT m.id, m.title, m.budget_yuan AS budgetYuan, m.eval_method AS evalMethod
        FROM project_follow pf JOIN notice_meta m ON m.id=pf.notice_id
        WHERE pf.decision IN ('watching','bidding') AND ${followedLifecycleReadScope()}
          AND NOT EXISTS (SELECT 1 FROM notice_hidden h WHERE h.notice_id=m.id) ORDER BY pf.updated_at DESC
      `).all(actor);
      return json({ estimates, selectedProjects });
    }

    if (pathname === "/api/schedules") {
      const actor = { $lifecycleActor: user.id };
      const rows = db.prepare(`
        SELECT s.*, m.title AS noticeTitle, m.deadline_text AS deadlineText, c.name AS companyName, emp.name AS delegateName
        FROM bid_schedule s
        LEFT JOIN notice_meta m ON m.id = s.notice_id
        LEFT JOIN company c ON c.id = s.company_id
        LEFT JOIN employee emp ON emp.id = s.delegate_id
        WHERE NOT EXISTS (SELECT 1 FROM notice_hidden h WHERE h.notice_id = s.notice_id)
          AND ${lifecycleReadScope("s", "s.company_id", "s.updated_by")}
          AND NOT EXISTS (SELECT 1 FROM project_follow pf WHERE pf.notice_id = s.notice_id AND pf.decision = 'declined')
        ORDER BY COALESCE(NULLIF(s.open_time,''), NULLIF(s.submit_time,''), s.updated_at) DESC
        LIMIT 100
      `).all(actor);

      // Detect overlapping trip intervals for the same delegate
      const conflicts = [];
      for (let i = 0; i < rows.length; i++) {
        for (let j = i + 1; j < rows.length; j++) {
          const a = rows[i], b = rows[j];
          if (a.delegate_id && a.delegate_id === b.delegate_id && a.depart_at && a.until_at && b.depart_at && b.until_at) {
            if (a.depart_at < b.until_at && b.depart_at < a.until_at) {
              conflicts.push({
                delegateName: a.delegateName || a.delegate_id,
                aTitle: a.noticeTitle || a.notice_id,
                bTitle: b.noticeTitle || b.notice_id,
                window: `${a.depart_at} ~ ${a.until_at} 与 ${b.depart_at} ~ ${b.until_at}`,
              });
            }
          }
        }
      }
      const selectedProjects = db.prepare(`
        SELECT m.id, m.title, m.deadline_text AS deadlineText
        FROM project_follow pf JOIN notice_meta m ON m.id=pf.notice_id
        WHERE pf.decision IN ('watching','bidding') AND ${followedLifecycleReadScope()}
          AND NOT EXISTS (SELECT 1 FROM notice_hidden h WHERE h.notice_id = m.id)
        ORDER BY pf.updated_at DESC
      `).all(actor);
      return json({ items: rows, conflicts, selectedProjects });
    }

    if (pathname === "/api/outcomes") {
      const actor = { $lifecycleActor: user.id };
      const rows = db.prepare(`
        SELECT o.*, m.title AS noticeTitle, c.name AS companyName
        FROM bid_outcome o
        LEFT JOIN notice_meta m ON m.id = o.notice_id
        LEFT JOIN company c ON c.id = o.company_id
        WHERE NOT EXISTS (SELECT 1 FROM notice_hidden h WHERE h.notice_id = o.notice_id)
          AND ${lifecycleReadScope("o", "o.company_id", "o.updated_by")}
        ORDER BY o.updated_at DESC
        LIMIT 100
      `).all(actor);
      const selectedProjects = db.prepare(`
        SELECT m.id, m.title FROM project_follow pf JOIN notice_meta m ON m.id=pf.notice_id
        WHERE pf.decision IN ('watching','bidding') AND ${followedLifecycleReadScope()}
          AND NOT EXISTS (SELECT 1 FROM notice_hidden h WHERE h.notice_id = m.id)
        ORDER BY pf.updated_at DESC
      `).all(actor);
      return json({ items: rows, selectedProjects });
    }

    if (pathname === "/api/matrix") {
      const companies = db.prepare(`SELECT c.id, c.name, g.verify FROM company c JOIN grant_company g ON c.id=g.company WHERE g.employee=? AND g.view=1 ORDER BY c.name`).all(user.id);
      const selectedProjects = db.prepare(`
        SELECT m.id, m.title, m.region, m.trade_type AS tradeType
        FROM project_follow pf JOIN notice_meta m ON m.id=pf.notice_id JOIN notice n ON n.id=m.id
        WHERE pf.decision IN ('watching','bidding') AND (n.draft=0 OR n.owner=?)
          AND NOT EXISTS (SELECT 1 FROM notice_hidden h WHERE h.notice_id=m.id)
        ORDER BY pf.updated_at DESC
      `).all(user.id);
      const recentTenders = db.prepare(`
        SELECT m.id,m.title,m.region,m.trade_type AS tradeType FROM notice_meta m JOIN notice n ON n.id=m.id
        WHERE m.stage='tender' AND (n.draft=0 OR n.owner=?)
          AND NOT EXISTS (SELECT 1 FROM notice_hidden h WHERE h.notice_id=m.id)
        ORDER BY m.published_ns DESC LIMIT 30
      `).all(user.id);

      let noticeId = (searchParams.get("noticeId") || "").trim();
      if (!noticeId) noticeId = selectedProjects[0]?.id || recentTenders[0]?.id || "";
      if (!noticeId) return json({ notice: null, companies, requirements: [], matrix: {}, selectedProjects, recentTenders });

      const noticeRow = visible(user.id, noticeId);
      if (!noticeRow) return missing();
      const version = searchParams.get("version") || "";
      const hasRevisions = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='legacy_public_revision'").get();
      const hasCustomVersions = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='custom_source_version'").get();
      const current = JSON.parse(noticeRow.data);
      const legacyVersions = hasRevisions ? db.prepare("SELECT version,observed_at AS observedAt FROM legacy_public_revision WHERE id=? ORDER BY version DESC LIMIT 30").all(noticeId) : [];
      const customVersions = hasCustomVersions ? db.prepare(`SELECT v.version_sha AS version, v.observed_at AS observedAt
        FROM custom_source_version v JOIN custom_source_observation o ON o.source_key=v.source_key AND o.url=v.url
        WHERE o.notice_id=? AND v.url=? ORDER BY v.observed_at DESC LIMIT 30`).all(noticeId, current.url || "") : [];
      const versions = [...legacyVersions, ...customVersions];
      let revision;
      if (version && /^\d+$/.test(version) && hasRevisions) {
        const row = db.prepare("SELECT payload,observed_at FROM legacy_public_revision WHERE id=? AND version=?").get(noticeId, version);
        if (row) revision = { notice: JSON.parse(row.payload), observedAt: new Date(Number(row.observed_at) / 1e6).toISOString() };
      } else if (version && /^[a-f0-9]{64}$/.test(version) && hasCustomVersions) {
        const row = db.prepare(`SELECT v.* FROM custom_source_version v JOIN custom_source_observation o ON o.source_key=v.source_key AND o.url=v.url
          WHERE o.notice_id=? AND v.url=? AND v.version_sha=?`).get(noticeId, current.url || "", version);
        if (row) revision = { notice: { ...current, title: row.title, body: row.body, attachments: JSON.parse(row.attachments_json),
          originalStatus: row.body_status === "captured" ? "captured" : "uncached",
          evidence: { bodyStatus: row.body_status, attachmentStatus: row.attachment_status } }, observedAt: row.observed_at };
      }
      if (version && !revision) return missing();
      const parsed = revision?.notice || current;
      const evidence = getNoticeEvidence(noticeId, parsed, user.id, revision?.observedAt);
      const requirements = evidence.requirements.map(req => ({
        ...req,
        logic: ({ conflict: "版本冲突", not_stated: "公告未写明", unavailable: "原文待取得" })[req.state] || "见原文",
        excerpt: req.entries[0]?.excerpt || "现有可读原文中未找到明确条款",
      }));
      const savedRows = revision ? [] : db.prepare("SELECT * FROM lot_matrix_cell WHERE notice_id=?").all(noticeId);
      const savedMap = new Map(savedRows.map(row => [`${row.req_key}::${row.company_id}`, row]));
      const matrix = {}, fingerprints = {}, histories = {};
      const basisRows = db.prepare("SELECT company_id,req_key,fingerprint FROM qualification_review_basis WHERE notice_id=?").all(noticeId);
      const bases = new Map(basisRows.map(row=>[row.req_key+"::"+row.company_id,row.fingerprint]));
      for (const comp of companies) {
        const { results,fingerprint } = companyMatch(noticeId,comp.id,evidence);
        fingerprints[comp.id] = fingerprint;
        const cells={};
        for (const result of results.requirements) {
          const cellKey = result.key+"::"+comp.id;
          const previous=savedMap.get(cellKey);
          const saved=bases.get(cellKey)===fingerprint ? previous : null;
          const stale=Boolean(previous && !saved);
          cells[result.key] = matrix[cellKey] = {
            status:saved?.status || result.status, basis:saved?.basis || result.reason,
            provenance:saved ? "人工核实值" : "公告与档案比对",
            updatedBy:saved?.updated_by_name || "", updatedAt:saved?.updated_at || "",
            documents:result.documents, previousReview:stale ? {status:previous.status,basis:previous.basis} : null
          };
        }
        if (!revision) histories[comp.id] = captureMatch(db,noticeId,comp.id,fingerprint,cells,evidence);
      }

      return json({
        notice: { id: noticeId, title: parsed.title, region: parsed.region, tradeType: parsed.tradeType, stageLabel: parsed.stageLabel },
        companies,
        requirements,
        matrix,
        evidence, versions, version, fingerprints, histories,
        selectedProjects,
        recentTenders,
      });
    }

    if (pathname === "/api/workbench/home") {
      // Homepage role is strictly bound to user.perspective (configured by admin in Settings)
      const perspective = perspectivePaths.has(user.perspective) ? user.perspective : "lead";
      const nowNs = Number(BigInt(Date.now()) * 1000000n);
      const companies = db.prepare(`SELECT c.id, c.name, g.edit, g.verify, g.sensitive_download AS sensitiveDownload
        FROM company c JOIN grant_company g ON c.id=g.company WHERE g.employee=? AND g.view=1 ORDER BY c.name`).all(user.id);
      const selectedProjects = db.prepare(`
        SELECT m.id, m.title, m.region, m.trade_type AS tradeType, m.stage, m.stage_label AS stageLabel,
               m.source, CAST(m.deadline_ns AS TEXT) AS deadline, m.deadline_text AS deadlineText,
               CASE WHEN m.budget_yuan IS NOT NULL THEN CAST(m.budget_yuan AS TEXT) ELSE NULL END AS budgetYuan,
               m.budget_text AS budgetText, pf.decision, pf.assignee AS assigneeId, emp.name AS assigneeName,
               pf.note, pf.updated_at AS updatedAt,
               (SELECT count(*) FROM notice_meta a JOIN notice rel ON rel.id=a.id JOIN notice base ON base.id=m.id WHERE a.project_key<>'' AND a.project_key=m.project_key AND a.stage='amendment' AND a.id<>m.id AND (rel.draft=0 OR (base.draft=1 AND rel.owner=base.owner)) AND radar_same_scope(base.data,rel.data)) AS amendmentCount
        FROM project_follow pf
        JOIN notice_meta m ON m.id = pf.notice_id
        JOIN notice n ON n.id=m.id
        LEFT JOIN employee emp ON emp.id = pf.assignee
        WHERE pf.decision IN ('watching', 'bidding') AND (n.draft=0 OR n.owner=?)
          AND NOT EXISTS (SELECT 1 FROM notice_hidden h WHERE h.notice_id=m.id)
        ORDER BY CASE WHEN m.deadline_ns > ? THEN 0 ELSE 1 END, CASE WHEN m.deadline_ns > 0 THEN m.deadline_ns ELSE 9999999999999999999 END ASC
        LIMIT 20
      `).all(user.id, nowNs);
      const openAlerts = db.prepare(`
        SELECT a.id, a.kind, a.notice_id AS noticeId, a.title, a.detail, a.status,
               a.assignee AS assigneeId, emp.name AS assigneeName, a.created_at AS createdAt
        FROM alert_todo a JOIN notice n ON n.id=a.notice_id LEFT JOIN employee emp ON emp.id = a.assignee
        WHERE a.status='open' AND (${alertStatus("a")})='open' AND ${projectAlertReadScope("a")}
        ORDER BY CASE a.kind WHEN 'amendment' THEN 0 WHEN 'deadline' THEN 1 WHEN 'todo' THEN 2 ELSE 3 END, a.created_at DESC
        LIMIT 15
      `).all({ $lifecycleActor: user.id });
      const openTenders = db.prepare(`SELECT count(*) AS c FROM notice_meta m JOIN notice n ON n.id=m.id
        WHERE (n.draft=0 OR n.owner=?) AND m.stage='tender' AND ${operationalDeadline}>? AND ${stillAvailable}
          AND NOT EXISTS (SELECT 1 FROM notice_hidden h WHERE h.notice_id=m.id)`).get(user.id, nowNs).c;
      const savedCount = db.prepare("SELECT count(*) AS c FROM saved_filter WHERE owner=? OR shared=1").get(user.id).c;

      // Precision Push: match open, non-expired tenders against user's authorized companies' registered qualifications
      const todayStr = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
      const companyCapabilities = [];
      const matchedOpportunities = [];
      if (companies.length) {
        const rawOpenRows = db.prepare(`
          SELECT m.id, m.title, m.region, m.trade_type AS tradeType, m.source, m.tenderer, m.stage, m.project_key AS projectKey, coalesce(json_extract(n.data,'$.lotKey'),json_extract(n.data,'$.lotId')) AS lot,json_extract(n.data,'$.round') AS round, json_extract(n.data,'$.evidence.originUrl') AS originUrl, m.url, n.data AS _rawData,
                 CAST(m.published_ns AS TEXT) AS published, CAST(m.deadline_ns AS TEXT) AS deadline,
                 m.deadline_text AS deadlineText,
                 CASE WHEN m.budget_yuan IS NOT NULL THEN CAST(m.budget_yuan AS TEXT) ELSE NULL END AS budgetYuan,
                 m.budget_text AS budgetText, m.qual_tags AS qualTags, pf.decision
          FROM notice_meta m
          JOIN notice n ON n.id=m.id AND (n.draft=0 OR n.owner=?)
          LEFT JOIN project_follow pf ON pf.notice_id = m.id
          WHERE m.stage = 'tender' AND ${operationalDeadline} > ? AND ${stillAvailable}
            AND NOT EXISTS (SELECT 1 FROM notice_hidden nh WHERE nh.notice_id = m.id)
          ORDER BY CASE WHEN m.deadline_ns > 0 THEN 0 ELSE 1 END ASC, m.deadline_ns ASC, m.published_ns DESC
          LIMIT 500
        `).all(user.id, nowNs);
        // Deduplicate multi-website duplicates before matching so home never shows duplicate projects
        const openRows = deduplicateNoticeRows(rawOpenRows);

        const capList = [];
        for (const comp of companies) {
          const docs = db.prepare("SELECT id, category, name, doc_no, qual_items_json, file_id, status, valid_until FROM company_doc WHERE company_id=? AND status<>'void'").all(comp.id);
          const personnel = db.prepare("SELECT id, name, role_title, cert_level, cert_valid_until, lock_status, status FROM company_person WHERE company_id=?").all(comp.id);
          const caps = { ...extractCompanyCapabilities(docs, todayStr), personnel };
          const labels = describeCapabilities(caps);
          const withFileCount = docs.filter((d) => d.file_id).length;
          const pendingCount = docs.filter((d) => d.status === "pending").length;
          companyCapabilities.push({ id: comp.id, name: comp.name, docCount: docs.length, pendingCount, withFileCount, labels });
          if (caps.safetyValid || caps.specs.some((s) => !s.expired)) {
            capList.push({ comp, caps });
          }
        }

        for (const { _rawData, ...row } of openRows) {
          if (!capList.length) break;
          const hits = [];
          const evidence = getNoticeEvidence(row.id, JSON.parse(_rawData), user.id);
          for (const { comp, caps } of capList) {
            const m = recommendedCompany(row.id, comp.id, evidence, caps);
            if (m) {
              hits.push({ companyId: comp.id, companyName: comp.name, reasons: m.reasons, warnings: m.warnings });
            }
          }
          if (hits.length) {
            matchedOpportunities.push({
              ...row,
              qualTags: row.qualTags ? row.qualTags.split(",").filter(Boolean) : [],
              matchedCompanies: hits,
            });
            if (matchedOpportunities.length >= 10) break;
          }
        }
      }

      return json({
        perspective,
        companies,
        companyCapabilities,
        matchedOpportunities,
        selectedProjects,
        openAlerts,
        stats: {
          openTenders,
          matchedCount: matchedOpportunities.length,
          selectedCount: selectedProjects.length,
          biddingCount: selectedProjects.filter((p) => p.decision === "bidding").length,
          openAlertCount: openAlerts.length,
          myAlertCount: openAlerts.filter((a) => a.assigneeId === user.id).length,
          savedFilterCount: savedCount,
        },
        pendingPayTasks: db.prepare(`
          SELECT t.*, m.title AS notice_title, m.region AS notice_region, c.name AS company_name
          FROM deposit_pay_task t
          LEFT JOIN notice_meta m ON m.id = t.notice_id
          LEFT JOIN company c ON c.id = t.company_id
          WHERE t.status = 'pending'
            AND NOT EXISTS (SELECT 1 FROM notice_hidden h WHERE h.notice_id = t.notice_id)
            AND NOT EXISTS (SELECT 1 FROM project_follow pf WHERE pf.notice_id = t.notice_id AND pf.decision = 'declined')
          ORDER BY t.created_at DESC
          LIMIT 20
        `).all(),
        upcomingSchedules: db.prepare(`
          SELECT s.*, m.title AS notice_title, m.region AS notice_region, emp.name AS delegate_name
          FROM bid_schedule s
          JOIN notice_meta m ON m.id = s.notice_id
          LEFT JOIN employee emp ON emp.id = s.delegate_id
          WHERE NOT EXISTS (SELECT 1 FROM notice_hidden h WHERE h.notice_id = s.notice_id)
            AND NOT EXISTS (SELECT 1 FROM project_follow pf WHERE pf.notice_id = s.notice_id AND pf.decision = 'declined')
          ORDER BY s.open_time ASC, s.updated_at DESC
          LIMIT 12
        `).all(),
        overdueDeposits: db.prepare(`
          SELECT fe.notice_id AS noticeId, m.title AS noticeTitle, coalesce(c.name, '默认公司') AS companyName,
                 sum(CASE WHEN fe.entry_type='paid' THEN fe.amount_fen WHEN fe.entry_type='refund_received' THEN -fe.amount_fen WHEN fe.entry_type='non_refund_deduct' THEN -fe.amount_fen ELSE 0 END) AS outFen,
                 min(fe.created_at) AS firstPaidAt
          FROM finance_entry fe
          JOIN notice_meta m ON m.id = fe.notice_id
          LEFT JOIN company c ON c.id = fe.company_id
          WHERE fe.reversed = 0 AND fe.category IN ('deposit', 'performance_cash')
            AND NOT EXISTS (SELECT 1 FROM notice_hidden h WHERE h.notice_id = fe.notice_id)
          GROUP BY fe.notice_id, fe.company_id
          HAVING outFen > 0
          ORDER BY firstPaidAt ASC
          LIMIT 10
        `).all(),
        syncMeta: getSyncMeta(),
      });
    }
    if (pathname === "/api/employees") {
      return json(db.prepare("SELECT id, username, name, role, perspective FROM employee WHERE approval='approved' ORDER BY username").all());
    }

    if (pathname === "/api/companies") {
      const today = new Date().toISOString().slice(0, 10);
      const soon = new Date(Date.now() + 30 * 86400 * 1000).toISOString().slice(0, 10);
      const rows = db.prepare(`SELECT c.id,c.name,g.edit,g.verify,g.sensitive_download AS sensitiveDownload
        FROM company c JOIN grant_company g ON c.id=g.company WHERE g.employee=? AND g.view=1 ORDER BY c.name`).all(user.id);
      return json(rows.map((c) => {
        const docs = db.prepare("SELECT status, valid_until FROM company_doc WHERE company_id=? AND status<>'void'").all(c.id);
        const peopleCount = db.prepare("SELECT count(*) AS cnt FROM company_person WHERE company_id=? AND status='active'").get(c.id).cnt;
        return {
          ...c,
          edit: !!c.edit, verify: !!c.verify, sensitiveDownload: !!c.sensitiveDownload,
          docCount: docs.length,
          peopleCount,
          gapMissing: docs.filter((d) => d.status === "missing").length,
          gapPending: docs.filter((d) => d.status === "pending").length,
          gapExpiring: docs.filter((d) => d.valid_until && d.valid_until >= today && d.valid_until <= soon).length,
          gapExpired: docs.filter((d) => d.valid_until && d.valid_until < today).length,
        };
      }));
    }

    const companyDetail = pathname.match(/^\/api\/companies\/([^/]+)$/);
    if (companyDetail) {
      const cid = companyDetail[1];
      const perm = grant(user.id, cid);
      if (!perm?.view) return denied(user.id, "查看公司档案", cid);
      const comp = db.prepare("SELECT id, name FROM company WHERE id=?").get(cid);
      if (!comp) return missing();
      const today = new Date().toISOString().slice(0, 10);
      const soon = new Date(Date.now() + 30 * 86400 * 1000).toISOString().slice(0, 10);
      const docs = db.prepare("SELECT * FROM company_doc WHERE company_id=? ORDER BY CASE status WHEN 'void' THEN 1 ELSE 0 END, updated_at DESC").all(cid).map((d) => ({
        ...d,
        doc_group: inferDocGroup(d.category, d.doc_group),
        expiryState: !d.valid_until ? "unknown" : d.valid_until < today ? "expired" : d.valid_until <= soon ? "expiring" : "valid",
      }));
      // Sensitive fields are NEVER sent in list/detail responses
      const people = db.prepare("SELECT id, company_id, name, role_title, cert_level, cert_valid_until, lock_status, social_status, social_until, file_id, file_name, status, updated_at, (id_card_secret<>'') AS hasIdCard, (phone_secret<>'') AS hasPhone, (cert_no_secret<>'') AS hasCertNo FROM company_person WHERE company_id=? ORDER BY status, name").all(cid);
      const history = db.prepare(`SELECT h.*, d.name AS doc_name FROM company_doc_history h JOIN company_doc d ON d.id=h.doc_id WHERE d.company_id=? ORDER BY h.seq DESC LIMIT 40`).all(cid);
      const profile = db.prepare("SELECT * FROM company_profile WHERE company_id=?").get(cid) || {
        company_id: cid, credit_code: "", legal_rep: "", reg_capital: "", bank_name: "", bank_account: "", address: "", contact_name: "", contact_phone: "", ca_expiry: "", remark: "",
      };
      return json({
        company: comp,
        profile,
        grant: { view: !!perm.view, edit: !!perm.edit, verify: !!perm.verify, sensitiveDownload: !!perm.sensitive_download },
        docs,
        people,
        history,
      });
    }

    // Export all active company qualification files + profile + CSV ledger as one ZIP
    const companyExportZip = pathname.match(/^\/api\/companies\/([^/]+)\/export-zip$/);
    if (companyExportZip) {
      const cid = companyExportZip[1];
      const perm = grant(user.id, cid);
      if (!perm?.view) return denied(user.id, "打包下载公司资质", cid);
      const comp = db.prepare("SELECT id, name FROM company WHERE id=?").get(cid);
      if (!comp) return missing();
      const docs = db.prepare("SELECT * FROM company_doc WHERE company_id=? AND status<>'void' ORDER BY updated_at DESC").all(cid);
      const people = db.prepare("SELECT id, name, role_title, cert_level, cert_valid_until, lock_status, social_status, social_until, file_id, file_name FROM company_person WHERE company_id=? AND status<>'void' ORDER BY name").all(cid);
      const profile = db.prepare("SELECT * FROM company_profile WHERE company_id=?").get(cid) || {};
      const workDir = await mkdtemp(join(tmpdir(), "br-zip-exp-"));
      try {
        const rootDir = join(workDir, "pkg");
        const zipOut = join(workDir, "bundle.zip");
        const safeName = (s) => String(s || "file").replace(/[\\/:*?"<>|\r\n]+/g, "_").slice(0, 80);
        const grpDir = {
          enterprise: "01_企业资质",
          credit_safety: "02_信用与安许",
          social_security: "03_社保与证明",
          performance: "04_业绩合同",
        };
        const lines = [
          `【${comp.name} · 投标资质打包清单】`,
          `导出时间：${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC`,
          profile.credit_code ? `统一社会信用代码：${profile.credit_code}` : "",
          profile.legal_rep ? `法定代表人：${profile.legal_rep}` : "",
          profile.reg_capital ? `注册资本：${profile.reg_capital}` : "",
          (profile.bank_name || profile.bank_account) ? `基本户：${profile.bank_name || "-"} / ${profile.bank_account || "-"}` : "",
          profile.ca_expiry ? `CA 锁有效期：${profile.ca_expiry}` : "",
          "",
          `一、在库有效资料（${docs.length} 项）`,
          ...docs.map((d, i) => `${i + 1}. [${d.category}] ${d.name}${d.doc_no ? `（证号：${d.doc_no}）` : ""} | 有效期：${d.valid_until || d.period_month || "未标注"} | 附件：${d.file_name || "无"}`),
          "",
          `二、关键人员（${people.length} 人）`,
          ...people.map((p, i) => `${i + 1}. ${p.name}（${p.role_title || "专职人员"}）| ${p.cert_level || "未标注"} | 有效期：${p.cert_valid_until || "未标注"} | 附件：${p.file_name || "无"}`),
        ].filter((x) => x !== "");
        const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
        const csvRows = [
          ["类型", "分类/岗位", "名称/姓名", "证书编号/等级", "发证机关/锁证状态", "有效期/参保月份", "核实/社保状态", "附件文件名"].map(q).join(","),
          ...docs.map((d) => ["企业资料", d.category, d.name, d.doc_no, d.issuer, d.valid_until || d.period_month, d.status, d.file_name].map(q).join(",")),
          ...people.map((p) => ["关键人员", p.role_title, p.name, p.cert_level, p.lock_status, p.cert_valid_until, p.social_status, p.file_name].map(q).join(",")),
        ];
        const manifest = [];
        manifest.push({ rel: "00_公司基础档案与资质清单.txt", path: join(workDir, "summary.txt") });
        await writeFile(join(workDir, "summary.txt"), lines.join("\n"), "utf-8");
        manifest.push({ rel: "00_公司资料与人员台账.csv", path: join(workDir, "ledger.csv") });
        await writeFile(join(workDir, "ledger.csv"), "\ufeff" + csvRows.join("\r\n"), "utf-8");

        const usedNames = new Set();
        let fileIdx = 0;
        const addFileRecord = async (folder, prefix, fileId) => {
          if (!fileId) return;
          const f = db.prepare("SELECT * FROM company_file WHERE id=? AND company_id=?").get(fileId, cid);
          if (!f) return;
          let bytes = null;
          try {
            if (f.storage_backend === "cos" && f.cos_key) {
              bytes = await cosGetObject(f.cos_key, f.sha256);
            } else if (f.bytes && f.bytes.length) {
              bytes = Buffer.from(f.bytes);
            }
          } catch { return; }
          if (!bytes || !bytes.length) return;
          const ext = extname(f.filename || "") || (f.mime_type === "application/pdf" ? ".pdf" : ".bin");
          let rel = `${folder}/${safeName(prefix)}_${safeName(f.filename || `file${ext}`)}`;
          if (usedNames.has(rel)) rel = `${folder}/${safeName(prefix)}_${++fileIdx}${ext}`;
          usedNames.add(rel);
          const tmpFile = join(workDir, `bin_${++fileIdx}`);
          await writeFile(tmpFile, bytes);
          manifest.push({ rel, path: tmpFile });
        };

        for (const d of docs) {
          const folder = grpDir[inferDocGroup(d.category, d.doc_group)] || "01_企业资质";
          await addFileRecord(folder, d.name, d.file_id);
        }
        for (const p of people) {
          await addFileRecord("05_关键人员证书", `${p.name}_${p.role_title || "证书"}`, p.file_id);
        }

        const manifestPath = join(workDir, "manifest.json");
        await writeFile(manifestPath, JSON.stringify(manifest), "utf-8");
        const pyZip = `
import sys, json, zipfile
mf, out_zip = sys.argv[1], sys.argv[2]
items = json.load(open(mf, 'r', encoding='utf-8'))
with zipfile.ZipFile(out_zip, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
  for it in items:
    zf.write(it['path'], arcname=it['rel'])
`;
        await execFileAsync("/usr/bin/python3", ["-c", pyZip, manifestPath, zipOut], { timeout: 60000 });
        const zipBytes = await readFile(zipOut);
        audit(user.id, "打包下载公司资质ZIP", `${comp.name} (${manifest.length}份文件)`, "已记录");
        const dlName = `${comp.name}_投标资质全套_${new Date().toISOString().slice(0, 10)}.zip`;
        const encoded = encodeURIComponent(dlName).replace(/['()*]/g, (ch) => "%" + ch.charCodeAt(0).toString(16));
        return new Response(zipBytes, {
          headers: {
            "Content-Type": "application/zip",
            "Content-Disposition": `attachment; filename*=UTF-8''${encoded}`,
            "Content-Length": String(zipBytes.length),
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      } catch (err) {
        return json({ message: `资质打包失败：${err.message || "请稍后重试"}` }, 500);
      } finally {
        await rm(workDir, { recursive: true, force: true }).catch(() => {});
      }
    }

    const noticeAttPreview = pathname.match(/^\/api\/notice-attachments\/([a-zA-Z0-9_-]+)$/);
    if (noticeAttPreview) {
      const a = db.prepare("SELECT * FROM notice_attachment_cache WHERE id=?").get(noticeAttPreview[1]);
      if (!a || !visible(user.id, a.notice_id)) return missing();
      if (a.status === "expired") {
        return json({ message: "该公告附件已超过 30 天存储周期，已按「一月一清」策略自动清理，请前往官方原文或重新拉取。" }, 410);
      }
      let fileBytes;
      try {
        fileBytes = await cosGetObject(a.cos_key, a.sha256);
      } catch (err) {
        return json({ message: "云端附件读取失败，请重新拉取入桶。" }, 502);
      }
      const isDownload = searchParams.get("download") === "1";
      const encodedName = encodeURIComponent(a.filename).replace(/['()*]/g, (ch) => "%" + ch.charCodeAt(0).toString(16));
      return new Response(fileBytes, {
        headers: {
          "Content-Type": a.mime_type,
          "Content-Disposition": `${isDownload ? "attachment" : "inline"}; filename*=UTF-8''${encodedName}`,
          "Content-Length": String(fileBytes.length),
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    const filePreview = pathname.match(/^\/api\/files\/([a-zA-Z0-9_-]+)$/);
    if (filePreview) {
      const f = db.prepare("SELECT * FROM company_file WHERE id=?").get(filePreview[1]);
      if (!f) return missing();
      const perm = grant(user.id, f.company_id);
      if (!perm?.view) return denied(user.id, "预览公司资料附件", f.id);
      let fileBytes = f.bytes;
      if (f.storage_backend === "cos" && f.cos_key) {
        try {
          fileBytes = await cosGetObject(f.cos_key, f.sha256);
        } catch (err) {
          audit(user.id, "预览公司资料附件", f.id, `COS读取失败(${err.message})`);
          return json({ message: "云端原件读取失败，请稍后重试。" }, 502);
        }
      }
      const isDownload = searchParams.get("download") === "1";
      const encodedName = encodeURIComponent(f.filename).replace(/['()*]/g, (ch) => "%" + ch.charCodeAt(0).toString(16));
      return new Response(fileBytes, {
        headers: {
          "Content-Type": f.mime_type,
          "Content-Disposition": `${isDownload ? "attachment" : "inline"}; filename*=UTF-8''${encodedName}`,
          "Content-Length": String(fileBytes.length),
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    const docDetail = pathname.match(/^\/api\/docs\/([a-zA-Z0-9_-]+)$/);
    if (docDetail) {
      const doc = db.prepare("SELECT * FROM company_doc WHERE id=?").get(docDetail[1]);
      if (!doc) return missing();
      const perm = grant(user.id, doc.company_id);
      if (!perm?.view) return denied(user.id, "查看资料详情", doc.id);
      const history = db.prepare("SELECT * FROM company_doc_history WHERE doc_id=? ORDER BY seq DESC").all(doc.id);
      return json({
        doc,
        grant: { view: !!perm.view, edit: !!perm.edit, verify: !!perm.verify, sensitiveDownload: !!perm.sensitive_download },
        history,
      });
    }

    if (pathname === "/api/gaps") {
      const today = new Date().toISOString().slice(0, 10);
      const soon = new Date(Date.now() + 30 * 86400 * 1000).toISOString().slice(0, 10);
      const companies = db.prepare(`SELECT c.id, c.name FROM company c JOIN grant_company g ON c.id=g.company WHERE g.employee=? AND g.view=1 ORDER BY c.name`).all(user.id);
      const items = [];
      const summary = companies.map((c) => {
        const docs = db.prepare("SELECT * FROM company_doc WHERE company_id=? AND status<>'void'").all(c.id);
        let missingCnt = 0, pendingCnt = 0, expiringCnt = 0, expiredCnt = 0;
        for (const d of docs) {
          if (d.status === "missing") { missingCnt++; items.push({ companyId: c.id, companyName: c.name, docId: d.id, name: d.name, category: d.category, gapType: "missing", validUntil: d.valid_until }); }
          else if (d.status === "pending") { pendingCnt++; items.push({ companyId: c.id, companyName: c.name, docId: d.id, name: d.name, category: d.category, gapType: "pending", validUntil: d.valid_until }); }
          if (d.valid_until && d.valid_until < today) { expiredCnt++; items.push({ companyId: c.id, companyName: c.name, docId: d.id, name: d.name, category: d.category, gapType: "expired", validUntil: d.valid_until }); }
          else if (d.valid_until && d.valid_until <= soon) { expiringCnt++; items.push({ companyId: c.id, companyName: c.name, docId: d.id, name: d.name, category: d.category, gapType: "expiring", validUntil: d.valid_until }); }
        }
        return { id: c.id, name: c.name, docCount: docs.length, missingCnt, pendingCnt, expiringCnt, expiredCnt };
      });
      return json({ summary, items, today });
    }

    const checksGetMatch = pathname.match(/^\/api\/opportunities\/(\d+)\/checks$/);
    if (checksGetMatch) {
      const noticeId = checksGetMatch[1];
      const noticeRow = visible(user.id, noticeId);
      if (!noticeRow) return missing();
      const parsed = JSON.parse(noticeRow.data);
      const companyId = (searchParams.get("companyId") || "").trim();
      let companyDocs = [], companyPeople = [];
      if (companyId) {
        if (!grant(user.id, companyId)?.view) return denied(user.id, "合规自检读取公司资料", companyId);
        companyDocs = db.prepare("SELECT * FROM company_doc WHERE company_id=? AND status<>'void'").all(companyId);
        companyPeople = db.prepare("SELECT id, name, role_title, cert_level, cert_valid_until, lock_status, status FROM company_person WHERE company_id=? AND status='active'").all(companyId);
      }
      const timeline = scopeTimeline(noticeId,parsed.projectKey,user.id);
      const savedChecks = db.prepare("SELECT * FROM lot_check_item WHERE notice_id=? AND company_id=?").all(noticeId, companyId);
      const checks = evaluateCompliance({ notice: parsed, timeline, companyDocs, companyPeople, savedChecks });
      return json({ companyId, checks });
    }

    if (pathname === "/api/opportunities") {
      const nowMs = Date.now();
      const nowNs = Number(BigInt(nowMs) * 1000000n);
      const tab = searchParams.get("tab") || "biddable";
      const onlyOpen = searchParams.get("onlyOpen") ?? (tab === "biddable" ? "1" : "0");
      const region = (searchParams.get("region") || "").trim();
      const tradeType = (searchParams.get("tradeType") || "").trim();
      const source = (searchParams.get("source") || "").trim();
      const qual = (searchParams.get("qual") || "").trim();
      const q = (searchParams.get("q") || "").trim();
      const minBudget = searchParams.get("minBudget") || "";
      const maxBudget = searchParams.get("maxBudget") || "";
      const matchCompanyId = (searchParams.get("matchCompanyId") || "").trim();
      const requestedMatchStatus = searchParams.get("matchStatus") || "hints";
      const matchStatus = ["hints", "supported", "partial", "archive_pending", "pending", "non_conform"].includes(requestedMatchStatus) ? requestedMatchStatus : "hints";
      const sort = searchParams.get("sort") || "published_desc";
      const page = Math.max(1, Number(searchParams.get("page") || 1) || 1);
      const pageSize = Math.min(100, Math.max(10, Number(searchParams.get("pageSize") || 30) || 30));

      let matchSummary = null;
      let companyDocs = [];
      let companyPersonnel = [];
      let candidates;
      let reviews = new Map();
      let pendingDocCount = 0;
      if (matchCompanyId) {
        if (!grant(user.id, matchCompanyId)?.view) return denied(user.id, "按公司资质筛选标讯", matchCompanyId);
        const comp = db.prepare("SELECT id, name FROM company WHERE id=?").get(matchCompanyId);
        if (!comp) return missing();
        companyDocs = companyInputs(db, matchCompanyId);
        pendingDocCount = companyDocs.filter((d) => d.status === "pending").length;
        companyPersonnel = db.prepare("SELECT id,name,role_title,cert_level,cert_valid_until,lock_status,status FROM company_person WHERE company_id=? ORDER BY id").all(matchCompanyId);
        candidates = companyScreeningCandidates(companyDocs, user.id);
        const savedReviews = db.prepare(`SELECT c.notice_id,c.req_key,c.status,c.basis,b.fingerprint FROM lot_matrix_cell c
          JOIN qualification_review_basis b ON b.notice_id=c.notice_id AND b.company_id=c.company_id AND b.req_key=c.req_key
          WHERE c.company_id=? AND c.status IN ('non_conform','pending','missing')`).all(matchCompanyId);
        for (const review of savedReviews) {
          if (!reviews.has(review.notice_id)) reviews.set(review.notice_id, []);
          reviews.get(review.notice_id).push(review);
        }
        matchSummary = {
          companyId: comp.id,
          companyName: comp.name,
          docCount: companyDocs.length,
          pendingDocCount,
          hasSearchableArchives: qualificationSearchTerms(companyDocs).length > 0,
          filter: matchStatus,
        };
      }

      const flagsRaw = (searchParams.get("flags") || "").trim();
      const activeFlags = new Set(flagsRaw ? flagsRaw.split(",").map((s) => s.trim()).filter(Boolean) : []);
      const needRawText = ["sme", "no_perf", "consortium", "no_deposit", "price_50", "lowest_price"].some((f) => activeFlags.has(f));
      const effectiveOnlyOpen = activeFlags.has("open") ? "1" : onlyOpen;

      let { where, args } = buildFilterWhere(
        { userId: user.id, tab, onlyOpen: effectiveOnlyOpen, region, tradeType, source, qual, q, minBudget, maxBudget },
        nowMs,
      );
      if (matchCompanyId) {
        if (matchStatus === "non_conform") {
          where += " AND m.id IN (SELECT value FROM json_each(?))";
          args.push(JSON.stringify([...reviews].filter(([, rows]) => rows.some(row => row.status === "non_conform")).map(([id]) => id)));
        } else if (matchStatus !== "pending") {
          where += " AND (m.id IN (SELECT value FROM json_each(?)) OR (m.project_key<>'' AND m.project_key IN (SELECT value FROM json_each(?))))";
          args.push(JSON.stringify([...candidates.notices, ...reviews.keys()]), JSON.stringify([...candidates.amendments]));
        }
      }

      let orderBy = "m.published_ns DESC, length(m.id) DESC, m.id DESC";
      if (sort === "deadline_asc") {
        orderBy = `CASE WHEN ${operationalDeadline} > ${nowNs} THEN 0 ELSE 1 END, CASE WHEN ${operationalDeadline}>0 THEN ${operationalDeadline} ELSE 9223372036854775807 END, m.published_ns DESC`;
      } else if (sort === "budget_desc") {
        orderBy = "CASE WHEN m.budget_yuan IS NOT NULL THEN 0 ELSE 1 END ASC, COALESCE(m.budget_yuan, 0) DESC, m.published_ns DESC";
      }

      const baseFrom = `FROM notice_meta m
        JOIN notice n ON n.id = m.id
        LEFT JOIN project_follow pf ON pf.notice_id = m.id
        LEFT JOIN employee emp ON emp.id = pf.assignee
        LEFT JOIN lot_workflow lw ON lw.notice_id = m.id`;

      const selectFields = `
          SELECT m.id, m.title, m.source, m.source_key AS sourceKey, m.tenderer, m.agency,
                 m.region, m.trade_type AS tradeType, m.category, m.stage, m.stage_label AS stageLabel,
                 m.project_key AS projectKey, coalesce(json_extract(n.data,'$.lotKey'),json_extract(n.data,'$.lotId')) AS lot, json_extract(n.data,'$.round') AS round, json_extract(n.data,'$.evidence.originUrl') AS originUrl, CAST(m.published_ns AS TEXT) AS published,
                 CAST(${operationalDeadline} AS TEXT) AS deadline, CASE WHEN ${operationalDeadline}=m.deadline_ns THEN m.deadline_text ELSE '' END AS deadlineText,
                 CASE WHEN m.budget_yuan IS NOT NULL THEN CAST(m.budget_yuan AS TEXT) ELSE NULL END AS budgetYuan,
                 m.budget_text AS budgetText, m.qual_tags AS qualTags, m.eval_method AS evalMethod,
                 m.deposit_text AS depositText, m.original_status AS originalStatus,
                 m.has_attachments AS hasAttachments, m.source_updated_at AS sourceUpdatedAt, m.url,
                 pf.decision, pf.assignee AS assigneeId, emp.name AS assigneeName,
                 CASE WHEN EXISTS(SELECT 1 FROM notice_attachment_document ad JOIN notice_attachment_cache ac ON ac.notice_id=ad.notice_id AND ac.att_idx=ad.att_idx AND ac.sha256=ad.sha256 JOIN json_each(n.data,'$.attachments') ja ON ja.key=ad.att_idx AND json_extract(ja.value,'$.url')=ad.source_url WHERE ad.notice_id=m.id AND ad.status='text') THEN 1 ELSE 0 END AS docRead,
                 ${needRawText || matchCompanyId ? "n.data AS _rawData," : ""}
                 (SELECT count(*) FROM notice_meta a JOIN notice rel ON rel.id=a.id JOIN notice base ON base.id=m.id WHERE a.project_key <> '' AND a.project_key = m.project_key AND a.stage = 'amendment' AND a.id <> m.id AND (rel.draft=0 OR (base.draft=1 AND rel.owner=base.owner)) AND radar_same_scope(base.data,rel.data)) AS amendmentCount,
                 (SELECT count(*) FROM notice_meta t JOIN notice rel ON rel.id=t.id JOIN notice base ON base.id=m.id WHERE t.project_key <> '' AND t.project_key = m.project_key AND (rel.draft=0 OR (base.draft=1 AND rel.owner=base.owner)) AND radar_same_scope(base.data,rel.data)) AS timelineCount
          ${baseFrom}
          WHERE ${where}
          ORDER BY ${orderBy}`;

      let total = 0;
      let items = [];
      let rawMatchedRows = db.prepare(selectFields).all(...args);
      if (activeFlags.size > 0) {
        rawMatchedRows = rawMatchedRows.filter((r) => {
          if (activeFlags.has("doc_read") && !r.docRead) return false;
          if (!needRawText) return true;
          const body = String(JSON.parse(r._rawData).body || "");
          const txt = `${body} ${r.evalMethod || ""} ${r.depositText || ""}`;
          if (activeFlags.has("sme") && !/(?:专门面向中小企业|面向中小企业|小微企业|预留份额|中小企业预留)/.test(txt)) return false;
          if (activeFlags.has("no_perf") || activeFlags.has("consortium") || activeFlags.has("no_deposit")) {
            const evidence = getNoticeEvidence(r.id, JSON.parse(r._rawData), user.id);
            if (activeFlags.has("no_perf") && !evidence.requirements.some(req => req.key === "REQ_PERFORMANCE" && req.state === "stated" && req.stance === "exempt")) return false;
            if (activeFlags.has("consortium") && !evidence.requirements.some(req => req.key === "REQ_JOINT" && req.state === "stated" && req.stance === "allowed")) return false;
            if (activeFlags.has("no_deposit") && (evidence.fields.deposit.state !== "stated" ||
                !evidence.fields.deposit.entries.every(entry => /免缴|不收取|无需缴纳|^0(?:\.0+)?元$/.test(entry.value)))) return false;
          }
          if (activeFlags.has("price_50") && !/(?:价格|报价)(?:分|权重|分值|部分)[^\d]{0,16}(?:[5-9]\d|100)/.test(txt)) return false;
          if (activeFlags.has("lowest_price") && !/(?:最低评标价|最低投标价|最低价中标|合理低价|经评审的最低)/.test(txt)) return false;
          return true;
        });
      }
      const compareCompany = (r, rawData) => {
        if (!candidates.notices.has(r.id) && !candidates.amendments.has(r.projectKey) && !reviews.has(r.id)) {
          return { status: "pending", proofs: [], aiExtracted: false };
        }
        const evidence = getNoticeEvidence(r.id, JSON.parse(rawData), user.id);
        const { results, fingerprint } = companyMatch(r.id, matchCompanyId, evidence, companyDocs, companyPersonnel);
        const activeReviews = (reviews.get(r.id) || []).filter(review => review.fingerprint === fingerprint);
        const negative = activeReviews.find(review => review.status === "non_conform");
        if (negative) return { status: "non_conform", proofs: [{ reason: negative.basis }], aiExtracted: Boolean(evidence.aiExtract) };
        const corpReqRes = results.requirements.find(req => req.key === "REQ_CORP_QUAL");
        const aiNoQualAtAll = Boolean(evidence.aiExtract && (!evidence.aiExtract.qualGroups || !evidence.aiExtract.qualGroups.length) && (!corpReqRes || corpReqRes.status !== "conform"));
        const coreCorpMissing = Boolean((corpReqRes && corpReqRes.status === "missing" && !(corpReqRes.relatedDocuments?.length)) || aiNoQualAtAll);
        const supported = coreCorpMissing ? [] : results.requirements.filter(req => !activeReviews.some(review => review.req_key === req.key) &&
          (req.status === "conform" || req.matchedDocuments?.length));
        const archival = coreCorpMissing ? [] : results.requirements.filter(req => !activeReviews.some(review => review.req_key === req.key) &&
          req.status === "pending" && (req.documents.length || req.relatedDocuments?.length));
        const pendingExtra = results.requirements.filter(req => req.status === "pending" && req.reason !== "公告未写明" && !req.documents.length);
        const status = coreCorpMissing ? "pending"
          : (results.outcome === "conform" && !activeReviews.length) ? "supported"
          : supported.length ? "partial"
          : archival.length ? "archive_pending" : "pending";
        const proofs = (coreCorpMissing ? [corpReqRes] : [...new Set([...supported, ...archival, ...pendingExtra])]).slice(0, 3).map(req => ({
          reqKey: req.key,
          excerpt: evidence.requirements.find(rule => rule.key === req.key)?.entries[0]?.excerpt,
          documents: [...new Set([...(req.matchedDocuments || []), ...(req.relatedDocuments || []), ...req.documents].map(doc => doc.label).filter(Boolean))],
          reason: req.reason,
          pendingDocIds: [...new Set((req.documents || []).map(doc => doc.id).filter(Boolean))],
        }));
        return {
          status,
          proofs,
          aiExtracted: Boolean(evidence.aiExtract),
          aiSummary: evidence.aiExtract?.summary || "",
        };
      };
      const parseQualTags = (raw) => {
        const s = String(raw || "").trim();
        if (!s) return [];
        if (s.startsWith("[")) {
          try {
            const arr = JSON.parse(s);
            if (Array.isArray(arr)) return arr.map((x) => String(x || "").trim()).filter(Boolean);
          } catch {}
        }
        return s.split(/[,，]/).map((x) => x.replace(/^["'\s\[\]]+|["'\s\[\]]+$/g, "")).filter(Boolean);
      };
      const itemsByFilter = rawMatchedRows.flatMap(({ _rawData, ...row }) => {
        const item = {
          ...row,
          qualTags: parseQualTags(row.qualTags),
          hasAttachments: !!row.hasAttachments,
          docRead: !!row.docRead,
        };
        if (!matchCompanyId) return [item];
        const companyMatch = compareCompany(row, _rawData);
        const states = { hints: ["supported", "partial", "archive_pending"] };
        if (!(states[matchStatus] || [matchStatus]).includes(companyMatch.status)) return [];
        return [{ ...item, companyMatch }];
      });
      // Sort supported -> partial -> archive_pending first when matching by company
      if (matchCompanyId && matchStatus === "hints") {
        const rankMap = { supported: 0, partial: 1, archive_pending: 2, pending: 3, non_conform: 4 };
        itemsByFilter.sort((a, b) => (rankMap[a.companyMatch?.status] ?? 9) - (rankMap[b.companyMatch?.status] ?? 9));
      }
      const deduped = deduplicateNoticeRows(itemsByFilter);
      total = deduped.length;
      items = deduped.slice((page - 1) * pageSize, page * pageSize);

      // Compute per-notice eligible companies  for all authorized companies
      const userCompanies = db.prepare(`SELECT c.id, c.name FROM company c JOIN grant_company g ON g.company=c.id WHERE g.employee=? AND g.view=1 ORDER BY c.id`).all(user.id);
      const allCoCaps = userCompanies.map((comp) => {
        const cDocs = db.prepare("SELECT id, category, name, qual_items_json, file_id, status, valid_until FROM company_doc WHERE company_id=? AND status<>'void'").all(comp.id);
        const cPersonnel = db.prepare("SELECT id, name, role_title, cert_level, cert_valid_until, lock_status, status FROM company_person WHERE company_id=?").all(comp.id);
        return { comp, shortName: shortCompanyName(comp.name), caps: { ...extractCompanyCapabilities(cDocs), personnel: cPersonnel } };
      });
      items = items.map((it) => {
        if (it.stage !== "tender") return { ...it, eligibleCompanies: [] };
        if (matchCompanyId) {
          const shortName = shortCompanyName(matchSummary.companyName);
          const eligibleCompanies = (it.companyMatch.status === "supported" || it.companyMatch.status === "partial") && Number(it.deadline) > nowNs
            ? [{ id: matchCompanyId, name: matchSummary.companyName, shortName, reasons: it.companyMatch.proofs.map(proof => proof.reason) }] : [];
          return { ...it, eligibleCompanies };
        }
        const eligibleCompanies = [];
        const notice = allCoCaps.length > 0 && visible(user.id, it.id);
        if (!notice) return { ...it, eligibleCompanies };
        const evidence = getNoticeEvidence(it.id, JSON.parse(notice.data), user.id);
        for (const { comp, shortName, caps } of allCoCaps) {
          const m = recommendedCompany(it.id, comp.id, evidence, caps);
          if (m) {
            eligibleCompanies.push({ id: comp.id, name: comp.name, shortName, reasons: m.reasons });
          }
        }
        return { ...it, eligibleCompanies };
      });
      const companyOptions = allCoCaps.map(({ comp, shortName }) => ({ id: comp.id, name: comp.name, shortName }));

      // Fast tab counts & facets
      const counts=db.prepare(`SELECT COUNT(*) AS all_count,
        COUNT(*) FILTER (WHERE m.stage='tender') AS biddable,
        COUNT(*) FILTER (WHERE m.stage='tender' AND ${operationalDeadline}>? AND ${stillAvailable}) AS openBiddable,
        COUNT(*) FILTER (WHERE m.stage IN ('amendment','suspended')) AS amendments,
        COUNT(*) FILTER (WHERE m.stage='intent') AS intent,
        COUNT(*) FILTER (WHERE m.stage IN ('result','terminated','contract')) AS results,
        COUNT(*) FILTER (WHERE pf.decision IN ('watching','bidding')) AS followed
        FROM notice_meta m JOIN notice n ON n.id=m.id LEFT JOIN project_follow pf ON pf.notice_id=m.id
        WHERE (n.draft=0 OR n.owner=?) AND NOT EXISTS(SELECT 1 FROM notice_hidden h WHERE h.notice_id=m.id)`).get(nowNs,user.id);
      const tabCounts={...counts,all:counts.all_count};
      const regions = db.prepare("SELECT region AS value, count(*) AS cnt FROM notice_meta WHERE region<>'' GROUP BY region ORDER BY cnt DESC LIMIT 20").all();
      const tradeTypes = db.prepare("SELECT trade_type AS value, count(*) AS cnt FROM notice_meta WHERE trade_type<>'' GROUP BY trade_type ORDER BY cnt DESC LIMIT 20").all();
      const sources = db.prepare("SELECT source AS value, count(*) AS cnt FROM notice_meta WHERE source<>'' GROUP BY source ORDER BY cnt DESC LIMIT 30").all();
      const openAlerts = db.prepare(`SELECT count(*) AS c FROM alert_todo a WHERE a.status='open' AND (${alertStatus("a")})='open'
        AND ${projectAlertReadScope("a")}`).get({ $lifecycleActor: user.id }).c
        + db.prepare(`SELECT count(*) AS c FROM company_expiry_todo e WHERE e.status='open' AND ${expiryReadScope("e")}`).get(actorBinding(user.id)).c;

      return json({
        items, total, page, pageSize, tabCounts, openAlerts, matchSummary, companyOptions,
        facets: { regions, tradeTypes, sources },
        syncMeta: getSyncMeta(),
      });
    }

    const snapMatch = pathname.match(/^\/api\/opportunities\/(\d+)\/official-snapshot$/);
    if (snapMatch) {
      const nid = snapMatch[1];
      const notice = visible(user.id, nid);
      if (!notice) return missing();
      const parsed = JSON.parse(notice.data);
      const cached = db.prepare("SELECT html, source_url, fetched_at FROM notice_html_cache WHERE notice_id=?").get(nid);
      if (cached && cached.html && searchParams.get("refresh") !== "1") {
        return json({ ok: true, html: cached.html, sourceUrl: cached.source_url, fetchedAt: cached.fetched_at, cached: true });
      }
      const targetUrl = String(parsed.url || "").trim();
      if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
        return json({ ok: false, message: "该公告未提供官方原文链接。" }, 404);
      }
      try {
        const ctl = new AbortController();
        const tmr = setTimeout(() => ctl.abort(), 12000);
        const res = await fetchPublic(targetUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36" },
          signal: ctl.signal,
        });
        clearTimeout(tmr);
        if (!res.ok) return json({ ok: false, message: `官方站点响应 ${res.status}，请直接点击「打开官方原文」查看。` }, 502);
        const rawHtml = await res.text();
        // Extract main article/content block when recognizable, otherwise body
        let frag = rawHtml;
        const bodyM = rawHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        if (bodyM) frag = bodyM[1];
        // Strip dangerous tags & scripts/styles/navs while keeping tables, headings, paragraphs, images
        frag = frag
          .replace(/<(script|style|iframe|object|embed|form|nav|header|footer|noscript)[^>]*>[\s\S]*?<\/\1>/gi, "")
          .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
          .replace(/javascript:/gi, "blocked:")
          .trim();
        // Resolve relative img src against targetUrl
        try {
          const base = new URL(targetUrl);
          frag = frag.replace(/(<img\b[^>]*\bsrc\s*=\s*["'])([^"']+)(["'])/gi, (all, pre, src, post) => {
            if (/^https?:|^data:/i.test(src)) return all;
            try { return pre + new URL(src, base).href + post; } catch { return all; }
          });
        } catch {}
        const safeHtml = frag.slice(0, 180000);
        db.prepare("INSERT OR REPLACE INTO notice_html_cache(notice_id, source_url, html, fetched_at) VALUES (?,?,?,CURRENT_TIMESTAMP)")
          .run(nid, targetUrl, safeHtml);
        return json({ ok: true, html: safeHtml, sourceUrl: targetUrl, fetchedAt: new Date().toISOString(), cached: false });
      } catch (err) {
        return json({ ok: false, message: `拉取官方排版快照超时或失败（${err?.message || "网络受限"}），下方已自动按官方公文格式排版展示正文。` }, 502);
      }
    }

    const detail = pathname.match(/^\/api\/opportunities\/(\d+)$/);
    if (detail) {
      const notice = visible(user.id, detail[1]);
      if (!notice) return missing();
      const parsed = JSON.parse(notice.data);
      const scopes = db.prepare(`SELECT s.data FROM scope s JOIN grant_company g ON s.company=g.company
        WHERE s.notice=? AND g.employee=? AND g.view=1 ORDER BY s.lot,s.round,s.company`).all(detail[1], user.id);

      const timeline = scopeTimeline(detail[1],parsed.projectKey,user.id);

      const sourceHealth = parsed.sourceKey
        ? db.prepare("SELECT key, name, enabled, checked, last_ok AS lastOk, failures, reason, last_error AS lastError FROM source_health WHERE key=?").get(parsed.sourceKey)
        : null;

      if (sourceHealth?.lastError) sourceHealth.lastError = collectorFailure(sourceHealth.lastError, sourceHealth.reason).message;
      const follow = db.prepare(`
        SELECT pf.decision, pf.assignee AS assigneeId, emp.name AS assigneeName, pf.note, pf.updated_at AS updatedAt
        FROM project_follow pf LEFT JOIN employee emp ON emp.id = pf.assignee
        WHERE pf.notice_id = ? AND ${followedLifecycleReadScope()}
      `).get({ $lifecycleActor: user.id }, detail[1]) || null;

      const alerts = db.prepare(`
        SELECT a.id, a.kind, a.title, a.detail, ${alertStatus("a")} AS status, a.assignee AS assigneeId, emp.name AS assigneeName,
               CAST(a.due_ns AS TEXT) AS due, a.created_at AS createdAt
        FROM alert_todo a LEFT JOIN employee emp ON emp.id = a.assignee
        WHERE a.notice_id IN (SELECT value FROM json_each(?)) AND ${projectAlertReadScope("a")}
        ORDER BY CASE WHEN status='open' THEN 0 ELSE 1 END, a.created_at DESC
        LIMIT 20
      `).all({ $lifecycleActor: user.id }, JSON.stringify([detail[1],...timeline.map(row=>row.id)]));

      const amendmentDiff = (() => {
        if (!timeline.length || timeline.length < 2) return null;
        const currIdx = timeline.findIndex((t) => t.id === detail[1]);
        let cmpItem = null;
        if (parsed.stage === "amendment" && currIdx > 0) {
          cmpItem = timeline[currIdx - 1];
        } else if (parsed.stage === "tender") {
          const ams = timeline.filter((t) => t.stage === "amendment" && t.id !== detail[1]);
          if (ams.length) cmpItem = ams[ams.length - 1];
        }
        if (!cmpItem) return null;
        const cmpRow = visible(user.id,cmpItem.id);
        if (!cmpRow) return null;
        let cmp;
        try { cmp = JSON.parse(cmpRow.data); } catch { return null; }
        const fmtB = (x) => x.budgetText || (x.budgetYuan && Number(x.budgetYuan) > 0 ? `${(Number(x.budgetYuan) / 10000).toFixed(2)}万元` : "未标注");
        const fmtQ = (x) => Array.isArray(x.qualTags) && x.qualTags.length ? x.qualTags.join("、") : (Array.isArray(x.qualifications) && x.qualifications.length ? x.qualifications[0].slice(0, 60) : "未标注");
        const pairs = [
          { field: "预算 / 控制价", base: fmtB(cmp), curr: fmtB(parsed) },
          { field: "报名 / 递交截止", base: cmp.deadlineText || "未标注", curr: parsed.deadlineText || "未标注" },
          { field: "开标时间", base: cmp.openTimeText || "未标注", curr: parsed.openTimeText || "未标注" },
          { field: "评标办法", base: cmp.evalMethod || "未标注", curr: parsed.evalMethod || "未标注" },
          { field: "资格条件摘录", base: fmtQ(cmp), curr: fmtQ(parsed) },
        ].map((r) => ({ ...r, changed: r.base !== r.curr }));
        return {
          comparedId: cmpItem.id,
          comparedTitle: cmpItem.title,
          comparedStageLabel: cmpItem.stageLabel || cmpItem.stage,
          direction: parsed.stage === "amendment" ? "本更正公告 vs 上一版本" : "本招标公告 vs 最新更正公告",
          items: pairs,
        };
      })();

      const lifecycle = (() => {
        const noticeId = detail[1];
        const actor = { $lifecycleActor: user.id };
        const wf = lifecycleWorkflowFiles(db.prepare(`SELECT w.* FROM lot_workflow w WHERE w.notice_id=?
          AND ${lifecycleReadScope("w", "w.company_id", "w.updated_by")}`).get(actor, noticeId), user.id);
        const finRows = db.prepare(`SELECT f.* FROM finance_entry f WHERE f.notice_id=? AND f.reversed=0
          AND ${lifecycleReadScope("f", "f.company_id", "f.actor")} ORDER BY f.created_at DESC`).all(actor, noticeId);
        let depositPaidFen = 0;
        let depositRefundedFen = 0;
        let guaranteeFen = 0;
        let expenseFen = 0;
        for (const r of finRows) {
          if (r.category === "deposit" && r.entry_type === "paid") depositPaidFen += r.amount_fen;
          if (r.category === "deposit" && r.entry_type === "refund_received") depositRefundedFen += r.amount_fen;
          if (r.category === "guarantee" && r.entry_type === "guarantee_face") guaranteeFen += r.amount_fen;
          if (r.category === "expense" && r.entry_type === "paid") expenseFen += r.amount_fen;
        }
        const sch = db.prepare(`SELECT s.*, e.name AS delegateName FROM bid_schedule s LEFT JOIN employee e ON e.id=s.delegate_id
          WHERE s.notice_id=? AND ${lifecycleReadScope("s", "s.company_id", "s.updated_by")}
          ORDER BY s.updated_at DESC LIMIT 1`).get(actor, noticeId) || null;
        const opnRaw = db.prepare(`SELECT o.* FROM opening_record o WHERE o.notice_id=?
          AND ${lifecycleReadScope("o", "''", "o.actor")} ORDER BY o.version DESC LIMIT 1`).get(actor, noticeId) || null;
        const opn = opnRaw ? {
          ...opnRaw,
          bids: (() => { try { return JSON.parse(opnRaw.bids_json || "[]"); } catch { return []; } })(),
        } : null;
        const estRaw = db.prepare(`SELECT e.* FROM bid_estimate e WHERE e.notice_id=?
          AND ${lifecycleReadScope("e", "''", "e.actor")} ORDER BY e.version DESC LIMIT 1`).get(actor, noticeId) || null;
        const est = estRaw ? {
          ...estRaw,
          result: (() => { try { return JSON.parse(estRaw.result_json || "{}"); } catch { return {}; } })(),
        } : null;
        const out = db.prepare(`SELECT o.* FROM bid_outcome o WHERE o.notice_id=?
          AND ${lifecycleReadScope("o", "o.company_id", "o.updated_by")} ORDER BY o.updated_at DESC LIMIT 1`).get(actor, noticeId) || null;

        let computedStep = wf?.active_step || 1;
        if (out && (out.final_result !== "未标注" || (wf?.refund_track_status && wf.refund_track_status !== "未进入退保"))) computedStep = 7;
        else if (est || (wf?.predict_status && wf.predict_status !== "待分析")) computedStep = Math.max(computedStep, 6);
        else if (opn || wf?.opening_sheet_file_id) computedStep = Math.max(computedStep, 5);
        else if (sch) computedStep = Math.max(computedStep, 4);
        else if (depositPaidFen > 0 || guaranteeFen > 0) computedStep = Math.max(computedStep, 3);
        else if (wf?.prep_status && wf.prep_status !== "未开始") computedStep = Math.max(computedStep, 2);
        else if (wf?.doc_buy_status && wf.doc_buy_status !== "未获取") computedStep = Math.max(computedStep, 2);

        const companyPeople = db.prepare(`
          SELECT p.id, p.company_id AS companyId, c.name AS companyName, p.name, p.role_title AS roleTitle,
                 p.cert_level AS certLevel, p.cert_valid_until AS certValidUntil,
                 p.lock_status AS lockStatus, p.social_status AS socialStatus, p.social_until AS socialUntil,
                 (SELECT count(*) FROM lot_workflow lw WHERE lw.prep_pm_person_id = p.id AND lw.notice_id <> ?
                   AND ${lifecycleReadScope("lw", "lw.company_id", "lw.updated_by")}) AS activeBidCount
          FROM company_person p
          JOIN company c ON c.id = p.company_id
          JOIN grant_company g ON g.company = p.company_id AND g.employee = ? AND g.view = 1
          WHERE p.status = 'active'
          ORDER BY p.lock_status ASC, p.name ASC
        `).all(actor, noticeId, user.id);

        const cachedAttachments = db.prepare(`
          SELECT id, att_idx AS attIdx, filename, mime_type AS mimeType, size_bytes AS sizeBytes,
                 status, downloaded_at AS downloadedAt, expires_at AS expiresAt
          FROM notice_attachment_cache
          WHERE notice_id = ? AND status = 'cached' AND expires_at > CURRENT_TIMESTAMP
          ORDER BY att_idx ASC
        `).all(noticeId);

        const refinedDist = refineDistrict(parsed.region, parsed.title, parsed.tenderer);
        const distPairs = db.prepare(`
          SELECT t.budget_yuan AS ctrlYuan, r.budget_yuan AS winYuan, t.tenderer, r.region, r.title, r.trade_type AS tradeType
          FROM notice_meta t
          JOIN notice_meta r ON r.project_key = t.project_key AND t.project_key <> ''
          JOIN notice tn ON tn.id=t.id AND (tn.draft=0 OR tn.owner=$lifecycleActor)
          JOIN notice rn ON rn.id=r.id AND (rn.draft=0 OR rn.owner=$lifecycleActor)
          WHERE t.stage = 'tender' AND r.stage IN ('result', 'contract')
            AND t.budget_yuan > 0 AND r.budget_yuan > r.budget_yuan * 0 AND t.budget_yuan > r.budget_yuan
            AND (t.budget_yuan - r.budget_yuan) * 1.0 / t.budget_yuan <= 0.65
          LIMIT 500
        `).all(actor);
        const distFloats = [];
        const unitFloats = [];
        const curBudget = Number(parsed.budgetYuan || 0) || Number(db.prepare("SELECT budget_yuan FROM notice_meta WHERE id=?").get(noticeId)?.budget_yuan || 0);
        const budgetTier = (v) => v < 1_000_000 ? 1 : v < 5_000_000 ? 2 : v < 20_000_000 ? 3 : 4;
        const curTier = curBudget > 0 ? budgetTier(curBudget) : 0;
        const ratiosExact = []; // same district + same trade + same tier
        const ratiosTrade = []; // same city + same trade
        const ratiosAll = [];   // same city all paired tenders
        for (const dp of distPairs) {
          const fl = ((dp.ctrlYuan - dp.winYuan) / dp.ctrlYuan) * 100;
          if (fl <= 0 || fl > 65) continue;
          const ratio = dp.winYuan / dp.ctrlYuan;
          const sameDist = refineDistrict(dp.region, dp.title, dp.tenderer) === refinedDist;
          const sameTrade = parsed.tradeType && dp.tradeType === parsed.tradeType;
          const sameTier = curTier > 0 && budgetTier(dp.ctrlYuan) === curTier;
          if (sameDist) distFloats.push(fl);
          if (parsed.tenderer && dp.tenderer === parsed.tenderer) unitFloats.push(fl);
          if (sameDist && sameTrade && sameTier) ratiosExact.push(ratio);
          if (sameTrade) ratiosTrade.push(ratio);
          ratiosAll.push(ratio);
        }
        const avgFl = (arr) => arr.length ? Number((arr.reduce((s, x) => s + x, 0) / arr.length).toFixed(2)) : null;
        const quantile = (sorted, q) => {
          if (!sorted.length) return 0;
          const pos = (sorted.length - 1) * q;
          const base = Math.floor(pos);
          const rest = pos - base;
          return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
        };
        let estimatedDealPrice = null;
        if (curBudget > 0 && ratiosAll.length >= 3) {
          let chosen = ratiosAll;
          let scopeLabel = "同市全样本";
          if (ratiosExact.length >= 12) { chosen = ratiosExact; scopeLabel = "同类同区同预算档"; }
          else if (ratiosTrade.length >= 12) { chosen = ratiosTrade; scopeLabel = "同市同类"; }
          const sorted = [...chosen].sort((a, b) => a - b);
          const p10 = quantile(sorted, 0.10);
          const p50 = quantile(sorted, 0.50);
          const p90 = quantile(sorted, 0.90);
          const absErrs = sorted.map((r) => Math.abs(r - p50) / Math.max(0.01, r) * 100).sort((a, b) => a - b);
          const medianErrPct = Math.round(quantile(absErrs, 0.50));
          const p90ErrPct = Math.round(quantile(absErrs, 0.90));
          const inBand = sorted.filter((r) => r >= p10 && r <= p90).length;
          const coveragePct = Math.round((inBand / sorted.length) * 100);
          estimatedDealPrice = {
            budgetYuan: curBudget,
            estLowYuan: Math.round(curBudget * p10),
            estMidYuan: Math.round(curBudget * p50),
            estHighYuan: Math.round(curBudget * p90),
            p10Ratio: Number(p10.toFixed(4)),
            p50Ratio: Number(p50.toFixed(4)),
            p90Ratio: Number(p90.toFixed(4)),
            sampleCount: sorted.length,
            scopeLabel,
            medianErrPct,
            p90ErrPct,
            coveragePct,
          };
        }

        const payTasks = db.prepare(`
          SELECT t.*, c.name AS company_name
          FROM deposit_pay_task t
          LEFT JOIN company c ON c.id = t.company_id
          WHERE t.notice_id = ?
            AND ${lifecycleReadScope("t", "t.company_id", "t.requested_by")}
          ORDER BY t.created_at DESC
        `).all(actor, noticeId).map(task => lifecyclePayment(task, user.id));
        const defFin = getDefaultFinanceEmployee();

        return {
          computedStep,
          workflow: wf,
          companyPeople,
          cachedAttachments,
          payTasks,
          defaultFinance: defFin ? { id: defFin.id, name: defFin.name, username: defFin.username } : null,
          estimatedDealPrice,
          localFloatBenchmark: {
            district: refinedDist,
            districtSampleCount: distFloats.length,
            districtAvgFloatPct: avgFl(distFloats),
            tendererSampleCount: unitFloats.length,
            tendererAvgFloatPct: avgFl(unitFloats),
          },
          financeSummary: {
            depositPaidFen,
            depositRefundedFen,
            depositOutstandingFen: Math.max(0, depositPaidFen - depositRefundedFen),
            guaranteeFen,
            expenseFen,
            entries: finRows.slice(0, 12),
          },
          schedule: sch,
          opening: opn,
          estimate: est,
          outcome: out,
        };
      })();

      return json({
        ...parsed,
        scopes: scopes.map((row) => JSON.parse(row.data)),
        timeline,
        amendmentDiff,
        evidence: getNoticeEvidence(detail[1], parsed, user.id),
        sourceHealth,
        follow,
        alerts,
        lifecycle,
        buyerIntel: (() => {
          if (!parsed.tenderer) return null;
          const stats = db.prepare(`
            SELECT count(*) AS totalNotices,
                   sum(CASE WHEN stage='tender' THEN 1 ELSE 0 END) AS tenderCount,
                   sum(CASE WHEN stage='result' THEN 1 ELSE 0 END) AS resultCount,
                   sum(CASE WHEN stage='amendment' THEN 1 ELSE 0 END) AS amendmentCount,
                   sum(COALESCE(budget_yuan, 0)) AS totalBudgetYuan
            FROM notice_meta WHERE tenderer = ?
          `).get(parsed.tenderer);
          const topAgencies = db.prepare(`
            SELECT agency AS name, count(*) AS cnt
            FROM notice_meta WHERE tenderer = ? AND agency <> ''
            GROUP BY agency ORDER BY cnt DESC LIMIT 5
          `).all(parsed.tenderer);
          const recentNotices = db.prepare(`
            SELECT id, title, stage, stage_label AS stageLabel, CAST(published_ns AS TEXT) AS published,
                   budget_text AS budgetText, agency
            FROM notice_meta WHERE tenderer = ? AND id <> ?
            ORDER BY published_ns DESC LIMIT 6
          `).all(parsed.tenderer, detail[1]);
          const recentResults = db.prepare(`
            SELECT m.id, m.title, m.budget_text AS budgetText, m.budget_yuan AS budgetYuan,
                   CAST(m.published_ns AS TEXT) AS published, n.data
            FROM notice_meta m JOIN notice n ON n.id = m.id
            WHERE m.tenderer = ? AND m.stage = 'result'
            ORDER BY m.published_ns DESC LIMIT 5
          `).all(parsed.tenderer).map((r) => {
            let p = {};
            try { p = JSON.parse(r.data); } catch {}
            return {
              id: r.id,
              title: r.title,
              published: r.published,
              winner: p.winner || "未标注",
              budgetText: r.budgetText || (r.budgetYuan > 0 ? `${(r.budgetYuan / 10000).toFixed(2)}万元` : "未标注"),
              evalMethod: p.evalMethod || "",
            };
          });
          return {
            tenderer: parsed.tenderer,
            totalNotices: stats?.totalNotices ?? 0,
            tenderCount: stats?.tenderCount ?? 0,
            resultCount: stats?.resultCount ?? 0,
            amendmentCount: stats?.amendmentCount ?? 0,
            totalBudgetYuan: String(stats?.totalBudgetYuan ?? 0),
            topAgencies,
            recentNotices,
            recentResults,
          };
        })(),
        syncMeta: getSyncMeta(),
      });
    }

    if (pathname === "/api/entities") {
      const kind = searchParams.get("kind") || "tenderer"; // tenderer | agency
      const q = (searchParams.get("q") || "").trim();
      const name = (searchParams.get("name") || "").trim();

      if (name) {
        const col = kind === "agency" ? "agency" : "tenderer";
        const partnerCol = kind === "agency" ? "tenderer" : "agency";
        const stats = db.prepare(`
          SELECT count(*) AS totalNotices,
                 sum(CASE WHEN stage='tender' THEN 1 ELSE 0 END) AS tenderCount,
                 sum(CASE WHEN stage='result' THEN 1 ELSE 0 END) AS resultCount,
                 sum(CASE WHEN stage='amendment' THEN 1 ELSE 0 END) AS amendmentCount,
                 sum(CASE WHEN stage='intent' THEN 1 ELSE 0 END) AS intentCount,
                 sum(COALESCE(budget_yuan, 0)) AS totalBudgetYuan
          FROM notice_meta WHERE ${col} = ?
        `).get(name);
        const partners = db.prepare(`
          SELECT ${partnerCol} AS name, count(*) AS cnt
          FROM notice_meta WHERE ${col} = ? AND ${partnerCol} <> ''
          GROUP BY ${partnerCol} ORDER BY cnt DESC LIMIT 10
        `).all(name);
        const regions = db.prepare(`
          SELECT region AS name, count(*) AS cnt
          FROM notice_meta WHERE ${col} = ? AND region <> ''
          GROUP BY region ORDER BY cnt DESC LIMIT 8
        `).all(name);
        const tradeTypes = db.prepare(`
          SELECT trade_type AS name, count(*) AS cnt
          FROM notice_meta WHERE ${col} = ? AND trade_type <> ''
          GROUP BY trade_type ORDER BY cnt DESC LIMIT 8
        `).all(name);
        const rawNotices = db.prepare(`
          SELECT m.id, m.title, stage, stage_label AS stageLabel, region, trade_type AS tradeType, project_key AS projectKey,
                 tenderer, agency, source, CAST(published_ns AS TEXT) AS published,
                 CAST(deadline_ns AS TEXT) AS deadline, deadline_text AS deadlineText,
                 CASE WHEN budget_yuan IS NOT NULL THEN CAST(budget_yuan AS TEXT) ELSE NULL END AS budgetYuan,
                 budget_text AS budgetText,m.url,
                 coalesce(json_extract(n.data,'$.lotKey'),json_extract(n.data,'$.lotId')) AS lot,
                 json_extract(n.data,'$.round') AS round,json_extract(n.data,'$.evidence.originUrl') AS originUrl
          FROM notice_meta m JOIN notice n ON n.id=m.id
          WHERE ${col} = ? AND (n.draft=0 OR n.owner=?) AND NOT EXISTS (SELECT 1 FROM notice_hidden nh WHERE nh.notice_id = m.id)
          ORDER BY published_ns DESC LIMIT 120
        `).all(name,user.id);
        const notices = deduplicateNoticeRows(rawNotices).slice(0, 60);
        const dedupTotalBudget = notices.reduce((s, x) => s + (x.budgetYuan ? Number(x.budgetYuan) : 0), 0);
        return json({
          profile: {
            kind, name,
            totalNotices: notices.length,
            tenderCount: notices.filter((x) => x.stage === "tender").length,
            resultCount: notices.filter((x) => x.stage === "result").length,
            amendmentCount: notices.filter((x) => x.stage === "amendment").length,
            intentCount: notices.filter((x) => x.stage === "intent").length,
            totalBudgetYuan: String(dedupTotalBudget || stats?.totalBudgetYuan || 0),
            partners, regions, tradeTypes, notices,
          },
        });
      }

      const col = kind === "agency" ? "agency" : "tenderer";
      const like = q ? `%${q}%` : "%";
      const list = db.prepare(`
        SELECT ${col} AS name,
               count(*) AS totalNotices,
               sum(CASE WHEN stage='tender' THEN 1 ELSE 0 END) AS tenderCount,
               sum(CASE WHEN stage='result' THEN 1 ELSE 0 END) AS resultCount,
               sum(CASE WHEN stage='amendment' THEN 1 ELSE 0 END) AS amendmentCount,
               sum(COALESCE(budget_yuan, 0)) AS totalBudgetYuan,
               max(region) AS primaryRegion,
               max(trade_type) AS primaryTradeType,
               CAST(max(published_ns) AS TEXT) AS latestPublished
        FROM notice_meta
        WHERE ${col} <> '' AND ${col} LIKE ?
        GROUP BY ${col}
        ORDER BY totalNotices DESC, totalBudgetYuan DESC
        LIMIT 80
      `).all(like).map((r) => ({ ...r, totalBudgetYuan: String(r.totalBudgetYuan || 0) }));
      return json({ kind, items: list });
    }

    if (pathname === "/api/saved-filters") {
      const nowMs = Date.now();
      const rows = db.prepare(`
        SELECT sf.id, sf.name, sf.filters_json AS filtersJson, sf.subscribed, sf.shared,
               sf.owner, o.name AS ownerName, sf.assignee AS assigneeId, a.name AS assigneeName,
               sf.created_at AS createdAt
        FROM saved_filter sf
        LEFT JOIN employee o ON o.id = sf.owner
        LEFT JOIN employee a ON a.id = sf.assignee
        WHERE sf.owner = ? OR sf.shared = 1
        ORDER BY sf.subscribed DESC, sf.updated_at DESC
      `).all(user.id);
      const list = rows.map((r) => {
        let filters = {};
        try { filters = JSON.parse(r.filtersJson); } catch {}
        const { where, args } = buildFilterWhere({ userId: user.id, ...filters }, nowMs);
        const cnt = db.prepare(`SELECT count(*) AS c FROM notice_meta m JOIN notice n ON n.id=m.id LEFT JOIN project_follow pf ON pf.notice_id=m.id WHERE ${where}`).get(...args)?.c ?? 0;
        return {
          id: r.id, name: r.name, filters, subscribed: !!r.subscribed, shared: !!r.shared,
          isOwner: r.owner === user.id || user.role === "admin",
          ownerName: r.ownerName || r.owner, assigneeId: r.assigneeId, assigneeName: r.assigneeName || "未指派",
          matchCount: cnt, createdAt: r.createdAt,
        };
      });
      return json(list);
    }

    if (pathname === "/api/alerts") {
      // Auto-sync amendment/termination alerts for active followed projects
      const followedChanges = db.prepare(`
        SELECT pf.notice_id AS baseNoticeId, pf.assignee, m_base.project_key AS projectKey,
               m_chg.id AS chgId, m_chg.title AS chgTitle, m_chg.stage AS chgStage,
               m_chg.stage_label AS chgStageLabel, CAST(m_chg.deadline_ns AS TEXT) AS chgDeadlineNs
        FROM project_follow pf
        JOIN notice_meta m_base ON m_base.id = pf.notice_id
        JOIN notice_meta m_chg ON m_chg.project_key = m_base.project_key AND m_chg.id <> m_base.id
        JOIN notice nb ON nb.id=m_base.id JOIN notice nc ON nc.id=m_chg.id
        WHERE (nc.draft=0 OR nc.owner=?) AND (nb.draft=0 OR (nc.draft=1 AND nc.owner=nb.owner))
          AND radar_same_scope(nb.data,nc.data) AND pf.decision IN ('watching', 'bidding')
          AND m_base.project_key <> ''
          AND NOT EXISTS (SELECT 1 FROM notice_hidden hidden WHERE hidden.notice_id IN (m_base.id,m_chg.id))
          AND m_chg.stage IN ('amendment', 'terminated','suspended')
          AND NOT EXISTS (
            SELECT 1 FROM alert_todo a
            WHERE a.id IN ('amend:' || m_base.id || ':' || m_chg.id, 'amend:' || m_chg.id)
          )
        LIMIT 30
      `).all(user.id);
      if (followedChanges.length) {
        transaction(db, () => {
          for (const fc of followedChanges) {
            const aid = `amend:${fc.baseNoticeId}:${fc.chgId}`;
            const isTerm = fc.chgStage === "terminated";
            db.prepare(`INSERT OR IGNORE INTO alert_todo(id,notice_id,project_key,kind,title,detail,assignee,status,due_ns)
              VALUES (?,?,?,'amendment',?,?,?,'open',CAST(? AS INTEGER))`)
              .run(
                aid,
                fc.chgId,
                fc.projectKey,
                `${isTerm ? "项目终止/废标" : fc.chgStage === "suspended" ? "项目暂停" : "项目更正/答疑"}：${fc.chgTitle.slice(0, 48)}`,
                `关联已跟进项目 ${fc.projectKey} 新增${fc.chgStageLabel || fc.chgStage}公告，请核对截止时间、控制价及条款变动。`,
                fc.assignee || null,
                fc.chgDeadlineNs || "0",
              );
          }
        });
      }

      const status = searchParams.get("status") || "open";
      const kind = searchParams.get("kind") || "all";
      const mine = searchParams.get("mine") === "1";
      const actor = { $lifecycleActor: user.id };
      const clauses = [projectAlertReadScope("a")];
      const args = [];
      if (status !== "all") {
        clauses.push(`(${alertStatus("a")}) = ?`);
        args.push(status);
      }
      if (kind !== "all") {
        clauses.push("a.kind = ?");
        args.push(kind);
      }
      if (mine) {
        clauses.push("(a.assignee = ? OR a.assignee IS NULL)");
        args.push(user.id);
      }
      const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";
      const items = db.prepare(`
        SELECT a.id, a.kind, a.notice_id AS noticeId, a.project_key AS projectKey,
               a.title, a.detail, ${alertStatus("a")} AS status, a.status AS recordedStatus, a.assignee AS assigneeId, emp.name AS assigneeName,
               CAST(a.due_ns AS TEXT) AS due, a.created_at AS createdAt,
               m.title AS noticeTitle, m.region, m.trade_type AS tradeType, m.stage_label AS stageLabel,
               m.deadline_text AS deadlineText, m.budget_text AS budgetText, m.source
        FROM alert_todo a
        LEFT JOIN employee emp ON emp.id = a.assignee
        LEFT JOIN notice_meta m ON m.id = a.notice_id
        ${where}
        ORDER BY CASE a.kind WHEN 'amendment' THEN 0 WHEN 'deadline' THEN 1 WHEN 'todo' THEN 2 ELSE 3 END,
                 a.created_at DESC
        LIMIT 120
      `).all(actor, ...args);
      const expClauses = [expiryReadScope("e")];
      const expArgs = [];
      if (status !== "all") { expClauses.push("e.status = ?"); expArgs.push(status); }
      if (mine) { expClauses.push("(e.assignee = ? OR e.assignee IS NULL)"); expArgs.push(user.id); }
      const expWhere = expClauses.length ? "WHERE " + expClauses.join(" AND ") : "";
      const expItems = (kind === "all" || kind === "deadline" || kind === "expiry") ? db.prepare(`
        SELECT e.id, 'expiry' AS kind, '' AS noticeId, '' AS projectKey,
               e.company_id AS companyId, e.target_type AS targetType, e.tier, e.valid_until AS validUntil, e.days_left AS daysLeft,
               CASE e.tier
                 WHEN 'expired' THEN '【已过期】' || e.target_name
                 WHEN '7d' THEN '【7天内到期】' || e.target_name
                 ELSE '【30天内到期】' || e.target_name
               END AS title,
               '有效期截止 ' || e.valid_until || CASE WHEN e.days_left < 0 THEN '（已超期 ' || (-e.days_left) || ' 天，请立即续期或补办）' ELSE '（剩余 ' || e.days_left || ' 天，请提前安排续期）' END AS detail,
               e.status, e.assignee AS assigneeId, emp.name AS assigneeName,
               '0' AS due, e.created_at AS createdAt,
               e.target_name AS noticeTitle, '' AS region, '公司资料到期预警' AS tradeType,
               CASE e.tier WHEN 'expired' THEN '已超期' WHEN '7d' THEN '7天紧急' ELSE '30天预警' END AS stageLabel,
               e.valid_until AS deadlineText, '' AS budgetText, '资料库自动巡检' AS source
        FROM company_expiry_todo e
        LEFT JOIN employee emp ON emp.id = e.assignee
        ${expWhere}
        ORDER BY e.days_left ASC
        LIMIT 60
      `).all(actor, ...expArgs) : [];
      const mergedItems = kind === "expiry" ? expItems : [...expItems, ...items];
      const expOpenCnt = db.prepare(`SELECT count(*) AS c FROM company_expiry_todo e WHERE e.status='open' AND ${expiryReadScope("e")}`).get(actor).c;
      const expMineCnt = db.prepare(`SELECT count(*) AS c FROM company_expiry_todo e WHERE e.status='open' AND (e.assignee=$lifecycleActor OR e.assignee IS NULL) AND ${expiryReadScope("e")}`).get(actor).c;
      const alertCounts = db.prepare(`SELECT count(*) AS open,
        count(CASE WHEN a.kind='amendment' THEN 1 END) AS amendment,
        count(CASE WHEN a.kind='deadline' THEN 1 END) AS deadline,
        count(CASE WHEN a.kind='subscription' THEN 1 END) AS subscription,
        count(CASE WHEN a.kind='todo' THEN 1 END) AS todo,
        count(CASE WHEN a.assignee=$lifecycleActor THEN 1 END) AS mineOpen
        FROM alert_todo a WHERE a.status='open' AND (${alertStatus("a")})='open' AND ${projectAlertReadScope("a")}`).get(actor);
      const counts = {
        ...alertCounts,
        open: alertCounts.open + expOpenCnt,
        deadline: alertCounts.deadline + expOpenCnt,
        expiry: expOpenCnt,
        mineOpen: alertCounts.mineOpen + expMineCnt,
      };
      return json({ items: mergedItems, counts });
    }

    if (pathname === "/api/custom-sources") {
      const items = db.prepare(`
        SELECT cs.*, e.name AS creatorName,
               (SELECT count(*) FROM notice_meta m WHERE m.source_key = cs.key) AS noticeCount
        FROM custom_source cs
        LEFT JOIN employee e ON e.id = cs.created_by
        ORDER BY cs.created_at DESC
      `).all();
      const coverage = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='custom_source_coverage'").get()
        ? new Map(db.prepare("SELECT source_key,status,pages_read,oldest_date,newest_date,watermark_date FROM custom_source_coverage").all().map(row=>[row.source_key,row])) : new Map();
      return json({ items: items.map(cs => ({ ...cs, coverage:coverage.get(cs.key) || null, list_url: effectiveSourceUrl(cs), last_error: cs.last_error ? collectorFailure(cs.last_error).message : "" })) });
    }

    if (pathname === "/api/sources/health") {
      let strategies = {};
      try {
        const raw = await readFile(resolve(dirname(fileURLToPath(import.meta.url)), "../../ops/source-strategies.json"), "utf-8");
        strategies = JSON.parse(raw);
      } catch {}
      const sources = db.prepare(`
        SELECT sh.key, sh.name, sh.enabled, sh.checked, sh.last_ok AS lastOk,
               sh.failures, sh.reason, sh.last_error AS lastError,
               (SELECT count(*) FROM notice_meta m WHERE m.source_key = sh.key) AS noticeCount,
               (SELECT count(*) FROM notice_meta m WHERE m.source_key = sh.key AND m.original_status <> 'captured') AS missingBodyCount
        FROM source_health sh
        ORDER BY CASE WHEN sh.enabled=1 AND (sh.failures > 0 OR sh.reason <> '') THEN 0 ELSE 1 END,
                 sh.enabled DESC, noticeCount DESC
      `).all().map((s) => ({
        ...s,
        enabled: !!s.enabled,
        lastError: s.lastError ? collectorFailure(s.lastError, s.reason).message : "",
        strategy: strategies[s.key] || null,
      }));
      return json({ syncMeta: getSyncMeta(), sources });
    }

    if (pathname === "/api/finance-reference") {
      const id = searchParams.get("scope");
      const row = db.prepare(`SELECT s.company,s.notice,f.data FROM scope s JOIN finance_reference f ON s.id=f.scope WHERE s.id=?`).get(id);
      if (!row || !visible(user.id, row.notice) || !grant(user.id, row.company)?.view) {
        return denied(user.id, "查看资金对照", "标段资金");
      }
      const { ledger } = JSON.parse(row.data);
      return json({ balances: ledger.balances, positions: ledger.positions.map((item) => ({
        ...item, scope: undefined, performance: undefined,
      })), events: ledger.events.map(({ event, reversed }) => ({
        id: event.id, actor: event.byName, recordedAt: event.recordedAt,
        type: Object.keys(event.entry)[0], reversed,
      })) });
    }

    const files = pathname.match(/^\/api\/companies\/(\d+)\/attachments$/);
    if (files) {
      const permission = grant(user.id, files[1]);
      if (!permission?.view) return denied(user.id, "查看附件目录", files[1]);
      const records = db.prepare("SELECT id,record,sensitive FROM attachment WHERE company=?").all(files[1]);
      return json(records.map((record) => {
        const canDownload = !!(record.sensitive ? permission.sensitive_download : permission.view);
        const versions = db.prepare(`SELECT version,name,sha256 FROM attachment_version
          WHERE attachment=? ORDER BY length(version) DESC,version DESC`).all(record.id);
        return { ...record, canDownload, versions: versions.map((version) => canDownload ? {
          ...version, available: !!version.sha256,
        } : { version: version.version, name: "敏感附件", available: false }) };
      }));
    }

    const download = pathname.match(/^\/api\/attachments\/(\d+)\/(\d+)$/);
    if (download) {
      const [, id, version] = download;
      const target = `${id}/${version}`;
      const owner = db.prepare("SELECT company,sensitive FROM attachment WHERE id=?").get(id);
      const permission = owner && grant(user.id, owner.company);
      if (!owner || !(owner.sensitive ? permission?.sensitive_download : permission?.view)) {
        return denied(user.id, "下载附件", target);
      }
      const original = db.prepare("SELECT name,bytes,sha256 FROM attachment_version WHERE attachment=? AND version=?").get(id, version);
      if (!original) return missing();
      if (!original.bytes || digest(original.bytes) !== original.sha256) {
        audit(user.id, "下载附件", target, "已拦截");
        return json({ message: "该版本未迁入受控原件库，或原件校验失败。" }, 409);
      }
      audit(user.id, "下载附件", target, "已记录");
      const filename = encodeURIComponent(original.name).replace(/['()*]/g, (ch) => "%" + ch.charCodeAt(0).toString(16));
      return new Response(original.bytes, { headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
        "Content-Length": String(original.bytes.length),
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      } });
    }

    if (pathname === "/api/admin/accounts") {
      if (user.role !== "admin") return forbidden();
      return json(db.prepare(`
        SELECT e.id, e.username, e.name, e.approval, e.role, e.perspective, e.must_change AS mustChange,
               (SELECT count(*) FROM grant_company g WHERE g.employee=e.id AND g.view=1) AS grantCount,
               (SELECT count(*) FROM session s WHERE s.userId=e.id) AS activeSessions
        FROM employee e ORDER BY CASE WHEN e.approval='approved' THEN 0 ELSE 1 END, e.username
      `).all());
    }
    if (pathname === "/api/admin/company-grants") {
      if (user.role !== "admin") return forbidden();
      const target = searchParams.get("account");
      if (!target || !employee(target)) return missing();
      return json(db.prepare(`SELECT c.id,c.name,coalesce(g.view,0) AS view,coalesce(g.edit,0) AS edit,
        coalesce(g.verify,0) AS verify,coalesce(g.sensitive_download,0) AS sensitiveDownload
        FROM company c LEFT JOIN grant_company g ON c.id=g.company AND g.employee=?
        ORDER BY c.name`).all(target));
    }
    if (pathname === "/api/system/diagnostics") {
      const mem = process.memoryUsage();
      const dbPath = db.location?.() || "";
      let dbSizeBytes = 0;
      try { if (dbPath) dbSizeBytes = statSync(dbPath).size; } catch {}
      const cnt = (sql) => { try { return db.prepare(sql).get().c; } catch { return 0; } };
      const srcSummary = db.prepare(`
        SELECT count(*) AS total,
               sum(CASE WHEN enabled=1 THEN 1 ELSE 0 END) AS enabled,
               sum(CASE WHEN enabled=1 AND failures=0 THEN 1 ELSE 0 END) AS healthy,
               sum(CASE WHEN enabled=1 AND failures>0 THEN 1 ELSE 0 END) AS unhealthy,
               sum(CASE WHEN enabled=0 THEN 1 ELSE 0 END) AS disabled
        FROM source_health
      `).get();
      return json({
        uptimeSeconds: Math.round(process.uptime()),
        nodeVersion: process.version,
        memoryMb: {
          rss: Math.round(mem.rss / 1048576),
          heapUsed: Math.round(mem.heapUsed / 1048576),
          heapTotal: Math.round(mem.heapTotal / 1048576),
        },
        dbSizeMb: Number((dbSizeBytes / 1048576).toFixed(2)),
        counts: {
          notices: cnt("SELECT count(*) AS c FROM notice_meta"),
          projects: cnt("SELECT count(*) AS c FROM project_follow WHERE decision IN ('bidding','watching')"),
          companies: cnt("SELECT count(*) AS c FROM company"),
          docs: cnt("SELECT count(*) AS c FROM company_doc WHERE status<>'void'"),
          people: cnt("SELECT count(*) AS c FROM company_person WHERE status<>'void'"),
          files: cnt("SELECT count(*) AS c FROM company_file"),
          openAlerts: cnt(`SELECT count(*) AS c FROM alert_todo a WHERE a.status='open' AND (${alertStatus("a")})='open'`) + cnt("SELECT count(*) AS c FROM company_expiry_todo WHERE status='open'"),
          expiryOpen: cnt("SELECT count(*) AS c FROM company_expiry_todo WHERE status='open'"),
          auditLogs: cnt("SELECT count(*) AS c FROM audit"),
        },
        sources: srcSummary,
        cosConfigured: !!getCosCredentials(),
        compression: "brotli + gzip + etag",
      });
    }
    if (pathname === "/api/admin/audit") {
      if (user.role !== "admin") return forbidden();
      const q = (searchParams.get("q") || "").trim();
      const lim = Math.min(300, Math.max(20, Number(searchParams.get("limit") || 120)));
      if (q) {
        const like = `%${q}%`;
        return json(db.prepare("SELECT * FROM audit WHERE action LIKE ? OR target LIKE ? OR actor LIKE ? OR outcome LIKE ? ORDER BY seq DESC LIMIT ?").all(like, like, like, like, lim));
      }
      return json(db.prepare("SELECT * FROM audit ORDER BY seq DESC LIMIT ?").all(lim));
    }
    if (pathname === "/api/admin/reference-audit") {
      if (user.role !== "admin") return forbidden();
      return json(db.prepare("SELECT data FROM reference_history ORDER BY length(source) DESC,source DESC LIMIT 80").all().map((row) => JSON.parse(row.data)));
    }
    return pathname.startsWith("/api/") ? notReady() : missing();
  };
}

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png", ".jpg": "image/jpeg" };

export function listen(store, { port, host = "127.0.0.1", assets, tls }) {
  const app = createApp(store);
  const root = resolve(assets);
  const staticCache = new Map();
  const handle = async (req, res) => {
    const t0 = performance.now();
    try {
      const url = new URL(req.url, store.origin);
      if (url.origin !== store.origin) return res.writeHead(400).end();
      const acceptEnc = String(req.headers["accept-encoding"] || "");
      const wantsBr = acceptEnc.includes("br");
      const wantsGzip = acceptEnc.includes("gzip");
      let response;
      let preCompressed = null;
      if (url.pathname.startsWith("/api/")) {
        const isZipImport = /^\/api\/companies\/[^/]+\/import-zip$/.test(url.pathname);
        const isFileUpload = /^\/api\/(companies|opportunities)\/[^/]+\/files$/.test(url.pathname)
          || url.pathname === "/api/ocr/extract"
          || /^\/api\/finance\/pay-tasks\/[^/]+\/confirm$/.test(url.pathname);
        const maxBody = isZipImport ? 80 * 1024 * 1024 : isFileUpload ? 24 * 1024 * 1024 : url.pathname === "/api/opening" ? 6 * 1024 * 1024 : 65536;
        const body = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > maxBody) {
            res.writeHead(413).end();
            return;
          }
          body.push(chunk);
        }
        const headers = new Headers(req.headers);
        for (const name of ["forwarded","x-forwarded-for","x-real-ip","cf-connecting-ip"]) headers.delete(name);
        headers.set("x-forwarded-for", req.socket.remoteAddress);
        response = await app(new Request(url, {
          method: req.method, headers, body: size ? Buffer.concat(body) : undefined,
        }));
      } else if (["GET", "HEAD"].includes(req.method)) {
        const requested = url.pathname.startsWith("/assets/") ? resolve(root, "." + url.pathname) : resolve(root, "index.html");
        if (!requested.startsWith(root + sep)) return res.writeHead(404).end();
        try {
          const st = statSync(requested);
          const etag = `W/"${st.size}-${Math.floor(st.mtimeMs)}"`;
          const isVersionedAsset = url.pathname.startsWith("/assets/") && url.searchParams.has("v");
          const cacheCtl = isVersionedAsset ? "public, max-age=31536000, immutable" : url.pathname.startsWith("/assets/") ? "public, max-age=3600" : "no-store";
          const ctype = types[extname(requested)] ?? "application/octet-stream";
          if (req.headers["if-none-match"] === etag) {
            res.writeHead(304, {
              "ETag": etag,
              "Cache-Control": cacheCtl,
              "Vary": "Accept-Encoding",
              "X-Content-Type-Options": "nosniff",
            });
            return res.end();
          }
          let entry = staticCache.get(requested);
          if (!entry || entry.mtimeMs !== st.mtimeMs) {
            const raw = await readFile(requested);
            const compressible = /\.(html|js|css|svg)$/.test(requested) && raw.length > 512;
            entry = {
              mtimeMs: st.mtimeMs,
              etag,
              raw,
              br: compressible ? brotliCompressSync(raw) : null,
              gz: compressible ? gzipSync(raw) : null,
            };
            if (staticCache.size > 40) staticCache.clear();
            staticCache.set(requested, entry);
          }
          const baseHeaders = { "Content-Type": ctype, "Cache-Control": cacheCtl, "ETag": etag, "Vary": "Accept-Encoding" };
          if (wantsBr && entry.br) {
            preCompressed = { buf: entry.br, enc: "br" };
          } else if (wantsGzip && entry.gz) {
            preCompressed = { buf: entry.gz, enc: "gzip" };
          } else {
            preCompressed = { buf: entry.raw, enc: "" };
          }
          response = new Response(null, { status: 200, headers: baseHeaders });
        } catch (error) {
          if (error.code !== "ENOENT" && error.code !== "EISDIR") throw error;
          response = missing();
        }
      } else response = missing();
      const headers = Object.fromEntries(response.headers);
      if (response.headers.has("set-cookie")) headers["set-cookie"] = response.headers.getSetCookie();
      let payloadBuf = preCompressed ? preCompressed.buf : Buffer.from(await response.arrayBuffer());
      if (preCompressed && preCompressed.enc) {
        headers["content-encoding"] = preCompressed.enc;
        headers["content-length"] = String(payloadBuf.length);
      } else if (!preCompressed && !headers["content-encoding"] && payloadBuf.length > 1024) {
        const ct = String(headers["content-type"] || "");
        if (/json|text|javascript|xml|svg/i.test(ct)) {
          if (wantsBr) {
            payloadBuf = brotliCompressSync(payloadBuf);
            headers["content-encoding"] = "br";
            headers["vary"] = "Accept-Encoding";
            headers["content-length"] = String(payloadBuf.length);
          } else if (wantsGzip) {
            payloadBuf = gzipSync(payloadBuf);
            headers["content-encoding"] = "gzip";
            headers["vary"] = "Accept-Encoding";
            headers["content-length"] = String(payloadBuf.length);
          }
        }
      }
      const isFileRoute = url.pathname.startsWith("/api/files/") || url.pathname.startsWith("/api/notice-attachments/");
      const dur = (performance.now() - t0).toFixed(1);
      const secHeaders = {
        ...headers,
        "Server-Timing": `app;dur=${dur}`,
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
        "X-Permitted-Cross-Domain-Policies": "none",
        "X-Frame-Options": isFileRoute ? "SAMEORIGIN" : "DENY",
        "Content-Security-Policy": isFileRoute
          ? "default-src 'self'; frame-ancestors 'self'; object-src 'self'"
          : "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src 'self'; object-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      };
      if (tls) secHeaders["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
      res.writeHead(response.status, secHeaders);
      res.end(req.method === "HEAD" ? undefined : payloadBuf);
    } catch (err) {
      console.error("[server error]", err);
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ message: "服务暂不可用，请稍后重试。" }));
    }
  };
  const server = tls ? createSecureServer(tls, handle) : createServer(handle);
  return server.listen(port, host);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const dir = process.env.BIDDING_RADAR_SELFHOST_DIR;
  const port = Number(process.env.BIDDING_RADAR_SELFHOST_PORT ?? 4201);
  if (!dir || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Set the isolated data directory and a valid loopback port.");
  const publicOrigin = process.env.BIDDING_RADAR_SELFHOST_ORIGIN;
  const originURL = new URL(publicOrigin ?? `http://localhost:${port}`);
  if (publicOrigin && (originURL.protocol !== "https:" || originURL.origin !== publicOrigin)) {
    throw new Error("The public origin must be an HTTPS origin with no path.");
  }
  const certificate = process.env.BIDDING_RADAR_TLS_CERT;
  const key = process.env.BIDDING_RADAR_TLS_KEY;
  if (Boolean(certificate) !== Boolean(key) || (certificate && !publicOrigin)) {
    throw new Error("Set both TLS files and the HTTPS origin for direct TLS.");
  }
  const tls = certificate ? { cert: await readFile(certificate), key: await readFile(key) } : undefined;
  const origin = originURL.origin;
  const store = openStore(dir, origin);
  const assets = resolve(dirname(fileURLToPath(import.meta.url)), "../frontend/dist-selfhost");
  const server = listen(store, { port, assets, tls });
  server.on("listening", () => console.log(`Bidding workspace listening on loopback (public origin ${origin})`));
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => server.close(() => store.db.close()));
  }
}
