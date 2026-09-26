"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { MOCK_ROLE_COOKIE, MOCK_USER_ID_COOKIE } from "./current-user";

/** Dev-only personas for the "Viewing as" selector. */
export type Persona = "reviewer" | "admin" | "none";

const PERSONA_COOKIES: Record<Exclude<Persona, "none">, { role: string; userId: string }> = {
  reviewer: { role: "reviewer", userId: "demo-reviewer" },
  admin: { role: "admin", userId: "demo-admin" },
};

export async function setViewingAs(formData: FormData): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error('The "Viewing as" selector is only available in development.');
  }
  const persona = formData.get("persona");
  const returnTo = formData.get("returnTo");
  const jar = await cookies();

  if (persona === "reviewer" || persona === "admin") {
    const { role, userId } = PERSONA_COOKIES[persona];
    const options = { httpOnly: true, sameSite: "lax", path: "/" } as const;
    jar.set(MOCK_ROLE_COOKIE, role, options);
    jar.set(MOCK_USER_ID_COOKIE, userId, options);
  } else {
    jar.delete(MOCK_ROLE_COOKIE);
    jar.delete(MOCK_USER_ID_COOKIE);
  }

  redirect(typeof returnTo === "string" && returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/refunds");
}
