import { closeSync, openSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { openStore } from "./store.mjs";

export async function backupWorkspace(source, destination) {
  const store = openStore(source, "http://localhost");
  try {
    // Exclusive creation avoids overwriting an existing backup. SQLite takes
    // a consistent snapshot even when the source is in WAL mode.
    closeSync(openSync(destination, "wx", 0o600));
    await backup(store.db, destination);
    const verify = new DatabaseSync(destination, { readOnly: true });
    try {
      if (verify.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") {
        throw new Error("Backup did not pass SQLite integrity_check.");
      }
      if (verify.prepare("SELECT version FROM installation").get()?.version !== 1) {
        throw new Error("Backup is missing its initialized workspace state.");
      }
    } finally {
      verify.close();
    }
  } finally {
    store.db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [dir, destination] = process.argv.slice(2);
  if (!dir || !destination || dirname(resolve(destination)) === resolve(dir)) {
    throw new Error("Pass the source workspace directory and a new backup filename in a separate directory.");
  }
  await backupWorkspace(resolve(dir), resolve(destination));
  console.log("SQLite backup passed integrity_check.");
}
