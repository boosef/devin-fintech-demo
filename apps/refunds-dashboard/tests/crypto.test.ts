import { createAuditLog } from "@acme/audit-log";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { SqliteAuditLogStore } from "@/lib/audit/sqlite-store";
import {
  EncryptionKeyError,
  decrypt,
  decryptInteger,
  encrypt,
  encryptInteger,
  loadEncryptionKey,
} from "@/lib/crypto";
import { seedRefunds } from "@/lib/refunds/seed";
import { createRefundService } from "@/lib/refunds/service";

import { TEST_KEY, openTestDb, tempDbFile } from "./helpers/context";

function tamper(b64: string): string {
  const bytes = Buffer.from(b64, "base64");
  bytes[0] = (bytes[0] ?? 0) ^ 0xff;
  return bytes.toString("base64");
}

describe("crypto", () => {
  it("round-trips strings and integer amounts", () => {
    expect(decrypt(encrypt("cust_demo_0001", TEST_KEY), TEST_KEY)).toBe("cust_demo_0001");

    const amount = decryptInteger(encryptInteger(123456, TEST_KEY), TEST_KEY);
    expect(amount).toBe(123456);
    expect(Number.isInteger(amount)).toBe(true);
  });

  it("rejects tampered ciphertext or auth tag", () => {
    const [version, iv, tag, ciphertext] = encrypt("cust_demo_0001", TEST_KEY).split(":") as [string, string, string, string];
    expect(() => decrypt([version, iv, tag, tamper(ciphertext)].join(":"), TEST_KEY)).toThrow();
    expect(() => decrypt([version, iv, tamper(tag), ciphertext].join(":"), TEST_KEY)).toThrow();
  });

  it("fails fast with a clear error when the key is missing or the wrong length", () => {
    expect(() => loadEncryptionKey({})).toThrow(EncryptionKeyError);
    expect(() => loadEncryptionKey({})).toThrow(/REFUNDS_ENCRYPTION_KEY is not set/);
    const shortKey = Buffer.alloc(16, 1).toString("base64");
    expect(() => loadEncryptionKey({ REFUNDS_ENCRYPTION_KEY: shortKey })).toThrow(/must be 32 bytes/);
    expect(loadEncryptionKey({ REFUNDS_ENCRYPTION_KEY: TEST_KEY.toString("base64") })).toHaveLength(32);
  });

  it("stores only ciphertext for customer id and amount after seeding", async () => {
    const file = tempDbFile();
    const db = openTestDb(file);
    const service = createRefundService({
      db,
      auditLog: createAuditLog(new SqliteAuditLogStore(db)),
      encryptionKey: TEST_KEY,
    });
    const seeded = await seedRefunds({ db, service, encryptionKey: TEST_KEY });

    const raw = new Database(file, { readonly: true });
    const rows = raw.prepare("SELECT id, customer_id_enc, amount_cents_enc FROM refund_requests").all() as {
      id: string;
      customer_id_enc: string;
      amount_cents_enc: string;
    }[];
    raw.close();

    expect(rows).toHaveLength(seeded.length);
    for (const request of seeded) {
      const row = rows.find((r) => r.id === request.id);
      expect(row).toBeDefined();
      expect(row?.customer_id_enc).not.toContain(request.customerId);
      expect(row?.customer_id_enc).not.toContain("cust_demo");
      expect(row?.amount_cents_enc).not.toContain(String(request.amountCents));
      expect(row?.customer_id_enc.startsWith("v1:")).toBe(true);
      expect(row?.amount_cents_enc.startsWith("v1:")).toBe(true);
    }
  });
});
