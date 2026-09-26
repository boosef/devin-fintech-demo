import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const REFUND_STATUSES = ["pending", "approved", "denied"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const refundRequests = sqliteTable(
  "refund_requests",
  {
    id: text("id").primaryKey(),
    /** AES-256-GCM ciphertext, see src/lib/crypto */
    customerIdEnc: text("customer_id_enc").notNull(),
    /** AES-256-GCM ciphertext of the integer amount in cents */
    amountCentsEnc: text("amount_cents_enc").notNull(),
    /** the customer's reason for requesting the refund */
    reason: text("reason").notNull(),
    status: text("status", { enum: REFUND_STATUSES }).notNull(),
    /** ISO 8601 */
    requestedAt: text("requested_at").notNull(),
    /** reviewer id the request is assigned to; null = unassigned queue */
    assignedTo: text("assigned_to"),
    reviewedBy: text("reviewed_by"),
    /** ISO 8601 */
    reviewedAt: text("reviewed_at"),
    /** the reviewer's reason: required when denying, optional when approving */
    decisionReason: text("decision_reason"),
  },
  (table) => [
    index("refund_requests_status_requested_at_idx").on(table.status, table.requestedAt),
  ],
);

export const auditRecords = sqliteTable(
  "audit_records",
  {
    id: text("id").primaryKey(),
    timestamp: text("timestamp").notNull(),
    actor: text("actor").notNull(),
    actorType: text("actor_type", { enum: ["human", "agent"] }).notNull(),
    onBehalfOf: text("on_behalf_of"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    /** JSON text */
    before: text("before").notNull(),
    /** JSON text */
    after: text("after").notNull(),
  },
  (table) => [index("audit_records_entity_idx").on(table.entityType, table.entityId)],
);

export type RefundRequestRow = typeof refundRequests.$inferSelect;
