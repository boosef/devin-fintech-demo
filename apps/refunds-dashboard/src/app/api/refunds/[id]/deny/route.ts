import type { NextRequest } from "next/server";

import { getUserFromRequest } from "@/lib/auth/current-user";
import { errorResponse, readJsonBody } from "@/lib/refunds/http";
import { denyRefund } from "@/lib/refunds/service";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;
  try {
    const reason = typeof body.reason === "string" ? body.reason : "";
    const refund = await denyRefund({ user: getUserFromRequest(request), id, reason });
    return Response.json({ id: refund.id, status: refund.status, reviewedBy: refund.reviewedBy, reviewedAt: refund.reviewedAt });
  } catch (error) {
    return errorResponse(error);
  }
}
