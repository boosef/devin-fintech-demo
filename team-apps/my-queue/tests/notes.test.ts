import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { openToolDatabase } from "../src/db";
import { addNote, listNotes } from "../src/notes";

import { openTestContext } from "./helpers";

describe("notes (test 4)", () => {
  it("persists a note in the tool database and survives reopening", async () => {
    const ctx = openTestContext();
    const note = await addNote(ctx.db, ctx.auditLog, {
      refundId: "rf_1",
      body: "called the customer, awaiting reply",
      actor: "demo-reviewer",
    });

    // Reopen the file like a dev-server restart would.
    const reopened = openToolDatabase(join(ctx.dir, "tool.db"));
    expect(listNotes(reopened, "rf_1")).toEqual([note]);
  });

  it("is append-only: a second note adds a row and leaves the first untouched", async () => {
    const ctx = openTestContext();
    const first = await addNote(ctx.db, ctx.auditLog, { refundId: "rf_1", body: "first", actor: "demo-reviewer" });
    const second = await addNote(ctx.db, ctx.auditLog, { refundId: "rf_1", body: "second", actor: "demo-reviewer" });

    const notes = listNotes(ctx.db, "rf_1");
    expect(notes).toEqual([first, second]);
    expect(notes[0]).toEqual(first);
    expect(notes[1]).not.toEqual(first);
  });

  it("writes exactly one audit record whose serialized form lacks the note body", async () => {
    const ctx = openTestContext();
    const secret = "do-not-log-this-note-body";
    await addNote(ctx.db, ctx.auditLog, { refundId: "rf_1", body: secret, actor: "demo-reviewer" });

    const records = await ctx.auditLog.queryAuditLog({ entityId: "rf_1" });
    expect(records).toHaveLength(1);
    const record = records[0]!;
    expect(record.action).toBe("note.added");
    expect(record.actor).toBe("demo-reviewer");
    expect(JSON.stringify(record)).not.toContain(secret);
  });
});
