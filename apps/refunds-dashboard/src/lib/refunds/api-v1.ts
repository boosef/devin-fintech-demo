import "server-only";

import { getMockUser, type MockUser } from "@acme/auth-guard";

import { RefundServiceError } from "./errors";
import { errorResponse, readJsonBody } from "./http";
import { refundAge } from "./sla";
import { canReview, getRefundService, type RefundFilter, type RefundRequest, type RefundService } from "./service";

/**
 * The JSON contract for /api/v1/refunds/** — the only interface team-apps may
 * depend on. Every item carries the decrypted fields plus the server-computed
 * SLA columns.
 */
export type RefundItem = RefundRequest & {
  /** whole days since requestedAt, computed against the injected now() */
  ageDays: number;
  /** ageDays > SLA_DAYS */
  overdue: boolean;
};

export type RefundsApiV1Deps = {
  service: RefundService;
  /** injectable clock for ageDays/overdue */
  now?: () => Date;
};

function toItem(refund: RefundRequest, now: () => Date): RefundItem {
  return { ...refund, ...refundAge(refund.requestedAt, now()) };
}

/**
 * Handler logic for the v1 route handlers, with the service and clock injected
 * so tests exercise the real code path against a temporary database.
 *
 * Identity comes from the forwarded `x-mock-role` / `x-mock-user-id` headers
 * via `getMockUser`; `assignedTo=me` resolves to that user's id server-side —
 * a client-supplied user id is never trusted as "me".
 */
export function createRefundsApiV1({ service, now = () => new Date() }: RefundsApiV1Deps) {
  function authorize(request: Request): MockUser | Response {
    const user = getMockUser(request);
    if (!canReview(user)) {
      return errorResponse(new RefundServiceError("forbidden", "Only a reviewer or admin can do this."));
    }
    return user;
  }

  async function list(request: Request): Promise<Response> {
    const user = authorize(request);
    if (user instanceof Response) return user;

    const params = new URL(request.url).searchParams;
    const assignedToParam = params.get("assignedTo");
    const filter: RefundFilter = {
      status: (params.get("status") ?? undefined) as RefundFilter["status"],
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
      assignedTo: !assignedToParam ? undefined : assignedToParam === "me" ? user.id : assignedToParam,
    };

    try {
      const refunds = await service.listRefunds({ user, filter });
      return Response.json({ items: refunds.map((r) => toItem(r, now)) });
    } catch (error) {
      return errorResponse(error);
    }
  }

  async function approve(request: Request, id: string): Promise<Response> {
    const user = authorize(request);
    if (user instanceof Response) return user;

    const body = await readJsonBody(request);
    if (body instanceof Response) return body;
    try {
      const note = typeof body.note === "string" ? body.note : undefined;
      const refund = await service.approveRefund({ user, id, note });
      return Response.json(toItem(refund, now));
    } catch (error) {
      return errorResponse(error);
    }
  }

  async function deny(request: Request, id: string): Promise<Response> {
    const user = authorize(request);
    if (user instanceof Response) return user;

    const body = await readJsonBody(request);
    if (body instanceof Response) return body;
    try {
      const reason = typeof body.reason === "string" ? body.reason : "";
      const refund = await service.denyRefund({ user, id, reason });
      return Response.json(toItem(refund, now));
    } catch (error) {
      return errorResponse(error);
    }
  }

  return { list, approve, deny };
}

export type RefundsApiV1 = ReturnType<typeof createRefundsApiV1>;

// Process-wide default instance for the route handlers, alongside the cached
// service it wraps (see getRefundService).
const globalForApi = globalThis as typeof globalThis & { __refundsApiV1?: RefundsApiV1 };

export function getRefundsApiV1(): RefundsApiV1 {
  if (globalForApi.__refundsApiV1 === undefined) {
    globalForApi.__refundsApiV1 = createRefundsApiV1({ service: getRefundService() });
  }
  return globalForApi.__refundsApiV1;
}
