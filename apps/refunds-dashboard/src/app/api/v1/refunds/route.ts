import type { NextRequest } from "next/server";

import { getRefundsApiV1 } from "@/lib/refunds/api-v1";

export async function GET(request: NextRequest) {
  return getRefundsApiV1().list(request);
}
