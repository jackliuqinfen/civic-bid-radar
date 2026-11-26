import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "civic-bid-radar-demo-"));
const portProbe = createServer();
portProbe.listen(0, "127.0.0.1");
await once(portProbe, "listening");
const { port } = portProbe.address();
await new Promise(resolve => portProbe.close(resolve));
const origin = `http://localhost:${port}`;
const requestURL = `http://127.0.0.1:${port}`;
let app;
try {
  execFileSync(process.execPath, ["scripts/init-demo.mjs", dir], { cwd: root, stdio: "pipe" });
  const credentials = JSON.parse(readFileSync(join(dir, "demo-login.json"), "utf8"));
  app = spawn(process.execPath, ["runtime/selfhost/server.mjs"], {
    cwd: root, stdio: ["ignore", "pipe", "inherit"],
    env: {
      PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, TMPDIR: process.env.TMPDIR,
      BIDDING_RADAR_SELFHOST_DIR: dir, BIDDING_RADAR_SELFHOST_PORT: String(port),
    },
  });
  const output = (await once(app.stdout, "data", { signal: AbortSignal.timeout(12000) }))[0].toString();
  assert.match(output, /Bidding workspace listening on loopback/);
  const req = (path, options) => fetch(requestURL + path, { signal: AbortSignal.timeout(10000), ...options });
  assert.match(await (await req("/")).text(), /Civic Bid Radar/);
  assert.equal((await req("/api/session")).status, 401);
  const login = await req("/api/auth/sign-in/username", {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(credentials),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie().map(line => line.split(";")[0]).join("; ");
  const api = async (path, body) => {
    const response = await req(`/api${path}`, {
      headers: { cookie, origin, "content-type": "application/json" },
      ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
    });
    assert.equal(response.status, 200, path);
    return response.json();
  };
  const session = await api("/session");
  assert.equal(session.role, "admin");
  const pool = await api("/opportunities?tab=all");
  assert.ok(pool.items.some(item => item.id === "900001"));
  const company = await api("/opportunities?tab=all&matchCompanyId=demo-construction");
  assert.ok(company.items.some(item => item.id === "900001"));
  await api("/opportunities/900001/follow", { decision: "watching" });
  assert.ok((await api("/alerts")).items.some(item => item.kind === "amendment"));
  await api("/opportunities/900001/follow", { decision: "declined", note: "Fictional demo" });
  assert.ok((await api("/alerts?status=dismissed")).items.some(item => item.kind === "amendment"));
  assert.ok(!(await api("/alerts")).items.some(item => item.kind === "amendment"));
  console.log("Demo smoke passed: startup, authentication, company filtering, follow and archive.");
} finally {
  if (app && app.exitCode === null && app.signalCode === null) {
    const exited = once(app, "exit");
    app.kill("SIGTERM");
    await exited;
  }
  rmSync(dir, { recursive: true, force: true });
}
