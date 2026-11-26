import { createHash, randomBytes } from "node:crypto";
import { closeSync, mkdirSync, openSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { username } from "better-auth/plugins";
import { maxPasswordLength, minPasswordLength } from "./password-policy.mjs";

export const digest = (value) => createHash("sha256").update(value).digest("hex");
export const temporaryPassword = () => randomBytes(24).toString("base64url");

function connect(dir) {
  const path = join(dir, "workspace.db");
  if ((statSync(path).mode & 0o077) !== 0) throw new Error("Restrict database permissions to 0600.");
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;");
  return db;
}

function authFor(db, origin) {
  const options = {
    appName: "Civic Bid Radar",
    telemetry: { enabled: false },
    logger: { level: "error" },
    advanced: { ipAddress: { ipAddressHeaders: ["x-forwarded-for"] } },
    baseURL: origin,
    secret: db.prepare("SELECT secret FROM installation").get().secret,
    database: db,
    trustedOrigins: [origin],
    session: { expiresIn: 60 * 60 * 8, disableSessionRefresh: true, cookieCache: { enabled: false } },
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength, maxPasswordLength },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 120, customRules: { "/sign-in/username": { window: 60, max: 12 } } },
    plugins: [username()],
  };
  return { options, auth: betterAuth(options) };
}

const schema = `
CREATE TABLE installation (version INTEGER NOT NULL, secret TEXT NOT NULL);
CREATE TABLE employee (
  id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL, source_account TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','member')),
  approval TEXT NOT NULL CHECK (approval IN ('approved','pending','rejected')),
  perspective TEXT NOT NULL CHECK (perspective IN ('lead','bidder','delegate','finance')),
  must_change INTEGER NOT NULL DEFAULT 1 CHECK (must_change IN (0,1))
);
CREATE TABLE company (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE grant_company (
  employee TEXT REFERENCES employee(id), company TEXT REFERENCES company(id),
  view INTEGER NOT NULL CHECK(view IN (0,1)), edit INTEGER NOT NULL CHECK(edit IN (0,1)),
  verify INTEGER NOT NULL CHECK(verify IN (0,1)), sensitive_download INTEGER NOT NULL CHECK(sensitive_download IN (0,1)),
  PRIMARY KEY(employee,company)
);
CREATE TABLE notice (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, owner TEXT REFERENCES employee(id),
  draft INTEGER NOT NULL CHECK(draft IN (0,1)), data TEXT NOT NULL
);
CREATE TABLE scope (
  id TEXT PRIMARY KEY, notice TEXT NOT NULL REFERENCES notice(id), company TEXT NOT NULL REFERENCES company(id),
  lot TEXT NOT NULL, round TEXT NOT NULL, data TEXT NOT NULL
);
CREATE TABLE attachment (
  id TEXT PRIMARY KEY, company TEXT NOT NULL REFERENCES company(id), record TEXT NOT NULL,
  sensitive INTEGER NOT NULL CHECK(sensitive IN (0,1))
);
CREATE TABLE attachment_version (
  attachment TEXT NOT NULL REFERENCES attachment(id), version TEXT NOT NULL,
  name TEXT NOT NULL, sha256 TEXT, bytes BLOB,
  PRIMARY KEY(attachment,version), CHECK((bytes IS NULL AND sha256 IS NULL) OR (bytes IS NOT NULL AND sha256 IS NOT NULL))
);
CREATE TABLE reference_history (source TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE finance_reference (scope TEXT PRIMARY KEY REFERENCES scope(id), data TEXT NOT NULL);
CREATE TABLE audit (
  seq INTEGER PRIMARY KEY, at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, outcome TEXT NOT NULL
);
`;

const json = (value) => JSON.stringify(value);
const bool = (value) => value === true ? 1 : 0;

