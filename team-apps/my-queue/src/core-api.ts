import { identityHeaders, type CallerIdentity } from "./identity";

/**
 * Item shape from GET /api/v1/refunds, the ONLY interface this tool may depend
 * on. Redeclared here on purpose: importing the type from apps/** is forbidden
 * by the team-apps boundary rule.
 */
export type RefundItem = {
  id: string;
  customerId: string;
  amountCents: number;
  reason: string;
  status: "pending" | "approved" | "denied";
  requestedAt: string;
  assignedTo: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  decisionReason: string | null;
  ageDays: number;
  overdue: boolean;
};

/** A core API call result: HTTP status plus the parsed JSON body. */
export type CoreResult = { status: number; body: unknown };

export type CoreClient = {
  listMine(identity: CallerIdentity): Promise<CoreResult>;
  approve(identity: CallerIdentity, id: string, note?: string): Promise<CoreResult>;
  deny(identity: CallerIdentity, id: string, reason: string): Promise<CoreResult>;
};

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  status: number;
  json(): Promise<unknown>;
}>;

/**
 * Thin HTTP client for /api/v1/refunds. Every call forwards the caller's
 * identity headers unchanged; the core API authorizes.
 */
export function createCoreClient({
  baseUrl,
  fetchImpl = fetch,
}: {
  baseUrl: string;
  fetchImpl?: FetchLike;
}): CoreClient {
  const base = baseUrl.replace(/\/+$/, "");

  async function call(identity: CallerIdentity, method: string, path: string, body?: unknown): Promise<CoreResult> {
    const response = await fetchImpl(`${base}${path}`, {
      method,
      headers: {
        ...identityHeaders(identity),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const parsed: unknown = await response.json().catch(() => null);
    return { status: response.status, body: parsed };
  }

  return {
    listMine: (identity) => call(identity, "GET", "/api/v1/refunds?assignedTo=me"),
    approve: (identity, id, note) =>
      call(identity, "POST", `/api/v1/refunds/${encodeURIComponent(id)}/approve`, { note }),
    deny: (identity, id, reason) =>
      call(identity, "POST", `/api/v1/refunds/${encodeURIComponent(id)}/deny`, { reason }),
  };
}
