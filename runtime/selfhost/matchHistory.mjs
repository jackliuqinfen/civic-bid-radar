import { createHash } from "node:crypto";
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function ensureMatchHistory(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS qualification_review_basis (
    notice_id TEXT NOT NULL, company_id TEXT NOT NULL, req_key TEXT NOT NULL, fingerprint TEXT NOT NULL,
    PRIMARY KEY(notice_id,company_id,req_key)
  );
  CREATE TABLE IF NOT EXISTS qualification_match_history (
    id INTEGER PRIMARY KEY, notice_id TEXT NOT NULL, company_id TEXT NOT NULL,
    signature TEXT NOT NULL, snapshot TEXT NOT NULL, observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS qualification_history_by_company ON qualification_match_history(notice_id,company_id,id DESC);`);
}

export function companyInputs(db,companyId) {
  return db.prepare("SELECT id,name,version,qual_items_json,valid_until,status FROM company_doc WHERE company_id=? AND status<>'void' ORDER BY id").all(companyId);
}

export function matchFingerprint(evidence, docs, results, people) {
  // A replaced certificate, reassignment or a change across an expiry date invalidates an old decision.
  return hash([evidence,docs,results,people]);
}

export function captureMatch(db,noticeId,companyId,inputHash,cells,evidence) {
  const signature = hash([inputHash,cells]);
  const previous = db.prepare("SELECT signature FROM qualification_match_history WHERE notice_id=? AND company_id=? ORDER BY id DESC LIMIT 1").get(noticeId,companyId);
  if (signature !== previous?.signature) {
    const snapshot = {cells,requirements:evidence.requirements,fields:evidence.fields};
    db.prepare("INSERT INTO qualification_match_history(notice_id,company_id,signature,snapshot) VALUES(?,?,?,?)").run(noticeId,companyId,signature,JSON.stringify(snapshot));
  }
  return db.prepare("SELECT id,observed_at,snapshot FROM qualification_match_history WHERE notice_id=? AND company_id=? ORDER BY id DESC LIMIT 6").all(noticeId,companyId).map((row,index,all)=>{
    const curr = JSON.parse(row.snapshot);
    const before = all[index+1] ? JSON.parse(all[index+1].snapshot) : null;
    return {id:row.id,at:row.observed_at,cells:curr.cells,
      changed:before ? Object.keys(curr.cells).filter(k => JSON.stringify(curr.cells[k]) !== JSON.stringify(before.cells[k]) || JSON.stringify(curr.requirements.find(r=>r.key===k)) !== JSON.stringify(before.requirements.find(r=>r.key===k))) : [],
      fieldsChanged:before ? Object.keys(curr.fields).filter(k=>JSON.stringify(curr.fields[k]) !== JSON.stringify(before.fields[k])).map(k=>curr.fields[k].label) : []};
  });
}
