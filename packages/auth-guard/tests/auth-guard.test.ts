import { afterEach, describe, expect, it, vi } from "vitest";

import { getMockUser, hasRole } from "../src/index";

function requestWith(headers: Record<string, string>): Request {
  return new Request("https://internal.example.test/refunds", { headers });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getMockUser", () => {
  it("returns the mock user when mock auth is enabled and both headers are present", () => {
    vi.stubEnv("MOCK_AUTH_ENABLED", "true");

    const user = getMockUser(
      requestWith({ "x-mock-role": "admin", "x-mock-user-id": "alice" }),
    );

    expect(user).toEqual({ id: "alice", email: "alice@example.test", role: "admin" });
  });

  it("returns null when a header is missing or the role is invalid", () => {
    vi.stubEnv("MOCK_AUTH_ENABLED", "true");

    expect(getMockUser(requestWith({ "x-mock-user-id": "alice" }))).toBeNull();
    expect(getMockUser(requestWith({ "x-mock-role": "admin" }))).toBeNull();
    expect(
      getMockUser(requestWith({ "x-mock-role": "superuser", "x-mock-user-id": "alice" })),
    ).toBeNull();
  });

  it("returns null when MOCK_AUTH_ENABLED is not \"true\", even with valid headers", () => {
    const validHeaders = { "x-mock-role": "reviewer", "x-mock-user-id": "bob" };

    vi.stubEnv("MOCK_AUTH_ENABLED", undefined);
    expect(getMockUser(requestWith(validHeaders))).toBeNull();

    vi.stubEnv("MOCK_AUTH_ENABLED", "1");
    expect(getMockUser(requestWith(validHeaders))).toBeNull();
  });
});

describe("hasRole", () => {
  it("returns true when the user's role is allowed", () => {
    expect(hasRole({ id: "alice", email: "alice@example.test", role: "admin" }, ["admin"])).toBe(
      true,
    );
    expect(
      hasRole({ id: "bob", email: "bob@example.test", role: "reviewer" }, ["admin", "reviewer"]),
    ).toBe(true);
  });

  it("returns false for a disallowed role, a null user and an empty allow list", () => {
    const reviewer = { id: "bob", email: "bob@example.test", role: "reviewer" } as const;

    expect(hasRole(reviewer, ["admin"])).toBe(false);
    expect(hasRole(null, ["admin"])).toBe(false);
    expect(hasRole(reviewer, [])).toBe(false);
  });

  it("returns false for a null user even with a non-empty allow list", () => {
    expect(hasRole(null, ["admin", "reviewer"])).toBe(false);
  });
});
