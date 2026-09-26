import fs from "node:fs";

import { createAuditLog } from "@acme/audit-log";

import { defaultDatabasePath, openDatabase } from "../src/db/client";
import { SqliteAuditLogStore } from "../src/lib/audit/sqlite-store";
import { loadEncryptionKey } from "../src/lib/crypto";
import { seedRefunds } from "../src/lib/refunds/seed";
import { createRefundService } from "../src/lib/refunds/service";

const file = defaultDatabasePath();
const encryptionKey = loadEncryptionKey();

// Reset: this is a local, synthetic dev database.
for (const suffix of ["", "-wal", "-shm"]) {
  fs.rmSync(`${file}${suffix}`, { force: true });
}

const db = openDatabase(file);
const service = createRefundService({
  db,
  auditLog: createAuditLog(new SqliteAuditLogStore(db)),
  encryptionKey,
});
const seeded = await seedRefunds({ db, service, encryptionKey });
console.log(`Seeded ${seeded.length} synthetic refund requests into ${file}`);
