/**
 * The caller's identity is just the two mock-auth headers the core API reads.
 * The tool performs no role logic of its own: whatever the browser sent gets
 * forwarded verbatim, and the core API decides whether it is authorized.
 * In production this would be a token exchange (on-behalf-of) instead.
 */
export type CallerIdentity = {
  role: string | null;
  userId: string | null;
};

type HeaderSource = { get(name: string): string | null } | Record<string, string | string[] | undefined>;

export function identityFromHeaders(headers: HeaderSource): CallerIdentity {
  const read = (name: string): string | null => {
    if (typeof (headers as { get?: unknown }).get === "function") {
      return (headers as { get(n: string): string | null }).get(name);
    }
    const value = (headers as Record<string, string | string[] | undefined>)[name];
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
  };
  return { role: read("x-mock-role"), userId: read("x-mock-user-id") };
}

export function identityHeaders(identity: CallerIdentity): Record<string, string> {
  const headers: Record<string, string> = {};
  if (identity.role !== null) headers["x-mock-role"] = identity.role;
  if (identity.userId !== null) headers["x-mock-user-id"] = identity.userId;
  return headers;
}
