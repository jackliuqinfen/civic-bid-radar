"""Refresh the self-hosted public notice projection, indexed metadata, source health, and actionable alerts."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import time
from urllib.parse import urlsplit

NAMESPACE = 1_000_000_000_000
TIMESTAMP = re.compile(r"^[0-9]{1,22}$")


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def timestamp(value):
    if not isinstance(value, str) or not TIMESTAMP.fullmatch(value):
        raise ValueError("Invalid source timestamp")
    return int(value)


def projection(record):
    notice = record["notice"]
    origin = record["origin"]
    legacy_id = record["legacyId"]
    if type(legacy_id) is not int or not 0 < legacy_id < NAMESPACE:
        raise ValueError("Invalid legacy notice identifier")
    if origin.get("rules"):
        raise ValueError("Non-public rule reference")
    source, key = origin["sourceKey"], origin["sourceId"]
    if not all(isinstance(value, str) and value.strip() for value in (source, key)):
        raise ValueError("Missing source identity")
    link = urlsplit(notice["sourceUrl"])
    if link.scheme not in ("http", "https") or not link.hostname or link.username or link.password:
        raise ValueError("Invalid public source link")
    title = notice["projectName"] or "公开招采公告"
    body = notice["body"]
    if not isinstance(body, str) or len(body.encode()) > 131_072:
        raise ValueError("Invalid public notice body")
    original = origin["original"]
    if original not in ("captured", "incomplete", "uncached"):
        raise ValueError("Invalid public source body state")
    budget_yuan = notice.get("budgetYuan")
    budget_int = int(budget_yuan) if isinstance(budget_yuan, str) and budget_yuan.isdigit() else None
    result = {
        "id": str(NAMESPACE + legacy_id),
        "legacyId": legacy_id,
        "title": title,
        "source": notice["sourceName"],
        "sourceKey": source,
        "tenderer": notice["tenderer"],
        "agency": origin.get("agency") or "",
        "region": origin.get("region") or "",
        "tradeType": origin.get("tradeType") or "",
        "category": origin.get("category") or "",
        "stage": origin.get("stage") or "other",
        "stageLabel": origin.get("stageLabel") or "其他公告",
        "projectKey": origin.get("projectKey") or "",
        "type": origin.get("tradeType") or ("工程施工" if record.get("projectTypeKnown") else "未标注"),
        "status": "pending",
        "deadline": str(timestamp(notice["registrationDeadline"])),
        "deadlineText": origin.get("deadlineText") or "",
        "deadlinePrecision": origin.get("deadlinePrecision") or "",
        "openTime": str(timestamp(notice.get("bidOpenTime") or "0")),
        "openTimeText": origin.get("openTimeText") or "",
        "openPlace": origin.get("openPlace") or "",
        "published": str(timestamp(notice["publishDate"])),
        "publishTimeText": origin.get("publishTimeText") or "",
        "budgetYuan": budget_yuan,
        "budgetText": origin.get("budgetText") or "",
        "qualifications": origin.get("qualifications") or [],
        "qualTags": origin.get("qualTags") or [],
        "depositText": origin.get("depositText") or "",
        "evalMethod": origin.get("evalMethod") or "",
        "procType": origin.get("procType") or "",
        "winner": origin.get("winner") or "",
        "winAmountWan": origin.get("winAmountWan"),
        "attachments": origin.get("attachments") or [],
        "checklist": origin.get("checklist") or [],
        "tenderFiles": origin.get("tenderFiles") or [],
        "originalStatus": original,
        "sourceUpdatedAt": origin.get("sourceUpdatedAt") or "",
        "body": body if original == "captured" else "",
        "url": link._replace(scheme="http").geturl() if source == "jianye" and link.hostname == "www.ycjianye.com" else notice["sourceUrl"],
        "draft": False,
    }
    meta = {
        "id": result["id"],
        "title": title,
        "source": result["source"],
        "source_key": source,
        "tenderer": result["tenderer"],
        "agency": result["agency"],
        "region": result["region"],
        "trade_type": result["tradeType"],
        "category": result["category"],
        "stage": result["stage"],
        "stage_label": result["stageLabel"],
        "project_key": result["projectKey"],
        "published_ns": int(result["published"]),
        "deadline_ns": int(result["deadline"]),
        "deadline_text": result["deadlineText"],
        "budget_yuan": budget_int,
        "budget_text": result["budgetText"],
        "qual_tags": ",".join(result["qualTags"]),
        "eval_method": result["evalMethod"],
        "deposit_text": result["depositText"],
        "original_status": original,
        "has_attachments": 1 if result["attachments"] else 0,
        "source_updated_at": result["sourceUpdatedAt"],
        "url": result["url"],
    }
    return source, key, result, meta


def load_snapshot(path):
    with path.open(encoding="utf-8") as stream:
        header = json.loads(next(stream))
        if header["format"] != "legacy-public-v1" or timestamp(header["at"]) <= 0:
            raise ValueError("Invalid snapshot header")
        seen = set()
        ids = set()
        records = []
        rejected = 0
        for line in stream:
            row = json.loads(line)
            if "total" in row:
                if row["total"] != len(records) + rejected or row.get("rejected") != rejected or next(stream, None) is not None:
                    raise ValueError("Incomplete snapshot")
                if not records:
                    raise ValueError("No public opportunities in snapshot")
                return header, records, rejected
            if "rejectedSource" in row:
                rejected += 1
                continue
            record = projection(row)
            source_identity = record[:2]
            record_id = record[2]["id"]
            if source_identity in seen or record_id in ids:
                raise ValueError("Duplicate public identity in snapshot")
            seen.add(source_identity)
            ids.add(record_id)
            records.append(record)
    raise ValueError("Missing snapshot trailer")


def ensure_tables(db):
    db.execute("""CREATE TABLE IF NOT EXISTS legacy_public_index (
        source TEXT NOT NULL, source_id TEXT NOT NULL, id TEXT NOT NULL UNIQUE REFERENCES notice(id),
        version INTEGER NOT NULL, fingerprint TEXT NOT NULL, PRIMARY KEY(source,source_id)
    )""")
    db.execute("""CREATE TABLE IF NOT EXISTS legacy_public_revision (
        id TEXT NOT NULL REFERENCES notice(id), version INTEGER NOT NULL, observed_at TEXT NOT NULL,
        payload TEXT NOT NULL, PRIMARY KEY(id,version)
    )""")
    db.execute("""CREATE TABLE IF NOT EXISTS legacy_public_sync (
        singleton INTEGER PRIMARY KEY CHECK (singleton=1), observed_at TEXT NOT NULL,
        source_round TEXT NOT NULL, imported INTEGER NOT NULL, rejected INTEGER NOT NULL
    )""")
    db.execute("""CREATE TABLE IF NOT EXISTS notice_meta (
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
    )""")
    db.execute("CREATE INDEX IF NOT EXISTS idx_nm_stage_pub ON notice_meta(stage, published_ns DESC)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_nm_deadline ON notice_meta(deadline_ns)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_nm_region ON notice_meta(region)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_nm_trade ON notice_meta(trade_type)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_nm_pkey ON notice_meta(project_key)")
    db.execute("""CREATE TABLE IF NOT EXISTS notice_hidden (
        notice_id TEXT PRIMARY KEY, deleted_by TEXT NOT NULL DEFAULT '',
        deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )""")
    db.execute("""CREATE TABLE IF NOT EXISTS source_health (
        key TEXT PRIMARY KEY, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
        checked TEXT NOT NULL DEFAULT '0', last_ok TEXT NOT NULL DEFAULT '0',
        failures INTEGER NOT NULL DEFAULT 0, reason TEXT NOT NULL DEFAULT '',
        last_error TEXT NOT NULL DEFAULT ''
    )""")
    db.execute("""CREATE TABLE IF NOT EXISTS saved_filter (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES employee(id),
        name TEXT NOT NULL, filters_json TEXT NOT NULL,
        subscribed INTEGER NOT NULL DEFAULT 0, shared INTEGER NOT NULL DEFAULT 1,
        assignee TEXT REFERENCES employee(id),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )""")
    db.execute("""CREATE TABLE IF NOT EXISTS project_follow (
        notice_id TEXT PRIMARY KEY REFERENCES notice(id),
        project_key TEXT NOT NULL DEFAULT '',
        decision TEXT NOT NULL DEFAULT 'watching' CHECK(decision IN ('watching','bidding','declined')),
        assignee TEXT REFERENCES employee(id),
        note TEXT NOT NULL DEFAULT '',
        updated_by TEXT NOT NULL REFERENCES employee(id),
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )""")
    db.execute("""CREATE TABLE IF NOT EXISTS alert_todo (
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
    )""")
    db.execute("CREATE INDEX IF NOT EXISTS idx_alert_status ON alert_todo(status, kind, created_at DESC)")


def matches_filter(meta, flt, now_ns):
    tab = flt.get("tab") or "biddable"
    if tab == "biddable" and meta["stage"] != "tender":
        return False
    if tab == "amendments" and meta["stage"] != "amendment":
        return False
    if tab == "intent" and meta["stage"] != "intent":
        return False
    if tab == "results" and meta["stage"] not in ("result", "terminated", "contract"):
        return False
    if flt.get("onlyOpen") in (True, "1", 1):
        if meta["deadline_ns"] > 0 and meta["deadline_ns"] <= now_ns:
            return False
    if flt.get("region") and flt["region"] not in meta["region"]:
        return False
    if flt.get("tradeType") and meta["trade_type"] != flt["tradeType"]:
        return False
    if flt.get("source") and meta["source"] != flt["source"]:
        return False
    if flt.get("qual"):
        q_val = str(flt["qual"]).strip().lower()
        if q_val and q_val not in meta["qual_tags"].lower() and q_val not in meta["title"].lower():
            return False
    if flt.get("q"):
        kw = str(flt["q"]).strip().lower()
        if kw and not any(kw in (meta[k] or "").lower() for k in ("title", "tenderer", "agency", "source", "qual_tags")):
            return False
    return True


NOTICE_SCOPE_NUMBERS = dict(zip("一二两三四五六七八九十", ["1", "2", "2", "3", "4", "5", "6", "7", "8", "9", "10"]))
LOT_LABEL = r"(?:标段|分包|包件|标包|合同包)"
SCOPE_NUMBER = r"([0-9一二两三四五六七八九十]+)"


def same_notice_scope(base_json, linked_json):
    # Keep this in step with sameNoticeScope in runtime/selfhost/noticeEvidence.mjs.
    base, linked = json.loads(base_json), json.loads(linked_json)

    def scope(notice):
        title = str(notice.get("title") or "")
        lot = re.search(r"(?:第)?" + SCOPE_NUMBER + LOT_LABEL, title) or re.search(LOT_LABEL + r"[：:\s]*" + SCOPE_NUMBER, title)
        round_match = re.search(r"(?:第)?" + SCOPE_NUMBER + r"(?:轮|次)", title)
        lot_number = lot.group(1) if lot else ""
        round_number = round_match.group(1) if round_match else ("重新" if re.search("重新招标|重新采购", title) else "")
        return (NOTICE_SCOPE_NUMBERS.get(lot_number, lot_number), NOTICE_SCOPE_NUMBERS.get(round_number, round_number),
                str(notice.get("lotKey") or notice.get("lotId") or "").strip(), str(notice.get("round") or ""))

    buyer, linked_buyer = base.get("tenderer"), linked.get("tenderer")
    return int((not buyer or not linked_buyer or buyer == linked_buyer) and scope(base) == scope(linked))


def generate_alerts(db, newly_created_metas):
    now_ns = time.time_ns()
    soon_ns = now_ns + 72 * 3600 * 10**9

    # 1. Amendment alerts ONLY for explicitly selected/followed projects (watching or bidding)
    db.create_function("radar_same_scope", 2, same_notice_scope, deterministic=True)
    amendments = db.execute("""
        SELECT a.id, a.title, a.project_key, a.deadline_ns, a.deadline_text, pf.assignee, pf.notice_id, a.stage
        FROM notice_meta a
        JOIN project_follow pf ON pf.project_key <> '' AND pf.project_key = a.project_key
        JOIN notice linked ON linked.id=a.id AND linked.draft=0
        JOIN notice base ON base.id=pf.notice_id AND base.draft=0
        WHERE a.stage IN ('amendment','terminated','suspended') AND pf.decision IN ('watching', 'bidding')
          AND a.id<>pf.notice_id AND radar_same_scope(base.data,linked.data)
          AND NOT EXISTS (SELECT 1 FROM notice_hidden h WHERE h.notice_id IN (a.id,pf.notice_id))
          AND NOT EXISTS (SELECT 1 FROM alert_todo t WHERE t.id IN ('amend:' || a.id, 'amend:' || pf.notice_id || ':' || a.id))
        ORDER BY a.published_ns DESC LIMIT 60
    """).fetchall()
    for row in amendments:
        aid = f"amend:{row[6]}:{row[0]}"
        label = {"amendment": "更正/答疑", "terminated": "终止/废标", "suspended": "暂停"}[row[7]]
        detail = f"已选项目「{row[2]}」发布{label}公告，请核对时间、预算及条款变更"
        if row[4]:
            detail += f"（截止：{row[4]} 北京时间）"
        db.execute("""INSERT OR IGNORE INTO alert_todo(id,kind,notice_id,project_key,title,detail,assignee,due_ns)
            VALUES (?,?,?,?,?,?,?,?)""", (aid, "amendment", row[0], row[2], f"{label}：{row[1]}", detail, row[5], row[3] or 0))

    # 2. Deadline-soon alerts (within 72h) ONLY for explicitly selected/followed projects
    deadlines = db.execute("""
        SELECT m.id, m.title, m.project_key, m.deadline_ns, m.deadline_text, pf.assignee
        FROM notice_meta m
        JOIN project_follow pf ON pf.notice_id = m.id
        WHERE m.stage = 'tender' AND pf.decision IN ('watching', 'bidding')
          AND m.deadline_ns > ? AND m.deadline_ns <= ?
        ORDER BY m.deadline_ns ASC LIMIT 40
    """, (now_ns, soon_ns)).fetchall()
    for row in deadlines:
        aid = f"due:{row[0]}"
        detail = f"报名/递交截止：{row[4] or '未标注'} 北京时间（72 小时内截止，请核对递交与保证金安排）"
        db.execute("""INSERT OR IGNORE INTO alert_todo(id,kind,notice_id,project_key,title,detail,assignee,due_ns)
            VALUES (?,?,?,?,?,?,?,?)""", (aid, "deadline", row[0], row[2], f"临近截止：{row[1]}", detail, row[5], row[3]))

    # 3. Subscription matches ONLY for newly created notices matching active subscribed filters
    if newly_created_metas:
        subs = db.execute("SELECT id, name, filters_json, COALESCE(assignee, owner) FROM saved_filter WHERE subscribed=1").fetchall()
        for sub_id, sub_name, flt_json, assignee in subs:
            try:
                flt = json.loads(flt_json)
            except ValueError:
                continue
            for meta in newly_created_metas:
                if matches_filter(meta, flt, now_ns):
                    aid = f"sub:{sub_id}:{meta['id']}"
                    detail = f"命中订阅方案「{sub_name}」· {meta['region'] or '盐城市'} · {meta['trade_type'] or '综合招采'}"
                    db.execute("""INSERT OR IGNORE INTO alert_todo(id,kind,notice_id,project_key,title,detail,assignee,source_filter_id,due_ns)
                        VALUES (?,?,?,?,?,?,?,?,?)""",
                        (aid, "subscription", meta["id"], meta["project_key"], f"订阅命中：{meta['title']}", detail, assignee, sub_id, meta["deadline_ns"]))


def refresh(database, header, records, rejected):
    if not database.is_file():
        raise ValueError("Target workspace must be initialized")
    at = timestamp(header["at"])
    with sqlite3.connect(str(database), timeout=30) as db:
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("BEGIN IMMEDIATE")
        ensure_tables(db)
        previous = db.execute("SELECT observed_at FROM legacy_public_sync WHERE singleton=1").fetchone()
        if previous and int(previous[0]) > at:
            raise ValueError("Refusing an older source snapshot")

        db.execute("CREATE TABLE IF NOT EXISTS paused_source_import (key TEXT PRIMARY KEY)")
        paused = {row[0] for row in db.execute("SELECT key FROM paused_source_import")}
        # Update source health table
        for src in header.get("sources") or []:
            db.execute("""INSERT OR REPLACE INTO source_health(key,name,enabled,checked,last_ok,failures,reason,last_error)
                VALUES (?,?,?,?,?,?,?,?)""", (
                src["key"], src.get("name") or src["key"], int(bool(src.get("enabled")) and src["key"] not in paused),
                str(src.get("checked") or "0"), str(src.get("lastOk") or "0"),
                int(src.get("failures") or 0), str(src.get("reason") or ""), str(src.get("lastError") or "")
            ))

        created = updated = unchanged = missing_original = 0
        newly_created_metas = []
        imported = 0
        for source, key, record, meta in records:
            if source in paused:
                continue
            imported += 1
            identifier = record["id"]
            current = db.execute("""SELECT l.id,l.version,l.fingerprint,n.data
                FROM legacy_public_index l JOIN notice n ON n.id=l.id WHERE l.source=? AND l.source_id=?""", (source, key)).fetchone()
            if not record["body"]:
                missing_original += 1
                if current:
                    old_body = json.loads(current[3]).get("body") or ""
                    if old_body:
                        record["body"] = old_body
            fingerprint = hashlib.sha256(encoded(record).encode()).hexdigest()
            if current:
                if current[0] != identifier:
                    raise ValueError("Public source identity changed")
                if current[2] != fingerprint:
                    version = current[1] + 1
                    record["version"] = str(version)
                    db.execute("UPDATE notice SET data=?,title=? WHERE id=? AND draft=0", (encoded(record), record["title"], identifier))
                    db.execute("UPDATE legacy_public_index SET version=?,fingerprint=? WHERE id=?", (version, fingerprint, identifier))
                    db.execute("INSERT INTO legacy_public_revision VALUES (?,?,?,?)", (identifier, version, str(at), encoded(record)))
                    updated += 1
                else:
                    unchanged += 1
            else:
                version = 1
                record["version"] = str(version)
                db.execute("INSERT INTO notice (id,title,owner,draft,data) VALUES (?,?,NULL,0,?)", (identifier, record["title"], encoded(record)))
                db.execute("INSERT INTO legacy_public_index VALUES (?,?,?,?,?)", (source, key, identifier, version, fingerprint))
                db.execute("INSERT INTO legacy_public_revision VALUES (?,?,?,?)", (identifier, version, str(at), encoded(record)))
                created += 1
                newly_created_metas.append(meta)

            # Always keep notice_meta synchronized
            db.execute("""INSERT OR REPLACE INTO notice_meta(
                id,title,source,source_key,tenderer,agency,region,trade_type,category,stage,stage_label,
                project_key,published_ns,deadline_ns,deadline_text,budget_yuan,budget_text,qual_tags,
                eval_method,deposit_text,original_status,has_attachments,source_updated_at,url
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", (
                meta["id"], meta["title"], meta["source"], meta["source_key"], meta["tenderer"],
                meta["agency"], meta["region"], meta["trade_type"], meta["category"], meta["stage"],
                meta["stage_label"], meta["project_key"], meta["published_ns"], meta["deadline_ns"],
                meta["deadline_text"], meta["budget_yuan"], meta["budget_text"], meta["qual_tags"],
                meta["eval_method"], meta["deposit_text"], meta["original_status"],
                meta["has_attachments"], meta["source_updated_at"], meta["url"]
            ))

        generate_alerts(db, newly_created_metas)
        db.execute("INSERT OR REPLACE INTO legacy_public_sync VALUES (1,?,?,?,?)", (str(at), str(header["round"]), imported, rejected))
    return {"created": created, "updated": updated, "unchanged": unchanged, "rejected": rejected,
            "source_round": header["round"], "missing_source_body": missing_original}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", type=Path)
    parser.add_argument("snapshot", type=Path)
    options = parser.parse_args()
    try:
        print(encoded(refresh(options.database, *load_snapshot(options.snapshot))))
    except (KeyError, StopIteration, TypeError, ValueError, sqlite3.Error) as error:
        raise SystemExit(f"Legacy public projection failed: {type(error).__name__}: {error}") from None


if __name__ == "__main__":
    main()
