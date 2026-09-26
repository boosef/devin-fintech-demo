import type { AuditQuery, AuditRecord } from "./types";

export interface AuditLogStore {
  append(record: AuditRecord): Promise<void>;
  query(filter: AuditQuery): Promise<AuditRecord[]>;
}

export function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze((value as Record<string | symbol, unknown>)[key], seen);
  }
  return Object.freeze(value);
}

/**
 * Append-only, in-process audit store. Records are cloned and deep-frozen on
 * the way in and on the way out, so no caller can mutate the log contents.
 */
export class InMemoryAuditLogStore implements AuditLogStore {
  readonly #records: AuditRecord[] = [];

  async append(record: AuditRecord): Promise<void> {
    this.#records.push(deepFreeze(structuredClone(record)));
  }

  async query(filter: AuditQuery): Promise<AuditRecord[]> {
    return this.#records
      .filter(
        (record) =>
          (filter.entityId === undefined || record.entityId === filter.entityId) &&
          (filter.entityType === undefined || record.entityType === filter.entityType) &&
          (filter.actor === undefined || record.actor === filter.actor),
      )
      .map((record) => deepFreeze(structuredClone(record)));
  }
}
