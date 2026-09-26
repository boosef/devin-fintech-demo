import "server-only";

import type { AuditLogStore, AuditQuery, AuditRecord } from "@acme/audit-log";
import { and, asc, eq, type SQL } from "drizzle-orm";

import type { RefundsDb } from "@/db/client";
import { auditRecords } from "@/db/schema";

/**
 * Persistent, append-only implementation of the shared `AuditLogStore`
 * interface. It only ever INSERTs and SELECTs; records come back deep-frozen.
 */
export class SqliteAuditLogStore implements AuditLogStore {
  readonly #db: RefundsDb;

  constructor(db: RefundsDb) {
    this.#db = db;
  }

  async append(record: AuditRecord): Promise<void> {
    this.#db
      .insert(auditRecords)
      .values({
        id: record.id,
        timestamp: record.timestamp,
        actor: record.actor,
        actorType: record.actorType,
        onBehalfOf: record.onBehalfOf ?? null,
        action: record.action,
        entityType: record.entityType,
        entityId: record.entityId,
        before: JSON.stringify(record.before ?? null),
        after: JSON.stringify(record.after ?? null),
      })
      .run();
  }

  async query(filter: AuditQuery): Promise<AuditRecord[]> {
    const conditions: SQL[] = [];
    if (filter.entityId !== undefined) conditions.push(eq(auditRecords.entityId, filter.entityId));
    if (filter.entityType !== undefined) conditions.push(eq(auditRecords.entityType, filter.entityType));
    if (filter.actor !== undefined) conditions.push(eq(auditRecords.actor, filter.actor));

    const rows = this.#db
      .select()
      .from(auditRecords)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(auditRecords.timestamp), asc(auditRecords.id))
      .all();

    return rows.map((row) => {
      const record: AuditRecord = {
        id: row.id,
        timestamp: row.timestamp,
        actor: row.actor,
        actorType: row.actorType,
        ...(row.onBehalfOf === null ? {} : { onBehalfOf: row.onBehalfOf }),
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        before: JSON.parse(row.before) as unknown,
        after: JSON.parse(row.after) as unknown,
      };
      return deepFreeze(record);
    });
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value)) {
      deepFreeze((value as Record<string | symbol, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}
