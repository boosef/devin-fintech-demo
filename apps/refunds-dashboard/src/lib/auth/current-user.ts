import "server-only";

import { getMockUser, type MockUser } from "@acme/auth-guard";
import { cookies } from "next/headers";

export const MOCK_ROLE_COOKIE = "mock_role";
export const MOCK_USER_ID_COOKIE = "mock_user_id";

type CookieReader = { get(name: string): { value: string } | undefined };

/**
 * Bridges the dev-only "Viewing as" cookies to @acme/auth-guard. Browsers can't
 * send custom headers on navigation, so the cookie values are forwarded
 * verbatim as x-mock-* headers; all role validation stays in getMockUser.
 */
function userFromCookies(jar: CookieReader): MockUser | null {
  const headers = new Headers();
  const role = jar.get(MOCK_ROLE_COOKIE)?.value;
  const userId = jar.get(MOCK_USER_ID_COOKIE)?.value;
  if (role !== undefined) headers.set("x-mock-role", role);
  if (userId !== undefined) headers.set("x-mock-user-id", userId);
  return getMockUser(new Request("http://refunds-dashboard.internal/", { headers }));
}

/** For server components and server actions. */
export async function getCurrentUser(): Promise<MockUser | null> {
  return userFromCookies(await cookies());
}

/** For route handlers. */
export function getUserFromRequest(request: { cookies: CookieReader }): MockUser | null {
  return userFromCookies(request.cookies);
}
