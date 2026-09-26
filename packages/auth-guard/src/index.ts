import type { MockUser, Role } from "./types";

export type { MockUser, Role } from "./types";

const ROLES: readonly Role[] = ["admin", "reviewer"];

function isRole(value: string | null): value is Role {
  return value !== null && (ROLES as readonly string[]).includes(value);
}

/**
 * Mock authentication for the POC. Hard off-switch: without
 * MOCK_AUTH_ENABLED="true" this always returns null.
 */
export function getMockUser(request: Request): MockUser | null {
  if (process.env.MOCK_AUTH_ENABLED !== "true") return null;

  const role = request.headers.get("x-mock-role");
  const id = request.headers.get("x-mock-user-id");
  if (id === null || id === "" || !isRole(role)) return null;

  return { id, email: `${id}@example.test`, role };
}

export function hasRole(user: MockUser | null, allowed: Role[]): boolean {
  if (user === null || allowed.length === 0) return false;
  return allowed.includes(user.role);
}
