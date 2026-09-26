import Database from "better-sqlite3";

export type ToolDb = Database.Database;

/**
 * The tool's own database. It holds only the tool's own data: notes and the
 * tool's audit records. It never touches the core app's database or schema.
 */
export function openToolDatabase(file: string): ToolDb {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      refund_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tool_audit_records (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      actor TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      on_behalf_of TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      before_json TEXT NOT NULL,
      after_json TEXT NOT NULL
    );
  `);
  return db;
}