export function transaction(db, run) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = run();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function importReference(db, snapshot) {
  transaction(db, () => {
    for (const row of snapshot.accounts) {
      if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(row.username)) throw new Error("Invalid explicit username mapping.");
      db.prepare("INSERT INTO employee(id,username,name,source_account,role,approval,perspective) VALUES (?,?,?,?,?,?,?)")
        .run(row.id, row.username, row.name, json(row.original ?? {}), row.role, row.approval, row.perspective);
    }
    for (const row of snapshot.companies) db.prepare("INSERT INTO company VALUES (?,?)").run(row.id, row.name);
    for (const row of snapshot.grants) {
      db.prepare("INSERT INTO grant_company VALUES (?,?,?,?,?,?)").run(
        row.account, row.company, bool(row.view), bool(row.edit), bool(row.verify), bool(row.sensitiveDownload),
      );
    }
    for (const row of snapshot.notices) {
      db.prepare("INSERT INTO notice VALUES (?,?,?,?,?)").run(row.id, row.title, row.owner ?? null, bool(row.draft), json(row));
    }
    for (const row of snapshot.scopes) {
      db.prepare("INSERT INTO scope VALUES (?,?,?,?,?,?)").run(row.id, row.notice, row.company, row.lot, row.round, json(row));
    }
    for (const row of snapshot.attachments) {
      db.prepare("INSERT INTO attachment VALUES (?,?,?,?)").run(row.id, row.company, row.record, bool(row.sensitive));
      for (const version of row.versions) {
        const bytes = version.bytes === null ? null : Buffer.from(version.bytes, "base64");
        if (bytes ? digest(bytes) !== version.sha256 : version.sha256 !== null) throw new Error("Attachment version hash mismatch.");
        db.prepare("INSERT INTO attachment_version VALUES (?,?,?,?,?)")
          .run(row.id, version.version, version.name, version.sha256, bytes);
      }
    }
    for (const row of snapshot.history) db.prepare("INSERT INTO reference_history VALUES (?,?)").run(row.id, json(row));
    for (const row of snapshot.finance) db.prepare("INSERT INTO finance_reference VALUES (?,?)").run(row.scope, json(row));
  });
}

export async function initStore(dir, snapshot) {
  if (snapshot.format !== 1 || snapshot.source !== "fictional-icp") throw new Error("Expected the isolated fictional ICP snapshot.");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if ((statSync(dir).mode & 0o077) !== 0) throw new Error("Restrict the data directory to 0700.");
  closeSync(openSync(join(dir, "workspace.db"), "wx", 0o600));
  const db = connect(dir);
  try {
    db.exec(schema);
    db.prepare("INSERT INTO installation VALUES (0,?)").run(randomBytes(48).toString("base64url"));
    importReference(db, snapshot);
    const { options, auth } = authFor(db, "http://localhost");
    await (await getMigrations(options)).runMigrations();
    const ctx = await auth.$context;
    const issued = [];
    for (const row of snapshot.accounts) {
      const password = temporaryPassword();
      const user = await ctx.internalAdapter.createUser({
        id: row.id,
        name: row.name,
        email: `${row.username}@accounts.example.invalid`,
        emailVerified: false,
        username: row.username,
        displayUsername: row.username,
      });
      if (user.id !== row.id) throw new Error("Authentication changed the original business account ID.");
      await ctx.internalAdapter.linkAccount({
        userId: row.id, accountId: row.id, providerId: "credential",
        password: await ctx.password.hash(password),
      });
      issued.push({ username: row.username, password });
    }
    db.exec("UPDATE installation SET version=1");
    return issued;
  } finally {
    db.close();
  }
}

export function openStore(dir, origin) {
  const db = connect(dir);
  try {
    if (db.prepare("SELECT version FROM installation").get()?.version !== 1) {
      throw new Error("Incomplete initialization. Use a clean isolated target or restore a backup.");
    }
    const { auth } = authFor(db, origin);
    return { db, auth, origin };
  } catch (error) {
    db.close();
    throw error;
  }
}
