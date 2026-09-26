import type { AuditLogStore, AuditQuery, AuditRecord } from "@acme/audit-log";

import type { ToolDb } from "./db";

type AuditRow = {
  id: string;
  timestamp: string;
  actor: string;
  actor_type: string;
  on_behalf_of: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  before_json: string;
  after_json: string;
};

/**
 * Persistent, append-only AuditLogStore backed by the tool's own database.
 * Insert-only by design: this class contains no UPDATE or DELETE.
 */
export class ToolAuditLogStore implements AuditLogStore {
  readonly #db: ToolDb;

  constructor(db: ToolDb) {
    this.#db = db;
  }

  async append(record: AuditRecord): Promise<void> {
    this.#db
      .prepare(
        `INSERT INTO tool_audit_records
         (id, timestamp, actor, actor_type, on_behalf_of, action, entity_type, entity_id, before_json, after_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.timestamp,
        record.actor,
        record.actorType,
        record.onBehalfOf ?? null,
        record.action,
        record.entityType,
        record.entityId,
        JSON.stringify(record.before ?? null),
        JSON.stringify(record.after ?? null),
      );
  }

  async query(filter: AuditQuery): Promise<AuditRecord[]> {
    const conditions: string[] = [];
    const params: string[] = [];
    if (filter.entityId !== undefined) {
      conditions.push("entity_id = ?");
      params.push(filter.entityId);
    }
    if (filter.entityType !== undefined) {
      conditions.push("entity_type = ?");
      params.push(filter.entityType);
    }
    if (filter.actor !== undefined) {
      conditions.push("actor = ?");
      params.push(filter.actor);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.#db
      .prepare(`SELECT * FROM tool_audit_records ${where} ORDER BY timestamp ASC, id ASC`)
      .all(...params) as AuditRow[];
    return rows.map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      actor: row.actor,
      actorType: row.actor_type as AuditRecord["actorType"],
      ...(row.on_behalf_of === null ? {} : { onBehalfOf: row.on_behalf_of }),
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      before: JSON.parse(row.before_json) as unknown,
      after: JSON.parse(row.after_json) as unknown,
    }));
  }
}
