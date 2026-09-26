import type { NextRequest } from "next/server";

import { getUserFromRequest } from "@/lib/auth/current-user";
import { errorResponse, readJsonBody } from "@/lib/refunds/http";
import { approveRefund } from "@/lib/refunds/service";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;
  try {
    const note = typeof body.note === "string" ? body.note : undefined;
    const refund = await approveRefund({ user: getUserFromRequest(request), id, note });
    return Response.json({ id: refund.id, status: refund.status, reviewedBy: refund.reviewedBy, reviewedAt: refund.reviewedAt });
  } catch (error) {
    return errorResponse(error);
  }
}
