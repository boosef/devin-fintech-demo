import type { AuditLog } from "@acme/audit-log";

import type { ToolDb } from "./db";

/**
 * Notes are the tool's own data — a reviewer writes them against a refund id,
 * and the core system never sees them. Stored in PLAINTEXT for this POC (the
 * crypto module is app-local to refunds-dashboard and must not be imported);
 * the production gap is promoting crypto into a shared @acme package.
 *
 * Append-only: there is deliberately no update or delete path.
 */
export type Note = {
  id: string;
  refundId: string;
  /** plaintext by design for this POC — never put customer data in a note */
  body: string;
  createdBy: string;
  createdAt: string;
};

export const NOTE_ENTITY_TYPE = "refund_request";
export const NOTE_ADDED_ACTION = "note.added";
export const MAX_NOTE_LENGTH = 2000;

type NoteRow = {
  id: string;
  refund_id: string;
  body: string;
  created_by: string;
  created_at: string;
};

function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    refundId: row.refund_id,
    body: row.body,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export function listNotes(db: ToolDb, refundId?: string): Note[] {
  const rows = (
    refundId === undefined
      ? db.prepare("SELECT * FROM notes ORDER BY rowid ASC").all()
      : db.prepare("SELECT * FROM notes WHERE refund_id = ? ORDER BY rowid ASC").all(refundId)
  ) as NoteRow[];
  return rows.map(toNote);
}

/**
 * Inserts one note and writes exactly one audit record. The audit record's
 * before/after only carry the running count — never the note body.
 */
export async function addNote(
  db: ToolDb,
  auditLog: AuditLog,
  { refundId, body, actor }: { refundId: string; body: string; actor: string },
): Promise<Note> {
  const trimmed = body.trim();
  if (trimmed === "") {
    throw new Error("Note body must not be empty.");
  }
  if (trimmed.length > MAX_NOTE_LENGTH) {
    throw new Error(`Note must be at most ${MAX_NOTE_LENGTH} characters.`);
  }

  const before = { notes_count: countNotes(db, refundId) };
  const note: Note = {
    id: crypto.randomUUID(),
    refundId,
    body: trimmed,
    createdBy: actor,
    createdAt: new Date().toISOString(),
  };
  db.prepare("INSERT INTO notes (id, refund_id, body, created_by, created_at) VALUES (?, ?, ?, ?, ?)").run(
    note.id,
    note.refundId,
    note.body,
    note.createdBy,
    note.createdAt,
  );

  await auditLog.recordAuditEvent({
    actor,
    actorType: "human",
    action: NOTE_ADDED_ACTION,
    entityType: NOTE_ENTITY_TYPE,
    entityId: refundId,
    before,
    after: { notes_count: countNotes(db, refundId) },
  });

  return note;
}

function countNotes(db: ToolDb, refundId: string): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM notes WHERE refund_id = ?").get(refundId) as { n: number };
  return row.n;
}
