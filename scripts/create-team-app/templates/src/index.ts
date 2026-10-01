import { createAuditLog, InMemoryAuditLogStore } from "@acme/audit-log";
import { getMockUser, hasRole, type MockUser } from "@acme/auth-guard";

/** This tool's own audit log; core decisions are audited by the core API. */
export const auditLog = createAuditLog(new InMemoryAuditLogStore());

/** Returns the caller if they hold one of `roles`, otherwise null. */
export function requireRole(request: Request, roles: MockUser["role"][]): MockUser | null {
  const user = getMockUser(request);
  return hasRole(user, roles) ? user : null;
}
