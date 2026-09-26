export type ActorType = "human" | "agent";

export type AuditEvent = {
  /** who performed the action */
  actor: string;
  /** defaults to "human" when omitted */
  actorType?: ActorType;
  /** for agent actions: the human the agent acted for */
  onBehalfOf?: string;
  /** e.g. "refund.approved", "refund.denied" */
  action: string;
  /** e.g. "refund_request" */
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
};

export type AuditRecord = Readonly<
  AuditEvent & {
    id: string;
    /** ISO 8601 */
    timestamp: string;
    actorType: ActorType;
  }
>;

export type AuditQuery = {
  entityId?: string;
  entityType?: string;
  actor?: string;
};
