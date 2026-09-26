import type { NextRequest } from "next/server";

import { getRefundsApiV1 } from "@/lib/refunds/api-v1";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return getRefundsApiV1().deny(request, id);
}
