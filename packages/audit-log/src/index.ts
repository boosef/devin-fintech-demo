import { InMemoryAuditLogStore, type AuditLogStore } from "./store";
import type { AuditEvent, AuditQuery, AuditRecord } from "./types";

export type { ActorType, AuditEvent, AuditQuery, AuditRecord } from "./types";
export type { AuditLogStore } from "./store";

export type AuditLog = {
  recordAuditEvent(event: AuditEvent): Promise<AuditRecord>;
  queryAuditLog(filter: AuditQuery): Promise<AuditRecord[]>;
};

export function createAuditLog(store: AuditLogStore): AuditLog {
  return {
    async recordAuditEvent(event: AuditEvent): Promise<AuditRecord> {
      const record: AuditRecord = {
        ...event,
        actorType: event.actorType ?? "human",
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
      };
      await store.append(record);
      const [stored] = (await store.query({ entityId: record.entityId })).filter(
        (candidate) => candidate.id === record.id,
      );
      return stored ?? record;
    },
    async queryAuditLog(filter: AuditQuery): Promise<AuditRecord[]> {
      return store.query(filter);
    },
  };
}

const defaultAuditLog = createAuditLog(new InMemoryAuditLogStore());

export function recordAuditEvent(event: AuditEvent): Promise<AuditRecord> {
  return defaultAuditLog.recordAuditEvent(event);
}

export function queryAuditLog(filter: AuditQuery): Promise<AuditRecord[]> {
  return defaultAuditLog.queryAuditLog(filter);
}

export { InMemoryAuditLogStore };
